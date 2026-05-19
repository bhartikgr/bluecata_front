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
  const userId = (req as any).user?.id || (req.headers["x-user-id"] as string | undefined) || "";
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

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
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
}

export const RateLimitConfig = { WINDOW_MS, READ_LIMIT, WRITE_LIMIT, AUTH_FAIL_LIMIT, AUTH_LOCKOUT_MS };
