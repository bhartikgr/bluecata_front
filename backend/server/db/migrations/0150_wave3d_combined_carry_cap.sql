-- migrations/0150_wave3d_combined_carry_cap.sql
-- WAVE 3D / ITEM 3 — the combined-carry cap becomes DURABLE DB CONFIGURATION.
--
-- WHY
--   `server/spvEngineStore.ts` carried `export const COMBINED_CARRY_CAP_FRACTION = 1`.
--   That is a business-policy number compiled into the artifact: changing the
--   cap required a code deployment, no tenant/SPV policy record was consulted,
--   and there was no audit history of who changed it. The owner's standing rule
--   is all-DB-driven / no hardcoding. W3 REVIEW A, "MAJOR — Combined-carry
--   policy is hardcoded instead of DB-driven".
--
-- MIGRATION NUMBER — 0150. Justification, verified against THIS tree on
-- 2026-08-09 rather than assumed:
--   * `ls migrations/*.sql` and `ls server/db/migrations/*.sql` — the highest
--     number present on disk is 0149 (`0149_wave4b_partner_classifications.sql`).
--     The 0135 and 0138-0148 gaps are pre-existing/centrally reserved.
--   * spec/00_SHARED_STANDARDS.md §4 centrally allocates 0138-0148 to other
--     in-flight waves; 0149 is Wave 4B, already on disk.
--   * 0150 is therefore the first free number after 0148 and after the highest
--     number actually present. Nothing here renumbers or reuses.
--
-- SACRED FILES: `db/migrate.ts` / `server/db/migrate.ts` (the runner) and
-- `server/db/connection.ts` are NOT touched by this wave. This migration is a
-- new file only.
--
-- SCALE
--   `cap_scaled` is an INTEGER on the fixed scale 1e9 (server/lib/money.ts
--   `CARRY_FRACTION_SCALE`), NOT a REAL. 1000000000 == a cap of 1.0 == "the two
--   carry legs may together take at most 100% of the carry base". Storing the
--   policy as a scaled integer is what lets the comparison at the money sink be
--   exact fixed-scale integer arithmetic (WAVE 3D / ITEM 4) instead of a binary
--   float sum. `scale` is pinned by CHECK so a future scale change cannot be
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
--   `recordDistribution` performs no write before it resolves — so a missing or
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
