/**
 * v24.3 — Investor-side wire-fund instructions.
 *
 * v24.2 shipped a FOUNDER-side "Mark wire funded" button. Avi's main v24.3
 * complaint: the INVESTOR has no way to see WHERE to send funds once a
 * soft-circle is signed. v24.3 adds:
 *   POST /api/founder/rounds/:roundId/wire-instructions   (founder sets)
 *   GET  /api/founder/rounds/:roundId/wire-instructions   (founder reads back)
 *   GET  /api/investor/rounds/:roundId/wire-instructions  (entitled investor reads)
 *
 * These tests exercise the REAL HTTP routes end to end (not a mock) and assert
 * the actual ownership boundaries Avi cares about — the bug is in the auth +
 * persistence path, not just the JSON shape:
 *   1. Founder can POST wire instructions on their own round (200).
 *   2. A DIFFERENT founder is rejected (403/404) — tenant isolation.
 *   3. Founder can GET back exactly what they set (round-trips through the DB).
 *   4. An investor WITH a soft-circle in the round can GET (200) and sees fields.
 *   5. An investor WITHOUT any soft-circle/invitation is rejected (403/404).
 *   6. Anonymous (no identity header) gets 401.
 *   7. Validation: POST missing bankName → 400 and nothing is persisted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser, registerPersona } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createSoftCircle } from "../softCircleStore";
import { createRound } from "../roundsStore";
import { getWireInstructions } from "../wireInstructionsStore";

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

/** DB-backed founder + company so x-user-id resolves authed + owner. */
function makeFounderWithCompany(tag: string): { userId: string; companyId: string } {
  const { userId } = registerFounderUser({
    email: `wi_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}@test.example`,
    name: `WI ${tag}`,
    password: "testpassword123",
  });
  const companyId = `co_wi_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `WI ${tag} Corp`,
    legalName: `WI ${tag} Corp, Inc.`,
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
  return { userId, companyId };
}

/** Create a REAL round linked to the company (so companyIdForRound resolves
 * exactly like production — the founder creates the round before publishing
 * wire instructions). */
function makeRound(companyId: string, tag: string): string {
  const r = createRound({
    companyId,
    name: `WI ${tag} Round`,
    type: "Seed",
    state: "open",
    targetAmount: 1_000_000,
  });
  return r.id;
}

const VALID_BODY = {
  bankName: "First Republic",
  accountName: "Acme Inc.",
  accountNumber: "1234567890",
  routingNumber: "021000021",
  swift: "FRBBUS6S",
  reference: "Round Seed 2026",
  notes: "Please email confirmation after sending.",
};

describe("v24.3: investor-side wire-fund instructions", () => {
  it("1. founder can POST wire instructions on their own round (200)", async () => {
    const { userId, companyId } = makeFounderWithCompany("set");
    const roundId = makeRound(companyId, "set");
    const res = await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId,
      body: VALID_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.wireInstructions?.bankName).toBe("First Republic");
    expect(res.body?.wireInstructions?.accountNumber).toBe("1234567890");
    expect(res.body?.wireInstructions?.updatedAt).toBeTruthy();
    // It must actually be persisted in the store (not just echoed back).
    expect(getWireInstructions(roundId)?.accountName).toBe("Acme Inc.");
  });

  it("2. a DIFFERENT founder is rejected (403/404) — tenant isolation", async () => {
    const owner = makeFounderWithCompany("owner");
    const roundId = makeRound(owner.companyId, "owner");
    // Owner sets instructions.
    const set = await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId: owner.userId,
      body: VALID_BODY,
    });
    expect(set.status).toBe(200);

    // Attacker founds a DIFFERENT company and tries to overwrite.
    const attacker = makeFounderWithCompany("attacker");
    const res = await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId: attacker.userId,
      body: { ...VALID_BODY, bankName: "Evil Bank" },
    });
    expect([403, 404]).toContain(res.status);
    expect(res.body?.ok).not.toBe(true);
    // Owner's data must be untouched.
    expect(getWireInstructions(roundId)?.bankName).toBe("First Republic");
  });

  it("3. founder can GET back exactly what they set (round-trips DB)", async () => {
    const { userId, companyId } = makeFounderWithCompany("get");
    const roundId = makeRound(companyId, "get");
    await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId,
      body: VALID_BODY,
    });
    const res = await call("GET", `/api/founder/rounds/${roundId}/wire-instructions`, { userId });
    expect(res.status).toBe(200);
    expect(res.body?.wireInstructions?.bankName).toBe("First Republic");
    expect(res.body?.wireInstructions?.swift).toBe("FRBBUS6S");
    expect(res.body?.wireInstructions?.reference).toBe("Round Seed 2026");
  });

  it("4. investor WITH a soft-circle in the round can GET (200)", async () => {
    const owner = makeFounderWithCompany("inv_ok");
    const roundId = makeRound(owner.companyId, "inv_ok");
    await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId: owner.userId,
      body: VALID_BODY,
    });
    // Register an investor persona and give them a soft-circle in the round.
    const investorId = registerPersona({
      email: `inv_ok_${Date.now()}@test.example`,
      name: "Funding Investor",
      password: "testpassword123",
      invitationId: `inv_${Date.now()}`,
      roundId,
      companyId: owner.companyId,
    });
    createSoftCircle({
      roundId,
      companyId: owner.companyId,
      investorUserId: investorId,
      investorName: "Funding Investor",
      amount: 50_000,
      status: "confirmed",
    });

    const res = await call("GET", `/api/investor/rounds/${roundId}/wire-instructions`, { userId: investorId });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.wireInstructions?.bankName).toBe("First Republic");
    expect(res.body?.wireInstructions?.accountNumber).toBe("1234567890");
  });

  it("5. investor WITHOUT a soft-circle/invitation is rejected (403/404)", async () => {
    const owner = makeFounderWithCompany("inv_no");
    const roundId = makeRound(owner.companyId, "inv_no");
    await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId: owner.userId,
      body: VALID_BODY,
    });
    // An unrelated investor persona with NO soft-circle and NO invitation here.
    const strangerId = registerPersona({
      email: `stranger_${Date.now()}@test.example`,
      name: "Stranger",
      password: "testpassword123",
      invitationId: `inv_other_${Date.now()}`,
      roundId: `rnd_unrelated_${Date.now()}`,
      companyId: `co_unrelated_${Date.now()}`,
    });
    const res = await call("GET", `/api/investor/rounds/${roundId}/wire-instructions`, { userId: strangerId });
    expect([403, 404]).toContain(res.status);
    expect(res.body?.ok).not.toBe(true);
  });

  it("6. anonymous (no identity header) gets 401", async () => {
    const owner = makeFounderWithCompany("anon");
    const roundId = makeRound(owner.companyId, "anon");
    await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId: owner.userId,
      body: VALID_BODY,
    });
    // Disable the sandbox-only anonymous fallback so an unauthenticated request
    // is treated exactly as production would (no implicit demo persona).
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const res = await call("GET", `/api/investor/rounds/${roundId}/wire-instructions`, {});
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });

  it("7. validation: POST missing bankName → 400 and nothing persisted", async () => {
    const { userId, companyId } = makeFounderWithCompany("val");
    const roundId = makeRound(companyId, "val");
    const { bankName, ...noBank } = VALID_BODY;
    const res = await call("POST", `/api/founder/rounds/${roundId}/wire-instructions`, {
      userId,
      body: noBank,
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("missing_required_fields");
    // Nothing may have been persisted for this round.
    expect(getWireInstructions(roundId)).toBeNull();
  });
});
