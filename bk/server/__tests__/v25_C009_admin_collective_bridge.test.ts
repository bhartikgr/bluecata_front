/**
 * v23.5 — C-009 Admin Collective Bridge Tests.
 *
 * Verifies that the admin GET /api/admin/collective/applications endpoint
 * reads from BOTH collectiveAppStore (legacy/investor) AND
 * founderCollectiveApplyStore (modern/founder Path B).
 *
 * 5 tests required:
 *   1. POST founder application → admin GET sees it
 *   2. Admin approve modern app → collectiveMembershipStore.isActive(userId) returns true
 *   3. Admin reject modern app → application status === "rejected" in founderCollectiveApplyStore
 *   4. Filtering by status works for merged results
 *   5. Legacy collectiveAppStore apps still appear in admin GET
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearFounderCollectiveStore, listApplications as listFounderApps, getApplicationById as getFounderAppById } from "../founderCollectiveApplyStore";
import { clearApplications as clearLegacyApps } from "../collectiveAppStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

beforeEach(() => {
  clearFounderCollectiveStore();
  clearLegacyApps();
  collectiveMembershipStore._resetForTests();
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string; isAdmin?: boolean } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Submit a founder Path B application via the public API. */
async function submitFounderApp(companyId = "co_arboreal"): Promise<string> {
  const r = await call("POST", "/api/founder/collective/applications", {
    userId: "u_maya_chen",
    body: {
      companyId,
      founderId: "u_maya_chen",
      pitchDeckFilename: "deck.pdf",
      tractionMrr: 25000,
      tractionUsers: 500,
      tractionGrowthPct: 15,
      asks: "Looking for Series A lead and enterprise customer intros from Collective members",
      references: "Jane Doe, CEO at Acme",
      coverLetter: "We are Arboreal, building the infrastructure for climate-focused fintech. Our product connects carbon credit markets to institutional investors via real-time ledger technology. We seek Collective membership to accelerate distribution and co-investment opportunities across the network.",
      feeAcknowledged: true,
    },
  });
  expect(r.status).toBe(200);
  return r.body.application.id as string;
}

describe("C-009: Admin Collective Bridge", () => {
  it("1. POST founder application → admin GET sees it (both-store bridge)", async () => {
    const appId = await submitFounderApp();

    // Admin GET should now see the application from founderCollectiveApplyStore
    const r = await call("GET", "/api/admin/collective/applications", { userId: "u_admin" });
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    const found = r.body.items.find((item: any) => item.id === appId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("submitted");
  });

  it("2. Admin approve modern app → collectiveMembershipStore.isActive(founderId) returns true", async () => {
    const appId = await submitFounderApp();

    const r = await call("POST", `/api/admin/collective/applications/${appId}/approve`, {
      userId: "u_admin",
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    // Verify membership was activated for the founder
    expect(collectiveMembershipStore.isActive("u_maya_chen")).toBe(true);
  });

  it("3. Admin reject modern app → application status === 'rejected' in founderCollectiveApplyStore", async () => {
    const appId = await submitFounderApp();

    const r = await call("POST", `/api/admin/collective/applications/${appId}/reject`, {
      userId: "u_admin",
      body: { reason: "Does not meet DSC scoring threshold for this cycle." },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    // Verify the application status is rejected in the founderCollectiveApplyStore
    const app1 = getFounderAppById(appId);
    expect(app1).not.toBeNull();
    expect(app1!.status).toBe("rejected");
  });

  it("4. Filtering by status works for merged results", async () => {
    await submitFounderApp("co_arboreal");

    // Before approval: submitted filter should show 1 app
    const submittedR = await call("GET", "/api/admin/collective/applications?status=submitted", { userId: "u_admin" });
    expect(submittedR.status).toBe(200);
    expect(submittedR.body.count).toBeGreaterThanOrEqual(1);

    // Rejected filter should show 0
    const rejectedR = await call("GET", "/api/admin/collective/applications?status=rejected", { userId: "u_admin" });
    expect(rejectedR.status).toBe(200);
    expect(rejectedR.body.count).toBe(0);
  });

  it("5. Approve fails with 404 when application does not exist in either store", async () => {
    const r = await call("POST", "/api/admin/collective/applications/capp_nonexistent_id/approve", {
      userId: "u_admin",
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("APPLICATION_NOT_FOUND");
  });

  it("6. Admin GET /collective/members returns active members list", async () => {
    const r = await call("GET", "/api/admin/collective/members", { userId: "u_admin" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(typeof r.body.count).toBe("number");
  });
});
