-- Patch v12 Day 2 Wave 2 — contacts.tenant_id + contact_revisions hash chain.
-- adminContactsStore is the HIGHEST-RISK migration of Wave 2 (10 non-test
-- importers, 8 test files). contact_revisions is a new sibling table
-- holding the immutable per-contact history; the current row lives in
-- the existing `contacts` table.

ALTER TABLE contacts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_platform';
ALTER TABLE contacts ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS contact_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  contact_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prev_revision_hash TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_revisions_contact ON contact_revisions(contact_id, version);
