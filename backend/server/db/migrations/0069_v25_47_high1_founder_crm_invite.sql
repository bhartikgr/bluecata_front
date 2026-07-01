-- 0069_v25_47_high1_founder_crm_invite.sql
-- v25.47 APD-033 (HIGH-1) — founder CRM invited-contact tagging.
-- ADDITIVE ONLY: nullable columns on founder_crm_contacts. Mirrors the
-- connection.ts bootstrap (applyV2547Schema). Re-runnable: duplicate-column
-- errors are swallowed by the migration runner's idempotent guard.
ALTER TABLE founder_crm_contacts ADD COLUMN invite_status TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN invited_round_id TEXT;
ALTER TABLE founder_crm_contacts ADD COLUMN invited_at TEXT;
