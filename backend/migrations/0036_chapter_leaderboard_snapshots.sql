-- v19 Phase A — Chapter leaderboard snapshots.
--
-- Per-(chapter, period) aggregate snapshot of member activity scores. Computed
-- by `server/jobs/leaderboardRefresh.ts` on a 60-minute cadence in production,
-- skipped in test (NODE_ENV=test) so suites stay deterministic. On-demand
-- compute fires when the GET endpoint is hit with no existing snapshot.
--
-- Snapshot rows are UPSERT'd on (chapter_id, period, period_start) — the
-- refresh job overwrites the latest snapshot for the current period rather
-- than appending duplicates.
--
-- The `data` column is a JSON array of {user_id, score, rank, breakdown}
-- entries (top-50 by score). Score formula reference (server/jobs/
-- leaderboardRefresh.ts::computeLeaderboardSnapshot):
--
--    score = 1.0 * reputation_gained
--          + 3.0 * best_answers_accepted
--          + 2.0 * events_attended
--          + 0.5 * announcements_posted (admins only)
--          + 1.5 * resources_approved
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS chapter_leaderboard_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  period TEXT NOT NULL,                             -- 'weekly' | 'monthly' | 'all-time'
  period_start TEXT NOT NULL,                       -- ISO timestamp (inclusive)
  period_end TEXT NOT NULL,                         -- ISO timestamp (exclusive)
  data TEXT NOT NULL DEFAULT '[]',                  -- JSON array of {userId, score, rank, breakdown}
  generated_at TEXT NOT NULL,
  UNIQUE(chapter_id, period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_tenant   ON chapter_leaderboard_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_chapter  ON chapter_leaderboard_snapshots(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_period   ON chapter_leaderboard_snapshots(period);
CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_generated ON chapter_leaderboard_snapshots(generated_at);
