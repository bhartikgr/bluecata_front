-- 0201_wave153_f_application_fee_two_sources_repair.sql
-- WAVE 153 · BATCH 2 · ITEM F · F-C5. Forward-only (R103).
--
-- R115.2 #5 (a failure that is swallowed serves a stale price indefinitely),
-- R95 / R104 (never state a price that is not on record), R107.1 / R108.2
-- (DEFAULT_APPLICATION_FEE_MINOR is a reference figure, not a fallback).
--
-- ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
--
-- The Collective application fee is held in TWO tables:
--
--   · collective_application_fee_config (id='default')  — AUTHORITATIVE for
--     founders. server/lib/collectiveApplicationFeeResolver.ts:getApplicationFeeMinor
--     reads this row and NOTHING else, so this is the figure a founder is quoted
--     and charged.
--   · platform_fees, key='collective_application_fee'   — what the admin
--     Platform Fees console lists and what an administrator edits.
--
-- Until wave 153 the two writer routes could not keep those rows equal:
--   · PUT /api/admin/platform-fees/:key mirrored into the config table inside a
--     try/catch that logged "(non-fatal)" and answered 200, so a failed mirror
--     left the console showing the new price and founders paying the old one for
--     as long as nobody read the log.
--   · PUT /api/admin/collective/application-fee never wrote platform_fees at
--     all, producing the same divergence in the other direction, and invalidated
--     no pricing cache.
-- Both are closed in application code this wave (server/lib/applicationFeeMirror.ts
-- owns ONE transaction that writes both rows and RE-READS them before commit).
-- This migration exists only to repair a divergence that a PREVIOUS release may
-- already have written into a live database.
--
-- ── WHAT THIS MIGRATION HONESTLY CANNOT DO ───────────────────────────────────
--
-- SQLite CANNOT express a cross-table equality constraint: a CHECK constraint may
-- only reference columns of its own row, and there is no assertion mechanism. So
-- there is NO database-level guarantee that these two rows stay equal, and this
-- file must not be read as providing one. The invariant is enforced by:
--   · server/lib/applicationFeeMirror.ts  (one transaction, read-back verified,
--     fatal on mismatch — the change simply does not happen), and
--   · server/__tests__/wave153_application_fee_single_source.test.ts (the named
--     tests that fail if either route stops writing both rows).
-- A trigger pair was considered and rejected: triggers would write money silently
-- behind the application, which is the opposite of the "one visible writer" rule
-- this item is about, and a trigger cannot report a plain-sentence refusal to the
-- administrator who typed the number.
--
-- ── THE REPAIR, AND ITS GUARDS ───────────────────────────────────────────────
--
-- WHEN the two rows both exist and their amounts DISAGREE, platform_fees is moved
-- to the CONFIG value. Direction is deliberate and is the conservative one:
-- the config row is what founders were actually quoted and charged, so copying it
-- into the register corrects a DISPLAY that was wrong, and never silently changes
-- what anyone is charged. The reverse direction could raise a live price without
-- an administrator asking for it.
--
-- WHEN either row is ABSENT, this migration does NOTHING. An absence is a state
-- (source='missing'), not a disagreement, and creating a row would put a price on
-- record that nobody set — precisely the R95 shape. The admin console already
-- reports absence honestly (wave 144 · item 2).
--
-- WHEN the amounts already agree — the state observed on the current database,
-- where both hold 30000 — this migration changes NOTHING. It is therefore safe to
-- re-run, and running it twice is a no-op.
--
-- PROVENANCE IS NOT REWRITTEN. On the observed database
-- platform_fees.updated_by_user_id='system:seed' while
-- collective_application_fee_config.updated_by IS NULL. Those strings record WHO
-- last wrote each row and are used by other guards (migration 0198 keys its
-- decontamination guard on updated_by being NULL/''), so this migration does not
-- overwrite them for rows it leaves otherwise untouched. Only a row whose AMOUNT
-- this migration actually corrects is re-stamped, so the correction is
-- attributable.

-- 1) AMOUNT REPAIR — only when both rows exist and the amounts differ.
UPDATE platform_fees
   SET amount_minor = (
         SELECT c.amount_minor
           FROM collective_application_fee_config c
          WHERE c.id = 'default'
       ),
       updated_at = '2026-08-26T00:00:00.000Z',
       updated_by_user_id = 'migration_0201:wave153_f_two_source_repair'
 WHERE key = 'collective_application_fee'
   AND deleted_at IS NULL
   AND EXISTS (
         SELECT 1 FROM collective_application_fee_config c
          WHERE c.id = 'default'
            AND c.amount_minor IS NOT NULL
            AND typeof(c.amount_minor) = 'integer'
            AND c.amount_minor >= 0
       )
   AND amount_minor IS NOT NULL
   AND amount_minor <> (
         SELECT c.amount_minor
           FROM collective_application_fee_config c
          WHERE c.id = 'default'
       );

-- 2) CURRENCY REPAIR — same guards, same direction. A fee of "30000" means two
--    different prices in USD and JPY, so a currency disagreement is a price
--    disagreement even when the number matches.
UPDATE platform_fees
   SET currency = (
         SELECT UPPER(c.currency)
           FROM collective_application_fee_config c
          WHERE c.id = 'default'
       ),
       updated_at = '2026-08-26T00:00:00.000Z',
       updated_by_user_id = 'migration_0201:wave153_f_two_source_repair'
 WHERE key = 'collective_application_fee'
   AND deleted_at IS NULL
   AND EXISTS (
         SELECT 1 FROM collective_application_fee_config c
          WHERE c.id = 'default'
            AND c.currency IS NOT NULL
            AND TRIM(c.currency) <> ''
       )
   AND UPPER(COALESCE(currency, '')) <> (
         SELECT UPPER(c.currency)
           FROM collective_application_fee_config c
          WHERE c.id = 'default'
       );
