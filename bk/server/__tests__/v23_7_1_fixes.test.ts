/**
 * v23.7.1 follow-up regression tests.
 *
 * BUG 019 (follow-up) — GET /api/companies/:id must resolve a company that
 *   exists ONLY in multiCompanyStore (founder-created, no profile snapshot yet)
 *   with HTTP 200 and the correct name, instead of 404.
 *
 * BUG 034 (follow-up) — PATCH /api/rounds/:id/terms must return 400 for a
 *   numeric term that is present-but-invalid (negative or NaN), instead of
 *   silently dropping it.
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
// BUG 019 follow-up — fresh multiCompanyStore company resolves on GET
// ---------------------------------------------------------------------------

describe("BUG 019 follow-up — GET /api/companies/:id resolves a fresh multiCompanyStore company", () => {
  const companyId = `co_b019b_${Date.now()}`;

  it("returns 200 with the correct name for a founder-created company", async () => {
    const mem: FounderCompanyMembership = {
      companyId,
      companyName: "Fresh MultiCo",
      legalName: "Fresh MultiCo, Inc.",
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
      collective: { status: "none" },
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
      sector: "Fintech",
      stage: "Seed",
      hq: "Toronto, ON",
    };
    // Attach to the demo founder so the request resolves as an authed member.
    addCompanyForFounder("u_maya_chen", mem);

    const res = await request(app)
      .get(`/api/companies/${companyId}`)
      .set("x-user-id", "u_maya_chen");
    expect(res.status).toBe(200);
    expect(res.body?.name).toBe("Fresh MultiCo");
    expect(res.body?.legalName).toBe("Fresh MultiCo, Inc.");
    expect(res.body?.sector).toBe("Fintech");
    expect(res.body?.stage).toBe("Seed");
  });

  it("still 404s for a genuinely unknown company id", async () => {
    const res = await request(app)
      .get(`/api/companies/co_does_not_exist_${Date.now()}`)
      .set("x-user-id", "u_maya_chen");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// BUG 034 follow-up — PATCH /terms rejects negative/NaN numeric terms with 400
// ---------------------------------------------------------------------------

describe("BUG 034 follow-up — PATCH /api/rounds/:id/terms rejects invalid numbers with 400", () => {
  let roundId: string;

  it("creates a convertible-note round to edit", async () => {
    const create = await request(app)
      .post("/api/rounds")
      .set("x-user-id", "u_maya_chen")
      .send({
        companyId: "co_novapay",
        name: "v23.7.1 Reject Round",
        instrument: "convertible_note",
        type: "seed",
        targetAmount: 500_000,
        valuationCap: 8_000_000,
        discount: 20,
      });
    expect([200, 201]).toContain(create.status);
    roundId = create.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("negative discount returns 400 invalid_discount", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ discount: -5 });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_discount");
  });

  it("NaN discount (non-numeric string) returns 400 invalid_discount", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ discount: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_discount");
  });

  it("negative priced fields (targetAmount, preMoney) are also rejected", async () => {
    const neg = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ targetAmount: -1 });
    expect(neg.status).toBe(400);
    expect(neg.body?.error).toBe("invalid_targetAmount");

    const negPre = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ preMoney: -100 });
    expect(negPre.status).toBe(400);
    expect(negPre.body?.error).toBe("invalid_preMoney");
  });

  it("a valid PATCH still succeeds and persists (no regression)", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ valuationCap: 9_000_000, discount: 18 });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(Number(res.body?.round?.valuationCap)).toBe(9_000_000);
    expect(Number(res.body?.round?.discount)).toBe(18);
  });
});
