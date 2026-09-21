-- 0236_company_taxonomy.sql — slide13b WAVE D (company-sector taxonomy → DB).
--
-- DIALECT: SQLite. This migration is written and verified against the SQLite
-- runtime the live installation reports (GET /api/db/status → driver:"sqlite").
-- The PostgreSQL tree is NOT covered by this wave and no PG support is claimed;
-- the server-side bootstrap (server/lib/applyCompanyTaxonomySchema.ts) refuses
-- any non-SQLite dialect with UNSUPPORTED_DB_DIALECT rather than guessing.
--
-- WHAT
--   A GENERIC taxonomy table keyed by (namespace, value). The first and only
--   namespace this wave seeds is `company_sector`, populated with the 45
--   strings that `COLLECTIVE_SECTORS_45` (shared/schema.ts) has shipped as a
--   hardcoded client array. After this migration the DATABASE is canonical for
--   company sectors; the constant is retained ONLY as the seed/test oracle.
--
--   * value  — the stored, IMMUTABLE identifier written into company/mandate
--              rows (companies.sector, application sectors[], SPV wizard
--              sectors[]). Seeded value == label so every historical row that
--              already holds e.g. 'Fintech' resolves without a data rewrite.
--   * label  — the EDITABLE display string. Renaming a label never touches the
--              stored value on any row.
--   * active — 1 = offered for new selections; 0 = retired. Retired values stay
--              resolvable for rows that already hold them (retire, never delete).
--
-- NOT IN SCOPE (explicitly): INDUSTRY_OPTIONS (48, Company profile "Industry")
-- and COLLECTIVE_STAGES are NOT migrated. partner_sectors / partner_subsectors
-- (migration 0149, partner classification) are a DIFFERENT taxonomy and are
-- not touched or reused.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so the
-- self-heal bootstrap may re-run this file against a database where an admin
-- has already edited labels or retired terms — those edits survive.

CREATE TABLE IF NOT EXISTS taxonomy_terms (
  namespace   TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  updated_at  TEXT    NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  PRIMARY KEY (namespace, value)
);

-- Shape assertion: EXACTLY the seven contract columns (no extras), every one
-- NOT NULL, and the composite PRIMARY KEY in the order (namespace, value)
-- (pk ordinals 1 and 2 → SUM 3). A pre-existing table that only shares the
-- column NAMES fails here and aborts the script (CHECK (ok = 1)).
CREATE TEMP TABLE _mig0236_shape_taxonomy_terms (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _mig0236_shape_taxonomy_terms (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_info('taxonomy_terms')) = 7
  AND (SELECT COUNT(*) FROM pragma_table_info('taxonomy_terms')
       WHERE name IN ('namespace', 'value', 'label', 'active', 'sort_order', 'created_at', 'updated_at')
         AND "notnull" = 1) = 7
  AND (SELECT COALESCE(SUM(pk), 0) FROM pragma_table_info('taxonomy_terms')) = 3
  AND (SELECT pk FROM pragma_table_info('taxonomy_terms') WHERE name = 'namespace') = 1
  AND (SELECT pk FROM pragma_table_info('taxonomy_terms') WHERE name = 'value') = 2
THEN 1 ELSE 0 END;
DROP TABLE _mig0236_shape_taxonomy_terms;

-- Labels must be unique per namespace CASE-INSENSITIVELY ("Fintech" vs
-- "FINTECH" is one term, not two). Enforced in the database, not only in the
-- store, so a bypassing writer cannot create the duplicate either.
CREATE UNIQUE INDEX IF NOT EXISTS ux_taxonomy_terms_ns_label_nocase
  ON taxonomy_terms(namespace, label COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_ns_active
  ON taxonomy_terms(namespace, active);

-- ═════════════════════════════════════════════════════════════════════════
-- SEED — company_sector, exactly the 45 COLLECTIVE_SECTORS_45 strings,
-- value == label, original array order preserved in sort_order (the READ
-- path orders alphabetically; sort_order is provenance only).
-- ═════════════════════════════════════════════════════════════════════════
INSERT INTO taxonomy_terms (namespace, value, label, active, sort_order, created_at, updated_at) VALUES
  ('company_sector', 'Fintech',                  'Fintech',                  1,  1, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Insurtech',                'Insurtech',                1,  2, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Regtech',                  'Regtech',                  1,  3, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Wealthtech',               'Wealthtech',               1,  4, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Crypto / Web3',            'Crypto / Web3',            1,  5, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Climate Tech',             'Climate Tech',             1,  6, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Energy',                   'Energy',                   1,  7, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Agriculture & Food',       'Agriculture & Food',       1,  8, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Mobility & Transport',     'Mobility & Transport',     1,  9, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Aerospace & Defense',      'Aerospace & Defense',      1, 10, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Healthtech',               'Healthtech',               1, 11, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Biotech',                  'Biotech',                  1, 12, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Medtech',                  'Medtech',                  1, 13, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Pharma',                   'Pharma',                   1, 14, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Mental Health',            'Mental Health',            1, 15, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Digital Health',           'Digital Health',           1, 16, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'AI / ML Platform',         'AI / ML Platform',         1, 17, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'AI Applications',          'AI Applications',          1, 18, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Robotics',                 'Robotics',                 1, 19, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Computer Vision',          'Computer Vision',          1, 20, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Cybersecurity',            'Cybersecurity',            1, 21, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Privacy & Identity',       'Privacy & Identity',       1, 22, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Developer Tools',          'Developer Tools',          1, 23, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Cloud Infra',              'Cloud Infra',              1, 24, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Data Infra',               'Data Infra',               1, 25, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'DevOps & SRE',             'DevOps & SRE',             1, 26, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Edtech',                   'Edtech',                   1, 27, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Future of Work',           'Future of Work',           1, 28, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'HRtech',                   'HRtech',                   1, 29, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Legal Tech',               'Legal Tech',               1, 30, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Marketing Tech',           'Marketing Tech',           1, 31, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Sales Tech',               'Sales Tech',               1, 32, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Customer Support',         'Customer Support',         1, 33, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Real Estate',              'Real Estate',              1, 34, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Construction',             'Construction',             1, 35, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Manufacturing',            'Manufacturing',            1, 36, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Industrial Automation',    'Industrial Automation',    1, 37, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Logistics & Supply Chain', 'Logistics & Supply Chain', 1, 38, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Retail',                   'Retail',                   1, 39, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'E-commerce',               'E-commerce',               1, 40, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Consumer',                 'Consumer',                 1, 41, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Gaming',                   'Gaming',                   1, 42, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Media & Entertainment',    'Media & Entertainment',    1, 43, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Sports',                   'Sports',                   1, 44, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
  ('company_sector', 'Travel & Hospitality',     'Travel & Hospitality',     1, 45, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z')
ON CONFLICT (namespace, value) DO NOTHING;
