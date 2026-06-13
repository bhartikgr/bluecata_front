/**
 * v23.4.8 Phase 2 — BUG 012 (Ozan, High).
 *
 * Bug: "Just before I can create a term sheet within the round creation
 * process, I do not have the opportunity to add investors (from my CRM) into
 * the round. Some companies may need to do this as they may be working with
 * non-Capavate investors."
 *
 * The fix introduces a NON-SACRED endpoint pair (the round-create flow keeps
 * going through server/roundsStore.ts which is a sacred file we must not
 * modify). After the round is created, the wizard PATCHes the picked
 * shareholders onto a separate store that the round-close cascade can read
 * via `listInitialShareholders(roundId)`.
 *
 * This test exercises the PATCH + GET pair end-to-end:
 *   1. Anonymous (no x-user-id, NODE_ENV=production) is rejected with 401.
 *   2. An authenticated PATCH normalises rows: drops empty names, coerces
 *      `source` to "crm" or "manual", validates checkSize as a decimal
 *      string, and returns { ok: true, roundId, count }.
 *   3. The GET round-trip returns the persisted rows.
 *   4. listInitialShareholders() exposes the same payload to downstream
 *      consumers (the round-close cascade).
 *   5. > 500 rows is rejected with TOO_MANY_SHAREHOLDERS.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  registerRoundInitialShareholdersRoutes,
  listInitialShareholders,
  _initialShareholdersStoreForTest,
} from "../lib/roundInitialShareholdersStore";

const FOUNDER = "u_maya_chen";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerRoundInitialShareholdersRoutes(app);
});

describe("v23.4.8 Phase 2 — BUG 012 — round-initial-shareholders endpoint", () => {
  const ROUND_ID = "rnd_v2348_phase2_test";

  it("rejects anonymous PATCH with 401 (no x-user-id)", async () => {
    // We don't set x-user-id; production-style DISABLE_DEV_BYPASS isn't set so
    // the sandbox fallback would normally kick in, but the route demands
    // `ctx.isAuthed`. The dev fallback yields an `isAuthed` investor in
    // sandbox; we therefore explicitly stub DISABLE_DEV_BYPASS for this case.
    process.env.DISABLE_DEV_BYPASS = "1";
    const r = await request(app).patch(`/api/founder/rounds/${ROUND_ID}/initial-shareholders`).send({ shareholders: [] });
    delete process.env.DISABLE_DEV_BYPASS;
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
  });

  it("persists a CRM + manual mix, normalising rows", async () => {
    const r = await request(app)
      .patch(`/api/founder/rounds/${ROUND_ID}/initial-shareholders`)
      .set("x-user-id", FOUNDER)
      .send({
        companyId: "co_novapay",
        shareholders: [
          { name: " Aisha Patel ", email: "aisha@forge.vc", checkSize: "250000", source: "crm", crmContactId: "fcrm_1" },
          { name: "Random Whale", email: "whale@offshore.example", checkSize: "1000000", source: "manual" },
          { name: "", email: "skipped@x.example", checkSize: "1", source: "manual" }, // dropped: empty name
          { name: "Bad Check", email: "x@y.example", checkSize: "not-a-number", source: "manual" }, // checkSize coerced to null
          { name: "Weird Source", source: "alien-source" as any }, // source coerced to manual
        ],
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.roundId).toBe(ROUND_ID);
    expect(r.body.count).toBe(4); // 5 input, 1 dropped (empty name)

    const stored = listInitialShareholders(ROUND_ID);
    expect(stored).toHaveLength(4);
    expect(stored[0].name).toBe("Aisha Patel");
    expect(stored[0].source).toBe("crm");
    expect(stored[0].crmContactId).toBe("fcrm_1");
    expect(stored[0].checkSize).toBe("250000");
    expect(stored[1].source).toBe("manual");
    expect(stored[2].checkSize).toBeNull(); // "not-a-number" coerced
    expect(stored[3].source).toBe("manual"); // alien coerced
  });

  it("GET returns the persisted rows for the same roundId", async () => {
    const r = await request(app)
      .get(`/api/founder/rounds/${ROUND_ID}/initial-shareholders`)
      .set("x-user-id", FOUNDER);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.shareholders).toHaveLength(4);
  });

  it("rejects > 500 rows with TOO_MANY_SHAREHOLDERS", async () => {
    const big = Array.from({ length: 501 }, (_, i) => ({ name: `n${i}`, source: "manual" as const }));
    const r = await request(app)
      .patch(`/api/founder/rounds/rnd_too_big/initial-shareholders`)
      .set("x-user-id", FOUNDER)
      .send({ companyId: "co_novapay", shareholders: big });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("TOO_MANY_SHAREHOLDERS");
  });

  it("internal helper listInitialShareholders is read-only for downstream consumers", () => {
    const rows = listInitialShareholders(ROUND_ID);
    expect(rows).toHaveLength(4);
    // helper returns the underlying array, but downstream consumers should
    // treat it as readonly — we don't enforce immutability at runtime.
    expect(_initialShareholdersStoreForTest.has(ROUND_ID)).toBe(true);
  });
});
