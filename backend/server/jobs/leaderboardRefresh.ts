/**
 * server/jobs/leaderboardRefresh.ts — v19 Phase A.
 *
 * Thin re-export façade so callers (index.ts, tests) can import the
 * leaderboard refresh primitives from a stable jobs/ path. The actual
 * timer + tick logic lives in `server/chapterLeaderboardStore.ts` to
 * keep the formula, query helpers, and persistence in one place.
 *
 * The 60-minute setInterval is gated by NODE_ENV === "production" so
 * test suites and dev `vitest` runs stay deterministic.
 */

export {
  startLeaderboardRefreshJob,
  stopLeaderboardRefreshJob,
  refreshChapterLeaderboard,
  computeLeaderboardSnapshot,
  periodBounds,
} from "../chapterLeaderboardStore";
