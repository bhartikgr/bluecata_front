-- ===========================================================================
-- 0178 — WAVE 32 · CP-SPV-30 — INSTITUTIONAL-GRADE SPV
--        (NAV · waterfall side letters · K-1 · LP portal)
--
-- WHY THIS EXISTS
-- ---------------
-- `spec/PARTNER_BUILT_VS_PROMISED.md` SPV-30 is ABSENT/P1: the platform
-- promises a fund-admin-grade SPV and ships none of the five artifacts a
-- fund-admin diligence process actually inspects — a NAV with a stated
-- valuation policy, a waterfall that honours negotiated per-LP economics, a
-- K-1, the side letters themselves, and an LP-facing statement.
--
-- WHAT IS DELIBERATELY *NOT* HERE
-- -------------------------------
-- No NAV, no K-1 box and no capital-account figure is stored unless it was
-- COMPUTED FROM REAL ROWS at the moment of freezing. There is no default, no
-- seed and no sample in this migration. A fabricated NAV in front of an
-- investment bank is worse than a blank, so the read paths return an explicit
-- refusal (a status + NULL) rather than a number, and NULL is stored for an
-- unknown amount — never 0. "Unknown" and "zero" are different statements
-- about a fund and the UI renders them differently.
--
-- MONEY
-- -----
-- Every `_minor` column is an INTEGER in MINOR UNITS, and `currency` sits
-- alongside it and is NOT NULL. A minor-unit integer is meaningless without
-- its currency: 5000 is $50.00 in USD and ¥5,000 in JPY (ISO-4217 exponent 0).
-- Nothing here may be summed across currencies and no read model in Wave 32
-- offers a cross-currency total.
--
-- RATES
-- -----
-- Side-letter rates are stored as INTEGER counts of billionths — the fraction
-- multiplied by `CARRY_FRACTION_SCALE` (1e9, `server/lib/money.ts:324`), the
-- same representation migration 0177 adopted. 20% carry is 200000000. This is
-- NOT a percent-as-written number and NOT a float. Wave 5 / P-4 records what
-- the alternative costs: an "8" meant as 8% was read as the fraction 8, and an
-- SPV silently acquired a 100% preferred return. A CHECK refuses anything
-- outside [0, 1e9] at the database, so an out-of-domain rate cannot be
-- persisted even by a writer that bypasses the store.
--
-- LP PRIVACY (WAVE 29 / WAIVER-4)
-- -------------------------------
-- Wave 29 fixed a live exposure in which two passive LPs in the same vehicle
-- could discover each other. An LP portal is exactly where that regresses, so
-- the permission to see a co-investor is modelled EXPLICITLY, as data, in
-- `spv_side_letter.co_investor_visibility`, with the default `inherit`
-- deferring to `spv.lp_visibility` (itself defaulting to `own_only`). There is
-- no code path in Wave 32 that widens visibility without one of those two rows
-- saying so, and neither can be set implicitly.
--
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss, safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. NAV — a FROZEN net asset value for a vehicle as of a date.
--
-- A NAV is only ever written by an explicit freeze; the live NAV is DERIVED on
-- read from `spv_deployment` × the effective valuation mark (Q5: marks
-- auto-derive from the last priced round, are badged, go stale at 180 days,
-- expire at 365 and are GP-overridable — the override taking effect only on
-- approval per migration 0174). Freezing records WHAT WAS TRUE AT THE TIME,
-- including the staleness badge and the count of holdings that could not be
-- marked, so a later reader can see the quality of the number and not merely
-- the number.
--
-- `total_nav_minor` is NULL-ABLE ON PURPOSE. A NAV over a portfolio containing
-- an unmarked holding is not a smaller NAV; it is an unknown one. Such a freeze
-- stores NULL plus `status`, and every renderer shows the refusal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_nav_snapshot (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT NOT NULL,
  spv_id                TEXT NOT NULL,
  as_of_date            TEXT NOT NULL
                          CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- NULL when the NAV could not be computed from real rows. Never 0 for
  -- "unknown".
  total_nav_minor       INTEGER CHECK (total_nav_minor IS NULL OR total_nav_minor >= 0),
  currency              TEXT NOT NULL,
  -- 'complete'          every holding carried an effective mark
  -- 'partial_unmarked'  at least one holding had no mark  -> total is NULL
  -- 'no_holdings'       the SPV has deployed nothing yet  -> total is NULL
  -- 'mixed_currency'    holdings span currencies          -> total is NULL,
  --                     because summing across currencies is not money
  status                TEXT NOT NULL CHECK (status IN
                          ('complete','partial_unmarked','no_holdings','mixed_currency')),
  -- Worst badge across the marked holdings, so a NAV built entirely on marks
  -- older than the expiry threshold cannot present itself as fresh.
  worst_mark_badge      TEXT CHECK (worst_mark_badge IS NULL OR worst_mark_badge IN
                          ('fresh','stale','expired','gp_override')),
  marked_holdings       INTEGER NOT NULL DEFAULT 0,
  unmarked_holdings     INTEGER NOT NULL DEFAULT 0,
  -- The per-holding derivation, retained so the frozen number is auditable
  -- without re-deriving it against rounds that may since have moved.
  holdings_json         TEXT NOT NULL,
  -- The thresholds in force when this NAV was frozen, copied from
  -- `wave9_reporting_config`. A NAV read six months later must be legible
  -- against the policy that produced it, not against today's policy.
  stale_warn_days       INTEGER NOT NULL,
  stale_expired_days    INTEGER NOT NULL,
  frozen_by             TEXT NOT NULL,
  frozen_at             TEXT NOT NULL
                          CHECK (frozen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  superseded_at         TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w32_nav_spv  ON spv_nav_snapshot(spv_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_w32_nav_live ON spv_nav_snapshot(spv_id, superseded_at);

-- ---------------------------------------------------------------------------
-- 2. SIDE LETTERS — per-LP terms that OVERRIDE the fund defaults.
--
-- One ACTIVE letter per (spv, investor); superseding writes a new row and
-- stamps the old one, so the negotiated history survives. Every override
-- column is NULL-ABLE and NULL means "no override — inherit the fund term".
-- That distinction is load-bearing: a side letter carrying carry = 0 is a
-- no-carry LP, while a side letter carrying NULL is an LP on the fund's carry,
-- and collapsing the two would silently rewrite economics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_side_letter (
  id                        TEXT PRIMARY KEY NOT NULL,
  tenant_id                 TEXT NOT NULL,
  spv_id                    TEXT NOT NULL,
  investor_id               TEXT NOT NULL,
  -- Economics. Integer billionths of a fraction; see the RATES note above.
  carry_fraction_scaled     INTEGER CHECK (carry_fraction_scaled IS NULL
                              OR (carry_fraction_scaled >= 0 AND carry_fraction_scaled <= 1000000000)),
  mgmt_fee_fraction_scaled  INTEGER CHECK (mgmt_fee_fraction_scaled IS NULL
                              OR (mgmt_fee_fraction_scaled >= 0 AND mgmt_fee_fraction_scaled <= 1000000000)),
  hurdle_fraction_scaled    INTEGER CHECK (hurdle_fraction_scaled IS NULL
                              OR (hurdle_fraction_scaled >= 0 AND hurdle_fraction_scaled <= 1000000000)),
  -- A negotiated minimum check for this LP, in minor units of `currency`.
  min_check_minor           INTEGER CHECK (min_check_minor IS NULL OR min_check_minor >= 0),
  currency                  TEXT NOT NULL,
  -- LP PRIVACY. 'inherit' defers to spv.lp_visibility. Only an EXPLICIT
  -- 'co_investors' on this row lets this LP see other LPs, and only an
  -- explicit 'own_only' narrows an otherwise-open vehicle for this LP.
  co_investor_visibility    TEXT NOT NULL DEFAULT 'inherit'
                              CHECK (co_investor_visibility IN ('inherit','own_only','co_investors')),
  -- Other negotiated rights that are recorded but not (yet) machine-enforced
  -- are TEXT, and the read model labels them as informational rather than
  -- pretending the engine honours them.
  mfn_clause                INTEGER NOT NULL DEFAULT 0 CHECK (mfn_clause IN (0,1)),
  notes                     TEXT,
  -- Provenance of the executed document, when there is one.
  document_ref              TEXT,
  effective_date            TEXT NOT NULL
                              CHECK (effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','superseded','revoked')),
  created_by                TEXT NOT NULL,
  created_at                TEXT NOT NULL
                              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at                TEXT NOT NULL,
  updated_by                TEXT,
  superseded_at             TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w32_sl_spv      ON spv_side_letter(spv_id, status);
CREATE INDEX IF NOT EXISTS idx_w32_sl_investor ON spv_side_letter(spv_id, investor_id, status);
-- At most ONE active letter per LP per SPV. Enforced by the database, so a
-- concurrent writer cannot create two contradictory sets of economics.
CREATE UNIQUE INDEX IF NOT EXISTS uq_w32_sl_active
  ON spv_side_letter(spv_id, investor_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 3. K-1 — the per-LP, per-tax-year reporting artifact.
--
-- Amounts are minor units and every one of them is NULL-ABLE. A K-1 box the
-- platform cannot compute from real rows is NULL and renders as an explicit
-- "not computable" line; it is never 0, because 0 on a K-1 is an assertion to a
-- tax authority.
--
-- `status` distinguishes a working draft from an issued statement. An `issued`
-- row is IMMUTABLE by store policy (a correction is a NEW row with
-- `supersedes_k1_id` set), which is how fund administrators handle an amended
-- K-1 and is the only shape that leaves an audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_k1_statement (
  id                        TEXT PRIMARY KEY NOT NULL,
  tenant_id                 TEXT NOT NULL,
  spv_id                    TEXT NOT NULL,
  investor_id               TEXT NOT NULL,
  tax_year                  INTEGER NOT NULL CHECK (tax_year >= 1900 AND tax_year <= 2999),
  currency                  TEXT NOT NULL,
  -- Capital account roll-forward (Part II, item L shape).
  beginning_capital_minor   INTEGER,
  contributions_minor       INTEGER,
  distributions_minor       INTEGER,
  -- Allocated share of profit/loss. Signed: a loss is legitimately negative.
  allocated_income_minor    INTEGER,
  -- Carry borne by this LP in the year, from the distribution waterfall.
  carry_allocated_minor     INTEGER,
  ending_capital_minor      INTEGER,
  -- Ownership at year end, as a FRACTION (0.25 == 25%). Never a percent.
  ownership_fraction        REAL CHECK (ownership_fraction IS NULL
                              OR (ownership_fraction >= 0 AND ownership_fraction <= 1)),
  -- Which figures could not be computed, and why. Non-empty whenever any
  -- amount above is NULL, so a blank is always explained.
  refusals_json             TEXT NOT NULL DEFAULT '[]',
  -- The distribution / capital-call ids the figures were derived from.
  sources_json              TEXT NOT NULL DEFAULT '[]',
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','issued','superseded')),
  supersedes_k1_id          TEXT,
  generated_by              TEXT NOT NULL,
  generated_at              TEXT NOT NULL
                              CHECK (generated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  issued_at                 TEXT,
  superseded_at             TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w32_k1_spv      ON spv_k1_statement(spv_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_w32_k1_investor ON spv_k1_statement(investor_id, tax_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_w32_k1_draft
  ON spv_k1_statement(spv_id, investor_id, tax_year) WHERE status = 'draft';
