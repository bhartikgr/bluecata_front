-- v17 Phase C — Accept/decline state machine + cascading round-close + DSC quorum.
--
-- Idempotent. Adds:
--   1. chapters.dsc_quorum_pct (per-chapter DSC quorum percentage; default 50)
--   2. investor_nominations.status / decline_reason / decided_at / decided_by / round_id
--      (state machine: 'pending' | 'accepted' | 'declined' | 'lapsed')
--
-- These columns are additive and nullable (except status, which defaults to
-- 'pending' so existing rows remain in the legacy default state). Every ALTER
-- is wrapped in a try/catch at the application level (server/db/connection.ts
-- applyV12AdditiveAlters); SQLite is happy with "duplicate column" raised on
-- re-run. Postgres' "column already exists" error is similarly swallowed.

-- chapters: per-chapter DSC quorum percentage
ALTER TABLE chapters ADD COLUMN dsc_quorum_pct INTEGER NOT NULL DEFAULT 50;

-- investor_nominations: accept/decline state machine
ALTER TABLE investor_nominations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE investor_nominations ADD COLUMN decline_reason TEXT;
ALTER TABLE investor_nominations ADD COLUMN decided_at TEXT;
ALTER TABLE investor_nominations ADD COLUMN decided_by TEXT;
ALTER TABLE investor_nominations ADD COLUMN round_id TEXT;

-- Hot indices for the new endpoints + sweeper.
CREATE INDEX IF NOT EXISTS idx_invnom_status ON investor_nominations(status);
CREATE INDEX IF NOT EXISTS idx_invnom_round ON investor_nominations(round_id);
