-- v17 Phase A — Chapter scoping (load-bearing schema change).
--
-- Creates the `chapters` and `chapter_memberships` tables, and adds an
-- additive nullable `chapter_id` column to every existing physical
-- Collective slice table:
--   - collective_waitlist  (v16 Fix 6)
--   - dsc_feedback         (v16 Addendum A)
--   - dsc_votes            (v16 Addendum B)
--   - soft_circles         (v15 P0-9; carries chapter for soft-circle attribution)
--
-- NOTE: the broader brief (V19_BUILD_BRIEF.md §v17 Phase A) lists 8 target
-- tables. Of those 8, four are still in-memory stores slated for Phase B
-- migration (collective_app, collective_membership, founder_collective_apply,
-- sprint21_portfolio_nominations, admin_dsc_pipeline, collective_settings,
-- partner_workspace). Adding a `chapter_id` column to a table that does not
-- yet exist would violate Quality Rule 2 ("NO mock data — every line must
-- work against real Drizzle"). When those stores are migrated in v17 Phase B,
-- their CREATE TABLE statements must include `chapter_id TEXT NOT NULL`
-- from the start (this file documents that contract for the Phase-B agent).
--
-- Idempotent: every CREATE TABLE uses IF NOT EXISTS; every ALTER is wrapped
-- in a Postgres DO block / SQLite duplicate-column tolerant catch at the
-- inline-migration call site in server/db/connection.ts. Safe to re-run.

CREATE TABLE IF NOT EXISTS chapters (
  id                            TEXT PRIMARY KEY NOT NULL,
  tenant_id                     TEXT NOT NULL,
  name                          TEXT NOT NULL,
  region                        TEXT NOT NULL,
  city                          TEXT,
  status                        TEXT NOT NULL DEFAULT 'active',
  admin_user_id                 TEXT,
  partner_org_id                TEXT,
  membership_fee_annual_minor   INTEGER DEFAULT 0,
  founded                       TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT,
  deleted_at                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_chapters_tenant ON chapters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status);
CREATE INDEX IF NOT EXISTS idx_chapters_region ON chapters(region);

CREATE TABLE IF NOT EXISTS chapter_memberships (
  id          TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT NOT NULL,
  chapter_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',     -- 'member' | 'admin'
  status      TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'pending' | 'revoked'
  joined_at   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_chapter_memberships_tenant   ON chapter_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapter_memberships_chapter  ON chapter_memberships(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_memberships_user     ON chapter_memberships(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_memberships_chapter_user
  ON chapter_memberships(chapter_id, user_id);

-- Additive nullable chapter_id columns on existing physical Collective tables.
-- SQLite re-running ALTER TABLE on an existing column raises "duplicate
-- column name" — the inline-migration runner in server/db/connection.ts
-- swallows that error so this is safe to re-run.
ALTER TABLE collective_waitlist ADD COLUMN chapter_id TEXT;
ALTER TABLE dsc_feedback        ADD COLUMN chapter_id TEXT;
ALTER TABLE dsc_votes           ADD COLUMN chapter_id TEXT;
ALTER TABLE soft_circles        ADD COLUMN chapter_id TEXT;

CREATE INDEX IF NOT EXISTS idx_collective_waitlist_chapter ON collective_waitlist(chapter_id);
CREATE INDEX IF NOT EXISTS idx_dsc_feedback_chapter        ON dsc_feedback(chapter_id);
CREATE INDEX IF NOT EXISTS idx_dsc_votes_chapter           ON dsc_votes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_soft_circles_chapter        ON soft_circles(chapter_id);
