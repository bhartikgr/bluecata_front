-- WAVE 36 · ROW 8 — the v25.51 name-split columns, for a FRESH INSTALL.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DEFECT
-- ─────────────────────────────────────────────────────────────────────────────
-- The v25.51 name split shipped as three migrations that were written into the
-- MIRROR only:
--     server/db/migrations/0092_v25_51_founder_crm_first_last_company.sql
--     server/db/migrations/0093_v25_51_name_split_phase1.sql
--     server/db/migrations/0095_v25_51_name_split_phase4.sql
-- No 0092/0093/0095 with those names has ever existed in canonical `migrations/`.
-- A deployment that installs from the canonical directory therefore ends up with
-- EIGHT tables missing NINETEEN columns that the running code selects, inserts
-- and updates.
--
-- It has not blown up in dev because `server/db/connection.ts` self-heals the
-- same columns — `applyV12AdditiveAlters` (lines ~2710-2732) plus the
-- founder-CRM alters at ~1793-1795. That self-heal is reached only on the
-- SQLITE branch: `getDb()` returns early for Postgres (connection.ts:115), so
-- on the Postgres branch the columns are supplied by NOTHING AT ALL.
--
-- The second review reported 12 columns. The true count is 19: every
-- `first_name` half it listed has a `last_name` half that is missing on exactly
-- the same terms, plus `founder_crm_contacts.company_name`. All 19 are here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW FORWARD MIGRATION AND NOT A BACK-PORT
-- ─────────────────────────────────────────────────────────────────────────────
-- Back-filling 0092/0093/0095 into canonical `migrations/` would insert files
-- BELOW the high-water mark of every already-deployed database. Those databases
-- record applied filenames in `__drizzle_migrations_applied`, so newly inserted
-- historical files would be seen as never-applied and would run out of order
-- against a schema that has moved on. A forward migration is the only safe
-- shape: it runs once, everywhere, in order.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY ON BOTH BRANCHES
-- ─────────────────────────────────────────────────────────────────────────────
-- SQLite has no `ADD COLUMN IF NOT EXISTS`. Per the convention documented in
-- migrations/0110_collective_membership_captable_exempt.sql:7-9 and used by
-- migrations/0120_user_profile_location.sql, a bare `ALTER TABLE … ADD COLUMN`
-- is the portable form: the runner swallows the duplicate-column error per
-- STATEMENT on both branches —
--     server/db/migrate.ts  isIdempotentSqliteError()   /duplicate column name/i
--     server/db/migrate.ts  isIdempotentPostgresError() /column .* already exists/i
-- so on an already-self-healed SQLite database every statement below is a no-op,
-- and on a fresh Postgres database every statement does real work. Both were
-- executed and asserted on the resulting SCHEMA (not on an exit code) in
-- server/__tests__/wave36_fresh_install_name_split.test.ts.
--
-- Additive only. TEXT, nullable, no default, no backfill, no row rewritten.
-- `captable_commits` holder names are METADATA ONLY: they are never part of the
-- commit hash-chain and never enter any amount or share arithmetic.

-- ── founder CRM (mirror 0092) ───────────────────────────────────────────────
ALTER TABLE founder_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN last_name TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN company_name TEXT;

-- ── name-split phase 1 (mirror 0093) ────────────────────────────────────────
ALTER TABLE partner_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN last_name TEXT;
ALTER TABLE consortium_applications ADD COLUMN contact_first_name TEXT;
ALTER TABLE consortium_applications ADD COLUMN contact_last_name TEXT;
ALTER TABLE round_invitations ADD COLUMN investor_first_name TEXT;
ALTER TABLE round_invitations ADD COLUMN investor_last_name TEXT;
ALTER TABLE soft_circles ADD COLUMN investor_first_name TEXT;
ALTER TABLE soft_circles ADD COLUMN investor_last_name TEXT;
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE user_credentials ADD COLUMN first_name TEXT;
ALTER TABLE user_credentials ADD COLUMN last_name TEXT;

-- ── name-split phase 4 (mirror 0095) ────────────────────────────────────────
ALTER TABLE investor_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE investor_crm_contacts ADD COLUMN last_name TEXT;
ALTER TABLE captable_commits ADD COLUMN holder_first_name TEXT;
ALTER TABLE captable_commits ADD COLUMN holder_last_name TEXT;
