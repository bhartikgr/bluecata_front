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
import * as crypto from "node:crypto";
import { SESSION_COOKIE_SECRET } from "./auth";

/** Production cookie name (prefixed) — proxy-safe in *.pplx.app sandbox. */
export const SESSION_COOKIE = "__Host-cap_uid";

/** Legacy cookie name — read-only fallback for HTTP dev sessions. */
export const LEGACY_SESSION_COOKIE = "cap_uid";

// v25.0 fix: allow the test harness to explicitly opt OUT of the Secure/__Host-
// cookie path when running production builds against http://127.0.0.1:5000. Without
// this, the production build sets `__Host-cap_uid; Secure` which any browser (incl.
// Playwright) refuses to store on HTTP origins — every DOM test then hits 401 on
// API fallbacks. ALLOW_INSECURE_COOKIE=1 forces the legacy `cap_uid` (no Secure).
// Production deployments behind HTTPS leave this unset and continue to receive
// the hardened __Host- cookie automatically.
const isProductionHttps =
  (process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIE === "1") &&
  process.env.ALLOW_INSECURE_COOKIE !== "1";

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
/* v25.17 Lane C NC1 — cookie value is now an HMAC-signed envelope, not the
   raw userId. Format: <userIdBase64Url>.<issuedAtSec>.<HMAC-SHA256>. Anyone
   who guessed "u_admin" before would land on the admin persona; that path
   is closed because the HMAC requires the server secret.

   Cookies issued before this fix have a different shape (raw userId). To
   stay backward-compatible for already-logged-in sessions, readSessionCookie
   accepts both shapes:
     1. If the cookie contains two dots and the HMAC verifies → return userId.
     2. Else → treat the entire cookie as the legacy raw userId (transitional).
   The legacy fallback can be removed in a follow-up wave once all sessions
   have rotated. */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Build a signed cookie body that encodes the userId + issuedAt. */
export function signSessionValue(userId: string): string {
  const iss = Math.floor(Date.now() / 1000);
  const uidEnc = b64url(Buffer.from(userId, "utf8"));
  const head = `${uidEnc}.${iss}`;
  const mac = b64url(crypto.createHmac("sha256", SESSION_COOKIE_SECRET).update(head).digest());
  return `${head}.${mac}`;
}

/** Verify a signed cookie body and return the userId, or null if invalid/expired. */
export function verifySessionValue(value: string, maxAgeSec: number = SESSION_COOKIE_MAX_AGE_MS / 1000): string | null {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [uidEnc, issStr, mac] = parts;
  const head = `${uidEnc}.${issStr}`;
  const expected = b64url(crypto.createHmac("sha256", SESSION_COOKIE_SECRET).update(head).digest());
  const a = Buffer.from(mac);
  const e = Buffer.from(expected);
  if (a.length !== e.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, e)) return null;
  } catch {
    return null;
  }
  const iss = Number(issStr);
  if (!Number.isFinite(iss)) return null;
  if (Math.floor(Date.now() / 1000) - iss > maxAgeSec) return null;
  try {
    const userId = b64urlDecode(uidEnc).toString("utf8");
    if (!userId) return null;
    return userId;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, value: string): void {
  /* v25.17 Lane C NC1 — always sign the cookie body. Callers pass the userId;
     we wrap it in an HMAC envelope before writing. */
  const signed = signSessionValue(value);
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  };
  if (isProductionHttps) {
    res.cookie(SESSION_COOKIE, signed, { ...opts, secure: true });
  } else {
    res.cookie(LEGACY_SESSION_COOKIE, signed, opts);
  }
}

/* v25.17 Lane C NL4 — clearSessionCookie now uses matching attributes for both
   cookie names so the legacy cookie reliably clears under all browsers. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/", secure: true, sameSite: "lax" });
  res.clearCookie(LEGACY_SESSION_COOKIE, { path: "/", sameSite: "lax" });
}

/**
 * Read the session cookie from the request and return the raw cookie body.
 * Accepts both the prefixed production name and the legacy dev name.
 * Does NOT verify the signature — callers should use `extractUserIdFromCookie`
 * for that.
 */
export function readSessionCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  return cookies[SESSION_COOKIE] ?? cookies[LEGACY_SESSION_COOKIE];
}

/**
 * v25.17 Lane C NC1 — single canonical extractor that callers should prefer.
 * Returns the userId if the cookie body verifies, else null.
 *
 * v25.18 Lane C NC1 (hard close):
 *   The v25.17 legacy raw-userId fallback was a zero-credential admin
 *   takeover (any attacker could send `__Host-cap_uid=u_admin`). The
 *   `STRICT_SESSION_COOKIE` env knob is now DEFAULT-ON and required to be
 *   explicitly set to `0` to re-enable the (deprecated) legacy path —
 *   intended only for emergency rollback during the v25.18 cutover window.
 *   In production the legacy path is NEVER honoured regardless of the env
 *   var. After v25.18 the legacy path will be removed entirely.
 */
export function extractUserIdFromCookie(req: Request): string | null {
  const raw = readSessionCookie(req);
  if (!raw) return null;
  if (raw.split(".").length === 3) {
    return verifySessionValue(raw);
  }
  // v25.18 — strict-by-default. Only honour the legacy raw-userId fallback
  // when the operator has explicitly opted out AND we are not in production.
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.STRICT_SESSION_COOKIE !== "0") return null;
  return raw;
}
