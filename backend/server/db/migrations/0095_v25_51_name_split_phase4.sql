-- 0095_v25_51_name_split_phase4.sql
-- v25.51.0 platform-wide First/Last name split — Phase 4 authorized sacred surfaces.
-- ADDITIVE ONLY. The legacy composed columns (`name` / `holder_name`) stay
-- authoritative and byte-stable for all readers, exports, and hash-chains.
-- Re-runnable: duplicate-column errors are swallowed by the migration runner's
-- idempotent guard (server/db/migrate.ts:isIdempotentSqliteError).

-- Investor CRM contacts (#6) — discrete identity; composed `name` kept.
ALTER TABLE investor_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE investor_crm_contacts ADD COLUMN last_name TEXT;

-- Cap-table holder names (#15) — OPTIONAL metadata ONLY. These columns are
-- NEVER part of the commit hash-chain (captableCommitStore.buildCommitBody is
-- unchanged) nor any amount/share computation. `holder_name` on the securities
-- table (cap-table-engine) remains untouched and authoritative.
ALTER TABLE captable_commits ADD COLUMN holder_first_name TEXT;
ALTER TABLE captable_commits ADD COLUMN holder_last_name TEXT;
