/**
 * v23.7.0 fix-wave regression tests.
 *
 * BUG 017 — Settings → Company default-currency selection must persist and
 *           round-trip through the multiCompanyStore (and therefore through
 *           GET /api/founder/active-company). No retroactive migration.
 *
 * BUG 034 — Edit-Terms PATCH /api/rounds/:id/terms must persist
 *           instrument-specific extras (valuationCap, discount, interestRate,
 *           maturityMonths, strikePrice, expiryYears) onto the round, in
 *           addition to the existing priced-round fields.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  addCompanyForFounder,
  updateCompanyDetails,
  getCompaniesForFounder,
  type FounderCompanyMembership,
} from "../multiCompanyStore";

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

// ---------------------------------------------------------------------------
// BUG 017 — currency persistence
// ---------------------------------------------------------------------------

describe("BUG 017 — per-company default currency persists", () => {
  const userId = `u_b017_${Date.now()}`;
  const companyId = `co_b017_${Date.now()}`;

  it("updateCompanyDetails persists defaultCurrency and round-trips through the store", () => {
    const mem: FounderCompanyMembership = {
      companyId,
      companyName: "Currency TestCo",
      legalName: "Currency TestCo, Inc.",
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
      collective: { status: "none" },
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
      sector: "Test",
      stage: "Seed",
      hq: "Toronto, ON",
    };
    addCompanyForFounder(userId, mem);

    const updated = updateCompanyDetails(companyId, { defaultCurrency: "EUR" });
    expect(updated).not.toBeNull();
    expect(updated?.defaultCurrency).toBe("EUR");

    const fromStore = getCompaniesForFounder(userId).find((c) => c.companyId === companyId);
    expect(fromStore?.defaultCurrency).toBe("EUR");
  });

  it("blank/whitespace currency is ignored (no clobber to empty)", () => {
    const before = getCompaniesForFounder(userId).find((c) => c.companyId === companyId);
    expect(before?.defaultCurrency).toBe("EUR");
    const updated = updateCompanyDetails(companyId, { defaultCurrency: "   " });
    expect(updated?.defaultCurrency).toBe("EUR");
  });
});

// ---------------------------------------------------------------------------
// BUG 034 — instrument-specific term extras on PATCH /api/rounds/:id/terms
// ---------------------------------------------------------------------------

describe("BUG 034 — Edit-Terms persists instrument extras", () => {
  let noteRoundId: string;

  it("creates a convertible-note round to edit", async () => {
    const create = await request(app)
      .post("/api/rounds")
      .set("x-user-id", "u_maya_chen")
      .send({
        companyId: "co_novapay",
        name: "BUG 034 Note Round",
        instrument: "convertible_note",
        type: "seed",
        targetAmount: 500_000,
        valuationCap: 8_000_000,
        discount: 20,
      });
    expect([200, 201]).toContain(create.status);
    noteRoundId = create.body?.id;
    expect(noteRoundId).toBeTruthy();
  });

  it("PATCH /terms persists valuationCap/discount/interestRate/maturityMonths", async () => {
    const patch = await request(app)
      .patch(`/api/rounds/${noteRoundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({
        targetAmount: 600_000,
        valuationCap: 12_000_000,
        discount: 15,
        interestRate: 6,
        maturityMonths: 24,
      });
    expect(patch.status).toBe(200);
    expect(patch.body?.ok).toBe(true);
    const r = patch.body?.round;
    expect(Number(r.valuationCap)).toBe(12_000_000);
    expect(Number(r.discount)).toBe(15);
    expect(Number(r.interestRate)).toBe(6);
    expect(Number(r.maturityMonths)).toBe(24);
    expect(Number(r.targetAmount)).toBe(600_000);
  });

  it("the persisted extras are visible on GET /api/rounds/:id", async () => {
    const get = await request(app)
      .get(`/api/rounds/${noteRoundId}?as=founder`)
      .set("x-user-id", "u_maya_chen");
    expect(get.status).toBe(200);
    expect(Number(get.body?.valuationCap)).toBe(12_000_000);
    expect(Number(get.body?.interestRate)).toBe(6);
  });

  it("PATCH /terms persists the MFN boolean extra (SAFE/Note)", async () => {
    const patch = await request(app)
      .patch(`/api/rounds/${noteRoundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ mfn: true });
    expect(patch.status).toBe(200);
    expect(patch.body?.round?.mfn).toBe(true);
    const get = await request(app)
      .get(`/api/rounds/${noteRoundId}?as=founder`)
      .set("x-user-id", "u_maya_chen");
    expect(get.body?.mfn).toBe(true);
    // Flipping it back to false also persists (boolean is honored either way).
    const off = await request(app)
      .patch(`/api/rounds/${noteRoundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ mfn: false });
    expect(off.body?.round?.mfn).toBe(false);
  });

  it("negative extras are rejected with 400 (not persisted)", async () => {
    // v23.7.1 — negative numeric terms now return 400 instead of being silently
    // dropped (the prior PATCH value must remain intact).
    const patch = await request(app)
      .patch(`/api/rounds/${noteRoundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ valuationCap: -5 });
    expect(patch.status).toBe(400);
    expect(patch.body?.error).toBe("invalid_valuationCap");
    const get = await request(app)
      .get(`/api/rounds/${noteRoundId}?as=founder`)
      .set("x-user-id", "u_maya_chen");
    expect(Number(get.body?.valuationCap)).toBe(12_000_000);
  });
});
