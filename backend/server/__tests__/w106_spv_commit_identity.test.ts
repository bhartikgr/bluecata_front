/**
 * WAVE 106 · FINDING 1 — A COMMITMENT MUST BE RECORDED AGAINST A PERSON.
 *
 * The defect: an LP was invited by name and email; the "Commit an LP to the cap
 * table" form was then filled in with the SAME name and email plus $10,000, and
 * the roster came back with TWO unlinked rows — an anonymous "Pending member"
 * holding the money, and the named LP still "invited", holding nothing. The name
 * and email typed into the commit form were accepted by the route, passed to the
 * ledger, and then dropped by the projection that seats the subscriber
 * (`spvEngineStore.projectLpCommitted`, which has no name or email parameter).
 *
 * These tests fail on the pre-wave code:
 *   · roster.subscribers[0].name was "Pending member", not "Ozan Isinak";
 *   · roster.invites still contained the same person, so the roster showed two;
 *   · a commit with no name and no email was ACCEPTED as an anonymous row.
 *
 * They also pin the thing that makes the defect dangerous rather than merely
 * ugly: every reader that reports "how much has this vehicle raised" must report
 * the SAME number, asserted against each other in one comparison rather than
 * separately against a literal.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvK1Routes } from "../spvK1Routes";
import { registerSpvNavRoutes } from "../spvNavRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { committedRegisterRows } from "../spvNavStore";

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
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvK1Routes(app);
  registerSpvNavRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W106 F1 — a commitment carries the identity that was entered", () => {
  it("seats the committed LP under the name typed into the commit form", async () => {
    const spvId = await newSpv("W106 Identity SPV");
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      holderFirstName: "Dana",
      holderLastName: "Whitfield",
      investorEmail: "dana@example.com",
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(201);

    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(roster.status).toBe(200);
    const subs = roster.body.subscribers as Array<{ name: string | null; email: string | null; commitmentMinor: number }>;
    expect(subs).toHaveLength(1);
    /* The precise pre-wave failure: this read "Pending member". */
    expect(subs[0].name).toBe("Dana Whitfield");
    expect(subs[0].email).toBe("dana@example.com");
    expect(subs[0].commitmentMinor).toBe(1000000);
    /* No anonymous placeholder may appear anywhere on a roster with money on it. */
    expect(JSON.stringify(roster.body)).not.toContain("Pending member");
  });

  it("matches an existing invited LP on the same SPV by email instead of creating a second record — case-insensitively and trimmed", async () => {
    const spvId = await newSpv("W106 Match SPV");
    const inv = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email: "ozan@capavate.com",
      firstName: "Ozan",
      lastName: "Isinak",
    });
    expect(inv.status).toBe(201);

    /* Deliberately different case AND surrounding whitespace. */
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      holderFirstName: "Ozan",
      holderLastName: "Isinak",
      investorEmail: "   Ozan@Capavate.COM  ",
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(201);
    expect(cm.body.lp?.matchedExistingInvite).toBe(true);

    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    const subs = roster.body.subscribers as Array<{ name: string | null; email: string | null }>;
    const invites = roster.body.invites as Array<{ email: string }>;

    /* ONE limited partner, on ONE row. Pre-wave this was two rows: an anonymous
       subscriber holding the money and this invite still listed as pending. */
    expect(subs).toHaveLength(1);
    expect(subs[0].name).toBe("Ozan Isinak");
    expect(subs[0].email).toBe("ozan@capavate.com");
    expect(invites.filter((i) => i.email.toLowerCase() === "ozan@capavate.com")).toHaveLength(0);
  });

  it("refuses a commit that carries no identity, in plain English, rather than recording an anonymous holder", async () => {
    const spvId = await newSpv("W106 Refusal SPV");
    const bad = await post(`/api/partner/me/spv/${spvId}/lp-commit`, { amount: "5000", shares: "5000" });

    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const message = String(bad.body?.message ?? "");
    /* A refusal a human can act on: it must name what is missing, in words. */
    expect(message.length).toBeGreaterThan(10);
    expect(message.toLowerCase()).toMatch(/name/);
    expect(message).not.toMatch(/[a-z]+[A-Z]/); // no camelCase field names in the sentence
    expect(message).not.toMatch(/_/); // no snake_case field names either

    /* And nothing was written. */
    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(roster.body.subscribers).toHaveLength(0);
    expect(spvEngineStore.committedRegister(PARTNER_ID, spvId).reduce((a, r) => a + r.commitmentMinor, 0)).toBe(0);
  });

  it("every downstream reader reports the SAME committed total, compared against each other", async () => {
    const spvId = await newSpv("W106 Readers SPV");
    await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email: "lee@example.com",
      firstName: "Lee",
      lastName: "Sang-min",
    });
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      holderFirstName: "Lee",
      holderLastName: "Sang-min",
      investorEmail: "LEE@example.com",
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(201);

    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    const detail = await get(`/api/partner/me/spv/${spvId}`);
    const close = await get(`/api/partner/me/spv/${spvId}/close-summary`);

    const sum = (rows: Array<{ commitmentMinor: number }>) => rows.reduce((a, r) => a + r.commitmentMinor, 0);

    /* The five readers named in the pre-flight, each by its own query:
     *  1. GP roster            → listSubscriptions       (spvEngineRoutes lp-roster)
     *  2. investor register    → investorRegister        (also the fund commitment register,
     *                            partnerRoutes /funds/:id/commitments)
     *  3. committed register   → committedRegister
     *  4. close summary        → computeCloseSummary     (spvOfflineOps)
     *  5. NAV + K-1            → committedRegisterRows   (raw SQL on spv_subscription,
     *                            spvNavStore; consumed by spvK1Routes too)
     */
    const readings: Record<string, number> = {
      gpRoster: sum(roster.body.subscribers as Array<{ commitmentMinor: number }>),
      investorRegister: sum(spvEngineStore.investorRegister(PARTNER_ID, spvId) as Array<{ commitmentMinor: number }>),
      committedRegister: sum(spvEngineStore.committedRegister(PARTNER_ID, spvId) as Array<{ commitmentMinor: number }>),
      closeSummaryConfirmed: Number(close.body?.confirmedMinor ?? close.body?.summary?.confirmedMinor ?? NaN),
      navAndK1Rows: sum(committedRegisterRows(spvId) as Array<{ commitmentMinor: number }>),
      detailRegister: sum((detail.body?.register ?? []) as Array<{ commitmentMinor: number }>),
    };

    /* Asserted against EACH OTHER, not separately against a literal: the defect
       this guards is disagreement between readers, so the test must fail if any
       one of them drifts, whatever the number happens to be. */
    const distinct = Array.from(new Set(Object.values(readings)));
    expect({ readings, distinct }).toEqual({ readings, distinct: [readings.gpRoster] });
    expect(readings.gpRoster).toBeGreaterThan(0);
  });
});
