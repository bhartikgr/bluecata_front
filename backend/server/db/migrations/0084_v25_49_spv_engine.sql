-- 0084_v25_49_spv_engine.sql
-- v25.49 Phase-4 — CANONICAL SPV Engine (one store, many contexts).
--
-- ADDITIVE ONLY. Nine new tables with SINGULAR names (spv, spv_mandate, ...)
-- so they NEVER collide with the pre-existing PLURAL tables owned by
-- spvFundStore (spvs, spv_commitments, spv_capital_calls, spv_distributions,
-- spv_positions from 0041_spv_fund_db.sql). Sacred Rule #78: nothing is
-- dropped; existing partner SPV + Fund rows are migrated into `spv` by the
-- store's idempotent backfill on boot (INSERT OR IGNORE, deterministic ids).
--
-- Every statement is idempotent (IF NOT EXISTS). Money is integer minor units
-- (…_minor) + ISO-4217 currency. Audit anchors: prev_hash / curr_hash hold the
-- per-record hash-chain (GENESIS = 64 zeros). Almost every non-scalar column is
-- a FK into an existing canonical record (company / round / investor / partner);
-- the engine is a thin coordination layer and never re-collects canonical data.

-- ── spv ───────────────────────────────────────────────────────────────────
-- One row per Special Purpose Vehicle (Fund = spv with spv_type='fund').
-- ALWAYS owned by the sponsoring Consortium Partner as GP (sponsor_partner_id).
CREATE TABLE IF NOT EXISTS spv (
  id                  TEXT PRIMARY KEY NOT NULL,
  sponsor_partner_id  TEXT NOT NULL,
  gp_user_id          TEXT,
  name                TEXT NOT NULL,
  spv_type            TEXT NOT NULL DEFAULT 'spv',        -- spv | fund | syndicate
  jurisdiction        TEXT NOT NULL,                      -- delaware | cayman | bvi | canadian_lp
  status              TEXT NOT NULL DEFAULT 'draft',      -- draft|open|closed|deployed|distributing|wound_down
  distribution_scope  TEXT NOT NULL DEFAULT 'private',    -- private|collective_only|network|invite_only
  target_raise_minor  INTEGER,
  min_check_minor     INTEGER,
  cap_minor           INTEGER,
  currency            TEXT NOT NULL DEFAULT 'USD',
  carry_basis         TEXT NOT NULL,                      -- per_deployment | whole_spv (NO default: GP must choose)
  target_company_id   TEXT,                               -- FK companies (deal_specific SPVs)
  close_date          TEXT,
  terms_json          TEXT,
  migrated_from       TEXT,                               -- pspv_… / pfnd_… provenance (Rule #78)
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT,
  archived_at         TEXT,
  prev_hash           TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_sponsor ON spv (sponsor_partner_id);
CREATE INDEX IF NOT EXISTS idx_spv_status ON spv (sponsor_partner_id, status);
CREATE INDEX IF NOT EXISTS idx_spv_scope ON spv (distribution_scope);

-- ── spv_mandate ────────────────────────────────────────────────────────────
-- Composable AND/OR eligibility rule tree + mode. One row per SPV (latest wins
-- by updated_at; history preserved append-only via id).
CREATE TABLE IF NOT EXISTS spv_mandate (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'open',            -- open | deal_specific
  rule_tree_json TEXT NOT NULL,                          -- {op:and|or, rules:[{field,op,value}|<node>]}
  geography_json TEXT,                                   -- string[] convenience mirror
  sector_json    TEXT,
  company_ids_json TEXT,
  stage_json     TEXT,
  check_min_minor INTEGER,
  check_max_minor INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_mandate_spv ON spv_mandate (spv_id);

-- ── spv_fee ────────────────────────────────────────────────────────────────
-- Two-layer fee model: layer=management (GP-set) OR layer=platform (Capavate
-- admin, read-only to GP). Effective-dated for audited amendments.
CREATE TABLE IF NOT EXISTS spv_fee (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  layer         TEXT NOT NULL,                            -- management | platform
  fee_type      TEXT NOT NULL,                            -- fixed | carry | hybrid
  fixed_amount_minor INTEGER,
  carry_pct     REAL,                                     -- e.g. 0.20 for 20% (basis-points-safe as REAL)
  currency      TEXT NOT NULL DEFAULT 'USD',
  effective_date TEXT NOT NULL,
  set_by        TEXT,
  created_at    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_fee_spv ON spv_fee (spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_fee_spv_layer ON spv_fee (spv_id, layer, effective_date);

-- ── spv_subscription ───────────────────────────────────────────────────────
-- One LP commitment. investor_id FKs the canonical investor/user; gate refs
-- point at the reusable investor_compliance_profile. Unified across all 3 LP
-- personas (collective member / capavate investor / consortium partner).
CREATE TABLE IF NOT EXISTS spv_subscription (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  investor_id   TEXT NOT NULL,
  investor_persona TEXT,                                  -- collective | capavate | partner
  commitment_minor INTEGER NOT NULL,
  wired_minor   INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL DEFAULT 'review',           -- review|soft_circled|founder_confirmed|wire_funded|committed|withdrawn
  kyc_ref       TEXT,
  accreditation_ref TEXT,
  subscription_doc_ref TEXT,
  ownership_pct REAL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_subscription_spv ON spv_subscription (spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_subscription_investor ON spv_subscription (investor_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spv_subscription_spv_investor ON spv_subscription (spv_id, investor_id);

-- ── spv_deployment ─────────────────────────────────────────────────────────
-- Capital deployed into a company round. cap_table_ledger_ref is the id of the
-- SINGLE cap-table ledger line written through the existing sacred ledger path.
CREATE TABLE IF NOT EXISTS spv_deployment (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  company_id    TEXT NOT NULL,
  company_round_id TEXT NOT NULL,
  instrument    TEXT,                                     -- from round profile
  amount_minor  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  shares        TEXT,                                     -- decimal-as-string (matches ledger)
  cap_table_ledger_ref TEXT,                              -- single ledger line id (ccm_…)
  status        TEXT NOT NULL DEFAULT 'pending',          -- pending|founder_confirmed|docs_sent|wired|deployed
  founder_confirmed_at TEXT,
  wired_at      TEXT,
  deployed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_deployment_spv ON spv_deployment (spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_deployment_company ON spv_deployment (company_id);

-- ── spv_distribution ───────────────────────────────────────────────────────
-- A distribution event + waterfall. per-LP allocations + carry (GP + platform)
-- captured as JSON breakdowns; money in minor units within the JSON.
CREATE TABLE IF NOT EXISTS spv_distribution (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  event         TEXT NOT NULL,                            -- exit | dividend | secondary | recap
  gross_proceeds_minor INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  waterfall_json TEXT NOT NULL,                           -- ordered tiers
  allocations_json TEXT NOT NULL,                         -- per-LP {investorId, grossMinor, carryMinor, netMinor}
  gp_carry_minor INTEGER NOT NULL DEFAULT 0,
  platform_carry_minor INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'recorded',
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_distribution_spv ON spv_distribution (spv_id);

-- ── spv_document ───────────────────────────────────────────────────────────
-- Lifecycle documents. storage_key is a RELATIVE key under uploads/spv/;
-- streaming is authenticated. expiry supports expiring-link compliance files.
CREATE TABLE IF NOT EXISTS spv_document (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  doc_type      TEXT NOT NULL,                            -- formation|operating_agreement|subscription|formd|blue_sky|kyc|tax
  title         TEXT,
  storage_key   TEXT NOT NULL,                            -- relative: spv/<spvId>/<file>
  storage_backend TEXT NOT NULL DEFAULT 'fs',             -- fs | s3
  content_type  TEXT,
  size_bytes    INTEGER,
  expiry        TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_document_spv ON spv_document (spv_id);

-- ── spv_transfer (phase-2-ready secondary transfers; MODEL now) ─────────────
CREATE TABLE IF NOT EXISTS spv_transfer (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  from_investor_id TEXT NOT NULL,
  to_investor_id   TEXT NOT NULL,
  units_pct     REAL,
  amount_minor  INTEGER,
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL DEFAULT 'proposed',         -- proposed|compliance_recheck|gp_approved|settled|rejected
  compliance_recheck_ref TEXT,
  gp_approval   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_transfer_spv ON spv_transfer (spv_id);

-- ── investor_compliance_profile ────────────────────────────────────────────
-- Reusable, investor-level compliance profile (one-time KYC + accreditation
-- self-cert). Referenced by spv_subscription gate refs so a returning LP does
-- not re-do KYC. Fail-closed-but-forgiving: unverified → flagged for manual
-- review, not hard-blocked.
CREATE TABLE IF NOT EXISTS investor_compliance_profile (
  investor_id   TEXT PRIMARY KEY NOT NULL,
  kyc_status    TEXT NOT NULL DEFAULT 'none',             -- none|pending|verified|expired|manual_review
  kyc_verified_at TEXT,
  kyc_expiry    TEXT,
  accreditation_status TEXT NOT NULL DEFAULT 'none',      -- none|self_certified|verified|manual_review
  accreditation_certified_at TEXT,
  jurisdiction  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
