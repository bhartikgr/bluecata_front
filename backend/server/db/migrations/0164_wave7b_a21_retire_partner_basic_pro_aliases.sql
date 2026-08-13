-- migrations/0164_wave7b_a21_retire_partner_basic_pro_aliases.sql
-- WAVE 7B — A-21. Owner ruling issued after WAVE 7 hand-back:
--
--   "partner_basic and partner_pro are stale exactly like partner_enterprise.
--    Wave 7 shipped X-C3 retiring only partner_enterprise because the item
--    named only that one. Ruling: fix all three."
--
-- WAVE 7 retired `consortium.subscription.partner_enterprise` in
-- 0163_wave7_xc3_retire_partner_enterprise_alias.sql and reported the other two
-- as an OPEN FINDING rather than widening its own scope over money rows
-- (build_log/WAVE7_REPORT.md §3.3). This migration closes that finding using
-- 0163's pattern EXACTLY — same guard, same soft delete, same fail-safe, same
-- self-heal requirement.
--
-- THE ROWS.
--   consortium.subscription.partner_basic  amount_minor 49900  ($499/mo)
--   consortium.subscription.partner_pro    amount_minor 99900  ($999/mo)
-- Both are seeded by the v25.46.1 block in server/db/connection.ts (:1918,
-- :1919) — the same block that seeded the partner_enterprise row at :1920 —
-- back when the partner ladder was the three tiers partner_basic /
-- partner_pro / partner_enterprise. v25.47 (migration 0072) replaced that
-- ladder with the canonical five — catalyst, builder, amplifier, nexus,
-- founding_member — and PRESERVED the legacy rows ("deprecated in code only").
--
-- WHY THEY ARE DEFECTS AND NOT MERE CLUTTER. Identical to X-C3: the admin tier
-- editor is DB-driven. listTiers("consortium.subscription.") in
-- server/subscriptionTierStore.ts is a prefix scan, and
-- client/src/pages/admin/AdminFeesConsolidated.tsx renders ONE EDITABLE AMOUNT
-- FIELD PER ROW it returns. So each stale row DISPLAYS as a real, editable
-- partner subscription tier — $499/mo and $999/mo — that bills nobody, and an
-- admin can edit either in the belief it charges somebody. Deleting the row
-- deletes the display; there is no hardcoded tier list to also edit, which is
-- the all-DB-driven rule paying off.
--
-- WHY REMOVING THEM LOSES NO CAPABILITY. Both remain LIVE ALIASES.
-- LEGACY_PARTNER_SLUG_MAP (server/lib/partnerTiers.ts) maps
--   partner_basic → catalyst      (canonical price consortium.subscription.catalyst, 49900)
--   partner_pro   → builder       (canonical price consortium.subscription.builder,  99900)
-- and that map is DELIBERATELY LEFT IN PLACE, exactly as X-C3 left the
-- partner_enterprise → amplifier entry in place. Any partner record still
-- carrying a legacy slug therefore resolves to its canonical tier and is priced
-- from the canonical row, which migration 0072 seeded and which is live. Note
-- that in BOTH cases the legacy amount and the canonical amount are the SAME
-- number (49900 == 49900, 99900 == 99900): these rows are literally duplicate
-- prices for tiers that already have one — the second-source shape this project
-- keeps getting burnt by. Not one partner's price changes.
--
-- GUARDED, NOT BLIND. Each UPDATE fires only when THAT row's own canonical
-- target exists and is live. The two are guarded INDEPENDENTLY: if
-- `builder` were missing, `partner_pro` stays and `partner_basic` is still
-- retired. If 0072 were rolled back entirely, this migration is a total no-op
-- and both legacy rows stay, so partner pricing can never be left with no row
-- to resolve against. Fail-safe by construction.
--
-- SOFT DELETE, NOT DELETE. `platform_fees` models retirement with `deleted_at`
-- and every read path filters on it. Setting `deleted_at` retires each row from
-- every reader while keeping the historical amount for audit. A hard DELETE
-- would destroy the record of what the tier used to cost.
--
-- SCOPE. Exactly two rows. The canonical five and every collective.* row are
-- untouched; pinned by server/__tests__/wave7b_a21_alias_retirement.test.ts.
--
-- A-22 (STANDING CHECKLIST). "Does the bootstrap re-create what I just
-- repaired?" YES — server/db/connection.ts:1918-1919 re-seeds both rows into
-- every fresh or test database, and connection.ts is SACRED so the seed cannot
-- be edited out. A migration-only fix would repair upgraded databases and
-- SILENTLY REGRESS every fresh one, including the :memory: database
-- NODE_ENV=test opens. A self-heal installer therefore ships alongside:
-- server/lib/applyWave7bAliasRetirement.ts, which EXECUTES THIS FILE rather
-- than re-typing the SQL, so installer and migration cannot drift.
--
-- MIGRATION NUMBER — 0164. Verified on disk immediately before writing: the
-- highest file present in BOTH migrations/ and server/db/migrations/ is 0163.
-- 0152/0154/0155/0158 remain BURNT and are not reused. Mirrored
-- BYTE-IDENTICALLY into server/db/migrations/.
--
-- SACRED FILES: none touched. server/db/connection.ts and db/migrate.ts are not
-- modified.
--
-- IDEMPOTENCY: each WHERE clause requires deleted_at to be NULL/'', so a second
-- run matches nothing. Re-running this file is a no-op.
--
-- ROLLBACK:
--   UPDATE platform_fees SET deleted_at = NULL
--    WHERE key IN ('consortium.subscription.partner_basic',
--                  'consortium.subscription.partner_pro');
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE platform_fees
   SET deleted_at = '2026-08-10T00:00:00.000Z',
       updated_at = '2026-08-10T00:00:00.000Z',
       updated_by_user_id = 'system:migration:0164_wave7b_a21'
 WHERE key = 'consortium.subscription.partner_basic'
   AND (deleted_at IS NULL OR deleted_at = '')
   -- Only ever retire the alias while the tier it aliases has a live price.
   AND EXISTS (
         SELECT 1 FROM platform_fees canonical
          WHERE canonical.key = 'consortium.subscription.catalyst'
            AND (canonical.deleted_at IS NULL OR canonical.deleted_at = '')
       );

UPDATE platform_fees
   SET deleted_at = '2026-08-10T00:00:00.000Z',
       updated_at = '2026-08-10T00:00:00.000Z',
       updated_by_user_id = 'system:migration:0164_wave7b_a21'
 WHERE key = 'consortium.subscription.partner_pro'
   AND (deleted_at IS NULL OR deleted_at = '')
   -- Guarded INDEPENDENTLY of partner_basic above.
   AND EXISTS (
         SELECT 1 FROM platform_fees canonical
          WHERE canonical.key = 'consortium.subscription.builder'
            AND (canonical.deleted_at IS NULL OR canonical.deleted_at = '')
       );
