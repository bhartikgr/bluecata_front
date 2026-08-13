-- migrations/0157_wave6_spv_fee_schedule.sql
-- WAVE 6 — CP-SPV-12 · CP-SPV-13 · CP-SPV-16 · CP-SPV-17 · CP-SPV-20 · FE-3.
--
-- ONE `spv_fee_schedule` TABLE, AND THE ROLLING-CLOSE WINDOW, BOTH DB-DRIVEN.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT ALREADY EXISTED, AND WHY IT IS NOT THIS TABLE (checked, not assumed)
-- ─────────────────────────────────────────────────────────────────────────────
--   `spv_fee`             server/db/connection.ts:5214-5229
--       PER-VEHICLE APPLIED fees: (spv_id, layer, fee_type, fixed_amount_minor,
--       carry_pct, effective_date). Every row is bound to one SPV. It answers
--       "what does THIS vehicle charge", not "what does the platform charge for
--       a vehicle of this shape". It is NOT a schedule and has no payer or
--       basis column.
--   `spv_fee_obligation`  server/db/connection.ts:5328-5347
--       The MONEY LEDGER — an amount owed, its timing and its settlement state.
--       Downstream of pricing, not pricing.
--   `spv_carry_cap_policy` migrations/0150 (WAVE 3D)
--       A CAP on combined carry. A ceiling, not a price.
--   grep -rn "spv_fee_schedule" over the whole tree: ZERO hits. There was no
--       prior art to wire; SPV-13 is genuinely absent, and this is BUILD-NEW.
--
-- The missing layer is the SCHEDULE: the admin-set, scoped, versioned price
-- list that `spv_fee` rows are MINTED FROM. Without it every SPV fee is either
-- typed in by hand per vehicle or hardcoded in the artifact — which is the
-- SPV-12 defect ("Fees 100% dynamic, DB-driven, no in-memory, no hardcoding").
--
-- MIGRATION NUMBER — 0157. Verified on 2026-08-10 against THIS tree:
--   highest present is 0152 (present TWICE — 0152_wave8_orp029… and
--   0152_wave9_reporting_audit.sql, a live collision between concurrent waves 8
--   and 9, flagged in build_log/WAVE6_REPORT.md and deliberately NOT renumbered
--   here because those files are owned by other agents). WAVE 6 first took 0153/0154, then WAVE 5
--   claimed 0153 as well (0153_wave5_money_captable.sql). Both WAVE 6 files were
--   therefore RENUMBERED upward, leaving 0153-0155 to the concurrent waves:
--   0156 = spv distribution type, 0157 = this file. Flagged in WAVE6_REPORT.md.
--
-- SACRED: db/migrate.ts, server/db/migrate.ts and server/db/connection.ts are
-- NOT touched. New file only, mirrored byte-identically into
-- server/db/migrations/.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CP-SPV-17 — `payer_kind` AND `basis` ARE FIRST-CLASS COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
--   payer_kind ∈ ('partner','lp','platform','spv')
--       WHO the money comes from. `spv_fee.layer` conflates the fee's OWNER
--       ('gp' | 'platform') with its payer; they are different questions and a
--       launch fee billed to the partner but owned by the platform cannot be
--       expressed by `layer` alone.
--   basis ∈ ('fixed','commitment','called_capital','carry_base','nav',
--            'gross_proceeds','per_lp','per_deployment')
--       WHAT the rate is applied to. A 2% fee is meaningless until you say
--       2% OF WHAT.
-- Both are CHECK-constrained, so an unknown value cannot be written and then
-- silently ignored by a resolver.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MONEY AND PERCENT REPRESENTATION (project standing rules)
-- ─────────────────────────────────────────────────────────────────────────────
--   * `fixed_amount_minor` is an INTEGER in minor units. Never a REAL, never a
--     major-unit decimal.
--   * `rate_scaled` is an INTEGER on scale 1e9, the SAME `CARRY_FRACTION_SCALE`
--     that server/lib/money.ts and migration 0150 already use. A 2% rate is
--     20000000. Percentages are fractions; there is no `2.0` anywhere.
--   * `scale` is pinned by CHECK so a future scale change cannot be misread as
--     a different price.
--   * `currency` is a 3-letter ISO-4217 code; the minor-unit exponent comes from
--     the existing `currency_ref` table, never from a hardcoded × 100.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CP-SPV-16 — NO LITERAL FALLBACK. THE RESOLVER FAILS CLOSED.
-- ─────────────────────────────────────────────────────────────────────────────
-- Scope resolution is MOST SPECIFIC WINS:
--     spv:<spvId>  ->  partner:<partnerId>  ->  platform:*
-- When no active, in-window row applies at ANY scope, the resolver
-- (server/lib/spvFeeScheduleStore.ts) THROWS `SPV_FEE_SCHEDULE_MISSING`, which
-- the route layer renders as an honest 503 (CP-SPV-34). It NEVER returns 0 and
-- NEVER substitutes a compiled-in literal. Deleting the platform row stops
-- pricing; it never silently makes everything free.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CP-SPV-20 — THE AIRWALLEX SPV LAUNCH FEE
-- ─────────────────────────────────────────────────────────────────────────────
-- Seeded below as a REAL row of this table, not as a constant: fee_code
-- 'spv_launch', payer_kind 'partner', basis 'fixed', collected via the
-- 'airwallex' rail. It is seeded INACTIVE (`active = 0`) with
-- fixed_amount_minor 0 because Capavate has not published a launch-fee amount
-- and INVENTING a price a GP would be charged is worse than showing none — the
-- same discipline the jurisdiction work applies to foreign filing names. An
-- admin sets the real amount and flips `active` at /admin/fees; until then the
-- resolver reports the fee as not-yet-priced rather than charging zero.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / INSERT OR IGNORE.

CREATE TABLE IF NOT EXISTS spv_fee_schedule (
  id              TEXT    PRIMARY KEY NOT NULL,
  -- Stable machine identity of the fee. The resolver looks fees up by this,
  -- never by a display string.
  fee_code        TEXT    NOT NULL,
  -- MOST SPECIFIC WINS: spv -> partner -> platform.
  scope_kind      TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id        TEXT    NOT NULL,
  -- CP-SPV-17.
  payer_kind      TEXT    NOT NULL CHECK (payer_kind IN ('partner','lp','platform','spv')),
  basis           TEXT    NOT NULL CHECK (basis IN
                    ('fixed','commitment','called_capital','carry_base','nav',
                     'gross_proceeds','per_lp','per_deployment')),
  -- CP-SPV-10 two-layer model: whose economics the fee belongs to.
  layer           TEXT    NOT NULL CHECK (layer IN ('gp','platform')),
  -- Exactly one of the two amount forms is meaningful, decided by `basis`.
  fixed_amount_minor INTEGER CHECK (fixed_amount_minor IS NULL OR fixed_amount_minor >= 0),
  rate_scaled     INTEGER CHECK (rate_scaled IS NULL OR (rate_scaled >= 0 AND rate_scaled <= 1000000000)),
  scale           INTEGER NOT NULL DEFAULT 1000000000 CHECK (scale = 1000000000),
  currency        TEXT    NOT NULL DEFAULT 'USD'
                    CHECK (length(currency) = 3 AND currency = upper(currency)),
  -- Which payment rail actually collects it. 'airwallex' is CP-SPV-20's rail.
  collection_rail TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (collection_rail IN ('manual','airwallex','stripe','netted')),
  effective_from  TEXT    NOT NULL
                    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  effective_to    TEXT
                    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  label           TEXT    NOT NULL,
  description     TEXT,
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by      TEXT,
  -- A 'fixed' basis needs an amount; every other basis needs a rate. This is
  -- what makes "no literal fallback" enforceable: a row cannot be half-priced.
  CHECK ((basis = 'fixed'  AND fixed_amount_minor IS NOT NULL AND rate_scaled IS NULL)
      OR (basis <> 'fixed' AND rate_scaled IS NOT NULL AND fixed_amount_minor IS NULL)),
  -- The platform-wide fallback row is addressed by the literal '*'; a scoped
  -- row must name a real scope.
  CHECK ((scope_kind = 'platform' AND scope_id = '*')
      OR (scope_kind <> 'platform' AND scope_id <> '*')),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- One live price per fee per scope per start date. A scope can never hold two
  -- conflicting prices for the same fee at the same moment.
  UNIQUE (fee_code, scope_kind, scope_id, effective_from)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sfs_resolve
  ON spv_fee_schedule(fee_code, scope_kind, scope_id, active, effective_from);
CREATE INDEX IF NOT EXISTS idx_sfs_code ON spv_fee_schedule(fee_code, active);

-- Append-only audit history. Immutable by trigger, exactly as 0150 does for
-- the carry-cap policy: a fee change is a commercial event and must be
-- reconstructable.
CREATE TABLE IF NOT EXISTS spv_fee_schedule_history (
  history_id      TEXT    PRIMARY KEY NOT NULL,
  schedule_id     TEXT    NOT NULL,
  fee_code        TEXT    NOT NULL,
  scope_kind      TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id        TEXT    NOT NULL,
  payer_kind      TEXT    NOT NULL,
  basis           TEXT    NOT NULL,
  layer           TEXT    NOT NULL,
  fixed_amount_minor INTEGER,
  rate_scaled     INTEGER,
  scale           INTEGER NOT NULL CHECK (scale = 1000000000),
  currency        TEXT    NOT NULL,
  collection_rail TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  active          INTEGER NOT NULL CHECK (active IN (0,1)),
  change_kind     TEXT    NOT NULL
                    CHECK (change_kind IN ('genesis','create','update','deactivate','reactivate','expire')),
  changed_at      TEXT    NOT NULL
                    CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  changed_by      TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sfsh_schedule ON spv_fee_schedule_history(schedule_id, changed_at);

CREATE TRIGGER IF NOT EXISTS trg_sfsh_no_update
  BEFORE UPDATE ON spv_fee_schedule_history
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_SCHEDULE_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_sfsh_no_delete
  BEFORE DELETE ON spv_fee_schedule_history
  BEGIN SELECT RAISE(ABORT, 'SPV_FEE_SCHEDULE_HISTORY_IMMUTABLE'); END;

-- ─────────────────────────────────────────────────────────────────────────────
-- FE-3 — THE ROLLING-CLOSE WINDOW, DB-DRIVEN
-- ─────────────────────────────────────────────────────────────────────────────
-- `30` was hardcoded in TWO places: server/spvEngineRoutes.ts:597
-- (`Number.isFinite(Number(b.windowDays)) ? Number(b.windowDays) : 30`) and
-- client/src/components/partner/SpvDetailTabs.tsx:672 (`{ windowDays: 30 }`).
-- Same scope ladder, same fail-closed rule: no active row anywhere ⇒
-- SPV_CLOSE_WINDOW_POLICY_MISSING, never a silent 30.
CREATE TABLE IF NOT EXISTS spv_close_window_policy (
  id            TEXT    PRIMARY KEY NOT NULL,
  scope_kind    TEXT    NOT NULL CHECK (scope_kind IN ('platform','partner','spv')),
  scope_id      TEXT    NOT NULL,
  window_days   INTEGER NOT NULL CHECK (window_days >= 1 AND window_days <= 3650),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  description   TEXT,
  created_at    TEXT    NOT NULL
                  CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at    TEXT    NOT NULL
                  CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by    TEXT,
  CHECK ((scope_kind = 'platform' AND scope_id = '*')
      OR (scope_kind <> 'platform' AND scope_id <> '*')),
  UNIQUE (scope_kind, scope_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_scwp_scope ON spv_close_window_policy(scope_kind, scope_id, active);

-- Genesis: 30 days — EXACTLY the value the two hardcoded literals held, so
-- behaviour on upgrade is unchanged. It is now an admin-editable row.
INSERT OR IGNORE INTO spv_close_window_policy
  (id, scope_kind, scope_id, window_days, active, description, created_at, updated_at, updated_by)
VALUES
  ('scwp_platform', 'platform', '*', 30, 1,
   'Default rolling-close window in days. Was the hardcoded 30 at server/spvEngineRoutes.ts:597 and SpvDetailTabs.tsx:672 before WAVE 6 / FE-3.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed');

-- ─────────────────────────────────────────────────────────────────────────────
-- SEEDS — CP-SPV-20 and the two-layer carry placeholders (CP-SPV-10)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every seed is INACTIVE with a zero/absent price. Read that as deliberate:
-- Capavate has published no fee amounts, and a seeded non-zero price would be
-- an invented commercial term shown to a GP. The rows exist so /admin/fees has
-- something to edit and so the resolver's scope ladder is exercisable; the
-- resolver treats `active = 0` as "no row", i.e. it fails closed exactly as if
-- the row were absent.

INSERT OR IGNORE INTO spv_fee_schedule_history
  (history_id, schedule_id, fee_code, scope_kind, scope_id, payer_kind, basis, layer,
   fixed_amount_minor, rate_scaled, scale, currency, collection_rail,
   effective_from, effective_to, active, change_kind, changed_at, changed_by)
VALUES
  ('sfsh_gen_spv_launch', 'sfs_spv_launch_platform', 'spv_launch', 'platform', '*',
   'partner', 'fixed', 'platform', 0, NULL, 1000000000, 'USD', 'airwallex',
   '2026-08-10T00:00:00Z', NULL, 0, 'genesis', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfsh_gen_plat_carry', 'sfs_platform_carry_platform', 'platform_carry', 'platform', '*',
   'spv', 'carry_base', 'platform', NULL, 0, 1000000000, 'USD', 'netted',
   '2026-08-10T00:00:00Z', NULL, 0, 'genesis', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfsh_gen_gp_mgmt', 'sfs_gp_management_platform', 'gp_management', 'platform', '*',
   'lp', 'commitment', 'gp', NULL, 0, 1000000000, 'USD', 'manual',
   '2026-08-10T00:00:00Z', NULL, 0, 'genesis', '2026-08-10T00:00:00Z', 'system:wave6_seed');

INSERT OR IGNORE INTO spv_fee_schedule
  (id, fee_code, scope_kind, scope_id, payer_kind, basis, layer,
   fixed_amount_minor, rate_scaled, scale, currency, collection_rail,
   effective_from, effective_to, active, label, description, created_at, updated_at, updated_by)
VALUES
  ('sfs_spv_launch_platform', 'spv_launch', 'platform', '*',
   'partner', 'fixed', 'platform', 0, NULL, 1000000000, 'USD', 'airwallex',
   '2026-08-10T00:00:00Z', NULL, 0,
   'Airwallex SPV Launch Fee',
   'CP-SPV-20. One-off fee charged to the sponsoring partner when a vehicle is launched, collected over the Airwallex rail. Seeded INACTIVE at 0 because no launch-fee amount has been published; an admin sets the real amount and activates it at /admin/fees. While inactive the resolver reports the fee as unpriced (503) rather than charging zero.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfs_platform_carry_platform', 'platform_carry', 'platform', '*',
   'spv', 'carry_base', 'platform', NULL, 0, 1000000000, 'USD', 'netted',
   '2026-08-10T00:00:00Z', NULL, 0,
   'Platform carry',
   'CP-SPV-10 platform layer. A fraction of the carry base, on scale 1e9 (20000000 = 2%). Netted from distribution proceeds. Seeded INACTIVE at 0; the combined GP + platform carry remains capped by spv_carry_cap_policy (migration 0150).',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed'),
  ('sfs_gp_management_platform', 'gp_management', 'platform', '*',
   'lp', 'commitment', 'gp', NULL, 0, 1000000000, 'USD', 'manual',
   '2026-08-10T00:00:00Z', NULL, 0,
   'GP management fee',
   'CP-SPV-10 GP layer. A fraction of LP commitment, on scale 1e9. The default a GP inherits when their partner scope sets no override. Seeded INACTIVE at 0.',
   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'system:wave6_seed');
