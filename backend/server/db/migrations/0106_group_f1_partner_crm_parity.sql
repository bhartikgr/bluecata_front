-- 0106_group_f1_partner_crm_parity
-- GROUP F1 — expand the EXISTING person-level partner CRM (partner_crm_contacts)
-- to full Capavate-CRM parity. ADDITIVE ONLY: seven nullable columns + two
-- indexes on the SAME table the CP-008 hash chain already covers. We do NOT add
-- a second table (that would fork the per-partner audit chain) and we do NOT
-- touch the existing company-level partner_client_crm surface.
--
-- Column parity mirrors investor_crm_contacts (shared/schema.ts):
--   stage        TEXT  — pipeline stage label (free-text vocab, default handled in app)
--   company_id   TEXT  — optional cross-link to a company (portfolio/cap-table join key)
--   note_log     TEXT  — JSON Array<{id,body,createdAt,authorId}> (structured notes)
--   tasks        TEXT  — JSON Array<{id,title,priority,status,due,createdAt}>
--   starred      INTEGER NOT NULL DEFAULT 0  — pin flag
--   source_kind  TEXT  — origin of a from-source contact (e.g. 'spv_lp')
--   source_ref   TEXT  — origin id (e.g. the SPV commitment / spv id)
--
-- ADDITIVE + IDEMPOTENT: ALTER TABLE ADD COLUMN on nullable (or DEFAULTed)
-- columns is non-destructive; re-running raises "duplicate column name", which
-- the migrate runner (server/db/migrate.ts isIdempotentSkip) swallows. The two
-- CREATE INDEX statements use IF NOT EXISTS. This file is mirrored VERBATIM in
-- migrations/ and server/db/migrations/, plus the inline applyInlineMigrations()
-- alters (server/db/connection.ts) for :memory: test DBs. Tested vs a copy DB.
--
-- The partial UNIQUE email index mirrors founder/investor 0098's SHAPE
-- (per-scope, lower(trim(email)), partial on deleted_at IS NULL + email present)
-- but is SELF-SUFFICIENT: it does NOT reference the dedup_exempt column (which is
-- only present on the migration-file DB path, not the inline/fresh-DB path), so
-- the identical DDL is safe to run in every environment. Runtime enforcement is
-- additionally handled by the store's fail-closed pre-insert/pre-update guards.

ALTER TABLE partner_crm_contacts ADD COLUMN stage TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN company_id TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN note_log TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN tasks TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_crm_contacts ADD COLUMN source_kind TEXT;
ALTER TABLE partner_crm_contacts ADD COLUMN source_ref TEXT;

-- Parity partial UNIQUE email index (self-sufficient; see header note).
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity
  ON partner_crm_contacts (partner_id, lower(trim(email)))
  WHERE email IS NOT NULL
    AND trim(email) <> ''
    AND deleted_at IS NULL;

-- Cross-link lookup index for connection joins (company_id per partner).
CREATE INDEX IF NOT EXISTS idx_partner_crm_company
  ON partner_crm_contacts (partner_id, company_id);
