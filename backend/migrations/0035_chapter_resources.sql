-- v19 Phase A — Chapter resources library.
--
-- Per-chapter library of shared knowledge resources (docs / links / videos /
-- templates / guides). Submissions follow a moderation flow:
--
--   - Submissions from chapter ADMINS land directly in status='active'.
--   - Submissions from regular members land in status='pending' and require
--     admin approval (status='active') or rejection (status='rejected').
--   - Any member can flag a resource (status='flagged') and a chapter admin
--     can re-approve or hard-delete after review.
--
-- The `download_count` is a denormalized counter incremented atomically inside
-- a SYNC tx when GET /:id?track_download=1 is invoked. URL-based resources
-- always work; binary uploads are env-gated by RESOURCES_STORAGE_PROVIDER
-- (Avi configures S3 / Cloudflare R2 in production — unset → 503 on upload).
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS chapter_resources (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  title TEXT NOT NULL,                              -- ≤200 chars at route boundary
  description TEXT NOT NULL DEFAULT '',             -- ≤4000 chars at route boundary
  resource_type TEXT NOT NULL DEFAULT 'link',       -- 'document' | 'link' | 'video' | 'template' | 'guide'
  url TEXT NOT NULL,                                -- link URL OR storage path
  file_size_bytes INTEGER,
  mime_type TEXT,
  tags TEXT NOT NULL DEFAULT '[]',                  -- JSON string[] (≤8 tags)
  visibility TEXT NOT NULL DEFAULT 'members',       -- 'public' | 'members' | 'admins'
  status TEXT NOT NULL DEFAULT 'pending',           -- 'pending' | 'active' | 'rejected' | 'flagged'
  rejection_reason TEXT,                            -- reason supplied on /reject
  flag_reason TEXT,                                 -- reason supplied on /flag
  flagged_by_user_id TEXT,
  flagged_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chapter_resources_tenant     ON chapter_resources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_chapter    ON chapter_resources(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_uploader   ON chapter_resources(uploader_user_id);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_type       ON chapter_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_visibility ON chapter_resources(visibility);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_status     ON chapter_resources(status);
CREATE INDEX IF NOT EXISTS idx_chapter_resources_created    ON chapter_resources(created_at);
