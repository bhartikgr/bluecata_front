-- CP Phase B — GDPR / CCPA columns + audit logs (CP-013).
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE users ADD COLUMN deletion_token TEXT;
ALTER TABLE users ADD COLUMN anonymized_at TEXT;
ALTER TABLE users ADD COLUMN anonymized_by_user_id TEXT;

CREATE TABLE IF NOT EXISTS data_export_log (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'json',
  bytes INTEGER NOT NULL DEFAULT 0,
  request_ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_export_log_user    ON data_export_log(user_id);
CREATE INDEX IF NOT EXISTS idx_data_export_log_tenant  ON data_export_log(tenant_id);

CREATE TABLE IF NOT EXISTS data_delete_log (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  confirmed_at TEXT,
  initiated_by_user_id TEXT NOT NULL,
  reason TEXT,
  records_redacted INTEGER NOT NULL DEFAULT 0,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_delete_log_user    ON data_delete_log(user_id);
CREATE INDEX IF NOT EXISTS idx_data_delete_log_tenant  ON data_delete_log(tenant_id);
