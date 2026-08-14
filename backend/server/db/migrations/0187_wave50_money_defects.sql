-- WAVE 50 — THE MONEY DEFECTS FOUND BY INDEPENDENT REVIEW (Review B / REVIEW_B_MONEY.md)
--
-- Three sections, one migration, because all three are additive schema/seed work
-- landing in the same wave and a second numbered file would buy nothing but a
-- second byte-identical mirror to keep in sync:
--
--   §1  ITEM 3 — a per-row FREE ATTESTATION on `partner_tier_price`, so that a
--                genuinely-free tier and a tier misconfigured to zero stop being
--                the same thing.
--   §2  ITEM 2 — `spv_deployment_fee_exemption`, so a vehicle that was already
--                deployed BEFORE the idempotency latch existed is not charged a
--                false $240 when it is relaunched.
--   §3  ITEM 1 — the founder annual administrative fee and the academy one-time
--                fee as ADMIN-EDITABLE DATABASE ROWS, so the compiled-in
--                `STATIC_FALLBACK` in server/publicPricingRoutes.ts can be
--                deleted outright (R21, R22).
--
-- MIRROR: a byte-identical copy of this file lives at
-- server/db/migrations/0187_wave50_money_defects.sql. Both are read by the
-- self-heal installers; they must never diverge.

-- ═══════════════════════════════════════════════════════════════════════════
-- §1 · ITEM 3 — A TIER-LEVEL `price_minor = 0` MUST NOT SILENTLY MAKE EVERY
--               PARTNER ON THAT TIER FREE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE DEFECT, REPRODUCED. `server/lib/partnerTiers.ts` → `priceRows()` selects
--
--     WHERE cadence = ? AND active = 1 AND price_minor IS NOT NULL
--
-- `0` passes that filter. So a `0` typed into one tier row flows straight through
-- `resolveConsortiumPricing()` → `resolveChargeTier()` →
-- `resolvePartnerEffectivePlan()` (which reports
-- `effectivePrice.source = "tier_advertised"`, `amountMinor: 0`) → a $0 invoice
-- for EVERY partner on that tier. The path correctly fails closed on NULL and
-- then accepts 0, which defeats R20 and contradicts the documented invariant that
-- "a per-partner explicit $0 override is the ONLY path to a $0 amount".
--
-- WHY A MAGNITUDE TEST CANNOT DECIDE THIS. Both positions are already written
-- down in this tree, in migrations:
--   • 0153 (partner_tier_price DDL): "NULL means DELIBERATELY UNPRICED. It is not
--     zero. A zero price is a real free tier and must be written as 0, never left
--     NULL."
--   • 0185 §3: founding_member is priced 24000 like everyone else, because "a
--     free TIER would make every future occupant of that tier free by accident";
--     the five founding partners are made free by per-partner $0 overrides with
--     written reasons (R17).
-- R3 nevertheless requires a real free tier to remain EXPRESSIBLE. So `0` cannot
-- be banned, and it cannot be trusted either. `= 0` carries no information about
-- which of the two it is.
--
-- THE RULE THIS MIGRATION MAKES ENFORCEABLE — PROVENANCE, NOT MAGNITUDE:
--
--     A `price_minor = 0` row is honoured as a REAL PRICE only when the row
--     carries an explicit, durable free attestation: `free_attested = 1` AND a
--     non-empty `free_reason`. A `price_minor = 0` row without that attestation
--     is MISCONFIGURED and refuses exactly like NULL — omitted from the
--     advertised surface, and `requireChargeTier()` throws naming the tier, the
--     cadence and the reason. Never a silent $0 invoice.
--
-- This is the same principle `derivation` already applies to how a price was
-- arrived at, and the same principle R16 applies to a stored `4250`: when a value
-- is ambiguous, resolve it from recorded provenance, never from its magnitude.
-- Attesting a tier free is a deliberate operator act that leaves a written reason
-- behind, which is exactly what R17 requires of a $0 anywhere else.
--
-- ADDITIVE ONLY. `partner_tier_price` is STRICT and carries the Wave 45 freeze
-- triggers (`trg_ptp_frozen_no_price_update` / `..._insert`); ADD COLUMN neither
-- rebuilds the table nor drops a trigger or index. Defaults are chosen so every
-- existing row's meaning is UNCHANGED: `free_attested = 0` on all 24000-minor
-- rows is a no-op, and on the NULL-priced monthly rows it is also a no-op.
ALTER TABLE partner_tier_price
  ADD COLUMN free_attested INTEGER NOT NULL DEFAULT 0 CHECK (free_attested IN (0,1));

ALTER TABLE partner_tier_price
  ADD COLUMN free_reason TEXT;

-- No row is attested free by this migration. Seeding an attestation would be this
-- migration deciding a pricing question that belongs to the owner — precisely the
-- "compiled-in default" R21 forbids, moved into SQL. The mechanism ships; the
-- decision stays with whoever is accountable for it.

-- ═══════════════════════════════════════════════════════════════════════════
-- §2 · ITEM 2 — A FALSE $240 ON LEGACY VEHICLES RELAUNCHED AFTER WIND-DOWN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE DEFECT. Wave 46 (R22) wired the SPV deployment fee to the not-live → live
-- edge (`isPushToLiveTransition`, server/lib/spvDeploymentFeeSource.ts:436) and
-- argued that a re-push after a wind-down "is stopped by the idempotency latch
-- rather than by the trigger condition". That argument holds only for a vehicle
-- THE LATCH HAS SEEN. All three latch layers are ABSENCES for a vehicle migrated
-- out of `partner_spvs` / `partner_funds`:
--
--   1. no `spv_deployment_fee_billing` row — that table is migration 0162, which
--      postdates these rows by many waves;
--   2. no `partner_billing_entries` row of kind `spv_deployment_fee`;
--   3. `spv.deployment_fee_minor IS NULL`.
--
-- So a legacy vehicle sitting at `wound_down`, relaunched to `open`, crosses the
-- edge with nothing to stop it and is charged $240 for a deployment that already
-- happened, years ago, off-platform.
--
-- WHY THIS NEEDS A ROW AND NOT A PREDICATE. `spv.migrated_from IS NOT NULL` alone
-- must NOT exempt a vehicle: a legacy row that arrived in `draft` (mapped from
-- `planning` / `planned` by `migrateLegacyPartnerSpvAndFunds`, spvEngineStore.ts
-- ~:2554) and is pushed live for the first time ON THIS PLATFORM is a genuine
-- first deployment and MUST be charged. The fact that actually matters is "this
-- vehicle was ALREADY LIVE when it entered the canonical engine, before the latch
-- existed" — and that is destroyed the moment `spv.status` is mutated, because
-- status is updated in place. It is not re-derivable later, so it is recorded now.
--
-- `spv.archived_at` cannot substitute: the legacy migration writes
-- `archivedAt: null` even for rows it maps to `wound_down`, and a vehicle that
-- arrived `open` and was later archived through `archiveSpv()` has `archived_at`
-- set for a reason that has nothing to do with the latch.
--
-- THIS IS AN EXEMPTION, NOT A CHARGE. It is deliberately NOT expressed as a
-- `charged` row in `spv_deployment_fee_billing`, whose CHECK admits only
-- `pending|charged`: writing `charged` would claim money was collected when none
-- was, corrupting the billing record to fix a billing bug. A separate table keeps
-- "we are not charging this, and here is why" distinguishable from "we charged
-- this" in every future audit.
CREATE TABLE IF NOT EXISTS spv_deployment_fee_exemption (
  spv_id            TEXT PRIMARY KEY NOT NULL,
  -- Why this vehicle is exempt. Enumerated so a future exemption class cannot be
  -- smuggled in as free text, and so a query can tell them apart.
  reason            TEXT NOT NULL
                      CHECK (reason IN ('pre_latch_deployment')),
  -- The legacy identity this vehicle was migrated from (`spv.migrated_from`).
  -- NOT NULL: an exemption with no provenance is an unaudited free pass.
  migrated_from     TEXT NOT NULL,
  -- The canonical status the vehicle held when the exemption was recorded, i.e.
  -- the evidence that it was already live (or already retired FROM live).
  status_at_record  TEXT NOT NULL,
  -- Free-text note for a human auditor. Required by the same logic as R17's
  -- "written reason" on a $0 override.
  note              TEXT NOT NULL,
  recorded_at       TEXT NOT NULL,
  recorded_by       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sdfe_migrated_from ON spv_deployment_fee_exemption (migrated_from);
CREATE INDEX IF NOT EXISTS idx_sdfe_reason ON spv_deployment_fee_exemption (reason);

-- ═══════════════════════════════════════════════════════════════════════════
-- §2b · ITEM 2 — BACKFILL THE EXEMPTION FROM ROW FACTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A SEPARATE SECTION ON PURPOSE. This statement reads `spv.deployment_fee_minor`,
-- a column added by migration 0160, and `spv_deployment_fee_billing`, a table
-- created by 0162. Both exist on any database that has run the numbered
-- migrations in order, which is the only way this file is applied in production.
-- They do NOT exist on a `:memory:` database built from the inline bootstrap in
-- server/db/connection.ts (which is SACRED and cannot be extended), so the
-- self-heal installer skips THIS section alone when the column is absent — and
-- skipping it is a genuine no-op there, because a database that never had 0160
-- has never stamped an engine deployment fee and holds no migrated legacy rows
-- to exempt. Keeping the CREATE TABLE in its own section means the exemption
-- table itself is always present, so the charge path's lookup is never reading a
-- table that does not exist.
--
-- BACKFILL — DATA-DRIVEN, NOT A HARDCODED LIST OF IDS (R17's standing rule).
-- Every predicate below is a fact about the row, so this INSERT selects exactly
-- the vehicles that satisfy the rule and nothing else, on any database:
--
--   • `migrated_from IS NOT NULL` .... it predates the canonical engine, and so
--                                     predates migration 0162's latch;
--   • status is LIVE or `wound_down` . it was live when it entered the canonical
--                                     table (`wound_down` is only reachable by
--                                     having been live);
--   • no `spv_deployment_fee_billing` row, and
--   • `deployment_fee_minor IS NULL` . the latch has genuinely never seen it, so
--                                     this cannot exempt a vehicle that was in
--                                     fact charged.
--
-- A legacy row still sitting in `draft` is deliberately NOT matched: its first
-- push to live is a real first deployment and must be charged.
--
-- INSERT OR IGNORE + PRIMARY KEY makes re-running a no-op.
INSERT OR IGNORE INTO spv_deployment_fee_exemption
  (spv_id, reason, migrated_from, status_at_record, note, recorded_at, recorded_by)
SELECT
  s.id,
  'pre_latch_deployment',
  s.migrated_from,
  s.status,
  'WAVE 50 ITEM 2. Migrated from legacy ' || s.migrated_from || ' already at status '''
    || s.status || ''', i.e. deployed before the spv_deployment_fee_billing latch '
    || '(migration 0162) existed. Relaunching it is not a first push to live, so the '
    || 'R3/R22 one-time deployment fee is not owed. Recorded from row facts, not from a list of ids.',
  '2026-08-14T00:00:00Z',
  'migration_0187'
FROM spv s
WHERE s.migrated_from IS NOT NULL
  AND s.status IN ('open','closed','deployed','distributing','wound_down')
  AND s.deployment_fee_minor IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM spv_deployment_fee_billing b WHERE b.spv_id = s.id
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- §3 · ITEM 1 — THE FOUNDER ANNUAL ADMINISTRATIVE FEE BECOMES A DATABASE ROW
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE DEFECT, REPRODUCED. `server/publicPricingRoutes.ts` carries
--
--     const STATIC_FALLBACK = {
--       capavate_annual:  { price_minor:  84000, currency: "USD", display: "$840/year per company" },
--       academy_one_time: { price_minor: 150000, currency: "USD", display: "$1,500 one-time" },
--       ...
--
-- and `kv_pricingModelStore` holds ZERO rows in both `data.db` and `test.db`.
-- These are therefore not dormant fallbacks: they are the live answer served to
-- every visitor of the public pricing endpoint, from compiled-in constants. That
-- is a second source for a price (R22: "every price must resolve from one read")
-- and a static price (R21: "100% dynamic. Nothing static or hard coded").
--
-- $840.00 IS A REAL PRICE FOR A REAL PRODUCT — it appears on 30+ live paid
-- invoices and matches the "Capavate Annual Administrative Fee". The HARDCODING
-- is the defect, not the number. So the number moves into the database and is
-- resolved from there; it is not deleted and it is not changed.
--
-- WHY `platform_fees` AND NOT `kv_pricingModelStore`. `platform_fees` is the
-- admin-editable key/amount table R22 already made authoritative for the partner
-- SPV fee ("the value the owner edits is authoritative; the charge path must read
-- the SAME row"). It is created by the inline bootstrap in server/db/connection.ts,
-- so it exists on every database including the `:memory:` test one, and it already
-- holds `consortium.spv_deployment_fee = 500000` — the legitimate seed this wave
-- confirmed and did not touch. Putting the founder fee anywhere else would create
-- a third pricing home. `server/pricingModelStore.ts` (~:161-182) records that
-- these very numbers — "Free, Pro, Capavate Annual at $840" — were a hardcoded
-- seed deleted in v25.27; the `STATIC_FALLBACK` entry is a surviving copy of it.
--
-- SEEDED FROM THE VALUE ALREADY IN PRODUCTION USE, not invented here: 84000 minor
-- units USD is the amount on the live invoices, and 150000 USD the academy fee.
-- After this seed the code has no number to fall back TO — the fallback is
-- deleted, and an empty row renders an explicit R6 refusal.
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
VALUES
  ('founder.capavate_annual',  84000, 'USD', '2026-08-14T00:00:00Z', 'migration_0187', 'annual',   NULL),
  ('founder.academy_one_time', 150000, 'USD', '2026-08-14T00:00:00Z', 'migration_0187', 'one_time', NULL);
