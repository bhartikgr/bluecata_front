-- Patch v12 Day 2 Wave 2 — legal_consents table (per-tenant hash chain).
-- Append-only ledger; soft-delete column for schema symmetry only.
CREATE TABLE IF NOT EXISTS legal_consents (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version TEXT NOT NULL,
  context TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_legal_consents_tenant ON legal_consents(tenant_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_legal_consents_user ON legal_consents(user_id);
