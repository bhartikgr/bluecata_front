-- 0081_v25_48_email_templates.sql
-- v25.48 DATA-1 — DB-backed, admin-editable email templates.
-- ADDITIVE ONLY: new table. Mirrors connection.ts applyV2548Schema. Row seeding
-- of the canonical starter templates is performed DB-first by hydrateEmailStore
-- on boot (INSERT OR IGNORE by slug), so both a fresh DB and the live DB
-- self-seed and admin edits are never clobbered. Replaces the previous
-- in-memory const templates[] as the canonical source of truth.
CREATE TABLE IF NOT EXISTS email_templates (
  slug           TEXT PRIMARY KEY NOT NULL,
  id             TEXT,
  subject        TEXT NOT NULL,
  body_html      TEXT NOT NULL,
  body_text      TEXT NOT NULL,
  variables_json TEXT,
  category       TEXT,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);
