-- 0088_v25_50_partner_pipeline_canonical_stages
-- v25.50.0 Phase 2 (spec 2c, LOCKED): re-key the Consortium Partner pipeline
-- board to Capavate's canonical company deal funnel VERBATIM:
--   invited -> viewed -> soft_circle -> signed -> funded -> committed
-- Remap any legacy stage values persisted under the prior
-- sourcing/qualifying/committee/closed_* vocabulary. Idempotent: re-running
-- is a no-op once values are already canonical (no legacy rows match).
UPDATE partner_deal_pipeline SET stage = 'invited'     WHERE stage IN ('sourcing', 'sourced');
UPDATE partner_deal_pipeline SET stage = 'viewed'      WHERE stage = 'qualifying';
UPDATE partner_deal_pipeline SET stage = 'soft_circle' WHERE stage = 'committee';
UPDATE partner_deal_pipeline SET stage = 'funded'      WHERE stage = 'closed_won';
UPDATE partner_deal_pipeline SET stage = 'invited'     WHERE stage = 'closed_lost';
-- 'committed' is already canonical and left unchanged.

-- Align the column default with the new default stage (additive; SQLite keeps
-- the old default on existing rows, this only affects future bare inserts that
-- omit the store's explicit default).
