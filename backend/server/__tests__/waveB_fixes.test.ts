/**
 * Wave B QA-Fix regression suite.
 *
 * Covers the bugs found in the 5-persona QA walk that were NOT already
 * addressed in the v19 tree. Maps 1:1 to the Wave B fix list:
 *
 *   FIX 1  F-BUG-002 — POST /api/founder/companies/new from the UI flow
 *                      (verified by exercising the existing endpoint;
 *                      the dialog wiring is client-side).
 *   FIX 4  F-BUG-005 — New-company auto-provision creates a `trialing`
 *                      subscription with a 14-day window, not pending_payment.
 *   FIX 12 CP-BUG-001 — POST /api/public/consortium/apply is reachable
 *                      WITHOUT a session (no UNAUTHORIZED).
 *   FIX 13 C-BUG-001 — scripts/seed_demo.ts exists and is wired into
 *                      package.json as `db:seed:demo`.
 *   FIX 8  I-BUG-006 — /api/auth/me returns isAuthed=false for anonymous
 *                      callers (the data drive of the client gate).
 *   FIX 11 A-BUG-002 — Audit chain verify endpoint reachable on the
 *                      canonical /api/admin/audit/verify-chain alias path.
 *                      Server-side the route is exposed; verified via the
 *                      existing audit-chain-verify endpoint.
 *   FIX 10 A-BUG-001 — Sync overview's hashChainOk + Bridge verify-chain
 *                      both read from the same outbox, so they agree.
 *   FIX 5  F-BUG-008 — /api/founder/welcome returns the founder's real
 *                      first name from the registered displayName.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import {
  createSubscriptionForNewCompany,
  getSubscription,
} from "../subscriptionsStore";
import {
  registerFounderUser,
} from "../lib/userContext";

async function buildApp(opts: { defaultIdentity?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: opts.defaultIdentity !== false });
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return { app, server };
}

async function rawRequest(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  // Stand up an ephemeral server on a random port and issue a real HTTP request.
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const data = body === undefined ? "" : JSON.stringify(body);
  const result = await new Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: "127.0.0.1",
        port,
        path: url,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(data)),
          ...headers,
        },
      },
      (resp) => {
        let chunks = "";
        resp.on("data", (c) => (chunks += c));
        resp.on("end", () => {
          let parsed: any = null;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch { parsed = chunks; }
          resolve({ status: resp.statusCode ?? 0, body: parsed, headers: resp.headers });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  server.close();
  return result;
}

/* --------------------------------------------------------------- */
/* FIX 4 — trial subscription on new company                       */
/* --------------------------------------------------------------- */
describe("Wave B FIX 4 (F-BUG-005): auto-trial subscription on new company", () => {
  it("createSubscriptionForNewCompany(.., { trial: true }) creates a 'trialing' status", () => {
    const companyId = `co_waveB_trial_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const r = createSubscriptionForNewCompany(companyId, {
      plan: "founder_pro",
      actor: "test:waveB_trial",
      trial: true,
    });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.subscription.status).toBe("trialing");
    expect(r.subscription.trialEndsOn).toBeDefined();
    // Trial end should be ~14 days out.
    const days = Math.round(
      (Date.parse(r.subscription.trialEndsOn! + "T00:00:00Z") - Date.now()) / 86400000,
    );
    expect(days).toBeGreaterThanOrEqual(13);
    expect(days).toBeLessThanOrEqual(15);
  });

  it("createSubscriptionForNewCompany defaults to pending_payment when trial is omitted (sprint28 compat)", () => {
    const companyId = `co_waveB_paid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const r = createSubscriptionForNewCompany(companyId, { plan: "founder_pro" });
    expect(r.subscription.status).toBe("pending_payment");
  });

  it("idempotent: calling trial:true twice returns the existing trial record", () => {
    const companyId = `co_waveB_idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const a = createSubscriptionForNewCompany(companyId, { trial: true });
    const b = createSubscriptionForNewCompany(companyId, { trial: true });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.subscription.status).toBe("trialing");
  });
});

/* --------------------------------------------------------------- */
/* FIX 1 + FIX 4 — /api/founder/companies/new HTTP path           */
/* --------------------------------------------------------------- */
describe("Wave B FIX 1 (F-BUG-002) + FIX 4 (F-BUG-005): POST /api/founder/companies/new", () => {
  // v23.4.7 Phase 3 (BUG 031): the previous behavior of this route was to
  // always provision a `founder_pro` trialing subscription regardless of what
  // the caller asked for, which produced the "new company labeled PRO" bug.
  // The route now defaults to `founder_free` (no trial, permanent free tier)
  // and accepts an optional `plan` body parameter from the NewCompanyDialog
  // plan-picker. The two cases below validate both the default and the
  // explicit-pro paths.
  it("defaults to founder_free (no trial) when no plan is supplied (v23.4.7 BUG 031)", async () => {
    const { app } = await buildApp();

    const { userId } = registerFounderUser({
      email: `waveB_founder_${Date.now()}@test.example`,
      name: "Wave B Test Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Wave B Co", sector: "Robotics", stage: "Seed", hq: "San Francisco" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    const companyId: string = r.body.companyId;
    expect(typeof companyId).toBe("string");
    expect(companyId.length).toBeGreaterThan(0);

    // v23.4.7: default plan is now founder_free — no trial countdown.
    const sub = getSubscription(companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_free");
    expect(sub!.trialEndsOn).toBeUndefined();
  });

  it("upgrades to founder_pro (trialing) when plan='founder_pro' is supplied (v23.4.7 BUG 031)", async () => {
    const { app } = await buildApp();

    const { userId } = registerFounderUser({
      email: `waveB_founder_pro_${Date.now()}@test.example`,
      name: "Wave B Pro Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Wave B Pro Co", sector: "SaaS", stage: "Seed", hq: "NYC", plan: "founder_pro" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    const companyId: string = r.body.companyId;

    const sub = getSubscription(companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_pro");
    expect(sub!.status).toBe("trialing");
    expect(sub!.trialEndsOn).toBeDefined();
  });
});

/* --------------------------------------------------------------- */
/* FIX 12 — /api/public/consortium/apply is truly public          */
/* --------------------------------------------------------------- */
describe("Wave B FIX 12 (CP-BUG-001): /api/public/consortium/apply", () => {
  it("POST without any session cookie or x-user-id does NOT return UNAUTHORIZED", async () => {
    const { app } = await buildApp();
    // Send a syntactically valid body so we can distinguish 401 from 400.
    const body = {
      organizationName: "QA Partners",
      contactName: "QA Tester",
      contactEmail: "qa@test.example",
      jurisdiction: "California, USA",
      partnerType: "vc",
      aumRange: "50_to_250m",
      portfolioCompanyCount: 10,
      expectedChapter: "chap_keiretsu_canada",
      introMessage: "QA submission",
      // captchaToken: omitted to test validation rejection path; we expect 400, NOT 401.
    };
    const r = await rawRequest(app, "POST", "/api/public/consortium/apply", body);
    // Must NOT be 401. 201 (success) or 400 (validation/captcha) are both acceptable.
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });
});

/* --------------------------------------------------------------- */
/* FIX 13 — seed_demo script + package.json wiring                */
/* --------------------------------------------------------------- */
describe("Wave B FIX 13 (C-BUG-001): scripts/seed_demo.ts + db:seed:demo", () => {
  it("scripts/seed_demo.ts file exists", () => {
    const p = path.resolve(__dirname, "..", "..", "scripts", "seed_demo.ts");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("seed_demo.ts references the canonical demo users", () => {
    const p = path.resolve(__dirname, "..", "..", "scripts", "seed_demo.ts");
    const src = fs.readFileSync(p, "utf8");
    expect(src).toContain("aisha@greenwood.capital");
    expect(src).toContain("admin@capavate.io");
    expect(src).toContain("maya@novapay.example");
    expect(src).toContain("partner@keiretsu.ca");
  });

  it("package.json has a db:seed:demo script", () => {
    const p = path.resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(pkg.scripts["db:seed:demo"]).toBeDefined();
    expect(pkg.scripts["db:seed:demo"]).toContain("scripts/seed_demo.ts");
  });
});

/* --------------------------------------------------------------- */
/* FIX 8 — /api/auth/me returns anonymous shape for no-session    */
/* --------------------------------------------------------------- */
describe("Wave B FIX 8 (I-BUG-006): /api/auth/me anonymous shape", () => {
  it("GET /api/auth/me with no x-user-id and no session cookie returns isAuthed=false", async () => {
    // The sandbox-mode fallback in resolvePersonaIdWithFallback() impersonates
    // u_aisha_patel for unauthenticated requests so existing fixtures keep
    // working. In PRODUCTION the fallback is disabled. This test asserts the
    // PRODUCTION-mode behavior — that's the path real users hit, and the path
    // FIX 8 exists to support (no shell leak for anonymous).
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const { app } = await buildApp({ defaultIdentity: false });
      const r = await rawRequest(app, "GET", "/api/auth/me");
      expect(r.status).toBe(200);
      expect(r.body.isAuthed).toBe(false);
    // The client uses this to decide whether to render the founder shell.
    // Empty founder.companies + isAuthed=false is the canonical anonymous
    // payload.
      expect(Array.isArray(r.body.founder?.companies) || r.body.founder == null).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });
});

/* --------------------------------------------------------------- */
/* FIX 11 — Audit chain verify (existing endpoint reachable)      */
/* --------------------------------------------------------------- */
describe("Wave B FIX 11 (A-BUG-002): audit chain verify route", () => {
  it("client App.tsx registers BOTH /admin/audit-chain-verify AND the canonical alias /admin/audit/verify-chain", () => {
    const p = path.resolve(__dirname, "..", "..", "client", "src", "App.tsx");
    const src = fs.readFileSync(p, "utf8");
    expect(src).toContain('path="/admin/audit-chain-verify"');
    expect(src).toContain('path="/admin/audit/verify-chain"');
  });
});

/* --------------------------------------------------------------- */
/* FIX 10 — Sync and Bridge chain-integrity surfaces agree        */
/* --------------------------------------------------------------- */
describe("Wave B FIX 10 (A-BUG-001): Sync vs Bridge chain consistency", () => {
  it("GET /api/admin/sync/overview.health.hashChainOk matches GET /api/admin/bridge/verify-chain.ok", async () => {
    const { app } = await buildApp();
    const sync = await rawRequest(app, "GET", "/api/admin/sync/overview", undefined, { "x-user-id": "u_admin" });
    const bridge = await rawRequest(app, "GET", "/api/admin/bridge/verify-chain", undefined, { "x-user-id": "u_admin" });
    expect(sync.status).toBe(200);
    expect(bridge.status).toBe(200);
    // Both surfaces read from the same outbox; they MUST agree.
    expect(sync.body.health.hashChainOk).toBe(bridge.body.ok);
  });
});

/* --------------------------------------------------------------- */
/* FIX 5 — Welcome firstName from the founder's real name         */
/* --------------------------------------------------------------- */
describe("Wave B FIX 5 (F-BUG-008): /api/founder/welcome returns real firstName", () => {
  it("a newly-registered founder with name 'Sarah Chen' gets firstName='Sarah' (NOT 'Founder')", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `waveB_sarah_${Date.now()}@test.example`,
      name: "Sarah Chen",
      password: "password12345",
    });
    const r = await rawRequest(
      app,
      "GET",
      "/api/founder/welcome",
      undefined,
      { "x-user-id": userId },
    );
    expect(r.status).toBe(200);
    expect(r.body.firstName).toBe("Sarah");
    expect(r.body.displayName).toBe("Sarah Chen");
  });
});
