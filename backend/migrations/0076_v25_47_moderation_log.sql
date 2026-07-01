-- 0076_v25_47_moderation_log.sql
-- v25.47 APD-023 — Network post moderation audit log.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS + index. Mirrors connection.ts
-- applyV2547Schema. Moderation acts on network_posts.deleted_at; this table
-- is the append-only audit trail of flag/hide/unhide actions.
CREATE TABLE IF NOT EXISTS moderation_log (
  id          TEXT PRIMARY KEY NOT NULL,
  post_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_log_post ON moderation_log (post_id);
