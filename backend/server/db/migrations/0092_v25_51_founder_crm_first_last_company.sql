-- 0092_v25_51_founder_crm_first_last_company.sql
-- v25.51.0 item 6a (Shadie Rounds build wave) — founder CRM captures discrete
-- First name / Last name (mandatory) + Company name (optional) as first-class
-- fields, replacing the single free-text "Firm name" identity field.
-- ADDITIVE ONLY: three nullable columns on founder_crm_contacts. The legacy
-- `name` / `firmName` columns are still populated on write for backward-compat
-- with existing readers/exports. Mirrors the 0069 additive-column pattern.
-- Re-runnable: duplicate-column errors are swallowed by the migration runner's
-- idempotent guard (server/db/migrate.ts:isIdempotentSqliteError).
ALTER TABLE founder_crm_contacts ADD COLUMN first_name TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN last_name TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN company_name TEXT;
