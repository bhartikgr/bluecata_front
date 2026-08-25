-- migrations/0196_wave139_application_fee_seed_correction.sql
--
-- WAVE 139 — R101 / R102 / R103: THE COLLECTIVE APPLICATION FEE IS $300.00.
--
-- ── THE DEFECT (Review G item 7 / REVIEW_G_FINDINGS.md, verified by the lead) ─
--
-- Three sources disagreed on ONE fee:
--
--   * server/db/connection.ts bootstrap (:1546, :1901, :2384) and the live
--     data.db / test.db  ->  30000 minor  =  $300.00   CANONICAL. It matches
--     server/lib/collectiveApplicationFeeResolver.ts
--     DEFAULT_APPLICATION_FEE_MINOR = 30000.
--   * migrations/0057_v25_38_application_fee_config.sql:30-31 seeds
--     collective_application_fee_config (id='default') amount_minor = 2500
--     ($25.00).
--   * migrations/0066_v25_45_4_platform_fees.sql:31-32 seeds platform_fees
--     key 'collective_application_fee' amount_minor = 250000 ($2,500.00).
--
-- Deploys run `npm run db:migrate` BEFORE the server bootstraps
-- (deploy_v26_10_LIVE.sh:71, install_v26_7_1.sh:102-105) and BOTH seeds are
-- `INSERT OR IGNORE`, so on a NEWLY PROVISIONED environment the migration seed
-- wins permanently and the bootstrap can never correct it. A founder there was
-- quoted $25.00 while the admin console read $2,500.00 — a 100x cross-screen
-- disagreement arising from DATA, not code.
--
-- ── WHY A NEW FORWARD MIGRATION AND NOT AN EDIT OF 0057 / 0066 (R103) ────────
--
-- 0057 and 0066 are already recorded in `__drizzle_migrations_applied` on every
-- existing environment. Rewriting an applied migration cannot repair an
-- environment that already ran it, and it would desync the byte-identical
-- mirror at server/db/migrations/. So the correction ships FORWARD, here.
--
-- ── THE GUARD: NEVER CLOBBER A PRICE AN ADMIN DELIBERATELY SET ───────────────
--
-- Each UPDATE fires only where the row BOTH still holds the exact stale seed
-- value AND has never been written by a human. Provenance, not magnitude:
--
--   * collective_application_fee_config.updated_by — the seed in 0057 omits the
--     column entirely, so a seeded row carries NULL; the bootstrap seed
--     (connection.ts:2384) likewise omits it. Every human write goes through
--     updateApplicationFee(), which records the actor
--     (server/lib/collectiveApplicationFeeResolver.ts) — so a non-seed marker
--     means an admin decided this price and it is left alone.
--   * platform_fees.updated_by_user_id — the seed in 0066 writes the literal
--     'system:seed'; admin writes go through setFee()
--     (server/platformFeesStore.ts) and carry the acting user's id.
--
-- Consequence: a fresh install is REPAIRED; an admin-set price SURVIVES. R103
-- keeps this guard even though all current data is test data.
--
-- MONEY. Integer minor units only. No `/100`, no `*100`, no float, no CAST.
-- 30000 is written as an integer literal, which is what the WAVE48/0186
-- `w48_money_typefloor_upd_*` triggers require of an amount_minor UPDATE.
--
-- IDEMPOTENT / NO-OP WHERE ALREADY CORRECT. Each UPDATE is predicated on the
-- stale value, so the second run matches zero rows, and on this workspace's
-- data.db and test.db (both already 30000) the FIRST run matches zero rows too.
-- Asserted by test in server/__tests__/w139_application_fee_seed_correction.test.ts.
--
-- DATA REPAIR ONLY. No CREATE TABLE, no ALTER, no DROP, no new row, no new
-- writer for this fee (R102 forbids a third writer). Pricing LOGIC is untouched:
-- the resolver's source precedence was already correct (R101).
--
-- MIRROR: a byte-identical copy of this file lives at
-- server/db/migrations/0196_wave139_application_fee_seed_correction.sql, as
-- server/__tests__/w9_migration_mirror_drift.test.ts requires of every
-- migration with id >= 0068.

-- ═══════════════════════════════════════════════════════════════════════════
-- §1 · collective_application_fee_config — 2500 ($25.00) -> 30000 ($300.00)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE collective_application_fee_config
   SET amount_minor = 30000,
       updated_at   = '2026-08-25T00:00:00.000Z',
       updated_by   = 'system:migration:0196_wave139'
 WHERE id           = 'default'
   AND amount_minor = 2500
   AND (updated_by IS NULL OR updated_by IN ('system:seed', 'system', 'seed'));

-- ═══════════════════════════════════════════════════════════════════════════
-- §2 · platform_fees['collective_application_fee'] — 250000 -> 30000
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE platform_fees
   SET amount_minor       = 30000,
       updated_at         = '2026-08-25T00:00:00.000Z',
       updated_by_user_id = 'system:migration:0196_wave139'
 WHERE key                = 'collective_application_fee'
   AND amount_minor       = 250000
   AND (updated_by_user_id IS NULL
        OR updated_by_user_id IN ('system:seed', 'system', 'seed'));
