-- 0100_v25_54_rounds_archived_at
-- v25.54 G0-2 — founder-initiated round archival.
--
-- Founders need to retire a round that is no longer relevant WITHOUT deleting
-- it: archived rounds must stay VISIBLE-BUT-INERT (greyed, no new invites/edits)
-- rather than disappearing the way soft-deleted rows (deleted_at) do. Repurposing
-- deleted_at would hide the round and conflate two distinct lifecycle states, so
-- we introduce a SEPARATE nullable timestamp column instead:
--   archived_at IS NULL  → live round (normal behaviour)
--   archived_at = <iso>   → archived round (still readable; inert)
--
-- ADDITIVE + IDEMPOTENT. `ALTER TABLE ... ADD COLUMN` on a nullable column is
-- non-destructive; re-running raises "duplicate column name", which the migrate
-- runner (server/db/migrate.ts isIdempotentSkip) swallows. deleted_at semantics
-- are untouched. This file is mirrored VERBATIM in both migrations/ and
-- server/db/migrations/, plus the inline applyInlineMigrations() alters
-- (connection.ts) for :memory: test DBs.

ALTER TABLE rounds ADD COLUMN archived_at TEXT;
