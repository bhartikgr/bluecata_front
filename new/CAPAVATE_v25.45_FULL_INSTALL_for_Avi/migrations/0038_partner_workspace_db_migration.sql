-- v19 Phase B — Partner workspace DB migration (remaining non-Collective slices).
--
-- The v17 Phase B Collective slice (partner_deal_promotions) already
-- migrated. This file adds the remaining partner-private workspace tables
-- that v19 Phase B promotes from in-memory to durable storage.
--
-- Three slices:
--   - partner_portfolio_companies: partner-tracked portfolio entries (may
--     reference an existing platform company, or be a standalone tracked
--     company). Visibility column controls cross-tenant Collective exposure.
--   - partner_crm_contacts: partner-private CRM contacts (people they track
--     who may or may not have platform accounts).
--   - partner_deal_pipeline: per-deal pipeline stage tracking, separate from
--     the legacy in-memory `pipeline` array (which stays in v20 deferral).
--
-- Hash chain on partner_portfolio_companies and partner_deal_pipeline
-- (audit-grade tables). partner_crm_contacts is not hash-chained — it's a
-- working CRM scratch surface, not an audit table.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS partner_portfolio_companies (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'seed',                  -- 'seed'|'series_a'|'series_b'|'growth'|'late_stage'
  sector TEXT NOT NULL DEFAULT '',
  lead_invested_amount_minor INTEGER NOT NULL DEFAULT 0,
  first_invested_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',          -- 'private'|'collective'|'public'
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_portfolio_tenant      ON partner_portfolio_companies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_partner     ON partner_portfolio_companies(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_company     ON partner_portfolio_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_visibility  ON partner_portfolio_companies(visibility);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_stage       ON partner_portfolio_companies(stage);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_created     ON partner_portfolio_companies(created_at);

CREATE TABLE IF NOT EXISTS partner_crm_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  contact_user_id TEXT,                                -- nullable; null when contact has no platform account
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  last_contact_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',                     -- JSON string[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_crm_tenant   ON partner_crm_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partner_crm_partner  ON partner_crm_contacts(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_crm_user     ON partner_crm_contacts(contact_user_id);
CREATE INDEX IF NOT EXISTS idx_partner_crm_email    ON partner_crm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_partner_crm_created  ON partner_crm_contacts(created_at);

CREATE TABLE IF NOT EXISTS partner_deal_pipeline (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'sourced',               -- 'sourced'|'screening'|'diligence'|'term_sheet'|'closed'|'passed'
  assigned_user_ids TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  target_close_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_deal_tenant   ON partner_deal_pipeline(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_partner  ON partner_deal_pipeline(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_company  ON partner_deal_pipeline(company_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_stage    ON partner_deal_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_partner_deal_created  ON partner_deal_pipeline(created_at);
