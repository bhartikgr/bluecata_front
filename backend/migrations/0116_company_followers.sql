-- 0116_company_followers.sql
-- w-collective Wave 2 Stage A (2026-07-28) — durable per-USER company follow relation.
--
-- WHY. "Following a company" has no durable home today. The only followers that
-- exist are in-memory demo seed arrays (server/commsStore.ts:489,
-- SEED_FOLLOWERS_NOVAPAY) which are empty in production, and the live endpoint
-- POST /api/comms/posts/:id/follow (server/commsStore.ts:2116) writes the
-- followed company id onto the POST object rather than onto the user. Two
-- consequences on LIVE today: (a) "which users follow this company" is
-- unanswerable, and (b) every follow is lost on restart.
--
-- STAGE A CREATES THE TABLE ONLY. The endpoint rewiring is a later stage; this
-- migration deliberately changes no behaviour and drops nothing.
--
-- Additive + idempotent + mirrored (server/db/migrations/0116_*.sql) +
-- self-healed in server/db/connection.ts (CREATE literal in
-- buildCreateTableStatements for fresh DBs; the table is new so no guarded
-- ADD COLUMN half is required). Touches no sacred file, no money core.

CREATE TABLE IF NOT EXISTS company_followers (
  id          TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  user_id     TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT,
  deleted_at  TEXT
);

-- Uniqueness is on the PAIR and intentionally NOT partial on `deleted_at IS
-- NULL`: exactly one row per (user, company) for all time. An unfollow sets
-- deleted_at (reversible + auditable via created_at/updated_at/deleted_at), and
-- a re-follow is therefore an upsert
--   ON CONFLICT(user_id, company_id) DO UPDATE SET deleted_at = NULL, updated_at = ?
-- rather than a second row. Trade-off recorded deliberately: this gives a
-- single durable answer to "does U follow C?" and cannot accumulate duplicate
-- live rows, at the cost of not retaining a full follow/unfollow *history*
-- (only the latest transition). A history table is out of Stage A scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_followers_user_company
  ON company_followers(user_id, company_id);

-- Both lookup directions are first-class reads for the feed:
--   "companies this user follows"  -> idx_company_followers_user
--   "users following this company" -> idx_company_followers_company
CREATE INDEX IF NOT EXISTS idx_company_followers_user
  ON company_followers(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_company_followers_company
  ON company_followers(company_id, deleted_at);
