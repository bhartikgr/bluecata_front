-- v17 Phase B — collectiveSettings (per-user settings, hash-chained). Idempotent.

CREATE TABLE IF NOT EXISTS collective_settings (
  user_id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id                  TEXT NOT NULL,
  chapter_id                 TEXT NOT NULL,
  anonymity_level            TEXT NOT NULL DEFAULT 'public',
  notify_on_dsc_score        INTEGER NOT NULL DEFAULT 1,
  notify_on_deal_room_update INTEGER NOT NULL DEFAULT 1,
  deal_room_visibility       TEXT NOT NULL DEFAULT 'visible',
  version                    INTEGER NOT NULL DEFAULT 1,
  prev_hash                  TEXT,
  hash                       TEXT NOT NULL,
  updated_by                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  deleted_at                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_collective_settings_tenant  ON collective_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_settings_chapter ON collective_settings(chapter_id);
