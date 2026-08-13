-- migrations/0149_wave4b_partner_classifications.sql
-- WAVE 4B (PT-1) — partner classification taxonomy: two-level Sector //
-- Sub-sector, hybrid-capable, DB-driven.
--
-- SPEC ANCHORS
--   spec/PARTNER_TYPE_TAXONOMY.md — full taxonomy + the 2026-08-09 owner
--     rulings ("Data model" block: partner_classifications junction table;
--     "Sector and sub-sector live in seeded lookup tables with sort_order and
--     active, so admin adds a type without a migration").
--   spec/CONSORTIUM_PARTNER_BUILD_v8.md — PT-1.
--
-- MIGRATION NUMBER — 0149. Justification, verified against this tree rather
-- than assumed:
--   * highest numbered file present in BOTH migrations/ and
--     server/db/migrations/ is 0137 (0135 is a pre-existing, deliberately
--     un-backfilled gap);
--   * spec/00_SHARED_STANDARDS.md:107-119 centrally allocates 0138-0148 to
--     other in-flight waves (0138 Wave G G.0 ... 0148 Wave F conditional
--     reservation). Those files are not on disk yet but the numbers are
--     RESERVED — reusing one would let the runner record this body under
--     another wave's identity, or skip that wave's real migration once it
--     lands.
--   * 0149 is therefore the first free number after the central allocation.
--
-- GRANDFATHERING (owner ruling, binding): existing partners are test data.
-- This migration performs NO backfill, writes NO sentinel row into
-- partner_classifications, and does not touch contacts / metadata_json /
-- consortium_applications.partner_type / partner_organizations.partner_type.
-- The mandatory gate is an application-level rule on create/edit only.
--
-- READ-ONLY LEGACY: the pre-existing partner-type values (see the report
-- for the `syndicate` badge provenance) stay exactly where they are and keep
-- being read by their existing consumers. Nothing here removes a reader.
--
-- SCOPE FENCE (owner ruling): these tables are REPORTING AND FILTERING ONLY.
-- No authorization, routing, gating, entitlement, pricing or menu-visibility
-- decision may read them. Enforced mechanically by the PT-5 lint rule
-- (scripts/lint/partner-classification-scope-fence.mjs) and the
-- identical-payload test.
--
-- Idempotent: every DDL is guarded, every seed row is ON CONFLICT DO NOTHING.
-- Fails LOUDLY: each CREATE TABLE IF NOT EXISTS is followed by a shape
-- assertion (temp table with a CHECK constraint) so that the incident-I-1
-- failure mode -- IF NOT EXISTS silently no-opping against a differently
-- shaped pre-existing table -- aborts the transaction instead of being
-- absorbed.
--
-- SQLite-targeted (production driver). No Postgres-hostile constructs beyond
-- the pragma_table_info shape assertions, which are confined to this file;
-- the Postgres tree uses migrations-pg/.

-- ═════════════════════════════════════════════════════════════════════════
-- partner_sectors — level 1 of the taxonomy (lookup, admin-editable)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS partner_sectors (
  slug        TEXT PRIMARY KEY NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  updated_at  TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);

CREATE TEMP TABLE _mig0149_shape_sectors (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _mig0149_shape_sectors (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM pragma_table_info('partner_sectors')
  WHERE name IN ('slug', 'label', 'sort_order', 'active', 'created_at', 'updated_at')
) = 6 THEN 1 ELSE 0 END;
DROP TABLE _mig0149_shape_sectors;

CREATE INDEX IF NOT EXISTS idx_partner_sectors_active_sort
  ON partner_sectors(active, sort_order);

-- ═════════════════════════════════════════════════════════════════════════
-- partner_subsectors — level 2. `slug` is globally unique across sectors
-- (verified: zero cross-sector slug collisions in the taxonomy doc), which
-- keeps partner_classifications.subsector_slug a single-column FK.
-- `requires_other_text` is a DATA flag rather than a hardcoded 'other'
-- literal, so an admin can mint a second free-text sub-sector without a
-- migration.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS partner_subsectors (
  slug                TEXT PRIMARY KEY NOT NULL,
  sector_slug         TEXT NOT NULL REFERENCES partner_sectors(slug),
  label               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  requires_other_text INTEGER NOT NULL DEFAULT 0 CHECK (requires_other_text IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  updated_at          TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);

CREATE TEMP TABLE _mig0149_shape_subsectors (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _mig0149_shape_subsectors (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM pragma_table_info('partner_subsectors')
  WHERE name IN ('slug', 'sector_slug', 'label', 'sort_order', 'active',
                 'requires_other_text', 'created_at', 'updated_at')
) = 8 THEN 1 ELSE 0 END;
DROP TABLE _mig0149_shape_subsectors;

CREATE INDEX IF NOT EXISTS idx_partner_subsectors_sector
  ON partner_subsectors(sector_slug, active, sort_order);

-- ═════════════════════════════════════════════════════════════════════════
-- partner_classifications — the junction. Hybrids are ROWS, never a
-- delimited string (owner ruling). `partner_id` is intentionally NOT a
-- declared FK: partners are addressed by two different identity tables in
-- this tree (contacts.id for consortium_partner contacts,
-- partner_organizations.id) and a hard FK to either one would make the other
-- unclassifiable. Referential integrity is enforced at the store layer,
-- which resolves the partner before writing.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS partner_classifications (
  id             TEXT PRIMARY KEY NOT NULL,
  partner_id     TEXT NOT NULL,
  sector_slug    TEXT NOT NULL REFERENCES partner_sectors(slug),
  subsector_slug TEXT NOT NULL REFERENCES partner_subsectors(slug),
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  other_text     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  UNIQUE (partner_id, sector_slug, subsector_slug),
  -- "`other` requires non-empty free text" enforced at the DB level as well
  -- as in the application, so the fallback can never become the new silent
  -- default. Slug-literal here is unavoidable in a CHECK (it cannot read
  -- partner_subsectors.requires_other_text); the store additionally enforces
  -- the data-driven flag for any future free-text sub-sector.
  CHECK (
    subsector_slug <> 'other'
    OR (other_text IS NOT NULL AND TRIM(other_text) <> '')
  )
);

CREATE TEMP TABLE _mig0149_shape_classifications (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _mig0149_shape_classifications (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM pragma_table_info('partner_classifications')
  WHERE name IN ('id', 'partner_id', 'sector_slug', 'subsector_slug',
                 'is_primary', 'other_text', 'created_at', 'updated_at')
) = 8 THEN 1 ELSE 0 END;
DROP TABLE _mig0149_shape_classifications;

-- Exactly one primary per partner. Partial unique index (same idiom as
-- uq_mfc_classification_requests_pending in 0137).
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_classifications_primary
  ON partner_classifications(partner_id)
  WHERE is_primary = 1;

-- Read paths: "show me this partner's chips" and "filter partners by ANY
-- classification" (owner ruling: filters match any, not just primary).
CREATE INDEX IF NOT EXISTS idx_partner_classifications_partner
  ON partner_classifications(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_classifications_sector
  ON partner_classifications(sector_slug);
CREATE INDEX IF NOT EXISTS idx_partner_classifications_subsector
  ON partner_classifications(subsector_slug);

-- ── Seed: sectors (parsed from spec/PARTNER_TYPE_TAXONOMY.md) ──────────
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('investment_capital', 'Investment Capital', 10, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('banking_and_financial_services', 'Banking & Financial Services', 20, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('programs_and_venture_development', 'Programs & Venture Development', 30, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('academic_and_research', 'Academic & Research', 40, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('government_and_public_sector', 'Government & Public Sector', 50, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('professional_services', 'Professional Services', 60, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('fund_and_transaction_infrastructure', 'Fund & Transaction Infrastructure', 70, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('corporate_and_strategic', 'Corporate & Strategic', 80, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('ecosystem_and_community', 'Ecosystem & Community', 90, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('nonprofit_and_philanthropic', 'Nonprofit & Philanthropic', 100, 1)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_sectors (slug, label, sort_order, active) VALUES ('individual_and_fallback', 'Individual & Fallback', 110, 1)
  ON CONFLICT(slug) DO NOTHING;

-- ── Seed: sub-sectors ──────────────────────────────────────────────────
-- 1. Investment Capital (19)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('angel_group', 'investment_capital', 'Angel Group / Angel Network', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('angel_fund', 'investment_capital', 'Angel Fund', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('individual_angel', 'investment_capital', 'Individual Angel Investor', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('venture_capital', 'investment_capital', 'Venture Capital Firm', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('micro_vc', 'investment_capital', 'Micro-VC / Pre-Seed Fund', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('corporate_vc', 'investment_capital', 'Corporate Venture Capital (CVC)', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('growth_equity', 'investment_capital', 'Growth Equity Firm', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('private_equity', 'investment_capital', 'Private Equity Firm', 80, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('family_office_single', 'investment_capital', 'Single-Family Office', 90, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('family_office_multi', 'investment_capital', 'Multi-Family Office', 100, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('fund_of_funds', 'investment_capital', 'Fund of Funds', 110, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('syndicate_lead', 'investment_capital', 'Syndicate Lead / SPV Sponsor', 120, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('crowdfunding_portal', 'investment_capital', 'Equity Crowdfunding Portal', 130, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('venture_debt', 'investment_capital', 'Venture Debt Lender', 140, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('revenue_based_finance', 'investment_capital', 'Revenue-Based Financing Provider', 150, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('impact_fund', 'investment_capital', 'Impact / ESG Fund', 160, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('search_fund', 'investment_capital', 'Search Fund', 170, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('sovereign_wealth_fund', 'investment_capital', 'Sovereign Wealth Fund', 180, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('pension_endowment', 'investment_capital', 'Pension Fund / Endowment', 190, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 2. Banking & Financial Services (7)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('investment_bank', 'banking_and_financial_services', 'Investment Bank', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('commercial_bank', 'banking_and_financial_services', 'Commercial Bank', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('broker_dealer', 'banking_and_financial_services', 'Broker-Dealer', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('placement_agent', 'banking_and_financial_services', 'Placement Agent', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('wealth_manager_ria', 'banking_and_financial_services', 'Wealth Manager / RIA', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('insurance_carrier', 'banking_and_financial_services', 'Insurance Carrier', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('insurance_broker', 'banking_and_financial_services', 'Insurance Broker', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 3. Programs & Venture Development (7)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('accelerator', 'programs_and_venture_development', 'Accelerator', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('incubator', 'programs_and_venture_development', 'Incubator', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('pre_accelerator', 'programs_and_venture_development', 'Pre-Accelerator / Founder Program', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('venture_studio', 'programs_and_venture_development', 'Venture Studio / Startup Studio', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('company_builder', 'programs_and_venture_development', 'Company Builder', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('residency_fellowship', 'programs_and_venture_development', 'Fellowship / Residency Program', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('bootcamp', 'programs_and_venture_development', 'Bootcamp / Training Program', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 4. Academic & Research (6)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('university', 'academic_and_research', 'University / College', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('tech_transfer_office', 'academic_and_research', 'Technology Transfer Office (TTO)', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('research_institute', 'academic_and_research', 'Research Institute / National Lab', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('entrepreneurship_center', 'academic_and_research', 'Entrepreneurship Center', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('student_venture_fund', 'academic_and_research', 'Student-Run Venture Fund', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('academic_spinout_office', 'academic_and_research', 'Spin-Out / Commercialisation Office', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 5. Government & Public Sector (10)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('national_government_agency', 'government_and_public_sector', 'National Government Agency', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('regional_development_agency', 'government_and_public_sector', 'Regional / State / Provincial Development Agency', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('municipal_economic_development', 'government_and_public_sector', 'Municipal Economic Development Office', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('trade_investment_promotion', 'government_and_public_sector', 'Trade & Investment Promotion Agency', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('public_innovation_agency', 'government_and_public_sector', 'Public Innovation / Grant Agency', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('development_finance_institution', 'government_and_public_sector', 'Development Finance Institution (DFI)', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('multilateral_institution', 'government_and_public_sector', 'Multilateral / Supranational Institution', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('sovereign_innovation_fund', 'government_and_public_sector', 'Sovereign Innovation Fund', 80, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('startup_visa_designated_org', 'government_and_public_sector', 'Startup Visa Designated Organization', 90, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('export_credit_agency', 'government_and_public_sector', 'Export Credit Agency', 100, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 6. Professional Services (10)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('law_firm', 'professional_services', 'Law Firm', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('ip_patent_firm', 'professional_services', 'IP / Patent Firm', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('accounting_firm', 'professional_services', 'Accounting Firm', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('audit_firm', 'professional_services', 'Audit Firm', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('tax_advisory', 'professional_services', 'Tax Advisory', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('consulting_firm', 'professional_services', 'Consulting Firm', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('management_consultancy', 'professional_services', 'Management Consultancy', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('fractional_cfo', 'professional_services', 'Fractional CFO / Financial Advisory', 80, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('valuation_firm', 'professional_services', 'Valuation Firm', 90, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('investor_relations_firm', 'professional_services', 'Investor Relations Firm', 100, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 7. Fund & Transaction Infrastructure (7)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('fund_administrator', 'fund_and_transaction_infrastructure', 'Fund Administrator', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('transfer_agent', 'fund_and_transaction_infrastructure', 'Transfer Agent', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('custodian', 'fund_and_transaction_infrastructure', 'Custodian', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('escrow_agent', 'fund_and_transaction_infrastructure', 'Escrow Agent', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('compliance_kyc_provider', 'fund_and_transaction_infrastructure', 'Compliance / KYC-AML Provider', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('captable_platform', 'fund_and_transaction_infrastructure', 'Cap Table / Equity Platform', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('payment_provider', 'fund_and_transaction_infrastructure', 'Payment / Treasury Provider', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 8. Corporate & Strategic (5)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('corporate_strategic', 'corporate_and_strategic', 'Corporate / Strategic Partner', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('corporate_innovation_unit', 'corporate_and_strategic', 'Corporate Innovation Unit', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('channel_supplier_partner', 'corporate_and_strategic', 'Channel / Supplier Partner', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('systems_integrator', 'corporate_and_strategic', 'Systems Integrator', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('technology_vendor', 'corporate_and_strategic', 'Technology Vendor', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 9. Ecosystem & Community (9)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('startup_ecosystem_org', 'ecosystem_and_community', 'Startup Ecosystem Organization', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('trade_association', 'ecosystem_and_community', 'Trade Association / Industry Body', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('chamber_of_commerce', 'ecosystem_and_community', 'Chamber of Commerce', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('founder_network', 'ecosystem_and_community', 'Founder Network / Community', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('coworking_space', 'ecosystem_and_community', 'Coworking Space', 50, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('innovation_hub_science_park', 'ecosystem_and_community', 'Innovation Hub / Science Park', 60, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('pitch_event_organizer', 'ecosystem_and_community', 'Pitch Event / Competition Organizer', 70, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('media_publisher', 'ecosystem_and_community', 'Media / Publisher', 80, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('research_data_provider', 'ecosystem_and_community', 'Research & Data Provider', 90, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 10. Nonprofit & Philanthropic (4)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('foundation', 'nonprofit_and_philanthropic', 'Foundation / Philanthropic Funder', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('nonprofit_ngo', 'nonprofit_and_philanthropic', 'Nonprofit / NGO', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('social_enterprise_support', 'nonprofit_and_philanthropic', 'Social Enterprise Support Organisation', 30, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('grant_making_body', 'nonprofit_and_philanthropic', 'Grant-Making Body', 40, 1, 0)
  ON CONFLICT(slug) DO NOTHING;

-- 11. Individual & Fallback (3)
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('advisor_mentor', 'individual_and_fallback', 'Advisor / Mentor', 10, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('scout', 'individual_and_fallback', 'Scout', 20, 1, 0)
  ON CONFLICT(slug) DO NOTHING;
INSERT INTO partner_subsectors (slug, sector_slug, label, sort_order, active, requires_other_text) VALUES ('other', 'individual_and_fallback', 'Other — free text required', 30, 1, 1)
  ON CONFLICT(slug) DO NOTHING;

