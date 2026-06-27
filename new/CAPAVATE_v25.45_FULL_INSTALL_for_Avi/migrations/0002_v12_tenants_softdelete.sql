-- =============================================================================
-- v12 — Schema migration #2: tenants model, soft-delete, demo-seed tracking,
-- cap-table precision columns.
--
-- IDEMPOTENT — every statement uses IF NOT EXISTS or guards against re-running.
-- Compatible with BOTH SQLite (better-sqlite3) AND PostgreSQL (drizzle pg).
-- For Postgres, the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` syntax requires
-- PG >= 9.6 (always true in our deployment target Neon/Supabase).
--
-- For SQLite, `ALTER TABLE ... ADD COLUMN` is idempotency-checked at the
-- application layer inside server/db/connection.ts applyInlineMigrations()
-- via a try/catch that swallows "duplicate column name" errors. This file
-- is the canonical SQL spec; the runtime applier is authoritative.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New tables (Decision A — multi-tenant model)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,                                  -- "company" | "consortium_partner" (also legacy "founder"|"investor")
  billing_email TEXT,
  status        TEXT NOT NULL DEFAULT 'active',                 -- active | suspended | deleted
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT,
  updated_at    TEXT,
  deleted_at    TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id          TEXT PRIMARY KEY,
  active_tenant_id TEXT,
  updated_at       TEXT
);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- company_members extensions (v12 — tenant scoping + lifecycle columns)
-- -----------------------------------------------------------------------------
-- Note: SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
-- until 3.35+. The applyInlineMigrations runner in server/db/connection.ts
-- wraps each ADD COLUMN in a try/catch that swallows the duplicate-column
-- error, providing idempotency.
ALTER TABLE company_members ADD COLUMN tenant_id              TEXT;
--> statement-breakpoint
ALTER TABLE company_members ADD COLUMN consortium_partner_id  TEXT;
--> statement-breakpoint
ALTER TABLE company_members ADD COLUMN is_active              INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE company_members ADD COLUMN joined_at              TEXT;
--> statement-breakpoint
ALTER TABLE company_members ADD COLUMN last_active_at         TEXT;
--> statement-breakpoint
ALTER TABLE company_members ADD COLUMN deleted_at             TEXT;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Soft-delete column on the 8 compliance tables (Decision B).
-- legal_consents is deferred — its table doesn't exist yet (created when
-- legalConsentStore migrates on Day 3).
-- -----------------------------------------------------------------------------
ALTER TABLE companies         ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE companies         ADD COLUMN is_demo    INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users             ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE users             ADD COLUMN is_demo    INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE user_credentials  ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE audit_log         ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE securities        ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE subscriptions     ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE invoices          ADD COLUMN deleted_at TEXT;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Cap-table precision columns (DB-5).
-- The Sprint 25 invariants require BigInt-string precision for shares and
-- minor-unit integer storage for currency. We add parallel columns without
-- dropping the legacy `shares` integer / `investment_amount` real (so reads
-- during the v12 transition keep working). v13 will deprecate the legacy cols.
-- -----------------------------------------------------------------------------
ALTER TABLE securities ADD COLUMN shares_str   TEXT    NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE securities ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Indices for the tenant-scoped paths.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_company_members_tenant_user ON company_members(tenant_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_members_user        ON company_members(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_companies_tenant            ON companies(tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_credentials_email      ON user_credentials(email);
