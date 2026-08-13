-- migrations/0163_wave7_xc3_retire_partner_enterprise_alias.sql
-- WAVE 7 — X-C3 (C-3). "Remove the stale partner_enterprise alias row and its
-- display."
--
-- THE ROW. `platform_fees` key `consortium.subscription.partner_enterprise`,
-- amount_minor 249900, seeded by the v25.46.1 block in server/db/connection.ts
-- (:1920) back when the partner ladder was three tiers named partner_basic /
-- partner_pro / partner_enterprise. v25.47 (migration 0072) replaced that
-- ladder with the canonical five — catalyst, builder, amplifier, nexus,
-- founding_member — and, in its own words, PRESERVED the legacy rows
-- ("deprecated in code only"). They were never retired. X-C3 retires this one.
--
-- WHY IT IS A DEFECT AND NOT MERE CLUTTER. The admin tier editor is DB-driven:
-- AdminFeesConsolidated.tsx:1005-1030 renders one editable amount field per row
-- returned by listTiers("consortium.subscription."), which is a prefix scan
-- (server/subscriptionTierStore.ts:81-90). So the stale row DISPLAYS as a real,
-- editable partner subscription tier at $2,499/mo — a price that belongs to no
-- tier in PARTNER_TIERS (server/lib/partnerTiers.ts:36-42) and that an admin can
-- edit in the belief it charges somebody. That is the "display" half of C-3, and
-- it is deleted by deleting the row; there is no hardcoded list to edit, which
-- is exactly how the owner's all-DB-driven rule is supposed to pay off.
--
-- WHY REMOVING IT LOSES NO CAPABILITY. `partner_enterprise` remains a live
-- ALIAS: LEGACY_PARTNER_SLUG_MAP (server/lib/partnerTiers.ts:47-53) maps
-- partner_enterprise → amplifier, and that map is DELIBERATELY LEFT IN PLACE by
-- this wave. Any partner record still carrying the legacy slug therefore
-- resolves to `amplifier` and is priced from
-- `consortium.subscription.amplifier`, which migration 0072 seeded and which is
-- live. The alias row is a duplicate PRICE for a tier that already has one — the
-- second-writer/second-source shape this project keeps getting burnt by.
--
-- GUARDED, NOT BLIND. The UPDATE below only fires when the canonical amplifier
-- row actually exists and is live. If 0072 were ever rolled back, this migration
-- becomes a no-op and the legacy row stays, so partner pricing can never be left
-- with NO row to resolve against. Fail-safe by construction.
--
-- SOFT DELETE, NOT DELETE. `platform_fees` already models retirement with
-- `deleted_at`, and every read path filters on it
-- (`deleted_at IS NULL OR deleted_at = ''` — subscriptionTierStore.ts:86, :104,
-- :163). Setting `deleted_at` retires the row from every reader while keeping
-- the historical amount for audit. A hard DELETE would destroy the record of
-- what the tier used to cost.
--
-- SCOPE — DELIBERATELY NARROW. `consortium.subscription.partner_basic` and
-- `...partner_pro` are stale in exactly the same way and are NOT touched here,
-- because X-C3 names only partner_enterprise and this wave does not widen its
-- own scope over money rows. They are reported as an open finding in
-- build_log/WAVE7_REPORT.md rather than silently swept up.
--
-- MIGRATION NUMBER — 0163. Re-verified on disk immediately before writing:
-- 0161 and 0162 (wave3f) appeared in BOTH migration directories DURING this
-- wave, written by a concurrent agent, after this wave had already confirmed
-- 0161 was free. 0163 is the first free number above every file present in
-- either directory at the time of writing. 0152/0154/0155/0158 remain BURNT and
-- are not reused. See build_log/WAVE7_CONCURRENCY_EVIDENCE.txt.
--
-- SACRED FILES: none touched. server/db/connection.ts and db/migrate.ts are not
-- modified. New file only, mirrored BYTE-IDENTICALLY into
-- server/db/migrations/0163_wave7_xc3_retire_partner_enterprise_alias.sql.
--
-- IDEMPOTENCY: the WHERE clause requires deleted_at to be NULL/'' , so a second
-- run matches nothing. Re-running this file is a no-op.
--
-- ROLLBACK:
--   UPDATE platform_fees SET deleted_at = NULL
--    WHERE key = 'consortium.subscription.partner_enterprise';
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE platform_fees
   SET deleted_at = '2026-08-10T00:00:00.000Z',
       updated_at = '2026-08-10T00:00:00.000Z',
       updated_by_user_id = 'system:migration:0163_wave7_xc3'
 WHERE key = 'consortium.subscription.partner_enterprise'
   AND (deleted_at IS NULL OR deleted_at = '')
   -- Only ever retire the alias while the tier it aliases has a live price.
   AND EXISTS (
         SELECT 1 FROM platform_fees canonical
          WHERE canonical.key = 'consortium.subscription.amplifier'
            AND (canonical.deleted_at IS NULL OR canonical.deleted_at = '')
       );
