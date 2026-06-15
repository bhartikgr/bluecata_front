-- Patch v12 Day 3 — Migration 0013: pcrm_contacts + pcrm_notes + pcrm_tasks
-- audit §3.9 — Sprint 10 investor personal CRM (per-user pipeline)
-- All operations idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS pcrm_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  firm TEXT,
  email TEXT,
  linkedin TEXT,
  pipeline_stage TEXT NOT NULL,
  tags TEXT,
  lanes TEXT,
  company_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS pcrm_notes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  body TEXT NOT NULL,
  note_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS pcrm_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pcrm_contacts_owner ON pcrm_contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_pcrm_contacts_tenant ON pcrm_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pcrm_notes_contact ON pcrm_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_pcrm_tasks_contact ON pcrm_tasks(contact_id);
