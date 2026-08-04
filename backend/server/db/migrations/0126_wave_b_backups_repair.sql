-- migrations/0126_wave_b_backups_repair.sql
-- Wave B v26.4.0-fix3 (GPT-5.6 NEW-1) — upgrade-path repair.
--
-- Why this file exists:
--   The migration runner keys applied migrations by FILENAME in
--   `__drizzle_migrations_applied`. Fix2 edited `0125_wave_b_backups.sql`
--   in place to close 3 round-2 BLOCKs (SQL parse, nested BEGIN, dropped
--   columns), but a deployment that already recorded fix1's 0125 as
--   applied will SKIP the corrected 0125 forever — leaving
--   `wave_b_backup_spvs` at 20 columns (missing the 6 deployment_fee_*
--   and sourcing_partner_id columns from migration 0054).
--
-- This file re-applies the corrected 0125 body under a NEW filename so it
-- runs exactly ONCE on any DB that predates fix3. Idempotent by
-- construction:
--   - `DROP TABLE IF EXISTS wave_b_backup_*` — no-op if absent.
--   - `DELETE FROM _migrations_applied WHERE key = 'wave_b_backup_ddl_v1'`
--     — no-op if absent.
--   - `CREATE TABLE IF NOT EXISTS wave_b_backup_*` — no-op if the
--     just-dropped table wasn't present.
--   - Every INSERT is `WHERE 1=1 ON CONFLICT (id) DO NOTHING`, so a partial
--     run leaves the DB safe to re-run.
--
-- On fresh installs: 0125 (with the correct DDL) runs first; 0126 then
-- runs the same operations, which are idempotent, so the final state is
-- byte-identical to 0125 alone.
--
-- On upgraded installs where fix1's broken 0125 was recorded: 0126 is the
-- ONLY path that runs the corrected DDL. It DROPs the 20-column backup
-- and rebuilds with all 26 columns from live `spvs` state — the exact
-- prior-state reconciliation the file must perform.
--
-- WARNING for owner: on a DB that already served fix1 traffic, the
-- backup snapshot after this migration reflects the CURRENT state, not
-- pre-Wave-B state. Fix1 was never in prod (only in Avi's sandbox), so
-- this trade-off is acceptable. Documented in DEPLOY_FOR_AVI.md.

DROP TABLE IF EXISTS wave_b_backup_spvs;
DROP TABLE IF EXISTS wave_b_backup_spv_commitments;
DROP TABLE IF EXISTS wave_b_backup_spv_capital_calls;
DROP TABLE IF EXISTS wave_b_backup_spv_distributions;
DROP TABLE IF EXISTS wave_b_backup_spv_positions;
DROP TABLE IF EXISTS wave_b_backup_kv_partnerSpvs;
DROP TABLE IF EXISTS wave_b_backup_kv_partnerFunds;
DROP TABLE IF EXISTS wave_b_backup_kv_partnerSpvPositions;
DROP TABLE IF EXISTS wave_b_backup_kv_partnerFundCommitments;
DELETE FROM _migrations_applied WHERE key = 'wave_b_backup_ddl_v1';

-- ── 0. Ensure the 4 kv_partner* source tables exist (BLOCK-F). ─────────────
-- Shape matches storePersistenceShim.ensureTable exactly. IF NOT EXISTS so
-- this is a no-op on any DB where these tables already exist.
CREATE TABLE IF NOT EXISTS kv_partnerSpvs (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS kv_partnerFunds (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS kv_partnerSpvPositions (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS kv_partnerFundCommitments (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- ── 1. Relational sources (5) — declare backup tables with explicit PK. ────
-- Column enumerations match live schema (migration 0041 + 0054 additive ALTERs).
-- spvs: 26 columns (20 from 0041 + 6 fee/attribution from 0054). Any future
-- ALTER TABLE spvs ADD COLUMN must also be added HERE. A separate test
-- (PRAGMA table_info drift check) enforces this.
CREATE TABLE IF NOT EXISTS wave_b_backup_spvs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  partner_id TEXT,
  name TEXT,
  lead_company_id TEXT,
  structure_type TEXT,
  status TEXT,
  target_minor INTEGER,
  committed_minor INTEGER,
  called_minor INTEGER,
  distributed_minor INTEGER,
  gp_user_id TEXT,
  formed_at TEXT,
  closes_at TEXT,
  terms TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  -- v26.4.0-fix2 (Opus DEFECT-11): 6 columns added by migration 0054, silently
  -- dropped in v26.4.0-fix1. Restored here. All are canonical since 0054.
  deployment_fee_minor INTEGER,
  deployment_fee_currency TEXT,
  deployment_fee_payer TEXT,
  deployment_fee_paid_at TEXT,
  deployment_fee_schedule_id TEXT,
  sourcing_partner_id TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_spv_commitments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  spv_id TEXT,
  lp_user_id TEXT,
  amount_minor INTEGER,
  status TEXT,
  commitment_doc_url TEXT,
  signed_at TEXT,
  funded_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_spv_capital_calls (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  spv_id TEXT,
  sequence_no INTEGER,
  amount_minor INTEGER,
  called_at TEXT,
  due_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_spv_distributions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  spv_id TEXT,
  distribution_type TEXT,
  total_minor INTEGER,
  distributed_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_spv_positions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  spv_id TEXT,
  security_id TEXT,
  shares TEXT,
  basis_minor INTEGER,
  acquired_at TEXT,
  status TEXT,
  prev_hash TEXT,
  curr_hash TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- ── 2. kv_* sources (4) — declare backup tables with explicit PK. ──────────
CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerSpvs (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerFunds (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerSpvPositions (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerFundCommitments (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

-- ── 3. Snapshot rows. `WHERE true ON CONFLICT DO NOTHING` — portable and ──
--     parseable (SQLite requires WHERE before ON CONFLICT on INSERT..SELECT).
--     Second invocations are true no-ops thanks to the PRIMARY KEY on `id`.
INSERT INTO wave_b_backup_spvs (
  id, tenant_id, partner_id, name, lead_company_id, structure_type, status,
  target_minor, committed_minor, called_minor, distributed_minor, gp_user_id,
  formed_at, closes_at, terms, prev_hash, curr_hash, created_at, updated_at, deleted_at,
  deployment_fee_minor, deployment_fee_currency, deployment_fee_payer,
  deployment_fee_paid_at, deployment_fee_schedule_id, sourcing_partner_id
)
SELECT id, tenant_id, partner_id, name, lead_company_id, structure_type, status,
       target_minor, committed_minor, called_minor, distributed_minor, gp_user_id,
       formed_at, closes_at, terms, prev_hash, curr_hash, created_at, updated_at, deleted_at,
       deployment_fee_minor, deployment_fee_currency, deployment_fee_payer,
       deployment_fee_paid_at, deployment_fee_schedule_id, sourcing_partner_id
FROM spvs
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_spv_commitments (
  id, tenant_id, spv_id, lp_user_id, amount_minor, status, commitment_doc_url,
  signed_at, funded_at, prev_hash, curr_hash, created_at, updated_at
)
SELECT id, tenant_id, spv_id, lp_user_id, amount_minor, status, commitment_doc_url,
       signed_at, funded_at, prev_hash, curr_hash, created_at, updated_at
FROM spv_commitments
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_spv_capital_calls (
  id, tenant_id, spv_id, sequence_no, amount_minor, called_at, due_at,
  prev_hash, curr_hash, created_at
)
SELECT id, tenant_id, spv_id, sequence_no, amount_minor, called_at, due_at,
       prev_hash, curr_hash, created_at
FROM spv_capital_calls
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_spv_distributions (
  id, tenant_id, spv_id, distribution_type, total_minor, distributed_at,
  prev_hash, curr_hash, created_at
)
SELECT id, tenant_id, spv_id, distribution_type, total_minor, distributed_at,
       prev_hash, curr_hash, created_at
FROM spv_distributions
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_spv_positions (
  id, tenant_id, spv_id, security_id, shares, basis_minor, acquired_at, status,
  prev_hash, curr_hash, created_at, updated_at
)
SELECT id, tenant_id, spv_id, security_id, shares, basis_minor, acquired_at, status,
       prev_hash, curr_hash, created_at, updated_at
FROM spv_positions
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_kv_partnerSpvs (id, payload_json, updated_at, deleted_at)
SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerSpvs
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_kv_partnerFunds (id, payload_json, updated_at, deleted_at)
SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerFunds
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_kv_partnerSpvPositions (id, payload_json, updated_at, deleted_at)
SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerSpvPositions
WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO wave_b_backup_kv_partnerFundCommitments (id, payload_json, updated_at, deleted_at)
SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerFundCommitments
WHERE true
ON CONFLICT (id) DO NOTHING;

-- ── 4. Mark applied. Portable CURRENT_TIMESTAMP works on SQLite + Postgres. ─
INSERT INTO _migrations_applied (key, applied_at, details)
VALUES ('wave_b_backup_ddl_v1', CURRENT_TIMESTAMP,
        'Wave B v26.4.0-fix2 backup DDL applied. 9 backup tables with PRIMARY KEY(id); spvs backup carries all 26 canonical columns.')
ON CONFLICT (key) DO NOTHING;
