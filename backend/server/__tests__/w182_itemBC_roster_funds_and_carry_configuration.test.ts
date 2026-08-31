/**
 * WAVE 182 · ITEMS B AND C — THE TWO FACTS THE SCREEN COULD NOT SAY.
 *
 * ITEM B (R152.3) — LP STATUS NEVER READS "CONFIRMED". The two-step flow (commit,
 * then confirm funds received) is CORRECT and is not changed by this wave. The
 * defect is vocabulary: the roster read "Committed" both before AND after the
 * general partner confirmed the wire, so the LP register could not tell a promise
 * from money in the account. This test proves the ROSTER PAYLOAD now carries the
 * distinction, derived from the `terms._fundsConfirmations` record the platform
 * has persisted all along — a display fix, not a schema change.
 *
 *   · The existing `status` literal is asserted UNCHANGED ("committed" for both
 *     LPs). R143.1: a REPLACED text node scores as REMOVED copy, so the fix had to
 *     be an additional field, never a rename.
 *   · `_fundsConfirmations` is asserted to SURVIVE, read back through the store's
 *     own getter. R152/R144: `terms` merges are one level deep, and a careless
 *     write here destroys every K-1.
 *
 * ITEM C (R152.4 item 4) — A DEAD CARRY PROMISE ON THE FEE SURFACE. The SPV card
 * read "Carry: Per deployment" for a vehicle whose Fees tab held one flat
 * management fee and no carry at all. `carryBasis` is a real field and was
 * rendered correctly; it answers over WHAT a carry would be computed, not WHETHER
 * one is charged. This test drives all three fee shapes the owner named — carry
 * only, hybrid (carry + flat), and fixed-only-with-no-carry — plus the two states
 * the shapes do not cover: no fee schedule at all, and a hybrid layer with a null
 * `carryPct` (a flat component and no agreed percentage, which is NOT a configured
 * carry).
 *
 * NEVER FABRICATE 0%. An unconfigured carry and a 0% carry are different facts.
 * Every assertion below therefore also checks that the served sentence contains NO
 * percentage and NO money figure — the surface states the fact in words or says
 * nothing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { spvEngineStore } from "../spvEngineStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvCarryConfiguration } from "@shared/spvCarryConfiguration";

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
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

async function newSpv(name: string): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  return c.body.spv.id as string;
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

/* ══════════════════════════════ ITEM B ══════════════════════════════════ */
describe("W182 ITEM B — the roster distinguishes a promise from received funds", () => {
  it("two LPs, one funds-confirmed and one not: same status literal, different funds fact", async () => {
    const spvId = await newSpv("W182 B Roster");
    for (const [first, email, amount] of [
      ["Confirmed", "b-confirmed@example.com", "300000"],
      ["Awaiting", "b-awaiting@example.com", "150000"],
    ] as const) {
      const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
        ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
        holderFirstName: first, holderLastName: "Lp",
        investorEmail: email, amount, shares: "10",
      });
      expect(r.status).toBe(201);
    }
    const subs = spvEngineStore.listSubscriptions(PARTNER_ID, spvId);
    expect(subs.length).toBe(2);
    const confirmedId = subs[0].investorId;
    const awaitingId = subs[1].investorId;

    const confirm = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${confirmedId}/confirm-funds`,
      { receivedMinor: 300000_00, reference: "WIRE-B" },
    );
    expect(confirm.status).toBe(201);

    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(roster.status).toBe(200);
    const rows = roster.body.subscribers as Array<Record<string, unknown>>;
    const rowFor = (id: string) => rows.find((r) => r.investorId === id)!;

    /* THE DISTINCTION EXISTS. */
    expect(rowFor(confirmedId).fundsConfirmed).toBe(true);
    expect(rowFor(awaitingId).fundsConfirmed).toBe(false);

    /* AND THE EXISTING VOCABULARY IS UNTOUCHED — both rows still read the same
       `status`, because the fix adds a fact and renames nothing. */
    expect(rowFor(confirmedId).status).toBe("committed");
    expect(rowFor(awaitingId).status).toBe("committed");

    /* THE K-1 PIN: the durable confirmation record survived, read through the
       store's own getter rather than by reaching into `terms`. */
    const confirmations = spvEngineStore.confirmedByInvestor(PARTNER_ID, spvId);
    expect(confirmations[confirmedId]).toBeDefined();
    expect(confirmations[awaitingId]).toBeUndefined();
  });
});

/* ══════════════════════════════ ITEM C ══════════════════════════════════ */
describe("W182 ITEM C — the card cannot promise a carry that is not configured", () => {
  /* No percentage and no money figure may appear in anything served for this
     surface: stating 0% for an unconfigured carry is the specific fabrication the
     owner forbade, and a figure is what would make it possible. */
  function expectNoNumbers(statement: string) {
    expect(statement).not.toMatch(/\d/);
    expect(statement).not.toMatch(/[%$€£]/);
  }

  async function carryFor(spvId: string): Promise<{ state: string; statement: string }> {
    const list = await get("/api/partner/me/spv");
    expect(list.status).toBe(200);
    const found = (list.body.carryConfigurations as Array<{ spvId: string; state: string; statement: string }>)
      .find((c) => c.spvId === spvId);
    expect(found).toBeDefined();
    return found!;
  }

  it("SHAPE 1 — carry only: reported as configured", async () => {
    const spvId = await newSpv("W182 C Carry Only");
    /* `carryPct` is a FRACTION (0..1) in this engine, not a percent — `validateFeeDraft`
       refuses anything above 1. 0.2 is twenty percent. */
    spvEngineStore.addFee(PARTNER_ID, spvId, { layer: "management", feeType: "carry", carryPct: 0.2, currency: "USD" }, MANAGING);
    const cc = await carryFor(spvId);
    expect(cc.state).toBe("configured");
    expect(cc.statement.toLowerCase()).toContain("carry is configured");
    expectNoNumbers(cc.statement);
  });

  it("SHAPE 2 — hybrid (carry + flat): configured, and it says the flat fee is there too", async () => {
    const spvId = await newSpv("W182 C Hybrid");
    spvEngineStore.addFee(
      PARTNER_ID, spvId,
      { layer: "management", feeType: "hybrid", fixedAmountMinor: 10_000_00, carryPct: 0.15, currency: "USD" },
      MANAGING,
    );
    const cc = await carryFor(spvId);
    expect(cc.state).toBe("configured");
    expect(cc.statement.toLowerCase()).toContain("flat fee");
    expectNoNumbers(cc.statement);
  });

  it("SHAPE 3 — fixed only, no carry (the live defect): says plainly that no carry is configured", async () => {
    const spvId = await newSpv("W182 C Fixed Only");
    spvEngineStore.addFee(
      PARTNER_ID, spvId,
      { layer: "management", feeType: "fixed", fixedAmountMinor: 10_00, currency: "USD" },
      MANAGING,
    );
    const cc = await carryFor(spvId);
    expect(cc.state).toBe("not_configured");
    expect(cc.statement.toLowerCase()).toContain("no carry is configured");
    /* AND IT DOES NOT SAY ZERO. This is the assertion that fences the forbidden
       fabrication: "0%" would satisfy a careless reading of "state it plainly". */
    expect(cc.statement).not.toContain("0%");
    expect(cc.statement.toLowerCase()).not.toContain("zero");
    expectNoNumbers(cc.statement);
  });

  it("SHAPE 4 — no fee schedule at all: distinguished from a configured fee with no carry", async () => {
    const spvId = await newSpv("W182 C No Fees");
    const cc = await carryFor(spvId);
    expect(cc.state).toBe("no_fee_schedule");
    expect(cc.statement.toLowerCase()).toContain("no fee schedule");
    expectNoNumbers(cc.statement);
  });

  it("SHAPE 5 — a hybrid layer with a NULL carryPct is NOT a configured carry", () => {
    /* The trap in the middle of the rule. A hybrid fee has a flat component; if
       nobody recorded a carry percentage, there is no carry anyone agreed to, and
       calling this "configured" would put the dead promise straight back on the card.

       TESTED AT THE PURE FUNCTION, NOT THROUGH `addFee`, AND THAT IS THE HONEST
       PLACE FOR IT: `validateFeeDraft` refuses a non-fixed fee with a null
       `carryPct` (`CARRY_PCT_REQUIRED`), so this row cannot be created through the
       engine today and driving it through the route would prove nothing. The rule is
       still asserted, because a row like this can arrive from a legacy import or a
       future relaxation of that validator, and the classification must not depend on
       the validator staying strict. */
    expect(
      spvCarryConfiguration({ fees: [{ feeType: "hybrid", carryPct: null }], feeViewUnreliable: false }).state,
    ).toBe("not_configured");
    /* And the same guard for a `carry` layer with no percentage. */
    expect(
      spvCarryConfiguration({ fees: [{ feeType: "carry", carryPct: null }], feeViewUnreliable: false }).state,
    ).toBe("not_configured");
  });

  it("SHAPE 6 — an UNREADABLE fee schedule is never reported as 'no carry'", () => {
    /* A failed hydration is not evidence about a vehicle's terms. Reporting it as
       "no carry configured" would turn a database problem into a false statement on
       a fee surface. */
    const cc = spvCarryConfiguration({ fees: [], feeViewUnreliable: true });
    expect(cc.state).toBe("unreadable");
    expect(cc.statement.toLowerCase()).toContain("could not be read");
    expect(cc.statement.toLowerCase()).not.toContain("no carry is configured");
  });

  it("the SPV list payload itself is unchanged — `spvs` still carries every field it did", async () => {
    /* `carryConfigurations` is ADDITIVE. If it had been folded into `SpvDTO`, a fee
       fact would now be inside every SPV reader in the platform. */
    const spvId = await newSpv("W182 C Additive Check");
    const list = await get("/api/partner/me/spv");
    const row = (list.body.spvs as Array<Record<string, unknown>>).find((s) => s.id === spvId)!;
    expect(row.carryBasis).toBe("whole_spv");
    expect(row).not.toHaveProperty("carryConfigured");
    expect(row).not.toHaveProperty("carryStatement");
  });
});
