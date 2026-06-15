/**
 * 23-May Fix 8 — partner login regression coverage.
 *
 * Avi noted that partners had no first-class path into the platform. We added
 * the dedicated /partner/login page + wired the demo partner credentials
 * (partner@keiretsu.ca / password123) into seedDemoData so the page is
 * verifiable end-to-end.
 *
 * This test pins five contracts:
 *
 *   1. The PartnerLogin page source exposes `data-testid="form-partner-login"`
 *      so client-side smoke tests can locate it.
 *   2. POST /api/auth/login with the demo partner creds returns 200.
 *   3. GET /api/partner/me as that user (header-auth) returns 200 with a
 *      partnerId matching the seeded tenant_cp_keiretsu_ca org.
 *   4. A non-partner persona (Maya / founder) gets 403 from /api/partner/me.
 *   5. The partner_team_members in-memory binding exists for u_partner_keiretsu
 *      against tenant_cp_keiretsu_ca after seedDemoData() runs.
 *
 * Pattern: mirrors server/__tests__/founderPagesSmoke.test.ts (registerRoutes
 * + supertest) and server/__tests__/partnerWorkspaceMigration.test.ts
 * (seedDemoData + partnerTeamStore assertion). No cap-table mutations — the
 * math-sacred zones are untouched.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { seedDemoData } from "../lib/seedDemoData";
import { getDb } from "../db/connection";
import { partnerTeamStore } from "../partnerWorkspaceStore";

const PARTNER_USER_ID = "u_partner_keiretsu";
const PARTNER_ORG_ID = "tenant_cp_keiretsu_ca";
const PARTNER_EMAIL = "partner@keiretsu.ca";
const PARTNER_PASSWORD = "password123";
const MAYA = "u_maya_chen";

let app: Express;

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());

  app = express();
  app.use(express.json());
  // Inline cookie parser mirroring server/index.ts so /api/auth/login → /api/me
  // can resolve the session cookie under supertest.
  app.use((req, _res, next) => {
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
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

describe("23-May Fix 8 — PartnerLogin page surface", () => {
  it("exposes data-testid=\"form-partner-login\" on the partner login page", () => {
    const SOURCE = path.join(
      __dirname,
      "..",
      "..",
      "client",
      "src",
      "pages",
      "partner",
      "PartnerLogin.tsx",
    );
    const src = fs.readFileSync(SOURCE, "utf8");
    expect(src).toMatch(/data-testid="form-partner-login"/);
    // Demo partner credentials are documented on-page (quick-signin panel).
    expect(src).toMatch(/partner@keiretsu\.ca/);
  });
});

describe("23-May Fix 8 — Demo partner credentials login", () => {
  it("POST /api/auth/login with partner@keiretsu.ca / password123 returns 200", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: PARTNER_EMAIL, password: PARTNER_PASSWORD })
      .set("accept", "application/json");
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    // The login handler returns the resolved UserContext; identity carries the
    // canonical user id either via ctx.userId or ctx.identity.userId.
    const ctx = r.body?.ctx ?? {};
    const resolvedId =
      ctx.userId ?? ctx.identity?.userId ?? ctx.identity?.id ?? "";
    expect(resolvedId).toBe(PARTNER_USER_ID);
  });

  it("POST /api/auth/login with wrong password returns 401", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: PARTNER_EMAIL, password: "definitely-wrong" })
      .set("accept", "application/json");
    expect(r.status).toBe(401);
  });
});

describe("23-May Fix 8 — Partner authorization on /api/partner/me", () => {
  it("GET /api/partner/me as u_partner_keiretsu returns 200 with matching partnerId", async () => {
    const r = await request(app)
      .get("/api/partner/me")
      .set("x-user-id", PARTNER_USER_ID)
      .set("accept", "application/json");
    expect(r.status).toBe(200);
    // The payload shape comes from partnerRoutes; defensively probe for the
    // canonical id under either body.partnerId or body.partnerContext.partnerId.
    const partnerId =
      r.body?.partnerId ??
      r.body?.partnerContext?.partnerId ??
      r.body?.partner?.id ??
      "";
    expect(partnerId).toBe(PARTNER_ORG_ID);
  });

  it("GET /api/partner/me as Maya Chen (founder) returns 403", async () => {
    const r = await request(app)
      .get("/api/partner/me")
      .set("x-user-id", MAYA)
      .set("accept", "application/json");
    expect(r.status).toBe(403);
  });

  it("GET /api/partner/me with no identity returns 401", async () => {
    const r = await request(app)
      .get("/api/partner/me")
      .set("accept", "application/json");
    // Vitest harness defaults unknown callers to the sandbox fallback persona
    // (u_aisha_patel — an investor, not a partner) which is a 403 path, not 401.
    // Either is acceptable as long as the request is rejected.
    expect([401, 403]).toContain(r.status);
  });
});

describe("23-May Fix 8 — partner_team_members binding seeded", () => {
  it("partnerTeamStore.findByUserId(u_partner_keiretsu) resolves to tenant_cp_keiretsu_ca", () => {
    const tm = partnerTeamStore.findByUserId(PARTNER_USER_ID);
    expect(tm).not.toBeNull();
    expect(tm!.partnerId).toBe(PARTNER_ORG_ID);
    expect(tm!.status).toBe("active");
    // The seed pins this as managing_partner so the partner can exercise
    // every sub-role-gated endpoint in a future end-to-end suite.
    expect(tm!.subRole).toBe("managing_partner");
  });
});
