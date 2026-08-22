/**
 * Round Carry-Forward Routes — Sprint Patch 2
 *
 * Two endpoints:
 *   GET  /api/founder/companies/:companyId/carry-forward?roundType=safe|note|priced_equity
 *     Returns the CarryForwardResult for a proposed new round.
 *     READ-ONLY: pure computation, no state mutations.
 *     Returns 403 if user doesn't own the company.
 *     Returns 404 if company doesn't exist.
 *
 *   POST /api/founder/rounds/:roundId/carry-forward/accept
 *     Records the founder's decision (accept or override) for each suggested field.
 *     Appends an audit log entry, hash-chained to the previous entry.
 *     Returns the audit log entry id.
 *
 * Both routes require authentication via requireAuth.
 *
 * All monetary and share values are strings (investor-grade precision contract).
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { getRoundById, updateRound, closeRound, UPDATE_ROUND_WHITELIST_KEYS, ACTIVE_LIVE_ROUND_STATES, isOneOpenExemptRound, listActiveLivePricedRounds, OneOpenRoundConflictError } from "./roundsStore"; /* v25.17 Lane A NH7 — verify round↔company binding; v25.20 Lane 4 — persist accepted fields onto the round; v25.48.2 Q4c/MF4 one-open-round guard (atomic in-tx) */
/* WAVE 58f · F1 (R21) — THE SAME shared range rule the other two round writers
   use. IMPORTED, never re-implemented: `POST /api/rounds` and
   `PATCH /api/rounds/:id/terms` both import these two functions from
   `@shared/roundMathEngineAdapter` at `server/routes.ts:494`, and a second copy
   of a financial range rule is the R21 defect class this build exists to remove.
   See the block at the PATCH handler below for why this route needed them. */
/* WAVE 61b · R50 — the sibling term bounds, same module, same reason: this
   route hands EVERY patch key to `updateRound`, whose extras whitelist persists
   `valuationCap` / `maturityMonths` / `strikePrice` / `expiryYears` and whose
   column whitelist persists `fdPreMoneyShares`. It is the THIRD writer. */
import {
  validateDiscountPercentAsWritten,
  validateInterestRatePercentAsWritten,
  validateMaturityMonths,
  validateExpiryYears,
  validateStrikePrice,
  validateValuationCap,
  validateFdPreMoneyShares,
  /* WAVE 68 · R56 — the date-shaped WARNING for the two money terms. */
  dateShapedValueWarning,
  /* WAVE 76 · R60 / D5 — the two CLOSED vocabularies. THIS route is the one that
     was measured storing `"FULL_RATCHET"`, `"post money"` and the number `7` into
     them on a 200; see the block at its use site. */
  validateAntiDilutionTypeStored,
  validateSafeCapTypeStored,
  /* WAVE 77 · R71 — the absolute maturity date is DERIVED from `maturityMonths`
     and is not independently writable. THIS handler is the one Wave 76 measured
     accepting `maturityDate: "1999-01-01"` and `"not-a-date"` on a 200, bypassing
     the future-date refusal `POST /api/rounds` makes. The refusal object is the
     SAME imported constant all three writers use — one rule, not three copies. */
  MATURITY_DATE_NOT_WRITABLE,
  type TermValueVerdict,
} from "@shared/roundMathEngineAdapter";
/* WAVE 81 · ITEM 2 (D4) — WRITER 2 OF 2 needs the SAME fence as writer 1, because
   this handler hands every patch key to `updateRound` and `seniority` joined
   `UPDATE_EXTRAS_WHITELIST` in the same wave. Imported, never restated. */
import { validateSeniorityRankStored, validateParticipationCapStored } from "./lib/roundStoredTerms";
import { listPendingCommitments, lapsePendingWithinTx, emitLapsedMutations, type PendingCommitment } from "./lib/roundClosePendingLapse"; /* v25.48.2 Q13/MF5/MF6 — warn + atomically lapse un-confirmed soft-circles inside the close tx (parallel module, no cap-table math) */
/* v25.17 Lane A NH8 — computeCarryForwardLive is already imported from
   roundCarryForwardEngine below and reused for server-side digest recompute. */
import { companies } from "./mockData";
import { getCompanyRecordById } from "./multiCompanyStore"; // v25.48 DATA-2 (V-9) — canonical DB company lookup
import {
  computeCarryForwardLive,
  type RoundType,
  type CarryForwardResult,
} from "./roundCarryForwardEngine";
/* v25.35 Phase 5 — static import of the persistence shim. Previously the two
 * shim functions below were pulled in via inline `require("./lib/storePersistenceShim")`
 * (using the createRequire shim above). That inline require is mis-transformed
 * by the vitest module pipeline (it surfaced as `SyntaxError: Unexpected token
 * ')'` at the require site only under vitest, never under the dev/prod tsx ESM
 * loader). The shim has NO dependency back on this module (it only imports
 * `rawDb` + `log`), so a static ESM import is circular-safe and works in every
 * runtime — dev/prod tsx, the bundled CJS dist, and vitest alike. A namespace
 * import is used (rather than aliased named imports) because this module
 * shadows the global `require` with a module-scoped `createRequire` binding,
 * which can interfere with vitest's hoisting of aliased named imports. */
import * as _storePersist from "./lib/storePersistenceShim";
/* v25.45 Bug C — raw better-sqlite3 driver for the additive
 * round_chain_head_freezes table (typed, append-only-by-use). Mirrors the
 * wireInstructionsStore pattern: rawDb() throws on the Postgres backend / no-DB
 * sandbox, in which case we degrade to the in-memory Map only. */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
/* WAVE 17 ORP-044 — the milestone auto-trigger registry. A LEAF module (logger +
   currency only) precisely so this file can import it: importing
   `milestoneBroadcastStore` here would close the cycle
   milestoneBroadcastStore → captableCommitStore → roundsStore → this file. */
import {
  fireAutoBroadcast,
  roundClosedBody,
  roundClosedKey,
} from "./lib/wave17MilestoneAutoTriggers";

/* WAVE 61b · R50 — ONE table, used by BOTH writers in this file (the founder
   PATCH and the carry-forward accept), so they cannot bound different sets. */
const R50_BOUNDED_TERMS: ReadonlyArray<readonly [string, (raw: unknown) => TermValueVerdict]> = [
  ["valuationCap", validateValuationCap],
  ["maturityMonths", validateMaturityMonths],
  ["strikePrice", validateStrikePrice],
  ["expiryYears", validateExpiryYears],
  ["fdPreMoneyShares", validateFdPreMoneyShares],
];

/* ═════════════════════════════════════════════════════════════════
   WAVE 76 · R60 / D5 — THE TWO CLOSED VOCABULARIES, ON THE LOOSEST WRITER.
   ═════════════════════════════════════════════════════════════════
   Wave 76's brief said a founder "cannot correct" these two terms after creation.
   MEASUREMENT SAID OTHERWISE (`build_log/wave76/W76_PROBE_TRANSCRIPT.txt`, probe B):
   the founder round-patch handler below — which destructures
   `const { expectedVersion, ...patch }` and hands every remaining key to
   `updateRound` — has ALWAYS persisted both, and validated NEITHER:

   (The route's own path is deliberately NOT spelled out in this comment. Test
   `W58F-F1enum3` slices this file BETWEEN the accept route and the first literal
   occurrence of that path string to prove writer 4 cannot persist a term; a second
   occurrence above the accept route silently empties that slice and the proof
   passes vacuously. Found by running the suite, not by reasoning.)

     antiDilutionType = "full_ratchet"  -> HTTP 200, stored "full_ratchet"
     antiDilutionType = "FULL_RATCHET"  -> HTTP 200, stored "FULL_RATCHET"
     antiDilutionType = 7               -> HTTP 200, stored 7
     safeType         = "post money"    -> HTTP 200, stored "post money"

   The last three are the dangerous ones: `resolvePreferredTerms` throws
   `invalid_anti_dilution_type` on any token outside the closed list, so this route
   could put a round into a state where the cap-table path REFUSES TO COMPUTE, and
   the edit-terms screen could not undo it because that route dropped the key.

   This is the FOURTH time this handler has been found to be the loosest of the
   writers — Wave 58f (the corrupt discount came in here), Wave 61b ("it was not in
   the brief"), Wave 68, and now Wave 76. The rule is IMPORTED, never restated, so
   the three writers cannot drift.

   ABSENT IS UNTOUCHED, and that is load-bearing here: this is a sparse PATCH over
   an open field bag and almost every call carries neither key. The stored value is
   NOT rewritten by validation — `patch` reaches `updateRound` exactly as sent,
   matching the percent and R50 blocks above it. Validation here decides ACCEPT or
   REFUSE and nothing else. */
const W76_CLOSED_VOCABULARY_TERMS: ReadonlyArray<readonly [string, (raw: unknown) => TermValueVerdict]> = [
  ["antiDilutionType", validateAntiDilutionTypeStored],
  ["safeType", validateSafeCapTypeStored],
];

// ─── Audit log ────────────────────────────────────────────────────────────

export interface AcceptedField {
  fieldName: string;
  suggestedValue: unknown;
  /** Same as suggestedValue when accepted; different value when overridden. */
  acceptedValue: unknown;
}

export interface OverriddenField {
  fieldName: string;
  suggestedValue: unknown;
  acceptedValue: unknown;
  overrideReason: string;
}

export interface CarryForwardAuditEntry {
  id: string;
  roundId: string;
  companyId: string;
  actor: string;
  timestamp: string;
  acceptedFields: AcceptedField[];
  overriddenFields: OverriddenField[];
  /** SHA-256 of the CarryForwardResult that was presented to the founder. */
  auditDigest: string;
  /** SHA-256 hash of this entry, chained to the previous entry. */
  entryHash: string;
  prevEntryHash: string;
}

/* In-memory audit log. v25.11 NH1: write-through to kv-shim so the audit
 * trail survives a server restart. The Map remains as a hot-path cache; the
 * kv_carryForwardAuditLog table is authoritative.
 *
 * v25.18 Lane A NH4 (hard close):
 *   The previous single `lastEntryHash` interleaved every company's chain into
 *   one global thread. We now key the chain head by companyId so each company
 *   has an independently-verifiable hash chain. The global var is retained as
 *   a fallback for entries that predate the per-company chain. */
const auditLog: CarryForwardAuditEntry[] = [];
let lastEntryHash = "CARRY_FORWARD_GENESIS";
const lastEntryHashByCompany = new Map<string, string>(); /* v25.18 */

function _persistCarryForwardEntry(entry: CarryForwardAuditEntry): void {
  // v25.35 Phase 4 #23 — fail-closed: this is the durable write of an audit
  // hash-chain row. Previously the failure was swallowed ("non-fatal"), which
  // let the in-memory chain advance past a row that never reached the
  // authoritative kv_carryForwardAuditLog table — the exact corruption the
  // chain exists to detect would go undetected after a restart. We use the
  // STRICT persist variant: the non-strict `persistEntry` catches internally
  // and returns `false`, so it would NOT surface a write failure to us —
  // `persistEntryStrict` throws on any failure, letting the caller refuse to
  // advance the in-memory chain.
  // v25.35 Phase 5 — use the static ESM binding (see import note above) instead
  // of an inline require(), which the vitest pipeline mis-transforms.
  _storePersist.persistEntryStrict("carryForwardAuditLog", entry.id, entry);
}

export function hydrateCarryForwardAuditLog(): number {
  try {
    // v25.35 Phase 5 — use the static ESM binding (see import note above).
    const rows = _storePersist.hydrateEntries("carryForwardAuditLog") as Array<[string, CarryForwardAuditEntry]>;
    /* Sort by timestamp ASC so chain rebuilds in append order. */
    const entries = rows.map(([, v]) => v).filter(Boolean);
    entries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    for (const e of entries) {
      auditLog.push(e);
      lastEntryHash = e.entryHash;
      if (e.companyId) lastEntryHashByCompany.set(e.companyId, e.entryHash); /* v25.18 */
    }
    return entries.length;
  } catch {
    return 0;
  }
}

function computeEntryHash(prevHash: string, entry: Omit<CarryForwardAuditEntry, "entryHash">): string {
  const canonical = stableStringify({ ...entry, prevEntryHash: prevHash });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + (value as unknown[]).map(stableStringify).join(",") + "]";
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function getCarryForwardAuditLog(): ReadonlyArray<CarryForwardAuditEntry> {
  return auditLog;
}

/* v25.20 Lane 4 — round-close chain-head freeze (preserves v25.18 NH4).
 *
 * When a round is closed via roundsStore.closeRound, we "freeze" the
 * per-company carry-forward hash-chain head as it stood at close time. This
 * does NOT mutate the chain (the v25.18 NH4 per-company chain remains the
 * single source of verifiability) — it records the immutable tip hash for the
 * closed round so any later audit can prove exactly which chain state was the
 * canonical baseline at the moment the round was sealed. The chain itself is
 * append-only and untouched; only a read-only snapshot is captured.
 *
 * Returns the frozen head hash (or the GENESIS sentinel if the company has no
 * carry-forward entries yet). */
const frozenRoundChainHead = new Map<string, { roundId: string; companyId: string; chainHead: string; frozenAt: string }>();

/* ---------- v25.45 Bug C: durable backing for the freeze snapshot ----------
 * The Map above used to be the ONLY home for the per-round frozen chain-head
 * snapshot, so a server restart lost every closed round's audit baseline and a
 * post-restart re-freeze could re-snapshot against a DIFFERENT chain head,
 * corrupting the round-close audit baseline. We now mirror the snapshot into
 * the round_chain_head_freezes table (round_id PRIMARY KEY -> idempotent).
 * Mirrors the wireInstructionsStore pattern: rawDb() throws on the Postgres
 * backend / no-DB sandbox, in which case we degrade to the Map only. */
let chainHeadFreezeTableReady = false;

function chainHeadFreezeDb(): { exec: (s: string) => void; prepare: (s: string) => any } | null {
  try {
    return rawDb();
  } catch {
    return null; // Postgres backend or no-DB sandbox -- Map is authoritative.
  }
}

function ensureChainHeadFreezeTable(): void {
  if (chainHeadFreezeTableReady) return;
  const driver = chainHeadFreezeDb();
  if (!driver) {
    chainHeadFreezeTableReady = true;
    return;
  }
  try {
    driver.exec(`CREATE TABLE IF NOT EXISTS round_chain_head_freezes (
      round_id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      chain_head TEXT NOT NULL,
      frozen_at TEXT NOT NULL
    );`);
    chainHeadFreezeTableReady = true;
  } catch (err) {
    log.warn("[roundCarryForward.ensureChainHeadFreezeTable] CREATE TABLE failed (non-fatal):", (err as Error).message);
    chainHeadFreezeTableReady = true; // fall back to Map; don't retry every call
  }
}

function readFrozenRoundChainHeadFromDb(
  roundId: string,
): { roundId: string; companyId: string; chainHead: string; frozenAt: string } | null {
  const driver = chainHeadFreezeDb();
  if (!driver) return null;
  try {
    const r: any = driver
      .prepare(`SELECT round_id, company_id, chain_head, frozen_at FROM round_chain_head_freezes WHERE round_id = ?`)
      .get(roundId);
    if (r) {
      return {
        roundId: r.round_id,
        companyId: r.company_id,
        chainHead: r.chain_head,
        frozenAt: r.frozen_at,
      };
    }
  } catch (err) {
    log.warn("[roundCarryForward.readFrozenRoundChainHeadFromDb] read failed:", (err as Error).message);
  }
  return null;
}

export function getCarryForwardChainHead(companyId: string): string {
  return lastEntryHashByCompany.get(companyId) ?? "CARRY_FORWARD_GENESIS";
}

/* v25.45 Bug C ROUND-2 (GPT-5.5 blocker 3): the freeze persist is now
 * FAIL-CLOSED. Thrown when present (when a DB driver is available, which is
 * the production + SQLite-test path). A closed-but-not-frozen round must NEVER
 * be reported as successfully closed, so closeRound() drives the strict freeze
 * BEFORE it commits the terminal round state and refuses to close if the
 * freeze cannot be durably persisted (see roundsStore.closeRound).
 *
 * `strict` (default false) preserves the legacy best-effort behavior for any
 * non-close caller; closeRound passes strict=true. When no DB driver is
 * present (Postgres backend or no-DB sandbox) the Map is authoritative and we
 * cannot prove a durable write, so strict mode is a no-op on persistence (the
 * snapshot is still recorded in the Map) — exactly as before.
 */
export class FreezePersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreezePersistError";
  }
}

export function freezeRoundChainHead(
  roundId: string,
  companyId: string,
  opts?: { strict?: boolean },
): string {
  const strict = opts?.strict === true;
  /* Idempotent: a second freeze for the same round returns the already-frozen
     head and never re-snapshots (the round can only close once). The DB row's
     round_id PRIMARY KEY + ON CONFLICT DO NOTHING enforces the same invariant
     across restarts even if the in-memory Map was cleared. */
  const existing = frozenRoundChainHead.get(roundId);
  if (existing) return existing.chainHead;

  ensureChainHeadFreezeTable();

  /* If a freeze already exists in the DB (e.g. after a restart that cleared the
     Map), honor it -- never re-snapshot against a possibly-different chain head. */
  const persisted = readFrozenRoundChainHeadFromDb(roundId);
  if (persisted) {
    frozenRoundChainHead.set(roundId, persisted);
    return persisted.chainHead;
  }

  const chainHead = getCarryForwardChainHead(companyId);
  const snapshot = {
    roundId,
    companyId,
    chainHead,
    frozenAt: new Date().toISOString(),
  };

  const driver = chainHeadFreezeDb();
  if (driver) {
    try {
      driver
        .prepare(
          `INSERT INTO round_chain_head_freezes
             (round_id, company_id, chain_head, frozen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(round_id) DO NOTHING`,
        )
        .run(snapshot.roundId, snapshot.companyId, snapshot.chainHead, snapshot.frozenAt);
    } catch (err) {
      const msg = (err as Error).message;
      if (strict) {
        /* FAIL-CLOSED: do NOT record the in-memory snapshot, so the round
           cannot be observed as frozen. Propagate so closeRound aborts and the
           terminal round state is never committed. */
        log.error("[roundCarryForward.freezeRoundChainHead] strict persist FAILED — aborting close:", msg);
        throw new FreezePersistError(msg);
      }
      log.warn("[roundCarryForward.freezeRoundChainHead] persist failed (kept in-memory):", msg);
    }
  }

  /* Persist confirmed (or no-DB sandbox where the Map is authoritative): record
     the in-memory snapshot only AFTER a successful/uncontested write. */
  frozenRoundChainHead.set(roundId, snapshot);

  return chainHead;
}

export function getFrozenRoundChainHead(roundId: string): string | null {
  const cached = frozenRoundChainHead.get(roundId);
  if (cached) return cached.chainHead;
  ensureChainHeadFreezeTable();
  const persisted = readFrozenRoundChainHeadFromDb(roundId);
  if (persisted) {
    frozenRoundChainHead.set(roundId, persisted);
    return persisted.chainHead;
  }
  return null;
}

/** v25.45 Bug C: rehydrate the frozen-chain-head Map from the durable
 *  round_chain_head_freezes table on boot. Returns the number of snapshots
 *  loaded. Safe to call when there is no DB (returns 0). */
export function hydrateRoundChainHeadFreezes(): number {
  ensureChainHeadFreezeTable();
  const driver = chainHeadFreezeDb();
  if (!driver) return 0;
  let n = 0;
  try {
    const rows: any[] = driver
      .prepare(`SELECT round_id, company_id, chain_head, frozen_at FROM round_chain_head_freezes`)
      .all();
    for (const r of rows) {
      frozenRoundChainHead.set(r.round_id, {
        roundId: r.round_id,
        companyId: r.company_id,
        chainHead: r.chain_head,
        frozenAt: r.frozen_at,
      });
      n++;
    }
  } catch (err) {
    log.warn("[roundCarryForward.hydrateRoundChainHeadFreezes] hydrate failed:", (err as Error).message);
  }
  return n;
}

export function clearCarryForwardAuditLog(): void {
  auditLog.length = 0;
  lastEntryHash = "CARRY_FORWARD_GENESIS";
  lastEntryHashByCompany.clear(); /* v25.18 */
  frozenRoundChainHead.clear(); /* v25.20 Lane 4 */
}

export function appendCarryForwardAuditEntry(
  params: {
    roundId: string;
    companyId: string;
    actor: string;
    acceptedFields: AcceptedField[];
    overriddenFields: OverriddenField[];
    auditDigest: string;
  },
): CarryForwardAuditEntry {
  /* v25.18 Lane A NH4 — per-company chain head. */
  const prevForCompany = lastEntryHashByCompany.get(params.companyId) ?? "CARRY_FORWARD_GENESIS";
  const partial: Omit<CarryForwardAuditEntry, "entryHash"> = {
    id: randomBytes(12).toString("hex"),
    roundId: params.roundId,
    companyId: params.companyId,
    actor: params.actor,
    timestamp: new Date().toISOString(),
    acceptedFields: params.acceptedFields,
    overriddenFields: params.overriddenFields,
    auditDigest: params.auditDigest,
    prevEntryHash: prevForCompany,
  };
  const entryHash = computeEntryHash(prevForCompany, partial);
  const entry: CarryForwardAuditEntry = { ...partial, entryHash };
  /* v25.35 Phase 4 #23 — persist FIRST (fail-closed). The in-memory chain
   * (auditLog + per-company head) must advance ONLY after the durable audit
   * row commits, otherwise a restart would rebuild a chain that skips a tip
   * the running process believed it had recorded. If persistence throws, the
   * chain state is left exactly as it was and the throw surfaces to the route
   * (500); nothing is half-applied. */
  _persistCarryForwardEntry(entry);
  auditLog.push(entry);
  lastEntryHash = entryHash;
  lastEntryHashByCompany.set(params.companyId, entryHash); /* v25.18 */
  return entry;
}

// ─── Route registration ───────────────────────────────────────────────────

export function registerRoundCarryForwardRoutes(app: Express): void {
  /**
   * GET /api/founder/companies/:companyId/carry-forward?roundType=safe|note|priced_equity
   *
   * Returns a carry-forward suggestion object for the proposed new round.
   * PURE READ — no state mutations.
   */
  app.get(
    "/api/founder/companies/:companyId/carry-forward",
    requireAuth,
    (req: Request, res: Response) => {
      const { companyId } = req.params;
      const roundType = req.query["roundType"] as string | undefined;

      // Auth: must own the company (requireAuth already checked session)
      const ctx = getUserContext(req);
      const ownsCompany =
        ctx?.founder.companies.some((c) => c.companyId === companyId) ?? false;
      if (!ownsCompany && !ctx?.isAdmin) {
        return res.status(403).json({
          ok: false,
          error: "FORBIDDEN",
          message: "You do not own this company.",
        });
      }

      // B-301 fix v23.4.13: graceful empty carry-forward
      // v25.48 DATA-2 (V-9) — resolve the company from the CANONICAL DB store
      // (getCompanyRecordById), NOT the mockData `companies` array. On live that
      // array is empty, so the previous `companies.find(...)` always missed and
      // EVERY real company fell into the "new company — no prior rounds" empty
      // branch regardless of how many real rounds it had. The carry-forward
      // engine itself already reads live rounds; this lookup just needs to know
      // the company exists. Keep the graceful empty-but-valid result shape.
      const dbCompany = getCompanyRecordById(String(companyId));
      const company = dbCompany ? { id: String(companyId) } : undefined;

      // Validate roundType (do this BEFORE the new-company shortcut so we keep
      // returning 400 for malformed requests on both paths).
      const validTypes: RoundType[] = ["safe", "note", "priced_equity"];
      if (!roundType || !validTypes.includes(roundType as RoundType)) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_ROUND_TYPE",
          message: `roundType query param must be one of: ${validTypes.join(", ")}`,
        });
      }

      if (!company) {
        const emptyResult: CarryForwardResult = {
          companyId,
          proposedRoundType: roundType as RoundType,
          computedAt: new Date().toISOString(),
          fields: {},
          unrealizedInstruments: [],
          warnings: ["New company — no prior rounds to carry forward."],
          auditDigest: "",
        };
        return res.status(200).json({ ok: true, result: emptyResult });
      }

      const result: CarryForwardResult = computeCarryForwardLive({
        companyId,
        proposedRoundType: roundType as RoundType,
      });

      return res.status(200).json({ ok: true, result });
    },
  );

  /**
   * POST /api/founder/rounds/:roundId/carry-forward/accept
   *
   * Body: {
   *   companyId: string,
   *   auditDigest: string,           — digest of the suggestion shown to the founder
   *   acceptedFields: Array<{ fieldName, suggestedValue, acceptedValue }>,
   *   overriddenFields: Array<{ fieldName, suggestedValue, acceptedValue, overrideReason }>
   * }
   *
   * Appends an audit log entry. Returns the entry id.
   */
  app.post(
    "/api/founder/rounds/:roundId/carry-forward/accept",
    requireAuth,
    (req: Request, res: Response) => {
      const { roundId } = req.params;
      const body = req.body ?? {};

      const { companyId, auditDigest, acceptedFields, overriddenFields } = body as {
        companyId?: string;
        auditDigest?: string;
        acceptedFields?: AcceptedField[];
        overriddenFields?: OverriddenField[];
      };

      // Validate required fields
      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ ok: false, error: "MISSING_COMPANY_ID" });
      }
      if (!auditDigest || typeof auditDigest !== "string") {
        return res.status(400).json({ ok: false, error: "MISSING_AUDIT_DIGEST" });
      }
      if (!Array.isArray(acceptedFields)) {
        return res.status(400).json({ ok: false, error: "MISSING_ACCEPTED_FIELDS" });
      }
      if (!Array.isArray(overriddenFields)) {
        return res.status(400).json({ ok: false, error: "MISSING_OVERRIDDEN_FIELDS" });
      }

      // Auth: must own the company
      const ctx = getUserContext(req);
      const ownsCompany =
        ctx?.founder.companies.some((c) => c.companyId === companyId) ?? false;
      if (!ownsCompany && !ctx?.isAdmin) {
        return res.status(403).json({
          ok: false,
          error: "FORBIDDEN",
          message: "You do not own this company.",
        });
      }

      /* v25.17 Lane A NH7 — ensure the roundId actually belongs to the supplied
         companyId. Without this check a founder owning company A could accept
         a carry-forward against company B's round by passing companyId=A. */
      const round = getRoundById(String(roundId));
      if (round && round.companyId && round.companyId !== companyId) {
        return res.status(403).json({
          ok: false,
          error: "ROUND_COMPANY_MISMATCH",
          message: "This round does not belong to the supplied companyId.",
        });
      }

      // Validate override reasons are present for every overridden field
      for (const override of overriddenFields) {
        if (!override.fieldName || !override.overrideReason) {
          return res.status(400).json({
            ok: false,
            error: "INVALID_OVERRIDE",
            message: "Each overridden field must include fieldName and overrideReason.",
          });
        }
      }

      const actor =
        ctx?.identity.email ?? `founder:${companyId}`; /* v14 — no x-actor-email header */

      /* v25.18 Lane A NC3 (hard close) — server-side digest recompute.

         The v25.17 attempt had two bugs:
           1) It passed `roundType:` but the engine expects `proposedRoundType:`,
              which made the engine fall back to defaults — producing a digest
              that NEVER matched a real client suggestion, so legitimate accepts
              always returned 409.
           2) It only computed the digest `if (round)` and silently accepted
              the client-supplied digest verbatim otherwise — a forgery path
              for unknown roundIds.

         The fix below:
           a) Always recomputes the digest using the canonical
              `proposedRoundType` from the round record (no client input).
           b) Fails CLOSED when the round is unknown OR the recompute throws
              (we cannot verify the client digest — reject the request).
           c) Always persists the server-computed digest, never the client's. */
      const proposedRoundType = (round?.type ?? round?.roundType ?? null) as
        | "safe"
        | "note"
        | "priced_equity"
        | null;
      if (!round || !proposedRoundType) {
        return res.status(404).json({
          ok: false,
          error: "ROUND_NOT_FOUND",
          message: "Round not found or has no carry-forward shape.",
        });
      }
      let serverDigest: string | null = null;
      try {
        const liveResult = computeCarryForwardLive({
          companyId,
          proposedRoundType,
        } as any);
        serverDigest = liveResult?.auditDigest ?? null;
      } catch (digestErr) {
        return res.status(500).json({
          ok: false,
          error: "DIGEST_RECOMPUTE_FAILED",
          message: (digestErr as Error).message,
        });
      }
      if (!serverDigest) {
        return res.status(500).json({
          ok: false,
          error: "DIGEST_RECOMPUTE_EMPTY",
          message: "Server could not compute the audit digest.",
        });
      }
      if (serverDigest !== auditDigest) {
        return res.status(409).json({
          ok: false,
          error: "AUDIT_DIGEST_STALE",
          message: "Suggestion has changed since you reviewed it. Refresh and try again.",
          serverDigest,
        });
      }
      const finalDigest = serverDigest;

      /* v25.20 Lane 4 — close the v25.19 Lane 2 NC2 gap.

         Build the round patch from the founder's accepted + overridden field
         decisions and write it through `roundsStore.updateRound` BEFORE the
         audit entry is appended. This is the transactional ordering the gap
         comment promised: if the round mutation fails for any reason, we do
         NOT append the carry-forward audit entry (no half-write where the
         audit claims an accept that never landed on the round). The
         per-company hash chain (v25.18 NH4) and the deterministic digest
         (v25.19 NC1) are both preserved — this only ADDS the round write.

         Each acceptedField carries the acceptedValue the founder confirmed;
         each overriddenField carries the acceptedValue the founder chose
         instead of the suggestion. updateRound's whitelist silently rejects
         unknown field names (mass-assignment guard) so a hostile body can't
         flip protected columns. We map carry-forward field names onto the
         round patch and let updateRound reject anything off-whitelist. */
      const roundPatch: Record<string, unknown> = {};
      for (const f of acceptedFields) {
        if (f && typeof f.fieldName === "string") roundPatch[f.fieldName] = f.acceptedValue;
      }
      for (const f of overriddenFields) {
        if (f && typeof f.fieldName === "string") roundPatch[f.fieldName] = f.acceptedValue;
      }

      /* Only attempt a round write when at least one carry-forward field maps
         to a whitelisted round column. Unknown keys are dropped here (rather
         than 400'd) because carry-forward suggestions legitimately include
         advisory fields that are NOT round-shell columns (e.g. discount,
         valuationCap) — those live on the audit entry, not the round row. */
      const whitelistKeys = new Set(UPDATE_ROUND_WHITELIST_KEYS);
      const filteredPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(roundPatch)) {
        if (whitelistKeys.has(k)) filteredPatch[k] = v;
      }

      /* WAVE 61b · R50 — WRITER 4 OF 4. The founder supplies `acceptedValue` for
         every accepted/overridden field, and it lands in `filteredPatch`
         unvalidated. The audit digest pins the SUGGESTION, not the value the
         founder chose instead, so an overridden `fdPreMoneyShares` of 20260707
         reached `updateRound` on a 409-clean request. Same imported rule, same
         refusal by name; absent keys are untouched. */
      for (const [key, validate] of R50_BOUNDED_TERMS) {
        const v = validate(filteredPatch[key]);
        if (!v.ok) {
          return res.status(400).json({ ok: false, error: v.error, message: v.message });
        }
      }

      if (Object.keys(filteredPatch).length > 0) {
        const upd = updateRound(String(roundId), filteredPatch, { actor });
        /* NO_CHANGES is benign (the accepted values already matched the round).
           Any genuine failure (DB_WRITE_FAILED / ROUND_NOT_FOUND / etc.) must
           NOT append the audit — return a clean 500 instead. */
        if (!upd.ok && upd.error !== "NO_CHANGES") {
          return res.status(500).json({
            ok: false,
            error: "ROUND_UPDATE_FAILED",
            detail: upd.error,
            message: "Failed to persist accepted fields onto the round; audit entry NOT written.",
          });
        }
      }

      // v25.35 Phase 4 #23 — appendCarryForwardAuditEntry now persists the audit
      // hash-chain row FIRST and fails-closed (throws) if the durable write
      // does not commit. Translate that into a 500 so the caller is told the
      // accept was NOT recorded, rather than receiving a 201 for a chain tip
      // that exists only in process memory and would be lost on restart.
      let entry;
      try {
        entry = appendCarryForwardAuditEntry({
          roundId,
          companyId,
          actor,
          acceptedFields,
          overriddenFields,
          auditDigest: finalDigest,
        });
      } catch (auditErr) {
        return res.status(500).json({
          ok: false,
          error: "AUDIT_PERSIST_FAILED",
          message: "The accepted fields were written to the round but the audit entry could not be durably recorded; the audit chain was not advanced.",
          detail: (auditErr as Error).message,
        });
      }
      /* v25.20 Lane 4 (SUCCESS — closes v25.19 Lane 2 NC2):
         The accepted/overridden fields are now written onto the round record
         transactionally via roundsStore.updateRound (above) BEFORE this audit
         entry is appended. The audit entry is still persisted via the kv-shim
         (carryForwardAuditLog) and chained per-company (v25.18 NH4); the
         deterministic server-side digest recompute (v25.19 NC1) is unchanged.
         There is no longer a half-write gap: the round mutation and the audit
         entry both land, or neither does. */

      return res.status(201).json({
        ok: true,
        auditEntryId: entry.id,
        entryHash: entry.entryHash,
        prevEntryHash: entry.prevEntryHash,
        timestamp: entry.timestamp,
      });
    },
  );

  /* ───────────────────────────────────────────────────────────────────────
   * v25.20 Lane 4 — canonical founder round-mutation routes.
   *
   * These expose roundsStore.updateRound / closeRound to the founder client.
   * Both require auth AND verify the caller is the founder of the round's
   * company (assertRoundOwnership) BEFORE invoking the internal store fn.
   * ────────────────────────────────────────────────────────────────────── */

  /** Resolve round→company and verify the session founder owns it.
   *  Returns the round + actor email on success, or null after writing the
   *  appropriate 401/403/404 response. */
  function assertRoundOwnership(
    req: Request,
    res: Response,
    roundId: string,
  ): { round: ReturnType<typeof getRoundById>; actor: string } | null {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) {
      res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
      return null;
    }
    const round = getRoundById(String(roundId));
    if (!round) {
      res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" });
      return null;
    }
    const owns = ctx.founder.companies.some((c) => c.companyId === round.companyId);
    if (!owns && !ctx.isAdmin) {
      res.status(403).json({ ok: false, error: "NOT_ROUND_OWNER" });
      return null;
    }
    const actor = ctx.identity?.email ?? `founder:${round.companyId}`;
    return { round, actor };
  }

  /**
   * PATCH /api/founder/rounds/:id
   * Body: a field patch (whitelisted in roundsStore.updateRound).
   * Optional header/body `expectedVersion` for optimistic concurrency.
   */
  app.patch(
    "/api/founder/rounds/:id",
    requireAuth,
    (req: Request, res: Response) => {
      const { id } = req.params;
      const owned = assertRoundOwnership(req, res, String(id));
      if (!owned) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { expectedVersion, ...patch } = body;
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: "EMPTY_PATCH" });
      }

      /* v25.48.2 Q4c — ONE-OPEN-ROUND hard block (PARALLEL route-layer guard;
       * the Sacred cap-table/ledger math is untouched). When this PATCH would
       * transition the round INTO an active/live state, refuse with 409 if the
       * company already has ANOTHER active/live PRICED round. Warrant + ESOP/
       * option-pool rounds are EXEMPT (they may coexist with a priced round):
       *   - activating an exempt round → never blocked here,
       *   - activating a priced round → blocked only by another priced open round.
       * DB-driven + fail-closed. */
      const targetStateRaw = (patch as any).state ?? (patch as any).status;
      const targetState = typeof targetStateRaw === "string" ? targetStateRaw.toLowerCase() : null;
      const current = owned.round;
      const activatingExempt = isOneOpenExemptRound({
        type: (patch as any).type ?? current?.type,
        instrument: (patch as any).instrument ?? current?.instrument,
      });
      /* v25.48.2 MF4 — the one-open-round conflict re-check now runs INSIDE the
         update transaction (after the state UPDATE applies) so the check and the
         activation are ATOMIC: two concurrent activations for the same company
         can't both pass a pre-write read. listActiveLivePricedRounds excludes
         this round and THROWS on a DB read error (fail-closed, no in-memory
         fallback), which rolls back the activation. */
      const enforceOneOpen = Boolean(targetState && ACTIVE_LIVE_ROUND_STATES.has(targetState) && !activatingExempt);

      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 58f · F1 — THE THIRD WRITER. THIS IS THE ROUTE THE DATE CAME IN ON.
         ═══════════════════════════════════════════════════════════════════════
         WHAT WAS WRONG. Wave 58e closed `POST /api/rounds` and
         `PATCH /api/rounds/:id/terms` and reported "both HTTP writers closed".
         THERE WERE THREE. This handler destructures `const { expectedVersion,
         ...patch } = body;` and hands EVERY remaining key to
         `roundsStore.updateRound`, whose `UPDATE_EXTRAS_WHITELIST` persists
         `discount` and `interestRate` into `rounds.extras_json`. It called
         NEITHER validator. So `PATCH /api/founder/rounds/:id` with
         `{"discount":20260707}` was accepted and persisted — an eight-digit
         date (2026-07-07) landing in a percentage field, which through the
         cap-table engine's × (1 − d) prices a $1.00 round at −$202,606.07 a
         share. This is a live-observable value on `rnd_64e9d6ad728a`.

         THE RULE, IMPORTED AND NOT RESTATED (R21). The two functions above are
         the SAME ones the other two routes call. Nothing about the rule is
         re-typed here, so the three writers cannot drift:
           · discount      — PERCENT-AS-WRITTEN (R16/R30), range [0, 100).
           · interestRate  — PERCENT-AS-WRITTEN, range [0, 100].
           · REFUSED BY NAME with HTTP 400 and the field's own error code
             (`invalid_discount` / `invalid_interestRate`) plus a sentence that
             says what the field means. Never clamped, never rescaled: R16
             forbids reading a unit off a magnitude, and guessing whether
             `20260707` meant 20% or 2,000,000% is the defect itself.
           · THE MARKET NORM (10–20%) IS WARNED, NEVER BLOCKED (R30.5). A legal
             but unusual figure is stored EXACTLY as written and the reason is
             returned in `termWarnings`. A warning that blocks is a block.

         ABSENT IS UNTOUCHED, AND THAT IS LOAD-BEARING HERE. This is a PATCH
         over an open-ended field bag: most calls to it carry neither key. Both
         validators return `{ ok: true, percent: "" }` for `null` / `undefined` /
         `""`, and nothing below writes a value the caller did not send — a
         missing field is never reset to zero. A 0% discount and NO discount are
         different facts about a contract.

         THE STORED VALUE IS NOT REWRITTEN BY VALIDATION. Unlike
         `PATCH /api/rounds/:id/terms`, which assigns `Number(dv.percent)`, this
         route leaves `patch` alone and lets `updateRound` persist what the
         caller sent. Validation here decides ACCEPT or REFUSE and nothing else,
         so no value is silently restated on its way through. */
      const termWarnings: string[] = [];
      {
        const dv = validateDiscountPercentAsWritten((patch as Record<string, unknown>).discount);
        if (!dv.ok) {
          return res.status(400).json({ ok: false, error: dv.error, message: dv.message });
        }
        if (dv.warning) termWarnings.push(dv.warning);
        const iv = validateInterestRatePercentAsWritten((patch as Record<string, unknown>).interestRate);
        if (!iv.ok) {
          return res.status(400).json({ ok: false, error: iv.error, message: iv.message });
        }
        if (iv.warning) termWarnings.push(iv.warning);
      }
      /* ════════════════════════════════════════════════════════════════
         WAVE 61b · R50 — WRITER 3 OF 4, AND IT WAS NOT IN THE BRIEF.
         ════════════════════════════════════════════════════════════════
         R50 names TWO writers — the edit-terms PATCH and the create route. Wave
         58f had already proved there are THREE, for exactly these fields' two
         percent siblings, and the block above is its fix. The same argument
         applies verbatim to the five R50 fields: `updateRound`'s
         `UPDATE_EXTRAS_WHITELIST` contains `valuationCap`, `maturityMonths`,
         `strikePrice` and `expiryYears`, and `UPDATE_WHITELIST` contains
         `fdPreMoneyShares`. Before this block, this route validated NONE of
         them — not even for NaN or a negative, which the other two writers had
         rejected since v23.7. It was the loosest of the three.

         The rule is IMPORTED, never restated (R21). ABSENT IS UNTOUCHED, which
         is load-bearing here: this is a sparse PATCH over an open field bag and
         most calls carry none of these keys. The stored value is NOT rewritten
         by validation — `patch` is passed to `updateRound` untouched, exactly as
         the percent block above does, so nothing is silently restated. */
      {
        for (const [key, validate] of R50_BOUNDED_TERMS) {
          const v = validate((patch as Record<string, unknown>)[key]);
          if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, message: v.message });
          }
        }
      }
      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 77 · R71 — WRITER 3 OF 3. THE BYPASS WAVE 76 MEASURED, CLOSED.
         ═══════════════════════════════════════════════════════════════════════
         `maturityDate` is on `UPDATE_EXTRAS_WHITELIST`, this handler destructures
         `{ expectedVersion, ...patch }` and hands every key to `updateRound`, and
         it applied NO date validation at all — so a founder could store a maturity
         in the past by editing, after creation had refused exactly that value
         (`build_log/wave76/W76_FIELD_DISPOSITION.md` §1.4). R71 makes the absolute
         date derived from `maturityMonths`, so it is refused BY NAME here, with the
         imported sentence, exactly as at the other two writers. ABSENT IS
         UNTOUCHED: a patch that does not mention the key is unaffected, and a
         round that already stores a legacy date keeps it and keeps displaying it. */
      if ((patch as Record<string, unknown>)["maturityDate"] !== undefined) {
        return res.status(400).json({ ok: false, ...MATURITY_DATE_NOT_WRITABLE });
      }
      /* WAVE 76 · R60 / D5 — the two CLOSED vocabularies, refused by name on this
         writer for the first time. The list, the codes and the sentences are the
         imported ones (declared at `W76_CLOSED_VOCABULARY_TERMS` above, which
         records the measured transcript of what this handler used to accept). */
      {
        for (const [key, validate] of W76_CLOSED_VOCABULARY_TERMS) {
          const v = validate((patch as Record<string, unknown>)[key]);
          if (!v.ok) {
            return res.status(400).json({ ok: false, error: v.error, field: key, message: v.message });
          }
        }
      }
      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 81 · ITEM 2 (D4) — WRITER 2 OF 2. THE FENCE ARRIVES WITH THE KEY.
         ═══════════════════════════════════════════════════════════════════════
         `seniority` joined `roundsStore.UPDATE_EXTRAS_WHITELIST` in this wave so
         that `PATCH /api/rounds/:id/terms` could stop discarding it. This handler
         destructures `{ expectedVersion, ...patch }` and hands EVERY remaining key
         to `updateRound`, so without this block the same edit would have turned
         this route into an UNVALIDATED writer for a term that decides the order in
         which classes are paid at an exit — `{"seniority": 3.5}` or
         `{"seniority": 500}` accepted and stored, and then read back as `null` by
         `roundStoredTerms` so the waterfall refuses with the value sitting on the
         row. That is precisely the shape Wave 76 measured on this route for
         `antiDilutionType`, and the reason the whitelist entry and the fence ship
         together rather than one wave apart.

         SAME IMPORTED SENTENCE, SAME CODE, SAME DOMAIN as writer 1. ABSENT IS
         UNTOUCHED: a patch that does not mention the key is unaffected, and
         `null` still reaches `updateRound` as an explicit removal. */
      {
        const sv = validateSeniorityRankStored((patch as Record<string, unknown>)["seniority"]);
        if (!sv.ok) {
          return res.status(400).json({ ok: false, error: sv.error, field: "seniority", message: sv.message });
        }
      }
      /* ═══════════════════════════════════════════════════════════════
         WAVE 94 · ITEM 1 (R83.2) — WRITER 3 OF 3: THE PARTICIPATION CAP.
         ═══════════════════════════════════════════════════════════════
         `capParticipation` joined `roundsStore.UPDATE_EXTRAS_WHITELIST` in this
         same wave, and this handler hands every patch key straight to
         `updateRound` — so without this fence the key would have become writable
         here, unvalidated, in the same commit that made it reach the sacred
         engine's payout clamp. That is the precise shape Wave 76 measured on this
         route for `antiDilutionType`, and the reason the whitelist entry and the
         fence ship together rather than one wave apart.

         SAME IMPORTED SENTENCE, SAME CODE, SAME DOMAIN as writers 1 and 2. ABSENT
         IS UNTOUCHED: a patch that does not mention the key is unaffected, and
         `null` still reaches `updateRound` as an explicit removal, which means the
         class is UNCAPPED. */
      {
        const cv = validateParticipationCapStored((patch as Record<string, unknown>)["capParticipation"]);
        if (!cv.ok) {
          return res.status(400).json({ ok: false, error: cv.error, field: "capParticipation", message: cv.message });
        }
      }
      /* ══════════════════════════════════════════════════════════════════════
         WAVE 68 · R56 — WRITER 3 OF 3. THE DATE-SHAPED WARNING.
         ══════════════════════════════════════════════════════════════════════
         This is the LOOSEST of the four R50 writers (Wave 61b §3) and it is the
         route the corrupt date came in on (Wave 58f). The value is ACCEPTED and
         persisted exactly as sent — R56 warns, it does not block, and this is
         explicitly NOT R42. The sentence is imported, not restated, so all three
         writers say the same thing.

         WRITER 4 (`POST /api/founder/rounds/:roundId/carry-forward/accept`) is
         deliberately NOT given this warning: its patch is filtered to
         `UPDATE_ROUND_WHITELIST_KEYS`, so the only R50 field it can persist is
         `fdPreMoneyShares` — a SHARE COUNT, which R56 does not cover (money
         fields only) and which no bound or shape test can protect (R50's own
         note). Recorded rather than silently skipped. */
      for (const _k of ["valuationCap", "strikePrice"] as const) {
        const _w = dateShapedValueWarning(_k, (patch as Record<string, unknown>)[_k]);
        if (_w) termWarnings.push(_w);
      }

      const result = updateRound(String(id), patch, {
        actor: owned.actor,
        expectedVersion: typeof expectedVersion === "string" ? expectedVersion : undefined,
        withinUpdateTx: enforceOneOpen
          ? () => {
              const conflicts = listActiveLivePricedRounds(String(current?.companyId ?? ""), String(id));
              if (conflicts.length > 0) {
                throw new OneOpenRoundConflictError(conflicts.map((c) => c.id));
              }
            }
          : undefined,
      });
      if (!result.ok) {
        if (result.error === "ONE_OPEN_ROUND_CONFLICT") {
          return res.status(409).json({
            ok: false,
            error: "ANOTHER_ROUND_ALREADY_OPEN",
            message:
              "This company already has an open funding round. Close it before opening another. " +
              "(Warrant and ESOP/option-pool rounds are exempt and may coexist.)",
            openRoundId: result.conflicts?.[0],
            openRoundIds: result.conflicts ?? [],
          });
        }
        const status =
          result.error === "UNKNOWN_FIELD" ? 400
          : result.error === "VERSION_CONFLICT" ? 409
          : result.error === "NO_CHANGES" ? 400
          : result.error === "ROUND_NOT_FOUND" ? 404
          : 500;
        return res.status(status).json({
          ok: false,
          error: result.error,
          rejectedKey: result.rejectedKey,
        });
      }
      /* WAVE 58f · F1 — warnings travel WITH the success, and only when there
         are any: the key is omitted entirely on a clean save so no existing
         caller sees a new empty array. Same shape as the other two writers. */
      return res.status(200).json({
        ok: true,
        round: result.round,
        ...(termWarnings.length > 0 ? { termWarnings } : {}),
      });
    },
  );

  /**
   * v25.48.2 Q13 — GET /api/founder/rounds/:id/pending-commitments
   *
   * Read-only preview that drives the founder close warning. Returns the count
   * (and details) of un-confirmed / open soft-circle commitments that a close
   * would lapse. Confirmed/wired/committed commitments are NOT included.
   */
  app.get(
    "/api/founder/rounds/:id/pending-commitments",
    requireAuth,
    (req: Request, res: Response) => {
      const { id } = req.params;
      const owned = assertRoundOwnership(req, res, String(id));
      if (!owned) return;
      // v25.48.2 MF6 — FAIL-CLOSED: a read error must NOT return a false zero
      // (which would suppress the founder warning and let a close proceed
      // blindly). Surface a 503 degraded error that BLOCKS confirmation.
      try {
        const pending = listPendingCommitments(String(id));
        return res.status(200).json({ ok: true, ...pending });
      } catch (err) {
        return res.status(503).json({
          ok: false,
          error: "PENDING_LOOKUP_FAILED",
          degraded: true,
          message: "Unable to determine pending commitments right now. Please retry before closing.",
        });
      }
    },
  );

  /**
   * POST /api/founder/rounds/:id/close
   * Body: { reason: string, finalAmount?: number, finalCurrency?: string,
   *         finalState?: "closed" | "closed_funded" | "closed_aborted",
   *         lapsePending?: boolean }
   *
   * v25.48.2 Q13 — a founder may initiate the close from ANY non-terminal state
   * (closeRound itself only refuses already-terminal rounds). When
   * `lapsePending` is true (the client sends it after the founder confirms the
   * "N pending commitments will be lapsed" warning), every un-confirmed
   * soft-circle is marked `lapsed` with audit AFTER the round is durably closed.
   * Confirmed/wired/committed commitments are preserved.
   */
  app.post(
    "/api/founder/rounds/:id/close",
    requireAuth,
    (req: Request, res: Response) => {
      const { id } = req.params;
      const owned = assertRoundOwnership(req, res, String(id));
      if (!owned) return;
      const body = (req.body ?? {}) as {
        reason?: string;
        finalAmount?: number;
        finalCurrency?: string;
        finalState?: "closed" | "closed_funded" | "closed_aborted";
        lapsePending?: boolean;
      };
      const reason = typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "manual_close";

      /* v25.48.2 MF5 — the pending-commitment lapse MUST be ATOMIC with the
         close. We pass the lapse as an in-transaction hook to closeRound so both
         the terminal round-state UPDATE and the lapse (+ its audit, MF6) commit
         or roll back together. If the lapse or its audit fails, the whole close
         rolls back: the round stays NON-terminal and we return 500. */
      let lapsedItems: PendingCommitment[] = [];
      const wantLapse = body.lapsePending === true;
      const result = closeRound(String(id), {
        actor: owned.actor,
        reason,
        finalAmountMinor: typeof body.finalAmount === "number" ? body.finalAmount : undefined,
        finalCurrency: typeof body.finalCurrency === "string" ? body.finalCurrency : undefined,
        finalState: body.finalState,
        withinCloseTx: wantLapse
          ? () => {
              const lapse = lapsePendingWithinTx(String(id), { actorUserId: owned.actor, reason });
              lapsedItems = lapse.items;
            }
          : undefined,
      });
      if (!result.ok) {
        const status = result.error === "ROUND_NOT_FOUND" ? 404 : 500;
        return res.status(status).json({ ok: false, error: result.error });
      }

      /* Post-commit SSE for lapsed rows (only after the close tx committed). */
      if (lapsedItems.length > 0) emitLapsedMutations(lapsedItems);

      /* WAVE 17 ORP-044 — AUTO-TRIGGER `round_closed`.
         WHY HERE. `closeRound` (server/roundsStore.ts:872) is the durable sink
         and this route is its ONLY caller tree-wide (verified by grep), so this
         is the manual close path end to end. It runs POST-COMMIT, after
         `result.ok`, and is skipped when `alreadyClosed` — a repeated close must
         not re-notify the cap table. It cannot throw (fireAutoBroadcast never
         does), so a broadcast failure can never turn a committed close into a
         500. The SECOND close path (the sweeper / cascade) is wired separately
         in server/lib/roundCloseCascade.ts — see notifyCascadeSideEffects. */
      if (!result.alreadyClosed) {
        fireAutoBroadcast({
          companyId: String(result.round?.companyId ?? ""),
          actorUserId: owned.actor,
          trigger: "round_closed",
          body: roundClosedBody({
            roundName: result.round?.name ?? null,
            finalState: result.round?.state ?? null,
            /* Integer MINOR units straight from the request the closer supplied;
               omitted entirely when absent, never defaulted to zero. */
            finalAmountMinor: typeof body.finalAmount === "number" ? body.finalAmount : null,
            currency:
              (typeof body.finalCurrency === "string" ? body.finalCurrency : null) ??
              result.round?.currency ??
              null,
          }),
          dedupeKey: roundClosedKey(String(id)),
        });
      }

      return res.status(200).json({
        ok: true,
        round: result.round,
        alreadyClosed: result.alreadyClosed ?? false,
        frozenChainHead: result.frozenChainHead ?? null,
        lapsedCommitments: lapsedItems.length,
      });
    },
  );
}
