-- v16 Fix 6 — Collective Waitlist
--
-- Honest "ship safely" persistence. With COLLECTIVE_ENABLED=0 (the Saturday
-- default), the existing /api/collective/{applications,nominations,promote}
-- endpoints return 503; users are routed to /api/collective/waitlist/*
-- which writes here. When chapter access opens, admins move waitlist rows
-- into the formal flow.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS collective_waitlist (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- investor_membership | founder_path_a | founder_path_b | cap_table_promote
  user_id      TEXT NOT NULL,
  company_id   TEXT,                  -- null for investor_membership
  payload      TEXT NOT NULL,         -- JSON dump of submitted form
  chapter_hint TEXT,
  status       TEXT NOT NULL DEFAULT 'waitlist',  -- waitlist | accepted | declined
  created_at   TEXT NOT NULL,
  reviewed_at  TEXT,
  reviewed_by  TEXT,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_collective_waitlist_tenant ON collective_waitlist(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collective_waitlist_status ON collective_waitlist(status);
CREATE INDEX IF NOT EXISTS idx_collective_waitlist_kind   ON collective_waitlist(kind);
CREATE INDEX IF NOT EXISTS idx_collective_waitlist_user   ON collective_waitlist(user_id);
