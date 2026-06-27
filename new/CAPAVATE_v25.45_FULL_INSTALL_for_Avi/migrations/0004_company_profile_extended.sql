-- Patch v12 Day 2 Wave 1 — migrations 0004
-- Migrates two in-memory stores to DB-backed write-through:
--   • server/companyProfileStore.ts  → company_profile_extended (JSON blob)
--   • server/adminPlatformStore.ts   → audit_log (already exists, no change)
--                                    + recon_runs (new)
--                                    + founder_tiers (new)
--                                    + platform_config (already exists; used by lifecycle policies)
--
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS). Safe to re-apply.

CREATE TABLE IF NOT EXISTS company_profile_extended (
  company_id TEXT PRIMARY KEY NOT NULL,
  tenant_id  TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  prev_hash  TEXT,
  hash       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_profile_extended_tenant ON company_profile_extended(tenant_id);

CREATE TABLE IF NOT EXISTS recon_runs (
  id         TEXT PRIMARY KEY NOT NULL,
  tenant_id  TEXT NOT NULL,
  company_id TEXT NOT NULL,
  round_id   TEXT NOT NULL,
  ts         TEXT NOT NULL,
  engine_main_json TEXT NOT NULL,
  engine_ref_json  TEXT NOT NULL,
  diff_json  TEXT NOT NULL,
  actor      TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recon_runs_company ON recon_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_recon_runs_tenant ON recon_runs(tenant_id);

CREATE TABLE IF NOT EXISTS founder_tiers (
  id           TEXT PRIMARY KEY NOT NULL,
  name         TEXT NOT NULL,
  usd_monthly  INTEGER NOT NULL,
  features_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL DEFAULT 'system',
  deleted_at   TEXT
);

-- audit_log already exists from 0002 / connection.ts; no DDL change here.
-- platform_config already exists; lifecycle policies will upsert by key='lifecycle_policies'.
-- Index helps the hash-chain tip lookup (`SELECT … ORDER BY created_at DESC LIMIT 1` per tenant).
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log(tenant_id, created_at);
