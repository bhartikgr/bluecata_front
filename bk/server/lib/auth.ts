/**
 * Sprint 17 D2 / D6 — JWT signing/verification + password hashing.
 *
 * Uses Node built-ins (no extra dependency surface):
 *   - HS256 JWT via crypto.createHmac
 *   - Password hashing via crypto.scrypt (memory-hard KDF, FIPS-OK).
 *     We prefix the hash with `s2$` so we can swap to argon2id later by
 *     adding a `a2id$` prefix and dispatching on prefix.
 *
 * Tokens carry: { sub, role, sid, iat, exp }. 30-min sliding expiry; refresh
 * via the long-lived sid stored server-side in `auth_sessions`.
 */
import * as crypto from "node:crypto";
import { rawDb } from "../db/connection";

/* v25.17 Lane E NC1 — JWT_SECRET must be set in production. Silent
   per-process fallback caused every restart to invalidate all sessions,
   and under PM2 multi-worker it minted a different secret per worker
   (intermittent 401s). Now: fail fast in production, warn loudly in dev. */
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[auth] JWT_SECRET must be set to a >=32 char value in production. Refusing to boot.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] WARNING: JWT_SECRET is unset \u2014 using ephemeral per-process random secret. Set JWT_SECRET in .env (>=32 chars) to persist sessions across restarts. (dev/test only)",
  );
  return crypto.randomBytes(48).toString("hex");
})();

/* v25.17 Lane C NC1 — dedicated session-cookie HMAC. Exported so sessionCookie
   can sign cookie bodies. Falls back to JWT_SECRET when SESSION_COOKIE_SECRET
   is unset so existing deployments keep working without a new env var; the
   same fail-fast rule applies in production. */
export const SESSION_COOKIE_SECRET = (() => {
  const s = process.env.SESSION_COOKIE_SECRET;
  if (s && s.length >= 32) return s;
  // Reuse JWT_SECRET as a sensible default — still high-entropy, server-only.
  return JWT_SECRET;
})();

const ACCESS_TTL_SEC = 30 * 60;          // 30-min sliding access token
const REFRESH_TTL_SEC = 14 * 24 * 60 * 60; // 14-day refresh
const SCRYPT_N = 2 ** 14, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 32;

export interface JwtClaims {
  sub: string;     // user id
  role: string;    // founder | investor | admin
  sid: string;     // session id (refresh key)
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signJwt(payload: Omit<JwtClaims, "iat" | "exp">, ttlSec = ACCESS_TTL_SEC): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = { ...payload, iat, exp: iat + ttlSec };
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = b64url(crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = b64url(crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest());
  // Constant-time compare
  const a = Buffer.from(s);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  let claims: JwtClaims;
  try { claims = JSON.parse(b64urlDecode(b).toString("utf8")) as JwtClaims; }
  catch { return null; }
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

/* ============================================================
 *  Password hashing — scrypt with prefixed format `s2$N$r$p$salt$hash`
 * ============================================================ */
export function hashPassword(password: string): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
  return `s2$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "s2") return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N, r, p, maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Lightweight password strength gate. */
export function passwordIsStrong(pw: string): { ok: boolean; reason?: string } {
  if (typeof pw !== "string" || pw.length < 10) return { ok: false, reason: "Password must be at least 10 characters" };
  if (!/[A-Z]/.test(pw)) return { ok: false, reason: "Add an uppercase letter" };
  if (!/[a-z]/.test(pw)) return { ok: false, reason: "Add a lowercase letter" };
  if (!/[0-9]/.test(pw)) return { ok: false, reason: "Add a number" };
  if (/^(password|123456|qwerty|letmein)/i.test(pw)) return { ok: false, reason: "Password is too common" };
  return { ok: true };
}

/* ============================================================
 *  Session lifecycle (refresh token + CSRF token)
 * ============================================================ */
export interface SessionRecord {
  id: string;
  userId: string;
  refreshToken: string; // raw — only returned on creation
  csrfToken: string;
  expiresAt: string;
}

export function createSession(userId: string, ip?: string, ua?: string): SessionRecord {
  const db = rawDb();
  const id = crypto.randomBytes(16).toString("hex");
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const refreshHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_SEC * 1000).toISOString();
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, csrf_token, issued_at, expires_at, revoked, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, userId, refreshHash, csrfToken, now.toISOString(), expiresAt, ip ?? null, ua ?? null);
  return { id, userId, refreshToken, csrfToken, expiresAt };
}

export function getSession(sid: string): { id: string; userId: string; csrfToken: string; revoked: boolean } | null {
  const db = rawDb();
  const row = db.prepare(`SELECT id, user_id, csrf_token, revoked, expires_at FROM auth_sessions WHERE id = ?`).get(sid) as
    | { id: string; user_id: string; csrf_token: string; revoked: number; expires_at: string }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    revoked: row.revoked === 1,
  };
}

export function revokeSession(sid: string): void {
  rawDb().prepare(`UPDATE auth_sessions SET revoked = 1 WHERE id = ?`).run(sid);
}

export function rotateCsrfForSession(sid: string): string | null {
  const newToken = crypto.randomBytes(24).toString("hex");
  const r = rawDb().prepare(`UPDATE auth_sessions SET csrf_token = ? WHERE id = ?`).run(newToken, sid);
  return r.changes ? newToken : null;
}
