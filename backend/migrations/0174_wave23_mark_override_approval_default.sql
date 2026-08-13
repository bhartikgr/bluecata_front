-- ===========================================================================
-- 0174 — WAVE 23 · ITEM 5 (FINAL REVIEW B, GOVERNANCE)
--
-- WHAT IS WRONG TODAY. `marks.override_admin_approval_mode` is seeded to
-- "able_to" by 0159 (line 242), and `overrideIsEffective()` reads that to mean
-- "a GP fair-value override is EFFECTIVE THE MOMENT IT IS WRITTEN; approval is
-- an after-the-fact review affordance". Both counterweights that were supposed
-- to make that safe — the approve/reject decision endpoint and the config
-- switch itself — are among the ~11 admin endpoints with ZERO UI CALLERS. So
-- in the shipped product nobody can review an override and nobody can reverse
-- one. An unreviewed, GP-set fair value that silently moves a reported mark is
-- precisely what a fund-admin diligence process is built to find, and
-- investment banks are currently evaluating this platform.
--
-- WHAT THIS MIGRATION DOES.
--   1. Flips the DEFAULT to "required": an override does not take effect until
--      an admin approves it. The capability is NOT removed — "able_to" remains
--      a fully supported, configurable value of the same key, so an operator
--      who genuinely wants immediate-effect overrides can still have them. The
--      switch stays DB-driven; nothing is hardcoded.
--   2. GRANDFATHERS, EXPLICITLY, the two classes of existing data that depend
--      on the old default. Neither is silently re-interpreted.
--
-- GRANDFATHER CLASS A — an operator's DELIBERATE choice is never overwritten.
-- The flip touches the config row ONLY where `updated_by` is still a
-- `migration:%` marker, i.e. the value is the untouched 0159 seed and was never
-- a human decision. If an admin has explicitly written this key, their value
-- stands, whatever it is. (`setW9Config()` stamps `updated_by` with the actor
-- id, so the two cases are distinguishable in the stored data itself — no
-- guessing.)
--
-- GRANDFATHER CLASS B — overrides that were ALREADY EFFECTIVE stay effective.
-- Every override written before this migration was effective on write under
-- "able_to". Flipping the default without care would retroactively de-effect
-- every pending override, i.e. a fund's reported marks would move overnight
-- because of a config change — the same class of silent misstatement this item
-- is meant to prevent. New column `grandfathered_effective` marks exactly the
-- rows that were pending at flip time; `overrideIsEffective()` honours it in
-- "required" mode. Deliberately NOT done: stamping those rows `approved`,
-- which would fabricate an approver and an approval timestamp that never
-- existed. They remain `pending`, visibly awaiting review, and are recorded as
-- grandfathered rather than approved.
--
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss. Re-running is a no-op: the
-- ALTER raises "duplicate column name" (swallowed by the runner's idempotency
-- clause) and both UPDATEs are already-satisfied predicates.
-- ===========================================================================

-- --- GRANDFATHER CLASS B: mark the pre-flip effective overrides ------------
ALTER TABLE valuation_mark_override
  ADD COLUMN grandfathered_effective INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Only rows that exist RIGHT NOW and are pending were effective under the old
-- default. `approved` rows need no grandfathering (they are effective in either
-- mode) and `rejected` rows were never effective.
UPDATE valuation_mark_override
   SET grandfathered_effective = 1
 WHERE approval_state = 'pending';
--> statement-breakpoint

-- --- GRANDFATHER CLASS A: flip only the untouched seed ---------------------
UPDATE wave9_reporting_config
   SET value_json  = '"required"',
       description = 'WAVE 23 ITEM 5 (2026-08-11) — a GP fair-value override does NOT take effect until an admin approves it. Supersedes the 0159 seed "able_to", which is still a supported value of this key: set it back to "able_to" for immediate-effect overrides with after-the-fact review. Overrides that were pending when 0174 ran are grandfathered effective via valuation_mark_override.grandfathered_effective.',
       updated_by  = 'migration:0174',
       updated_at  = '2026-08-11T00:00:00Z'
 WHERE key = 'marks.override_admin_approval_mode'
   AND updated_by LIKE 'migration:%';
--> statement-breakpoint

-- Fresh install belt-and-braces: if 0159's seed never landed, the key must
-- still exist and must default to the SAFE value, because a missing key is
-- exactly the situation in which nobody has made a decision.
INSERT OR IGNORE INTO wave9_reporting_config
  (key, value_json, value_type, description, updated_by, updated_at)
VALUES
  ('marks.override_admin_approval_mode', '"required"', 'string',
   'WAVE 23 ITEM 5 (2026-08-11) — a GP fair-value override does NOT take effect until an admin approves it. Set to "able_to" for immediate-effect overrides with after-the-fact review.',
   'migration:0174', '2026-08-11T00:00:00Z');
