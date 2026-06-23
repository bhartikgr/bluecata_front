-- v16 Addendum A — DSC Feedback persistence
--
-- Migrates server/dscFeedbackStore.ts from in-memory Map → DB-backed hybrid.
-- Closes audit F-coll-26. Idempotent: safe to re-run.
--
-- NOTE on migration numbering: the addendum brief named this 0015_*. By the
-- time v16 was authored, 0015_reports.sql and 0016_network_posts.sql already
-- existed. We bumped to the next free sequential number to avoid clobbering.
-- The v16 docs note this faithfully.

CREATE TABLE IF NOT EXISTS dsc_feedback (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  company_id         TEXT NOT NULL,
  submitter_user_id  TEXT NOT NULL,
  tier               TEXT NOT NULL,        -- watch | qualified | featured | priority
  score_json         TEXT,                  -- JSON: top/bottom dims, full rubric
  notes              TEXT,
  submitted_at       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  deleted_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_dsc_feedback_tenant   ON dsc_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsc_feedback_company  ON dsc_feedback(company_id);
CREATE INDEX IF NOT EXISTS idx_dsc_feedback_company_submitted ON dsc_feedback(company_id, submitted_at);
