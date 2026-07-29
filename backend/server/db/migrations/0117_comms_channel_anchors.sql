-- 0117_comms_channel_anchors.sql
-- w-collective Wave 2 Stage A (2026-07-28) — durable anchors on comms_channels.
--
-- ⚠️ `comms_channels` IS NOT MIGRATION-MANAGED. Before this file the table
-- existed ONLY as lazy runtime DDL inside persistChannel
-- (server/commsStore.ts:280-287), created on the first channel write. So on a
-- database where no channel has ever been persisted the table is ABSENT, and a
-- bare `ALTER TABLE comms_channels ADD COLUMN …` raises "no such table" —
-- which the migration runner does NOT swallow: isIdempotentSqliteError
-- (server/db/migrate.ts:203-210) covers only duplicate-column / already-exists,
-- and the no-such-table pass at :218-227 applies to CREATE INDEX statements
-- ONLY. An unguarded ALTER here would therefore abort the whole runner.
--
-- Hence the two-step shape below: CREATE TABLE IF NOT EXISTS in the EXACT
-- canonical shape currently produced at runtime, and only then the guarded
-- column adds. server/commsStore.ts:persistChannel is updated in the same
-- change set to emit this same shape, so the runtime path and the migration
-- path converge and cannot drift.
--
-- WHY THE ANCHORS. A channel's company / round / chapter is today known only
-- from in-memory derivation, so it dies at every restart and hydrated posts are
-- orphaned from the entity they belong to. Stage A only lands the columns;
-- populating and reading them is a later stage.
--
-- Additive + idempotent + mirrored (server/db/migrations/0117_*.sql) +
-- self-healed in server/db/connection.ts (CREATE literal for fresh DBs AND
-- guarded ADD COLUMN entries in applyV12AdditiveAlters for already-deployed
-- DBs — CREATE TABLE IF NOT EXISTS is a no-op on a DB whose comms_channels was
-- already built by the old runtime DDL, so the literal alone would never add
-- the anchors there).

-- Step 1 — canonical shape, byte-for-byte the columns persistChannel created.
CREATE TABLE IF NOT EXISTS comms_channels (
  id                        TEXT PRIMARY KEY NOT NULL,
  kind                      TEXT NOT NULL,
  participant_user_ids_json TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  metadata_json             TEXT,
  deleted_at                TEXT,
  company_id                TEXT,
  round_id                  TEXT,
  chapter_id                TEXT
);

-- Step 2 — guarded adds for a DB whose comms_channels already existed (created
-- by the pre-0117 runtime DDL, which had neither the anchors). SQLite has no
-- ADD COLUMN IF NOT EXISTS; per the convention documented in
-- migrations/0110_collective_membership_captable_exempt.sql:7-9 this relies on
-- the runner swallowing the duplicate-column error, so each statement is a
-- no-op on a DB that already has the column (including a fresh DB created by
-- step 1 above).
ALTER TABLE comms_channels ADD COLUMN company_id TEXT;
ALTER TABLE comms_channels ADD COLUMN round_id TEXT;
ALTER TABLE comms_channels ADD COLUMN chapter_id TEXT;
-- `kind` is part of the canonical shape and of the pre-0117 runtime shape, so
-- this statement is expected to be a swallowed no-op on every real database.
-- It is kept because the migration must not assume the shape of a database it
-- did not create: a pre-canonical comms_channels missing `kind` would otherwise
-- stay missing it forever. Added nullable — SQLite cannot ADD a NOT NULL
-- column without a default, and inventing a default kind would silently
-- mislabel existing channels.
ALTER TABLE comms_channels ADD COLUMN kind TEXT;

CREATE INDEX IF NOT EXISTS idx_comms_channels_company ON comms_channels(company_id);
CREATE INDEX IF NOT EXISTS idx_comms_channels_round ON comms_channels(round_id);
CREATE INDEX IF NOT EXISTS idx_comms_channels_chapter ON comms_channels(chapter_id);
CREATE INDEX IF NOT EXISTS idx_comms_channels_kind ON comms_channels(kind);
