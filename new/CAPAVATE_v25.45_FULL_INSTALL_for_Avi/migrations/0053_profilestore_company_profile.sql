-- v24.2 Bug 6 — durable storage for the rich profileStore CompanyProfile
-- (Sprint-8 production-shape profile edited via PATCH /api/companies/:id/profile).
-- Distinct from the hash-chained company_profile_extended table owned by
-- companyProfileStore; this stores the full client-shaped JSON so a process
-- restart re-hydrates the founder's saved profile (sector, contact, legal, …).
CREATE TABLE IF NOT EXISTS profilestore_company_profile (
  company_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);
