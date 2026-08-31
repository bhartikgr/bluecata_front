/**
 * 23-May Fix 3 — Round detail page loads after DB-only round creation.
 *
 * Bug: GET /api/rounds/:id was reading the in-memory `rounds` array only,
 * while POST /api/rounds (and the sibling list endpoint) had been moved to
 * the SQL `rounds` table via mergeLegacyAndDbRounds(). In production
 * (DEMO_SEED_ENABLED=0) the legacy array is empty at boot, so the list
 * endpoint correctly showed DB rounds but the detail endpoint 404'd.
 *
 * Fix: switch /api/rounds/:id, PATCH /api/rounds/:id/terms, and
 * POST /api/rounds/:id/invitations/issue to also use
 * mergeLegacyAndDbRounds().
 *
 * This test creates a round via POST, then verifies the detail endpoint
 * returns 200 with the expected shape \u2014 the precise regression Avi reported.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";

import { withRoundDates } from "./_fixtures/roundDatesFixture";
import { w212Attest } from "./_w212RoundAttestation";
/* WAVE 134 cause 3-of-3 (R98) — round-creation bodies in this file predate the
   mandatory Open date / Target close date backstop on POST /api/rounds
   (server/routes.ts:7399-7412, "W3 Shadie 1a"). Without dates the request was
   refused 400 OPEN_DATE_REQUIRED before ANY of the assertions below ran, so the
   behaviour this file claims to cover was not being exercised at all. Every
   creation body now goes through the ONE shared fixture, which supplies
   unambiguously FUTURE dates (R93: never "today", so an overnight run cannot
   change a result) and never overwrites a date the test set deliberately. The
   gate is unchanged and still refuses a dateless body — see
   server/__tests__/w134_round_dates_fixture.test.ts. No assertion was weakened. */

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

describe("23-May Fix 3 \u2014 Round detail endpoint reads from DB+legacy union", () => {
  it("GET /api/rounds/:id returns 200 for a seed round", async () => {
    // rnd_novapay_foundation is one of the legacy seed rounds.
    const r = await request(app).get("/api/rounds/rnd_novapay_foundation?as=founder");
    expect(r.status).toBe(200);
    expect(r.body?.id).toBe("rnd_novapay_foundation");
  });

  it("GET /api/rounds/:id returns 404 for a non-existent id (regression sanity)", async () => {
    const r = await request(app).get("/api/rounds/rnd_does_not_exist?as=admin");
    expect(r.status).toBe(404);
  });

  it("admin can fetch any round (the previous 404 bug was a data-source mismatch, not auth)", async () => {
    const r = await request(app).get("/api/rounds/rnd_novapay_foundation?as=admin");
    expect(r.status).toBe(200);
    expect(r.body?.id).toBe("rnd_novapay_foundation");
  });

  it("POST /api/rounds creates a round and the same id is fetchable via GET /api/rounds/:id", async () => {
    // The founder of NovaPay (u_maya_chen) is the one allowed to create.
    const create = await request(app)
      .post("/api/rounds")
      .set("x-user-id", "u_maya_chen")
      .send(w212Attest(withRoundDates({
        companyId: "co_novapay",
        name: "23-May Fix 3 Verification Round",
        targetAmount: 1_000_000,
        preMoney: 9_000_000,
        postMoney: 10_000_000,
        pricePerShare: 1.5,
        minTicket: 25_000,
      })));
    // Some test deployments will 200 + { id }, others 201. Both signal a
    // committed row; what matters is that the new id is then resolvable.
    expect([200, 201]).toContain(create.status);
    const newId: string | undefined = create.body?.id ?? create.body?.round?.id;
    expect(newId).toBeTruthy();

    // The detail endpoint MUST find it via mergeLegacyAndDbRounds().
    const detail = await request(app).get(`/api/rounds/${newId}?as=founder`);
    expect(detail.status).toBe(200);
    expect(detail.body?.id).toBe(newId);
  });
});
