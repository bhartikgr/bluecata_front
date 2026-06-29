-- 0066_v25_45_4_platform_fees.sql
--
-- v25.45.4 L-2 (Ozan live QA wave) — DB-backed platform fees (narrow scope).
--
-- ============================================================================
-- v25.46 EXTENSION POINT
-- ----------------------------------------------------------------------------
-- This table is the FOUNDATION for the full v25.46 "Platform Fees" admin panel.
-- For v25.45.4 it carries exactly ONE row: the Collective Application Fee
-- (currently a $2,500 hardcode in the apply-to-collective UI). v25.46 will
-- extend this SAME schema by adding more rows with new `key` values:
--     - subscription tier rows   (e.g. key='founder_free_annual', 'founder_pro_annual')
--     - per-deal fee rows        (e.g. key='per_deal_success_fee')
--     - marketplace fee rows     (e.g. key='marketplace_listing_fee')
-- No schema change is required for that extension — just INSERT more rows.
-- See build_spec/v25_46_extension_points.md for the full hook description.
-- ============================================================================
--
-- ADDITIVE ONLY. No DROP, no destructive ALTER. CREATE TABLE IF NOT EXISTS +
-- INSERT OR IGNORE are safe to re-run.

CREATE TABLE IF NOT EXISTS platform_fees (
  key                 TEXT PRIMARY KEY NOT NULL,
  amount_minor        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  updated_at          TEXT NOT NULL,
  updated_by_user_id  TEXT
);

-- Seed the single v25.45.4 row matching the current $2,500 hardcode.
INSERT OR IGNORE INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
VALUES ('collective_application_fee', 250000, 'USD', '2026-06-27T00:00:00.000Z', 'system:seed');
