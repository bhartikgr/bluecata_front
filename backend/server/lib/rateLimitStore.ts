/**
 * server/lib/rateLimitStore.ts — WAVE 21 · ITEM 4.
 *
 * DURABLE storage for every rate-limit bucket and auth lockout in
 * server/lib/rateLimit.ts. Replaces five process-local Maps:
 *
 *   buckets           general read/write limiter      (60/min, 10/min)
 *   authBuckets       login/signup spray throttles    (10/min, 5/hour)
 *   failures          the 5-strike auth failure count
 *   lockouts          the 15-minute auth lockout
 *   collectiveBuckets collective write/read/sse       (60, 600, 30 per min)
 *
 * Owner ruling, verbatim: "No in-memory ANYWHERE. All dynamically db driven."
 * Review A, ITEM 4: a rate limiter whose state dies with the process does not
 * limit anything an attacker is willing to wait one deploy for — and the
 * security-relevant instance is the credential-spray throttle.
 *
 * THE MECHANISM IS UNCHANGED. Still a sliding window over individual hit
 * timestamps, still `resetAt = oldestHitInWindow + windowMs`, still the same
 * numeric limits. Only the storage moved. See
 * migrations/0173_wave21_durable_rate_limit.sql for the full rationale and for
 * the latency measurements that justified keeping exact sliding-window
 * semantics rather than downgrading to a cheaper fixed-window counter.
 *
 * ---------------------------------------------------------------------------
 * AVAILABILITY POLICY WHEN THE STORE IS UNREACHABLE
 *
 * A rate limiter has two failure directions and they are not symmetric, so
 * this module does NOT apply one blanket rule:
 *
 *   AUTH surfaces (login, signup, failure counting, lockout) FAIL CLOSED.
 *     Denying logins while the database is down costs nothing real — this
 *     application cannot authenticate anyone without the `users` table anyway
 *     — and failing open here is precisely the credential-spray window the
 *     review is about. `deniedByStoreOutage` is set on the result so the
 *     caller can return an honest 503-shaped message rather than pretending
 *     the user hit a quota.
 *
 *   NON-AUTH surfaces (general read/write, collective buckets) DEGRADE, and
 *     say so. Returning 429 for every read because the limiter's own store is
 *     unavailable converts a storage blip into a total outage, which is a
 *     worse security outcome than a temporarily unenforced read quota. The
 *     degraded path is loudly logged once, is reported by
 *     `rateLimitStoreHealth()` for monitoring, and is NOT a silent fallback to
 *     the very in-memory design this item removes: it admits the request and
 *     records that enforcement was skipped.
 *
 * This asymmetry is a deliberate judgement and is called out in
 * build_log/WAVE21_REPORT.md as an assumption for the owner to confirm.
 * ---------------------------------------------------------------------------
 */
import { rawDb, getDbDriver } from "../db/connection";
import { RATE_LIMIT_STORE_SQL } from "./rateLimitStoreSchema";

export { RATE_LIMIT_STORE_SQL };

export const RATE_LIMIT_HIT_TABLE = "rate_limit_hit";
export const RATE_LIMIT_LOCKOUT_TABLE = "rate_limit_lockout";

/** Rows older than every window in the system are dead weight. The longest
 *  window is the signup throttle at 1 hour; keep a generous margin. */
const PRUNE_RETENTION_MS = 2 * 60 * 60 * 1000;
/** Prune is amortised across requests instead of running on a timer, so there
 *  is no background handle to leak in tests or in a serverless runtime. */
const PRUNE_EVERY_N_CALLS = 500;

export type TickResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  /** True when the request was refused because the durable store is
   *  unavailable, not because a quota was exhausted. Auth surfaces only. */
  deniedByStoreOutage?: boolean;
  /** True when enforcement was skipped because the store is unavailable.
   *  Non-auth surfaces only. Never silently true — see rateLimitStoreHealth. */
  degraded?: boolean;
};

let handle: any = null;
let bootstrapped = false;
let outageLogged = false;
let callCount = 0;
let lastOutage: { at: string; message: string } | null = null;

function noteOutage(e: unknown): null {
  const message = e instanceof Error ? e.message : String(e);
  lastOutage = { at: new Date().toISOString(), message };
  if (!outageLogged) {
    outageLogged = true;
    // eslint-disable-next-line no-console
    console.error(
      `[rateLimitStore] SECURITY: the durable rate-limit store is unavailable (${message}). ` +
        `Auth throttles now FAIL CLOSED; non-auth quotas are NOT being enforced. ` +
        `See server/lib/rateLimitStore.ts (availability policy).`,
    );
  }
  return null;
}

/**
 * The durable handle, bootstrapping the schema on first use.
 *
 * `rawDb()` throws unconditionally under Postgres, which is the same
 * constraint feeSettlementAuthority.ts works under. Returning null routes the
 * caller into the availability policy above rather than throwing into an
 * Express middleware.
 */
function store(): any {
  if (forcedOutage) return noteOutage(forcedOutage);
  if (handle) return handle;
  if (getDbDriver() === "postgres") {
    return noteOutage(new Error("durable rate limiting is SQLite-only in this tree"));
  }
  let db: any;
  try {
    db = rawDb();
  } catch (e) {
    return noteOutage(e);
  }
  if (!db) return noteOutage(new Error("rawDb() returned no handle"));
  if (!bootstrapped) {
    try {
      // Executes the canonical migration text verbatim; every statement is
      // CREATE ... IF NOT EXISTS, so this is safe on a migrated database.
      db.exec(RATE_LIMIT_STORE_SQL);
      bootstrapped = true;
    } catch (e) {
      return noteOutage(e);
    }
  }
  handle = db;
  outageLogged = false;
  return handle;
}

type Stmts = {
  count: any; insert: any; prune: any;
  getLock: any; upsertLock: any; delLock: any; delHits: any;
};
let stmts: Stmts | null = null;
function prepared(db: any): Stmts {
  if (stmts) return stmts;
  stmts = {
    count: db.prepare(
      `SELECT count(*) AS n, min(hit_at) AS oldest FROM ${RATE_LIMIT_HIT_TABLE}
        WHERE bucket_key = ? AND hit_at > ?`,
    ),
    insert: db.prepare(`INSERT INTO ${RATE_LIMIT_HIT_TABLE} (bucket_key, hit_at) VALUES (?, ?)`),
    prune: db.prepare(`DELETE FROM ${RATE_LIMIT_HIT_TABLE} WHERE hit_at < ?`),
    getLock: db.prepare(`SELECT locked_until FROM ${RATE_LIMIT_LOCKOUT_TABLE} WHERE lock_key = ?`),
    upsertLock: db.prepare(
      `INSERT INTO ${RATE_LIMIT_LOCKOUT_TABLE}
         (lock_key, locked_until, first_locked_at, last_locked_at, lock_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(lock_key) DO UPDATE SET
         locked_until   = excluded.locked_until,
         last_locked_at = excluded.last_locked_at,
         lock_count     = ${RATE_LIMIT_LOCKOUT_TABLE}.lock_count + 1`,
    ),
    delLock: db.prepare(`DELETE FROM ${RATE_LIMIT_LOCKOUT_TABLE} WHERE lock_key = ?`),
    delHits: db.prepare(`DELETE FROM ${RATE_LIMIT_HIT_TABLE} WHERE bucket_key = ?`),
  };
  return stmts;
}

function maybePrune(db: any, now: number): void {
  if (++callCount % PRUNE_EVERY_N_CALLS !== 0) return;
  try {
    prepared(db).prune.run(now - PRUNE_RETENTION_MS);
  } catch {
    /* pruning is housekeeping; never let it fail a request */
  }
}

/**
 * Consume one slot from a durable sliding window.
 *
 * `failClosed` selects the availability policy for this call site (see the
 * module header). It is a required argument rather than an option with a
 * default, so every call site has to state which kind of surface it is.
 */
export function durableTick(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  failClosed: boolean,
): TickResult {
  const db = store();
  if (!db) {
    return failClosed
      ? { ok: false, remaining: 0, resetAt: now + windowMs, deniedByStoreOutage: true }
      : { ok: true, remaining: limit, resetAt: now + windowMs, degraded: true };
  }
  try {
    const s = prepared(db);
    // better-sqlite3 is synchronous, so a transaction here makes the
    // count-then-insert atomic against any other statement on this handle.
    const run = db.transaction((): TickResult => {
      const row = s.count.get(key, now - windowMs) as { n: number; oldest: number | null };
      if (row.n >= limit) {
        return { ok: false, remaining: 0, resetAt: (row.oldest ?? now) + windowMs };
      }
      s.insert.run(key, now);
      return { ok: true, remaining: limit - (row.n + 1), resetAt: now + windowMs };
    });
    const out = run();
    maybePrune(db, now);
    return out;
  } catch (e) {
    noteOutage(e);
    return failClosed
      ? { ok: false, remaining: 0, resetAt: now + windowMs, deniedByStoreOutage: true }
      : { ok: true, remaining: limit, resetAt: now + windowMs, degraded: true };
  }
}

/** Record one auth failure and report how many are inside the window. */
export function durableRecordFailure(key: string, windowMs: number, now: number): number {
  const db = store();
  if (!db) return 0;
  try {
    const s = prepared(db);
    s.insert.run(key, now);
    const row = s.count.get(key, now - windowMs) as { n: number };
    return row.n;
  } catch (e) {
    noteOutage(e);
    return 0;
  }
}

export function durableSetLockout(key: string, until: number, now: number): void {
  const db = store();
  if (!db) return;
  try {
    const iso = new Date(now).toISOString();
    prepared(db).upsertLock.run(key, until, iso, iso);
  } catch (e) {
    noteOutage(e);
  }
}

/**
 * Read a durable lockout.
 *
 * FAIL CLOSED on outage: `unknown: true` means "we cannot prove this key is
 * unlocked". The caller treats that as locked. Reporting "not locked" because
 * the database is unreachable is the exact failure the durable move exists to
 * prevent.
 */
export function durableGetLockout(key: string, now: number): { locked: boolean; until?: number; unknown?: boolean } {
  const db = store();
  if (!db) return { locked: true, unknown: true };
  try {
    const s = prepared(db);
    const row = s.getLock.get(key) as { locked_until: number } | undefined;
    if (!row) return { locked: false };
    if (row.locked_until < now) {
      // Expired: clear both the lock and the failure history it was built from,
      // matching the previous in-memory `isLockedOut` behaviour exactly.
      s.delLock.run(key);
      s.delHits.run(key);
      return { locked: false };
    }
    return { locked: true, until: row.locked_until };
  } catch (e) {
    noteOutage(e);
    return { locked: true, unknown: true };
  }
}

export function durableClearFailures(key: string): void {
  const db = store();
  if (!db) return;
  try {
    const s = prepared(db);
    s.delHits.run(key);
    s.delLock.run(key);
  } catch (e) {
    noteOutage(e);
  }
}

/** Observability for the availability policy. Never let the degraded path be
 *  silent — a limiter that is not limiting must be visible. */
export function rateLimitStoreHealth(): { durable: boolean; lastOutage: { at: string; message: string } | null } {
  return { durable: !!store(), lastOutage };
}

/** Test hook: force the store into its unavailable state so the availability
 *  policy can be exercised for real, not merely grepped for. */
let forcedOutage: Error | null = null;
export function _forceStoreOutageForTests(e: Error | null): void {
  forcedOutage = e;
  handle = null;
  stmts = null;
}

/** Read-only handle for diagnostic snapshots (test helpers only). Returns null
 *  when the store is unavailable rather than throwing into a caller. */
export function durableSnapshotHandle(): any {
  return store();
}

/** Test/diagnostic hook. Drops every durable bucket and lockout row. */
export function _resetDurableRateLimitsForTests(): void {
  forcedOutage = null;
  handle = null;
  stmts = null;
  bootstrapped = false;
  outageLogged = false;
  lastOutage = null;
  callCount = 0;
  const db = store();
  if (!db) return;
  try {
    db.exec(`DELETE FROM ${RATE_LIMIT_HIT_TABLE}; DELETE FROM ${RATE_LIMIT_LOCKOUT_TABLE};`);
  } catch {
    /* table may not exist yet */
  }
}
