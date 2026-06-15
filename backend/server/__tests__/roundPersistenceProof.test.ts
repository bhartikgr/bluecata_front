/**
 * Avi 22-May Issue 3 — round-save persistence proof.
 *
 * Avi asked for confirmation that POST /api/rounds writes a row to the
 * canonical `rounds` SQL table and that the row survives a simulated
 * restart (in-memory cache cleared + hydrate from DB).
 *
 * This test is the end-to-end proof:
 *
 *   1. Boot a real Express app with the full routes.ts wired in.
 *   2. POST /api/rounds (as a real registered founder of the test company).
 *   3. SELECT from the `rounds` table and assert the row exists with the
 *      values we sent.
 *   4. Reset the in-memory caches and call `hydrateRoundsStore()`.
 *   5. Re-read via the API and assert the round still shows up.
 *
 * Identity strategy:
 *   - We call `registerFounderUser()` to materialise a real persona row in
 *     RUNTIME_PERSONAS, then `addCompanyForFounder()` so the founder owns
 *     the test company. Requests carry `x-user-id` — the *only* header
 *     `resolvePersonaId()` reads in Vitest mode — which routes through the
 *     real `loadUserContext` middleware, exactly as production does.
 *   - We do NOT use the V14 test-identity shim here because `requireAuth`
 *     re-derives ctx via `getUserContext(req)` and overwrites any pre-set
 *     `req.userContext`, so a shim'd identity would be lost.
 *
 * Math-sacred guarantee: this test only exercises round PERSISTENCE — the
 * cap-table commit path (packages/cap-table-engine + captableCommitStore.ts
 * lines 354–477) is NEVER invoked. Round persistence and round math are
 * independent layers and we are testing the persistence layer here.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { getDb } from "../db/connection";
import { rounds as roundsTable } from "../../shared/schema";
import { eq } from "drizzle-orm";
import {
  hydrateRoundsStore,
  getRoundsForCompany,
  _testAccessRounds,
} from "../roundsStore";
import { addCompanyForFounder } from "../multiCompanyStore";
import { registerFounderUser } from "../lib/userContext";

let FOUNDER_USER_ID = "";
const COMPANY_ID = "co_22may_persistence_test";

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return app;
}

describe("Avi 22-May Issue 3 — round persistence end-to-end proof", () => {
  let app: express.Express;

  beforeAll(async () => {
    // Register a real founder persona so getUserContextForId() returns
    // isAuthed=true with the right founder.companies list.
    const reg = registerFounderUser({
      email: `persistence_founder_${Date.now()}@test.example`,
      name: "Persistence Founder",
      password: "persistTest1234",
    });
    FOUNDER_USER_ID = reg.userId;

    // Seed the founder with a company so ownership check passes on POST.
    addCompanyForFounder(FOUNDER_USER_ID, {
      companyId: COMPANY_ID,
      companyName: "22May Persistence Test Co",
      legalName: "22May Persistence Test Co, Inc.",
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: {
        capTableHolders: 0,
        activeRoundsCount: 0,
        raisedThisYearUsd: 0,
        dataroomFiles: 0,
        pendingSoftCircles: 0,
        ownershipPct: 0,
      },
      collective: { status: "none" },
      billing: {
        plan: "Founder Free",
        monthlyUsd: 0,
        nextBillingDate: "\u2014",
        cardLast4: null,
        invoiceCount: 0,
      },
      sector: "fintech",
      stage: "seed",
      hq: "San Francisco, CA",
    });

    // Wipe any prior test rounds from a previous failed run.
    const db = getDb();
    try {
      db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run();
    } catch { /* tolerated */ }

    app = await buildApp();
  });

  it("POST /api/rounds writes a row to the `rounds` SQL table", async () => {
    const r = await request(app)
      .post("/api/rounds")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({
        companyId: COMPANY_ID,
        name: "Persistence Proof \u2014 Series A",
        type: "series_a",
        instrument: "preferred",
        state: "draft",
        targetAmount: 5_000_000,
        preMoney: 25_000_000,
        pricePerShare: 2.50,
        minTicket: 250_000,
        currency: "USD",
        region: "US",
        useOfProceeds: "Sales hiring + market entry",
      });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.id).toMatch(/^rnd_/);

    const db = getDb();
    const rows = db
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.id, r.body.id))
      .all() as Array<{
        id: string;
        companyId: string;
        name: string;
        type: string;
        instrument: string | null;
        targetAmount: number;
        preMoney: number | null;
        pricePerShare: number | null;
        currency: string | null;
        extrasJson: string | null;
      }>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.companyId).toBe(COMPANY_ID);
    expect(row.name).toBe("Persistence Proof \u2014 Series A");
    expect(row.type).toBe("series_a");
    expect(row.instrument).toBe("preferred");
    expect(row.targetAmount).toBe(5_000_000);
    expect(row.preMoney).toBe(25_000_000);
    expect(row.pricePerShare).toBe(2.50);
    expect(row.currency).toBe("USD");
    // extras_json round-trip
    expect(row.extrasJson).toBeTruthy();
    const extras = JSON.parse(row.extrasJson!);
    expect(extras.useOfProceeds).toBe("Sales hiring + market entry");
  });

  it("round survives a simulated restart via hydrateRoundsStore()", async () => {
    // Simulate restart by clearing the in-memory cache.
    _testAccessRounds.reset();
    expect(getRoundsForCompany(COMPANY_ID).length).toBe(0);

    // Re-hydrate from DB.
    await hydrateRoundsStore();
    const hydrated = getRoundsForCompany(COMPANY_ID);
    expect(hydrated.length).toBeGreaterThanOrEqual(1);
    const proof = hydrated.find((x) => x.name === "Persistence Proof \u2014 Series A");
    expect(proof).toBeDefined();
    expect(proof!.targetAmount).toBe(5_000_000);
    expect(proof!.pricePerShare).toBe(2.50);
    expect((proof as { useOfProceeds?: string }).useOfProceeds).toBe("Sales hiring + market entry");
  });

  it("GET /api/rounds (after restart) returns the persisted round to the founder", async () => {
    const r = await request(app)
      .get("/api/rounds")
      .set("x-user-id", FOUNDER_USER_ID)
      .query({ companyId: COMPANY_ID });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const proof = r.body.find((x: { name: string }) => x.name === "Persistence Proof \u2014 Series A");
    expect(proof).toBeDefined();
    expect(proof.targetAmount).toBe(5_000_000);
  });

  it("POST /api/rounds rejects unknown companyId with 403 (ownership)", async () => {
    const r = await request(app)
      .post("/api/rounds")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({
        companyId: "co_someone_else_company",
        name: "Should fail",
        type: "seed",
      });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("FOUNDER_WRONG_COMPANY");
  });
});
