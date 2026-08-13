/**
 * WAVE 1A / S-2 — Fee settlement authority.
 * WAVE 3E — the authority moved from PROCESS MEMORY onto DURABLE DB RECORDS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT WAVE 1A CLOSED (unchanged, and it MUST NOT REGRESS)
 * ═══════════════════════════════════════════════════════════════════════════
 * Before WAVE 1A, a Consortium Partner could name the outcome of their own
 * platform-fee charge. The chain was:
 *
 *   spvEngineRoutes.ts:256   `const outcome = (req.body ?? {}).outcome === "failed" ? … : "succeeded"`
 *   spvEngineStore.ts:721    `outcome: "succeeded" | "failed" = "succeeded"`   (DEFAULT PARAMETER)
 *   spvEngineStore.ts:738    `forceState: outcome`                             (THE DERIVATION SITE)
 *   spvEngineStore.ts:747    `entryState !== "succeeded" && entryState !== "demo"`  ("demo" == success)
 *   spvEngineStore.ts:752    `o.state = "paid"`                                (THE ONLY ASSIGNMENT)
 *
 * …plus the same terminus reached from the distribution route via
 * `spvEngineStore.ts:1456` (`data.collectionOutcome`) → `_collectCarryObligation:793`.
 *
 * A `paid` fixed-fee obligation clears `hasUnsettledFixedFees`, which is the
 * fail-closed gate on subscription commit / deployment / CAP-TABLE LEDGER
 * COMMIT. Self-marking was a free-money path into a real cap table.
 *
 * THE MECHANISM (unchanged in kind): a settlement outcome is an UNFORGEABLE
 * CAPABILITY, not a value. `chargeFeeObligation` accepts no outcome from
 * anyone; it accepts a `FeeSettlementAuthorization`. There are exactly TWO
 * mints — `authorizeGatewaySettlement` (partner-reachable, throws
 * `PAYMENT_GATEWAY_UNAVAILABLE` until a gateway is wired) and
 * `authorizePlatformAdminSettlement` (Capavate platform admin only).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAVE 3E CHANGES — STORAGE, NOT THE SECURITY MODEL
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner ruling, verbatim: **"All db-driven. No in-memory anywhere."**
 *
 * The pre-3E implementation held the authority in process memory:
 *
 *   :73  const BRAND    = Symbol("capavate.feeSettlementAuthorization");
 *   :77  const ISSUED   = new WeakSet<object>();            // issue registry
 *   :81  const CONSUMED = new WeakMap<object, string[]>();  // replay counter
 *   :122 consumeSettlementAuthorization()                   // read-then-write
 *
 * Three consequences, all of them real defects:
 *   1. An authorization did not survive a process restart. Restart mid-flow and
 *      the capability simply vanished (a liveness failure).
 *   2. On multiple processes, process B could not see that process A had already
 *      spent an authorization. REPLAY PROTECTION DID NOT HOLD ACROSS PROCESSES
 *      (a security failure).
 *   3. `CONSUMED.get(...)` followed by `CONSUMED.set(...)` is a read-then-write,
 *      and it was not atomic with the money write it guarded.
 *
 * WAVE 3E moves the authority to `fee_settlement_authorization`
 * (migration 0151). The rules are:
 *
 *   • **The DB ROW is the authority.** Consumption is a single CONDITIONAL
 *     UPDATE carrying every precondition in its WHERE clause, and the caller
 *     asserts the AFFECTED-ROW COUNT is exactly 1. There is no read-then-write
 *     anywhere on this path.
 *   • **Consumption is ATOMIC WITH THE MONEY WRITE.** `consumeSettlementAuthorization`
 *     refuses to run outside a transaction (`SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL`).
 *     `spvEngineStore.chargeFeeObligation` wraps consume + charge + obligation
 *     write in ONE `withSettlementTransaction`, so a crash between them rolls
 *     BOTH back. An authorization can never be spent with no settlement, nor a
 *     settlement recorded against an unspent authorization.
 *   • **Replay protection comes from the row, not a WeakMap.** A second consume
 *     of the same authorization affects zero rows — from any process, after any
 *     restart. The per-use ledger `fee_settlement_authorization_use` additionally
 *     makes (authorization, obligation) unique, which is the durable successor to
 *     the WeakMap's per-obligation dedup list.
 *   • **The Symbol brand is KEPT, as DEFENCE IN DEPTH ONLY.** It costs nothing
 *     and it is what makes a `req.body`-derived object structurally impossible
 *     to pass. BOTH the brand check AND the DB conditional UPDATE must pass.
 *     Neither alone is sufficient, and the DB is never overridden by the brand.
 *     **The brand is never the authority; it is a second lock on the same door.**
 *   • **FAIL CLOSED EVERYWHERE.** Missing row, expired row, revoked row,
 *     exhausted row, scope mismatch, unreachable database, or a MISSING TABLE:
 *     every one of these REJECTS. There is no path on which the absence of a
 *     record means "allow".
 *
 * WHY THE SCHEMA IS BOOTSTRAPPED HERE
 * -----------------------------------
 * The project convention is that a table exists in three places: canonical
 * `migrations/NNNN.sql`, the byte-identical `server/db/migrations/` mirror, and
 * an idempotent inline bootstrap so the `:memory:` test path has the table.
 * The third place is normally `applyInlineMigrations()` in
 * `server/db/connection.ts` — which is SACRED and must not be edited by this
 * wave. The bootstrap therefore lives here, in the module that owns the table,
 * and executes the CANONICAL MIGRATION TEXT VERBATIM (`FEE_SETTLEMENT_AUTHORITY_SQL`
 * is a byte-for-byte copy of migrations/0151_wave3e_fee_settlement_authorization.sql;
 * a test asserts the equality so the two cannot drift). The bootstrap creates
 * EMPTY tables and seeds nothing — so bootstrapping can never manufacture an
 * authorization, and a fresh database still settles nothing.
 */
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { getUserContext } from "./userContext";
import { rawDb, getDbDriver } from "../db/connection";
import { log, errorMeta } from "./logger"; /* WAVE 2B / MAJOR 1 — deny-and-log on lookup failure */
import { FEE_SETTLEMENT_AUTHORITY_SQL } from "./feeSettlementAuthoritySchema";

export { FEE_SETTLEMENT_AUTHORITY_SQL };

/** The Capavate platform-admin tenant. Seeded at seedDemoData.ts:107. */
export const PLATFORM_ADMIN_TENANT_ID = "tenant_admin_capavate";

/** The durable authority table. Named once, used everywhere. */
export const SETTLEMENT_AUTHORIZATION_TABLE = "fee_settlement_authorization";
export const SETTLEMENT_AUTHORIZATION_USE_TABLE = "fee_settlement_authorization_use";

/** How long a minted authorization stays usable. An authorization is a
 *  short-lived capability, not a bearer token: a handle that leaks, or a flow
 *  abandoned halfway, stops being useful. 15 minutes comfortably covers a
 *  gateway round-trip and an admin request, and is far shorter than the window
 *  in which an operator would notice a mis-issued authorization. */
export const SETTLEMENT_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

/** What a settlement authorization is allowed to settle. */
export type SettlementPurpose = "fee_obligation" | "distribution_carry";

/** How the outcome was established. Never supplied by a caller. */
export type SettlementSource = "gateway" | "platform_admin" | "test";

/** The outcome vocabulary the ledger will accept. Note that "demo" is NOT here:
 *  spvEngineStore.ts no longer treats a demo ledger entry as a settlement. */
export type SettlementOutcome = "succeeded" | "failed";

/* ── canonical error codes (all of them REJECT; none of them mean "allow") ── */
export const E_REQUIRED = "SETTLEMENT_AUTHORIZATION_REQUIRED";
export const E_SCOPE = "SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH";
export const E_REPLAYED = "SETTLEMENT_AUTHORIZATION_REPLAYED";
export const E_EXPIRED = "SETTLEMENT_AUTHORIZATION_EXPIRED";
export const E_REVOKED = "SETTLEMENT_AUTHORIZATION_REVOKED";
export const E_NOT_TX = "SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL";
export const E_UNAVAILABLE = "SETTLEMENT_AUTHORITY_UNAVAILABLE";

/**
 * DEFENCE IN DEPTH, LAYER 2 — the in-process brand.
 *
 * This is deliberately NOT the authority (WAVE 3E). It is a module-private
 * `Symbol` plus a module-private `WeakSet`, exactly as WAVE 1A shipped it, kept
 * because it costs nothing and because it is the layer that makes a plain
 * object deserialised from `req.body` — however shaped, however cast with `as`
 * — structurally impossible to pass. It is checked BEFORE the database and the
 * database is checked ANYWAY. Removing the brand would still leave the DB
 * conditional UPDATE in force; removing the DB check would NOT be acceptable.
 */
const BRAND: unique symbol = Symbol("capavate.feeSettlementAuthorization");
const ISSUED = new WeakSet<object>();

export interface FeeSettlementAuthorization {
  readonly [BRAND]: true;
  /** WAVE 3E — the primary key of the DURABLE row that is the real authority.
   *  Everything below this line is a convenience projection of that row and is
   *  re-verified against it, in the database, on every consume. */
  readonly id: string;
  readonly source: SettlementSource;
  readonly purpose: SettlementPurpose;
  readonly spvId: string;
  /** Bound obligation id, when known at mint time (`fee_obligation` purpose).
   *  `null` for `distribution_carry`, whose obligation ids are minted inside
   *  `_collectCarryObligation`. */
  readonly obligationId: string | null;
  /** The exact amount authorized, when pinned at mint time. `null` for carry
   *  legs, whose amounts the waterfall computes. */
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly outcome: SettlementOutcome;
  /** How many distinct obligations this authorization may settle. `1` for a
   *  named fee obligation; `2` for a distribution's carry legs. */
  readonly maxUses: number;
  /** Who or what established the outcome. Persisted in the audit trail. */
  readonly actorId: string;
  readonly reason: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/* ═════════════════════════════ the database ══════════════════════════════ */

let _schemaReady = false;

/** Reset the bootstrap latch. Test-only; the DB itself is untouched. */
export function __resetSchemaLatchForTest(): void {
  if (process.env.NODE_ENV !== "test") return;
  _schemaReady = false;
}

/**
 * Return the raw SQLite handle, bootstrapping the authority schema if absent.
 *
 * FAIL CLOSED. Every failure mode here THROWS `SETTLEMENT_AUTHORITY_UNAVAILABLE`:
 *   - a Postgres backend (`rawDb()` throws unconditionally under Postgres,
 *     server/db/connection.ts:167-173);
 *   - a database that cannot be opened;
 *   - a bootstrap that cannot create the tables.
 * A caller that cannot reach the authority MUST NOT settle. The absence of a
 * table is not permission.
 */
function authorityDb(): { prepare: (sql: string) => any; exec: (sql: string) => unknown; transaction: (fn: () => unknown) => () => unknown; inTransaction: boolean } {
  if (getDbDriver() === "postgres") {
    // Not a silent degradation: refuse to settle rather than settle unguarded.
    throw new Error(E_UNAVAILABLE);
  }
  let db: any;
  try {
    db = rawDb();
  } catch (e) {
    log.error(errorMeta("feeSettlement.authorityDb.unavailable", e, {}));
    throw new Error(E_UNAVAILABLE);
  }
  if (!db) throw new Error(E_UNAVAILABLE);
  if (!_schemaReady) {
    try {
      const present = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(SETTLEMENT_AUTHORIZATION_TABLE) as { name?: string } | undefined;
      if (!present) {
        // The canonical migration text, verbatim. Creates EMPTY tables and
        // seeds nothing — a bootstrap can never manufacture authority.
        db.exec(FEE_SETTLEMENT_AUTHORITY_SQL);
      }
      _schemaReady = true;
    } catch (e) {
      log.error(errorMeta("feeSettlement.authorityDb.bootstrapFailed", e, {}));
      throw new Error(E_UNAVAILABLE);
    }
  }
  return db;
}

/**
 * Run `fn` inside ONE database transaction.
 *
 * WAVE 3E — this is how consumption becomes atomic with the money write. The
 * consume UPDATE and every write the caller performs commit together or not at
 * all. better-sqlite3 nests via SAVEPOINT, so wrapping an already-transactional
 * caller is safe.
 */
export function withSettlementTransaction<T>(fn: () => T): T {
  const db = authorityDb();
  return db.transaction(fn as () => unknown)() as T;
}

/** True while a settlement transaction is open. Exported for assertions. */
export function inSettlementTransaction(): boolean {
  try {
    return authorityDb().inTransaction === true;
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ═══════════════════════════════ minting ═════════════════════════════════ */

interface MintInput {
  source: SettlementSource;
  purpose: SettlementPurpose;
  spvId: string;
  obligationId: string | null;
  amountMinor: number | null;
  currency: string | null;
  outcome: SettlementOutcome;
  maxUses: number;
  actorId: string;
  reason: string;
}

/**
 * Look up the exact amount this obligation represents, from the DURABLE
 * obligation row, so the authorization can be pinned to it.
 *
 * This is the "which amount" half of the scope. Returning `null` (row absent —
 * the carry case, whose obligation is minted later inside
 * `_collectCarryObligation`) leaves the amount unpinned, which is strictly the
 * pre-3E behaviour and never widens anything: purpose, SPV and obligation
 * binding are still enforced.
 */
function pinnedAmountFor(db: any, obligationId: string | null): { amountMinor: number | null; currency: string | null } {
  if (!obligationId) return { amountMinor: null, currency: null };
  try {
    const row = db
      .prepare(`SELECT amount_minor, currency FROM spv_fee_obligation WHERE id = ?`)
      .get(obligationId) as { amount_minor?: number; currency?: string } | undefined;
    if (!row || typeof row.amount_minor !== "number") return { amountMinor: null, currency: null };
    return { amountMinor: row.amount_minor, currency: typeof row.currency === "string" ? row.currency : null };
  } catch {
    // Not fatal and not a widening: the consume still enforces purpose + SPV +
    // obligation binding + single use.
    return { amountMinor: null, currency: null };
  }
}

/**
 * Write the durable authorization row, then hand back a branded handle to it.
 *
 * THE ROW IS WRITTEN FIRST AND IS THE AUTHORITY. If the insert fails, no
 * capability exists — the throw propagates and nothing is minted.
 */
function mint(a: MintInput): FeeSettlementAuthorization {
  const db = authorityDb();
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.parse(issuedAt) + SETTLEMENT_AUTHORIZATION_TTL_MS).toISOString();
  const id = `fsa_${randomUUID().replace(/-/g, "")}`;
  const pinned = a.amountMinor !== null ? { amountMinor: a.amountMinor, currency: a.currency } : pinnedAmountFor(db, a.obligationId);

  try {
    db.prepare(
      `INSERT INTO ${SETTLEMENT_AUTHORIZATION_TABLE}
         (id, purpose, spv_id, obligation_id, amount_minor, currency, outcome, source,
          issued_by, issued_at, reason, expires_at, uses_max, uses_consumed, consumed_at, revoked_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,NULL)`,
    ).run(
      id, a.purpose, a.spvId, a.obligationId, pinned.amountMinor, pinned.currency,
      a.outcome, a.source, a.actorId, issuedAt, a.reason, expiresAt, a.maxUses,
    );
  } catch (e) {
    log.error(errorMeta("feeSettlement.mint.persistFailed", e, { purpose: a.purpose, spvId: a.spvId }));
    throw new Error(E_UNAVAILABLE);
  }

  const auth = Object.freeze({
    [BRAND]: true as const,
    id,
    source: a.source,
    purpose: a.purpose,
    spvId: a.spvId,
    obligationId: a.obligationId,
    amountMinor: pinned.amountMinor,
    currency: pinned.currency,
    outcome: a.outcome,
    maxUses: a.maxUses,
    actorId: a.actorId,
    reason: a.reason,
    issuedAt,
    expiresAt,
  });
  ISSUED.add(auth);
  return auth;
}

/** True only for an object this PROCESS minted or rehydrated from the durable
 *  row. This is DEFENCE IN DEPTH ONLY (layer 2) — it is never sufficient on its
 *  own, and `consumeSettlementAuthorization` checks the database regardless. */
export function isFeeSettlementAuthorization(v: unknown): v is FeeSettlementAuthorization {
  return typeof v === "object" && v !== null && ISSUED.has(v as object);
}

/**
 * WAVE 3E — rebuild an in-process handle from the DURABLE row.
 *
 * This is what makes the authority survive a restart and work across processes:
 * a second process (or the same process after a restart) resolves the
 * authorization BY ID FROM THE DATABASE and gets a branded handle back.
 *
 * IT GRANTS NOTHING THE ROW DOES NOT ALREADY GRANT. It rejects a missing,
 * consumed, expired or revoked row, and the consume that follows re-checks every
 * precondition atomically anyway — rehydration is a lookup, not a decision.
 * Rows are only ever created by the two mints, so authority still originates
 * exclusively there.
 *
 * NOT ROUTE-REACHABLE. It is not imported by any route module; a test asserts
 * that. It is deliberately not an escape hatch for a caller who has an id and
 * no capability — the ids are unguessable v4 UUIDs and the function exists for
 * process-boundary rehydration, not for authorization.
 */
export function rehydrateSettlementAuthorization(id: unknown): FeeSettlementAuthorization {
  if (typeof id !== "string" || !id) throw new Error(E_REQUIRED);
  const db = authorityDb();
  let row: any;
  try {
    row = db.prepare(`SELECT * FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = ?`).get(id);
  } catch (e) {
    log.error(errorMeta("feeSettlement.rehydrate.readFailed", e, { id }));
    throw new Error(E_UNAVAILABLE);
  }
  if (!row) throw new Error(E_REQUIRED);
  if (row.revoked_at) throw new Error(E_REVOKED);
  if (Number(row.uses_consumed) >= Number(row.uses_max)) throw new Error(E_REPLAYED);
  if (String(row.expires_at) <= nowIso()) throw new Error(E_EXPIRED);

  const auth = Object.freeze({
    [BRAND]: true as const,
    id: String(row.id),
    source: String(row.source) as SettlementSource,
    purpose: String(row.purpose) as SettlementPurpose,
    spvId: String(row.spv_id),
    obligationId: row.obligation_id === null || row.obligation_id === undefined ? null : String(row.obligation_id),
    amountMinor: row.amount_minor === null || row.amount_minor === undefined ? null : Number(row.amount_minor),
    currency: row.currency === null || row.currency === undefined ? null : String(row.currency),
    outcome: String(row.outcome) as SettlementOutcome,
    maxUses: Number(row.uses_max),
    actorId: String(row.issued_by),
    reason: String(row.reason),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
  });
  ISSUED.add(auth);
  return auth;
}

/* ══════════════════════════════ consuming ════════════════════════════════ */

/**
 * Classify a zero-row consume. DIAGNOSTIC ONLY — it runs AFTER the conditional
 * UPDATE has already refused, and it can only ever choose which rejection error
 * to throw. It never allows anything.
 */
function classifyRefusal(db: any, id: string, expect: { purpose: SettlementPurpose; spvId: string; obligationId?: string; amountMinor?: number }): never {
  let row: any;
  try {
    row = db.prepare(`SELECT * FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = ?`).get(id);
  } catch {
    throw new Error(E_UNAVAILABLE);
  }
  if (!row) throw new Error(E_REQUIRED);
  if (row.revoked_at) throw new Error(E_REVOKED);
  if (String(row.purpose) !== expect.purpose) throw new Error(E_SCOPE);
  if (String(row.spv_id) !== expect.spvId) throw new Error(E_SCOPE);
  if (row.obligation_id !== null && row.obligation_id !== undefined && expect.obligationId !== undefined && String(row.obligation_id) !== expect.obligationId) {
    throw new Error(E_SCOPE);
  }
  if (row.amount_minor !== null && row.amount_minor !== undefined && expect.amountMinor !== undefined && Number(row.amount_minor) !== expect.amountMinor) {
    throw new Error(E_SCOPE);
  }
  if (Number(row.uses_consumed) >= Number(row.uses_max)) throw new Error(E_REPLAYED);
  if (String(row.expires_at) <= nowIso()) throw new Error(E_EXPIRED);
  // Nothing explains the refusal. Fail closed on the strictest code.
  throw new Error(E_REQUIRED);
}

/**
 * Resolve the outcome, ONCE, verifying provenance, scope and single use —
 * AGAINST THE DURABLE ROW.
 *
 * Throws — never returns a default — on anything unauthorized. This is what
 * replaces the `= "succeeded"` default parameter at spvEngineStore.ts:721: the
 * absence of an authorization is an error, not a success.
 *
 * WAVE 3E ORDER OF OPERATIONS:
 *   1. LAYER 2 (defence in depth): the object must carry this module's brand.
 *      A `req.body`-derived object fails here and never reaches the database.
 *   2. It must be running inside a transaction, so that consumption and the
 *      money write commit together. Refusing outside one is what makes the
 *      atomicity contract enforceable rather than aspirational.
 *   3. LAYER 1 (the authority): ONE conditional UPDATE carrying every
 *      precondition — unconsumed, unrevoked, unexpired, right purpose, right
 *      SPV, right obligation, right amount — and the AFFECTED-ROW COUNT must be
 *      exactly 1. No read-then-write. Two racing consumers cannot both win.
 *   4. The per-use ledger insert. Its PRIMARY KEY (authorization_id,
 *      obligation_id) makes "the same authorization settles the same obligation
 *      twice" impossible even when uses_max > 1, and it is written in the same
 *      transaction, so it rolls back with everything else.
 */
export function consumeSettlementAuthorization(
  auth: unknown,
  expect: { purpose: SettlementPurpose; spvId: string; obligationId?: string; amountMinor?: number; currency?: string },
): { outcome: SettlementOutcome; source: SettlementSource; actorId: string; reason: string; authorizationId: string } {
  // ── LAYER 2 — the in-process brand. Defence in depth; never sufficient. ──
  if (!isFeeSettlementAuthorization(auth)) throw new Error(E_REQUIRED);

  const db = authorityDb();

  // ── The atomicity contract. Consumption is only meaningful when it commits
  //    together with the money write it authorizes. ──
  if (db.inTransaction !== true) throw new Error(E_NOT_TX);

  // The obligation key. Every use names a concrete obligation; the per-use
  // ledger's NOT NULL / <> '' CHECK means an anonymous use cannot be recorded.
  const obligationKey = expect.obligationId ?? auth.obligationId;
  if (!obligationKey) throw new Error(E_SCOPE);

  const now = nowIso();

  // ── LAYER 1 — THE AUTHORITY. One conditional UPDATE, affected-row count
  //    checked. Every precondition lives in the WHERE clause. ──
  let changes: number;
  try {
    const res = db.prepare(
      `UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE}
          SET uses_consumed = uses_consumed + 1,
              consumed_at   = CASE WHEN uses_consumed + 1 >= uses_max THEN ? ELSE consumed_at END
        WHERE id            = ?
          AND uses_consumed < uses_max
          AND revoked_at   IS NULL
          AND expires_at    > ?
          AND purpose       = ?
          AND spv_id        = ?
          AND (obligation_id IS NULL OR obligation_id = ?)
          AND (amount_minor  IS NULL OR ? IS NULL OR amount_minor = ?)
          AND (currency      IS NULL OR ? IS NULL OR currency     = ?)`,
    ).run(
      now,
      auth.id,
      now,
      expect.purpose,
      expect.spvId,
      obligationKey,
      expect.amountMinor ?? null, expect.amountMinor ?? null,
      expect.currency ?? null, expect.currency ?? null,
    );
    changes = Number(res?.changes ?? 0);
  } catch (e) {
    log.error(errorMeta("feeSettlement.consume.updateFailed", e, { id: auth.id }));
    throw new Error(E_UNAVAILABLE);
  }

  if (changes !== 1) {
    // Zero rows affected. Nothing was consumed; classify and REJECT.
    classifyRefusal(db, auth.id, { purpose: expect.purpose, spvId: expect.spvId, obligationId: obligationKey, amountMinor: expect.amountMinor });
  }

  // ── The per-use ledger. A duplicate (authorization, obligation) violates the
  //    PRIMARY KEY and throws — and because we are inside the caller's
  //    transaction, the UPDATE above rolls back with it. ──
  try {
    const useIndex = Number(
      (db.prepare(`SELECT uses_consumed AS n FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = ?`).get(auth.id) as { n: number }).n,
    );
    db.prepare(
      `INSERT INTO ${SETTLEMENT_AUTHORIZATION_USE_TABLE}
         (authorization_id, obligation_id, use_index, consumed_at, consumed_by)
       VALUES (?,?,?,?,?)`,
    ).run(auth.id, obligationKey, useIndex, now, auth.actorId || "unknown");
  } catch (e) {
    // A PRIMARY KEY collision here means this authorization already settled this
    // obligation. Fail closed; the transaction unwinds the UPDATE.
    log.error(errorMeta("feeSettlement.consume.useLedgerRejected", e, { id: auth.id, obligationKey }));
    throw new Error(E_REPLAYED);
  }

  return { outcome: auth.outcome, source: auth.source, actorId: auth.actorId, reason: auth.reason, authorizationId: auth.id };
}

/** Read-only projection of the durable row. Used by tests and diagnostics; it
 *  never grants anything. Returns `null` when the row does not exist. */
export function readSettlementAuthorizationRow(id: string): Record<string, unknown> | null {
  try {
    const row = authorityDb().prepare(`SELECT * FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = ?`).get(id);
    return (row as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/* ─────────────────────────── mint #1: the gateway ───────────────────────── */

/**
 * The real settlement path — the ONLY one a partner can reach.
 *
 * There is no payment gateway in this call graph. `paymentGatewayAdapter.ts` is
 * a SACRED file and is not wired to `chargeOrIdempotent`; `paymentStore.ts:127`
 * defaults `forceState` to `"demo"` and `:214` writes it straight through, which
 * is a demo seam, not a settlement. So this throws, unconditionally, today.
 *
 * It deliberately takes NO outcome argument. When a gateway lands (OQ-38), the
 * body of this function calls it, derives the outcome from its response and
 * mints a DURABLE row; no caller signature changes and no partner ever names an
 * outcome.
 */
export function authorizeGatewaySettlement(_req: {
  purpose: SettlementPurpose;
  spvId: string;
  obligationId?: string;
  amountMinor: number;
  currency: string;
  customerId: string;
}): FeeSettlementAuthorization {
  throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
}

/* ──────────────────── mint #2: the Capavate platform admin ──────────────── */

/**
 * The ONLY identities for which the missing-`users`-row escape hatch applies,
 * and only when `NODE_ENV === "test"`.
 *
 * WAVE 2B / MAJOR 1. Several in-tree suites (notably
 * server/__tests__/wave1a_s2_fee_self_mark.test.ts) mount routes on a bare
 * `express()` app without seeding `users`, so `ctx.userId` has no row to pin a
 * tenant against. Before WAVE 2B that case FELL OPEN for every admin persona,
 * in every environment. It is now an explicit, enumerated, test-only list —
 * not a fallback — so production has no path to settlement authority without a
 * real `tenant_admin_capavate` row.
 */
const TEST_ONLY_PLATFORM_ADMIN_IDS: ReadonlySet<string> = new Set([
  "u_admin",       // seedDemoData.ts:122 — tenant_admin_capavate in a seeded DB
  "u_admin_test",  // server/__tests__/_v14TestIdentity.ts default identity
]);

/**
 * True only for an authenticated Capavate PLATFORM admin.
 *
 * `ctx.isAdmin` is the platform-admin flag (`requirePartnerAuth` is a separate,
 * disjoint gate — a partner session never carries it). The tenant is pinned to
 * `tenant_admin_capavate`, so a non-Capavate admin persona cannot settle
 * Capavate's fees.
 *
 * WAVE 2B / MAJOR 1 — THIS FUNCTION FAILS CLOSED.
 * ----------------------------------------------
 * Review B (build_log/WAVES_012_REVIEW_B.md, MAJOR 1) found that the previous
 * implementation returned `true` for ANY authenticated `isAdmin` persona when
 *   (a) the `users` row did not exist,
 *   (b) `tenant_id` was empty/null, or
 *   (c) the database lookup threw.
 * (c) is the dangerous one: a DB fault silently CONFERRED settlement authority.
 * All three return `false` in production. A lookup exception is logged and
 * denied, never granted — an outage must not mint authority.
 *
 * The ONLY remaining exception is (a)/(b) under `NODE_ENV === "test"` for an
 * identity in the enumerated `TEST_ONLY_PLATFORM_ADMIN_IDS` set above.
 *
 * Proof: server/__tests__/wave2b_major1_platform_admin_fail_closed.test.ts
 */
export function isPlatformAdmin(req: Request): boolean {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed || !ctx.isAdmin) return false;

  let row: { tenant_id?: string | null } | undefined;
  try {
    row = rawDb()
      .prepare(`SELECT tenant_id FROM users WHERE id = ? AND deleted_at IS NULL`)
      .get(ctx.userId) as { tenant_id?: string | null } | undefined;
  } catch (e) {
    // FAIL CLOSED (c). A database fault is not an authorization.
    log.error(
      errorMeta("feeSettlement.isPlatformAdmin.lookupFailed", e, { userId: ctx.userId }),
    );
    return false;
  }

  // The authoritative answer: a real row with a real tenant.
  if (row && typeof row.tenant_id === "string" && row.tenant_id.length > 0) {
    return row.tenant_id === PLATFORM_ADMIN_TENANT_ID;
  }

  // (a) no row / (b) empty tenant — test-only, enumerated-identity exception.
  if (process.env.NODE_ENV === "test" && TEST_ONLY_PLATFORM_ADMIN_IDS.has(ctx.userId)) {
    return true;
  }

  // FAIL CLOSED.
  return false;
}

/**
 * Mint an admin-recorded settlement outcome, as a DURABLE ROW.
 *
 * Throws `ADMIN_REQUIRED` for anyone who is not a Capavate platform admin —
 * which is every partner role, by construction. The admin must state an outcome
 * and a reason; both are persisted on the authorization row.
 */
export function authorizePlatformAdminSettlement(
  req: Request,
  input: { purpose: SettlementPurpose; spvId: string; obligationId?: string; outcome: unknown; reason?: unknown },
): FeeSettlementAuthorization {
  if (!isPlatformAdmin(req)) throw new Error("ADMIN_REQUIRED");
  if (input.outcome !== "succeeded" && input.outcome !== "failed") throw new Error("SETTLEMENT_OUTCOME_REQUIRED");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("SETTLEMENT_REASON_REQUIRED");
  const ctx = getUserContext(req);
  return mint({
    source: "platform_admin",
    purpose: input.purpose,
    spvId: input.spvId,
    obligationId: input.obligationId ?? null,
    amountMinor: null, // pinned from the durable obligation row inside mint()
    currency: null,
    outcome: input.outcome,
    maxUses: input.purpose === "distribution_carry" ? 2 : 1,
    actorId: ctx.userId,
    reason,
  });
}

/**
 * Test-only mint. Guarded on NODE_ENV so it cannot be reached from a running
 * server, and it is not exported through any route. Exists so unit tests can
 * exercise the store's settlement path without an HTTP admin session.
 *
 * WAVE 3E — it writes the SAME durable row as the production mints. There is no
 * memory-only test path: the test mint is subject to exactly the same DB
 * authority, expiry and replay rules.
 */
export function __authorizeForTest(input: {
  purpose: SettlementPurpose;
  spvId: string;
  obligationId?: string;
  outcome: SettlementOutcome;
}): FeeSettlementAuthorization {
  if (process.env.NODE_ENV !== "test") throw new Error(E_REQUIRED);
  return mint({
    source: "test",
    purpose: input.purpose,
    spvId: input.spvId,
    obligationId: input.obligationId ?? null,
    amountMinor: null,
    currency: null,
    outcome: input.outcome,
    maxUses: input.purpose === "distribution_carry" ? 2 : 1,
    actorId: "test",
    reason: "test",
  });
}

/**
 * Test-only mint of an ALREADY-EXPIRED authorization.
 *
 * `expires_at` is frozen at issue by `trg_fsa_immutable_scope`, so an expired
 * fixture cannot be produced by mutating a live row — it is INSERTED expired.
 * This exists purely so the expiry rejection is provable; it produces a
 * capability that is, by construction, unusable.
 */
export function __authorizeExpiredForTest(input: {
  purpose: SettlementPurpose;
  spvId: string;
  obligationId?: string;
  outcome: SettlementOutcome;
}): FeeSettlementAuthorization {
  if (process.env.NODE_ENV !== "test") throw new Error(E_REQUIRED);
  const db = authorityDb();
  const id = `fsa_${randomUUID().replace(/-/g, "")}`;
  const issuedAt = new Date(Date.now() - 2 * SETTLEMENT_AUTHORIZATION_TTL_MS).toISOString();
  const expiresAt = new Date(Date.now() - SETTLEMENT_AUTHORIZATION_TTL_MS).toISOString();
  const maxUses = input.purpose === "distribution_carry" ? 2 : 1;
  db.prepare(
    `INSERT INTO ${SETTLEMENT_AUTHORIZATION_TABLE}
       (id, purpose, spv_id, obligation_id, amount_minor, currency, outcome, source,
        issued_by, issued_at, reason, expires_at, uses_max, uses_consumed, consumed_at, revoked_at)
     VALUES (?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,0,NULL,NULL)`,
  ).run(
    id, input.purpose, input.spvId, input.obligationId ?? null,
    input.outcome, "test", "test", issuedAt, "test", expiresAt, maxUses,
  );
  const auth = Object.freeze({
    [BRAND]: true as const,
    id,
    source: "test" as SettlementSource,
    purpose: input.purpose,
    spvId: input.spvId,
    obligationId: input.obligationId ?? null,
    amountMinor: null,
    currency: null,
    outcome: input.outcome,
    maxUses,
    actorId: "test",
    reason: "test",
    issuedAt,
    expiresAt,
  });
  ISSUED.add(auth);
  return auth;
}
