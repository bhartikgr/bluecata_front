-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 161 · BATCH 3 · ITEM A (A-6) — A MONEY FLOOR UNDER `spv_subscription`.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY A DATABASE-LEVEL RULE AND NOT ONLY THE STORE ASSERTION.
-- `server/spvEngineStore.ts:_persistSub` is the single INSERT…ON CONFLICT
-- chokepoint for every subscription write in the engine, and Wave 161 added an
-- assertion there that refuses an amount which is not a non-negative safe
-- integer. That assertion is correct and it is where a bad value should be
-- refused — but it only binds writers who go through that function. This table
-- is NOT declared STRICT (see `server/db/connection.ts`, `spv_subscription`), so
-- SQLite will happily store the TEXT `"1000"`, the REAL `12.5` or `-1` in
-- `commitment_minor` for any writer that reaches the table another way. Every
-- aggregate Wave 161 fenced reads these two columns; a fence over unreadable
-- values is decoration, and a JSON string in a money column becomes NaN the
-- moment arithmetic touches it.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO.
-- Two triggers (INSERT and UPDATE) that ABORT when `commitment_minor` or
-- `wired_minor` is not an INTEGER, or is negative. Nothing is rewritten, rounded
-- or coerced: a bad write FAILS, it is not quietly repaired, because a repaired
-- money value is a wrong number that looks right.
--
-- NULL IS ALLOWED THROUGH. The columns are nullable in the live schema and a
-- NULL means "no amount on record" — which the reporting layer states as such
-- and never counts as zero. Refusing NULL here would be a schema change dressed
-- as a validation, and it would break writers this wave has not audited.
--
-- NO BACKFILL, NO REPAIR STATEMENT. `spv_subscription` has 0 rows on every
-- database available to this wave, so there is nothing to repair, and inventing
-- an UPDATE that "fixes" values nobody has seen would be a guess written into
-- production. If a legacy row with a bad money type is ever found, it must be
-- looked at by a person, not corrected by a migration.
--
-- IDEMPOTENT. `CREATE TRIGGER IF NOT EXISTS`, so re-running the migration is a
-- no-op and does not depend on migration-ledger state.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS trg_spv_subscription_money_floor_insert
BEFORE INSERT ON spv_subscription
FOR EACH ROW
WHEN (NEW.commitment_minor IS NOT NULL
        AND (typeof(NEW.commitment_minor) <> 'integer' OR NEW.commitment_minor < 0))
     OR (NEW.wired_minor IS NOT NULL
        AND (typeof(NEW.wired_minor) <> 'integer' OR NEW.wired_minor < 0))
BEGIN
  SELECT RAISE(ABORT, 'SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR: commitment_minor and wired_minor must be non-negative integer minor units');
END;

CREATE TRIGGER IF NOT EXISTS trg_spv_subscription_money_floor_update
BEFORE UPDATE OF commitment_minor, wired_minor ON spv_subscription
FOR EACH ROW
WHEN (NEW.commitment_minor IS NOT NULL
        AND (typeof(NEW.commitment_minor) <> 'integer' OR NEW.commitment_minor < 0))
     OR (NEW.wired_minor IS NOT NULL
        AND (typeof(NEW.wired_minor) <> 'integer' OR NEW.wired_minor < 0))
BEGIN
  SELECT RAISE(ABORT, 'SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR: commitment_minor and wired_minor must be non-negative integer minor units');
END;
