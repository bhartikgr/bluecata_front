-- migrations/0161_wave3f_partner_tier_canon.sql
-- WAVE 3F — ITEM 2. W10 REVIEW A, CRITICAL: "Engine deployment fee silently
-- bills the hardcoded `catalyst` tier instead of the canonical partner tier."
--
-- THE DEFECT. server/lib/spvDeploymentFee.ts:33-44 (pre-3F) read the partner
-- tier straight out of `contacts.metadata_json.tier` and returned the LITERAL
-- string "catalyst" whenever that JSON was absent, unparseable or held an
-- unknown value. server/lib/spvDeploymentFee.ts:80 then used that guess to
-- resolve the fee, and server/spvEngineStore.ts fed the sponsor partner into it.
-- Reproduced: canonical partner tier `builder`, contact metadata NULL → billed
-- at the catalyst schedule (11100) instead of the builder schedule (22200).
--
-- Two rules are broken by that, not one:
--   1. a BUSINESS TIER was selected by a value hardcoded in the artifact
--      (owner's all-DB-driven / no-hardcoded-business-values rule); and
--   2. `contacts.metadata_json` is NOT the canonical partner record — WAVE 4B
--      found it carries a partner type behind an `as any` cast that is not even
--      a member of the store's own union. A JSON blob that the type system does
--      not police must not be the source of truth for money.
--
-- WHAT THIS MIGRATION ADDS. `partner_tier_current`: ONE durable, typed,
-- CHECK-constrained row per partner holding the canonical tier. It is the
-- record `server/lib/partnerTierResolver.ts` reads, and the resolver FAILS
-- CLOSED — no row and no agreeing canonical record means billing is BLOCKED,
-- never defaulted.
--
-- BACKFILL. Existing partners are seeded from `contacts.metadata_json.tier`
-- ONLY where that value is one of the five legal tiers. A partner whose JSON is
-- absent, malformed or unknown gets NO ROW — which is precisely the fail-closed
-- state we want, instead of the "catalyst" guess it used to get. The backfill
-- is a one-way lift of already-existing data; it invents nothing.
--
-- MIGRATION NUMBER — 0161. Verified on disk 2026-08-10 immediately before
-- writing: the highest file present in BOTH `migrations/` and
-- `server/db/migrations/` is 0160_wave8_orp029_engine_spv_deployment_fee.sql.
-- Present order: 0149, 0150, 0151, 0153, 0156, 0157, 0159, 0160. 0152, 0154,
-- 0155 and 0158 are BURNT per ruling A-17 and are NOT reused. 0161 is the first
-- free number above every file present in either directory.
--
-- SACRED FILES: none touched. server/db/connection.ts and db/migrate.ts are not
-- modified by this wave. New file only, mirrored BYTE-IDENTICALLY into
-- server/db/migrations/0161_wave3f_partner_tier_canon.sql.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + an
-- INSERT ... WHERE NOT EXISTS backfill. Running this file twice is a no-op.
--
-- ROLLBACK: DROP TABLE partner_tier_current. No other table references it; the
-- resolver simply fails closed again on a missing table, which blocks billing
-- rather than mis-billing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_tier_current (
  partner_id      TEXT PRIMARY KEY NOT NULL,
  -- The five legal tiers, enforced by the DATABASE. An unknown tier cannot be
  -- stored at all, so the resolver never has to decide what to do with one.
  tier            TEXT NOT NULL CHECK (tier IN ('catalyst','builder','amplifier','nexus','founding_member')),
  -- Where this row came from: 'backfill_contacts_metadata' | 'canonical_partner_record' | 'admin'.
  source          TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_partner_tier_current_tier
  ON partner_tier_current (tier);

-- Backfill: legal tiers only, one row per consortium partner, never overwriting
-- a row that already exists.
INSERT INTO partner_tier_current (partner_id, tier, source, effective_from, updated_at)
SELECT
  c.id,
  json_extract(c.metadata_json, '$.tier'),
  'backfill_contacts_metadata',
  COALESCE(json_extract(c.metadata_json, '$.tierSince'), c.created_at),
  c.updated_at
FROM contacts c
WHERE c.kind = 'consortium_partner'
  AND c.metadata_json IS NOT NULL
  AND json_valid(c.metadata_json)
  AND json_extract(c.metadata_json, '$.tier') IN
      ('catalyst','builder','amplifier','nexus','founding_member')
  AND NOT EXISTS (SELECT 1 FROM partner_tier_current t WHERE t.partner_id = c.id);
