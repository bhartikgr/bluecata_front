-- 0089_v25_50_partner_portfolio_company
-- v25.50.0 Phase 3 (spec 3): Consortium Partner "Private Portfolio" company
-- profiles. NEW, non-sacred, CP-scoped store keyed by (partner_id, company_id).
-- Stores the SAME company-profile field taxonomy as founder CompanyProfile
-- (contact/address/legal/ma) as an opaque profile_json blob, plus a per-row
-- hash chain matching sibling partner stores. Additive + idempotent:
-- CREATE TABLE IF NOT EXISTS is a no-op once the table exists.
CREATE TABLE IF NOT EXISTS partner_portfolio_company (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT,
  partner_id     TEXT NOT NULL,
  company_id     TEXT NOT NULL,
  profile_json   TEXT NOT NULL DEFAULT '{}',
  prev_hash      TEXT,
  curr_hash      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT,
  deleted_at     TEXT
);

-- One live profile row per (partner_id, company_id). Partial-unique semantics
-- (excluding soft-deleted rows) are enforced in the store on write; this index
-- accelerates the canonical lookup path.
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_company_partner
  ON partner_portfolio_company (partner_id, company_id);
