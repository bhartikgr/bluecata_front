/**
 * v24.2 Bug 3 — Wire-Funded action on the soft-circle book.
 *
 * v24.1 LIVE: a founder could confirm a soft-circle but had no way to mark it
 * wire-funded, so confirmed commitments never reached the cap-table funded
 * queue (the queue that the commit-funded-batch step consumes). v24.2 adds
 * POST /api/founder/rounds/:roundId/soft-circle/:scId/wire-funded which moves a
 * CONFIRMED soft-circle onto the funded queue.
 *
 * These tests exercise the real HTTP route end to end (not a mock):
 *   1. confirmed soft-circle → 200 AND a matching row appears on the funded
 *      queue (we read the queue back via getFundedQueue()).
 *   2. soft-circle in a non-confirmed state (intent) → 400 INVALID_SOFT_CIRCLE_STATE
 *      AND no funded-queue row is created.
 *   3. cross-tenant founder (founds a DIFFERENT company) → 403 FOUNDER_WRONG_COMPANY
 *      AND no funded-queue row is created (tenant isolation preserved).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createSoftCircle, getSoftCircle } from "../softCircleStore";
import { getFundedQueue } from "../captableCommitStore";

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

/** Register a DB-backed founder and give them a company (writes tenants /
 * companies / company_members rows so x-user-id resolves authed + owner). */
function makeFounderWithCompany(tag: string): { userId: string; companyId: string } {
  const { userId } = registerFounderUser({
    email: `wf_${tag}_${Date.now()}@test.example`,
    name: `WF ${tag}`,
    password: "testpassword123",
  });
  const companyId = `co_wf_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `WF ${tag} Corp`,
    legalName: `WF ${tag} Corp, Inc.`,
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

describe("v24.2 Bug 3: wire-funded action on confirmed soft-circles", () => {
  it("confirmed soft-circle → 200 and a matching funded-queue row is created", async () => {
    const { userId, companyId } = makeFounderWithCompany("ok");
    const roundId = `rnd_wf_ok_${Date.now()}`;
    const sc = createSoftCircle({
      roundId,
      companyId,
      investorName: "Funded Angel",
      investorEmail: "angel@test.example",
      amount: 50_000,
      status: "confirmed",
    });

    const before = getFundedQueue().filter((e) => e.roundId === roundId).length;

    const res = await call(
      "POST",
      `/api/founder/rounds/${roundId}/soft-circle/${sc.id}/wire-funded`,
      { userId },
    );

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.entry?.roundId).toBe(roundId);
    expect(res.body?.entry?.companyId).toBe(companyId);
    expect(res.body?.entry?.amount).toBe("50000");

    // The funded queue must actually have grown by exactly one matching row.
    const after = getFundedQueue().filter((e) => e.roundId === roundId);
    expect(after.length).toBe(before + 1);
    const queued = after.find((e) => e.companyId === companyId);
    expect(queued).toBeTruthy();
    expect(queued?.amount).toBe("50000");
    expect(queued?.investorId).toBe("angel@test.example");
  });

  it("non-confirmed (intent) soft-circle → 400 INVALID_SOFT_CIRCLE_STATE and no queue row", async () => {
    const { userId, companyId } = makeFounderWithCompany("intent");
    const roundId = `rnd_wf_intent_${Date.now()}`;
    const sc = createSoftCircle({
      roundId,
      companyId,
      investorName: "Tentative Angel",
      amount: 25_000,
      status: "intent",
    });

    const before = getFundedQueue().filter((e) => e.roundId === roundId).length;

    const res = await call(
      "POST",
      `/api/founder/rounds/${roundId}/soft-circle/${sc.id}/wire-funded`,
      { userId },
    );

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("INVALID_SOFT_CIRCLE_STATE");

    // No funded-queue row may be created for an invalid-state transition.
    const after = getFundedQueue().filter((e) => e.roundId === roundId).length;
    expect(after).toBe(before);
    // Soft-circle itself is unchanged.
    expect(getSoftCircle(sc.id)?.status).toBe("intent");
  });

  it("cross-tenant founder → 403 FOUNDER_WRONG_COMPANY and no queue row (isolation preserved)", async () => {
    // Owner founds companyA and seeds a CONFIRMED soft-circle on companyA.
    const owner = makeFounderWithCompany("owner");
    const roundId = `rnd_wf_xt_${Date.now()}`;
    const sc = createSoftCircle({
      roundId,
      companyId: owner.companyId,
      investorName: "Owned Angel",
      amount: 75_000,
      status: "confirmed",
    });

    // Attacker founds a DIFFERENT company and tries to fund owner's soft-circle.
    const attacker = makeFounderWithCompany("attacker");

    const before = getFundedQueue().filter((e) => e.roundId === roundId).length;

    const res = await call(
      "POST",
      `/api/founder/rounds/${roundId}/soft-circle/${sc.id}/wire-funded`,
      { userId: attacker.userId },
    );

    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("FOUNDER_WRONG_COMPANY");

    // No funded-queue row may be created for a cross-tenant attempt.
    const after = getFundedQueue().filter((e) => e.roundId === roundId).length;
    expect(after).toBe(before);
  });
});
