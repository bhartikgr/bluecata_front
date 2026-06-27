-- =============================================================================
-- v25.38 — migration 0058: partner commission-rate config (Admin DB-driven).
--
-- WHY THIS FILE EXISTS
-- Promotes the partner-tier commission rates to a DB-driven, admin-controlled
-- table, satisfying the SACRED rule: "Pricing plans are determined from the
-- Admin area. They are never hardcoded."
--
-- AVI-CODE PRESERVATION (STANDING RULE)
-- Avi's literal COMMISSION_RATE table in server/partnerConsortiumRoutes.ts is
-- LEFT BYTE-IDENTICAL — it remains the ULTIMATE fallback. This table + the new
-- server/lib/partnerCommissionRateResolver.ts add a DB-driven "go forward"
-- path WITHOUT modifying or overriding Avi's existing call site. The seeded
-- per-tier rows mirror Avi's exact rates so resolver output equals Avi's table
-- on a fresh deploy.
--
-- TIER SET — matches the ACTUAL PartnerTier values used by Avi's code:
--   catalyst 0.02, builder 0.03, amplifier 0.04, nexus 0.05, founding_member 0.06
--
-- COMPLEMENTARY, NOT A REPLACEMENT
-- The bootstrap path in server/db/connection.ts also creates+seeds this table
-- (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE), dual-safe + idempotent.
-- SQL style matches migrations/0050..0057.
-- =============================================================================

CREATE TABLE IF NOT EXISTS partner_commission_rate_config (
  tier       TEXT PRIMARY KEY,
  rate       REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

INSERT OR IGNORE INTO partner_commission_rate_config (tier, rate) VALUES
  ('catalyst', 0.02),
  ('builder', 0.03),
  ('amplifier', 0.04),
  ('nexus', 0.05),
  ('founding_member', 0.06);
