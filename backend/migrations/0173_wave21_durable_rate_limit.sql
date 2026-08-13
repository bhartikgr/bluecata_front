-- migrations/0173_wave21_durable_rate_limit.sql
-- WAVE 21 · ITEM 4 — rate-limit buckets move from PROCESS MEMORY onto DURABLE
-- DB ROWS. Owner ruling, verbatim: "No in-memory ANYWHERE. All dynamically db
-- driven."
--
-- WHAT THIS REPLACES
--   server/lib/rateLimit.ts (pre-WAVE-21):
--     :17  const buckets           = new Map<string, Bucket>();   -- general limiter
--     :18  const failures          = new Map<string, number[]>(); -- auth failure counter
--     :19  const lockouts          = new Map<string, number>();   -- auth lockout
--     :245 const authBuckets       = new Map<string, Bucket>();   -- login/signup spray
--     :391 const collectiveBuckets = new Map<string, Bucket>();   -- collective buckets
--
--   Every one of those is process-local. Consequences, in severity order:
--     * A RESTART RESETS EVERY QUOTA. An attacker who can provoke or simply
--       wait for a deploy/crash/rolling restart gets a fresh credential-spray
--       allowance. This is the security-relevant case: `authBuckets` keys the
--       login (10/min) and signup (5/hour) throttles, and `failures`/`lockouts`
--       hold the 5-strike 15-minute account lockout — an attacker at strike 4
--       is returned to strike 0 for free.
--     * MULTI-PROCESS DEPLOYMENTS MULTIPLY EVERY LIMIT by the worker count. The
--       file's own comments admitted this ("For multi-process production, swap
--       for Redis"; "Horizontal-scaling caveat: in-memory Map is per-process")
--       and then shipped anyway.
--     * The lockout is unauditable: nothing durable records that an account was
--       ever locked.
--
--   THE MECHANISM IS PRESERVED EXACTLY. This is still a sliding window over
--   individual hit timestamps, with identical limits and identical
--   `resetAt = oldestHitInWindow + windowMs` semantics. Only the STORAGE moves.
--   No limit changes: READ_LIMIT 60, WRITE_LIMIT 10, AUTH_LOGIN_LIMIT 10,
--   AUTH_SIGNUP_LIMIT 5, AUTH_FAIL_LIMIT 5, collective write/read/sse 60/600/30
--   are all untouched, and a test asserts each constant verbatim.
--
-- WHY ROW-PER-HIT AND NOT A FIXED-WINDOW COUNTER
--   A counter is cheaper but changes behaviour: a fixed window lets a caller
--   spend a full quota at the end of one window and another immediately at the
--   start of the next, i.e. 2x the limit across the boundary. Measured cost of
--   keeping the exact semantics (scripts/wave21/item4_latency_probe.ts, 20k
--   requests, 200 keys, this machine):
--     in-memory today            mean 0.72µs   p95  1.64µs
--     durable row-per-hit        mean 7.78µs   p95 10.31µs   (+7.05µs)
--     durable fixed-window       mean 3.04µs   p95  3.44µs   (+2.32µs)
--   +7µs per request against handlers that already run several SQLite queries
--   is not a hot-path concern, so the exact-semantics option was taken. The
--   measurement was made BEFORE the design was chosen, not to justify it after.
--
-- MIGRATION NUMBER — 0173. Verified against THIS tree on 2026-08-11, not
-- assumed: `ls migrations/*.sql | tail -1` and
-- `ls server/db/migrations/*.sql | tail -1` both end at
-- 0172_wave19_partner_invitation_seat_integrity.sql. 0152/0154/0155/0158 are
-- BURNT and are not reused. 0173 is the next free id in both directories.

-- ---------------------------------------------------------------------------
-- One row per admitted request. The sliding window is a range scan over
-- (bucket_key, hit_at); the covering index below is what makes that cheap.
--
-- No FK to users/tenants: a bucket key is frequently an unauthenticated IP, and
-- a rate limiter that can be broken by a referential-integrity failure is a
-- denial-of-service surface rather than a protection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_hit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key   TEXT    NOT NULL,
  hit_at       INTEGER NOT NULL          -- epoch ms
);

CREATE INDEX IF NOT EXISTS ix_rate_limit_hit_key_time
  ON rate_limit_hit (bucket_key, hit_at);

-- Prune scans by time across all keys.
CREATE INDEX IF NOT EXISTS ix_rate_limit_hit_time
  ON rate_limit_hit (hit_at);

-- ---------------------------------------------------------------------------
-- Durable auth lockouts. Previously `lockouts = new Map<string, number>()`,
-- which meant a locked account was silently unlocked by the next deploy.
--
-- `first_locked_at` / `lock_count` are kept because the in-memory version threw
-- away the fact that a lockout ever happened; repeated lockouts on one key are
-- exactly the signal an operator wants and it cost one column to retain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_lockout (
  lock_key        TEXT    PRIMARY KEY NOT NULL,
  locked_until    INTEGER NOT NULL,     -- epoch ms
  first_locked_at TEXT    NOT NULL,     -- ISO8601
  last_locked_at  TEXT    NOT NULL,     -- ISO8601
  lock_count      INTEGER NOT NULL DEFAULT 1 CHECK (lock_count > 0)
);

CREATE INDEX IF NOT EXISTS ix_rate_limit_lockout_until
  ON rate_limit_lockout (locked_until);
