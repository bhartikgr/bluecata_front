-- =============================================================================
-- v12 — Data migration #3: backfill tenants table + tenant_id columns
-- from existing companies + company_members rows.
--
-- IDEMPOTENT — every INSERT uses `INSERT OR IGNORE` (SQLite) / `ON CONFLICT
-- DO NOTHING` (Postgres). Every UPDATE filters `WHERE tenant_id IS NULL`
-- so re-running is safe.
--
-- Applied by server/db/connection.ts applyInlineMigrations() on every boot.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. For every existing companies row that lacks a tenant entry, create one.
--    Tenant id = 'tenant_co_' || companies.id, kind = 'company'.
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO tenants (id, kind, name, billing_email, status, is_demo, created_at, updated_at, deleted_at)
SELECT
  'tenant_co_' || c.id        AS id,
  'company'                    AS kind,
  c.name                       AS name,
  NULL                         AS billing_email,
  'active'                     AS status,
  COALESCE(c.is_demo, 0)       AS is_demo,
  COALESCE(c.tenant_id, datetime('now')) AS created_at,
  NULL                         AS updated_at,
  c.deleted_at                 AS deleted_at
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM tenants t WHERE t.id = 'tenant_co_' || c.id
);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Backfill companies.tenant_id to point at the per-company tenant.
--    Only updates rows where tenant_id is NULL or empty (idempotent).
-- -----------------------------------------------------------------------------
UPDATE companies
SET tenant_id = 'tenant_co_' || id
WHERE tenant_id IS NULL OR tenant_id = '';
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3. Backfill company_members.tenant_id from its company's tenant.
-- -----------------------------------------------------------------------------
UPDATE company_members
SET tenant_id = (
  SELECT companies.tenant_id
  FROM companies
  WHERE companies.id = company_members.company_id
)
WHERE tenant_id IS NULL
  AND company_id IS NOT NULL;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Backfill company_members.joined_at and is_active for legacy rows.
-- -----------------------------------------------------------------------------
UPDATE company_members
SET joined_at = COALESCE(joined_at, datetime('now'))
WHERE joined_at IS NULL;
--> statement-breakpoint

UPDATE company_members
SET is_active = 1
WHERE is_active IS NULL;
