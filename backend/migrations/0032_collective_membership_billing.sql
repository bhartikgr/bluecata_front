-- v18 Phase B — Stripe Collective membership billing.
--
-- Adds two tables that back the Collective membership Stripe surface:
--
--   collective_memberships_billing   One row per (user, chapter). Hash-chained
--                                    state machine (pending → active → past_due
--                                    → cancelled → expired). Links to the
--                                    Stripe customer + subscription ids.
--
--   collective_billing_events        Stripe webhook ledger. UNIQUE(stripe_event_id)
--                                    is the idempotency key — duplicate webhook
--                                    deliveries (Stripe retries on 5xx) no-op.
--                                    Hash-chained for tamper detection.
--
-- This is a SEPARATE Stripe product from the existing platform Founder Pro /
-- Founder Scale subscription. That one is keyed off PAYMENT_GATEWAY_*; this
-- one off STRIPE_SECRET_KEY + STRIPE_COLLECTIVE_{BASIC,STANDARD,PREMIUM}_
-- PRICE_ID + STRIPE_WEBHOOK_SECRET. Avi sets the Dashboard up; the code
-- reads from env vars and gracefully 503s when any is unset.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS collective_memberships_billing (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL,                                -- 'basic' | 'standard' | 'premium'
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | active | past_due | cancelled | expired
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  current_period_start INTEGER,                      -- unix seconds since epoch
  current_period_end INTEGER,                        -- unix seconds since epoch
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,   -- 0/1 boolean
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(user_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS collective_billing_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  billing_id TEXT NOT NULL,
  event_type TEXT NOT NULL,                          -- e.g. 'checkout.session.completed'
  stripe_event_id TEXT NOT NULL UNIQUE,              -- idempotency key
  raw_payload TEXT NOT NULL,                         -- JSON-stringified
  processed_at TEXT NOT NULL,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collective_billing_tenant         ON collective_memberships_billing(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_billing_chapter        ON collective_memberships_billing(chapter_id);
CREATE INDEX IF NOT EXISTS idx_collective_billing_user           ON collective_memberships_billing(user_id);
CREATE INDEX IF NOT EXISTS idx_collective_billing_status         ON collective_memberships_billing(status);
CREATE INDEX IF NOT EXISTS idx_collective_billing_stripe_sub     ON collective_memberships_billing(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_collective_billing_events_billing ON collective_billing_events(billing_id);
CREATE INDEX IF NOT EXISTS idx_collective_billing_events_type    ON collective_billing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_collective_billing_events_tenant  ON collective_billing_events(tenant_id);
