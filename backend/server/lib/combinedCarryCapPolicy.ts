/**
 * server/lib/combinedCarryCapPolicy.ts — WAVE 3D / ITEM 3.
 *
 * THE COMBINED-CARRY CAP, RESOLVED FROM DURABLE DB CONFIGURATION.
 *
 * WHAT THIS REPLACES
 * ------------------
 *   server/spvEngineStore.ts:72-79 (pre-WAVE-3D):
 *       export const COMBINED_CARRY_CAP_FRACTION = 1;
 *
 *   W3 REVIEW A, "MAJOR — Combined-carry policy is hardcoded instead of
 *   DB-driven": a business-policy number compiled into the artifact. Changing
 *   the cap needed a deploy, no tenant/SPV record was consulted, and there was
 *   no audit history. The owner's standing rule is all-DB-driven / no
 *   hardcoding.
 *
 * SCALE
 * -----
 * The cap is stored and returned as an INTEGER on `CARRY_FRACTION_SCALE` (1e9),
 * never as a REAL and never as a JS float. That is what lets the money sink
 * compare `gpScaled + platScaled > capScaled` in exact fixed-scale integer
 * arithmetic (WAVE 3D / ITEM 4) rather than summing binary doubles.
 *
 * SCOPE — MOST SPECIFIC WINS
 * --------------------------
 *   spv:<spvId>  ->  tenant:<tenantId>  ->  platform:*
 * An SPV-scoped row overrides a tenant row, which overrides the platform row.
 * Only `active = 1` rows are considered.
 *
 * FAIL-CLOSED — THE LOAD-BEARING PROPERTY
 * ---------------------------------------
 * A MISSING record does NOT mean "no cap". If no active row applies at any
 * scope, `resolveCombinedCarryCapScaled` THROWS
 * `COMBINED_CARRY_CAP_POLICY_MISSING`. `recordDistribution` resolves the cap
 * BEFORE `_collectCarryObligation` and BEFORE `persist("spv_distribution")`,
 * so the throw aborts the distribution with nothing written. Deleting or
 * deactivating the policy row therefore stops distributions; it never uncaps
 * them. An out-of-range or wrong-scale row throws
 * `COMBINED_CARRY_CAP_POLICY_INVALID` for the same reason.
 *
 * WHY THE SCHEMA IS APPLIED HERE TOO (three-place rule, adapted)
 * --------------------------------------------------------------
 * The project's convention is that a table exists in three places: the
 * canonical `migrations/NNNN.sql`, the byte-identical `server/db/migrations/`
 * mirror, and an idempotent inline bootstrap so the `:memory:` test path has
 * the table. The third place is normally `applyInlineMigrations()` in
 * `server/db/connection.ts` — which is SACRED and must not be edited by this
 * wave. The bootstrap therefore lives here, in the module that owns the table,
 * and it executes the CANONICAL MIGRATION TEXT VERBATIM: `CARRY_CAP_POLICY_SQL`
 * below is a byte-for-byte copy of migrations/0150_wave3d_combined_carry_cap.sql.
 * `server/__tests__/wave3d_combined_carry_cap_policy.test.ts` asserts that
 * equality, so the two cannot drift.
 *
 * The bootstrap runs ONLY when the table is absent. It never re-seeds an
 * existing table — otherwise deleting the policy row would silently restore it
 * and the fail-closed property above would be untestable and unenforceable.
 */
import { getDb, getDbDriver, rawDb } from "../db/connection";
import { CARRY_FRACTION_SCALE } from "./money";

/** Canonical error: no active policy row applies. Fail-closed, never "no cap". */
export const COMBINED_CARRY_CAP_POLICY_MISSING = "COMBINED_CARRY_CAP_POLICY_MISSING";
/** Canonical error: a row exists but fails validation (range / scale / type). */
export const COMBINED_CARRY_CAP_POLICY_INVALID = "COMBINED_CARRY_CAP_POLICY_INVALID";
/** Canonical error: the policy store is unreachable (e.g. Postgres backend). */
export const COMBINED_CARRY_CAP_POLICY_UNAVAILABLE = "COMBINED_CARRY_CAP_POLICY_UNAVAILABLE";

export interface CombinedCarryCapScope {
  /** Tenant / sponsoring-partner scope id. Optional. */
  tenantId?: string | null;
  /** SPV scope id — the most specific scope. Optional. */
  spvId?: string | null;
}

export interface CombinedCarryCapPolicy {
  /** The cap as an exact integer on CARRY_FRACTION_SCALE. 1e9 === 100%. */
  capScaled: number;
  scopeKind: "platform" | "tenant" | "spv";
  scopeId: string;
  policyId: string;
}

/** Byte-for-byte copy of migrations/0150_wave3d_combined_carry_cap.sql.
 *  DO NOT hand-edit: regenerate with _w3d/gen_policy_module.py after changing
 *  the migration. The parity test fails loudly on drift. */
export const CARRY_CAP_POLICY_SQL = `-- migrations/0150_wave3d_combined_carry_cap.sql
-- WAVE 3D / ITEM 3 — the combined-carry cap becomes DURABLE DB CONFIGURATION.
--
-- WHY
--   \`server/spvEngineStore.ts\` carried \`export const COMBINED_CARRY_CAP_FRACTION = 1\`.
--   That is a business-policy number compiled into the artifact: changing the
--   cap required a code deployment, no tenant/SPV policy record was consulted,
--   and there was no audit history of who changed it. The owner's standing rule
--   is all-DB-driven / no hardcoding. W3 REVIEW A, "MAJOR — Combined-carry
--   policy is hardcoded instead of DB-driven".
--
-- MIGRATION NUMBER — 0150. Justification, verified against THIS tree on
-- 2026-08-09 rather than assumed:
--   * \`ls migrations/*.sql\` and \`ls server/db/migrations/*.sql\` — the highest
--     number present on disk is 0149 (\`0149_wave4b_partner_classifications.sql\`).
--     The 0135 and 0138-0148 gaps are pre-existing/centrally reserved.
--   * spec/00_SHARED_STANDARDS.md §4 centrally allocates 0138-0148 to other
--     in-flight waves; 0149 is Wave 4B, already on disk.
--   * 0150 is therefore the first free number after 0148 and after the highest
--     number actually present. Nothing here renumbers or reuses.
--
-- SACRED FILES: \`db/migrate.ts\` / \`server/db/migrate.ts\` (the runner) and
-- \`server/db/connection.ts\` are NOT touched by this wave. This migration is a
-- new file only.
--
-- SCALE
--   \`cap_scaled\` is an INTEGER on the fixed scale 1e9 (server/lib/money.ts
--   \`CARRY_FRACTION_SCALE\`), NOT a REAL. 1000000000 == a cap of 1.0 == "the two
--   carry legs may together take at most 100% of the carry base". Storing the
--   policy as a scaled integer is what lets the comparison at the money sink be
--   exact fixed-scale integer arithmetic (WAVE 3D / ITEM 4) instead of a binary
--   float sum. \`scale\` is pinned by CHECK so a future scale change cannot be
--   silently misread as a different policy.
--
-- SCOPE
--   (scope_kind, scope_id) with scope_kind in ('platform','tenant','spv').
--   Resolution is MOST SPECIFIC WINS: spv -> tenant -> platform. The platform
--   row uses scope_id '*'. UNIQUE(scope_kind, scope_id) means a scope can never
--   hold two conflicting caps.
--
-- FAIL-CLOSED (the load-bearing property)
--   A MISSING record must NEVER mean "no cap". The resolver
--   (server/lib/combinedCarryCapPolicy.ts) throws
--   COMBINED_CARRY_CAP_POLICY_MISSING when no active row applies, and
--   \`recordDistribution\` performs no write before it resolves — so a missing or
--   deactivated policy row REJECTS the distribution rather than uncapping it.
--   Proof: server/__tests__/wave3d_combined_carry_cap_policy.test.ts.
--
-- SEED
--   The genesis row carries cap_scaled = 1000000000, i.e. exactly the value the
--   deleted hardcoded constant had. Behaviour on upgrade is UNCHANGED.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / INSERT OR IGNORE. Re-running
-- this migration against an already-migrated database is a no-op.

CREATE TABLE IF NOT EXISTS spv_carry_cap_policy (
  id            TEXT    PRIMARY KEY NOT NULL,
  scope_kind    TEXT    NOT NULL CHECK (scope_kind IN ('platform','tenant','spv')),
  scope_id      TEXT    NOT NULL,
  cap_scaled    INTEGER NOT NULL CHECK (cap_scaled >= 0 AND cap_scaled <= 1000000000),
  scale         INTEGER NOT NULL CHECK (scale = 1000000000),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  description   TEXT,
  created_at    TEXT    NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at    TEXT    NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by    TEXT,
  -- The platform-wide row is the fallback of last resort and is addressed by
  -- the literal '*'; a scoped row must name a real scope.
  CHECK ((scope_kind = 'platform' AND scope_id = '*') OR (scope_kind <> 'platform' AND scope_id <> '*')),
  UNIQUE (scope_kind, scope_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sccp_scope ON spv_carry_cap_policy(scope_kind, scope_id, active);

-- Append-only audit history. Every change to the current-state table must be
-- accompanied by a history row written in the same transaction by the
-- application writer; the triggers below make the history itself immutable.
CREATE TABLE IF NOT EXISTS spv_carry_cap_policy_history (
  history_id    TEXT    PRIMARY KEY NOT NULL,
  policy_id     TEXT    NOT NULL,
  scope_kind    TEXT    NOT NULL CHECK (scope_kind IN ('platform','tenant','spv')),
  scope_id      TEXT    NOT NULL,
  cap_scaled    INTEGER NOT NULL CHECK (cap_scaled >= 0 AND cap_scaled <= 1000000000),
  scale         INTEGER NOT NULL CHECK (scale = 1000000000),
  active        INTEGER NOT NULL CHECK (active IN (0,1)),
  change_kind   TEXT    NOT NULL CHECK (change_kind IN ('genesis','update','deactivate','reactivate')),
  changed_at    TEXT    NOT NULL
                  CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  changed_by    TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sccph_policy ON spv_carry_cap_policy_history(policy_id, changed_at);

CREATE TRIGGER IF NOT EXISTS trg_sccph_no_update
  BEFORE UPDATE ON spv_carry_cap_policy_history
  BEGIN SELECT RAISE(ABORT, 'CARRY_CAP_POLICY_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_sccph_no_delete
  BEFORE DELETE ON spv_carry_cap_policy_history
  BEGIN SELECT RAISE(ABORT, 'CARRY_CAP_POLICY_HISTORY_IMMUTABLE'); END;

-- Genesis: the platform-wide cap, seeded at exactly the value the removed
-- hardcoded constant held (1.0 == 1000000000 on scale 1e9). Behaviour is
-- unchanged on upgrade.
INSERT OR IGNORE INTO spv_carry_cap_policy_history
  (history_id, policy_id, scope_kind, scope_id, cap_scaled, scale, active, change_kind, changed_at, changed_by)
VALUES
  ('sccph_gen_platform', 'sccp_platform', 'platform', '*', 1000000000, 1000000000, 1,
   'genesis', '2026-08-09T00:00:00Z', 'system:wave3d_seed');

INSERT OR IGNORE INTO spv_carry_cap_policy
  (id, scope_kind, scope_id, cap_scaled, scale, active, description, created_at, updated_at, updated_by)
VALUES
  ('sccp_platform', 'platform', '*', 1000000000, 1000000000, 1,
   'Combined GP + platform carry cap as a fraction of the carry base, on scale 1e9. 1000000000 = 100%. Was the hardcoded COMBINED_CARRY_CAP_FRACTION before WAVE 3D.',
   '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z', 'system:wave3d_seed');
`;

const TABLE = "spv_carry_cap_policy";

/**
 * Idempotent bootstrap. Creates the table + history + triggers + genesis seed
 * ONLY when the table does not yet exist. Never re-seeds an existing table.
 */
export function ensureCarryCapPolicySchema(): void {
  if (getDbDriver() === "postgres") {
    throw new Error(COMBINED_CARRY_CAP_POLICY_UNAVAILABLE);
  }
  getDb(); // guarantee a connection exists before reaching for the raw handle
  const db = rawDb();
  const present = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(TABLE);
  if (present) return;
  db.exec(CARRY_CAP_POLICY_SQL);
}

interface PolicyRow {
  id: string;
  scope_kind: string;
  scope_id: string;
  cap_scaled: number;
  scale: number;
  active: number;
}

function validate(row: PolicyRow): number {
  const cap = Number(row.cap_scaled);
  const scale = Number(row.scale);
  if (!Number.isInteger(cap) || !Number.isInteger(scale)) {
    throw new Error(`${COMBINED_CARRY_CAP_POLICY_INVALID}:non_integer:${row.id}`);
  }
  if (scale !== CARRY_FRACTION_SCALE) {
    throw new Error(`${COMBINED_CARRY_CAP_POLICY_INVALID}:scale=${scale}:${row.id}`);
  }
  if (cap < 0 || cap > CARRY_FRACTION_SCALE) {
    throw new Error(`${COMBINED_CARRY_CAP_POLICY_INVALID}:cap=${cap}:${row.id}`);
  }
  return cap;
}

/**
 * Resolve the applicable combined-carry cap. MOST SPECIFIC SCOPE WINS.
 *
 * @throws `COMBINED_CARRY_CAP_POLICY_MISSING` when nothing applies. This is the
 *   fail-closed path: the caller must abort the distribution, NOT proceed
 *   uncapped.
 * @throws `COMBINED_CARRY_CAP_POLICY_INVALID` when a row is out of range, on a
 *   different scale, or not an integer.
 */
export function resolveCombinedCarryCapPolicy(
  scope: CombinedCarryCapScope = {},
): CombinedCarryCapPolicy {
  ensureCarryCapPolicySchema();
  const db = rawDb();
  const stmt = db.prepare(
    `SELECT id, scope_kind, scope_id, cap_scaled, scale, active
       FROM ${TABLE}
      WHERE active = 1 AND scope_kind = ? AND scope_id = ?
      LIMIT 1`,
  );
  const candidates: Array<["spv" | "tenant" | "platform", string | null | undefined]> = [
    ["spv", scope.spvId],
    ["tenant", scope.tenantId],
    ["platform", "*"],
  ];
  for (const [kind, id] of candidates) {
    if (!id) continue;
    const row = stmt.get(kind, id) as PolicyRow | undefined;
    if (!row) continue;
    return {
      capScaled: validate(row),
      scopeKind: kind,
      scopeId: String(row.scope_id),
      policyId: String(row.id),
    };
  }
  // FAIL CLOSED. A missing configuration record is NOT "no cap".
  throw new Error(COMBINED_CARRY_CAP_POLICY_MISSING);
}

/** Convenience: just the exact scaled integer, for handing to the allocator. */
export function resolveCombinedCarryCapScaled(scope: CombinedCarryCapScope = {}): number {
  return resolveCombinedCarryCapPolicy(scope).capScaled;
}
