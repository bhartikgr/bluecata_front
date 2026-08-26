/**
 * WAVE 140 — BATCH 1 · ITEM 1, SERVER SIDE.
 *
 * TWO THINGS ARE UNDER TEST, and they are separate claims.
 *
 * (1) A NULL cap means NO CAP, and a 0 cap means "admit nothing". This half is
 *     the SERVER CONTRACT the client fix depends on, and it already held before
 *     this wave — it is pinned here because the client fix is only correct if
 *     the server really does read `capMinor == null` as "unlimited". These cases
 *     therefore PASS BEFORE AND AFTER, deliberately, and they are labelled as
 *     the DEFECT PROOF rather than as the fix: they demonstrate, through the
 *     real HTTP surface, that a stored 0 makes the vehicle refuse every single
 *     investor. That is the damage the wizard was doing.
 *
 * (2) THE REFUSAL ORDER IS WRONG AND THIS WAVE FIXES IT. `subscribe()` ran the
 *     cap check BEFORE the duplicate check, so an investor who was ALREADY
 *     subscribed to a vehicle that was at its cap was told the SPV would be
 *     pushed over its cap (400 EXCEEDS_CAP). Their own existing row was inside
 *     the sum being tested and their new amount was added on top of it, so the
 *     breach the message described did not exist; the true answer was 409
 *     ALREADY_SUBSCRIBED. These cases FAIL BEFORE the hoist and PASS AFTER —
 *     recorded in build_log/wave140/W140_TESTS.md.
 *
 * ANTI-VACUITY. Every case here goes through the REAL express route and asserts
 * the REAL HTTP status and error body, not source text. Both poles of the
 * ordering change are asserted: the duplicate now wins for the SAME investor,
 * and the cap STILL wins for a DIFFERENT investor — so the fix cannot be
 * satisfied by deleting the cap check.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}

/** Create a vehicle through the REAL route, with whatever cap the case needs. */
async function newSpv(name: string, capMinor: number | null): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    capMinor,
    currency: "USD",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  return c.body.spv.id as string;
}

function subscribe(spvId: string, investorId: string, commitmentMinor: number) {
  return post(`/api/partner/me/spv/${spvId}/subscriptions`, { investorId, commitmentMinor });
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("WAVE 140 · ITEM 1 — NULL cap vs 0 cap, over the real route", () => {
  it("B1 — a NULL cap accepts subscriptions of any size (no cap is enforced)", async () => {
    const spvId = await newSpv("W140 No Cap", null);
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)?.capMinor).toBeNull();

    const a = await subscribe(spvId, "u_investor_w140_a", 900000000);
    expect(a.status).toBe(201);
    const b = await subscribe(spvId, "u_investor_w140_b", 900000000);
    expect(b.status).toBe(201);
  });

  it("B2 — DEFECT PROOF: a 0 cap refuses EVERY investor, even the first, even for $1", async () => {
    const spvId = await newSpv("W140 Zero Cap", 0);
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)?.capMinor).toBe(0);

    const first = await subscribe(spvId, "u_investor_w140_c", 1);
    expect(first.status).toBe(400);
    expect(first.body.error).toBe("EXCEEDS_CAP");
    // Nothing was seated, so this is not a partial-acceptance artefact.
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId).length).toBe(0);
  });

  it("B3 — a real cap is still enforced at exactly the boundary and one minor unit past it", async () => {
    const spvId = await newSpv("W140 Real Cap", 100000);

    const atCap = await subscribe(spvId, "u_investor_w140_d", 100000);
    expect(atCap.status).toBe(201); // exactly at the cap is admitted

    const overBy1 = await subscribe(spvId, "u_investor_w140_e", 1);
    expect(overBy1.status).toBe(400);
    expect(overBy1.body.error).toBe("EXCEEDS_CAP");
  });
});

describe("WAVE 140 · ITEM 1 — the duplicate check now runs BEFORE the cap check", () => {
  it("B4 — an ALREADY-SUBSCRIBED investor on a FULL vehicle gets 409 ALREADY_SUBSCRIBED, not 400 EXCEEDS_CAP", async () => {
    const spvId = await newSpv("W140 Order Same Investor", 100000);
    const first = await subscribe(spvId, "u_investor_w140_f", 100000);
    expect(first.status).toBe(201); // the vehicle is now exactly full

    // The SAME investor tries again. Their own row is inside the cap sum, so the
    // pre-wave code answered with a cap breach that was an artefact of counting
    // them twice.
    const again = await subscribe(spvId, "u_investor_w140_f", 50000);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_SUBSCRIBED");
    expect(again.body.error).not.toBe("EXCEEDS_CAP");
  });

  it("B5 — the same is true when the repeat amount alone could never breach the cap", async () => {
    const spvId = await newSpv("W140 Order Tiny Repeat", 100000);
    expect((await subscribe(spvId, "u_investor_w140_g", 100000)).status).toBe(201);

    const again = await subscribe(spvId, "u_investor_w140_g", 1);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_SUBSCRIBED");
  });

  it("B6 — THE OTHER POLE: a DIFFERENT investor on a full vehicle still gets EXCEEDS_CAP", async () => {
    const spvId = await newSpv("W140 Order Other Investor", 100000);
    expect((await subscribe(spvId, "u_investor_w140_h", 100000)).status).toBe(201);

    const other = await subscribe(spvId, "u_investor_w140_i", 1);
    expect(other.status).toBe(400);
    expect(other.body.error).toBe("EXCEEDS_CAP");
    // Exactly one seat exists — the cap was not weakened by the reorder.
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId).length).toBe(1);
  });

  it("B7 — a duplicate on a vehicle with room ALSO reports the duplicate (unchanged behaviour, pinned)", async () => {
    const spvId = await newSpv("W140 Order Room Left", 100000000);
    expect((await subscribe(spvId, "u_investor_w140_j", 1000)).status).toBe(201);

    const again = await subscribe(spvId, "u_investor_w140_j", 1000);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_SUBSCRIBED");
  });

  it("B8 — a duplicate on a vehicle with NO cap reports the duplicate too", async () => {
    const spvId = await newSpv("W140 Order No Cap Dup", null);
    expect((await subscribe(spvId, "u_investor_w140_k", 1000)).status).toBe(201);

    const again = await subscribe(spvId, "u_investor_w140_k", 1000);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_SUBSCRIBED");
  });
});
