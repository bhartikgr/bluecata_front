-- 0083_v25_49_partner_client_crm.sql
-- v25.49 Phase-3A — durable CRM stage + activity timeline for the SEPARATE
-- Consortium Partner Clients engine (kept separate from crmStore per Ozan).
-- ADDITIVE ONLY: two new PARALLEL tables. No existing table/column touched;
-- the existing partner_attributions / partner_notes data + read paths are
-- untouched (Sacred Rule #78). Both statements are idempotent (IF NOT EXISTS).
--
-- partner_client_crm  — one row per (partner_id, company_id); holds the durable
--                       CRM stage for an attributed company. Partner-scoped:
--                       every read/write filters on partner_id (fail-closed).
-- partner_client_activity — append-only client-scoped activity/timeline rows
--                       (stage transitions + manual notes) for the detail view.
CREATE TABLE IF NOT EXISTS partner_client_crm (
  partner_id  TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  stage       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (partner_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_client_crm_partner ON partner_client_crm (partner_id);

CREATE TABLE IF NOT EXISTS partner_client_activity (
  id             TEXT PRIMARY KEY NOT NULL,
  partner_id     TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  activity_type  TEXT NOT NULL,
  body           TEXT,
  actor_user_id  TEXT,
  occurred_at    TEXT NOT NULL,
  meta_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_partner_client_activity_partner ON partner_client_activity (partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_client_activity_company ON partner_client_activity (partner_id, company_id);
