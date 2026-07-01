-- 0073_v25_47_collective_member_single_tier.sql
-- v25.47 APD-019/APD-032(B) — Collective single canonical member tier.
-- ADDITIVE ONLY: seed the canonical 'standard' recurring tier into
-- platform_fees. Legacy collective.member_subscription.{basic,pro,enterprise}
-- rows are PRESERVED (deprecated in code only). INSERT OR IGNORE so admin
-- edits are never clobbered. SEPARATE/PARALLEL to the Capavate flow.
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
  VALUES
  ('collective.member_subscription.standard', 24900, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL);
