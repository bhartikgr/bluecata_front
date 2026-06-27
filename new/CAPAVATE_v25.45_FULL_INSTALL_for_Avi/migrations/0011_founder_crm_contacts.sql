-- Patch v12 Day 3 — Migration 0011: founder_crm_contacts
-- audit §3.11 — founder's view of investor pipeline
-- All operations idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS founder_crm_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  investor_id TEXT,
  name TEXT NOT NULL,
  firm_name TEXT,
  role TEXT,
  email TEXT,
  region TEXT,
  stage TEXT NOT NULL,
  ownership TEXT,
  soft_circle_history TEXT,
  tasks TEXT,
  thread_ids TEXT,
  ma_signals INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  notes_updated_at TEXT,
  series TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_founder_crm_contacts_company
  ON founder_crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_founder_crm_contacts_tenant
  ON founder_crm_contacts(tenant_id);
