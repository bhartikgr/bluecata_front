-- migrations/0198_batch1_collective_application_fee_decontamination.sql
--
-- BATCH 1 · ITEM 2 (DATA HALF ONLY, scope set by R108.3) — R104 / R101 / R103.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
--
-- A live `collective_application_fee_config` row was observed holding
-- amount_minor = 24000 ($240.00). 24000 is the CONSORTIUM PARTNER ANNUAL admin
-- fee seeded by migrations/0185_wave45_pricing_model_v3.sql into
-- `partner_tier_prices` with derivation='admin_set'. Nothing in this tree ever
-- writes 24000 into the Collective config table, so that value reached a
-- Collective surface from ANOTHER PRODUCT — exactly what R104 forbids: a key
-- that may only ever hold the Collective application fee held a partner
-- subscription figure, and a founder was quoted it.
--
-- The canonical Collective application fee is $300.00 = 30000 TRUE MINOR UNITS
-- (R101, pinned by server/lib/collectiveApplicationFeeResolver.ts
-- DEFAULT_APPLICATION_FEE_MINOR and by
-- migrations/0196_wave139_application_fee_seed_correction.sql).
--
-- ── WHY FORWARD-ONLY (R103) ──────────────────────────────────────────────────
--
-- 0185 and 0196 are already recorded in `__drizzle_migrations_applied` on every
-- environment. Editing an applied migration repairs nothing that already ran it
-- and desyncs the byte-identical mirror at server/db/migrations/. The
-- correction therefore ships FORWARD, here.
--
-- ── THE GUARD, WRITTEN AGAINST THE REAL COLUMN STATE ────────────────────────
--
-- Two conditions must BOTH hold, so a price an administrator deliberately set
-- is never clobbered:
--
--   1. VALUE — amount_minor = 24000 and nothing else. 24000 is the imported
--      foreign figure. A row at any other value (45000, 30000, anything) is out
--      of this migration's scope and is left exactly as it is.
--
--   2. PROVENANCE — updated_by IS NULL or ''. `updateApplicationFee()`
--      (server/lib/collectiveApplicationFeeResolver.ts:139) is the ONLY writer
--      of this table in the tree, and it coerces a falsy actor to the literal
--      'admin', so it can never leave NULL or ''. A NULL/'' row is therefore a
--      seed insert (0057 and the connection.ts bootstrap both omit the column)
--      or an out-of-band write — never a deliberate human setting. A row a human
--      set carries their id and SURVIVES THIS MIGRATION UNTOUCHED.
--
-- CORRECTION ADOPTED FROM PREFLIGHT REVIEW 1 (F2.2), RATIFIED BY R108.3.
-- The pre-flight asserted that `updated_by = ''` had been OBSERVED in a real
-- database and called that "decisive". It was not observed. Every database file
-- in this tree carries updated_by = NULL:
--
--   data.db           (30000, 'USD', '2026-08-15 19:25:39', NULL)
--   test.db           (30000, 'USD', '2026-08-02 12:15:11', NULL)
--   verify_after.db   (30000, 'USD', '2026-08-18 04:55:41', NULL)
--
-- So NULL is the shape that actually exists; '' is included only as a defensive
-- widening of the same "no provenance" class, and NO claim of a deliberate
-- asymmetry with 0196 is made here. 0196's guard on `platform_fees` treats ''
-- as HUMAN (reviewH_migration_0196_attack.test.ts ATTACK 4) and that ruling is
-- untouched and still correct for that table, whose writer does not coerce.
-- These two guards differ because the two writers differ. Do not "harmonise"
-- them without re-reading both writers.
--
-- ── NO DATABASE IN THIS TREE HOLDS 24000 ─────────────────────────────────────
--
-- Measured before writing this file: every readable *.db has
-- collective_application_fee_config = (30000, 'USD', <ts>, NULL) and
-- platform_fees['collective_application_fee'] = (30000, 'USD', NULL,
-- 'system:seed'). This migration is therefore a VERIFIED NO-OP locally
-- (changes = 0) and exists to repair the environment where 24000 was observed.
-- That is recorded, not glossed: see build_log/wave142/W142_BUILD.md.
--
-- ── MONEY UNITS ──────────────────────────────────────────────────────────────
--
-- WAVE48/0186 installs BEFORE UPDATE trigger
-- w48_money_typefloor_upd_collective_application_fee_config_amount_minor, which
-- ABORTS unless the new amount_minor is an INTEGER. The literal below is an
-- integer in TRUE MINOR UNITS. There is deliberately no /100, no *100, no float
-- and no CAST anywhere in this file.
--
-- The two writable fee tables are NOT consolidated here and NEITHER is retired:
-- that is the structural half of ITEM 2 and R108.3 DEFERRED it to batch 2.
-- `platform_fees` is not touched by this migration at all.

UPDATE collective_application_fee_config
   SET amount_minor = 30000,
       currency     = 'USD',
       updated_at   = '2026-08-25T00:00:00.000Z',
       updated_by   = 'system:migration:0198_batch1'
 WHERE id = 'default'
   AND amount_minor = 24000
   AND (updated_by IS NULL OR updated_by = '');
