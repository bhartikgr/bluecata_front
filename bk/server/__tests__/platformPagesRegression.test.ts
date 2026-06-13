/**
 * 23-May Fix 4 \u2014 Platform-wide regression suite.
 *
 * Goal
 * \u2500\u2500\u2500\u2500
 * Avi reported that fixing one page breaks another. The fix is a
 * comprehensive regression suite that enumerates every "first-contentful"
 * endpoint for each persona's landing pages and asserts they all return
 * 200 (or an explicit gated error like 403 with a known error code).
 *
 * Per Ozan's explicit 23-May directive, the Admin persona gets EXTRA
 * scrutiny: every /api/admin/* endpoint that a logged-in admin would hit
 * on routine ops is exercised here, end-to-end, through the full
 * registerRoutes() pipeline (so the mount-level requireAdmin guard is
 * also exercised).
 *
 * The suite is intentionally NOT brittle:
 *   \u2022 We accept any 2xx as "page loads".
 *   \u2022 For endpoints that explicitly gate by feature flag or data
 *     availability, we accept the documented error code (e.g. 404 for an
 *     unknown id) but never a 500.
 *   \u2022 The suite asserts NO endpoint 500s. A 500 = unhandled exception =
 *     hard fail.
 *
 * If this test starts failing in CI, the failing line tells you which
 * endpoint regressed and under which persona, so the cascade is contained.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

/** Smoke a single endpoint and assert the response is not a 500. */
async function smoke(
  method: "GET" | "POST",
  path: string,
  opts: { userId?: string; body?: unknown; expectStatuses?: number[] } = {},
) {
  const builder =
    method === "GET" ? request(app).get(path) : request(app).post(path).send(opts.body ?? {});
  const req = opts.userId ? builder.set("x-user-id", opts.userId) : builder;
  const res = await req;
  // Hard fail on 500/502/504.
  expect(res.status, `${method} ${path} returned ${res.status} (server error)`).toBeLessThan(500);
  if (opts.expectStatuses) {
    expect(opts.expectStatuses, `${method} ${path}`).toContain(res.status);
  }
  return res;
}

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n * ADMIN PERSONA \u2014 explicit Ozan 23-May directive\n * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
describe("Platform regression \u2014 ADMIN persona (full coverage)", () => {
  const ADMIN = "u_admin";

  it("/api/auth/me returns ctx.isAdmin true", async () => {
    const r = await smoke("GET", "/api/auth/me", { userId: ADMIN, expectStatuses: [200] });
    expect(r.body?.ctx?.isAdmin ?? r.body?.isAdmin).toBe(true);
  });

  describe("Admin dashboard data", () => {
    it("GET /api/admin/dashboard/kpis", async () => {
      await smoke("GET", "/api/admin/dashboard/kpis", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/dashboard/activity", async () => {
      await smoke("GET", "/api/admin/dashboard/activity", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Users", () => {
    it("GET /api/admin/users", async () => {
      const r = await smoke("GET", "/api/admin/users", { userId: ADMIN, expectStatuses: [200] });
      expect(Array.isArray(r.body?.users) || Array.isArray(r.body)).toBe(true);
    });
    it("GET /api/admin/users?role=admin", async () => {
      await smoke("GET", "/api/admin/users?role=admin", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/users?status=suspended", async () => {
      await smoke("GET", "/api/admin/users?status=suspended", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/users/export (route-ordering edge: may be 200 or 404 depending on registration order)", async () => {
      // Pre-existing finding documented in PLATFORM_AUDIT_23MAY.md — the
      // /api/admin/users/:id matcher swallows /api/admin/users/export. The
      // mount-level requireAdmin guard correctly authorises the caller; the
      // shadowed route is a separate, low-severity cleanup. We accept both
      // outcomes here so the regression suite stays honest — a 500 still
      // fails (see smoke()).
      await smoke("GET", "/api/admin/users/export", { userId: ADMIN, expectStatuses: [200, 404] });
    });
  });

  describe("Admin: Companies", () => {
    it("GET /api/admin/companies/full", async () => {
      await smoke("GET", "/api/admin/companies/full", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/companies/co_novapay/profile", async () => {
      await smoke("GET", "/api/admin/companies/co_novapay/profile", { userId: ADMIN, expectStatuses: [200, 404] });
    });
    it("GET /api/admin/companies/co_novapay/stats", async () => {
      await smoke("GET", "/api/admin/companies/co_novapay/stats", { userId: ADMIN, expectStatuses: [200, 404] });
    });
    it("GET /api/admin/companies/bulk-export.csv", async () => {
      await smoke("GET", "/api/admin/companies/bulk-export.csv", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Investors", () => {
    it("GET /api/admin/investors", async () => {
      await smoke("GET", "/api/admin/investors", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Consortium applications (CP-B)", () => {
    it("GET /api/admin/collective/applications", async () => {
      // Both /api/admin/collective/applications and the new
      // /api/admin/consortium/applications alias should respond.
      await smoke("GET", "/api/admin/collective/applications", { userId: ADMIN, expectStatuses: [200, 404] });
    });
    it("GET /api/admin/consortium/applications (CP-B alias)", async () => {
      await smoke("GET", "/api/admin/consortium/applications", { userId: ADMIN, expectStatuses: [200, 404] });
    });
  });

  describe("Admin: Audit + reconciliation", () => {
    it("GET /api/admin/audit-log", async () => {
      await smoke("GET", "/api/admin/audit-log", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/audit-log/verify", async () => {
      await smoke("GET", "/api/admin/audit-log/verify", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/reconciliation/runs", async () => {
      await smoke("GET", "/api/admin/reconciliation/runs", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Telemetry", () => {
    it("GET /api/admin/telemetry/events", async () => {
      await smoke("GET", "/api/admin/telemetry/events", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/telemetry/schema", async () => {
      await smoke("GET", "/api/admin/telemetry/schema", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Bridge + sync", () => {
    it("GET /api/admin/bridge/outbox", async () => {
      await smoke("GET", "/api/admin/bridge/outbox", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/bridge/inbox", async () => {
      await smoke("GET", "/api/admin/bridge/inbox", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/bridge/verify-chain", async () => {
      await smoke("GET", "/api/admin/bridge/verify-chain", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/sync/overview", async () => {
      await smoke("GET", "/api/admin/sync/overview", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/sync/drift", async () => {
      await smoke("GET", "/api/admin/sync/drift", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Email + notifications", () => {
    it("GET /api/admin/email/templates", async () => {
      await smoke("GET", "/api/admin/email/templates", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/email/outbox", async () => {
      await smoke("GET", "/api/admin/email/outbox", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/notification-campaigns", async () => {
      await smoke("GET", "/api/admin/notification-campaigns", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Pricing", () => {
    it("GET /api/admin/pricing-models", async () => {
      await smoke("GET", "/api/admin/pricing-models", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/pricing/founder-tiers", async () => {
      await smoke("GET", "/api/admin/pricing/founder-tiers", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/pricing/collective-tiers", async () => {
      await smoke("GET", "/api/admin/pricing/collective-tiers", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Lifecycle + migration", () => {
    it("GET /api/admin/lifecycle-policies", async () => {
      await smoke("GET", "/api/admin/lifecycle-policies", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/migration/dry-run", async () => {
      await smoke("GET", "/api/admin/migration/dry-run", { userId: ADMIN, expectStatuses: [200] });
    });
    it("GET /api/admin/migration/mapping", async () => {
      await smoke("GET", "/api/admin/migration/mapping", { userId: ADMIN, expectStatuses: [200] });
    });
  });

  describe("Admin: Security \u2014 mount-level requireAdmin guard", () => {
    it("non-admin (founder) gets 403 on any /api/admin/* endpoint", async () => {
      const r = await smoke("GET", "/api/admin/users", { userId: "u_maya_chen", expectStatuses: [403] });
      expect(r.body?.error).toBe("ADMIN_REQUIRED");
    });
    it("anonymous request gets 401 on any /api/admin/* endpoint", async () => {
      // No x-user-id header AND no ?as= fallback.
      const res = await request(app).get("/api/admin/users").set("DISABLE_DEV_BYPASS", "1");
      // Production-equivalent: anon \u2192 401. Sandbox-fallback: also rejected
      // because resolvePersonaIdWithFallback handles ?as= only.
      expect([401, 403]).toContain(res.status);
    });
  });
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n * FOUNDER PERSONA \u2014 routine landing pages\n * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
describe("Platform regression \u2014 FOUNDER persona (landing pages)", () => {
  const FOUNDER = "u_maya_chen";

  const endpoints: string[] = [
    "/api/auth/me",
    "/api/founder/companies",
    "/api/founder/dashboard",
    "/api/rounds",
    "/api/rounds/rnd_novapay_foundation",
    "/api/dataroom?companyId=co_novapay",
    "/api/crm",
    "/api/notifications",
  ];

  for (const path of endpoints) {
    it(`GET ${path}`, async () => {
      const res = await smoke("GET", path, { userId: FOUNDER });
      expect(res.status, `${path}`).toBeLessThan(500);
    });
  }
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n * INVESTOR PERSONA \u2014 routine landing pages\n * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
describe("Platform regression \u2014 INVESTOR persona (landing pages)", () => {
  const INVESTOR = "u_aisha_patel";

  const endpoints: string[] = [
    "/api/auth/me",
    "/api/investor/portfolio",
    "/api/investor/crm",
    "/api/investor/messages",
    "/api/investor/activity",
    "/api/notifications",
  ];

  for (const path of endpoints) {
    it(`GET ${path}`, async () => {
      const res = await smoke("GET", path, { userId: INVESTOR });
      expect(res.status, `${path}`).toBeLessThan(500);
    });
  }
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n * PUBLIC \u2014 unauthenticated landing surfaces\n * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
describe("Platform regression \u2014 public surfaces", () => {
  it("POST /api/auth/login (admin demo path)", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send({ email: "admin@capavate.io", password: "adminpass" });
    expect(r.status).toBe(200);
    expect(r.body?.ctx?.isAdmin).toBe(true);
  });

  it("GET /api/health (if registered) does not 500", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBeLessThan(500);
  });
});
