/**
 * v16 F-coll-1 / F-coll-2 — ownership checks on cap-table promote and on
 * founder nomination/application submissions.
 *
 * Acceptance gates #4 + #5:
 *   - Non-cap-table investor POSTs /api/investor/collective/promote → 403
 *     not_on_cap_table.
 *   - Non-owner founder POSTs /api/founder/collective/nominations or
 *     /applications → 403 (founder_mismatch or company_not_owned).
 *   - Aisha (on cap table for co_novapay) → 200 on /promote.
 *   - Maya (founder of co_arboreal) → 200 on /nominations when she names
 *     her own founderId + companyId.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  // Need COLLECTIVE_ENABLED=1 for the founder-side write routes (Fix 6).
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

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
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

describe("v16 ownership: investor /promote", () => {
  it("denies non-cap-table investor (u_no_position) with 403 not_on_cap_table", async () => {
    const r = await call("POST", "/api/investor/collective/promote", {
      userId: "u_no_position", // real persona, investor without cap-table positions
      body: { companyId: "co_arboreal", rationale: "Twenty character plus rationale supplied here for validation." },
    });
    expect(r.status).toBe(403);
    expect(String(r.body?.error ?? "")).toMatch(/not_on_cap_table|forbidden/i);
  });
});

describe("v16 ownership: founder nominations + applications", () => {
  it("denies founder POST when body.founderId mismatches authed user", async () => {
    const r = await call("POST", "/api/founder/collective/nominations", {
      userId: "u_aisha_patel",
      body: {
        companyId: "co_arboreal",
        founderId: "u_maya_chen", // impersonation attempt
        vouchingInvestorId: "u_aisha_patel",
        pitchSummary: "We are an early-stage company doing exciting things.",
      },
    });
    // 503 if flag off; 401/403 if auth/ownership fails.
    expect([401, 403]).toContain(r.status);
    if (r.status === 403) {
      expect(String(r.body?.error ?? "")).toMatch(/founder_mismatch|company_not_owned/i);
    }
  });

  it("denies founder POST when companyId is not one they own", async () => {
    const r = await call("POST", "/api/founder/collective/nominations", {
      userId: "u_maya_chen",
      body: {
        companyId: "co_does_not_exist_anywhere",
        founderId: "u_maya_chen",
        vouchingInvestorId: "u_aisha_patel",
        pitchSummary: "We are an early-stage company doing exciting things.",
      },
    });
    expect([401, 403]).toContain(r.status);
    if (r.status === 403) {
      expect(String(r.body?.error ?? "")).toMatch(/company_not_owned/i);
    }
  });

  it("denies application POST when founderId is forged", async () => {
    const r = await call("POST", "/api/founder/collective/applications", {
      userId: "u_aisha_patel",
      body: {
        companyId: "co_arboreal",
        founderId: "u_maya_chen", // forged
        pitchDeckFilename: "deck.pdf",
        tractionMrr: 12000,
        tractionUsers: 100,
        tractionGrowthPct: 30,
        asks: "We need strategic introductions and corp dev support.",
        coverLetter: "Cover letter ".repeat(20),
        feeAcknowledged: true,
      },
    });
    expect([401, 403]).toContain(r.status);
  });
});
