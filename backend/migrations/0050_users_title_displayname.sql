-- =============================================================================
-- Wave C / FIX C2 — Settings profile durability (title + displayName).
--
-- Per founder QA (Ozan, 24-May-2026): PATCH /api/auth/me currently mirrors
-- `name` and `avatarUrl` into the `users` table (Avi 22-May Issue 6 fix)
-- but `title`, `displayName`, and `email` are dropped on restart because
-- only the in-memory `_meStore` Map cache holds them.
--
-- This migration adds the two missing columns. `email` is already a column
-- in `users` (the canonical login identifier) — Wave C makes PATCH update
-- it inline. `title` (e.g. "CEO", "Founder & CFO") and `display_name`
-- (a friendly screen name distinct from legal `name`) are new.
--
-- IDEMPOTENT: SQLite "duplicate column name" / Postgres "already exists"
-- errors are swallowed by the migration runner (server/db/migrate.ts).
-- Safe to re-run.
--
-- Math-sacred guarantee: this migration touches the `users` table ONLY.
-- It does not modify any cap-table / round / commit / chain tables.
-- =============================================================================

ALTER TABLE users ADD COLUMN title TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
