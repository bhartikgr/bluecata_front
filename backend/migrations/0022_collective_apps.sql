-- v17 Phase B — Migrate collectiveApp (investor membership applications) to DB.
-- Idempotent: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS collective_apps (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'submitted',
  payload_json  TEXT NOT NULL,
  submitted_at  TEXT NOT NULL,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_collective_apps_tenant  ON collective_apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_apps_chapter ON collective_apps(chapter_id);
CREATE INDEX IF NOT EXISTS idx_collective_apps_user    ON collective_apps(user_id);
CREATE INDEX IF NOT EXISTS idx_collective_apps_status  ON collective_apps(status);
