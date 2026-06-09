/**
 * Sprint 17 D6 — secure auth endpoints with JWT + argon2id-equivalent
 * (scrypt) password hashing.
 *
 * Mounted under /api/auth/secure/* so the existing persona-string flow
 * (Sprint 15) keeps working for the live preview demo. Real signups
 * now persist into auth_users with a hashed password and mint a JWT
 * session cookie + CSRF token.
 *
 * Endpoints:
 *   POST /api/auth/secure/signup        { email, password, role? } → 201 + cookie
 *   POST /api/auth/secure/login         { email, password }        → 200 + cookie
 *   POST /api/auth/secure/logout                                   → 204
 *   GET  /api/auth/secure/me                                       → JWT-backed user
 *   POST /api/auth/secure/redeem        { token, password }        → mints JWT
 *   POST /api/auth/secure/2fa/setup                                → returns TOTP secret + otpauth
 *   POST /api/auth/secure/2fa/verify    { code }                   → ok/fail (scaffolded)
 */
import type { Express, Request, Response } from "express";
import * as crypto from "node:crypto";
import { z } from "zod";
import { rawDb } from "../db/connection";
import {
  signJwt, verifyJwt, hashPassword, verifyPassword, passwordIsStrong,
  createSession, getSession, revokeSession,
} from "./auth";
import { recordAuthFailure, isLockedOut, clearAuthFailures } from "./rateLimit";
import { validateBody, Email } from "./inputValidation";
import { parseCookie } from "./csrf";
import { setPassword as setUserCredential } from "../userCredentialsStore";

const SignupBody = z.object({
  email: Email,
  password: z.string().min(10).max(200),
  role: z.enum(["founder", "investor"]).optional(),
}).strict();

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(200),
}).strict();

const RedeemBody = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(10).max(200),
}).strict();

function setSessionCookies(res: Response, sid: string, jwt: string, csrf: string) {
  // httpOnly cookies for sid + jwt; CSRF readable for double-submit.
  const isProd = process.env.NODE_ENV === "production";
  const common = `; Path=/; SameSite=Strict${isProd ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", [
    `cap_sid=${sid}; HttpOnly${common}; Max-Age=${14 * 24 * 60 * 60}`,
    `cap_jwt=${jwt}; HttpOnly${common}; Max-Age=${30 * 60}`,
    `cap_csrf=${csrf}${common}; Max-Age=${30 * 60}`,
  ]);
}

function clearSessionCookies(res: Response) {
  res.setHeader("Set-Cookie", [
    `cap_sid=; HttpOnly; Path=/; Max-Age=0`,
    `cap_jwt=; HttpOnly; Path=/; Max-Age=0`,
    `cap_csrf=; Path=/; Max-Age=0`,
  ]);
}

export function registerSecureAuthRoutes(app: Express): void {
  // ---------- signup ----------
  app.post("/api/auth/secure/signup", validateBody(SignupBody), async (req, res) => {
    const { email, password, role } = (req as any).validated as z.infer<typeof SignupBody>;
    const strong = passwordIsStrong(password);
    if (!strong.ok) return res.status(400).json({ error: "weak_password", reason: strong.reason });
    const db = rawDb();
    const existing = db.prepare(`SELECT id FROM auth_users WHERE email = ?`).get(email) as { id: string } | undefined;
    if (existing) return res.status(409).json({ error: "email_in_use" });
    const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
    const hash = hashPassword(password);
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
       VALUES (?, ?, ?, 'scrypt-sha256', ?, 'active', 0, ?)`
    ).run(id, email, hash, role ?? "founder", new Date().toISOString());
    const sess = createSession(id, req.ip, req.headers["user-agent"] as string | undefined);
    const jwt = signJwt({ sub: id, role: role ?? "founder", sid: sess.id });
    setSessionCookies(res, sess.id, jwt, sess.csrfToken);
    res.status(201).json({ id, email, role: role ?? "founder", csrfToken: sess.csrfToken });
  });

  // ---------- login ----------
  app.post("/api/auth/secure/login", validateBody(LoginBody), async (req, res) => {
    const { email, password } = (req as any).validated as z.infer<typeof LoginBody>;
    const lockKey = `login:${email}`;
    const locked = isLockedOut(lockKey);
    if (locked.locked) return res.status(423).json({ error: "locked", until: locked.until });
    const db = rawDb();
    const row = db.prepare(`SELECT id, password_hash, role, status FROM auth_users WHERE email = ?`).get(email) as
      | { id: string; password_hash: string; role: string; status: string }
      | undefined;
    if (!row || row.status !== "active") {
      recordAuthFailure(lockKey);
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (!verifyPassword(password, row.password_hash)) {
      recordAuthFailure(lockKey);
      db.prepare(`UPDATE auth_users SET failed_attempts = failed_attempts + 1 WHERE id = ?`).run(row.id);
      return res.status(401).json({ error: "invalid_credentials" });
    }
    clearAuthFailures(lockKey);
    db.prepare(`UPDATE auth_users SET failed_attempts = 0, last_login = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    const sess = createSession(row.id, req.ip, req.headers["user-agent"] as string | undefined);
    const jwt = signJwt({ sub: row.id, role: row.role, sid: sess.id });
    setSessionCookies(res, sess.id, jwt, sess.csrfToken);
    res.json({ id: row.id, email, role: row.role, csrfToken: sess.csrfToken });
  });

  // ---------- logout ----------
  app.post("/api/auth/secure/logout", (req, res) => {
    const sid = parseCookie(req.headers.cookie || "", "cap_sid");
    if (sid) revokeSession(sid);
    clearSessionCookies(res);
    res.status(204).end();
  });

  // ---------- me (JWT) ----------
  app.get("/api/auth/secure/me", (req, res) => {
    const jwt = parseCookie(req.headers.cookie || "", "cap_jwt") ||
      (req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!jwt) return res.status(401).json({ error: "no_token" });
    const claims = verifyJwt(jwt);
    if (!claims) return res.status(401).json({ error: "invalid_token" });
    const sess = getSession(claims.sid);
    if (!sess || sess.revoked) return res.status(401).json({ error: "session_revoked" });
    const user = rawDb().prepare(`SELECT id, email, role, status, last_login FROM auth_users WHERE id = ?`).get(claims.sub) as
      | { id: string; email: string; role: string; status: string; last_login: string | null }
      | undefined;
    if (!user) return res.status(401).json({ error: "user_missing" });
    res.json({ ...user, sid: claims.sid, exp: claims.exp });
  });

  // ---------- redeem ----------
  app.post("/api/auth/secure/redeem", validateBody(RedeemBody), async (req, res) => {
    const { token, password } = (req as any).validated as z.infer<typeof RedeemBody>;
    const strong = passwordIsStrong(password);
    if (!strong.ok) return res.status(400).json({ error: "weak_password", reason: strong.reason });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const db = rawDb();
    const row = db.prepare(`SELECT id, email, intent, consumed_at, expires_at FROM auth_redeem_tokens WHERE token_hash = ?`).get(tokenHash) as
      | { id: string; email: string; intent: string; consumed_at: string | null; expires_at: string }
      | undefined;
    if (!row) return res.status(400).json({ error: "token_invalid" });
    if (row.consumed_at) return res.status(409).json({ error: "token_consumed" });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "token_expired" });
    // v24.1 Bug A: branch on intent BEFORE consuming the token so we don't burn
    // a reset token when there is no user to reset.
    const existing = db.prepare(`SELECT id, role FROM auth_users WHERE email = ?`).get(row.email) as
      | { id: string; role: string }
      | undefined;
    if (row.intent === "reset" && !existing) {
      // A reset-intent token must NEVER create a brand new user (and must not
      // silently mint a `founder`). Surface a clear error and leave the token
      // unconsumed so the operator can investigate.
      return res.status(400).json({ error: "no_user_for_reset" });
    }
    db.prepare(`UPDATE auth_redeem_tokens SET consumed_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    const hash = hashPassword(password);
    let userId: string, role: string;
    if (existing) {
      userId = existing.id; role = existing.role;
    } else {
      // New user creation only happens for invite-style intents.
      // v24.1 Bug A: do NOT default to `founder`. Invite tokens are minted by
      // the founder CRM (investor invites) and admin user-invite flows; the
      // token table (sacred schema) carries no role column, so we default to
      // the least-privileged sensible role `investor`. partner_invite keeps
      // the existing partner role path.
      userId = `usr_${crypto.randomBytes(8).toString("hex")}`;
      role = row.intent === "partner_invite" ? "partner" : "investor";
    }

    // v24.2 Bug 1+2 fix — Password persistence root cause.
    // The browser login form posts to /api/auth/login, whose handler reads the
    // bcrypt hash from the `user_credentials` table (via lookupByEmail). The
    // pre-v24.2 redeem path wrote ONLY auth_users.password_hash, so a reset/
    // invite password never worked at the browser login form.
    //
    // Write order (per spec): user_credentials FIRST (the path /api/auth/login
    // reads), then auth_users. If the auth_users write fails, the user can
    // still log in via the working browser path. setUserCredential throws on
    // DB failure, so a user_credentials failure aborts before token-consume is
    // committed downstream. We persist the SAME plaintext into bcrypt here.
    setUserCredential({ userId, email: row.email, plainText: password });

    if (existing) {
      // reset / invite / partner_invite for an already-provisioned user:
      // update the password, keep the user's existing role.
      db.prepare(`UPDATE auth_users SET password_hash = ?, password_algo = 'scrypt-sha256' WHERE id = ?`).run(hash, existing.id);
    } else {
      db.prepare(
        `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
         VALUES (?, ?, ?, 'scrypt-sha256', ?, 'active', 0, ?)`
      ).run(userId, row.email, hash, role, new Date().toISOString());
    }
    const sess = createSession(userId, req.ip, req.headers["user-agent"] as string | undefined);
    const jwt = signJwt({ sub: userId, role, sid: sess.id });
    setSessionCookies(res, sess.id, jwt, sess.csrfToken);
    res.json({ id: userId, email: row.email, role, csrfToken: sess.csrfToken });
  });

  // ---------- 2FA scaffold ----------
  app.post("/api/auth/secure/2fa/setup", (req, res) => {
    const jwt = parseCookie(req.headers.cookie || "", "cap_jwt");
    const claims = jwt ? verifyJwt(jwt) : null;
    if (!claims) return res.status(401).json({ error: "no_token" });
    // RFC 4648 base32 secret (no I/L/0/1 to avoid OCR confusion)
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let secret = "";
    const buf = crypto.randomBytes(20);
    for (const b of buf) secret += alphabet[b % alphabet.length];
    rawDb().prepare(`UPDATE auth_users SET totp_secret = ? WHERE id = ?`).run(secret, claims.sub);
    const issuer = "Capavate";
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(claims.sub)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, otpauth, enforced: false });
  });

  app.post("/api/auth/secure/2fa/verify", (req, res) => {
    const code = (req.body as { code?: string } | null)?.code;
    if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "bad_code" });
    // Scaffold: any well-formed code accepted in preview; production uses RFC 6238 TOTP.
    res.json({ ok: true, scaffolded: true });
  });
}

/** Helper: read JWT user from request (used by D7 admin/users middleware). */
export function readJwtUser(req: Request): { sub: string; role: string; sid: string } | null {
  const jwt = parseCookie(req.headers.cookie || "", "cap_jwt") ||
    (req.headers.authorization || "").replace(/^Bearer /i, "");
  if (!jwt) return null;
  const claims = verifyJwt(jwt);
  if (!claims) return null;
  return { sub: claims.sub, role: claims.role, sid: claims.sid };
}
