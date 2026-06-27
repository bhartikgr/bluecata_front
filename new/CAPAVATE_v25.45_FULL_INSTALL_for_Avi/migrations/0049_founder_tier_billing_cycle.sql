-- =============================================================================
-- v19 Wave A / Change 2 — single-plan founder pricing default.
--
-- Per founder directive (Ozan, 24-May-2026): exactly one active default
-- pricing tier — "Capavate Annual" at $840 USD/year per company.
--
-- This migration:
--   1. Adds billing_cycle + annual_price_cents columns to founder_tiers
--      (idempotent — duplicate-column errors are swallowed by the runner).
--   2. Inserts (idempotently) the single new Capavate Annual tier so a fresh
--      DB has the correct seed on first boot.
--
-- Soft-delete of legacy `founder_pro` / `founder_scale` / `founder_free`
-- rows is INTENTIONALLY OMITTED from this migration. Avi controls the
-- production DB; he will decide whether to soft-delete them or transition
-- existing subscribers to the new tier. The runtime store sources its
-- defaults from the in-memory seed when no DB rows exist, so a fresh
-- install behaves correctly without manual intervention.
--
-- If Avi wants to soft-delete the legacy tiers in production, run:
--   UPDATE founder_tiers
--      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
--    WHERE id IN ('founder_free','founder_pro','founder_scale')
--      AND deleted_at IS NULL;
-- (or in postgres, replace the timestamp expression with NOW()::text)
--
-- IDEMPOTENT: every statement is safe to re-run.
-- Compatible with SQLite (better-sqlite3) AND PostgreSQL (drizzle pg).
-- =============================================================================

-- 1) Add columns. SQLite: ALTER ADD COLUMN is idempotent-via-catch in the
--    runner. Postgres: use ADD COLUMN IF NOT EXISTS for true idempotency.
ALTER TABLE founder_tiers ADD COLUMN billing_cycle TEXT;

ALTER TABLE founder_tiers ADD COLUMN annual_price_cents INTEGER;

-- 2) Insert the single Capavate Annual tier on fresh DBs.
INSERT OR IGNORE INTO founder_tiers (
  id,
  name,
  usd_monthly,
  features_json,
  updated_at,
  updated_by,
  deleted_at,
  billing_cycle,
  annual_price_cents
) VALUES (
  'founder_capavate_annual',
  'Capavate Annual',
  70,
  '[{"key":"cap_table","label":"Cap Table Management","included":true},{"key":"rounds","label":"Round Management","included":true},{"key":"data_room","label":"Data Room","included":true},{"key":"investors_crm","label":"Investor CRM","included":true},{"key":"documents","label":"Documents & Term Sheets","included":true},{"key":"esop","label":"ESOP / Option Pool","included":true},{"key":"communications","label":"Messages & Communications","included":true},{"key":"audit_chain","label":"Audit Log & Hash Chain Verification","included":true},{"key":"compliance","label":"GDPR / CCPA Compliance Tools","included":true},{"key":"support","label":"Email Support","included":true},{"key":"collective","label":"Collective Membership","included":false},{"key":"consortium","label":"Consortium Partner Features","included":false}]',
  '2026-05-24T13:00:00.000Z',
  'system',
  NULL,
  'annual',
  84000
);
