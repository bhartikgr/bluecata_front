-- 0109_collective_membership_deactivation_queue
-- W1 H6 (v26.2.0) — fail-closed membership deactivation.
--
-- When billing flips to cancelled/past_due, membership deactivation used to be
-- "best-effort": if collectiveMembershipStore.deactivate() threw, billing state
-- moved on while Collective access stayed OPEN. This durable queue records an
-- intent-to-deactivate BEFORE attempting it; the membership gate denies while an
-- unresolved row exists, so a deactivation failure can never leave access open.
-- Additive + idempotent. MIRRORED in server/db/migrations/ + self-healed on boot.

CREATE TABLE IF NOT EXISTS collective_membership_deactivation_queue (
  id TEXT PRIMARY KEY,
  billing_id TEXT,
  user_id TEXT NOT NULL,
  target_status TEXT NOT NULL CHECK (target_status IN ('cancelled', 'past_due')),
  source TEXT NOT NULL,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- At most one OPEN (unresolved) marker per (user, target_status).
CREATE UNIQUE INDEX IF NOT EXISTS uq_collective_deactivation_open_user_status
  ON collective_membership_deactivation_queue(user_id, target_status)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_collective_deactivation_next
  ON collective_membership_deactivation_queue(resolved_at, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_collective_deactivation_user
  ON collective_membership_deactivation_queue(user_id, resolved_at);
