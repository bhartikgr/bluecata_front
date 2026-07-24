/**
 * W-AVI64 FIX 4 — admin global search returns live founders/investors.
 *
 * Root cause: GET /api/admin/search only saw rows joinable through raw SQL
 * (companies⋈company_members⋈users for founders; users WHERE role='investor' for
 * investors). Live tenants created through the founder-signup / invitation paths
 * were largely invisible, so searching a real company name (e.g. "Neou")
 * returned nothing even though the admin Companies/Investors pages listed it.
 *
 * The fix UNIONs the SAME DB-authoritative readers those admin pages use
 * (getAllCompaniesFromDb for companies; listAllInvitations + active collective
 * members for investors) onto the raw-SQL results, deduped by id/email. The
 * requireAdmin gate is unchanged.
 *
 * This test creates a founder + company through the real signup path and asserts
 * the company is now discoverable by name via /api/admin/search, and that the
 * endpoint stays admin-gated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";

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

function call(
  method: string,
  path: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

describe("W-AVI64 FIX 4: admin search discovers a real founder company by name", () => {
  const uniq = `Neoubloom${Date.now().toString().slice(-6)}`;

  beforeAll(() => {
    const { userId } = registerFounderUser({
      email: `wavi64search_${Date.now()}@founder.example`,
      name: "WAVI64 Search Founder",
      password: "testpassword123",
    });
    addCompanyForFounder(userId, {
      companyId: `co_wavi64search_${Date.now()}`,
      companyName: uniq,
      legalName: `${uniq}, Inc.`,
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: {
        capTableHolders: 0,
        activeRoundsCount: 0,
        raisedThisYearUsd: 0,
        dataroomFiles: 0,
        pendingSoftCircles: 0,
        ownershipPct: 1.0,
      },
      collective: { status: "none" },
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
      sector: "SaaS",
      stage: "Pre-Seed",
      hq: "US",
    } as any);
  });

  it("returns the company in the founders bucket for a name query", async () => {
    const res = await call("GET", `/api/admin/search?q=${encodeURIComponent(uniq)}`, { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.founders)).toBe(true);
    const names = (res.body.founders as Array<{ company_name?: string }>).map((f) => f.company_name);
    expect(names).toContain(uniq);
  });

  it("stays admin-gated: an anonymous caller is rejected (401)", async () => {
    const res = await call("GET", `/api/admin/search?q=${encodeURIComponent(uniq)}`);
    expect(res.status).toBe(401);
  });
});
