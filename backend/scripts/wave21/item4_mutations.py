#!/usr/bin/env python3
"""WAVE 21 · ITEM 4 mutation matrix — durability must stay real."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RL = "server/lib/rateLimit.ts"
ST = "server/lib/rateLimitStore.ts"
MIG = "migrations/0173_wave21_durable_rate_limit.sql"

MUTATIONS = [
    # ---- the whole point: durability
    Mutation(
        "M1-restore-inmemory-auth", RL,
        "  return durableTick(key, limit, windowMs, now, /* failClosed */ true);",
        """  const g: any = globalThis as any;
  const m: Map<string, number[]> = (g.__w21m ||= new Map());
  let hits = (m.get(key) || []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) return { ok: false, remaining: 0, resetAt: hits[0]! + windowMs };
  hits.push(now); m.set(key, hits);
  return { ok: true, remaining: limit - hits.length, resetAt: now + windowMs };""",
        "the original defect: auth spray throttle back on a process-local Map",
    ),
    # M2 (original attempt) added a DELETE to _resetDurableRateLimitsForTests.
    # It was MISSED, and correctly so: that hook is test-only and clearing data
    # is its JOB. The mutation did not touch durability at all. That was a bad
    # mutation, not a coverage gap. Replaced with one that makes durability
    # genuinely fake — a per-process private database, which is precisely the
    # defect ITEM 4 removes, dressed up as a durable store.
    Mutation(
        "M2-per-process-private-db", ST,
        "  let db: any;\n  try {\n    db = rawDb();\n  } catch (e) {\n    return noteOutage(e);\n  }",
        "  let db: any;\n  try {\n    db = new (require(\"better-sqlite3\"))(\":memory:\");\n  } catch (e) {\n    return noteOutage(e);\n  }",
        "durability is fake: each process gets its own private database",
    ),
    Mutation(
        "M2b-lockout-read-skipped", ST,
        "    const row = s.getLock.get(key) as { locked_until: number } | undefined;\n    if (!row) return { locked: false };",
        "    const row = undefined as { locked_until: number } | undefined;\n    if (!row) return { locked: false };",
        "the durable lockout row is written but never read back",
    ),
    Mutation(
        "M3-lockout-not-persisted", RL,
        "    durableSetLockout(`${AUTH_FAILURE_KEY_PREFIX}${key}`, now + AUTH_LOCKOUT_MS, now);",
        "    void (now + AUTH_LOCKOUT_MS);",
        "5 strikes no longer records a durable lockout",
    ),
    # ---- semantics must not silently change
    Mutation(
        "M4-fixed-window-not-sliding", ST,
        "      const row = s.count.get(key, now - windowMs) as { n: number; oldest: number | null };",
        "      const row = s.count.get(key, Math.floor(now / windowMs) * windowMs) as { n: number; oldest: number | null };",
        "downgrades the exact sliding window to a cheaper fixed window (2x burst at the boundary)",
    ),
    Mutation(
        "M5-resetAt-fabricated", ST,
        "        return { ok: false, remaining: 0, resetAt: (row.oldest ?? now) + windowMs };",
        "        return { ok: false, remaining: 0, resetAt: now + windowMs };",
        "Retry-After is computed from the wrong timestamp",
    ),
    Mutation(
        "M6-off-by-one-limit", ST,
        "      if (row.n >= limit) {",
        "      if (row.n > limit) {",
        "one extra request slips past every quota",
    ),
    Mutation(
        "M7-all-keys-share-one-bucket", ST,
        "        WHERE bucket_key = ? AND hit_at > ?`,",
        "        WHERE (bucket_key = ? OR 1=1) AND hit_at > ?`,",
        "every key collapses into one global bucket",
    ),
    # ---- policy constants
    Mutation(
        "M8-auth-limit-raised", RL,
        "const AUTH_LOGIN_LIMIT = 10;",
        "const AUTH_LOGIN_LIMIT = 1000;",
        "a limit is quietly relaxed while 'moving storage'",
    ),
    Mutation(
        "M9-fail-limit-relaxed", RL,
        "const AUTH_FAIL_LIMIT = 5;",
        "const AUTH_FAIL_LIMIT = 50;",
        "the 5-strike lockout policy is changed under cover of the refactor",
    ),
    Mutation(
        "M10-collective-limit-drift", RL,
        "  write: 60,\n  read: 600,\n  sse: 30,",
        "  write: 60,\n  read: 6000,\n  sse: 30,",
        "collective read bucket relaxed 10x",
    ),
    # ---- availability policy
    Mutation(
        "M11-auth-fails-open", ST,
        "      ? { ok: false, remaining: 0, resetAt: now + windowMs, deniedByStoreOutage: true }\n      : { ok: true, remaining: limit, resetAt: now + windowMs, degraded: true };\n  }\n  try {",
        "      ? { ok: true, remaining: limit, resetAt: now + windowMs }\n      : { ok: true, remaining: limit, resetAt: now + windowMs, degraded: true };\n  }\n  try {",
        "a store outage silently disables the credential-spray throttle",
    ),
    Mutation(
        "M12-unknown-lockout-reads-unlocked", ST,
        "  if (!db) return { locked: true, unknown: true };",
        "  if (!db) return { locked: false };",
        "an unreadable lockout table reports every account as unlocked",
    ),
    Mutation(
        "M13-outage-reported-as-429", RL,
        '        error: "rate_limit_store_unavailable",\n        message: "Login is temporarily unavailable. Please try again shortly.",',
        '        error: "rate_limited",\n        message: "Too many login attempts. Wait a minute and try again.",',
        "a store outage is dressed up as a quota breach",
    ),
    # ---- schema provenance
    Mutation(
        "M14-schema-drifts-from-migration", MIG,
        "CREATE INDEX IF NOT EXISTS ix_rate_limit_hit_key_time",
        "CREATE INDEX IF NOT EXISTS ix_rate_limit_hit_keytime",
        "the canonical migration drifts from the inline bootstrap constant",
    ),
    Mutation(
        "M15-mirror-drift", "server/db/migrations/0173_wave21_durable_rate_limit.sql",
        "CREATE TABLE IF NOT EXISTS rate_limit_lockout (",
        "CREATE TABLE IF NOT EXISTS rate_limit_lockouts (",
        "the server/db/migrations mirror drifts from the canonical file",
    ),
]


if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave21/item4_durable_ratelimit_harness.ts"],
            MUTATIONS,
            "ITEM4",
        )
    )
