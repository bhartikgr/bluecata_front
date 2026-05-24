/**
 * Sprint 15 D1/D5 — auth route shell.
 *
 * Endpoints:
 *   GET  /api/auth/me                  — returns full UserContext
 *   POST /api/auth/login               — accepts { email, password? }; resolves persona by email
 *   POST /api/auth/signup              — founder-only signup (stub: returns the founder persona ctx)
 *   POST /api/auth/forgot              — password reset stub (returns ok)
 *   GET  /api/auth/redeem/preview      — preview an invitation token (does not consume)
 *   POST /api/auth/redeem              — consume an invitation token, set password, return UserContext
 *
 * The redemption endpoints are *aliases* over the existing Sprint 7
 * `/api/invitations/check` and `/api/invitations/redeem` semantics — they
 * delegate to the same in-memory invitation store via shared helpers.
 *
 * SANDBOX-SAFE — pure server.
 */
import type { Express, Request, Response } from "express";
import { getUserContextForId, listPersonas, registerPersona, registerFounderUser, verifyPassword } from "./userContext";
import { setSessionCookie } from "./sessionCookie";
import { DEMO_SEED_ENABLED } from "./demoGate";

/* ---------- email -> persona resolution ---------- */
// Patch v4: demo-persona email maps only when demo seed is enabled.
const EMAIL_TO_PERSONA: Record<string, string> = DEMO_SEED_ENABLED ? {
  "maya@novapay.ai": "u_maya_chen",
  "aisha@greenwood.capital": "u_aisha_patel",
  "lp@lapsed-fund.example": "u_lapsed_lp",
  "newinvestor@example.com": "u_no_position",
  "admin@capavate.io": "u_admin",
} : {};

/**
 * Mock password store. In production this would be bcrypt hashes in DB.
 * For demo, every known investor uses "password123" as their password.
 * The admin uses "adminpass".
 */
const MOCK_PASSWORDS: Record<string, string> = DEMO_SEED_ENABLED ? {
  "u_maya_chen": "password123",
  "u_aisha_patel": "password123",
  "u_lapsed_lp": "password123",
  "u_no_position": "password123",
  "u_admin": "adminpass",
} : {};

function personaIdFromLogin(body: { email?: string; userId?: string } | null): string | null {
  if (!body) return null;
  if (body.userId && listPersonas().includes(body.userId)) return body.userId;
  if (body.email && EMAIL_TO_PERSONA[body.email.toLowerCase()]) return EMAIL_TO_PERSONA[body.email.toLowerCase()];
  return null;
}

export function registerAuthShellRoutes(app: Express, redemption: {
  preview: (token: string) => RedemptionPreview;
  redeem: (token: string) => RedemptionResult;
}): void {
  // ---------- /api/auth/me ----------
  // Avi 22-May Issue 6 — REMOVED. The richer handler in server/routes.ts
  // (~line 1465) supersedes this one: it merges the in-memory prefs cache
  // (timezone, notificationPrefs) with the UserContext. Because
  // registerAuthShellRoutes() runs BEFORE registerRoutes(), this simpler
  // handler used to shadow the rich one, causing Settings.tsx to read back
  // stale prefs after PATCH /api/auth/me. The rich handler returns the same
  // userId/isAuthed/identity shape (plus extras), so existing consumers in
  // sprint19_routes.test.ts, sprint20_investor.test.ts, sprint21_profile.test.ts,
  // and patch4_fresh_user_no_leak.test.ts continue to pass.
  // (Intentionally NOT re-registered here — see server/routes.ts.)

  // ---------- /api/dev/admin-bypass (preview-only) ----------
  // Sprint 27 hotfix: one-shot GET endpoint that signs the user in as admin
  // and 302-redirects to the admin dashboard. No form, no JS dependency,
  // immune to browser caching of the JS bundle.
  //
  // CP Phase C (CP-039) hotfix: hardened to require an explicit
  // ALLOW_DEV_BYPASS=1 opt-in *in addition to* the prior negative gates.
  // This converts the dev-bypass from "fail-open in dev" to "fail-closed
  // unless explicitly enabled", so a misconfigured preview env that
  // happens to have NODE_ENV unset cannot accidentally expose admin login.
  //
  // Disabled when:
  //   - NODE_ENV === "production"           (hard-disabled, always)
  //   - DISABLE_DEV_BYPASS === "1"          (legacy kill-switch)
  //   - ALLOW_DEV_BYPASS !== "1"            (positive opt-in required)
  // Vitest workers also implicitly opt in (so existing harnesses keep working).
  app.get("/api/dev/admin-bypass", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const killSwitch = process.env.DISABLE_DEV_BYPASS === "1";
    const explicitlyAllowed =
      process.env.ALLOW_DEV_BYPASS === "1" || process.env.VITEST === "true";
    if (isProd || killSwitch || !explicitlyAllowed) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const adminId = "u_admin";
    setSessionCookie(res, adminId);
    const hashTarget = typeof req.query.next === "string" ? req.query.next : "#/admin/dashboard";
    // Compute the SPA redirect from the Referer URL. The Referer is the page
    // the user clicked from, which lives at the SPA's index.html (proxied or
    // direct). We strip its hash + query and append our own hash target. This
    // works without inline scripts (CSP-safe) by issuing a real 302.
    const referer = (req.headers.referer as string | undefined) ?? "";
    let redirectUrl: string;
    if (referer) {
      try {
        const u = new URL(referer);
        u.hash = hashTarget;
        u.search = "";
        redirectUrl = u.toString();
      } catch {
        redirectUrl = "/" + hashTarget;
      }
    } else {
      redirectUrl = "/" + hashTarget;
    }
    res.redirect(302, redirectUrl);
  });

  // ---------- /api/auth/login ----------
  // Sprint-fix May 14 2026 — supports BOTH canonical demo personas
  // (MOCK_PASSWORDS) AND newly-registered founders (verifyPassword).
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; userId?: string };
    const providedPw = body.password ?? "";

    // Path 1: canonical demo persona lookup (Maya, Aisha, Admin).
    const canonicalId = personaIdFromLogin(body);
    if (canonicalId) {
      if (!providedPw) {
        return res.status(401).json({
          ok: false,
          error: "MISSING_PASSWORD",
          message: "Email and password are required.",
        });
      }
      if (MOCK_PASSWORDS[canonicalId] === providedPw) {
        setSessionCookie(res, canonicalId);
        const ctx = getUserContextForId(canonicalId);
        return res.json({ ok: true, ctx });
      }
      // Known user but wrong password
      return res.status(401).json({
        ok: false,
        error: "WRONG_PORTAL_OR_NO_ACCOUNT",
        message: "Email or password is incorrect.",
      });
    }

    // Path 2: runtime-registered founder lookup (signups since server start).
    if (body.email && providedPw) {
      const runtimeId = verifyPassword(body.email, providedPw);
      if (runtimeId) {
        setSessionCookie(res, runtimeId);
        const ctx = getUserContextForId(runtimeId);
        return res.json({ ok: true, ctx });
      }
    }

    // No match in either store (unknown email or wrong password).
    return res.status(401).json({
      ok: false,
      error: "WRONG_PORTAL_OR_NO_ACCOUNT",
      message: "Email or password is incorrect.",
    });
  });

  // ---------- /api/auth/signup (founder-only) ----------
  // Sprint 24: validate body, reject duplicates with 409, require minimum
  // password length, and reject investor portal signups with a clear 403.
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: string; name?: string; password?: string; portal?: string };
    if (body.portal === "investor") {
      return res.status(403).json({
        ok: false,
        error: "INVESTOR_SIGNUP_DISALLOWED",
        message: "Investors join Capavate by invitation only. Check your email for the secure invitation link.",
      });
    }
    const email = (body.email ?? "").trim().toLowerCase();
    const name = (body.name ?? "").trim();
    const password = body.password ?? "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "INVALID_EMAIL", message: "Enter a valid email address." });
    }
    if (name.length < 2) {
      return res.status(400).json({ ok: false, error: "INVALID_NAME", message: "Enter your name." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "WEAK_PASSWORD", message: "Choose a password of at least 8 characters." });
    }
    if (EMAIL_TO_PERSONA[email]) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_IN_USE",
        message: "An account with that email already exists. Sign in instead.",
      });
    }
    // Sprint-fix May 14 2026 — PERSIST the new founder. No more Maya Chen.
    const { userId, alreadyExisted } = registerFounderUser({ email, name, password });
    if (alreadyExisted) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_IN_USE",
        message: "An account with that email already exists. Sign in instead.",
      });
    }
    setSessionCookie(res, userId);
    const ctx = getUserContextForId(userId);
    return res.json({ ok: true, ctx });
  });

  // ---------- /api/auth/forgot ----------
  app.post("/api/auth/forgot", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: string };
    if (!body.email) return res.status(400).json({ ok: false, error: "MISSING_EMAIL" });
    res.json({ ok: true, message: "If an account exists for that email, a reset link has been sent.", mock: true });
  });

  // ---------- /api/auth/redeem/preview ----------
  app.get("/api/auth/redeem/preview", (req: Request, res: Response) => {
    const token = String(req.query.token ?? "");
    if (!token) return res.status(400).json({ ok: false, error: "MISSING_TOKEN" });
    const r = redemption.preview(token);
    if (!r.ok) {
      const httpCode = r.reason === "expired" ? 410 : r.reason === "already_redeemed" ? 409 : 404;
      return res.status(httpCode).json({ ok: false, error: r.reason ?? "INVALID_TOKEN" });
    }
    return res.json({ ok: true, invitation: r.invitation });
  });

  // ---------- /api/auth/redeem ----------
  app.post("/api/auth/redeem", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { token?: string; password?: string; agreedToTerms?: boolean; inviteeEmail?: string };
    if (!body.token) return res.status(400).json({ ok: false, error: "MISSING_TOKEN" });
    if (!body.password || body.password.length < 8)
      return res.status(400).json({ ok: false, error: "WEAK_PASSWORD", message: "Choose a password of at least 8 characters." });
    if (!body.agreedToTerms)
      return res.status(400).json({ ok: false, error: "TERMS_NOT_ACCEPTED" });

    // Preview the token first to get inviteeEmail before consuming
    const preview = redemption.preview(body.token);
    if (!preview.ok) {
      const httpCode = preview.reason === "expired" ? 410 : preview.reason === "already_redeemed" ? 409 : 404;
      return res.status(httpCode).json({ ok: false, error: preview.reason ?? "INVALID_TOKEN" });
    }

    const r = redemption.redeem(body.token);
    if (!r.ok) {
      const httpCode = r.reason === "expired" ? 410 : r.reason === "already_redeemed" ? 409 : 404;
      return res.status(httpCode).json({ ok: false, error: r.reason ?? "INVALID_TOKEN" });
    }

    // Defect 12 + 15 + 83: create or look up real persona seeded from inviteeEmail.
    // This ensures the redeemed investor gets their own identity, not u_no_position.
    const inviteeEmail = preview.invitation.inviteeEmail;
    const inviteeName = preview.invitation.inviteeName;
    const personaId = registerPersona({
      email: inviteeEmail,
      name: inviteeName,
      password: body.password,
      invitationId: r.invitationId,
      roundId: r.roundId,
      companyId: r.companyId,
    });

    // Set session cookie so subsequent requests pick up the real persona
    setSessionCookie(res, personaId);

    const ctx = getUserContextForId(personaId);
    return res.json({
      ok: true,
      invitationId: r.invitationId,
      roundId: r.roundId,
      companyId: r.companyId,
      redirectTo: `/investor/companies/${r.companyId}?tab=your-decision&round=${r.roundId}`,
      ctx,
    });
  });
}

/* ---------- redemption result types (passed in by routes.ts) ---------- */
export type RedemptionPreview =
  | { ok: true; invitation: { roundId: string; companyId: string; companyName: string; inviteeEmail: string; inviteeName: string; expiresAt: string; roundLabel?: string; founderName?: string } }
  | { ok: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };

export type RedemptionResult =
  | { ok: true; invitationId: string; roundId: string; companyId: string }
  | { ok: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };
