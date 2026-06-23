-- =============================================================================
-- v25.37 — migration 0054: v25.33 Consortium Partner Payment Model.
--
-- WHY THIS FILE EXISTS
-- The v25.33 partner payment tables (partner_fee_schedules, partner_tax_forms,
-- company_settings_overview), the additive ALTERs on contacts / spvs /
-- partner_billing_entries, the supporting indexes, and the $0 default
-- fee-schedule seed rows have shipped to date ONLY via the bootstrap path in
-- server/db/connection.ts (applyV2533PartnerPaymentSchema, ~lines 226-379).
-- A fresh DB initialized purely from migrations/0001..0053 would be MISSING
-- them. This file promotes those statements into a numbered migration so a
-- migration-only bootstrap is complete.
--
-- COMPLEMENTARY, NOT A REPLACEMENT
-- The bootstrap path in connection.ts is LEFT UNCHANGED. Both paths use
-- CREATE TABLE/INDEX IF NOT EXISTS and INSERT OR IGNORE, so they are fully
-- idempotent and can both run against the same DB without conflict.
--
-- ALTER TABLE NOTE
-- The migration runner (server/db/migrate.ts) swallows "duplicate column
-- name" / "already exists" on ALTER, so the additive ALTERs below are safe to
-- re-run. The base partner_billing_entries table is (re)created here with
-- IF NOT EXISTS immediately BEFORE its ALTERs so the columns always have a
-- table to attach to even in a pure migration-only (no-bootstrap) run. The
-- canonical full legacy definition also lives in 0056; both use IF NOT EXISTS
-- and are identical in shape, so order is irrelevant.
--
-- SQL style matches migrations/0050..0053 (pure SQL, IF NOT EXISTS,
-- INSERT OR IGNORE). Mirrors connection.ts EXACTLY so behavior is identical.
-- =============================================================================

-- ---- New tables (idempotent) ----

-- partner_fee_schedules — admin-configurable fee catalogue.
-- fee_kind enum semantics:
--   'subscription_monthly'          — recurring monthly partner seat fee
--   'subscription_annual'           — recurring annual partner seat fee
--   'spv_deployment'                — one-time fee charged when an SPV is
--                                     deployed (status -> 'active'); uses
--                                     stepped size bands (size_band_min/max
--                                     on committed_minor) to pick the rate
--   'spv_management_per_lp_quarter' — recurring per-LP per-quarter mgmt fee
--   'spv_closing_bonus'             — one-time bonus on SPV close
-- tier = NULL means PLATFORM default (applies to ALL partners); a non-NULL
-- tier scopes the row to one partner tier. Per-partner overrides live in
-- contacts.fee_override_json, not here. effective_from/effective_to give
-- time-windowing; effective_to IS NULL means currently active.
CREATE TABLE IF NOT EXISTS partner_fee_schedules (
  id              TEXT PRIMARY KEY NOT NULL,
  tier            TEXT,
  fee_kind        TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  size_band_min   INTEGER,
  size_band_max   INTEGER,
  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  created_by      TEXT,
  UNIQUE(tier, fee_kind, size_band_min, size_band_max, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_pfs_lookup ON partner_fee_schedules(tier, fee_kind, effective_to);
CREATE INDEX IF NOT EXISTS idx_pfs_kind ON partner_fee_schedules(fee_kind);

-- partner_tax_forms — W-9 / W-8BEN / T4A compliance tracking. tax_id_hash
-- stores a one-way hash of the tax id (never the raw id).
CREATE TABLE IF NOT EXISTS partner_tax_forms (
  id              TEXT PRIMARY KEY NOT NULL,
  partner_id      TEXT NOT NULL,
  form_type       TEXT NOT NULL,
  jurisdiction    TEXT NOT NULL,
  tax_id_hash     TEXT NOT NULL,
  collected_at    TEXT NOT NULL,
  expires_at      TEXT,
  document_url    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptf_partner ON partner_tax_forms(partner_id);
CREATE INDEX IF NOT EXISTS idx_ptf_expires ON partner_tax_forms(expires_at);

-- company_settings_overview — durable side table for the Settings -> Company
-- region / tagline / description fields (v25.33 P0a). Mirrors the existing
-- company_default_currency side table pattern; persists fields keyed by
-- company_id and overlays them on the active-company read.
CREATE TABLE IF NOT EXISTS company_settings_overview (
  company_id   TEXT PRIMARY KEY NOT NULL,
  tenant_id    TEXT NOT NULL,
  region       TEXT,
  tagline      TEXT,
  description  TEXT,
  updated_at   TEXT,
  deleted_at   TEXT
);

-- ---- Base partner_billing_entries (legacy v25.0 shape) ----
-- (Re)created here with IF NOT EXISTS so the additive ALTERs below always have
-- a table. Identical to the canonical definition in 0056 / connection.ts.
CREATE TABLE IF NOT EXISTS partner_billing_entries (
  id                  TEXT PRIMARY KEY NOT NULL,
  partner_id          TEXT NOT NULL,
  deal_ref            TEXT NOT NULL UNIQUE,
  amount_funded_minor INTEGER NOT NULL DEFAULT 0,
  tier_at_funding     TEXT NOT NULL,
  commission_pct      REAL NOT NULL,
  commission_minor    INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',
  paid_at             TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pbe_partner ON partner_billing_entries(partner_id);
CREATE INDEX IF NOT EXISTS idx_pbe_status  ON partner_billing_entries(partner_id, status);

-- ---- Additive ALTER TABLE ADD COLUMN (idempotent; runner swallows dup) ----
-- contacts == the canonical partner entity (kind='consortium_partner').
ALTER TABLE contacts ADD COLUMN fee_override_json TEXT;
ALTER TABLE contacts ADD COLUMN commission_override_pct REAL;
ALTER TABLE contacts ADD COLUMN subscription_id TEXT;
ALTER TABLE contacts ADD COLUMN tax_form_collected_at TEXT;
ALTER TABLE contacts ADD COLUMN partner_agreement_version TEXT;
ALTER TABLE contacts ADD COLUMN partner_agreement_signed_at TEXT;
ALTER TABLE contacts ADD COLUMN partner_agreement_signature_hash TEXT;

-- partner_billing_entries — new entry kinds beyond referral commission.
ALTER TABLE partner_billing_entries ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'referral_commission';
ALTER TABLE partner_billing_entries ADD COLUMN spv_fund_id TEXT;
ALTER TABLE partner_billing_entries ADD COLUMN fee_schedule_id TEXT;
ALTER TABLE partner_billing_entries ADD COLUMN computed_via TEXT;

-- spvs == the canonical SPV/fund table (brief's `spv_funds`, retargeted).
ALTER TABLE spvs ADD COLUMN deployment_fee_minor INTEGER;
ALTER TABLE spvs ADD COLUMN deployment_fee_currency TEXT;
ALTER TABLE spvs ADD COLUMN deployment_fee_payer TEXT;
ALTER TABLE spvs ADD COLUMN deployment_fee_paid_at TEXT;
ALTER TABLE spvs ADD COLUMN deployment_fee_schedule_id TEXT;
ALTER TABLE spvs ADD COLUMN sourcing_partner_id TEXT;

-- ---- Indices for the new columns (idempotent) ----
CREATE INDEX IF NOT EXISTS idx_pbe_entry_kind ON partner_billing_entries(entry_kind);
CREATE INDEX IF NOT EXISTS idx_pbe_spv_fund ON partner_billing_entries(spv_fund_id);
CREATE INDEX IF NOT EXISTS idx_spv_sourcing_partner ON spvs(sourcing_partner_id);

-- ---- Seed $0 default fee rows (idempotent INSERT OR IGNORE) ----
-- Default to $0 so the platform never accidentally charges real money until
-- an admin explicitly configures a fee via the admin UI. These rows also
-- guarantee partnerFeeResolver never throws no_fee_schedule_configured on a
-- fresh deploy. SPV deployment bands carry size_band_min/max in minor units
-- (cents): band1 0-250K, band2 250K-1M, band3 1M-5M, band4 5M+.
INSERT OR IGNORE INTO partner_fee_schedules
  (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, created_at, updated_at)
VALUES
  ('pfs_def_sub_m',    NULL, 'subscription_monthly',          0, 'USD', NULL,       NULL,       '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_sub_y',    NULL, 'subscription_annual',           0, 'USD', NULL,       NULL,       '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_mgmt', NULL, 'spv_management_per_lp_quarter', 0, 'USD', NULL,       NULL,       '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_bonus',NULL, 'spv_closing_bonus',             0, 'USD', NULL,       NULL,       '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_band1',NULL, 'spv_deployment',                0, 'USD', 0,          25000000,   '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_band2',NULL, 'spv_deployment',                0, 'USD', 25000000,   100000000,  '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_band3',NULL, 'spv_deployment',                0, 'USD', 100000000,  500000000,  '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'),
  ('pfs_def_spv_band4',NULL, 'spv_deployment',                0, 'USD', 500000000,  NULL,       '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z');
