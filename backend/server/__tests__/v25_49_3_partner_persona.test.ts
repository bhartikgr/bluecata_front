/**
 * v25.49.3 Round 2 (R3) — approved-partner redeem must yield a
 * CONSORTIUM_PARTNER session, never an investor-shaped one.
 *
 * Root cause (GPT-5.5 REVISE, verify_gpt55_v25493.md):
 *   The approved-partner magic link `/api/auth/redeem-partner-invite/:token`
 *   used `registerPersona()` (SACRED userContext.ts), which hard-codes an
 *   INVESTOR persona and persists auth_users.role='investor' / users.role=
 *   'investor' for the runtime id, then binds THAT investor-shaped id to the
 *   partner contact. So `/api/partner/me` worked, but the same session was
 *   investor-shaped in the generic entitlement context AND a later password
 *   reset returned role 'investor' → dumped the partner on /auth/login (2a).
 *
 * The R1/R2 fix (partnerRoutes.ts + secureAuthRoutes.ts, sacred file NOT
 * touched) resolves/creates a consortium_partner identity locally and returns
 * the partner role from secure/redeem. This test drives the REAL routes end to
 * end via supertest — approve, redeem, /api/partner/me, /api/auth/me, and a
 * password-reset secure/redeem — so a regression is caught here, not in prod.
 *
 * No fake-success shims: identity flows through the production routes; the only
 * spy is sendEmail (all other emailSender exports are preserved) so we can read
 * the approved-partner magic link the approval flow actually emails.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";

// Preserve every real emailSender export; only spy sendEmail so we can capture
// the approval welcome email's redemption URL (which carries the raw token).
vi.mock("../lib/emailSender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/emailSender")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => ({ delivered: true, mode: "dry_run" })),
  };
});

import { sendEmail } from "../lib/emailSender";
import { getDb, rawDb } from "../db/connection";
import { partnerTeamStore } from "../partnerWorkspaceStore";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";

let app: Express;
let prevBypass: string | undefined;

// Admin session cookie for the approval step. We disable the vitest x-user-id
// header bypass below (so the redeem is GENUINELY anonymous, as in production);
// a signed session cookie still authenticates via the always-on cookie path.
const adminCookie = `${LEGACY_SESSION_COOKIE}=${signSessionValue("u_admin")}`;

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  // Disable the sandbox fallback persona (u_aisha_patel, an investor) so an
  // unauthenticated redeem is treated as anonymous — otherwise the email-binding
  // gate would 403 the redeem as an email mismatch against the fallback persona.
  prevBypass = process.env.DISABLE_DEV_BYPASS;
  process.env.DISABLE_DEV_BYPASS = "1";
  getDb();
  const a = express();
  a.use(express.json());
  // Inline cookie parser (mirrors partnerLogin.test.ts) so the redeem session
  // cookie resolves on follow-up /api/partner/me + /api/auth/me calls;
  // readSessionCookie() reads req.cookies, which supertest does not populate.
  a.use((req, _res, next) => {
    const r = req as Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  app = a;
}, 30_000);

afterAll(() => {
  if (prevBypass === undefined) delete process.env.DISABLE_DEV_BYPASS;
  else process.env.DISABLE_DEV_BYPASS = prevBypass;
});

describe("v25.49.3 R3 — approved partner redeem yields a consortium_partner (not investor) session", () => {
  it("approve → redeem → partner workspace reachable, session not investor, DB role consortium_partner, reset routes to partner", async () => {
    const contactEmail = `partner_${Date.now()}_${crypto.randomBytes(4).toString("hex")}@r3.example`;
    const spy = sendEmail as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    // 1) Submit a consortium application (public route).
    const submit = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`)
      .send({
        organizationName: "R3 Ventures Ltd",
        contactName: "R3 Partner",
        contactEmail,
        jurisdiction: "Canada",
        partnerType: "vc",
        aumRange: "10-50M",
        portfolioCompanyCount: 5,
        expectedChapter: "chap_keiretsu_canada",
        introMessage: "R3 regression coverage for approved-partner persona isolation.",
      });
    expect(submit.status).toBe(201);
    const applicationId = submit.body.applicationId as string;
    expect(applicationId).toBeTruthy();
    await new Promise((r) => setImmediate(r));
    spy.mockClear(); // drop the submit-time acknowledgement email

    // 2) Admin approves — mints the partner_invite token + welcome email AND
    //    (Round-1 fix) provisions the users row with role='consortium_partner'.
    const approve = await request(app)
      .post(`/api/admin/consortium/applications/${applicationId}/review`)
      .set("Cookie", adminCookie)
      .send({ status: "approved", review_notes: "R3 approve." });
    expect(approve.status).toBe(200);
    expect(approve.body.application.status).toBe("approved");
    await new Promise((r) => setImmediate(r));

    // 3) Capture the approved-partner magic link token from the welcome email.
    const joined = spy.mock.calls
      .map((c) => `${(c[0] as { text?: string } | undefined)?.text ?? ""}\n${(c[0] as { html?: string } | undefined)?.html ?? ""}`)
      .join("\n");
    const m = joined.match(/\/auth\/redeem-partner-invite\/([a-f0-9]+)/);
    expect(m, "approval welcome email must contain the redeem link").toBeTruthy();
    const token = m![1];

    // 4) Redeem anonymously — the exact flow that previously ran registerPersona
    //    and produced an investor-shaped persona.
    const redeem = await request(app).post(`/api/auth/redeem-partner-invite/${token}`).send({});
    expect(redeem.status).toBe(200);
    expect(redeem.body.ok).toBe(true);
    const setCookie = redeem.headers["set-cookie"] as unknown as string[];
    expect(setCookie, "redeem must set a session cookie").toBeTruthy();
    const cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
    const boundUserId = String(redeem.body.ctx?.userId ?? "");
    expect(boundUserId.length).toBeGreaterThan(0);

    // 5) Partner workspace reachable with the redeem session cookie.
    const partnerMe = await request(app).get("/api/partner/me").set("Cookie", cookies);
    expect(partnerMe.status).toBe(200);

    // 6) The bound identity's DURABLE role MUST be consortium_partner, NEVER investor.
    const usersRole = (rawDb().prepare(`SELECT role FROM users WHERE id = ?`).get(boundUserId) as { role?: string } | undefined)?.role;
    expect(usersRole).toBe("consortium_partner");
    const authRole = (rawDb().prepare(`SELECT role FROM auth_users WHERE id = ?`).get(boundUserId) as { role?: string } | undefined)?.role;
    expect(authRole).toBe("consortium_partner");

    // partner_team binding resolves for the bound id (workspace authz intact).
    const tm = partnerTeamStore.findByUserId(boundUserId);
    expect(tm?.status).toBe("active");

    // 7) The generic session context is NOT investor-entitled.
    const authMe = await request(app).get("/api/auth/me").set("Cookie", cookies);
    expect(authMe.status).toBe(200);
    expect(authMe.body.isAuthed).toBe(true);
    expect(authMe.body.investor?.state ?? "NONE").toBe("NONE");

    // 8) A subsequent password reset returns partner login routing (bug 2a):
    //    secure/redeem must yield role 'consortium_partner', not a stale investor.
    const resetToken = `tok_${crypto.randomBytes(16).toString("hex")}`;
    const resetHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    rawDb()
      .prepare(
        `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, consumed_at, expires_at, created_at)
         VALUES (?, ?, ?, 'reset', NULL, ?, ?)`,
      )
      .run(
        `rdt_${crypto.randomBytes(6).toString("hex")}`,
        resetHash,
        contactEmail,
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      );
    const secureRedeem = await request(app)
      .post("/api/auth/secure/redeem")
      .send({ token: resetToken, password: "R3PartnerReset9!" });
    expect(secureRedeem.status).toBe(200);
    expect(secureRedeem.body.role).toBe("consortium_partner");
  }, 30_000);
});
