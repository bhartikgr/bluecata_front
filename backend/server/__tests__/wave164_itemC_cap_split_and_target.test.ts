/**
 * WAVE 164 · BATCH 3 · ITEM C — THE SPLIT (R133.1) AND TARGET-vs-CAP (R130).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG.
 * ═══════════════════════════════════════════════════════════════════════════════
 * (1) The cap gate threw the bare string `EXCEEDS_CAP` and `PartnerSpvDetail.tsx`
 *     renders `e.message` RAW, so a machine code reached a GP — an R77 violation.
 *     Nothing anywhere named how much of the occupied capacity was actually
 *     CAPITAL as opposed to soft-circled interest, which is exactly the confusion
 *     R133.1 rules on: a soft-circle DOES occupy cap capacity, and every refusal
 *     and every audit record must state the split SEPARATELY LABELLED.
 * (2) The cap-override audit record carried `capMinor`, `resultingTotalMinor` and
 *     `overageMinor` only, so it could assert an overage with no statement of how
 *     much capital existed behind it.
 * (3) The TARGET raise had no treatment at all: R130 rules that passing a target
 *     WARNS AND RECORDS and NEVER BLOCKS, under a DISTINCT reason code in a
 *     DISTINCT terms key, so a target overage can never be read as a cap breach.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * · `spv_subscription` has ZERO rows on every database this wave can see, so
 *   nothing here asserts "existing records unchanged" over an empty table. Every
 *   register below is CONSTRUCTED through the REAL writers (the subscription
 *   route, the stage-advance route, `projectLpCommitted`) at named stages, with
 *   non-round sentinel amounts no seed or migration in this tree carries.
 * · §1 asserts a REAL HTTP RESPONSE — status, body and rendered sentence — from
 *   the lp-commit route, because the defect was in what a person is served.
 * · §5 proves the ONE-LEVEL `terms` merge survives three sequential writes of
 *   three different keys, which is the failure mode that destroys `_funds-
 *   Confirmations` and breaks every K-1.
 * · The capacity BASIS is asserted UNCHANGED (§2.3): this wave augments the
 *   refusal and the record, it does not move the gate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import {
  spvEngineStore,
  capBasisCommittedMinorForSpv,
  canonicalCommittedMinorForSpv,
  isSpvCapRefusalError,
  spvCapSplitFiguresForSpv,
} from "../spvEngineStore";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";
import {
  TARGET_RAISE_EXCEEDED_CODE,
  SPV_TARGET_OVERAGES_TERMS_KEY,
  SPV_CAP_OVERRIDES_TERMS_KEY,
  SPV_CAP_BLANK_LABEL,
  spvCapSplitRefusalSentence,
  spvCapSplitRows,
} from "@shared/spvCapSplitDisclosure";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* Non-round sentinels. No seed, migration or default in this tree carries them,
   so a figure matching one can only have come from this fixture. */
const CONFIRMED_MINOR = 4_100_029; //   $41,000.29 — real committed capital
const SOFT_CIRCLE_MINOR = 7_300_047; // $73,000.47 — interest, NOT capital
const WIRED_MINOR = 1_900_013; //       $19,000.13 — funds in, not committed
const CAP_MINOR = 9_000_000; //         $90,000.00 — passed by soft+confirmed
const REQUEST_MINOR = 2_600_011; //     $26,000.11 — the commitment that refuses

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});

/** The lp-commit route's REAL contract, verified at spvEngineRoutes.ts:1443-1465:
 *  whole-unit `amount`, `shares`, `holderFirstName`, `holderLastName`,
 *  `investorEmail`. It derives its own investorId from the email, so a test that
 *  posted `investorId`/`commitmentMinor` would be refused for missing fields and
 *  would prove nothing. Amounts are passed as whole-unit STRINGS — the route
 *  converts with `decimalStringToMinor`, never `Number()`. */
function lpCommit(spvId: string, email: string, wholeUnits: string, extra: Record<string, unknown> = {}) {
  return post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
    ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
    holderFirstName: "W164",
    holderLastName: email.split("@")[0],
    investorEmail: email,
    amount: wholeUnits,
    shares: "1000",
    currency: "USD",
    ...extra,
  });
}
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

/** A subscription at a NAMED stage, built through the REAL writers only. */
async function subscribeAt(spvId: string, investorId: string, minor: number, stage: string): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: minor,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const subId = sub.body.subscription.id as string;
  if (stage === "review") return subId;
  if (stage === SPV_COMMITTED_SUBSCRIPTION_STATUS) {
    const p = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId,
      commitmentMinor: minor,
      currency: "USD",
    });
    expect(p.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    return subId;
  }
  const ladder: Record<string, string[]> = {
    soft_circled: ["soft_circled"],
    founder_confirmed: ["soft_circled", "founder_confirmed"],
    wire_funded: ["soft_circled", "founder_confirmed", "wire_funded"],
    withdrawn: ["withdrawn"],
  };
  for (const to of ladder[stage] ?? [stage]) {
    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
    expect(res.status, `advance to ${to}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  return subId;
}

/** THE CAP, SET AFTER THE REGISTER EXISTS.
 *  A cap cannot be set up-front and then filled past, because the subscription
 *  route's own cap gate — correctly — refuses the very rows the fixture needs. A
 *  real over-cap vehicle arises the same way: rows exist, then the cap is lowered
 *  or was always lower than the interest that accumulated. This is a store write,
 *  not a bypass of the gate under test: the gate is exercised afterwards. */
/** The committed-only gates (KYC, accreditation, e-sign), cleared through the
 *  REAL compliance route. Verified against `spvEngineStore.gateStatus:1408`. */
async function clearCommitGates(investorId: string): Promise<void> {
  const r = await request(app)
    .put(`/api/partner/me/compliance/${investorId}`)
    .set("x-user-id", MANAGING)
    .send({ kycStatus: "verified", accreditationStatus: "self_certified" });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
}

function setCap(spvId: string, capMinor: number | null): void {
  spvEngineStore.updateSpv(PARTNER, spvId, { capMinor }, MANAGING);
  expect(spvEngineStore.getSpv(PARTNER, spvId)?.capMinor ?? null).toBe(capMinor);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §1 — T-C.2 + T-C.3. THE CAP REFUSAL, OVER A REAL HTTP RESPONSE.
   A soft-circle occupies capacity AND is named as soft-circled interest rather
   than as committed capital, and no bare code reaches the caller.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§1 cap refusal names the split over a real HTTP response", () => {
  let spvId = "";

  beforeAll(async () => {
    spvId = await createSpv("W164 Cap Split Vehicle");
    await subscribeAt(spvId, "inv_w164_confirmed", CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, "inv_w164_soft", SOFT_CIRCLE_MINOR, "soft_circled");
    setCap(spvId, CAP_MINOR);
  });

  it("1.1 the register really holds one committed and one soft-circled row", () => {
    const rows = db()
      .prepare(`SELECT investor_id, status, commitment_minor FROM spv_subscription WHERE spv_id = ?`)
      .all(spvId) as Array<{ investor_id: string; status: string; commitment_minor: number }>;
    const byInv = Object.fromEntries(rows.map((r) => [r.investor_id, r]));
    expect(byInv["inv_w164_confirmed"].status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(byInv["inv_w164_confirmed"].commitment_minor).toBe(CONFIRMED_MINOR);
    expect(byInv["inv_w164_soft"].status).toBe("soft_circled");
    expect(byInv["inv_w164_soft"].commitment_minor).toBe(SOFT_CIRCLE_MINOR);
  });

  it("1.2 T-C.3 — the soft-circle DOES occupy cap capacity but is NOT capital", () => {
    /* R133.1's two halves, asserted against each other. The capacity basis counts
       the soft-circle; canonical committed capital does not. If these two ever
       became equal, either the cap stopped counting interest or interest started
       being reported as capital, and both are the defect. */
    expect(capBasisCommittedMinorForSpv(spvId)).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    /* `canonicalCommittedMinorForSpv` answers a BigInt — money in this tree does
       not pass through Number — so it is compared against a BigInt, not coerced. */
    expect(canonicalCommittedMinorForSpv(spvId)).toBe(BigInt(CONFIRMED_MINOR));
    expect(BigInt(capBasisCommittedMinorForSpv(spvId))).toBeGreaterThan(
      canonicalCommittedMinorForSpv(spvId),
    );
  });

  it("1.3 T-C.2 — the refusal body names all five figures, separately labelled", async () => {
    /* The REFUSING path is the subscription route (`spvEngineStore.subscribe`),
       NOT `lp-commit`: lp-commit is warn-and-record by R105 and deliberately does
       not refuse, so asserting a 400 there would assert the opposite of the
       ruling. Verified at spvEngineRoutes.ts:1627-1639. */
    const res = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
      investorId: "inv_w164_overcap",
      commitmentMinor: REQUEST_MINOR,
      currency: "USD",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);

    /* R98 — the shipped machine contract is UNCHANGED. Every existing assertion
       on `error === "EXCEEDS_CAP"` still holds; the split rides alongside it. */
    expect(res.body.error).toBe("EXCEEDS_CAP");

    const split = res.body.capSplit;
    expect(split, JSON.stringify(res.body)).toBeTruthy();
    expect(split.capMinor).toBe(CAP_MINOR);
    expect(split.confirmedCapitalMinor).toBe(CONFIRMED_MINOR);
    expect(split.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);
    expect(split.requestedMinor).toBe(REQUEST_MINOR);
    expect(split.resultingTotalMinor).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR + REQUEST_MINOR);
    expect(split.overageMinor).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR + REQUEST_MINOR - CAP_MINOR);

    /* The SENTENCE a person reads, not the JSON. It must be prose, must name every
       figure with its own label, and must not be a code. */
    /* THE HEADLINE is what `PartnerSpvDetail.tsx:267/:314` renders from
       `e.message`, so it — not only the long guidance — must be prose and must name
       the four figures the brief lists separately, plus a next step. */
    const headline = String(res.body.message ?? "");
    expect(headline).not.toBe("EXCEEDS_CAP");
    expect(headline).not.toMatch(/EXCEEDS_CAP/);
    for (const label of ["cap of", "Confirmed capital", "soft-circled interest", "over its cap"]) {
      expect(headline, `missing label ${label} in: ${headline}`).toContain(label);
    }
    for (const amount of ["90,000.00", "41,000.29", "73,000.47", "50,000.87"]) {
      expect(headline, `missing amount ${amount} in: ${headline}`).toContain(amount);
    }
    /* R77 — a next step, not just a diagnosis. */
    expect(headline).toMatch(/Reduce the amount or free capacity/);

    /* THE GUIDANCE carries the full five-figure statement including the requested
       amount, the funds-received figure and the resulting total — the two figures
       the 240-character headline ceiling cannot fit. */
    const guidance = String(res.body.guidance ?? "");
    for (const label of [
      "confirmed capital",
      "soft-circled interest",
      "received as funds",
      "total occupying capacity",
      "above the cap",
      "Next step",
    ]) {
      expect(guidance, `missing label ${label} in guidance`).toContain(label);
    }
    expect(guidance).toContain("26,000.11");
    expect(guidance).toContain("140,000.87");
  });

  it("1.4 the sentence is under the 240-char ceiling the client applies, or is served as guidance", async () => {
    /* `client/src/lib/queryClient.ts:60-65` DISCARDS any server `message` of 240
       characters or more. A sentence naming five figures that the client then
       throws away would be a paper fix, so the headline is asserted short enough
       to survive that filter and the long prose is carried as `guidance`. */
    const res = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
      investorId: "inv_w164_overcap_len",
      commitmentMinor: REQUEST_MINOR,
      currency: "USD",
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message ?? "").length).toBeLessThan(240);
  });

  it("1.5 the thrown error is recognisable and carries the split on the object", () => {
    let caught: unknown = null;
    try {
      spvEngineStore.subscribe(PARTNER, spvId, {
        investorId: "inv_w164_direct",
        commitmentMinor: REQUEST_MINOR,
        currency: "USD",
      } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect((caught as Error).message).toBe("EXCEEDS_CAP");
    expect(isSpvCapRefusalError(caught)).toBe(true);
    expect((caught as any).capSplit.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §2 — T-C.4. BLANK CAP IS NO CAP; A CAP OF ZERO IS NOT "NO CAP".
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§2 blank cap versus a cap of zero", () => {
  it("2.1 a blank cap accepts a commitment of any size and records no override", async () => {
    const spvId = await createSpv("W164 No Cap Vehicle");
    const res = await lpCommit(spvId, "nocap.w164@example.com", "9900000.00");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(spvEngineStore.getSpv(PARTNER, spvId)?.capMinor ?? null).toBeNull();
    expect(spvEngineStore.capOverridesForSpv(PARTNER, spvId)).toHaveLength(0);
  });

  it("2.2 the blank-cap label is words, never the number zero", () => {
    expect(SPV_CAP_BLANK_LABEL).toBe("no maximum");
    const rows = spvCapSplitRows(
      {
        capMinor: null,
        confirmedCapitalMinor: CONFIRMED_MINOR,
        softCircledInterestMinor: 0,
        wiredNotCommittedMinor: 0,
        requestedMinor: 0,
        resultingTotalMinor: CONFIRMED_MINOR,
        overageMinor: 0,
        currency: "USD",
      },
      2,
    );
    const capRow = rows.find((r) => r.label.startsWith("Cap"));
    expect(capRow?.value).toBe(SPV_CAP_BLANK_LABEL);
    expect(capRow?.value).not.toMatch(/0/);
  });

  it("2.3 the capacity BASIS is unchanged by this wave — figures follow the gate", () => {
    /* The split is built from a `resultingTotalMinor` the CALLER supplies, so the
       disclosure can never contradict whichever gate asked for it. Asserted here
       so a later builder cannot make the split recompute its own total. */
    const figures = spvCapSplitFiguresForSpv({
      spvId: "spv_does_not_exist_w164",
      capMinor: 500,
      requestedMinor: 100,
      resultingTotalMinor: 12_345,
      currency: "USD",
    });
    expect(figures.resultingTotalMinor).toBe(12_345);
    expect(figures.overageMinor).toBe(12_345 - 500);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §3 — T-C.1. THE TARGET RAISE WARNS AND RECORDS AND NEVER BLOCKS,
   on each of the writers, under its own reason code and its own terms key.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§3 target raise warns and records, never blocks", () => {
  const TARGET = 5_000_000; // $50,000.00 — passed by the confirmed row alone

  it("3.1 projectLpCommitted: the write SUCCEEDS past the target and is recorded", async () => {
    const spvId = await createSpv("W164 Target projectLpCommitted", { targetRaiseMinor: TARGET });
    await subscribeAt(spvId, "inv_w164_t1", CONFIRMED_MINOR + TARGET, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const overages = spvEngineStore.targetOveragesForSpv(PARTNER, spvId);
    expect(overages.length).toBeGreaterThanOrEqual(1);
    const rec = overages[0];
    expect(rec.reasonCode).toBe(TARGET_RAISE_EXCEEDED_CODE);
    expect(rec.blocked).toBe(false);
    expect(rec.targetRaiseMinor).toBe(TARGET);
    expect(rec.confirmedCapitalMinor).toBe(CONFIRMED_MINOR + TARGET);
    expect(rec.targetOverageMinor).toBe(CONFIRMED_MINOR);
    expect(rec.writer).toMatch(/projectLpCommitted/);
    /* The SPV is still open for business: nothing was blocked. */
    expect(canonicalCommittedMinorForSpv(spvId)).toBe(BigInt(CONFIRMED_MINOR + TARGET));
  });

  it("3.2 advanceSubscription: reaching committed past the target records the split", async () => {
    const spvId = await createSpv("W164 Target advanceSubscription", { targetRaiseMinor: TARGET });
    const subId = await subscribeAt(spvId, "inv_w164_t2", CONFIRMED_MINOR + TARGET, "wire_funded");
    /* The three committed-only compliance gates are SATISFIED, not bypassed. They
       are pre-existing and this wave must not relax them, so the fixture clears
       them the way a real GP does and then exercises `advanceSubscription` through
       its own route. A store-level shortcut here would have left the route path
       — the one a GP actually uses — unproven. */
    await clearCommitGates("inv_w164_t2");
    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: SPV_COMMITTED_SUBSCRIPTION_STATUS,
      subscriptionDocRef: "sig_w164_t2",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.subscription.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const overages = spvEngineStore.targetOveragesForSpv(PARTNER, spvId);
    expect(overages).toHaveLength(1);
    expect(overages[0].writer).toBe("advanceSubscription");
    expect(overages[0].reasonCode).toBe(TARGET_RAISE_EXCEEDED_CODE);
    expect(overages[0].targetOverageMinor).toBe(CONFIRMED_MINOR);
    expect(overages[0].blocked).toBe(false);
  });

  it("3.3 a target overage is NEVER written under the cap-override key", async () => {
    const spvId = await createSpv("W164 Target Not A Cap", { targetRaiseMinor: TARGET });
    await subscribeAt(spvId, "inv_w164_t3", CONFIRMED_MINOR + TARGET, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const terms = (spvEngineStore.getSpv(PARTNER, spvId)?.terms ?? {}) as Record<string, unknown>;
    expect(terms[SPV_TARGET_OVERAGES_TERMS_KEY]).toBeTruthy();
    expect(terms[SPV_CAP_OVERRIDES_TERMS_KEY]).toBeUndefined();
    expect(spvEngineStore.capOverridesForSpv(PARTNER, spvId)).toHaveLength(0);
    /* And the two codes can never collide. */
    expect(TARGET_RAISE_EXCEEDED_CODE).not.toBe("EXCEEDS_CAP");
  });

  it("3.4 a target at or under the total records NOTHING, and a blank target never does", async () => {
    const under = await createSpv("W164 Target Not Passed", { targetRaiseMinor: 99_000_000_00 });
    await subscribeAt(under, "inv_w164_t4", CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(spvEngineStore.targetOveragesForSpv(PARTNER, under)).toHaveLength(0);

    /* A blank target must not be coerced to 0 — that would make EVERY commit an
       overage, which is the mirror of the cap defect. */
    const blank = await createSpv("W164 Target Blank");
    await subscribeAt(blank, "inv_w164_t5", CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(spvEngineStore.getSpv(PARTNER, blank)?.targetRaiseMinor ?? null).toBeNull();
    expect(spvEngineStore.targetOveragesForSpv(PARTNER, blank)).toHaveLength(0);
  });

  it("3.5 R135.3 — recording cannot fail a write that has already succeeded", () => {
    /* `_noteTargetRaiseOverage` is the never-throws wrapper the writers call. If a
       later builder makes it throw, the commit becomes blocked by a RECORDING
       surface, which is the new blocking gate R135.3 forbids. */
    expect(() =>
      spvEngineStore._noteTargetRaiseOverage(PARTNER, "spv_absent_w164", {
        investorId: "inv_w164_absent",
        writer: "test",
      }),
    ).not.toThrow();
    expect(
      spvEngineStore._noteTargetRaiseOverage(PARTNER, "spv_absent_w164", {
        investorId: "inv_w164_absent",
        writer: "test",
      }),
    ).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §4 — THE CAP-OVERRIDE AUDIT RECORD CARRIES THE SAME SPLIT (brief item 3),
   so no record can assert an overage that does not exist in capital.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§4 the override record carries the split", () => {
  it("4.1 an accepted over-cap commitment records cap, capital, interest and overage", async () => {
    const spvId = await createSpv("W164 Override Split");
    await subscribeAt(spvId, "inv_w164_o1", CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, "inv_w164_o2", SOFT_CIRCLE_MINOR, "soft_circled");
    setCap(spvId, CAP_MINOR);
    /* lp-commit is WARN-AND-RECORD (R105): it does not refuse, it records. That is
       the path that must carry the split into the durable record. */
    const res = await lpCommit(spvId, "o3.w164@example.com", "26000.11");
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const overrides = spvEngineStore.capOverridesForSpv(PARTNER, spvId);
    expect(overrides).toHaveLength(1);
    const o = overrides[0] as any;
    expect(o.capMinor).toBe(CAP_MINOR);
    expect(o.confirmedCapitalMinor).toBe(CONFIRMED_MINOR);
    expect(o.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);
    expect(typeof o.wiredNotCommittedMinor).toBe("number");
    /* The invariant that makes the record honest: the parts the record names must
       add up to the total it asserts the overage against. */
    expect(
      o.confirmedCapitalMinor + o.softCircledInterestMinor + o.wiredNotCommittedMinor,
    ).toBeLessThanOrEqual(o.resultingTotalMinor);
    expect(o.overageMinor).toBe(o.resultingTotalMinor - o.capMinor);
    expect(String(o.capBasis ?? "").length).toBeGreaterThan(10);
    expect(o.capBasisCode).toMatch(/measured_(before|after)_projection/);
  });

  it("4.2 the response cap block carries the split and a separate targetRaise block", async () => {
    const spvId = await createSpv("W164 Response Blocks", { capMinor: 99_000_000_00, targetRaiseMinor: 5_000_000 });
    const res = await lpCommit(spvId, "resp.w164@example.com", "91000.29");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.cap?.split).toBeTruthy();
    expect(res.body.cap.split.confirmedCapitalMinor).toBeGreaterThanOrEqual(0);
    /* R130 — target and cap arrive in DIFFERENT blocks of the SAME response, and
       the target block says out loud that nothing was blocked. */
    expect(res.body.targetRaise).toBeTruthy();
    expect(res.body.targetRaise.blocked).toBe(false);
    expect(res.body.targetRaise.overages.length).toBeGreaterThanOrEqual(1);
    expect(res.body.targetRaise.overages[0].reasonCode).toBe(TARGET_RAISE_EXCEEDED_CODE);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §5 — T-C.6. THE ONE-LEVEL `terms` MERGE, ACROSS THREE SEQUENTIAL WRITES.
   `_capOverrides`, `_targetOverages` and `_fundsConfirmations` must COEXIST.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§5 the terms merge stays one level", () => {
  it("5.1 three keys written by three different paths all survive", async () => {
    const spvId = await createSpv("W164 Terms Coexist", { targetRaiseMinor: 3_000_000 });

    /* Write 1 — `_fundsConfirmations`, through the real confirmation path. */
    await subscribeAt(spvId, "inv_w164_m1", CONFIRMED_MINOR, "wire_funded");
    const conf = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/inv_w164_m1/confirm-funds`,
      MANAGING,
      { receivedMinor: WIRED_MINOR, reference: "W164-WIRE-1" },
    );
    expect([200, 201], JSON.stringify(conf.body)).toContain(conf.status);
    expect(
      ((spvEngineStore.getSpv(PARTNER, spvId)?.terms ?? {}) as any)._fundsConfirmations,
    ).toBeTruthy();

    /* Write 2 — `_targetOverages`, via a committed writer past the target. */
    await subscribeAt(spvId, "inv_w164_m2", CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(spvEngineStore.targetOveragesForSpv(PARTNER, spvId).length).toBeGreaterThanOrEqual(1);

    /* Write 3 — `_capOverrides`, via an acknowledged over-cap commitment. */
    await subscribeAt(spvId, "inv_w164_m3", SOFT_CIRCLE_MINOR, "soft_circled");
    setCap(spvId, CAP_MINOR);
    const over = await lpCommit(spvId, "m4.w164@example.com", "26000.11");
    expect(over.status, JSON.stringify(over.body)).toBe(201);

    /* All three coexist AFTER the last write — this is the assertion that fails
       if any writer replaced `terms` wholesale or nested a key one level deeper. */
    const terms = (spvEngineStore.getSpv(PARTNER, spvId)?.terms ?? {}) as Record<string, any>;
    expect(Object.keys(terms._fundsConfirmations ?? {}), "K-1 data destroyed").toContain("inv_w164_m1");
    expect(terms._fundsConfirmations["inv_w164_m1"].receivedMinor).toBe(WIRED_MINOR);
    expect(Object.keys(terms[SPV_TARGET_OVERAGES_TERMS_KEY] ?? {}).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(terms[SPV_CAP_OVERRIDES_TERMS_KEY] ?? {}).length).toBeGreaterThanOrEqual(1);

    /* ONE level: each bag is a flat map of investorId -> record, never a bag of
       bags. A second level here is how a merge silently drops a sibling. */
    for (const key of [SPV_TARGET_OVERAGES_TERMS_KEY, SPV_CAP_OVERRIDES_TERMS_KEY]) {
      for (const rec of Object.values(terms[key] ?? {}) as any[]) {
        expect(rec[key]).toBeUndefined();
        expect(rec.investorId).toBeTruthy();
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §6 — THE COPY ITSELF. A refusal sentence is prose, never a code.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§6 the refusal sentence is prose", () => {
  it("6.1 every figure is named and the sentence ends in a next step", () => {
    const sentence = spvCapSplitRefusalSentence(
      {
        capMinor: CAP_MINOR,
        confirmedCapitalMinor: CONFIRMED_MINOR,
        softCircledInterestMinor: SOFT_CIRCLE_MINOR,
        wiredNotCommittedMinor: WIRED_MINOR,
        requestedMinor: REQUEST_MINOR,
        resultingTotalMinor: CONFIRMED_MINOR + SOFT_CIRCLE_MINOR + REQUEST_MINOR,
        overageMinor: CONFIRMED_MINOR + SOFT_CIRCLE_MINOR + REQUEST_MINOR - CAP_MINOR,
        currency: "USD",
      },
      2,
    );
    expect(sentence).not.toMatch(/EXCEEDS_CAP|_capOverrides|_targetOverages|[A-Z]{4,}_[A-Z]{4,}/);
    expect(sentence).toMatch(/confirmed capital/);
    expect(sentence).toMatch(/soft-circled interest/);
    expect(sentence.trim().endsWith(".")).toBe(true);
    /* No naked minor units: a figure of 4100029 on screen would be a money defect. */
    expect(sentence).not.toMatch(/4100029|7300047/);
  });
});
