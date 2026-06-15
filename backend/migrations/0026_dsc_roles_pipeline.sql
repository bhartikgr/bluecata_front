-- v17 Phase B — adminDsc role assignments + pipeline. Idempotent.

CREATE TABLE IF NOT EXISTS dsc_roles (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  prev_hash     TEXT,
  hash          TEXT NOT NULL,
  promoted_by   TEXT NOT NULL,
  promoted_at   TEXT NOT NULL,
  demoted_at    TEXT,
  demoted_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_dsc_roles_tenant  ON dsc_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsc_roles_chapter ON dsc_roles(chapter_id);
CREATE INDEX IF NOT EXISTS idx_dsc_roles_user    ON dsc_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_dsc_roles_status  ON dsc_roles(status);

CREATE TABLE IF NOT EXISTS dsc_pipeline (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  company_id    TEXT NOT NULL,
  submitted_by  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  submitted_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_tenant  ON dsc_pipeline(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_chapter ON dsc_pipeline(chapter_id);
CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_company ON dsc_pipeline(company_id);
CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_status  ON dsc_pipeline(status);
