-- v17 Phase B — founderCollectiveApply Path A (investor-vouched nominations).
-- Idempotent.

CREATE TABLE IF NOT EXISTS founder_collective_nominations (
  id                     TEXT PRIMARY KEY NOT NULL,
  tenant_id              TEXT NOT NULL,
  chapter_id             TEXT NOT NULL,
  company_id             TEXT NOT NULL,
  founder_id             TEXT NOT NULL,
  vouching_investor_id   TEXT NOT NULL,
  pitch_summary          TEXT NOT NULL,
  deck_link              TEXT,
  supplementary_notes    TEXT,
  asks                   TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending_vouch',
  submitted_at           TEXT NOT NULL,
  vouched_at             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT,
  deleted_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_fcn_tenant  ON founder_collective_nominations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fcn_chapter ON founder_collective_nominations(chapter_id);
CREATE INDEX IF NOT EXISTS idx_fcn_company ON founder_collective_nominations(company_id);
CREATE INDEX IF NOT EXISTS idx_fcn_founder ON founder_collective_nominations(founder_id);
CREATE INDEX IF NOT EXISTS idx_fcn_status  ON founder_collective_nominations(status);

-- v17 Phase B — founderCollectiveApply Path B (direct applications).
CREATE TABLE IF NOT EXISTS founder_collective_applications (
  id                     TEXT PRIMARY KEY NOT NULL,
  tenant_id              TEXT NOT NULL,
  chapter_id             TEXT NOT NULL,
  company_id             TEXT NOT NULL,
  founder_id             TEXT NOT NULL,
  pitch_deck_filename    TEXT NOT NULL,
  traction_mrr           INTEGER NOT NULL DEFAULT 0,
  traction_users         INTEGER NOT NULL DEFAULT 0,
  traction_growth_pct    INTEGER NOT NULL DEFAULT 0,
  asks                   TEXT NOT NULL,
  references_text        TEXT NOT NULL DEFAULT '',
  cover_letter           TEXT NOT NULL,
  fee_acknowledged       INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'submitted',
  submitted_at           TEXT NOT NULL,
  reviewed_at            TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT,
  deleted_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_fca_tenant  ON founder_collective_applications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fca_chapter ON founder_collective_applications(chapter_id);
CREATE INDEX IF NOT EXISTS idx_fca_company ON founder_collective_applications(company_id);
CREATE INDEX IF NOT EXISTS idx_fca_founder ON founder_collective_applications(founder_id);
CREATE INDEX IF NOT EXISTS idx_fca_status  ON founder_collective_applications(status);
