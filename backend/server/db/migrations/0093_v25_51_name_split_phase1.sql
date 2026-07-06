-- 0093_v25_51_name_split_phase1.sql
-- v25.51.0 platform-wide First/Last name split — Phase 1 editable surfaces.
-- ADDITIVE ONLY: discrete first/last name columns on four contact/invitation
-- tables. The legacy composed columns (`name` / `contact_name` / `investor_name`)
-- are still populated on write ("First Last") for byte-stable backward-compat
-- with existing readers, exports, and hash-chains. Mirrors the 0092 pattern.
-- Re-runnable: duplicate-column errors are swallowed by the migration runner's
-- idempotent guard (server/db/migrate.ts:isIdempotentSqliteError).

-- Partner CRM contacts (name is hash-chained; first/last are NOT hashed).
ALTER TABLE partner_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN last_name TEXT;

-- Consortium applications (contact_name is NOT hashed; first/last additive).
ALTER TABLE consortium_applications ADD COLUMN contact_first_name TEXT;
ALTER TABLE consortium_applications ADD COLUMN contact_last_name TEXT;

-- Round invitations.
ALTER TABLE round_invitations ADD COLUMN investor_first_name TEXT;
ALTER TABLE round_invitations ADD COLUMN investor_last_name TEXT;

-- Soft circles.
ALTER TABLE soft_circles ADD COLUMN investor_first_name TEXT;
ALTER TABLE soft_circles ADD COLUMN investor_last_name TEXT;

-- Phase 2 core identity — users + user_credentials. users.name is kept composed
-- (invariant relied on by SACRED userContext.ts / userPrivacyResolver.ts readers).
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE user_credentials ADD COLUMN first_name TEXT;
ALTER TABLE user_credentials ADD COLUMN last_name TEXT;
