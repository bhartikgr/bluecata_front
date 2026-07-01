-- 0068_v25_46_1_consortium_fees.sql
-- v25.46.1 — Multi-section fee admin (APD-018, UPDATED Rule 77).
--
-- ADDITIVE ONLY (Tier 3 #29 additive-only migrations). This migration:
--   (1) adds two nullable columns to platform_fees (billing_period, deleted_at);
--   (2) seeds the NEW recurring subscription-tier rows + the SPV deployment flat
--       fee that back the two new admin fee sections.
--
-- It mirrors the connection.ts bootstrap seed (applyV2545_4Schema) so the dual
-- bootstrap+migration path keeps these rows + columns present on a fresh boot /
-- fresh test DB. INSERT OR IGNORE so an admin edit through the new admin tier
-- CRUD endpoints is NEVER clobbered on re-run / restart — the DB row remains
-- canonical (Tier 3 #27 zero in-memory, 100% DB-driven).
--
-- SEPARATE / PARALLEL to the Capavate founder/investor subscription flow
-- (Sacred Rule 76): these rows live only in platform_fees and never touch
-- capavate_subscriptions, the pricing-tiers tables, paymentGatewayAdapter, or
-- canonicalPlanResolver. The Capavate fee structure stays byte-identical to its
-- pre-v25.46 working state.
--
-- Tier-isolation (Sacred Tier 9 / UPDATED Rule 77): each module tab may have
-- multiple fee structures (one-time + recurring), but cross-tab coupling is
-- forbidden. Keys are namespaced per module:
--   collective.member_subscription.*  → Collective tab, Section B
--   consortium.subscription.*         → Consortium Partners tab, Section A
--   consortium.spv_deployment_fee     → Consortium Partners tab, Section B
-- The existing flat collective_application_fee row (Collective Section A) is
-- UNTOUCHED — same key, same routes.
--
-- DECISION (APD-018): billing_period is stored as an additive TEXT column on
-- platform_fees (default semantics: 'monthly' when NULL for recurring tiers).
-- The tier slug is encoded in the key. We chose the additive column over
-- key-encoding the period so the recurring vs one-time distinction is queryable
-- and the key namespace stays a clean <module>.<structure>.<slug>.
--
-- Unit note: platform_fees.amount_minor holds TRUE minor units (cents).
--   collective.member_subscription.basic        = 9900   cents == $99.00/mo
--   collective.member_subscription.pro          = 24900  cents == $249.00/mo
--   collective.member_subscription.enterprise   = 99900  cents == $999.00/mo
--   consortium.subscription.partner_basic       = 49900  cents == $499.00/mo
--   consortium.subscription.partner_pro         = 99900  cents == $999.00/mo
--   consortium.subscription.partner_enterprise  = 249900 cents == $2,499.00/mo
--   consortium.spv_deployment_fee               = 500000 cents == $5,000.00 (one-time)
--
-- The legacy v2546FeeSeed partner_pro row stays REMOVED (reverted with the rest
-- of the v25.46 fee seed); it is reborn here as consortium.subscription.partner_pro.
--
-- Reversible:
--   UPDATE platform_fees SET deleted_at = '<ts>'
--     WHERE key LIKE 'collective.member_subscription.%'
--        OR key LIKE 'consortium.subscription.%'
--        OR key = 'consortium.spv_deployment_fee';
--
-- The migration runner (server/db/migrate.ts) tolerates "duplicate column name"
-- on ALTER TABLE ADD COLUMN, so re-running this file is idempotent and safe even
-- when connection.ts bootstrap already created the columns on a fresh DB.

-- (1) Additive columns. Guarded by the runner's duplicate-column tolerance.
ALTER TABLE platform_fees ADD COLUMN billing_period TEXT;
ALTER TABLE platform_fees ADD COLUMN deleted_at TEXT;

-- (2a) Collective — Cap Table Investor Membership Subscription tiers (recurring).
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('collective.member_subscription.basic', 9900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('collective.member_subscription.pro', 24900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('collective.member_subscription.enterprise', 99900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

-- (2b) Consortium Partners — Partner Subscription Tiers (recurring).
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('consortium.subscription.partner_basic', 49900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('consortium.subscription.partner_pro', 99900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('consortium.subscription.partner_enterprise', 249900, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL);

-- (2c) Consortium Partners — flat SPV Deployment fee (one-time; billing_period NULL).
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('consortium.spv_deployment_fee', 500000, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', NULL, NULL);
