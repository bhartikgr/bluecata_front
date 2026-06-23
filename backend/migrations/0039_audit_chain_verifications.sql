-- v19 Phase C — quarterly audit-chain verification history.
-- Idempotent CREATE TABLE IF NOT EXISTS + indexes.

CREATE TABLE IF NOT EXISTS audit_chain_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT,
  table_name TEXT NOT NULL,
  verified_count INTEGER NOT NULL DEFAULT 0,
  broken_count INTEGER NOT NULL DEFAULT 0,
  broken_first_id TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_tenant
  ON audit_chain_verifications (tenant_id, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_chapter
  ON audit_chain_verifications (chapter_id, table_name, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_table
  ON audit_chain_verifications (table_name, started_at);
