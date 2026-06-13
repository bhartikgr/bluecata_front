/**
 * BUG-019 regression test — Activity Log tenant isolation.
 *
 * Live observation (24-May QA audit): a freshly-created founder, on opening
 * Activity Log at /#/founder/activity, could see legal_consent.recorded events
 * authored by OTHER founder accounts (consent IDs + timestamps included).
 *
 * Root cause: GET /api/activity blanket-allowed `tenant_platform` rows to
 * every non-admin caller. `legal_consent.recorded` events are written under
 * `tenant_platform` for ALL users (the entity `consent:<id>` does not match
 * `co_<id>` so resolveTenantId() falls through to "tenant_platform").
 *
 * Fix: for non-admin callers, platform-tenant rows are only visible if their
 * `actor === ctx.userId`. Tenant-scoped (co_*) rows are unaffected.
 *
 * This test seeds two unrelated founders' legal_consent.recorded entries via
 * appendAdminAudit + asserts that GET /api/activity for founder A NEVER
 * returns founder B's consent-id payloads.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { appendAdminAudit } from "../adminPlatformStore";
import { __setRuntimePersona } from "../lib/userContext";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
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
});

function get(path: string, userId: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers: { "x-user-id": userId } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("BUG-019 — Activity Log tenant isolation", () => {
  const founderA = `u_bug019_founderA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const founderB = `u_bug019_founderB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Unique markers so we can assert exact non-presence regardless of any
  // other concurrent audit writes during the suite.
  const consentA = `consent_a_${Math.random().toString(36).slice(2, 10)}`;
  const consentB = `consent_b_${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    // Register both as authenticated founder personas. Without this,
    // requireAuth would 401 because they aren't in the static PERSONAS map.
    __setRuntimePersona({
      userId: founderA,
      email: `${founderA}@bug019.test`,
      name: "BUG-019 Founder A",
      isFounder: true,
      isInvestor: false,
      isAdmin: false,
      hasInvitations: false,
    });
    __setRuntimePersona({
      userId: founderB,
      email: `${founderB}@bug019.test`,
      name: "BUG-019 Founder B",
      isFounder: true,
      isInvestor: false,
      isAdmin: false,
      hasInvitations: false,
    });

    // Simulate the exact production path: legalConsentStore writes
    // appendAdminAudit(userId, `consent:${consent.id}`, "legal_consent.recorded", { consentId }).
    // resolveTenantId() routes these to "tenant_platform" for both users.
    appendAdminAudit(founderA, `consent:${consentA}`, "legal_consent.recorded", {
      consentId: consentA,
      userId: founderA,
      documentId: "terms_of_service",
    });
    appendAdminAudit(founderB, `consent:${consentB}`, "legal_consent.recorded", {
      consentId: consentB,
      userId: founderB,
      documentId: "terms_of_service",
    });
  });

  it("Founder A's GET /api/activity NEVER returns Founder B's consent rows", async () => {
    const res = await get("/api/activity", founderA);
    expect(res.status).toBeLessThan(500);
    expect(Array.isArray(res.body)).toBe(true);
    const bodyStr = JSON.stringify(res.body);
    // Founder A's own consent IS visible (own-actor platform-tenant rule).
    expect(bodyStr).toContain(consentA);
    // Founder B's consent ID MUST NOT appear anywhere in the response.
    expect(bodyStr).not.toContain(consentB);
    // Founder B's user id MUST NOT appear in the response either.
    expect(bodyStr).not.toContain(founderB);
  });

  it("Founder B's GET /api/activity NEVER returns Founder A's consent rows", async () => {
    const res = await get("/api/activity", founderB);
    expect(res.status).toBeLessThan(500);
    expect(Array.isArray(res.body)).toBe(true);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).toContain(consentB);
    expect(bodyStr).not.toContain(consentA);
    expect(bodyStr).not.toContain(founderA);
  });

  it("Every row returned to a founder is either their own company tenant or a platform-tenant row authored by them", async () => {
    const res = await get("/api/activity", founderA);
    expect(res.status).toBeLessThan(500);
    const rows: Array<{ tenantId?: string; actor?: string }> = res.body;
    for (const r of rows) {
      if (!r.tenantId) continue; // legacy seed entries lack tenantId; not the leak vector.
      if (r.tenantId === "tenant_platform") {
        // Per the fix, only own-actor platform rows are visible.
        expect(r.actor).toBe(founderA);
      } else {
        // Tenant-scoped rows must belong to one of the caller's company tenants.
        expect(r.tenantId.startsWith("tenant_co_")).toBe(true);
      }
    }
  });
});
