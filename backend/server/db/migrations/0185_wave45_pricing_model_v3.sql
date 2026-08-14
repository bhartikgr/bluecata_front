-- 0185_wave45_pricing_model_v3.sql
--
-- WAVE 45 — PRICING MODEL v3. Owner ruling R3 (2026-08-13).
--
-- WHAT R3 CHANGES
--   * The partner admin fee becomes a FLAT $240.00 USD / YEAR for every tier.
--   * The five tiers stop being price levels and become CAPABILITY levels
--     (seats, live-SPV limits, commission rate, features).
--   * Monthly purchase is RETIRED, NOT DELETED — reverting to tiered and/or
--     monthly pricing must be a CONFIGURATION CHANGE, not a rewrite. Every
--     monthly row and every monthly code path therefore survives this
--     migration; only a config flag makes them non-purchasable.
--   * Tiers may be ARCHIVED or FROZEN. They are NEVER DELETED.
--
-- TAXONOMY — WHY THESE FIVE SLUGS AND NOT THE OTHER EIGHT
--   Two tier taxonomies exist in production and share NO slug (proved by set
--   intersection in build_log/wave45/diag_taxonomy.ts):
--     A. platform_fees 'consortium.subscription.<tier>' — catalyst, builder,
--        amplifier, nexus, founding_member. All five priced. Enforced by the
--        CHECK on partner_tier_current.tier (migration 0161). The only set
--        partner_commission_rate_config keys off. Every live partner is on it.
--     B. partner_tier_price rows from 0153 — accelerator, boutique, enterprise,
--        founder_free, growth, professional, starter, syndicate. 14 of 16
--        deliberately UNPRICED; no charge path can present any of them.
--   Taxonomy A is authoritative for tier IDENTITY. This migration prices the
--   five authoritative slugs and DOES NOT TOUCH, RENAME, MAP, MERGE OR DELETE
--   any of taxonomy B's sixteen rows — their disposition is an open owner
--   question (OQ-W45-1) and guessing a mapping would corrupt billing.
--
-- MONEY
--   Integer minor units only. $240.00 USD -> 24000. No division or
--   multiplication by 100 appears in this file or in the code that reads it.
--
-- PERCENT (R16)
--   Percent is stored AS WRITTEN: 1 means 1%, 100 means 100%. The pre-existing
--   partner_commission_rate_config table stores FRACTIONS (0.02 = 2%) as a
--   documented internal representation that R16 exempts; this migration does
--   NOT convert it and does NOT copy that convention. Capability commission
--   values below are percent-as-written and are labelled as such.

-- ---------------------------------------------------------------------------
-- 1. TIER LIFECYCLE — THREE STATES, NOT A BOOLEAN
-- ---------------------------------------------------------------------------
-- Before this wave the only lifecycle signal was `partner_tier_price.active`,
-- a boolean, so "no longer sold" and "retired from the catalogue" were the
-- same fact and neither prevented an edit. Three states, explicit:
--
--   active   — purchasable, editable, visible in the front end.
--   frozen   — visible and historically resolvable, NOT purchasable, and its
--              PRICE CANNOT BE EDITED. Enforced by a database trigger below,
--              so no write path can bypass it by forgetting to check a flag.
--   archived — removed from every front-end catalogue, still fully resolvable
--              for historical invoices (name and price both).
--
-- A tier is NEVER deleted. The DELETE trigger below refuses with an
-- explanation rather than silently ignoring the attempt.
CREATE TABLE IF NOT EXISTS partner_tier_lifecycle (
  tier_slug       TEXT    PRIMARY KEY NOT NULL
                    CHECK (tier_slug IN ('catalyst','builder','amplifier','nexus','founding_member')),
  state           TEXT    NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active','frozen','archived')),
  -- Human-readable display name, so an ARCHIVED tier still resolves a name on
  -- a historical invoice without the front end having to know the slug.
  display_name    TEXT    NOT NULL,
  -- Why this tier is in this state. Required for anything but 'active' so a
  -- freeze or archive is never an unexplained flag.
  state_reason    TEXT,
  state_changed_at TEXT   NOT NULL
                    CHECK (state_changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  state_changed_by TEXT,
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (state = 'active' OR (state_reason IS NOT NULL AND length(trim(state_reason)) > 0))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ptl_state ON partner_tier_lifecycle(state);

-- The five authoritative tiers, all active. Display names match the live
-- admin console ladder.
INSERT OR IGNORE INTO partner_tier_lifecycle
  (tier_slug, state, display_name, state_reason, state_changed_at, created_at, updated_at)
VALUES
  ('catalyst',        'active', 'Catalyst',        NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('builder',         'active', 'Builder',         NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('amplifier',       'active', 'Amplifier',       NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('nexus',           'active', 'Nexus',           NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z'),
  ('founding_member', 'active', 'Founding Member', NULL, '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z', '2026-08-14T00:00:00Z');

-- FREEZE GENUINELY PREVENTS A PRICE EDIT.
-- A flag that the write path is trusted to consult is not a control; 25+
-- "checks that passed while checking nothing" exist in this build's history.
-- These triggers live in the database, below every store, route and script, so
-- a price UPDATE on a frozen or archived tier fails no matter who issues it.
DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_update;
CREATE TRIGGER trg_ptp_frozen_no_price_update
BEFORE UPDATE OF price_minor, currency, derivation, cadence, tier_slug ON partner_tier_price
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM partner_tier_lifecycle l
   WHERE l.tier_slug = OLD.tier_slug AND l.state IN ('frozen','archived')
)
BEGIN
  SELECT RAISE(ABORT, 'TIER_FROZEN_PRICE_IMMUTABLE: this tier is frozen or archived; its price cannot be edited. Return it to active state first.');
END;

DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_insert;
CREATE TRIGGER trg_ptp_frozen_no_price_insert
BEFORE INSERT ON partner_tier_price
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM partner_tier_lifecycle l
   WHERE l.tier_slug = NEW.tier_slug AND l.state IN ('frozen','archived')
)
BEGIN
  SELECT RAISE(ABORT, 'TIER_FROZEN_PRICE_IMMUTABLE: this tier is frozen or archived; a new price row cannot be inserted for it. Return it to active state first.');
END;

-- DELETING A TIER IS REFUSED, WITH AN EXPLANATION.
DROP TRIGGER IF EXISTS trg_ptl_no_delete;
CREATE TRIGGER trg_ptl_no_delete
BEFORE DELETE ON partner_tier_lifecycle
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'TIER_DELETE_REFUSED: tiers are never deleted because historical invoices, subscriptions and commission rates resolve through them. Archive the tier instead — archiving hides it from the front end while keeping historical resolution intact.');
END;

-- ---------------------------------------------------------------------------
-- 2. CAPABILITY AS DATA — the five tiers become capability levels
-- ---------------------------------------------------------------------------
-- Before this wave the ONLY capability that existed was TIER_SEAT_LIMITS, a
-- compiled-in literal in server/adminContactsStore.ts, in which "unlimited"
-- was the magic number 9999 — so a nexus partner was really capped at 9999,
-- "not configured" was inexpressible, and no admin could change any of it.
--
-- THE THREE-WAY DISTINCTION IS STRUCTURAL, NOT INFERRED FROM NULL.
-- Getting unlimited/zero/unset backwards locks partners out of their own
-- accounts, so the distinction is carried by an explicit `resolution` column
-- and enforced by CHECK constraints rather than by convention:
--
--   resolution = 'configured'     -> the value columns hold a real limit.
--                                    int_value = 0 MEANS ZERO. Not unlimited,
--                                    not missing. Zero.
--   resolution = 'unlimited'      -> no numeric ceiling. Value columns are
--                                    NULL because a number would be a lie.
--   resolution = 'not_configured' -> nobody has decided yet. Under R6 this is
--                                    reported as "Not configured" and NEVER
--                                    silently rendered as 0.
--
-- The CHECKs below make it impossible to store a 'configured' row with no
-- value, or an 'unlimited'/'not_configured' row that smuggles one in.
CREATE TABLE IF NOT EXISTS partner_tier_capability (
  id              TEXT    PRIMARY KEY NOT NULL,
  tier_slug       TEXT    NOT NULL
                    CHECK (tier_slug IN ('catalyst','builder','amplifier','nexus','founding_member')),
  capability_key  TEXT    NOT NULL,
  -- What kind of thing the value is, so a reader never has to guess which
  -- column to look in.
  value_kind      TEXT    NOT NULL
                    CHECK (value_kind IN ('int_limit','bool_flag','percent_as_written')),
  resolution      TEXT    NOT NULL
                    CHECK (resolution IN ('configured','unlimited','not_configured')),
  int_value       INTEGER CHECK (int_value IS NULL OR int_value >= 0),
  bool_value      INTEGER CHECK (bool_value IS NULL OR bool_value IN (0,1)),
  -- R16: percent AS WRITTEN. 5 means 5%. This is NOT the fraction convention
  -- used by the pre-existing partner_commission_rate_config table, which R16
  -- exempts and which this wave does not touch.
  percent_value   REAL    CHECK (percent_value IS NULL OR (percent_value >= 0 AND percent_value <= 100)),
  -- Human label + note for the admin surface.
  label           TEXT    NOT NULL,
  notes           TEXT,
  editable        INTEGER NOT NULL DEFAULT 1 CHECK (editable IN (0,1)),
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by      TEXT,
  UNIQUE (tier_slug, capability_key),
  -- 'configured' MUST carry exactly the value column its kind names.
  CHECK (resolution <> 'configured' OR (
        (value_kind = 'int_limit'          AND int_value     IS NOT NULL AND bool_value IS NULL AND percent_value IS NULL)
     OR (value_kind = 'bool_flag'          AND bool_value    IS NOT NULL AND int_value  IS NULL AND percent_value IS NULL)
     OR (value_kind = 'percent_as_written' AND percent_value IS NOT NULL AND int_value  IS NULL AND bool_value    IS NULL)
  )),
  -- 'unlimited' and 'not_configured' MUST NOT carry a value at all, so no
  -- reader can accidentally treat a leftover number as a real ceiling.
  CHECK (resolution = 'configured' OR (int_value IS NULL AND bool_value IS NULL AND percent_value IS NULL)),
  -- 'unlimited' is only meaningful for a numeric ceiling.
  CHECK (resolution <> 'unlimited' OR value_kind = 'int_limit')
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ptc_lookup ON partner_tier_capability(tier_slug, capability_key);
CREATE INDEX IF NOT EXISTS idx_ptc_key ON partner_tier_capability(capability_key);

-- SEAT LIMITS — migrated from the TIER_SEAT_LIMITS literal.
-- catalyst/builder/amplifier keep their exact previous numbers (2/10/25), so
-- no live partner's effective seat cap changes on the day this ships.
-- nexus and founding_member carried the sentinel 9999, whose documented intent
-- was "unlimited"; they become resolution='unlimited', which is strictly MORE
-- permissive than 9999 and therefore cannot lock anyone out. That widening is
-- deliberate and is recorded in the notes column on the row itself.
INSERT OR IGNORE INTO partner_tier_capability
  (id, tier_slug, capability_key, value_kind, resolution, int_value, label, notes, created_at, updated_at, updated_by)
VALUES
  ('ptc_seat_catalyst',   'catalyst',        'seat_limit', 'int_limit', 'configured', 2,    'Team seat limit', 'Migrated from TIER_SEAT_LIMITS literal (was 2).',  '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_seat_builder',    'builder',         'seat_limit', 'int_limit', 'configured', 10,   'Team seat limit', 'Migrated from TIER_SEAT_LIMITS literal (was 10).', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_seat_amplifier',  'amplifier',       'seat_limit', 'int_limit', 'configured', 25,   'Team seat limit', 'Migrated from TIER_SEAT_LIMITS literal (was 25).', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_seat_nexus',      'nexus',           'seat_limit', 'int_limit', 'unlimited',  NULL, 'Team seat limit', 'TIER_SEAT_LIMITS carried the sentinel 9999, meaning unlimited. Now genuinely unlimited.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_seat_founding',   'founding_member', 'seat_limit', 'int_limit', 'unlimited',  NULL, 'Team seat limit', 'TIER_SEAT_LIMITS carried the sentinel 9999, meaning unlimited. Now genuinely unlimited.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185');

-- LIVE SPV LIMIT — new under R3 (tier governs live-SPV count).
-- No prior value existed anywhere, in code or data. Under R6 an unknown is NOT
-- written as 0 — a 0 here would forbid every partner from deploying any SPV at
-- all. They are seeded 'not_configured' so the surface says "Not configured"
-- and an admin sets the real ceilings.
INSERT OR IGNORE INTO partner_tier_capability
  (id, tier_slug, capability_key, value_kind, resolution, label, notes, created_at, updated_at, updated_by)
VALUES
  ('ptc_spv_catalyst',  'catalyst',        'live_spv_limit', 'int_limit', 'not_configured', 'Live SPV limit', 'R6: no prior value existed. Deliberately NOT seeded to 0, which would block all deployments.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_spv_builder',   'builder',         'live_spv_limit', 'int_limit', 'not_configured', 'Live SPV limit', 'R6: no prior value existed. Deliberately NOT seeded to 0, which would block all deployments.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_spv_amplifier', 'amplifier',       'live_spv_limit', 'int_limit', 'not_configured', 'Live SPV limit', 'R6: no prior value existed. Deliberately NOT seeded to 0, which would block all deployments.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_spv_nexus',     'nexus',           'live_spv_limit', 'int_limit', 'not_configured', 'Live SPV limit', 'R6: no prior value existed. Deliberately NOT seeded to 0, which would block all deployments.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptc_spv_founding',  'founding_member', 'live_spv_limit', 'int_limit', 'not_configured', 'Live SPV limit', 'R6: no prior value existed. Deliberately NOT seeded to 0, which would block all deployments.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185');

-- ---------------------------------------------------------------------------
-- 3. THE FLAT $240.00 / YEAR PRICE — on the AUTHORITATIVE five slugs
-- ---------------------------------------------------------------------------
-- 24000 minor units = $240.00 USD. derivation='admin_set' because the owner
-- set this number directly; it is NOT derived from any monthly figure and must
-- never be recorded as 'derived_x12'.
--
-- Note founding_member is priced $240 like every other tier: under R3 every
-- partner pays the same admin fee and tier no longer governs price. The five
-- founding partners are made free through a per-partner $0 fee override with a
-- written reason, NOT by pricing a tier at zero and not by a code branch — a
-- free TIER would make every future occupant of that tier free by accident.
INSERT INTO partner_tier_price
  (id, tier_slug, cadence, price_minor, currency, derivation, active, effective_from, notes, created_at, updated_at, updated_by)
VALUES
  ('ptp_w45_catalyst_annual', 'catalyst',        'annual', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 flat annual partner admin fee, $240.00. Set directly by the owner, not derived from a monthly price.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_builder_annual',  'builder',         'annual', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 flat annual partner admin fee, $240.00. Set directly by the owner, not derived from a monthly price.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_amplifier_annual','amplifier',       'annual', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 flat annual partner admin fee, $240.00. Set directly by the owner, not derived from a monthly price.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_nexus_annual',    'nexus',           'annual', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 flat annual partner admin fee, $240.00. Set directly by the owner, not derived from a monthly price.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_founding_annual', 'founding_member', 'annual', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 flat annual partner admin fee, $240.00. Founding partners are made free by a per-partner $0 override with a reason, never by a $0 tier price.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185')
ON CONFLICT (tier_slug, cadence) DO NOTHING;

-- MONTHLY IS RETIRED, NOT DELETED.
-- The monthly rows are created UNPRICED and INACTIVE for the five authoritative
-- slugs. They exist so that reverting to monthly (or to tiered) pricing is a
-- configuration change — an admin prices a row and flips the config flag in
-- §4 — rather than a schema change or a code change. price_minor stays NULL
-- (R6: unpriced is not zero; a 0 here would advertise a free monthly plan).
INSERT INTO partner_tier_price
  (id, tier_slug, cadence, price_minor, currency, derivation, active, effective_from, notes, created_at, updated_at, updated_by)
VALUES
  ('ptp_w45_catalyst_monthly', 'catalyst',        'monthly', NULL, 'USD', 'unpriced', 0, NULL, 'R3 retired monthly cadence. Row retained UNPRICED and INACTIVE so a revert to monthly pricing is configuration, not a rewrite.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_builder_monthly',  'builder',         'monthly', NULL, 'USD', 'unpriced', 0, NULL, 'R3 retired monthly cadence. Row retained UNPRICED and INACTIVE so a revert to monthly pricing is configuration, not a rewrite.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_amplifier_monthly','amplifier',       'monthly', NULL, 'USD', 'unpriced', 0, NULL, 'R3 retired monthly cadence. Row retained UNPRICED and INACTIVE so a revert to monthly pricing is configuration, not a rewrite.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_nexus_monthly',    'nexus',           'monthly', NULL, 'USD', 'unpriced', 0, NULL, 'R3 retired monthly cadence. Row retained UNPRICED and INACTIVE so a revert to monthly pricing is configuration, not a rewrite.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_founding_monthly', 'founding_member', 'monthly', NULL, 'USD', 'unpriced', 0, NULL, 'R3 retired monthly cadence. Row retained UNPRICED and INACTIVE so a revert to monthly pricing is configuration, not a rewrite.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185')
ON CONFLICT (tier_slug, cadence) DO NOTHING;

-- THE ONE-TIME $240.00 SPV FEE, as a priced row on the authoritative store.
-- cadence='one_time' already exists in partner_tier_price's CHECK. This is the
-- SINGLE source of the SPV fee amount for the flat model. It is not a second
-- source: §5 below records that the pre-existing platform_fees key
-- 'consortium.spv_deployment_fee' is the amount an admin edits, and the code
-- shipped with this wave reads THAT key for the charge, with this row carrying
-- the same number for tier-scoped overrides. See the report for the full
-- accounting of why two rows exist and which one wins.
INSERT INTO partner_tier_price
  (id, tier_slug, cadence, price_minor, currency, derivation, active, effective_from, notes, created_at, updated_at, updated_by)
VALUES
  ('ptp_w45_spv_one_time_catalyst', 'catalyst',        'one_time', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 one-time SPV fee, $240.00, charged on FIRST PUSH TO LIVE only. Drafts are free.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_spv_one_time_builder',  'builder',         'one_time', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 one-time SPV fee, $240.00, charged on FIRST PUSH TO LIVE only. Drafts are free.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_spv_one_time_amplifier','amplifier',       'one_time', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 one-time SPV fee, $240.00, charged on FIRST PUSH TO LIVE only. Drafts are free.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_spv_one_time_nexus',    'nexus',           'one_time', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 one-time SPV fee, $240.00, charged on FIRST PUSH TO LIVE only. Drafts are free.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185'),
  ('ptp_w45_spv_one_time_founding', 'founding_member', 'one_time', 24000, 'USD', 'admin_set', 1, '2026-08-14T00:00:00Z', 'R3 one-time SPV fee, $240.00, charged on FIRST PUSH TO LIVE only. Drafts are free.', '2026-08-14T00:00:00Z','2026-08-14T00:00:00Z','migration_0185')
ON CONFLICT (tier_slug, cadence) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. PRICING MODEL CONFIG — reverting to tiered pricing is CONFIGURATION
-- ---------------------------------------------------------------------------
-- The owner may revert to tiered pricing later and said that "must be a
-- configuration change, not a rewrite". This single-row table is that
-- configuration. Nothing about the monthly or per-tier code path is deleted;
-- these flags decide whether it is offered.
CREATE TABLE IF NOT EXISTS partner_pricing_model_config (
  id                    TEXT    PRIMARY KEY NOT NULL CHECK (id = 'singleton'),
  -- 'flat_annual' = R3. 'tiered' = the pre-R3 ladder, reachable by flipping
  -- this one value back; every tiered price row still exists to support it.
  model                 TEXT    NOT NULL DEFAULT 'flat_annual'
                          CHECK (model IN ('flat_annual','tiered')),
  -- Annual-only under R3. Setting this to 1 re-opens monthly purchase without
  -- any code change.
  monthly_purchasable   INTEGER NOT NULL DEFAULT 0 CHECK (monthly_purchasable IN (0,1)),
  annual_purchasable    INTEGER NOT NULL DEFAULT 1 CHECK (annual_purchasable IN (0,1)),
  -- When 1, an annual price that has no admin_set row MUST NOT be synthesised
  -- by multiplying a monthly price by 12. R3's price is set directly, so a x12
  -- derivation would be a fabricated number.
  forbid_x12_derivation INTEGER NOT NULL DEFAULT 1 CHECK (forbid_x12_derivation IN (0,1)),
  ruling_ref            TEXT,
  notes                 TEXT,
  updated_at            TEXT    NOT NULL
                          CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by            TEXT
) STRICT;

INSERT OR IGNORE INTO partner_pricing_model_config
  (id, model, monthly_purchasable, annual_purchasable, forbid_x12_derivation, ruling_ref, notes, updated_at, updated_by)
VALUES
  ('singleton', 'flat_annual', 0, 1, 1, 'R3 2026-08-13',
   'Flat $240.00/yr for every tier; tier governs capability, not price. Monthly retired, not deleted: set monthly_purchasable=1 to re-open it. Set model=''tiered'' to return to the per-tier ladder.',
   '2026-08-14T00:00:00Z', 'migration_0185');

-- ---------------------------------------------------------------------------
-- 5. GRANDFATHERING LEDGER — who is free, and WHY, as auditable data
-- ---------------------------------------------------------------------------
-- The $0 itself is expressed the way partnerEffectivePlan.ts already documents
-- as the ONLY way an effective price becomes zero: an explicit $0 override in
-- contacts.fee_override_json. That mechanism is reused unchanged.
--
-- This table does not price anything. It records the REASON and the AUTHORITY
-- for each grandfather grant so the $0 is never an unexplained override, and
-- so the grant can be revoked and audited.
--
-- NO PARTNER ID IS SEEDED HERE. The live roster has twelve partners, most of
-- them evidently test accounts, and which five are the owner's founding
-- partners is an open question. A migration that picked partners would be
-- exactly the hardcoded list the ruling forbids. Applying a grant is a
-- deliberate, data-driven admin action.
CREATE TABLE IF NOT EXISTS partner_grandfather_grant (
  id              TEXT    PRIMARY KEY NOT NULL,
  partner_id      TEXT    NOT NULL,
  -- Written reason. Required and non-empty: an unexplained free partner is
  -- indistinguishable from a billing bug.
  reason          TEXT    NOT NULL CHECK (length(trim(reason)) > 0),
  ruling_ref      TEXT    NOT NULL CHECK (length(trim(ruling_ref)) > 0),
  granted_at      TEXT    NOT NULL
                    CHECK (granted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  granted_by      TEXT    NOT NULL,
  -- Permanent per R3, but revocation must be possible and auditable rather
  -- than requiring a DELETE.
  revoked_at      TEXT,
  revoked_by      TEXT,
  revoke_reason   TEXT,
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (revoked_at IS NULL OR (revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pgg_partner_live
  ON partner_grandfather_grant(partner_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 6. CP-SUB-19 IS ANSWERED BY R3
-- ---------------------------------------------------------------------------
-- 0153 recorded the annual pricing model as an OPEN owner decision, listing
-- (a) per-tier admin-set absolute amount, (b) monthly x12 less a discount,
-- (c) monthly x12 exactly. R3 chooses (a): a directly-set $240.00 annual fee.
-- The record is closed here with the ruling cited, rather than left open with
-- the answer only in a report.
-- The column is `ruling_status` and its CHECK admits only
-- ('owner_closed','superseded','open'), so the closed state is 'owner_closed'.
-- There is no separate resolution column; the resolution is appended to the
-- existing notes so the original open question stays readable next to its
-- answer rather than being overwritten.
UPDATE percent_policy_record
   SET ruling_status = 'owner_closed',
       display_rule  = 'Annual price is a directly admin_set absolute amount in minor units. Never derived from monthly.',
       notes = notes || ' || RESOLVED BY R3 (2026-08-13), WAVE 45: option (a). The annual partner admin fee is a directly admin_set absolute amount of $240.00 USD (24000 minor units), flat across all five authoritative tiers. It is NOT derived from any monthly price; the x12 derivation is forbidden by partner_pricing_model_config.forbid_x12_derivation = 1 and is retained only as a labelled, non-default fallback.',
       decided_at = '2026-08-14T00:00:00Z',
       decided_by = 'owner:R3_2026_08_13'
 WHERE id = 'ppr_annual_pricing_model'
   AND ruling_status = 'open';
