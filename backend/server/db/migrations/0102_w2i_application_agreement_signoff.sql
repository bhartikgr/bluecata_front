-- 0102_w2i_application_agreement_signoff
-- W2-I — Consortium Partner Agreement sign-off, captured AT APPLICATION.
--
-- The prior flow let a partner "self-toggle" an unenforced, blind agreement
-- checkbox. This replaces it with a viewable-terms + typed-signature capture at
-- the end of the consortium application, recorded on the hash-chained
-- application row and carried to the partner record (contacts.partner_agreement_*)
-- on approval.
--
-- Four additive NULLABLE columns:
--   agreement_version         — version tag of the text signed (e.g. CPA-v0.1-DRAFT)
--   agreement_signed_name     — the applicant's typed full legal name
--   agreement_signed_at       — ISO timestamp of the sign-off
--   agreement_signature_hash  — integrity hash over (id|version|name|signedAt)
--
-- These are NOT part of the application chainPayload, so the existing hash
-- chain stays stable (mirrors the contact_name exclusion).
--
-- ADDITIVE + IDEMPOTENT. `ALTER TABLE ... ADD COLUMN` on nullable columns is
-- non-destructive; re-running raises "duplicate column name", which the migrate
-- runner (server/db/migrate.ts isIdempotentSkip) swallows. Mirrored VERBATIM in
-- both migrations/ and server/db/migrations/, plus the inline
-- applyInlineMigrations() alters (connection.ts) for :memory: test DBs.

ALTER TABLE consortium_applications ADD COLUMN agreement_version TEXT;
ALTER TABLE consortium_applications ADD COLUMN agreement_signed_name TEXT;
ALTER TABLE consortium_applications ADD COLUMN agreement_signed_at TEXT;
ALTER TABLE consortium_applications ADD COLUMN agreement_signature_hash TEXT;
