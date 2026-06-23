-- =============================================================================
-- v25.37 — migration 0056: legacy bootstrap-only payment tables.
--
-- WHY THIS FILE EXISTS
-- Several older payment-related tables pre-date v25.33 but were NEVER added to
-- the numbered migration set — they have only ever been created by the
-- bootstrap path in server/db/connection.ts. A fresh DB initialized purely
-- from migrations would be MISSING them. This file promotes those CREATE TABLE
-- / CREATE INDEX / INSERT OR IGNORE statements into a numbered migration so a
-- migration-only bootstrap is complete.
--
-- Tables covered (all mirror connection.ts EXACTLY):
--   payment_ledger            (~line 2508) + 4 indexes
--   payment_webhook_events    (~line 2531) + 2 indexes
--   processed_webhook_events  (~line 2552)
--   fx_rates                  (~line 2563) + 7 seed rows
--   investor_kyc              (~line 2754) + 1 index
--   billing_disputes          (~line 2806) + 2 indexes
--   partner_billing_entries   (~line 2871) + 2 indexes  (canonical legacy shape)
--
-- COMPLEMENTARY, NOT A REPLACEMENT
-- The bootstrap path in connection.ts is LEFT UNCHANGED. Both paths use
-- CREATE TABLE/INDEX IF NOT EXISTS and INSERT OR IGNORE, so they are fully
-- idempotent and can both run against the same DB without conflict. The
-- partner_billing_entries CREATE here is identical to the one in 0054; both
-- use IF NOT EXISTS so ordering is irrelevant.
--
-- SQL style matches migrations/0050..0053.
-- =============================================================================

-- payment_ledger — legacy v14 unified ledger (collective memberships, founder
-- subscriptions, company billing, refunds, prorations). JSON blob keyed by
-- entry id; intent_id is unique-indexed for the idempotency lookup path.
CREATE TABLE IF NOT EXISTS payment_ledger (
  id          TEXT PRIMARY KEY NOT NULL,
  intent_id   TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  state       TEXT NOT NULL,
  entry_json  TEXT NOT NULL,
  ts          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_customer ON payment_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_state ON payment_ledger(state);
CREATE INDEX IF NOT EXISTS idx_payment_state_ts ON payment_ledger(state, ts);
CREATE INDEX IF NOT EXISTS idx_payment_ts ON payment_ledger(ts);

-- payment_webhook_events — durable payment webhook event log (replaces the
-- in-memory recentWebhookEvents array in paymentGatewayAdapter.ts).
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  intent_id    TEXT NOT NULL,
  status       TEXT NOT NULL,
  company_id   TEXT,
  gateway      TEXT,
  payload_json TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pwe_intent ON payment_webhook_events(intent_id);
CREATE INDEX IF NOT EXISTS idx_pwe_received ON payment_webhook_events(received_at DESC);

-- processed_webhook_events — webhook idempotency claim table (shared by the
-- Airwallex and Stripe adapters). Column processed_at kept stable.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  key          TEXT PRIMARY KEY NOT NULL,
  processed_at TEXT NOT NULL
);

-- fx_rates — FX rates for soft-circle multi-currency display. Defaults seeded
-- on first boot via INSERT OR IGNORE so existing deploys don't drift; admin
-- can UPDATE rates through a dedicated endpoint or directly.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency_code TEXT PRIMARY KEY NOT NULL,
  rate          REAL NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('USD', 1.0,  '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('CAD', 1.35, '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('GBP', 0.79, '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('EUR', 0.92, '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('SGD', 1.35, '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('HKD', 7.81, '2026-06-21T00:00:00Z');
INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('CNY', 7.27, '2026-06-21T00:00:00Z');

-- investor_kyc — KYC attestation records for investors (A5).
CREATE TABLE IF NOT EXISTS investor_kyc (
  id                TEXT PRIMARY KEY NOT NULL,
  investor_id       TEXT NOT NULL,
  accredited        INTEGER NOT NULL DEFAULT 0,
  jurisdiction      TEXT NOT NULL,
  source_of_funds   TEXT NOT NULL,
  attestations_json TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ikyc_investor ON investor_kyc(investor_id);

-- billing_disputes — v25.0 Track 5 E3.
CREATE TABLE IF NOT EXISTS billing_disputes (
  id               TEXT PRIMARY KEY NOT NULL,
  subscription_id  TEXT NOT NULL,
  amount_minor     INTEGER NOT NULL,
  reason           TEXT NOT NULL,
  customer_notes   TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  resolved_at      TEXT,
  resolved_by      TEXT,
  resolution_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_bd_sub ON billing_disputes(subscription_id);
CREATE INDEX IF NOT EXISTS idx_bd_status ON billing_disputes(status);

-- partner_billing_entries — v25.0 Track 3 C2 (canonical legacy base shape).
-- Auto-populated when a deal is funded via partner channel; deal_ref UNIQUE
-- enforces no double-counting. The v25.33 additive columns (entry_kind,
-- spv_fund_id, fee_schedule_id, computed_via) are applied by migration 0054.
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
