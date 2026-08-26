-- 0200_batch2_g_r110_charge_path_prices_and_zero_flags.sql
-- WAVE 152 · BATCH 2 · ITEM G. Forward-only (R103).
--
-- R116.2: the SPV launch fee is set on THE PATH THAT CHARGES.
-- R110.1: partner account annual = 84000 ($840.00/yr). SPV launch = 24000 ($240.00).
-- R115.2 #1/#2/#4. R115.3 Q4/Q6. R117.2 Q1/Q2/Q3. R117.3(1).
--
-- WHY THIS MIGRATION EXISTS AND WHAT WOULD HAVE HAPPENED WITHOUT IT.
--   The live charge path for launching an SPV is
--     spvEngineStore.updateSpv/markDeployed
--       -> spvEngineDeploymentFeeHook.chargeEngineSpvDeploymentFee
--       -> spvDeploymentFee.chargeSpvDeploymentFee (server/lib/spvDeploymentFee.ts:96)
--       -> spvDeploymentFeeSource.resolveSpvDeploymentFee (:247)
--       -> requireAuthoritativeSpvDeploymentFee (:194)
--       -> readAuthoritativeSpvDeploymentFeeRow: SELECT * FROM platform_fees WHERE key = ? (:148)
--          with key = 'consortium.spv_deployment_fee' (:83).
--   That row held 500000 ($5,000.00). `partner_tier_price` appears NOWHERE in that
--   chain, and no non-test code reads cadence 'one_time'. Seeding $240.00 into
--   partner_tier_price alone would have left every partner charged $5,000.00 while
--   the admin area reported $240.00 -- a 20x overcharge invisible to the person who
--   set the price. R116.1/R116.2.
--
-- Money type floors (w48_money_typefloor_* triggers) accept integer minor units only.
-- NO price literal is introduced into code by this file; these are values to seed and
-- administer (R95).

-- 1 -- THE CHARGE PATH. UPSERT, not UPDATE: server/db/connection.ts seeds this key
--      with INSERT OR IGNORE on a fresh boot, so on a database bootstrapped without
--      migrations the row may be absent at this point or may hold the old 500000.
INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES ('consortium.spv_deployment_fee', 24000, 'USD', '2026-08-26T00:00:00.000Z', 'migration_0200', NULL, NULL)
ON CONFLICT(key) DO UPDATE SET
  amount_minor       = 24000,
  currency           = 'USD',
  billing_period     = NULL,
  deleted_at         = NULL,
  updated_at         = '2026-08-26T00:00:00.000Z',
  updated_by_user_id = 'migration_0200';

-- 2 -- PARTNER ACCOUNT ANNUAL = 84000 on the row the annual checkout charges from
--      (partnerBillingStore.resolveAnnualAmountMinor:237 -> resolveTierPrice:150).
--      catalyst's partner_tier_lifecycle state is 'active' (verified at build time),
--      so trg_ptp_frozen_no_price_update does not fire.
UPDATE partner_tier_price
   SET price_minor = 84000, derivation = 'admin_set', active = 1,
       notes = 'R110.1 Consortium Partner account maintenance, $840.00/yr. Authoritative source. Distinct from platform_fees.founder.capavate_annual, which is the CAPAVATE FOUNDER price and coincidentally the same amount (R115.1).',
       updated_at = '2026-08-26T00:00:00.000Z', updated_by = 'migration_0200'
 WHERE tier_slug = 'catalyst' AND cadence = 'annual';

-- 3 -- R110.3: ladder retained, one tier populated. The four rows that held the
--      SPV-launch figure in a RECURRING slot return to the unpriced sentinel
--      (NULL, which is not 0).
UPDATE partner_tier_price
   SET price_minor = NULL, derivation = 'unpriced',
       notes = 'R110.3 ladder retained, tier not populated. Previously held 24000, which R110 reassigns to the per-SPV launch fee held in platform_fees.consortium.spv_deployment_fee.',
       updated_at = '2026-08-26T00:00:00.000Z', updated_by = 'migration_0200'
 WHERE cadence = 'annual' AND tier_slug IN ('builder','amplifier','nexus','founding_member');

-- 4 -- R115.2 #4 / R116.2: the duplicate $240 sources are RETIRED FROM READ PATHS,
--      never deleted. resolveTierPrice:150 filters active = 1, so active = 0 is
--      exactly "unreadable".
UPDATE partner_tier_price
   SET active = 0,
       notes = 'RETIRED FROM READ PATHS by R115.2 #4 / R116.2. The authoritative SPV launch fee is platform_fees.consortium.spv_deployment_fee, which is the row the charge hook resolves (spvDeploymentFeeSource.ts:148). Row kept, never deleted.',
       updated_at = '2026-08-26T00:00:00.000Z', updated_by = 'migration_0200'
 WHERE cadence = 'one_time';

-- 5 -- R115.2 #2 / R115.3 Q3: founder_free is a FOUNDER slug inside the PARTNER
--      price table. Retire from partner reads; do not delete.
UPDATE partner_tier_price
   SET active = 0,
       notes = 'RETIRED FROM PARTNER READS by R115.2 #2. founder_free is a Capavate FOUNDER tier and must not be resolvable as a partner price. Row kept, never deleted.',
       updated_at = '2026-08-26T00:00:00.000Z', updated_by = 'migration_0200'
 WHERE tier_slug = 'founder_free';

-- 6 -- R115.3 Q6 / R117.2 Q2: "free" and "not configured" become distinguishable IN
--      THE DATA. platform_fees is not STRICT; collective_payment_schedules is not
--      STRICT. Both carry only w48 money type-floor triggers on amount_minor, so
--      ADD COLUMN is safe on both. Neither table had any zero flag before this.
ALTER TABLE platform_fees                ADD COLUMN intentional_zero        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_fees                ADD COLUMN intentional_zero_reason TEXT;
ALTER TABLE platform_fees                ADD COLUMN intentional_zero_by     TEXT;
ALTER TABLE platform_fees                ADD COLUMN intentional_zero_at     TEXT;
ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_reason TEXT;
ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_by     TEXT;
ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_at     TEXT;

-- 7 -- R115.3 Q4 / R117.2 Q3: the one zero ruled a REAL price.
UPDATE platform_fees
   SET intentional_zero = 1,
       intentional_zero_reason = 'R115.3 Q4 / R117.2 Q3 - deliberate promotional free tier, kept by owner ruling.',
       intentional_zero_by = 'migration_0200', intentional_zero_at = '2026-08-26T00:00:00.000Z'
 WHERE key = 'consortium.subscription.founding_member';

-- The five collective_payment_schedules zero rows are LEFT AT intentional_zero = 0,
-- so they render "Not on record" rather than $0.00 (R117.2 Q2, R111 Q13).
--
-- partner_fee_schedules and spv_fee_schedule are DELIBERATELY NOT TOUCHED.
-- R117.3(1): all 8 partner_fee_schedules rows are tier NULL / amount 0. Giving any
-- of them a non-NULL tier makes spvDeploymentFeeSource.ts:265-273 return the banded
-- $0.00 BEFORE the authoritative row is ever read -- i.e. seeding a band would
-- re-create the exact silent-override defect this migration exists to fix.
