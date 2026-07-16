/**
 * W-AVI43 Issue 1 — create-round date payload regression guard.
 *
 * REPRO (Avi's report, confirmed live): the round wizard collected Open date and
 * Target close date on Step 3 and validated them client-side, but the create
 * payload object in client/src/pages/founder/RoundNew.tsx did NOT include the
 * openDate/closeDate keys. The live POST /api/rounds body ended at parentRoundId
 * with no dates, so the server correctly rejected every submission with
 * { ok:false, error:"OPEN_DATE_REQUIRED" }.
 *
 * FIX (client-only, NON-sacred): add openDate/closeDate to the create payload.
 * Round persistence goes through the non-sacred roundsStore, NOT the sacred
 * captableCommitStore.
 *
 * This file locks the bug from BOTH ends:
 *   A. CLIENT CONTRACT — RoundNew.tsx's create payload must contain openDate +
 *      closeDate (the exact regression that broke). A static source assertion so
 *      the guard runs without a browser.
 *   B. SERVER ROUND-TRIP — when those fields are sent, the round is created and
 *      the dates persist + read back (proving the client fix reaches the server
 *      contract that was always correct).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
  await registerRoutes(server, app);

  ({ userId } = registerFounderUser({
    email: `avi43_${Date.now()}@test.example`,
    name: "Avi43 Round Founder",
    password: "testpassword123",
  }));
  companyId = `co_avi43_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: "Avi43 Corp",
    legalName: "Avi43 Corp, Inc.",
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
    if (data) r.write(data);
    r.end();
  });
}

describe("W-AVI43 Issue 1 (A) — RoundNew.tsx create payload includes the dates", () => {
  const src = readFileSync(
    join(process.cwd(), "client", "src", "pages", "founder", "RoundNew.tsx"),
    "utf8",
  );
  // Narrow to the create-payload object so we assert the KEYS are in the POST body,
  // not merely that the strings appear somewhere else in the file.
  const payloadStart = src.indexOf("const payload = {");
  const payloadEnd = src.indexOf("apiRequest(\"POST\", \"/api/rounds\"");
  const payloadBlock = src.slice(payloadStart, payloadEnd);

  it("payload object contains an openDate key", () => {
    expect(payloadStart).toBeGreaterThan(-1);
    expect(payloadEnd).toBeGreaterThan(payloadStart);
    expect(/\bopenDate\s*:/.test(payloadBlock)).toBe(true);
  });

  it("payload object contains a closeDate key", () => {
    expect(/\bcloseDate\s*:/.test(payloadBlock)).toBe(true);
  });
});

describe("W-AVI43 Issue 1 (B) — server creates the round + persists the dates when sent", () => {
  const OPEN = "2026-07-16";
  const CLOSE = "2026-08-01";
  let createdId = "";

  it("POST /api/rounds with openDate/closeDate → 200 (no OPEN_DATE_REQUIRED)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Avi43 Common Round",
        type: "series_a",
        instrument: "common",
        pricePerShare: "0.26",
        sharesAuthorized: "100",
        region: "US",
        openDate: OPEN,
        closeDate: CLOSE,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.error).not.toBe("OPEN_DATE_REQUIRED");
    createdId = res.body?.id ?? res.body?.round?.id ?? "";
    expect(typeof createdId).toBe("string");
    expect(createdId.length).toBeGreaterThan(0);
  });

  it("the persisted round reads back the open + close dates", async () => {
    const res = await call("GET", `/api/rounds/${encodeURIComponent(createdId)}`, { userId });
    expect(res.status).toBe(200);
    const round: any = res.body?.round ?? res.body;
    expect(round).toBeTruthy();
    // Dates persist (exact string or ISO-normalised — assert the calendar day survives).
    expect(String(round.openDate ?? "")).toContain("2026-07-16");
    expect(String(round.closeDate ?? "")).toContain("2026-08-01");
  });

  it("missing openDate STILL fails closed (server backstop intact)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Avi43 No Date Round",
        type: "series_a",
        instrument: "common",
        pricePerShare: "0.26",
        sharesAuthorized: "100",
        region: "US",
        // openDate intentionally omitted
        closeDate: CLOSE,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("OPEN_DATE_REQUIRED");
  });
});
