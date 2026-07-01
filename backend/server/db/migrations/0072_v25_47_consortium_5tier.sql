-- 0072_v25_47_consortium_5tier.sql
-- v25.47 APD-030 (HIGH-11) — Consortium Partner 5-tier taxonomy.
-- ADDITIVE ONLY: seed the canonical 5 recurring tier rows into platform_fees.
-- Legacy consortium.subscription.partner_{basic,pro,enterprise} rows are
-- PRESERVED (deprecated in code only). INSERT OR IGNORE so admin edits are
-- never clobbered. SEPARATE/PARALLEL to the Capavate subscription flow.
INSERT OR IGNORE INTO platform_fees
  (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
  VALUES
  ('consortium.subscription.catalyst',         49900,  'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL),
  ('consortium.subscription.builder',          99900,  'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL),
  ('consortium.subscription.amplifier',        149900, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL),
  ('consortium.subscription.nexus',            499900, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL),
  ('consortium.subscription.founding_member',  0,      'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL);
