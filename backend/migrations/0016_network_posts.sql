-- v13 — Avi's Issue 5: Network Posts DB-backed.
-- Mirror of the canonical statement in server/db/connection.ts.

CREATE TABLE IF NOT EXISTS network_posts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  body TEXT NOT NULL,
  content_json TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  parent_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_network_posts_tenant ON network_posts(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_network_posts_author ON network_posts(author_user_id);
