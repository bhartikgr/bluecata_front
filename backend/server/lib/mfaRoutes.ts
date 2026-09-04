/**
 * server/lib/mfaRoutes.ts — WAVE 305 · R251.
 *
 * THE ROUTES A REAL USER CAN REACH.
 *
 * The owner's requirement, verbatim in spirit: "enrolment must be reachable by a
 * real user — a screen, not curl." The screen is
 * `client/src/pages/settings/TwoFactorSetup.tsx`; these are the endpoints behind
 * it. Nothing here is admin-only except the two `/api/admin/mfa/...` routes.
 *
 * ROUTE INVENTORY AND WHY EACH IS PUBLIC OR NOT
 * ---------------------------------------------
 *   POST /api/auth/login/mfa            PUBLIC. It completes a login, so by
 *                                       definition there is no session yet. It is
 *                                       reachable anonymously ONLY with a valid,
 *                                       short-lived step-up token that
 *                                       /api/auth/login just minted. Public by
 *                                       prefix: `applyRouteGuards.ts` allowlists
 *                                       the `/api/auth/login` PREFIX.
 *   GET  /api/auth/mfa/status           AUTHED. Default-deny covers it.
 *   POST /api/auth/mfa/enrol/begin      AUTHED.
 *   POST /api/auth/mfa/enrol/confirm    AUTHED.
 *   POST /api/auth/mfa/disable          AUTHED, and requires a live code.
 *   POST /api/admin/mfa/reset           ADMIN. Writes an audit row.
 *   GET  /api/admin/mfa/policy          ADMIN.
 *   POST /api/admin/mfa/policy          ADMIN. Writes an audit row.
 *
 * `/api/auth/mfa/...` is NOT covered by any allowlisted prefix — `/api/auth/me`
 * is a distinct prefix and `/api/auth/mfa` does not start with it — so the
 * platform's default-deny guard requires a session for all of them. A test
 * asserts each returns 401 anonymously.
 *
 * THE STEP-UP TOKEN
 * -----------------
 * A short-lived HMAC token, minted by /api/auth/login when a challenge is
 * required and consumed here. It is NOT a session and NOT a JWT in the platform's
 * `JwtClaims` shape — reusing that shape would have meant putting a fake `sid` in
 * it, and a token that looks like a session is a token somebody will eventually
 * accept as one. It carries only the resolved user id, a purpose string and an
 * expiry, signed with `SESSION_COOKIE_SECRET`.
 *
 * NO MONEY IN THIS FILE.
 */

import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { SESSION_COOKIE_SECRET } from "./auth";
import { setSessionCookie } from "./sessionCookie";
import { getUserContext, getUserContextForId } from "./userContext";
import { clearRevocation } from "./sessionRevocation";
import { durableTick } from "./rateLimitStore";
import { log } from "./logger";
import {
  MFA_POLICY_MODES,
  RECOVERY_CODE_COUNT,
  adminResetEnrolment,
  beginEnrolment,
  confirmEnrolment,
  disableEnrolment,
  mfaChallengeRequired,
  readEnrolment,
  readPolicyMode,
  setPolicyMode,
  unusedRecoveryCodeCount,
  verifyChallenge,
} from "./mfaStore";
import { totpProvisioningUri } from "./mfaTotp";
import { auditMfaAdminReset, writeMfaAudit } from "./mfaAudit";

/* ------------------------------------------------------------------------- *
 * Step-up token
 * ------------------------------------------------------------------------- */

/** Five minutes. Long enough to open an authenticator app; short enough that a
 *  token left in a log is not a standing key. */
export const MFA_STEP_UP_TTL_MS = 5 * 60 * 1000;

const STEP_UP_PURPOSE = "mfa_login_step_up";

export function mintStepUpToken(userId: string, nowMs: number): string {
  const body = Buffer.from(
    JSON.stringify({ sub: userId, purpose: STEP_UP_PURPOSE, exp: nowMs + MFA_STEP_UP_TTL_MS }),
    "utf8",
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_COOKIE_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readStepUpToken(token: unknown, nowMs: number): { ok: true; userId: string } | { ok: false; reason: string } {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SESSION_COOKIE_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  let claims: { sub?: string; purpose?: string; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (claims.purpose !== STEP_UP_PURPOSE) return { ok: false, reason: "wrong purpose" };
  if (typeof claims.exp !== "number" || claims.exp < nowMs) return { ok: false, reason: "expired" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return { ok: false, reason: "no subject" };
  return { ok: true, userId: claims.sub };
}

/* ------------------------------------------------------------------------- *
 * Challenge throttle — durable, so a restart does not reset it.
 * ------------------------------------------------------------------------- */

const CHALLENGE_LIMIT = 10;
const CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

/**
 * `failClosed: true` — this is the ONE place in the MFA feature that fails closed,
 * and it is not a lock-out risk: it refuses only a burst of code guesses against
 * an account that has ALREADY passed its password check and has already proved it
 * can produce codes. A user who waits fifteen minutes gets in; a script that
 * guesses six digits does not. The fail-open rule protects accounts that CANNOT
 * produce a code. It is not a licence to allow unlimited guessing at ones that can.
 */
function challengeThrottle(userId: string, nowMs: number): { ok: boolean; resetAt: number } {
  const r = durableTick(`mfa_challenge:${userId}`, CHALLENGE_LIMIT, CHALLENGE_WINDOW_MS, nowMs, true);
  return { ok: r.ok, resetAt: r.resetAt };
}

/* ------------------------------------------------------------------------- *
 * Registration
 * ------------------------------------------------------------------------- */

export function registerMfaRoutes(app: Express): void {
  /* ---------------- POST /api/auth/login/mfa — completes a login ---------- */
  app.post("/api/auth/login/mfa", (req: Request, res: Response) => {
    const now = Date.now();
    const body = (req.body ?? {}) as { token?: string; code?: string };
    const t = readStepUpToken(body.token, now);
    if (!t.ok) {
      return res.status(401).json({
        ok: false,
        error: "MFA_TOKEN_INVALID",
        message: "This sign-in attempt has expired. Enter your email and password again.",
      });
    }
    const throttle = challengeThrottle(t.userId, now);
    if (!throttle.ok) {
      return res.status(429).json({
        ok: false,
        error: "MFA_TOO_MANY_ATTEMPTS",
        message: "Too many codes have been tried. Wait fifteen minutes and try again, or use one of your backup codes.",
        resetAt: new Date(throttle.resetAt).toISOString(),
      });
    }
    const v = verifyChallenge(t.userId, String(body.code ?? ""), now);
    if (!v.ok) {
      writeMfaAudit("mfa.challenge_failed", `user:${t.userId}`, t.userId, { reason: v.error });
      const status = v.error === "MFA_UNAVAILABLE" ? 503 : 401;
      return res.status(status).json({ ok: false, error: v.error, message: v.message });
    }
    writeMfaAudit("mfa.challenge_passed", `user:${t.userId}`, t.userId, {
      via: v.via,
      ...(v.via === "recovery_code" ? { recoveryCodesRemaining: String(v.recoveryCodesRemaining ?? 0) } : {}),
    });
    if (v.via === "recovery_code") {
      writeMfaAudit("mfa.recovery_code_used", `user:${t.userId}`, t.userId, {
        recoveryCodesRemaining: String(v.recoveryCodesRemaining ?? 0),
      });
    }
    clearRevocation(t.userId);
    setSessionCookie(res, t.userId);
    const ctx = getUserContextForId(t.userId);
    return res.json({
      ok: true,
      ctx,
      ...(v.via === "recovery_code" ? { usedRecoveryCode: true, recoveryCodesRemaining: v.recoveryCodesRemaining ?? 0 } : {}),
    });
  });

  /* ---------------- GET /api/auth/mfa/status ------------------------------ */
  app.get("/api/auth/mfa/status", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to see your security settings." });
    }
    const e = readEnrolment(ctx.userId);
    const policy = readPolicyMode();
    /* An unreadable state is reported AS unreadable. It is never rendered as
     * "off", because a user told "off" would not know to try again, and it is
     * never rendered as "on", because that would be a claim we cannot support. */
    return res.json({
      ok: true,
      state: e.ok ? e.state : null,
      stateReadable: e.ok,
      enabled: e.ok && e.state === "confirmed",
      recoveryCodesRemaining: e.ok && e.state === "confirmed" ? unusedRecoveryCodeCount(ctx.userId) : null,
      policyMode: policy.ok ? policy.mode : null,
      policyReadable: policy.ok,
      recoveryCodeCount: RECOVERY_CODE_COUNT,
    });
  });

  /* ---------------- POST /api/auth/mfa/enrol/begin ------------------------ */
  app.post("/api/auth/mfa/enrol/begin", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to set up two-factor authentication." });
    }
    const r = beginEnrolment(ctx.userId);
    if (!r.ok) {
      const status = r.error === "ALREADY_CONFIRMED" ? 409 : 503;
      return res.status(status).json({ ok: false, error: r.error, message: r.message });
    }
    writeMfaAudit("mfa.enrolment_started", `user:${ctx.userId}`, ctx.userId, { method: "totp" });
    return res.json({
      ok: true,
      secret: r.secret,
      otpauthUri: totpProvisioningUri({
        secret: r.secret,
        accountLabel: ctx.identity?.email || ctx.userId,
        issuer: "Capavate",
      }),
    });
  });

  /* ---------------- POST /api/auth/mfa/enrol/confirm ---------------------- */
  app.post("/api/auth/mfa/enrol/confirm", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to set up two-factor authentication." });
    }
    const now = Date.now();
    const throttle = challengeThrottle(ctx.userId, now);
    if (!throttle.ok) {
      return res.status(429).json({
        ok: false,
        error: "MFA_TOO_MANY_ATTEMPTS",
        message: "Too many codes have been tried. Wait fifteen minutes and try again.",
        resetAt: new Date(throttle.resetAt).toISOString(),
      });
    }
    const r = confirmEnrolment(ctx.userId, String((req.body ?? {}).code ?? ""), now);
    if (!r.ok) {
      const status = r.error === "MFA_UNAVAILABLE" ? 503 : r.error === "NO_PENDING_ENROLMENT" ? 409 : 400;
      return res.status(status).json({ ok: false, error: r.error, message: r.message });
    }
    writeMfaAudit("mfa.enrolment_confirmed", `user:${ctx.userId}`, ctx.userId, { method: "totp" });
    writeMfaAudit("mfa.recovery_codes_issued", `user:${ctx.userId}`, ctx.userId, { count: String(r.recoveryCodes.length) });
    /* THE ONLY TIME THESE ARE EVER SENT. There is no endpoint that returns them
     * again — only a fresh enrolment issues a new set. */
    return res.json({
      ok: true,
      recoveryCodes: r.recoveryCodes,
      shownOnceWarning:
        "Save these backup codes now. Each one signs you in once if you lose your phone. This is the only time they will be shown.",
    });
  });

  /* ---------------- POST /api/auth/mfa/disable ---------------------------- */
  app.post("/api/auth/mfa/disable", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED", message: "Sign in to change your security settings." });
    }
    const now = Date.now();
    const e = readEnrolment(ctx.userId);
    if (!e.ok || e.state !== "confirmed") {
      return res.status(409).json({
        ok: false,
        error: "NOT_ENROLLED",
        message: "Two-factor authentication is not switched on for this account.",
      });
    }
    const throttle = challengeThrottle(ctx.userId, now);
    if (!throttle.ok) {
      return res.status(429).json({ ok: false, error: "MFA_TOO_MANY_ATTEMPTS", message: "Too many codes have been tried. Wait fifteen minutes and try again." });
    }
    /* A live code is required to switch the factor OFF. Otherwise a stolen session
     * could remove the protection the factor exists to provide. */
    const v = verifyChallenge(ctx.userId, String((req.body ?? {}).code ?? ""), now);
    if (!v.ok) {
      const status = v.error === "MFA_UNAVAILABLE" ? 503 : 400;
      return res.status(status).json({ ok: false, error: v.error, message: v.message });
    }
    const r = disableEnrolment(ctx.userId, now);
    if (!r.ok) {
      return res.status(503).json({ ok: false, error: "MFA_UNAVAILABLE", message: "Nothing was changed. Please try again." });
    }
    writeMfaAudit("mfa.enrolment_disabled", `user:${ctx.userId}`, ctx.userId, {
      priorState: r.priorState,
      recoveryCodesInvalidated: String(r.invalidated),
      by: "self",
    });
    return res.json({ ok: true, state: "disabled" });
  });

  /* ---------------- POST /api/admin/mfa/reset ----------------------------- */
  app.post("/api/admin/mfa/reset", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) {
      return res.status(403).json({ ok: false, error: "ADMIN_REQUIRED", message: "Only an administrator can reset two-factor authentication." });
    }
    const body = (req.body ?? {}) as { userId?: string; reason?: string };
    const subject = String(body.userId ?? "").trim();
    if (!subject) {
      return res.status(400).json({ ok: false, error: "USER_REQUIRED", message: "Choose the account whose two-factor authentication should be reset." });
    }
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 10) {
      return res.status(400).json({
        ok: false,
        error: "REASON_REQUIRED",
        message: "Give a reason of at least 10 characters. It is recorded in the audit log against your name.",
      });
    }
    const now = Date.now();
    const r = adminResetEnrolment(subject, now);
    if (!r.ok) {
      return res.status(503).json({ ok: false, error: r.error, message: r.message });
    }
    /* R253 — THE AUDIT ROW. Not an emit. The row is written here, where the actor
     * and the reason are known, and a test reads it back with rawDb(). */
    auditMfaAdminReset({
      actorId: ctx.userId,
      subjectUserId: subject,
      priorState: r.priorState,
      recoveryCodesInvalidated: r.invalidated,
      reason,
    });
    return res.json({ ok: true, priorState: r.priorState, recoveryCodesInvalidated: r.invalidated });
  });

  /* ---------------- GET/POST /api/admin/mfa/policy ------------------------ */
  app.get("/api/admin/mfa/policy", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) {
      return res.status(403).json({ ok: false, error: "ADMIN_REQUIRED", message: "Only an administrator can see the two-factor policy." });
    }
    const p = readPolicyMode();
    return res.json({
      ok: true,
      mode: p.ok ? p.mode : null,
      readable: p.ok,
      allowedModes: MFA_POLICY_MODES,
      note:
        "There is deliberately no setting that requires two-factor authentication from someone who has not set it up. The database refuses to store one.",
    });
  });

  app.post("/api/admin/mfa/policy", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) {
      return res.status(403).json({ ok: false, error: "ADMIN_REQUIRED", message: "Only an administrator can change the two-factor policy." });
    }
    const mode = String((req.body ?? {}).mode ?? "");
    const now = Date.now();
    const r = setPolicyMode(mode, ctx.userId ?? "", now);
    if (!r.ok) {
      /* The DATABASE refused it. We report that honestly rather than pretending
       * we validated it in JavaScript — the constraint is the guarantee. */
      log.warn(`[mfaRoutes] policy write refused (mode=${mode}): ${r.reason ?? "unknown"}`);
      return res.status(400).json({
        ok: false,
        error: "MODE_NOT_ALLOWED",
        message: `Two-factor policy must be one of: ${MFA_POLICY_MODES.join(", ")}. The database refused "${mode}".`,
        allowedModes: MFA_POLICY_MODES,
      });
    }
    writeMfaAudit("mfa.policy_changed", "platform:mfa_policy", ctx.userId, { mode });
    return res.json({ ok: true, mode });
  });
}

/* Re-exported so the login route can mint a token without importing the store and
 * the routes module separately. */
export { mfaChallengeRequired };
