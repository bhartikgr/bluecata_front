-- ═══════════════════════════════════════════════════════════════════════════
-- 0203 · WAVE 154 · BATCH 2 · ITEM K — SPV LAUNCH-GATE OVERRIDE LEDGER.
--                                                              R114.3, R116.3
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE GATE IS. From wave 154 an SPV may only be LAUNCHED (and money may
-- only be taken IN) when EVERY company it invests into holds a current paid
-- Capavate membership. Membership is read live from `capavate_subscriptions`;
-- the decision is DERIVED ON EVERY REQUEST and is NEVER persisted, so a company
-- that pays is unblocked by the payment itself with no backfill, no cron, and
-- no stale flag to repair. Nothing in this migration stores a gate result.
--
-- WHAT THIS TABLE IS. The owner-mandated ESCAPE HATCH (R114.3): an admin can let
-- one named SPV, or one named company, through the gate — and that decision is a
-- LEDGER ENTRY, not a boolean. Every override carries a REASON (NOT NULL: an
-- override without a stated reason is not a decision, it is an accident), the
-- admin who created it, and — if it is ever withdrawn — the admin who withdrew
-- it and when. Rows are NEVER deleted or rewritten: `revoked_at` is stamped and
-- the row stays, so "who let this through, and why" is answerable forever.
--
-- SCOPE.
--   scope_kind='spv'      → scope_id is spv.id      — this ONE SPV may launch.
--   scope_kind='company'  → scope_id is a company id — this ONE company stops
--                           blocking every SPV it appears in. This is the shape
--                           the owner asked for: relief granted to the company
--                           that is actually behind on membership.
-- The CHECK constraint means a third scope cannot be invented by a caller
-- passing a typo — an unknown scope is a write failure, not a silent no-op.
--
-- WHY THERE IS NO `active` COLUMN. A derived boolean stored beside its own
-- inputs is the bug this wave exists to avoid. "Is this override live right now"
-- is `revoked_at IS NULL`, evaluated at read time.
--
-- UNIQUE (scope_kind, scope_id, created_at) permits the honest lifecycle
-- grant → revoke → grant again on the same target while making a duplicated
-- write of the SAME grant impossible.
--
-- NO SETTINGS ARE SEEDED HERE. The three launch-gate settings
-- (`spv.launch_gate.mode`, `spv.launch_gate.no_company_policy`,
-- `spv.launch_gate.freeze_enabled`) live in `platform_config`, whose
-- `trg_pc_no_direct_insert` trigger (server/db/connection.ts) REJECTS any insert
-- not matched by a genesis history row carrying a computed revision hash. SQL
-- cannot compute that hash. They are therefore seeded from TypeScript at boot
-- through `ensurePlatformConfigKey` (server/lib/platformConfigWriter.ts:234) and
-- an INSERT here would abort the migration. Do not add one.
--
-- IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS only. No UPDATE, no DELETE, no
-- data movement — re-running this file changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS spv_launch_gate_override (
  id          TEXT PRIMARY KEY NOT NULL,
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('spv','company')),
  scope_id    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  revoked_at  TEXT,
  revoked_by  TEXT,
  UNIQUE (scope_kind, scope_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_slgo_scope
  ON spv_launch_gate_override (scope_kind, scope_id);
