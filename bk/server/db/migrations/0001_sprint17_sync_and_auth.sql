-- Sprint 17 D1 — initial migration
-- Postgres-compatible. Run in order with `drizzle-kit migrate` or psql -f.
-- All entities use UUID/text IDs and a JSON payload column for the
-- canonical document, with selected hot fields extracted as columns.

-- 24 sync entities -------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_company (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  payload TEXT NOT NULL,
  name TEXT, sector TEXT, stage TEXT
);

CREATE TABLE IF NOT EXISTS sync_investor (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL,
  email TEXT, type TEXT
);

CREATE TABLE IF NOT EXISTS sync_cap_table_position (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL,
  company_id TEXT, holder_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_soft_circle (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL,
  round_id TEXT, investor_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_round (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL,
  company_id TEXT, state TEXT
);

CREATE TABLE IF NOT EXISTS sync_ma_intelligence (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, company_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_eligibility_snapshot (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, investor_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_lifecycle_policy (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, scope TEXT
);

CREATE TABLE IF NOT EXISTS sync_audit_entry (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL,
  hash_chain TEXT, actor_id TEXT, action TEXT
);

CREATE TABLE IF NOT EXISTS sync_kyc_record (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, subject_id TEXT, status TEXT
);

CREATE TABLE IF NOT EXISTS sync_accreditation (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, investor_id TEXT, status TEXT
);

CREATE TABLE IF NOT EXISTS sync_member_tier (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, user_id TEXT, tier TEXT
);

CREATE TABLE IF NOT EXISTS sync_consortium_partner (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, region TEXT
);

CREATE TABLE IF NOT EXISTS sync_term_sheet (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, round_id TEXT, state TEXT
);

CREATE TABLE IF NOT EXISTS sync_dataroom_permission (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, file_id TEXT, grantee_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_dataroom_file_meta (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, company_id TEXT, filename TEXT
);

CREATE TABLE IF NOT EXISTS sync_notification_prefs (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, user_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_pricing_tier (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, tier TEXT
);

CREATE TABLE IF NOT EXISTS sync_comms_thread (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, channel_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_pcrm_contact (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, owner_id TEXT, email TEXT
);

CREATE TABLE IF NOT EXISTS sync_post (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, author_id TEXT, channel_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_report (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, company_id TEXT, period TEXT
);

CREATE TABLE IF NOT EXISTS sync_spv_score (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, investor_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_social_signal (
  id TEXT PRIMARY KEY, tenant_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
  payload TEXT NOT NULL, subject_id TEXT
);

-- Auth + sessions ---------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  role TEXT NOT NULL DEFAULT 'founder',
  status TEXT NOT NULL DEFAULT 'active',
  totp_secret TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS auth_redeem_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  intent TEXT NOT NULL,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sync_company_tenant ON sync_company(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_investor_email ON sync_investor(email);
CREATE INDEX IF NOT EXISTS idx_sync_round_company ON sync_round(company_id);
CREATE INDEX IF NOT EXISTS idx_sync_audit_actor ON sync_audit_entry(actor_id);
CREATE INDEX IF NOT EXISTS idx_sync_post_channel ON sync_post(channel_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_redeem_email ON auth_redeem_tokens(email);
