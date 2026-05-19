/**
 * Sprint 15 D1/D5 — auth route shell.
 * KL-04 FIX: signup ab real user create karta hai auth_users table mein.
 * login bhi DB se check karta hai, in-memory personas ke saath bhi kaam karta hai.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { getUserContext, getUserContextForId, listPersonas, registerPersona } from "./userContext";
import { setSessionCookie } from "./sessionCookie";
import { rawDb } from "../db/connection";

/* ---------- email -> persona resolution (sandbox demo personas) ---------- */
const EMAIL_TO_PERSONA: Record<string, string> = {
  "maya@novapay.ai": "u_maya_chen",
  "aisha@greenwood.capital": "u_aisha_patel",
  "lp@lapsed-fund.example": "u_lapsed_lp",
  "newinvestor@example.com": "u_no_position",
  "admin@capavate.io": "u_admin",
};

const MOCK_PASSWORDS: Record<string, string> = {
  "u_maya_chen": "password123",
  "u_aisha_patel": "password123",
  "u_lapsed_lp": "password123",
  "u_no_position": "password123",
  "u_admin": "adminpass",
};

/* ---------- simple password hashing (sha256 — dev only) ---------- */
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function newUserId(): string {
  return `u_${randomBytes(8).toString("hex")}`;
}

/* ---------- DB helpers ---------- */
function dbGetUserByEmail(email: string): { id: string; password_hash: string; role: string; name: string } | null {
  try {
    const row = rawDb().prepare(
      `SELECT id, password_hash, role, name FROM auth_users WHERE email = ? LIMIT 1`
    ).get(email) as { id: string; password_hash: string; role: string; name: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function dbCreateUser(id: string, email: string, name: string, passwordHash: string): void {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, name, created_at, welcome_ack)
     VALUES (?, ?, ?, 'sha256_dev', 'founder', 'active', ?, ?, 0)`
  ).run(id, email, passwordHash, name, now);
}

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
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    res.json(ctx);
  });

  // ---------- /api/dev/admin-bypass ----------
  app.get("/api/dev/admin-bypass", async (req: Request, res: Response) => {
    if (process.env.DISABLE_DEV_BYPASS === "1") {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const adminId = "u_admin";
    setSessionCookie(res, adminId);
    const hashTarget = typeof req.query.next === "string" ? req.query.next : "#/admin/dashboard";
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
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; userId?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const providedPw = body.password ?? "";

    if (!providedPw) {
      return res.status(401).json({
        ok: false,
        error: "WRONG_PORTAL_OR_NO_ACCOUNT",
        message: "Email or password is incorrect.",
      });
    }

    // Pehle demo personas check karo
    const personaId = personaIdFromLogin(body);
    if (personaId) {
      const expectedPw = MOCK_PASSWORDS[personaId];
      if (providedPw !== expectedPw) {
        return res.status(401).json({
          ok: false,
          error: "WRONG_PORTAL_OR_NO_ACCOUNT",
          message: "Email or password is incorrect.",
        });
      }
      setSessionCookie(res, personaId);
      const ctx = getUserContextForId(personaId);
      return res.json({ ok: true, ctx });
    }

    // DB mein real user check karo
    if (email) {
      const dbUser = dbGetUserByEmail(email);
      if (dbUser) {
        const hash = hashPassword(providedPw);
        if (hash !== dbUser.password_hash) {
          return res.status(401).json({
            ok: false,
            error: "WRONG_PORTAL_OR_NO_ACCOUNT",
            message: "Email or password is incorrect.",
          });
        }
        setSessionCookie(res, dbUser.id);
        const ctx = getUserContextForId(dbUser.id);
        return res.json({ ok: true, ctx });
      }
    }

    return res.status(401).json({
      ok: false,
      error: "WRONG_PORTAL_OR_NO_ACCOUNT",
      message: "We couldn't find an account for that email. If you're an investor, check your email for the secure invitation link.",
    });
  });

  // ---------- /api/auth/signup (founder-only) ----------
  // KL-04 FIX: real user DB mein save hota hai — Maya Chen nahi milti
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

    // Demo persona email se signup block karo
    if (EMAIL_TO_PERSONA[email]) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_IN_USE",
        message: "An account with that email already exists. Sign in instead.",
      });
    }

    // DB mein duplicate check karo
    const existing = dbGetUserByEmail(email);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "EMAIL_IN_USE",
        message: "An account with that email already exists. Sign in instead.",
      });
    }

    // ── KL-04: Real user DB mein save karo ──
    const userId = newUserId();
    const passwordHash = hashPassword(password);
    try {
      dbCreateUser(userId, email, name, passwordHash);
      console.log(`[auth] New user created: ${userId} (${email})`);
    } catch (e) {
      console.error("[auth] DB user creation failed:", e);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Account creation failed. Please try again." });
    }

    // Session set karo aur real user ka context return karo
    setSessionCookie(res, userId);

    // registerPersona taaki getUserContextForId kaam kare
    registerPersona({
      email,
      name,
      password,
      invitationId: undefined,
      roundId: undefined,
      companyId: undefined,
    });

    const ctx = getUserContextForId(userId);
      res.json({ 
        ok: true, 
        ctx: { 
          ...ctx, 
          isAuthed: true,
          identity: {
            ...ctx.identity,
            email,
            name,
            firstName: name.split(" ")[0],
            displayName: name,
          }
        } 
      });
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

/* ---------- redemption result types ---------- */
export type RedemptionPreview =
  | { ok: true; invitation: { roundId: string; companyId: string; companyName: string; inviteeEmail: string; inviteeName: string; expiresAt: string; roundLabel?: string; founderName?: string } }
  | { ok: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };

export type RedemptionResult =
  | { ok: true; invitationId: string; roundId: string; companyId: string }
  | { ok: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };