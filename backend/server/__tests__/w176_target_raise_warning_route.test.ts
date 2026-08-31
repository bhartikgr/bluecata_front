/**
 * WAVE 176 · ITEM B · R147.3(1) — THE SERVER HALF: THE WARN SIGNAL IS ON THE WIRE.
 *
 * The client half is proved in
 * client/src/pages/partner/__tests__/w176_commit_units_and_target_warning_ui.test.tsx.
 * That test mounts the real page but must MOCK the endpoint, so on its own it
 * could pass while the route sends nothing — the exact R137 failure mode (a fix
 * that passes tests and never reaches the user). This test closes that gap by
 * driving the REAL Express route with supertest and asserting the real response.
 *
 * The two tests are joined by the SHARED `spvTargetRaiseWarningSentence`: the
 * route builds the sentence with it, the store attaches the same sentence to the
 * durable `_targetOverages` record, and the client fixture constructs its mocked
 * body with it. A drift in the wire contract breaks one of them.
 *
 * WHAT MUST NOT CHANGE, AND IS ASSERTED HERE:
 *   · the commitment SUCCEEDS (201) — R135.3, a target is a goal, never a gate;
 *   · the durable record is still written with `blocked: false` and reason code
 *     TARGET_RAISE_EXCEEDED, read back through the store's own reader;
 *   · `terms._fundsConfirmations` survives the merge (the K-1 pin — `updateSpv`
 *     ASSIGNS `terms`, so a careless write would destroy every K-1 surface);
 *   · a commit UNDER the target, and a vehicle with NO target, return no warning.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { spvEngineStore } from "../spvEngineStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvTargetRaiseWarningSentence } from "@shared/spvCapSplitDisclosure";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}

async function newSpv(name: string, patch: Record<string, unknown>): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  const id = c.body.spv.id as string;
  spvEngineStore.updateSpv(PARTNER_ID, id, patch, "u_test_seed");
  return id;
}

function commit(spvId: string, email: string, amountWholeUnits: string, units = "100") {
  return post(`/api/partner/me/spv/${spvId}/lp-commit`, {
    ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
    holderFirstName: "Lp",
    holderLastName: "Holder",
    investorEmail: email,
    amount: amountWholeUnits,
    shares: units,
  });
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { headers: Record<string, string> }).headers["x-user-id"] =
      (req.headers["x-user-id"] as string) ?? MANAGING;
    next();
  });
  seedTestPartnerSandbox();
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
});

describe("W176 ITEM B — POST lp-commit carries R130's target-raise WARNING", () => {
  it("a commit past the target: 201, exceeded=true, and a sentence naming target and resulting total", async () => {
    // 5,000,000.00 USD target, no cap — the owner's live vehicle shape.
    const spvId = await newSpv("W176 target vehicle", { targetRaiseMinor: 500_000_000, capMinor: null });
    const r = await commit(spvId, "w176a@example.com", "9000000");

    // THE COMMITMENT SUCCEEDED. Never refused for passing a goal (R135.3).
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription.status).toBe("committed");

    expect(r.body.targetRaise.blocked).toBe(false);
    expect(r.body.targetRaise.exceeded).toBe(true);
    const warning: string = r.body.targetRaise.warning;
    expect(typeof warning).toBe("string");
    expect(warning.length).toBeGreaterThan(0);

    // Figures DERIVED from what this test posted, as rendered.
    expect(warning).toContain("5,000,000.00 USD"); // the target
    expect(warning).toContain("9,000,000.00 USD"); // the resulting committed total
    expect(warning).toContain("4,000,000.00 USD"); // the overage
    // R130.1 — a goal, not a limit, and never a refusal.
    expect(warning).toContain("not a limit");
    expect(warning.toLowerCase()).not.toContain("not accepted");
    expect(warning.toLowerCase()).not.toContain("nothing was saved");

    // The sentence is the SHARED one, byte-for-byte — no rival wording.
    expect(warning).toBe(
      spvTargetRaiseWarningSentence(
        {
          capMinor: null,
          confirmedCapitalMinor: 0,
          softCircledInterestMinor: 0,
          wiredNotCommittedMinor: 0,
          requestedMinor: 900_000_000,
          resultingTotalMinor: 900_000_000,
          overageMinor: 0,
          currency: "USD",
          targetRaiseMinor: 500_000_000,
        },
        2,
      ),
    );

    // THE RECORDED OUTCOME IS UNCHANGED — read through the store's own reader.
    const recorded = spvEngineStore.targetOveragesForSpv(PARTNER_ID, spvId);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0].reasonCode).toBe("TARGET_RAISE_EXCEEDED");
    expect(recorded[0].blocked).toBe(false);
    expect(recorded[0].targetRaiseMinor).toBe(500_000_000);
  });

  it("THE K-1 PIN — recording the overage does not destroy terms._fundsConfirmations", async () => {
    const spvId = await newSpv("W176 k1 pin vehicle", {
      targetRaiseMinor: 100_000_000,
      capMinor: null,
      terms: { _fundsConfirmations: { inv_pin: { confirmedByInvestor: true } } },
    });
    const r = await commit(spvId, "w176pin@example.com", "5000000");
    expect(r.status).toBe(201);
    expect(r.body.targetRaise.exceeded).toBe(true);
    const terms = (spvEngineStore.getSpv(PARTNER_ID, spvId)!.terms ?? {}) as Record<string, unknown>;
    expect(terms._fundsConfirmations).toEqual({ inv_pin: { confirmedByInvestor: true } });
    expect(terms._targetOverages).toBeTruthy();
  });

  it("NEGATIVE CONTROL — a commit UNDER the target returns exceeded=false and an empty warning", async () => {
    const spvId = await newSpv("W176 under target vehicle", { targetRaiseMinor: 500_000_000, capMinor: null });
    const r = await commit(spvId, "w176b@example.com", "2000000");
    expect(r.status).toBe(201);
    expect(r.body.targetRaise.exceeded).toBe(false);
    expect(r.body.targetRaise.warning).toBe("");
    expect(spvEngineStore.targetOveragesForSpv(PARTNER_ID, spvId)).toEqual([]);
  });

  it("NEGATIVE CONTROL — a vehicle with NO target raise never warns (null is not a target of zero)", async () => {
    const spvId = await newSpv("W176 no target vehicle", { targetRaiseMinor: null, capMinor: null });
    const r = await commit(spvId, "w176c@example.com", "9000000");
    expect(r.status).toBe(201);
    expect(r.body.targetRaise.exceeded).toBe(false);
    expect(r.body.targetRaise.warning).toBe("");
  });

  it("ITEM A's server truth, pinned: a commit with NO units is REFUSED, so the client gate is correct", async () => {
    const spvId = await newSpv("W176 units required vehicle", { targetRaiseMinor: 500_000_000, capMinor: null });
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Lp",
      holderLastName: "Holder",
      investorEmail: "w176units@example.com",
      amount: "1000000",
      shares: "",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("COMMIT_FIELDS_REQUIRED");
    expect(String(r.body.message).toLowerCase()).toContain("units");
  });
});
