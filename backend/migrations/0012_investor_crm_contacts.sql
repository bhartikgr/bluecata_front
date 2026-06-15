-- Patch v12 Day 3 — Migration 0012: investor_crm_contacts
-- audit §3.10 — investor's broader contact tracker (distinct from founderCrm)
-- All operations idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS investor_crm_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  investor_id TEXT NOT NULL,
  platform_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  affiliation TEXT,
  stage TEXT NOT NULL,
  tags TEXT,
  notes TEXT,
  note_log TEXT,
  tasks TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  company_id TEXT,
  company_name TEXT,
  founder_name TEXT,
  founder_email TEXT,
  sector TEXT,
  region TEXT,
  check_size_usd INTEGER,
  notes_updated_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_investor_crm_contacts_investor
  ON investor_crm_contacts(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_crm_contacts_tenant
  ON investor_crm_contacts(tenant_id);
