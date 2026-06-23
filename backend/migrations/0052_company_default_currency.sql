-- v24.2 Bug 6 — durable persistence for the Settings → Company "default currency"
-- selection. We deliberately DO NOT add a column to the sacred `companies`
-- table (shared/schema.ts is byte-locked for v24.2). Instead, a dedicated
-- side table keyed by company_id stores the currency, scoped by tenant_id for
-- isolation, mirroring the soft-delete invariant used elsewhere.
CREATE TABLE IF NOT EXISTS company_default_currency (
  company_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);
