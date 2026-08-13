/**
 * server/lib/spvFeeScheduleStore.ts — WAVE 6.
 *
 * ONE FEE SCHEDULE, RESOLVED FROM THE DATABASE, FAILING CLOSED.
 * Items: CP-SPV-12 · CP-SPV-13 · CP-SPV-16 · CP-SPV-17 · CP-SPV-20 · FE-3.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIOR-ART CHECK (done before writing a line — the project's standing rule)
 * ─────────────────────────────────────────────────────────────────────────────
 *   grep -rn "spv_fee_schedule" over the whole tree  →  ZERO hits.
 *   `spv_fee`            (connection.ts:5214) is per-vehicle APPLIED fees.
 *   `spv_fee_obligation` (connection.ts:5328) is the money ledger.
 *   `spv_carry_cap_policy` (migration 0150)  is a CAP, not a price.
 * There was nothing to wire. This is BUILD-NEW, and the table it owns is
 * migrations/0157_wave6_spv_fee_schedule.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CP-SPV-16 — "NO LITERAL FALLBACK; RESOLVER FAILS CLOSED"
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no default anywhere in this file. Not a `?? 0`, not a `|| 0.02`, not
 * a constant to fall back to. When no active, in-window row applies at any
 * scope, `resolveFee` THROWS `SPV_FEE_SCHEDULE_MISSING`, which
 * server/spvEngineRoutes.ts maps to an honest 503 (CP-SPV-34).
 *
 * That direction matters and is the opposite of the usual instinct. Returning
 * zero for a missing price is not "safe": it silently gives away platform
 * revenue and tells a GP their vehicle is free. Refusing to quote is the safe
 * failure. Deleting the platform row stops pricing; it never makes anything
 * free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CP-SPV-12 — "100% DYNAMIC, DB-DRIVEN, NO IN-MEMORY, NO HARDCODING"
 * ─────────────────────────────────────────────────────────────────────────────
 * Every read hits the database. There is NO module-level cache of fee values,
 * deliberately: a cache is in-memory state, and CP-SPV-15 (real-time
 * propagation) requires that an admin's edit is visible on the very next read
 * with no invalidation step and no restart. The only memoised thing in this
 * file is the boolean "has the bootstrap DDL run", which carries no fee data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MONEY / PERCENT
 * ─────────────────────────────────────────────────────────────────────────────
 * `fixedAmountMinor` is an integer in minor units. `rateScaled` is an integer
 * on `CARRY_FRACTION_SCALE` (1e9) — the SAME scale server/lib/money.ts and
 * migration 0150 use, so a rate can be handed straight to the existing integer
 * allocators without ever becoming a float. `computeFeeMinor` multiplies in
 * integers and divides once, at the end. There is no `Math.round` on a
 * per-party share anywhere here — this function prices ONE total; splitting
 * that total across parties is `allocateDistributionMinor`'s job (Wave 5 owns
 * that file and it is not touched).
 *
 * THIRD PLACE: as with WAVE 3D/3E, `server/db/connection.ts` is SACRED, so the
 * idempotent bootstrap of the canonical migration text lives here, in the
 * module that owns the tables.
 */
import { rawDb, getDbDriver } from "../db/connection";
import { CARRY_FRACTION_SCALE } from "./money";

/* ── canonical errors — every one of them DENIES ─────────────────────────── */

/** No active, in-window row applies at any scope. Rendered as 503. */
export const SPV_FEE_SCHEDULE_MISSING = "SPV_FEE_SCHEDULE_MISSING";
/** A row exists but fails validation (scale / range / shape). Rendered as 500. */
export const SPV_FEE_SCHEDULE_INVALID = "SPV_FEE_SCHEDULE_INVALID";
/** The store is unreachable (e.g. a Postgres backend). Rendered as 503. */
export const SPV_FEE_SCHEDULE_UNAVAILABLE = "SPV_FEE_SCHEDULE_UNAVAILABLE";
/** FE-3: no active rolling-close window row applies. Rendered as 503. */
export const SPV_CLOSE_WINDOW_POLICY_MISSING = "SPV_CLOSE_WINDOW_POLICY_MISSING";

/* ── domains — mirror the CHECK constraints in migration 0154 exactly ────── */

export const SPV_FEE_PAYER_KINDS = ["partner", "lp", "platform", "spv"] as const;
export type SpvFeePayerKind = (typeof SPV_FEE_PAYER_KINDS)[number];

export const SPV_FEE_BASES = [
  "fixed", "commitment", "called_capital", "carry_base",
  "nav", "gross_proceeds", "per_lp", "per_deployment",
] as const;
export type SpvFeeBasis = (typeof SPV_FEE_BASES)[number];

export const SPV_FEE_LAYERS = ["gp", "platform"] as const;
export type SpvFeeLayer = (typeof SPV_FEE_LAYERS)[number];

export const SPV_FEE_RAILS = ["manual", "airwallex", "stripe", "netted"] as const;
export type SpvFeeRail = (typeof SPV_FEE_RAILS)[number];

export const SPV_FEE_SCOPE_KINDS = ["platform", "partner", "spv"] as const;
export type SpvFeeScopeKind = (typeof SPV_FEE_SCOPE_KINDS)[number];

/** GP-facing help for the `basis` column — what the rate is applied TO. */
export const SPV_FEE_BASIS_HELP: Record<SpvFeeBasis, string> = {
  fixed: "A flat amount in minor units. No rate applies.",
  commitment: "A fraction of each LP's committed capital.",
  called_capital: "A fraction of capital actually called and received.",
  carry_base: "A fraction of the carry base (proceeds above return of capital).",
  nav: "A fraction of net asset value at the measurement date.",
  gross_proceeds: "A fraction of gross distribution proceeds, before any carry.",
  per_lp: "A fraction applied once per subscribed LP.",
  per_deployment: "A fraction applied once per capital deployment into a round.",
};

export const SPV_FEE_PAYER_HELP: Record<SpvFeePayerKind, string> = {
  partner: "Billed to the sponsoring partner (the GP's firm).",
  lp: "Borne by the limited partners.",
  platform: "Absorbed by Capavate — a cost, not a charge.",
  spv: "Netted inside the vehicle before LP distribution.",
};

export interface SpvFeeScheduleRow {
  id: string;
  feeCode: string;
  scopeKind: SpvFeeScopeKind;
  scopeId: string;
  payerKind: SpvFeePayerKind;
  basis: SpvFeeBasis;
  layer: SpvFeeLayer;
  /** integer minor units, or null when `basis !== "fixed"` */
  fixedAmountMinor: number | null;
  /** integer on CARRY_FRACTION_SCALE (1e9), or null when `basis === "fixed"` */
  rateScaled: number | null;
  scale: number;
  currency: string;
  collectionRail: SpvFeeRail;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  label: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SpvFeeScope {
  partnerId?: string | null;
  spvId?: string | null;
  /** ISO timestamp the price is asked for. Defaults to now. */
  asOf?: string;
}

/* ── the canonical DDL, executed verbatim as the third place ─────────────── */

let bootstrapped = false;

function sqliteHandle(): ReturnType<typeof rawDb> | null {
  try {
    if (getDbDriver() !== "sqlite") return null;
    return rawDb();
  } catch {
    return null;
  }
}

/**
 * THIRD PLACE. Idempotent; every statement is IF NOT EXISTS / INSERT OR IGNORE,
 * so it never re-seeds an existing table. It runs ONLY the structural half of
 * migration 0154 plus the two genesis rows the resolver needs to be
 * exercisable; the seeded fee rows are INACTIVE, which the resolver treats
 * identically to absent (i.e. it still fails closed).
 */
export function ensureSpvFeeScheduleTables(): boolean {
  if (bootstrapped) return true;
  const db = sqliteHandle();
  if (!db) return false;
  try {
    db.exec(BOOTSTRAP_SQL);
    bootstrapped = true;
    return true;
  } catch {
    return false;
  }
}

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS spv_fee_schedule (
  id              TEXT    PRIMARY KEY NOT NULL,
  fee_code        TEXT    NOT NULL,
  scope_kind      TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id        TEXT    NOT NULL,
  payer_kind      TEXT    NOT NULL CHECK (payer_kind IN ('partner','lp','platform','spv')),
  basis           TEXT    NOT NULL CHECK (basis IN
                    ('fixed','commitment','called_capital','carry_base','nav',
                     'gross_proceeds','per_lp','per_deployment')),
  layer           TEXT    NOT NULL CHECK (layer IN ('gp','platform')),
  fixed_amount_minor INTEGER CHECK (fixed_amount_minor IS NULL OR fixed_amount_minor >= 0),
  rate_scaled     INTEGER CHECK (rate_scaled IS NULL OR (rate_scaled >= 0 AND rate_scaled <= 1000000000)),
  scale           INTEGER NOT NULL DEFAULT 1000000000 CHECK (scale = 1000000000),
  currency        TEXT    NOT NULL DEFAULT 'USD'
                    CHECK (length(currency) = 3 AND currency = upper(currency)),
  collection_rail TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (collection_rail IN ('manual','airwallex','stripe','netted')),
  effective_from  TEXT    NOT NULL
                    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  effective_to    TEXT
                    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  label           TEXT    NOT NULL,
  description     TEXT,
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by      TEXT,
  CHECK ((basis = 'fixed'  AND fixed_amount_minor IS NOT NULL AND rate_scaled IS NULL)
      OR (basis <> 'fixed' AND rate_scaled IS NOT NULL AND fixed_amount_minor IS NULL)),
  CHECK ((scope_kind = 'platform' AND scope_id = '*')
      OR (scope_kind <> 'platform' AND scope_id <> '*')),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (fee_code, scope_kind, scope_id, effective_from)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sfs_resolve
  ON spv_fee_schedule(fee_code, scope_kind, scope_id, active, effective_from);
CREATE INDEX IF NOT EXISTS idx_sfs_code ON spv_fee_schedule(fee_code, active);
CREATE TABLE IF NOT EXISTS spv_fee_schedule_history (
  history_id      TEXT    PRIMARY KEY NOT NULL,
  schedule_id     TEXT    NOT NULL,
  fee_code        TEXT    NOT NULL,
  scope_kind      TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id        TEXT    NOT NULL,
  payer_kind      TEXT    NOT NULL,
  basis           TEXT    NOT NULL,
  layer           TEXT    NOT NULL,
  fixed_amount_minor INTEGER,
  rate_scaled     INTEGER,
  scale           INTEGER NOT NULL CHECK (scale = 1000000000),
  currency        TEXT    NOT NULL,
  collection_rail TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  active          INTEGER NOT NULL CHECK (active IN (0,1)),
  change_kind     TEXT    NOT NULL
                    CHECK (change_kind IN ('genesis','create','update','deactivate','reactivate','expire')),
  changed_at      TEXT    NOT NULL
                    CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  changed_by      TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sfsh_schedule ON spv_fee_schedule_history(schedule_id, changed_at);
CREATE TRIGGER IF NOT EXISTS trg_sfsh_no_update
  BEFORE UPDATE ON spv_fee_schedule_history
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_SCHEDULE_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sfsh_no_delete
  BEFORE DELETE ON spv_fee_schedule_history
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_SCHEDULE_HISTORY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS spv_close_window_policy (
  id            TEXT    PRIMARY KEY NOT NULL,
  scope_kind    TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id      TEXT    NOT NULL,
  window_days   INTEGER NOT NULL CHECK (window_days >= 1 AND window_days <= 3650),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  description   TEXT,
  created_at    TEXT    NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at    TEXT    NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by    TEXT,
  CHECK ((scope_kind = 'platform' AND scope_id = '*')
      OR (scope_kind <> 'platform' AND scope_id <> '*')),
  UNIQUE (scope_kind, scope_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_scwp_scope ON spv_close_window_policy(scope_kind, scope_id, active);
INSERT OR IGNORE INTO spv_close_window_policy
  (id, scope_kind, scope_id, window_days, active, description, created_at, updated_at, updated_by)
VALUES
  ('scwp_platform', 'platform', '*', 30, 1,
   'Default rolling-close window in days. Was the hardcoded 30 at server/spvEngineRoutes.ts:597 and SpvDetailTabs.tsx:672 before WAVE 6 / FE-3.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed');
INSERT OR IGNORE INTO spv_fee_schedule
  (id, fee_code, scope_kind, scope_id, payer_kind, basis, layer,
   fixed_amount_minor, rate_scaled, scale, currency, collection_rail,
   effective_from, effective_to, active, label, description, created_at, updated_at, updated_by)
VALUES
  ('sfs_spv_launch_platform', 'spv_launch', 'platform', '*',
   'partner', 'fixed', 'platform', 0, NULL, 1000000000, 'USD', 'airwallex',
   '2026-08-10T00:00:00Z', NULL, 0,
   'Airwallex SPV Launch Fee',
   'CP-SPV-20. Seeded INACTIVE at 0 because no launch-fee amount has been published.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfs_platform_carry_platform', 'platform_carry', 'platform', '*',
   'spv', 'carry_base', 'platform', NULL, 0, 1000000000, 'USD', 'netted',
   '2026-08-10T00:00:00Z', NULL, 0,
   'Platform carry',
   'CP-SPV-10 platform layer. Seeded INACTIVE at 0.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfs_gp_management_platform', 'gp_management', 'platform', '*',
   'lp', 'commitment', 'gp', NULL, 0, 1000000000, 'USD', 'manual',
   '2026-08-10T00:00:00Z', NULL, 0,
   'GP management fee',
   'CP-SPV-10 GP layer. Seeded INACTIVE at 0.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed');
`;

/* ── row mapping + validation ────────────────────────────────────────────── */

function toRow(r: Record<string, unknown>): SpvFeeScheduleRow {
  const scale = Number(r.scale);
  if (scale !== CARRY_FRACTION_SCALE) throw new Error(SPV_FEE_SCHEDULE_INVALID);
  const fixed = r.fixed_amount_minor == null ? null : Number(r.fixed_amount_minor);
  const rate = r.rate_scaled == null ? null : Number(r.rate_scaled);
  if (fixed != null && (!Number.isSafeInteger(fixed) || fixed < 0)) throw new Error(SPV_FEE_SCHEDULE_INVALID);
  if (rate != null && (!Number.isSafeInteger(rate) || rate < 0 || rate > CARRY_FRACTION_SCALE)) {
    throw new Error(SPV_FEE_SCHEDULE_INVALID);
  }
  const basis = String(r.basis) as SpvFeeBasis;
  // The DB CHECK enforces this too; re-asserting here means a Postgres backend
  // or a hand-edited row cannot produce a half-priced fee at runtime either.
  if (basis === "fixed" ? fixed == null || rate != null : rate == null || fixed != null) {
    throw new Error(SPV_FEE_SCHEDULE_INVALID);
  }
  return {
    id: String(r.id),
    feeCode: String(r.fee_code),
    scopeKind: String(r.scope_kind) as SpvFeeScopeKind,
    scopeId: String(r.scope_id),
    payerKind: String(r.payer_kind) as SpvFeePayerKind,
    basis,
    layer: String(r.layer) as SpvFeeLayer,
    fixedAmountMinor: fixed,
    rateScaled: rate,
    scale,
    currency: String(r.currency),
    collectionRail: String(r.collection_rail) as SpvFeeRail,
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to == null ? null : String(r.effective_to),
    active: Number(r.active) === 1,
    label: String(r.label),
    description: r.description == null ? null : String(r.description),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
  };
}

/* ── resolution: MOST SPECIFIC WINS, then fail closed ────────────────────── */

/**
 * CP-SPV-16. Returns the single applicable schedule row, or THROWS.
 *
 * Ladder: spv:<spvId> → partner:<partnerId> → platform:'*'.
 * Within a scope, the latest `effective_from` that is <= `asOf` wins, and the
 * row must be `active` and not yet expired.
 *
 * There is no branch of this function that returns a made-up price.
 */
export function resolveFee(feeCode: string, scope: SpvFeeScope = {}): SpvFeeScheduleRow {
  const db = sqliteHandle();
  if (!db) throw new Error(SPV_FEE_SCHEDULE_UNAVAILABLE);
  ensureSpvFeeScheduleTables();
  const asOf = scope.asOf ?? new Date().toISOString();
  const ladder: Array<[SpvFeeScopeKind, string]> = [];
  if (scope.spvId) ladder.push(["spv", scope.spvId]);
  if (scope.partnerId) ladder.push(["partner", scope.partnerId]);
  ladder.push(["platform", "*"]);

  for (const [kind, id] of ladder) {
    let raw: Record<string, unknown> | undefined;
    try {
      raw = db
        .prepare(
          `SELECT * FROM spv_fee_schedule
            WHERE fee_code = ? AND scope_kind = ? AND scope_id = ?
              AND active = 1
              AND effective_from <= ?
              AND (effective_to IS NULL OR effective_to > ?)
            ORDER BY effective_from DESC
            LIMIT 1`,
        )
        .get(feeCode, kind, id, asOf, asOf) as Record<string, unknown> | undefined;
    } catch {
      throw new Error(SPV_FEE_SCHEDULE_UNAVAILABLE);
    }
    if (raw) return toRow(raw);
  }
  // NO FALLBACK. This is the whole point of CP-SPV-16.
  throw new Error(SPV_FEE_SCHEDULE_MISSING);
}

/** Non-throwing probe, for UI that must render "not priced yet" rather than error. */
export function tryResolveFee(feeCode: string, scope: SpvFeeScope = {}): SpvFeeScheduleRow | null {
  try {
    return resolveFee(feeCode, scope);
  } catch {
    return null;
  }
}

/** Every row, for the /admin/fees editor (CP-SPV-14). Includes inactive rows. */
export function listFeeSchedules(feeCode?: string): SpvFeeScheduleRow[] {
  const db = sqliteHandle();
  if (!db) throw new Error(SPV_FEE_SCHEDULE_UNAVAILABLE);
  ensureSpvFeeScheduleTables();
  const rows = (
    feeCode
      ? db.prepare(`SELECT * FROM spv_fee_schedule WHERE fee_code = ? ORDER BY fee_code, scope_kind, effective_from DESC`).all(feeCode)
      : db.prepare(`SELECT * FROM spv_fee_schedule ORDER BY fee_code, scope_kind, effective_from DESC`).all()
  ) as Array<Record<string, unknown>>;
  const out: SpvFeeScheduleRow[] = [];
  for (const r of rows) {
    // A single corrupt row must not blind the admin to every other row; it is
    // skipped from the LIST but still fails closed at RESOLVE time.
    try { out.push(toRow(r)); } catch { /* surfaced by resolveFee, not here */ }
  }
  return out;
}

/** Append-only history for one schedule row. */
export function feeScheduleHistory(scheduleId: string): Array<Record<string, unknown>> {
  const db = sqliteHandle();
  if (!db) throw new Error(SPV_FEE_SCHEDULE_UNAVAILABLE);
  ensureSpvFeeScheduleTables();
  return db
    .prepare(`SELECT * FROM spv_fee_schedule_history WHERE schedule_id = ? ORDER BY changed_at ASC, history_id ASC`)
    .all(scheduleId) as Array<Record<string, unknown>>;
}

/* ── pricing ─────────────────────────────────────────────────────────────── */

/**
 * Apply a resolved schedule row to a base amount, in INTEGER arithmetic.
 *
 * `basis === "fixed"` ignores `baseMinor` entirely and returns the flat amount.
 * Otherwise the result is `floor(baseMinor * rateScaled / 1e9)`. Floor, not
 * round: a fee is charged to the payer, and rounding a charge UP by a cent
 * without a rule is a (small) unauthorised charge. Where a total must later be
 * split across parties, that is `allocateDistributionMinor`'s job in
 * server/lib/money.ts — this function never rounds a per-party share, per the
 * project's money rule.
 *
 * `baseMinor` must be a non-negative safe integer; anything else throws rather
 * than silently pricing at zero.
 */
export function computeFeeMinor(row: SpvFeeScheduleRow, baseMinor: number): number {
  if (row.basis === "fixed") {
    if (row.fixedAmountMinor == null) throw new Error(SPV_FEE_SCHEDULE_INVALID);
    return row.fixedAmountMinor;
  }
  if (row.rateScaled == null) throw new Error(SPV_FEE_SCHEDULE_INVALID);
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0) throw new Error(SPV_FEE_SCHEDULE_INVALID);
  // BigInt so a large NAV times a 1e9-scaled rate cannot lose precision above
  // Number.MAX_SAFE_INTEGER before the divide.
  const product = BigInt(baseMinor) * BigInt(row.rateScaled);
  return Number(product / BigInt(CARRY_FRACTION_SCALE));
}

/* ── FE-3: the rolling-close window ──────────────────────────────────────── */

export interface SpvCloseWindowPolicy {
  windowDays: number;
  scopeKind: SpvFeeScopeKind;
  scopeId: string;
  policyId: string;
}

/**
 * FE-3. Same ladder, same fail-closed rule. Replaces the literal `30` at
 * server/spvEngineRoutes.ts:597 and client SpvDetailTabs.tsx:672.
 *
 * A missing policy row THROWS. It does not quietly restore 30 — otherwise
 * deleting the row would look like it worked while changing nothing, which is
 * precisely the class of bug this wave exists to remove.
 */
export function resolveCloseWindowDays(scope: SpvFeeScope = {}): SpvCloseWindowPolicy {
  const db = sqliteHandle();
  if (!db) throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING);
  ensureSpvFeeScheduleTables();
  const ladder: Array<[SpvFeeScopeKind, string]> = [];
  if (scope.spvId) ladder.push(["spv", scope.spvId]);
  if (scope.partnerId) ladder.push(["partner", scope.partnerId]);
  ladder.push(["platform", "*"]);
  for (const [kind, id] of ladder) {
    const raw = db
      .prepare(`SELECT id, window_days FROM spv_close_window_policy WHERE scope_kind = ? AND scope_id = ? AND active = 1`)
      .get(kind, id) as { id: string; window_days: number } | undefined;
    if (raw) {
      const d = Number(raw.window_days);
      if (!Number.isSafeInteger(d) || d < 1 || d > 3650) throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING);
      return { windowDays: d, scopeKind: kind, scopeId: id, policyId: raw.id };
    }
  }
  throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING);
}

/** Test-only: forget the memoised bootstrap flag. Carries no fee data. */
export const _testSpvFeeSchedule = {
  reset() {
    bootstrapped = false;
  },
  BOOTSTRAP_SQL,
};
