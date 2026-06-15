-- v13 — Avi's Issue 4: Investor Reports DB-backed.
-- Mirror of the canonical statement in server/db/connection.ts.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  period TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  content_json TEXT NOT NULL,
  delivery_targets_json TEXT,
  generated_at TEXT,
  generated_by TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_company ON reports(company_id);
CREATE INDEX IF NOT EXISTS idx_reports_tenant  ON reports(tenant_id);
