-- v19 Phase A — Chapter announcements.
--
-- Per-chapter announcements posted by chapter admins. Audience visibility
-- ('all' | 'members' | 'admins') controls who sees each announcement.
-- Pinned/priority/expires_at give the UI knobs to surface time-sensitive
-- communication. Hash-chained per row (prev_hash → curr_hash) across every
-- edit / pin / delete so the announcement stream is audit-grade.
--
-- A second table `announcement_reads` carries one row per (announcement, user)
-- so the UI can render an unread badge. UNIQUE(announcement_id, user_id)
-- enforces the one-read-row-per-user-per-announcement invariant; idempotent
-- upserts in the read-tracking endpoint make repeat detail reads a no-op.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS chapter_announcements (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  title TEXT NOT NULL,                            -- ≤200 chars at route boundary
  body TEXT NOT NULL,                             -- ≤10000 chars at route boundary
  pinned INTEGER NOT NULL DEFAULT 0,              -- 0/1 boolean
  priority TEXT NOT NULL DEFAULT 'normal',        -- 'low' | 'normal' | 'high' | 'urgent'
  audience TEXT NOT NULL DEFAULT 'all',           -- 'all' | 'members' | 'admins'
  expires_at TEXT,                                -- nullable ISO timestamp
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  UNIQUE(announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_announcements_tenant   ON chapter_announcements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_chapter  ON chapter_announcements(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_author   ON chapter_announcements(author_user_id);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_pinned   ON chapter_announcements(pinned);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_priority ON chapter_announcements(priority);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_expires  ON chapter_announcements(expires_at);
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_created  ON chapter_announcements(created_at);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement ON announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user        ON announcement_reads(user_id);
