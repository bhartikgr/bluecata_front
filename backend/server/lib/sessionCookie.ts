/**
 * Sprint 27 — Session cookie helpers.
 *
 * The Perplexity production sandbox proxy strips ANY request cookie whose name
 * doesn't start with `__Host-` to prevent cross-tenant leakage between
 * *.pplx.app sites. Default cookie names (cap_uid) silently stop working.
 *
 * We therefore set the session cookie as `__Host-cap_uid` (HTTPS + secure +
 * path "/"). For local dev (HTTP / 127.0.0.1) we ALSO accept the legacy
 * `cap_uid` name as a fallback so non-HTTPS dev sessions still work.
 *
 * One source of truth for cookie name + flags lives here.
 */
import type { Response, Request } from "express";

/** Production cookie name (prefixed) — proxy-safe in *.pplx.app sandbox. */
export const SESSION_COOKIE = "__Host-cap_uid";

/** Legacy cookie name — read-only fallback for HTTP dev sessions. */
export const LEGACY_SESSION_COOKIE = "cap_uid";

const isProductionHttps =
  process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIE === "1";

/**
 * BUG 014 fix v23.7 — persistent session lifetime.
 *
 * The session cookie was previously set with no `maxAge`/`expires`, which makes
 * it a *browser-session* cookie: it is dropped the moment the tab/window closes
 * (and, in the sandbox proxy, after the browsing context is recycled). Founders
 * reported being "logged out for no reason" — they were simply losing the
 * cookie whenever the browser session ended. We give the cookie an explicit
 * max-age so the session persists across restarts and idle periods until real
 * expiry/logout.
 *
 * v23.8 C3/E3 (BUG-014) — the lifetime is now a bounded 4 hours (14400s). A
 * shared or abandoned browser no longer keeps a founder authenticated
 * indefinitely; the founder re-authenticates after the window. Express's
 * `maxAge` is in milliseconds, but the emitted `Set-Cookie` header expresses
 * `Max-Age` in SECONDS, so 4h surfaces as `Max-Age=14400`.
 */
const SESSION_COOKIE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours == 14400s

/**
 * Set the session cookie. In production (HTTPS) we use the `__Host-` prefix
 * which requires `Secure`, `Path=/`, and no `Domain` attribute. In dev we
 * fall back to the plain cookie name so HTTP `127.0.0.1` still works.
 */
export function setSessionCookie(res: Response, value: string): void {
  if (isProductionHttps) {
    res.cookie(SESSION_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
  } else {
    res.cookie(LEGACY_SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
  }
}

/** Clear both cookie variants on logout. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/", secure: true, sameSite: "lax" });
  res.clearCookie(LEGACY_SESSION_COOKIE, { path: "/" });
}

/**
 * Read the session cookie from the request, accepting both the prefixed
 * production name and the legacy dev name. Falls back to x-user-id header
 * for the test harness.
 */
export function readSessionCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  return cookies[SESSION_COOKIE] ?? cookies[LEGACY_SESSION_COOKIE];
}
