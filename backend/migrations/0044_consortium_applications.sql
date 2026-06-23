-- CP Phase B — consortium_applications (CP-001..CP-005).
-- Audit-grade: every state transition appends a chained row.
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS consortium_applications (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  expected_chapter_id TEXT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  organization_name TEXT NOT NULL,
  website TEXT,
  jurisdiction TEXT NOT NULL DEFAULT '',
  partner_type TEXT NOT NULL DEFAULT 'other',
  aum_range TEXT NOT NULL DEFAULT 'undisclosed',
  portfolio_company_count INTEGER NOT NULL DEFAULT 0,
  expected_chapter TEXT NOT NULL DEFAULT '',
  intro_message TEXT NOT NULL DEFAULT '',
  referred_by TEXT,
  source_ip TEXT,
  source_user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by_user_id TEXT,
  review_notes TEXT,
  provisioned_partner_id TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consortium_applications_status     ON consortium_applications(status);
CREATE INDEX IF NOT EXISTS idx_consortium_applications_chapter    ON consortium_applications(expected_chapter_id);
CREATE INDEX IF NOT EXISTS idx_consortium_applications_partner    ON consortium_applications(partner_type);
CREATE INDEX IF NOT EXISTS idx_consortium_applications_email      ON consortium_applications(contact_email);
CREATE INDEX IF NOT EXISTS idx_consortium_applications_created    ON consortium_applications(created_at);
