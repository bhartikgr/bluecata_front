-- v17 Phase B — Migrate collectiveMembership (active membership rows) to DB.
-- Idempotent.

CREATE TABLE IF NOT EXISTS collective_memberships (
  user_id          TEXT PRIMARY KEY NOT NULL,
  tenant_id        TEXT NOT NULL,
  chapter_id       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  tier             TEXT NOT NULL DEFAULT 'standard',
  activated_at     TEXT NOT NULL,
  activated_by     TEXT NOT NULL,
  deactivated_at   TEXT,
  deactivated_by   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_collective_memberships_tenant  ON collective_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_memberships_chapter ON collective_memberships(chapter_id);
CREATE INDEX IF NOT EXISTS idx_collective_memberships_status  ON collective_memberships(status);
