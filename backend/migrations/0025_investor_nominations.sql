-- v17 Phase B — sprint21Portfolio investor nominations (hash-chained audit trail).
-- Idempotent.

CREATE TABLE IF NOT EXISTS investor_nominations (
  id                  TEXT PRIMARY KEY NOT NULL,
  tenant_id           TEXT NOT NULL,
  chapter_id          TEXT NOT NULL,
  investor_user_id    TEXT NOT NULL,
  company_id          TEXT NOT NULL,
  rationale           TEXT NOT NULL,
  prev_hash           TEXT,
  hash                TEXT NOT NULL,
  submitted_at        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT,
  deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_invnom_tenant   ON investor_nominations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invnom_chapter  ON investor_nominations(chapter_id);
CREATE INDEX IF NOT EXISTS idx_invnom_investor ON investor_nominations(investor_user_id);
CREATE INDEX IF NOT EXISTS idx_invnom_company  ON investor_nominations(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invnom_investor_company
  ON investor_nominations(investor_user_id, company_id) WHERE deleted_at IS NULL;
