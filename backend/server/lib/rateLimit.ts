/**
 * Sprint 17 D2 — sliding-window rate limiter.
 *
 * Per-key (user-id when authenticated, otherwise client IP) per-route bucket.
 *   - Reads:  60 / minute
 *   - Writes: 10 / minute
 *   - Auth attempts: 5 failures → 15-minute lockout
 *
 * Pure in-memory; safe against async bursts (no shared mutable Map writes
 * between requests because Node is single-threaded). For multi-process
 * production, swap for Redis sorted-sets — same API.
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();
const failures = new Map<string, number[]>();
const lockouts = new Map<string, number>();

const WINDOW_MS = 60_000;
const READ_LIMIT = 60;
const WRITE_LIMIT = 10;
const AUTH_FAIL_LIMIT = 5;
const AUTH_LOCKOUT_MS = 15 * 60 * 1000;

function clientKey(req: Request): string {
  const userId = (req as any).user?.id || (req as any).userContext?.userId || "";
  if (userId) return `u:${userId}`;
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return `ip:${fwd || req.ip || "unknown"}`;
}

function tick(key: string, limit: number, now: number): { ok: boolean; remaining: number; resetAt: number } {
  let bucket = buckets.get(key);
  if (!bucket) { bucket = { hits: [] }; buckets.set(key, bucket); }
  // Drop expired
  const cutoff = now - WINDOW_MS;
  bucket.hits = bucket.hits.filter(t => t > cutoff);
  if (bucket.hits.length >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.hits[0]! + WINDOW_MS };
  }
  bucket.hits.push(now);
  return { ok: true, remaining: limit - bucket.hits.length, resetAt: now + WINDOW_MS };
}

/**
 * CP-038 — paths that are exempt from ALL rate limiters (main +
 * collective). Healthchecks and liveness probes must never 429, or load
 * balancers will start pulling pods out of rotation under burst load.
 */
export const RATE_LIMIT_BYPASS_PATHS: ReadonlySet<string> = new Set<string>([
  "/api/health",
  "/api/healthz",
]);

function isBypassed(req: Request): boolean {
  const fullPath = (req as any).originalUrl || req.path;
  // Compare both the original (mount-prefixed) URL and the local path so we
  // catch the route whether or not the limiter is mounted at a prefix.
  const localBypass = RATE_LIMIT_BYPASS_PATHS.has(req.path);
  if (localBypass) return true;
  if (typeof fullPath === "string") {
    const stripped = fullPath.split("?")[0];
    if (RATE_LIMIT_BYPASS_PATHS.has(stripped)) return true;
  }
  return false;
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isBypassed(req)) return next();
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  // Per-route bucket
  const route = req.path.replace(/\d+/g, ":id"); // collapse path numerics
  const key = `${clientKey(req)}:${req.method}:${route}`;
  const r = tick(key, limit, Date.now());
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) return res.status(429).json({ error: "rate_limited", retryAfterMs: r.resetAt - Date.now() });
  next();
}

/** Auth-specific limiter: 5 fails in 15 min → lockout. */
export function recordAuthFailure(key: string): void {
  const now = Date.now();
  const arr = failures.get(key) || [];
  const cutoff = now - AUTH_LOCKOUT_MS;
  const fresh = arr.filter(t => t > cutoff);
  fresh.push(now);
  failures.set(key, fresh);
  if (fresh.length >= AUTH_FAIL_LIMIT) {
    lockouts.set(key, now + AUTH_LOCKOUT_MS);
  }
}

export function isLockedOut(key: string): { locked: boolean; until?: number } {
  const t = lockouts.get(key);
  if (!t) return { locked: false };
  if (t < Date.now()) { lockouts.delete(key); failures.delete(key); return { locked: false }; }
  return { locked: true, until: t };
}

export function clearAuthFailures(key: string): void {
  failures.delete(key);
  lockouts.delete(key);
}

/** For tests. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
  failures.clear();
  lockouts.clear();
  collectiveBuckets.clear();
}

export const RateLimitConfig = { WINDOW_MS, READ_LIMIT, WRITE_LIMIT, AUTH_FAIL_LIMIT, AUTH_LOCKOUT_MS };

/* ============================================================
 * v19 Phase C — Collective bucket rate limits.
 *
 * Independent sliding-window per (user, bucket). Buckets:
 *   - write  (POST/PATCH/DELETE) : 60/min/user
 *   - read   (GET/HEAD/OPTIONS)  : 600/min/user
 *   - sse    (SSE connect)       : 30/min/user
 *
 * Applied via middleware to /api/collective/*, /api/partner/*,
 * /api/messages/*. Independent state from the existing `buckets` map
 * so the older /api/auth/secure limiter is unaffected.
 *
 * Horizontal-scaling caveat: in-memory Map is per-process. Multi-instance
 * deployments must back this with Redis (or a sticky-session LB).
 * ============================================================ */
const collectiveBuckets = new Map<string, Bucket>();

export type CollectiveBucket = "write" | "read" | "sse";

export const CollectiveBucketLimits: Record<CollectiveBucket, number> = {
  write: 60,
  read: 600,
  sse: 30,
};

function collectiveTick(
  key: string,
  limit: number,
  now: number,
): { ok: boolean; remaining: number; resetAt: number } {
  let bucket = collectiveBuckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    collectiveBuckets.set(key, bucket);
  }
  const cutoff = now - WINDOW_MS;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  if (bucket.hits.length >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.hits[0]! + WINDOW_MS };
  }
  bucket.hits.push(now);
  return { ok: true, remaining: limit - bucket.hits.length, resetAt: now + WINDOW_MS };
}

function pickBucket(req: Request): CollectiveBucket {
  // SSE connect endpoint is `/api/collective/sse/*` (long-lived).
  // Use originalUrl because `app.use("/api/collective", ...)` strips the
  // prefix in `req.path` (so `/sse/feed` is the local view).
  const fullPath = (req as any).originalUrl || req.path;
  if (
    fullPath.includes("/sse") ||
    req.path.startsWith("/sse") ||
    req.path.endsWith("/sse")
  ) {
    return "sse";
  }
  const isWrite = !(["GET", "HEAD", "OPTIONS"] as string[]).includes(req.method);
  return isWrite ? "write" : "read";
}

/**
 * Per-(user, bucket) sliding-window limiter. Use as Express middleware on
 * route mount points: `app.use("/api/collective", collectiveRateLimit);`.
 */
export function collectiveRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isBypassed(req)) {
    next();
    return;
  }
  const bucket = pickBucket(req);
  const limit = CollectiveBucketLimits[bucket];
  const key = `${clientKey(req)}:cb:${bucket}`;
  const r = collectiveTick(key, limit, Date.now());
  res.setHeader("X-RateLimit-Bucket", bucket);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt / 1000)));
  if (!r.ok) {
    res.status(429).json({
      error: "rate_limited",
      bucket,
      retryAfterMs: r.resetAt - Date.now(),
    });
    return;
  }
  next();
}

/** Test helper exposing collective bucket state (read-only snapshot). */
export function _collectiveBucketSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  collectiveBuckets.forEach((b, k) => {
    out[k] = b.hits.length;
  });
  return out;
}
