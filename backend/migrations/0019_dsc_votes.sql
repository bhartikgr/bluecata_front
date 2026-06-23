-- v16 Addendum B — DSC Votes foundation (hash-chained, audit-grade).
--
-- DATA-LAYER ONLY. There is NO publicly-exposed `POST /api/dsc/votes` route
-- in v16. The store (server/dscVoteStore.ts) is callable from server-side
-- code only. v17 will layer screening/scheduling/UI on top.
--
-- Idempotent: safe to re-run.
--
-- See addendum note in 0018_dsc_feedback.sql about numbering: the brief
-- named this 0016_*; we bumped to the next free sequential number.

CREATE TABLE IF NOT EXISTS dsc_votes (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  company_id      TEXT NOT NULL,
  round_id        TEXT,
  voter_user_id   TEXT NOT NULL,
  vote            TEXT NOT NULL,   -- approve | reject | conditional | abstain
  conditions      TEXT,             -- JSON array (for 'conditional' votes)
  notes           TEXT,
  prev_hash       TEXT,
  hash            TEXT NOT NULL,
  cast_at         TEXT NOT NULL,
  superseded_at   TEXT,             -- when voter changes their vote
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_dsc_votes_tenant   ON dsc_votes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsc_votes_company  ON dsc_votes(company_id);
CREATE INDEX IF NOT EXISTS idx_dsc_votes_voter    ON dsc_votes(voter_user_id);
CREATE INDEX IF NOT EXISTS idx_dsc_votes_company_active ON dsc_votes(company_id, superseded_at);
