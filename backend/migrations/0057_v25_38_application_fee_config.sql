-- =============================================================================
-- v25.38 — migration 0057: collective application-fee config (Admin DB-driven).
--
-- WHY THIS FILE EXISTS
-- Promotes the former hardcoded founder application fee
--   client/src/pages/founder/ApplyToCollective.tsx: const APPLICATION_FEE = 2_500
-- to a DB-driven, admin-controlled value, satisfying the SACRED rule:
-- "Pricing plans are determined from the Admin area. They are never hardcoded."
--
-- A single-row config (id='default') holds the amount in minor units and the
-- currency. The historical value (2500) is seeded as the default so the
-- displayed amount is UNCHANGED from v25.37. There is NO admin write endpoint
-- in this wave; the seed is settable via SQL or a future wave. Every caller
-- (client + server) reads via server/lib/collectiveApplicationFeeResolver.ts.
--
-- COMPLEMENTARY, NOT A REPLACEMENT
-- The bootstrap path in server/db/connection.ts also creates+seeds this table
-- (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE), so both paths are fully
-- idempotent and dual-safe. SQL style matches migrations/0050..0056.
-- =============================================================================

CREATE TABLE IF NOT EXISTS collective_application_fee_config (
  id           TEXT PRIMARY KEY DEFAULT 'default',
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT
);

INSERT OR IGNORE INTO collective_application_fee_config (id, amount_minor, currency, updated_at)
  VALUES ('default', 2500, 'USD', datetime('now'));
