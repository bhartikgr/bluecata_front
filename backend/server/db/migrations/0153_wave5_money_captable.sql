-- migrations/0153_wave5_money_captable.sql
-- WAVE 5 — MONEY, COMMITMENT AND CAP-TABLE DURABLE SPINE.
--
-- MIGRATION NUMBER — 0153. Verified against THIS tree on 2026-08-10, not assumed:
--   * `ls migrations/*.sql | sort | tail` → highest is 0152 (TWO files claim it:
--     0152_wave8_orp029_engine_spv_deployment_fee.sql and
--     0152_wave9_reporting_audit.sql — Waves 8 and 9 are live in this tree).
--   * `ls server/db/migrations/*.sql | sort | tail` → highest is 0152
--     (0152_wave8_orp029_engine_spv_deployment_fee.sql).
--   * The build brief states 0149/0150/0151 are TAKEN and to use 0152+; 0152 is
--     itself already taken twice, so WAVE 5 takes 0153. This file is mirrored
--     BYTE-IDENTICALLY into migrations/ and server/db/migrations/.
--
-- OWNER RULES HONOURED HERE
--   * Money is INTEGER MINOR UNITS. Every money column below is INTEGER and
--     named `_minor`. There is no REAL money column in this file.
--   * Percentages are FRACTIONS. Every rate column below is an INTEGER on the
--     fixed scale 1e9 (`_scaled`, matching server/lib/money.ts
--     CARRY_FRACTION_SCALE) so that rate/cap comparisons are exact BigInt
--     integer comparisons and never binary float. There is no REAL rate column.
--   * ALL DB-DRIVEN, NO HARDCODING, NO IN-MEMORY. Policy records, tier prices,
--     worker configuration and promotion definitions are ROWS, not constants.
--   * The unified cap-table ledger is canonical (owner ruling Q1; ADR-7
--     withdrawn). Nothing here creates a rival ledger: the idempotency table
--     below is a KEY REGISTRY in front of the one canonical
--     `captableCommitStore.commitFunded` writer, not a second ledger.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / INSERT OR IGNORE.

/* ══════════════════════════════════════════════════════════════════════════
 * P-0 / P-2 — THE OWNER PERCENT RULING, RECORDED AS DATA.
 *
 * v5 of the build spec performed a UNILATERAL restandardisation of percent
 * storage. The owner overruled it (spec/OWNER_RULINGS_2026_08_09.md): STORAGE
 * STAYS FRACTIONAL, admin INPUT is percent-as-written, DISPLAY multiplies by
 * 100 in client/src/lib/percentDisplay.ts. This table is the durable record of
 * that ruling so no later wave can "restandardise" again by assertion.
 *
 * P-2 specifically: VIP = 1 and YC2025 = 0.3 are OWNER-CLOSED, not escalated.
 * They are genuinely 100% and 30%. They are recorded as closed rows below and
 * MUST NOT be re-raised as open questions.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS percent_policy_record (
  id              TEXT    PRIMARY KEY NOT NULL,
  ruling_key      TEXT    NOT NULL UNIQUE,
  ruling_status   TEXT    NOT NULL CHECK (ruling_status IN ('owner_closed','superseded','open')),
  storage_form    TEXT    NOT NULL CHECK (storage_form IN ('fraction','percent','bps','n/a')),
  input_form      TEXT    NOT NULL CHECK (input_form IN ('percent_as_written','fraction','n/a')),
  display_rule    TEXT    NOT NULL,
  ruling_source   TEXT    NOT NULL,
  notes           TEXT,
  decided_at      TEXT    NOT NULL
                    CHECK (decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  decided_by      TEXT    NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ppr_status ON percent_policy_record(ruling_status);

INSERT OR IGNORE INTO percent_policy_record
  (id, ruling_key, ruling_status, storage_form, input_form, display_rule, ruling_source, notes, decided_at, decided_by)
VALUES
  ('ppr_storage_fraction', 'percent.storage_form', 'owner_closed', 'fraction', 'percent_as_written',
   'Multiply by 100 exactly once, in client/src/lib/percentDisplay.ts formatFractionAsPercent. Never a loose * 100 at a call site.',
   'spec/OWNER_RULINGS_2026_08_09.md',
   'Owner ruling 2026-08-09. Storage is FRACTIONAL: 0.2 means 20%. There is no data migration and no storage change. The heuristic n > 1 ? n/100 : n is a KNOWN DEFECT and is banned: it cannot distinguish 1% from 100%.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_v5_restandardisation', 'percent.v5_unilateral_restandardisation', 'superseded', 'n/a', 'n/a',
   'n/a — withdrawn',
   'spec/OWNER_RULINGS_2026_08_09.md',
   'v5 of CONSORTIUM_PARTNER_BUILD restandardised percent storage without an owner decision. WITHDRAWN. The fractional storage ruling above is canonical and supersedes it.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_vip_100', 'discount.VIP', 'owner_closed', 'fraction', 'percent_as_written',
   'formatFractionAsPercent(1) renders "100%".',
   'spec/OWNER_RULINGS_2026_08_09.md',
   'P-2: VIP = 1 genuinely IS 100% off. OWNER-CLOSED. Not an escalation, not an open question, not a data defect. Do not "repair" this value.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_yc2025_30', 'discount.YC2025', 'owner_closed', 'fraction', 'percent_as_written',
   'formatFractionAsPercent(0.3) renders "30%".',
   'spec/OWNER_RULINGS_2026_08_09.md',
   'P-2: YC2025 = 0.3 genuinely IS 30% off. OWNER-CLOSED. Not an escalation.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_commission_rate_exempt', 'percent.partner_commission_rate_config.rate', 'owner_closed', 'fraction', 'fraction',
   'Display was already correct at AdminFeesConsolidated.tsx and AdminCommissionRates.tsx and is untouched.',
   'spec/00_SHARED_STANDARDS.md:39',
   'Exempt from ANY storage conversion. Storage untouched.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_rate_comparison_exact', 'percent.rate_comparison', 'owner_closed', 'fraction', 'n/a',
   'Rate and cap comparisons use exact fixed-scale BigInt on CARRY_FRACTION_SCALE=1e9 (server/lib/money.ts). 0.5000000000000001 + 0.5 must REJECT, not silently round.',
   'spec/OWNER_RULINGS_2026_08_09.md + WAVE 3D item 4',
   'Binary float comparison of rates is banned on every persisted money path.',
   '2026-08-09T00:00:00Z', 'owner'),
  ('ppr_hurdle_domain', 'percent.spv.hurdleRatePct', 'owner_closed', 'percent', 'percent_as_written',
   'The SPV wizard writes hurdle PERCENT-AS-WRITTEN (8 means 8%). It is normalised to a fraction at the route boundary before it reaches the store. Domain 0..100 inclusive.',
   'spec/OWNER_RULINGS_2026_08_09.md + P-4/P-6/P-7',
   'P-4: the REAL per-field domains differ. hurdleRatePct is 0..100 (percent as written by client/src/pages/partner/PartnerSpvEngine.tsx placeholder "e.g. 8"); carryPct and gpCatchUpPct are 0..1 fractions. A single frac() that clamps everything to min(1,n) silently turned an 8% hurdle into a 100% hurdle.',
   '2026-08-09T00:00:00Z', 'owner');

/* ══════════════════════════════════════════════════════════════════════════
 * P-10 — MIGRATIONS 0121-0123 MARKED SUPERSEDED-IN-PART (DEF-068).
 *
 * Those migrations encode percent assumptions that the owner ruling above
 * overrides IN PART. They are NOT reverted (their tables are live); they are
 * ANNOTATED so a reader of the migration tree cannot take their percent
 * convention as current.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS migration_supersession (
  id                TEXT    PRIMARY KEY NOT NULL,
  migration_id      TEXT    NOT NULL,
  superseded_by     TEXT    NOT NULL,
  scope             TEXT    NOT NULL CHECK (scope IN ('in_part','in_full')),
  reason            TEXT    NOT NULL,
  recorded_at       TEXT    NOT NULL
                      CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  recorded_by       TEXT    NOT NULL,
  UNIQUE (migration_id, superseded_by)
) STRICT;

INSERT OR IGNORE INTO migration_supersession
  (id, migration_id, superseded_by, scope, reason, recorded_at, recorded_by)
VALUES
  ('msup_0121_p10', '0121', 'percent_policy_record.ppr_storage_fraction', 'in_part',
   'DEF-068: migration 0121 percent columns are read under the FRACTIONAL storage ruling. Its own inline convention notes are superseded in part. Tables and data are unchanged.',
   '2026-08-10T00:00:00Z', 'system:wave5_p10'),
  ('msup_0122_p10', '0122', 'percent_policy_record.ppr_storage_fraction', 'in_part',
   'DEF-068: as 0121. Superseded in part by the owner percent ruling. Tables and data unchanged.',
   '2026-08-10T00:00:00Z', 'system:wave5_p10'),
  ('msup_0123_p10', '0123', 'percent_policy_record.ppr_storage_fraction', 'in_part',
   'DEF-068: as 0121. Superseded in part by the owner percent ruling. Tables and data unchanged.',
   '2026-08-10T00:00:00Z', 'system:wave5_p10');

/* ══════════════════════════════════════════════════════════════════════════
 * P-11 — P.5 COLUMN REPAIRS (DEF-064, DEF-065).
 *
 * server/db/connection.ts is SACRED and MUST NOT be edited, and SQLite cannot
 * ALTER TABLE ... ADD CONSTRAINT. Both repairs are therefore delivered as
 * ENFORCING TRIGGERS, which are exactly as binding as a CHECK at write time and
 * do not require rewriting a sacred DDL file or rebuilding a hashed table.
 *
 * DEF-064 — founder_collective_applications.traction_growth_pct is
 *   `INTEGER NOT NULL DEFAULT 0` (connection.ts:3803) with NO domain CHECK. It
 *   is a METRIC_PCT: a growth metric in PERCENT units, which may legitimately
 *   exceed 100 (200% growth is real) but may not be absurd or negative-infinite.
 *   Fenced to -100 .. 100000.
 *
 * DEF-065 — captable_commits.discount_pct is TEXT (connection.ts:2742, :3365).
 *   The column is part of the UNPRICED hash body in the SACRED
 *   server/captableCommitStore.ts, so its STORAGE TYPE AND BYTES MUST NOT
 *   CHANGE — rewriting TEXT to numeric would rewrite every unpriced row's hash
 *   and break the chain. The repair is therefore a DOMAIN FENCE, not a type
 *   change: the trigger rejects any non-numeric or out-of-domain TEXT so the
 *   column is numerically well-formed from now on, and a parallel
 *   `discount_pct_scaled` INTEGER column carries the exact fixed-scale integer
 *   for arithmetic. Reads that need a number read the scaled column; the hash
 *   body still reads the untouched TEXT.
 * ═══════════════════════════════════════════════════════════════════════ */

CREATE TRIGGER IF NOT EXISTS trg_fca_traction_growth_pct_ins
  BEFORE INSERT ON founder_collective_applications
  WHEN NEW.traction_growth_pct IS NOT NULL
   AND (CAST(NEW.traction_growth_pct AS INTEGER) < -100
        OR CAST(NEW.traction_growth_pct AS INTEGER) > 100000)
  BEGIN SELECT RAISE(ABORT, 'METRIC_PCT_OUT_OF_DOMAIN:traction_growth_pct'); END;

CREATE TRIGGER IF NOT EXISTS trg_fca_traction_growth_pct_upd
  BEFORE UPDATE OF traction_growth_pct ON founder_collective_applications
  WHEN NEW.traction_growth_pct IS NOT NULL
   AND (CAST(NEW.traction_growth_pct AS INTEGER) < -100
        OR CAST(NEW.traction_growth_pct AS INTEGER) > 100000)
  BEGIN SELECT RAISE(ABORT, 'METRIC_PCT_OUT_OF_DOMAIN:traction_growth_pct'); END;

CREATE TRIGGER IF NOT EXISTS trg_captable_commits_discount_pct_ins
  BEFORE INSERT ON captable_commits
  WHEN NEW.discount_pct IS NOT NULL
   AND (NEW.discount_pct = ''
        OR CAST(NEW.discount_pct AS REAL) < 0
        OR CAST(NEW.discount_pct AS REAL) > 1)
  BEGIN SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1'); END;

CREATE TRIGGER IF NOT EXISTS trg_captable_commits_discount_pct_upd
  BEFORE UPDATE OF discount_pct ON captable_commits
  WHEN NEW.discount_pct IS NOT NULL
   AND (NEW.discount_pct = ''
        OR CAST(NEW.discount_pct AS REAL) < 0
        OR CAST(NEW.discount_pct AS REAL) > 1)
  BEGIN SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1'); END;

/* ══════════════════════════════════════════════════════════════════════════
 * P-12 — contacts.commission_override_pct DOMAIN FENCE (DEF-013).
 *
 * connection.ts:2068 declares the column `REAL` with NO domain. The admin route
 * server/lib/partnerFeeAdminRoutes.ts:182 DOES clamp to [0,1] — but a clamp in
 * ONE route is not a domain. The value is read at the TOP of the fee-resolution
 * precedence chain (server/lib/partnerFeeResolver.ts:210-213 returns it raw and
 * it OUTRANKS every schedule row), so a single bad write anywhere — an import,
 * an admin SQL fix, a future route — silently outranks the good clamp for every
 * subsequent commission calculation.
 *
 * This trigger makes the domain a PROPERTY OF THE COLUMN, so there is no
 * "second path" left to fence.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TRIGGER IF NOT EXISTS trg_contacts_commission_override_pct_ins
  BEFORE INSERT ON contacts
  WHEN NEW.commission_override_pct IS NOT NULL
   AND (NEW.commission_override_pct < 0 OR NEW.commission_override_pct > 1)
  BEGIN SELECT RAISE(ABORT, 'COMMISSION_OVERRIDE_PCT_OUT_OF_DOMAIN:expected fraction 0..1'); END;

CREATE TRIGGER IF NOT EXISTS trg_contacts_commission_override_pct_upd
  BEFORE UPDATE OF commission_override_pct ON contacts
  WHEN NEW.commission_override_pct IS NOT NULL
   AND (NEW.commission_override_pct < 0 OR NEW.commission_override_pct > 1)
  BEGIN SELECT RAISE(ABORT, 'COMMISSION_OVERRIDE_PCT_OUT_OF_DOMAIN:expected fraction 0..1'); END;

/* ══════════════════════════════════════════════════════════════════════════
 * FE-16 — RENEWAL WORKER CONFIGURATION (reverses v2 decision D-16).
 *
 * server/lib/collectiveRenewalWorker.ts:73 gates the worker on
 * `process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED === "1"`, and its poll/lead
 * windows are read from env too. That is HARDCODED CONFIGURATION IN PROCESS
 * MEMORY: an operator cannot see it, cannot change it without a redeploy, and
 * it is not reflected in the UI. v2 decision D-16 accepted the env gate; FE-16
 * reverses it. The env var is retained ONLY as the seed value / emergency
 * override, and the DB row is authoritative.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS collective_renewal_worker_config (
  id                    TEXT    PRIMARY KEY NOT NULL CHECK (id = 'singleton'),
  enabled               INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  poll_interval_ms      INTEGER NOT NULL DEFAULT 60000 CHECK (poll_interval_ms >= 1000 AND poll_interval_ms <= 86400000),
  lead_window_sec       INTEGER NOT NULL DEFAULT 86400 CHECK (lead_window_sec >= 0 AND lead_window_sec <= 2592000),
  max_consecutive_failures INTEGER NOT NULL DEFAULT 3 CHECK (max_consecutive_failures >= 1 AND max_consecutive_failures <= 100),
  quiet_after_write_min INTEGER NOT NULL DEFAULT 30 CHECK (quiet_after_write_min >= 0 AND quiet_after_write_min <= 1440),
  env_override_allowed  INTEGER NOT NULL DEFAULT 1 CHECK (env_override_allowed IN (0,1)),
  updated_at            TEXT    NOT NULL
                          CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by            TEXT
) STRICT;

INSERT OR IGNORE INTO collective_renewal_worker_config
  (id, enabled, poll_interval_ms, lead_window_sec, max_consecutive_failures, quiet_after_write_min, env_override_allowed, updated_at, updated_by)
VALUES
  ('singleton', 0, 60000, 86400, 3, 30, 1, '2026-08-10T00:00:00Z', 'system:wave5_fe16_seed');

/* ══════════════════════════════════════════════════════════════════════════
 * W-7 / CP-SUB-12 / CP-SUB-13 / CP-SUB-19 — PARTNER TIER PRICES, PER CADENCE,
 * ADMIN-SET. NEVER "MONTHLY TIMES TWELVE" (DEF-059, OR-2).
 *
 * THE DEFECT. server/lib/partnerSelfServiceRoutes.ts:500 computes the annual
 * amount as `plan.effectivePrice.amountMinor * 12`. That is a HARDCODED PRICING
 * MODEL: it makes an annual plan exactly twelve monthly payments, so the
 * platform can never offer an annual discount, and an admin who sets an annual
 * price in the pricing surface is silently ignored on this path. Four more
 * `* 12` sites exist tree-wide (server/subscriptionsStore.ts:129,
 * server/adminPricingStore.ts:49, server/adminPlatformStore.ts:2209,
 * server/pricingTiersStore.ts:103) plus server/paymentGatewayAdapter.ts:1492 —
 * which is SACRED and is read, never edited.
 *
 * THE FIX. An ADMIN-SET per-(tier, cadence) price row. When a row exists it is
 * authoritative and the ×12 convention is not consulted at all. When no row
 * exists the legacy ×12 fallback still applies, so no deploy changes price
 * without an admin action — but the fallback is now LABELLED in the response
 * (`derivation`) instead of being invisible.
 *
 * CP-SUB-13 — EIGHT TIER SLUGS. All eight are seeded below at
 * `price_minor = NULL`, which means "not priced yet, fall back": seeding a
 * price would invent money. The rows exist so the admin surface can enumerate
 * every tier and show which are unpriced, which is the actual SUB-13 promise.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS partner_tier_price (
  id                TEXT    PRIMARY KEY NOT NULL,
  tier_slug         TEXT    NOT NULL,
  cadence           TEXT    NOT NULL CHECK (cadence IN ('monthly','annual','quarterly','one_time')),
  -- NULL means DELIBERATELY UNPRICED. It is not zero. A zero price is a real
  -- free tier and must be written as 0, never left NULL.
  price_minor       INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
  currency          TEXT    NOT NULL DEFAULT 'USD',
  -- How this price was arrived at. 'admin_set' is authoritative.
  -- 'derived_x12' rows are written ONLY by an explicit admin "adopt the legacy
  -- multiple" action, so the derivation is visible rather than implicit.
  derivation        TEXT    NOT NULL DEFAULT 'unpriced'
                      CHECK (derivation IN ('unpriced','admin_set','derived_x12')),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  effective_from    TEXT,
  notes             TEXT,
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at        TEXT    NOT NULL
                      CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by        TEXT,
  UNIQUE (tier_slug, cadence)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ptp_lookup ON partner_tier_price(tier_slug, cadence, active);

-- CP-SUB-13 — the eight partner tier slugs, monthly + annual, deliberately
-- UNPRICED. Enumerated so the admin roster can show coverage; priced by an
-- admin, never by this migration.
INSERT OR IGNORE INTO partner_tier_price
  (id, tier_slug, cadence, price_minor, currency, derivation, active, created_at, updated_at, updated_by)
VALUES
  ('ptp_starter_m',      'starter',      'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_starter_a',      'starter',      'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_growth_m',       'growth',       'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_growth_a',       'growth',       'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_professional_m', 'professional', 'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_professional_a', 'professional', 'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_enterprise_m',   'enterprise',   'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_enterprise_a',   'enterprise',   'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_boutique_m',     'boutique',     'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_boutique_a',     'boutique',     'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_syndicate_m',    'syndicate',    'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_syndicate_a',    'syndicate',    'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_accelerator_m',  'accelerator',  'monthly', NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_accelerator_a',  'accelerator',  'annual',  NULL, 'USD', 'unpriced', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_founder_free_m', 'founder_free', 'monthly', 0,    'USD', 'admin_set', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13'),
  ('ptp_founder_free_a', 'founder_free', 'annual',  0,    'USD', 'admin_set', 1, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave5_sub13');

-- CP-SUB-19 — OWNER DECISION on the annual pricing model, recorded as an OPEN
-- decision rather than answered by this migration. Owner? = Y on this item; a
-- build must not invent a pricing policy. The row exists so the question is
-- visible in the product and cannot be silently dropped.
INSERT OR IGNORE INTO percent_policy_record
  (id, ruling_key, ruling_status, storage_form, input_form, display_rule, ruling_source, notes, decided_at, decided_by)
VALUES
  ('ppr_annual_pricing_model', 'pricing.annual_model', 'open', 'n/a', 'n/a',
   'n/a — awaiting owner decision',
   'spec/PARTNER_BUILT_VS_PROMISED.md SUB-19 (NEVER-SCOPED); register row PRM-025',
   'CP-SUB-19 (Owner? = Y). Is the annual partner price (a) a per-tier admin-set absolute amount, (b) monthly x 12 with an admin-set discount fraction, or (c) monthly x 12 exactly? WAVE 5 built (a) as the mechanism and left the legacy x12 as the labelled fallback, so any of the three can be expressed without further schema work. NO DEFAULT WAS INVENTED: every tier ships price_minor = NULL (unpriced) except founder_free = 0.',
   '2026-08-10T00:00:00Z', 'system:wave5_sub19_open');

/* ══════════════════════════════════════════════════════════════════════════
 * CP-SUB-05 — THE CANONICAL PARTNER SUBSCRIPTION RECORD.
 *
 * Proof of absence (spec/PRIOR_ART_SWEEP.md reuse target for SUB-05, re-run
 * against this tree): server/subscriptionStore.ts is the CAPAVATE COMPANY
 * subscription store (`CapavateSubscription`, keyed by companyId + Airwallex
 * payment intent). server/subscriptionsStore.ts is the PRICING-MODEL store. A
 * partner's subscription state today is scattered across contacts columns,
 * fee_override_json and the payment ledger — there is no single row that says
 * "this partner is on this tier, at this cadence, for this period, at this
 * amount". Every SUB-* item downstream needs that row to exist.
 *
 * The gateway remains the source of truth for MONEY MOVEMENT; this row is the
 * source of truth for ENTITLEMENT. `payment_intent_id` is the join.
 * ═══════════════════════════════════════════════════════════════════════ */
/* ─────────────────────────────────────────────────────────────────────────
 * SUPERSEDED BY WAVE 13 — THIS DECLARATION IS DELIBERATELY GONE.
 *
 * This migration used to CREATE TABLE IF NOT EXISTS partner_subscription with
 * (partner_id, tier_slug, cadence, period_start, period_end, …). Migration
 * 0167_wave11_partner_subscription_engine.sql:37 creates the SAME table name
 * with the persona-agnostic (subject_kind, subject_id, cycle,
 * current_period_start, current_period_end, …) shape that EN-8 requires and
 * that server/lib/partnerSubscriptionStore.ts, subscriptionEnforcementWorker.ts
 * and subscriptionChangeStore.ts read and write.
 *
 * Because 0153 sorts FIRST, this declaration won and 0167's became a silent
 * `IF NOT EXISTS` no-op — after which 0167's own subject-keyed indexes could
 * not be created ("no such column: subject_kind") and every fresh database was
 * left with a table no consumer agreed with. Deleting the declaration here is
 * what lets 0167 be the first and only CREATE on a new database.
 *
 * Nothing is lost on a server that already applied this file: the table it
 * created is REBUILT ROW-FOR-ROW into the canonical shape by
 * 0169_wave13_partner_subscription_shape_reconcile.sql, which also carries
 * partner_id → subject_id, cadence → cycle and period_* → current_period_*,
 * and which keeps the Wave 5 money columns this table introduced
 * (list_amount_minor, grandfathered_from, superseded_by, superseded_reason)
 * plus the `amount = list - discount` invariant.
 *
 * The CANONICAL DECLARATION LIVES IN EXACTLY ONE PLACE NOW:
 *   migrations/0169_wave13_partner_subscription_shape_reconcile.sql
 * and server/__tests__/waveW13_migration_shape_collision_guard.test.ts fails
 * if a second differing declaration is ever added again.
 * ───────────────────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════════════
 * CP-SUB-09 / CP-COM-02 / CP-COM-04 / CP-COM-05 — PARTNER INVOICES AND THE
 * FIVE BILLING-ENTRY KINDS.
 *
 * COM-05 names five billing-entry kinds. They are a CHECK on the line table, so
 * an unknown kind is a write error rather than a rendering surprise:
 *   subscription · commission · spv_fee · adjustment · refund
 *
 * COM-04 — pending vs paid commission split. `settlement_state` on the LINE, not
 * only on the invoice, because a single consolidated invoice legitimately mixes
 * a paid subscription line with a pending commission line. Splitting at invoice
 * grain would have forced the two apart and lost the consolidation COM-02 asks
 * for.
 *
 * CENT CONSERVATION: `total_minor` on the invoice must equal the SUM of its
 * lines. SQLite cannot express that as a CHECK across tables, so it is enforced
 * by the triggers below AND re-asserted by the writer. Both, deliberately.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS partner_invoice (
  id                TEXT    PRIMARY KEY NOT NULL,
  partner_id        TEXT    NOT NULL,
  invoice_number    TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL CHECK (status IN ('draft','issued','paid','void','uncollectible')),
  currency          TEXT    NOT NULL DEFAULT 'USD',
  -- Denormalised sum of the lines, in INTEGER MINOR UNITS. Kept exact by
  -- trg_pinvl_* below.
  total_minor       INTEGER NOT NULL DEFAULT 0,
  period_start      TEXT,
  period_end        TEXT,
  issued_at         TEXT,
  paid_at           TEXT,
  voided_at         TEXT,
  subscription_id   TEXT,
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at        TEXT    NOT NULL
                      CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pinv_partner ON partner_invoice(partner_id, status, created_at);

CREATE TABLE IF NOT EXISTS partner_invoice_line (
  id                TEXT    PRIMARY KEY NOT NULL,
  invoice_id        TEXT    NOT NULL REFERENCES partner_invoice(id),
  -- COM-05 — the five billing-entry kinds, enumerated and enforced.
  entry_kind        TEXT    NOT NULL
                      CHECK (entry_kind IN ('subscription','commission','spv_fee','adjustment','refund')),
  description       TEXT    NOT NULL,
  -- INTEGER MINOR UNITS. May be NEGATIVE for 'refund' and 'adjustment' lines;
  -- the CHECK below binds sign to kind so a positive refund cannot be written.
  amount_minor      INTEGER NOT NULL,
  -- COM-04 — pending vs paid, at LINE grain.
  settlement_state  TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (settlement_state IN ('pending','paid','waived','failed')),
  source_ref        TEXT,
  settled_at        TEXT,
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (
    (entry_kind = 'refund'     AND amount_minor <= 0) OR
    (entry_kind = 'adjustment') OR
    (entry_kind IN ('subscription','commission','spv_fee') AND amount_minor >= 0)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pinvl_invoice ON partner_invoice_line(invoice_id, entry_kind, settlement_state);

-- CENT CONSERVATION AT THE DB. The invoice total is maintained by the database
-- from the lines, so it CANNOT drift from them, no matter which writer inserts
-- the line. This is the schema-level answer to "is there a SECOND path to this
-- write?" — there may be, and it still cannot break the sum.
CREATE TRIGGER IF NOT EXISTS trg_pinvl_after_insert
  AFTER INSERT ON partner_invoice_line
  BEGIN
    UPDATE partner_invoice
       SET total_minor = (SELECT COALESCE(SUM(amount_minor), 0)
                            FROM partner_invoice_line WHERE invoice_id = NEW.invoice_id)
     WHERE id = NEW.invoice_id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_pinvl_after_update
  AFTER UPDATE ON partner_invoice_line
  BEGIN
    UPDATE partner_invoice
       SET total_minor = (SELECT COALESCE(SUM(amount_minor), 0)
                            FROM partner_invoice_line WHERE invoice_id = NEW.invoice_id)
     WHERE id = NEW.invoice_id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_pinvl_after_delete
  AFTER DELETE ON partner_invoice_line
  BEGIN
    UPDATE partner_invoice
       SET total_minor = (SELECT COALESCE(SUM(amount_minor), 0)
                            FROM partner_invoice_line WHERE invoice_id = OLD.invoice_id)
     WHERE id = OLD.invoice_id;
  END;

-- An ISSUED or PAID invoice is a legal document. Its lines are frozen.
CREATE TRIGGER IF NOT EXISTS trg_pinvl_no_insert_on_issued
  BEFORE INSERT ON partner_invoice_line
  WHEN (SELECT status FROM partner_invoice WHERE id = NEW.invoice_id) IN ('issued','paid','void')
  BEGIN SELECT RAISE(ABORT, 'PARTNER_INVOICE_FROZEN:cannot add a line to an issued/paid/void invoice'); END;

/* ══════════════════════════════════════════════════════════════════════════
 * CP-PROMO-07 / 09 / 19 / 20 / 23 — SCOPED PROMOTIONS.
 *
 * PROMO-07 asks for SCOPED `DiscountCode` fields. The existing discount engine
 * (server/paymentStore.ts calcCouponDiscountCents:159 over
 * pricingModelStore.findDiscountCodeByCode) is GLOBAL BY DESIGN — its own doc
 * comment says the lookup has "no model/product-line scoping" because that
 * preserved the old hardcoded map's scope exactly. XT-4 wires THAT engine to the
 * partner path unchanged; this table adds the SCOPE the engine does not carry,
 * without forking the engine's arithmetic.
 *
 * PROMO-09 "value migration 0138": 0138 is centrally allocated elsewhere
 * (spec/00_SHARED_STANDARDS.md §4) and is NOT free in this tree. The VALUE
 * migration it describes is performed here, in 0153, over the scoped table —
 * the number was the accident, the value semantics are the requirement.
 * Percentage promotion values are stored as EXACT INTEGERS ON SCALE 1e9, so a
 * promotion rate is compared and combined with BigInt integer arithmetic and
 * never with a binary float.
 *
 * PROMO-19 — a promotion SUPERSEDES `founder_free` rather than stacking with it.
 * That is a data rule (`supersedes_grandfathered`), enforced by the grant writer.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS partner_promotion (
  id                        TEXT    PRIMARY KEY NOT NULL,
  code                      TEXT    NOT NULL UNIQUE,
  name                      TEXT    NOT NULL,
  -- PROMO-07 SCOPE. A promotion applies to ONE scope, never implicitly to all.
  scope_kind                TEXT    NOT NULL
                              CHECK (scope_kind IN ('platform','tier','partner','deal')),
  scope_id                  TEXT    NOT NULL,
  -- PROMO-09 VALUE SEMANTICS. Exactly one of the two value columns is set.
  value_kind                TEXT    NOT NULL
                              CHECK (value_kind IN ('percent','flat_minor','trial_extension_days')),
  -- FRACTION on scale 1e9. 1000000000 = 100%. Integer, so comparisons are exact.
  value_scaled              INTEGER CHECK (value_scaled IS NULL OR (value_scaled >= 0 AND value_scaled <= 1000000000)),
  -- INTEGER MINOR UNITS for a flat discount.
  value_minor               INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  value_days                INTEGER CHECK (value_days IS NULL OR value_days >= 0),
  -- PROMO-19 — supersedes a grandfathered free tier instead of stacking.
  supersedes_grandfathered  INTEGER NOT NULL DEFAULT 0 CHECK (supersedes_grandfathered IN (0,1)),
  -- PROMO-20 — moderation.
  moderation_state          TEXT    NOT NULL DEFAULT 'draft'
                              CHECK (moderation_state IN ('draft','pending_review','approved','rejected','changes_requested')),
  moderation_note           TEXT,
  moderated_by              TEXT,
  moderated_at              TEXT,
  active                    INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  max_redemptions           INTEGER CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  redemption_count          INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  expires_at                TEXT,
  created_at                TEXT    NOT NULL
                              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at                TEXT    NOT NULL
                              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  created_by                TEXT,
  -- Exactly one value column populated, matching value_kind. A promotion with
  -- no value, or with two, is not writable.
  CHECK (
    (value_kind = 'percent'              AND value_scaled IS NOT NULL AND value_minor IS NULL     AND value_days IS NULL) OR
    (value_kind = 'flat_minor'           AND value_minor  IS NOT NULL AND value_scaled IS NULL    AND value_days IS NULL) OR
    (value_kind = 'trial_extension_days' AND value_days   IS NOT NULL AND value_scaled IS NULL    AND value_minor IS NULL)
  ),
  -- An ACTIVE promotion must have been APPROVED. Moderation is not advisory.
  CHECK (active = 0 OR moderation_state = 'approved')
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ppromo_lookup ON partner_promotion(code, active);
CREATE INDEX IF NOT EXISTS idx_ppromo_scope  ON partner_promotion(scope_kind, scope_id, active);
CREATE INDEX IF NOT EXISTS idx_ppromo_mod    ON partner_promotion(moderation_state);

CREATE TABLE IF NOT EXISTS partner_promotion_grant (
  id                    TEXT    PRIMARY KEY NOT NULL,
  promotion_id          TEXT    NOT NULL REFERENCES partner_promotion(id),
  partner_id            TEXT    NOT NULL,
  subscription_id       TEXT,
  -- The discount ACTUALLY applied, in INTEGER MINOR UNITS, as computed by the
  -- existing engine. Recorded so the grant is auditable against the invoice.
  applied_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (applied_discount_minor >= 0),
  -- PROMO-19 — what this grant superseded, if anything.
  superseded_status     TEXT,
  granted_at            TEXT    NOT NULL
                          CHECK (granted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  granted_by            TEXT,
  revoked_at            TEXT,
  revoked_reason        TEXT,
  -- One live grant of a promotion per partner. Re-granting the same promotion
  -- is a no-op, not a second discount.
  UNIQUE (promotion_id, partner_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ppgrant_partner ON partner_promotion_grant(partner_id, revoked_at);

-- CP-PROMO-23 / CP-SUB-15 — PROMOTION AND SUBSCRIPTION EVENTS.
-- SUB-15 says REUSE EXISTING OUTBOUND EVENT NAMES rather than minting a parallel
-- vocabulary. This table is the durable outbox; `event_name` values are the
-- ones the tree already emits (see server/lib/wave5EventNames.ts, which reads
-- the emitted-name inventory rather than declaring new strings).
CREATE TABLE IF NOT EXISTS partner_money_event (
  id            TEXT    PRIMARY KEY NOT NULL,
  event_name    TEXT    NOT NULL,
  partner_id    TEXT,
  subject_kind  TEXT    NOT NULL
                  CHECK (subject_kind IN ('subscription','invoice','promotion','commission','captable_commit')),
  subject_id    TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL,
  emitted_at    TEXT    NOT NULL
                  CHECK (emitted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pme_subject ON partner_money_event(subject_kind, subject_id, emitted_at);
CREATE INDEX IF NOT EXISTS idx_pme_partner ON partner_money_event(partner_id, emitted_at);

/* ══════════════════════════════════════════════════════════════════════════
 * L-2 — CAP-TABLE COMMIT IDEMPOTENCY KEYS.
 *
 * THE CANONICAL LEDGER IS server/captableCommitStore.ts (SACRED — read, never
 * edited). Its `commitFunded` is ALREADY idempotent by `invitationId`: the
 * deployment route at server/spvEngineRoutes.ts:476 passes the deterministic
 * `spvdep_${dep.id}`, which is what makes a double-POST safe today.
 *
 * WHAT IS MISSING is not idempotency inside the sacred store — it is a DURABLE,
 * INSPECTABLE RECORD of the key that was used, who used it, and what came back.
 * Without it, an operator asking "did this deployment already hit the ledger?"
 * has to infer from `dep.capTableLedgerRef`, which is written AFTER the ledger
 * write and is therefore absent in exactly the crash window that matters.
 *
 * This table is written BEFORE the sacred call (state 'claimed') and updated
 * after it (state 'committed' / 'failed'), so a crash between the two leaves a
 * 'claimed' row that names the key — which is recoverable — instead of nothing.
 * The UNIQUE key is the second lock: two concurrent requests cannot both claim.
 *
 * It is NOT a ledger. It stores no shares and no hash body. It stores the KEY.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS captable_commit_idempotency (
  id                TEXT    PRIMARY KEY NOT NULL,
  -- The exact `invitationId` handed to captableCommitStore.commitFunded.
  idempotency_key   TEXT    NOT NULL UNIQUE,
  source_kind       TEXT    NOT NULL
                      CHECK (source_kind IN ('spv_deployment','lp_commitment','admin_override','import')),
  source_id         TEXT    NOT NULL,
  partner_id        TEXT,
  company_id        TEXT    NOT NULL,
  round_id          TEXT    NOT NULL,
  investor_id       TEXT    NOT NULL,
  amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency          TEXT    NOT NULL DEFAULT 'USD',
  shares            TEXT    NOT NULL,
  state             TEXT    NOT NULL CHECK (state IN ('claimed','committed','failed')),
  ledger_hash       TEXT,
  ledger_seq        INTEGER,
  failure_reason    TEXT,
  claimed_at        TEXT    NOT NULL
                      CHECK (claimed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  resolved_at       TEXT,
  claimed_by        TEXT,
  -- A committed claim MUST carry the ledger hash it produced. A claim cannot
  -- be marked committed without evidence.
  CHECK (state <> 'committed' OR ledger_hash IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ccidem_source ON captable_commit_idempotency(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_ccidem_state  ON captable_commit_idempotency(state, claimed_at);

/* ══════════════════════════════════════════════════════════════════════════
 * S-3 — SPV FEE-TABLE HYDRATION MUST FAIL CLOSED.
 *
 * server/spvEngineStore.ts:2850 loads `spv_fee` during hydration inside a
 * best-effort block. If that load fails, the in-process fee table is EMPTY and
 * `effectiveFee` returns null for every layer — which makes
 * `hasUnsettledFixedFees` (:729) return FALSE for a fixed-fee SPV, which OPENS
 * the fail-closed gate at the cap-table commit route
 * (server/spvEngineRoutes.ts:469 `FEES_UNPAID`). A load failure therefore does
 * not degrade to "no fees known"; it degrades to "all fees settled". That is
 * the wrong direction for money.
 *
 * This row is the DURABLE hydration verdict. `hasUnsettledFixedFees` consults it
 * and returns TRUE (unsettled → gate stays shut) whenever the last hydration of
 * the fee table did not succeed.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS spv_fee_hydration_state (
  id            TEXT    PRIMARY KEY NOT NULL CHECK (id = 'singleton'),
  state         TEXT    NOT NULL CHECK (state IN ('never_run','ok','failed')),
  rows_loaded   INTEGER NOT NULL DEFAULT 0 CHECK (rows_loaded >= 0),
  error_message TEXT,
  checked_at    TEXT    NOT NULL
                  CHECK (checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

-- Seeded as 'never_run', which FAILS CLOSED until a hydration actually succeeds.
INSERT OR IGNORE INTO spv_fee_hydration_state (id, state, rows_loaded, error_message, checked_at)
VALUES ('singleton', 'never_run', 0, NULL, '2026-08-10T00:00:00Z');

/* ══════════════════════════════════════════════════════════════════════════
 * MON-1 — THE COLLECTIVE APPLICATION-FEE MIRROR IS LOSSY.
 *
 * server/lib/airwallexCollective.ts:211 mirrors a configured price with
 * `amountMinor: Math.round(row.amount_minor)`. `amount_minor` is already an
 * INTEGER minor-unit column; `Math.round` on it is a no-op that LOOKS like
 * rounding, and it is the exact shape of the cent-conservation defect the money
 * rules ban — if the column ever carried a fractional value, the mirror would
 * silently round it and the mirrored amount would not equal the configured one.
 * The repair is to REJECT a non-integer rather than round it, and to record the
 * rejection so a misconfigured price is visible instead of quietly charged.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS collective_fee_mirror_reject (
  id              TEXT    PRIMARY KEY NOT NULL,
  tier            TEXT    NOT NULL,
  raw_amount      TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  rejected_at     TEXT    NOT NULL
                    CHECK (rejected_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cfmr_tier ON collective_fee_mirror_reject(tier, rejected_at);

/* ══════════════════════════════════════════════════════════════════════════
 * FL-1 — FEE LOCK (Q8 APPROVED). CST-045.
 *
 * The `spv_fee` hash chain (server/spvEngineStore.ts:623-632) can be rebuilt by
 * the owner-selected remedy in ONE transaction. Rebuilding a hash chain is a
 * destructive, once-only operation: it MUST leave a durable record of what the
 * chain looked like before, or the rebuild is indistinguishable from tampering.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS spv_fee_chain_rebuild (
  id                  TEXT    PRIMARY KEY NOT NULL,
  remedy              TEXT    NOT NULL CHECK (remedy IN ('rechain_in_place','quarantine_and_rechain')),
  rows_rechained      INTEGER NOT NULL CHECK (rows_rechained >= 0),
  old_tip_hash        TEXT,
  new_tip_hash        TEXT,
  -- The fee LOCK: once a rebuild is recorded, fee rows at or before the locked
  -- tip are frozen. Q8 approved.
  locked              INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0,1)),
  reason              TEXT    NOT NULL,
  performed_at        TEXT    NOT NULL
                        CHECK (performed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  performed_by        TEXT    NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS trg_sfcr_no_update
  BEFORE UPDATE ON spv_fee_chain_rebuild
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_CHAIN_REBUILD_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_sfcr_no_delete
  BEFORE DELETE ON spv_fee_chain_rebuild
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_CHAIN_REBUILD_IMMUTABLE'); END;

/* ══════════════════════════════════════════════════════════════════════════
 * Q5 — VALUATION MARKS AUTO-DERIVE, BADGED, STALE AT 180/365d, GP-OVERRIDABLE.
 *
 * The staleness thresholds are OWNER POLICY and are therefore ROWS, not
 * constants. A future owner ruling changes a row, not a deploy.
 * ═══════════════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS valuation_mark_policy (
  id                  TEXT    PRIMARY KEY NOT NULL CHECK (id = 'singleton'),
  auto_derive         INTEGER NOT NULL DEFAULT 1 CHECK (auto_derive IN (0,1)),
  stale_warn_days     INTEGER NOT NULL DEFAULT 180 CHECK (stale_warn_days > 0),
  stale_hard_days     INTEGER NOT NULL DEFAULT 365 CHECK (stale_hard_days > 0),
  gp_overridable      INTEGER NOT NULL DEFAULT 1 CHECK (gp_overridable IN (0,1)),
  badge_required      INTEGER NOT NULL DEFAULT 1 CHECK (badge_required IN (0,1)),
  updated_at          TEXT    NOT NULL
                        CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by          TEXT,
  CHECK (stale_hard_days >= stale_warn_days)
) STRICT;

INSERT OR IGNORE INTO valuation_mark_policy
  (id, auto_derive, stale_warn_days, stale_hard_days, gp_overridable, badge_required, updated_at, updated_by)
VALUES ('singleton', 1, 180, 365, 1, 1, '2026-08-10T00:00:00Z', 'system:wave5_q5_seed');
