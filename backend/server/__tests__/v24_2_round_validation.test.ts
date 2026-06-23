/**
 * v24.2 Bug 4 — Round creation validation (REGRESSION test, NO source change).
 *
 * Bug 4 in the v24.2 spec concerns the round-creation wizard (RoundNew.tsx)
 * rejecting invalid input. Investigation showed the server-side contract
 * (POST /api/rounds) already performs the required validation (added in v24.1
 * "Bug B / Avi #2"): blank name, non-positive target, malformed instrument, and
 * close-before-open all return a typed 400. RoundNew.tsx already POSTs to that
 * endpoint via apiRequest and renders the returned fieldErrors.
 *
 * Per the v24.2 spec ("Bug 4 — round validation: NO source change unless E2E
 * fails"), this file is a REGRESSION GUARD that locks the existing behaviour so
 * a future change cannot silently re-open the bug. It exercises the real HTTP
 * route end to end (not a mock) and asserts the exact 400 shape the client
 * depends on: { error: "validation_failed", fieldErrors: {...} }.
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
let userId: string;
let companyId: string;

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

  // A DB-backed founder who owns a company (so ownership passes and we reach
  // the validation block we are guarding).
  ({ userId } = registerFounderUser({
    email: `rv_${Date.now()}@test.example`,
    name: "Round Validation Founder",
    password: "testpassword123",
  }));
  companyId = `co_rv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: "RV Corp",
    legalName: "RV Corp, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
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
      { hostname: "127.0.0.1", port, path, method, headers },
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

describe("v24.2 Bug 4: POST /api/rounds validation regression guard", () => {
  it("valid round → 200 ok (baseline happy path still works)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Seed Round",
        type: "seed",
        targetAmount: 500_000,
        instrument: "preferred",
        preMoney: 4_000_000,
        pricePerShare: 1.25,
        sharesAuthorized: 3_200_000,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.id).toBeTruthy();
    expect(res.body?.name).toBe("Seed Round");
  });

  it("blank name + zero target → 400 validation_failed with both fieldErrors", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "   ", targetAmount: 0, instrument: "preferred" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.name).toBeTruthy();
    expect(res.body?.fieldErrors?.targetAmount).toBeTruthy();
  });

  it("unsupported instrument → 400 validation_failed with fieldErrors.instrument", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Bad Instrument Round", targetAmount: 100_000, instrument: "crowdfunding" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.instrument).toBeTruthy();
  });

  it("negative targetAmount → 400 invalid_targetAmount (numeric coercion guard)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Negative Target", targetAmount: "-500,000", instrument: "preferred" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_targetAmount");
  });

  it("close date before open date → 400 invalid_closeDate", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Backwards Dates",
        targetAmount: 250_000,
        instrument: "preferred",
        openDate: "2026-06-01",
        closeDate: "2026-05-01",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_closeDate");
  });

  it("non-owner founder → 403 FOUNDER_WRONG_COMPANY (tenant isolation preserved)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId: "u_aisha_patel", // authed investor, does not own this company
      body: { companyId, name: "Intruder Round", targetAmount: 100_000, instrument: "preferred" },
    });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("FOUNDER_WRONG_COMPANY");
  });
});
