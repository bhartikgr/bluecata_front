-- 0119_network_post_engagement.sql
-- w-collective Wave 2 Stage A (2026-07-28) — durable per-user post engagement.
--
-- WHY. Likes, comments and shares live only in the in-memory Post object.
-- restorePostFromDb (server/commsStore.ts:2555-2625) proves it: on hydrate it
-- resets likedByUserIds to [], commentCount to 0, comments to [] and shareCount
-- to 0, because there is nowhere durable to read them from. Every restart wipes
-- all engagement on LIVE. Stage A lands the tables only; the endpoints that
-- write them and the hydrate path that reads them are a later stage.
--
-- NO SILENT DROPS: the existing aggregate integer columns network_posts.likes
-- and network_posts.comments are KEPT exactly as they are. They are not removed,
-- renamed or repurposed by this migration. Later stages keep them consistent
-- with the per-user rows below (the aggregates remain the cheap read for feed
-- projection; these tables are the source of truth for "did *I* like it").
--
-- Additive + idempotent + mirrored (server/db/migrations/0119_*.sql) +
-- self-healed in server/db/connection.ts (CREATE literals in
-- buildCreateTableStatements; all three tables are new so no guarded ADD COLUMN
-- half is required).

CREATE TABLE IF NOT EXISTS network_post_likes (
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- The composite primary key already enforces one like per (post, user); the
-- explicit unique index is kept for parity with the brief's contract and is a
-- harmless no-op index on the same pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_post_likes_post_user
  ON network_post_likes(post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_network_post_likes_post ON network_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_network_post_likes_user ON network_post_likes(user_id);

-- Comments are soft-deletable (deleted_at) because a deleted comment must stay
-- auditable and must not silently renumber the aggregate on network_posts.
CREATE TABLE IF NOT EXISTS network_post_comments (
  id             TEXT PRIMARY KEY NOT NULL,
  post_id        TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_network_post_comments_post
  ON network_post_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_network_post_comments_author
  ON network_post_comments(author_user_id);

-- Shares are an append-only event log: the same user may share a post more than
-- once, so there is deliberately NO uniqueness on (post_id, user_id) here.
CREATE TABLE IF NOT EXISTS network_post_shares (
  id         TEXT PRIMARY KEY NOT NULL,
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_network_post_shares_post ON network_post_shares(post_id);
CREATE INDEX IF NOT EXISTS idx_network_post_shares_user ON network_post_shares(user_id);
