-- CP Phase B — partner_organizations (CP-002).
CREATE TABLE IF NOT EXISTS partner_organizations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT '',
  partner_type TEXT NOT NULL DEFAULT 'other',
  aum_range TEXT NOT NULL DEFAULT 'undisclosed',
  primary_chapter_id TEXT,
  website TEXT,
  logo_url TEXT,
  banner_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  onboarding_state TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_orgs_tenant   ON partner_organizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_partner_orgs_chapter  ON partner_organizations(primary_chapter_id);
CREATE INDEX IF NOT EXISTS idx_partner_orgs_status   ON partner_organizations(status);
