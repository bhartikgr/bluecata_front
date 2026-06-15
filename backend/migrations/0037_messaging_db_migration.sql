-- v19 Phase B — Messaging DB migration (remaining slices).
--
-- Moves the remaining in-memory messaging surfaces (DMs, group threads,
-- broadcasts, system messages) to durable storage. The v17 Collective slice
-- (collective_channel_posts) already migrated in Phase B v17 and STAYS as-is —
-- new tables here only cover the non-Collective channels.
--
-- Topology:
--   - messages: every individual message regardless of channel_type.
--   - message_threads: persistent thread (DM/group/broadcast) for the channel.
--   - message_read_receipts: per-(message, user) read marker. UNIQUE (message_id, user_id)
--     for idempotent UPSERT. Authoritative read state.
--
-- The `read_by` JSON array on `messages` is a denormalized cache for fast
-- card/list reads — `message_read_receipts` is the source of truth. Both are
-- updated inside the same SYNC tx by POST /api/messages/:id/read.
--
-- Hash chain: every message row carries (prev_hash, curr_hash) for audit
-- integrity. Threads also carry hashes so list reordering can be verified.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS. SQL is safe
-- to re-run on a populated DB.

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT,                                  -- nullable; non-chapter DMs/groups have NULL
  thread_id TEXT,                                   -- FK message_threads.id; nullable for one-shots
  channel_type TEXT NOT NULL,                       -- 'direct' | 'group' | 'thread' | 'broadcast' | 'system'
  sender_user_id TEXT NOT NULL,
  recipient_user_ids TEXT NOT NULL DEFAULT '[]',    -- JSON string[] of recipient user ids
  subject TEXT,
  body TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',           -- JSON string[] of URLs (file storage is Avi's)
  read_by TEXT NOT NULL DEFAULT '[]',               -- JSON string[] of userIds who've read (denormalized)
  status TEXT NOT NULL DEFAULT 'sent',              -- 'sent' | 'edited' | 'deleted'
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant       ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_chapter      ON messages(chapter_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread       ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_type ON messages(channel_type);
CREATE INDEX IF NOT EXISTS idx_messages_created      ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_status       ON messages(status);

CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT,                                  -- nullable; cross-chapter threads have NULL
  title TEXT NOT NULL DEFAULT '',
  participant_user_ids TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  last_message_id TEXT,                             -- FK messages.id (most recent)
  last_activity_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_threads_tenant     ON message_threads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_chapter    ON message_threads(chapter_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_created_by ON message_threads(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_activity   ON message_threads(last_activity_at);

CREATE TABLE IF NOT EXISTS message_read_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message ON message_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_message_read_receipts_user    ON message_read_receipts(user_id);
