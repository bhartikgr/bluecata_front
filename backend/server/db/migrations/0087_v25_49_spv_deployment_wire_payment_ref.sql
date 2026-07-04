-- 0087_v25_49_spv_deployment_wire_payment_ref.sql
-- v25.49 Phase-4D / Blocker 2 — deployment commit needs REAL funding proof.
--
-- ADDITIVE ONLY. Adds two nullable columns to spv_deployment:
--   * wire_payment_ref — MANDATORY on the `wired` transition and re-validated
--     before the sacred cap-table ledger commit; asserts money actually moved.
--   * closing_doc_ref  — typed closing-doc provenance captured alongside.
-- The migration runner swallows the duplicate-column error, so re-applying is a
-- no-op (idempotent). Mirrors connection.ts buildProductionTableStatements.
ALTER TABLE spv_deployment ADD COLUMN wire_payment_ref TEXT;
ALTER TABLE spv_deployment ADD COLUMN closing_doc_ref TEXT;
