-- Patch v12 Day 2 Wave 2 — dataroom extensions.
-- Adds tenant scoping + folder + integrity columns to dataroom_files,
-- and creates the three sister tables for folders, permissions, events.
--
-- SQLite restriction: ADD COLUMN only; we cannot rewrite an existing table.
-- Each ALTER is wrapped at runtime (server/db/connection.ts applyV12AdditiveAlters)
-- so duplicate-column errors are swallowed on re-run.

ALTER TABLE dataroom_files ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_unknown';
ALTER TABLE dataroom_files ADD COLUMN folder_id TEXT NOT NULL DEFAULT '';
ALTER TABLE dataroom_files ADD COLUMN uploaded_by_id TEXT;
ALTER TABLE dataroom_files ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE dataroom_files ADD COLUMN watermark INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dataroom_files ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS dataroom_folders (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_round_folder INTEGER NOT NULL DEFAULT 0,
  round_id TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dataroom_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  investor_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  view INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS dataroom_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_dataroom_folders_company ON dataroom_folders(company_id);
CREATE INDEX IF NOT EXISTS idx_dataroom_files_company ON dataroom_files(company_id);
CREATE INDEX IF NOT EXISTS idx_dataroom_files_folder ON dataroom_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_dataroom_permissions_folder ON dataroom_permissions(folder_id, investor_id);
CREATE INDEX IF NOT EXISTS idx_dataroom_events_company ON dataroom_events(company_id, ts);
