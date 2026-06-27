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
import { getRoundById, updateRound, closeRound, UPDATE_ROUND_WHITELIST_KEYS } from "./roundsStore"; /* v25.17 Lane A NH7 — verify round↔company binding; v25.20 Lane 4 — persist accepted fields onto the round */
/* v25.17 Lane A NH8 — computeCarryForwardLive is already imported from
   roundCarryForwardEngine below and reused for server-side digest recompute. */
import { companies } from "./mockData";
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
      // Newly created companies are not in the static seed `companies` array.
      // Return 200 + empty-but-valid result shape (NOT null) so the client's
      // `Object.keys(result.fields)` reducer keeps working. v23.4.13 follow-up
      // (L-012 fix): use the full CarryForwardResult shape instead of null to
      // avoid "Cannot convert undefined or null to object" on the wizard.
      const company = companies.find((c) => c.id === companyId);

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
      const result = updateRound(String(id), patch, {
        actor: owned.actor,
        expectedVersion: typeof expectedVersion === "string" ? expectedVersion : undefined,
      });
      if (!result.ok) {
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
      return res.status(200).json({ ok: true, round: result.round });
    },
  );

  /**
   * POST /api/founder/rounds/:id/close
   * Body: { reason: string, finalAmount?: number, finalCurrency?: string,
   *         finalState?: "closed" | "closed_funded" | "closed_aborted" }
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
      };
      const reason = typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "manual_close";
      const result = closeRound(String(id), {
        actor: owned.actor,
        reason,
        finalAmountMinor: typeof body.finalAmount === "number" ? body.finalAmount : undefined,
        finalCurrency: typeof body.finalCurrency === "string" ? body.finalCurrency : undefined,
        finalState: body.finalState,
      });
      if (!result.ok) {
        const status = result.error === "ROUND_NOT_FOUND" ? 404 : 500;
        return res.status(status).json({ ok: false, error: result.error });
      }
      return res.status(200).json({
        ok: true,
        round: result.round,
        alreadyClosed: result.alreadyClosed ?? false,
        frozenChainHead: result.frozenChainHead ?? null,
      });
    },
  );
}
