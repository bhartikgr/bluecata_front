-- migrations/0156_wave6_spv_distribution_type.sql
-- WAVE 6 / SC-3 + SC-3b — `distribution_type` on the CANONICAL SINGULAR ledger.
--
-- WHY
--   Two distribution ledgers exist in this tree and only ONE of them records
--   what kind of distribution was made:
--
--     spv_distributions  (PLURAL, legacy, server/db/connection.ts:4434-4444)
--         HAS  distribution_type TEXT NOT NULL DEFAULT 'dividend'
--         plus an index idx_spv_distributions_type on it.
--
--     spv_distribution   (SINGULAR, canonical, server/db/connection.ts:5275-5290)
--         has  event / gross_proceeds_minor / waterfall_json / allocations_json
--         and NO distribution_type column at all.
--
--   That asymmetry is the actual reason the split ledger could not be closed.
--   `client/src/pages/partner/PartnerSpvDetail.tsx` offers the GP a
--   return_of_capital / dividend / exit selector (:90, :325-331) and POSTs it
--   to the PLURAL endpoint, because the SINGULAR canonical table had nowhere to
--   put the answer. The panel was therefore disabled outright in WAVE 2 (SC-2,
--   `DIST_PANEL_DISABLED = true`, PartnerSpvDetail.tsx:51) rather than
--   repointed. SC-3 adds the column; SC-3b backfills and constrains it; SC-5
--   repoints the form and re-enables the panel. Without this migration SC-5
--   would silently lose the GP's tax/accounting classification.
--
-- MIGRATION NUMBER — 0156. Verified against THIS tree on 2026-08-10, not assumed:
--     ls migrations/*.sql server/db/migrations/*.sql
--   highest numbers actually present are 0151 and TWO files numbered 0152
--   (0152_wave8_orp029_engine_spv_deployment_fee.sql and
--    0152_wave9_reporting_audit.sql — a live collision between concurrent
--    waves 8 and 9, flagged in build_log/WAVE6_REPORT.md, NOT renumbered here
--    because those files belong to other agents). 0153 was the first free number at the time this file was written, but WAVE 5
--    claimed 0153_wave5_money_captable.sql three minutes later, so this file was
--    RENUMBERED to 0156 to leave 0153-0155 to the concurrent waves. 0156 is free
--    number after the highest present. Nothing here renumbers or reuses.
--
-- SACRED FILES: `db/migrate.ts`, `server/db/migrate.ts` and
-- `server/db/connection.ts` are NOT touched. This is a new file only, mirrored
-- byte-identically into server/db/migrations/.
--
-- WHY NOT `ALTER TABLE ... ADD COLUMN ... CHECK(...)`
--   SQLite forbids adding a CHECK constraint in ADD COLUMN. The three-statement
--   shape below is the portable, idempotent alternative and is what SC-3b
--   actually asks for:
--     1. ADD COLUMN with a NOT NULL DEFAULT so existing rows are legal instantly.
--     2. BACKFILL from the row's own data (`event`), never from a guess.
--     3. Enforce the domain with a BEFORE INSERT / BEFORE UPDATE trigger pair,
--        which is a real, always-on constraint — not advisory.
--
-- IDEMPOTENCY
--   `ALTER TABLE ADD COLUMN` is NOT idempotent in SQLite and there is no
--   `IF NOT EXISTS` form for it. The runner applies each migration file at most
--   once (recorded in the migrations bookkeeping table), which is the same
--   assumption 0127/0129/0131/0133 already rely on for their ADD COLUMNs — see
--   migrations/0127_wave_c_fd_pre_money_shares.sql. The BACKFILL and the
--   triggers below ARE idempotent on their own.
--
-- DOMAIN
--   ('return_of_capital','dividend','exit','other'). These are exactly the
--   three values the GP-facing selector already offers
--   (PartnerSpvDetail.tsx:90) plus an explicit 'other' escape so an unmapped
--   legacy `event` never has to be silently mislabelled as a dividend. The
--   PLURAL table's default of 'dividend' is deliberately NOT copied: defaulting
--   an unknown distribution to "dividend" is a tax/accounting claim we have no
--   basis for. The canonical default is 'other' — honest, and visible in the UI.

-- 1 ── the column.
ALTER TABLE spv_distribution
  ADD COLUMN distribution_type TEXT NOT NULL DEFAULT 'other';

-- 2 ── SC-3b BACKFILL, derived from each row's OWN `event` value. Never a
--      blanket guess: a row whose event matches nothing keeps 'other'.
UPDATE spv_distribution
   SET distribution_type = 'return_of_capital'
 WHERE distribution_type = 'other'
   AND lower(trim(event)) IN ('return_of_capital','return of capital','roc','capital_return');

UPDATE spv_distribution
   SET distribution_type = 'dividend'
 WHERE distribution_type = 'other'
   AND lower(trim(event)) IN ('dividend','dividends','income','interest');

UPDATE spv_distribution
   SET distribution_type = 'exit'
 WHERE distribution_type = 'other'
   AND lower(trim(event)) IN ('exit','exit_proceeds','sale','acquisition','liquidation','secondary');

-- 3 ── SC-3b CONSTRAINT. A trigger pair, because SQLite cannot add a table
--      CHECK after the fact. These are enforced on every write path — the
--      engine store, any admin script, and a raw sqlite3 shell alike.
CREATE TRIGGER IF NOT EXISTS trg_spv_distribution_type_ins
  BEFORE INSERT ON spv_distribution
  WHEN NEW.distribution_type NOT IN ('return_of_capital','dividend','exit','other')
  BEGIN SELECT RAISE(ABORT, 'SPV_DISTRIBUTION_TYPE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS trg_spv_distribution_type_upd
  BEFORE UPDATE OF distribution_type ON spv_distribution
  WHEN NEW.distribution_type NOT IN ('return_of_capital','dividend','exit','other')
  BEGIN SELECT RAISE(ABORT, 'SPV_DISTRIBUTION_TYPE_INVALID'); END;

-- 4 ── parity with the plural table, which has had this index since 4434-4448.
CREATE INDEX IF NOT EXISTS idx_spv_distribution_type
  ON spv_distribution(spv_id, distribution_type);
