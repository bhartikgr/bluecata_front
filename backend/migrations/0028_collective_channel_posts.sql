-- v17 Phase B — commsStore Collective slice (Collective-channel posts only). Idempotent.

CREATE TABLE IF NOT EXISTS collective_channel_posts (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT NOT NULL,
  chapter_id        TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  author_user_id    TEXT NOT NULL,
  author_kind       TEXT NOT NULL DEFAULT 'user',
  body              TEXT NOT NULL,
  visibility        TEXT NOT NULL DEFAULT 'public_to_collective',
  liked_by_json     TEXT NOT NULL DEFAULT '[]',
  comments_json     TEXT NOT NULL DEFAULT '[]',
  comment_count     INTEGER NOT NULL DEFAULT 0,
  share_count       INTEGER NOT NULL DEFAULT 0,
  topics_json       TEXT,
  media_urls_json   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  edited_at         TEXT,
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_tenant     ON collective_channel_posts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_chapter    ON collective_channel_posts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_channel    ON collective_channel_posts(channel_id);
CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_author     ON collective_channel_posts(author_user_id);
CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_visibility ON collective_channel_posts(visibility);
