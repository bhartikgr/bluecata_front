/**
 * v25.49 Phase-4C / Blocker 3 — money-movement-safe SPV fee timing.
 *
 * FIXED portions of fixed/hybrid management/platform fees are accrued AT FUNDING
 * as concrete obligations and MUST be paid (through the EXISTING payment ledger)
 * or admin-waived before an SPV may commit a subscription. CARRY portions are
 * accrued AT DISTRIBUTION and collected with a recorded payment ref, FAIL-CLOSED
 * on a collection failure (the distribution is never recorded).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function put(path: string, user: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open",
    // 1c sign-off gate (added by a later wave) — required on every create.
    signoffLegalName: "Avi Managing", signoffAccepted: true,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Subscribe an LP with a verified compliance profile so the only remaining
 *  commit blocker is the fixed-fee obligation. Returns the subscription id. */
async function subscribeVerifiedLp(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  return sub.body.subscription.id as string;
}

/** Fully commit an LP (verify compliance + e-sign → `committed`) so its capital
 *  counts toward the committed-only distribution register. Assumes no fixed-fee
 *  obligation blocks the commit (carry-only configs). */
async function commitLp(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const subId = await subscribeVerifiedLp(spvId, investorId, commitmentMinor);
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
  return subId;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("Blocker 3 — fixed fee obligation accrued at funding + blocks commit", () => {
  it("wire_funded accrues a pending fixed obligation that blocks commit until paid", async () => {
    const id = await createSpv("FeeOb SPV", { minCheckMinor: 10000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor: 5000 });
    const subId = await subscribeVerifiedLp(id, "inv_fee1", 100000);

    // Advance to funding → obligation accrues.
    await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    expect(obs.status).toBe(200);
    const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed" && o.timing === "funding");
    expect(fixed).toBeTruthy();
    expect(fixed.state).toBe("pending");
    expect(fixed.amountMinor).toBe(5000);

    // Commit is FAIL-CLOSED while the obligation is unpaid.
    let adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_x" });
    expect(adv.status).toBe(409);
    expect(adv.body.error).toBe("FEES_UNPAID");

    // WAVE 1A / S-2 — the partner may no longer name the settlement outcome.
    // The partner charge route now attempts a REAL gateway settlement, which is
    // 503 until Airwallex is wired; the only way to record a real outcome today
    // is the Capavate platform-admin settle route.
    const selfMark = await post(`/api/partner/me/spv/${id}/fee-obligations/${fixed.id}/charge`, MANAGING, { outcome: "succeeded" });
    expect(selfMark.status).toBe(503);
    expect(selfMark.body.error).toBe("PAYMENT_GATEWAY_UNAVAILABLE");

    const charge = await post(`/api/admin/consortium-spv/${id}/fee-obligations/${fixed.id}/settle`, ADMIN, { outcome: "succeeded", reason: "wire received off-platform" });
    expect(charge.status).toBe(200);
    expect(charge.body.obligation.state).toBe("paid");
    expect(charge.body.obligation.paymentRef).toBeTruthy();

    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_x" });
    expect(adv.status).toBe(200);
    expect(adv.body.subscription.status).toBe("committed");
  });

  it("accrual is idempotent — a second wire_funded does not duplicate the obligation", async () => {
    const id = await createSpv("FeeOb Idem SPV", { minCheckMinor: 10000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor: 3000 });
    const subId = await subscribeVerifiedLp(id, "inv_fee2", 100000);
    await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
    await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    const fixedCount = obs.body.obligations.filter((o: any) => o.portion === "fixed" && o.timing === "funding").length;
    expect(fixedCount).toBe(1);
  });

  it("admin waive clears the fail-closed block", async () => {
    const id = await createSpv("FeeOb Waive SPV", { minCheckMinor: 10000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor: 7000 });
    const subId = await subscribeVerifiedLp(id, "inv_fee3", 100000);
    await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed");

    const waive = await post(`/api/admin/consortium-spv/${id}/fee-obligations/${fixed.id}/waive`, ADMIN, { reason: "sponsor credit" });
    expect(waive.status).toBe(200);
    expect(waive.body.obligation.state).toBe("waived");

    const adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_y" });
    expect(adv.status).toBe(200);
    expect(adv.body.subscription.status).toBe("committed");
  });

  it("Blocker 3 bypass — a fixed fee configured AFTER an early commit still FAILS CLOSED (config-aware, no bypass) and is cleared only by pay/waive", async () => {
    const id = await createSpv("FeeOb Bypass SPV", { minCheckMinor: 10000 });
    // 1. Commit an LP with NO fee configured yet → allowed (nothing owed).
    await commitLp(id, "inv_early", 100000);

    // 2. NOW configure a fixed management fee. The config IMPLIES a mandatory
    //    funding obligation even though none was ever accrued for this SPV.
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor: 5000 });

    // 3. A LATER commit must FAIL CLOSED even though the obligation row is MISSING
    //    (config present, never accrued) — this is the bypass the round-2 review
    //    flagged: existence checks are not enough, the config itself gates.
    const lateSubId = await subscribeVerifiedLp(id, "inv_late", 100000);
    let adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${lateSubId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_late" });
    expect(adv.status).toBe(409);
    expect(adv.body.error).toBe("FEES_UNPAID");

    // 4. Accrue the obligation (funding transition) → still pending → still blocked.
    await patch(`/api/partner/me/spv/${id}/subscriptions/${lateSubId}`, MANAGING, { to: "wire_funded" });
    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed" && o.timing === "funding");
    expect(fixed).toBeTruthy();
    expect(fixed.state).toBe("pending");
    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${lateSubId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_late" });
    expect(adv.status).toBe(409);
    expect(adv.body.error).toBe("FEES_UNPAID");

    // 5. Admin waive clears the block → commit is finally allowed.
    const waive = await post(`/api/admin/consortium-spv/${id}/fee-obligations/${fixed.id}/waive`, ADMIN, { reason: "sponsor credit" });
    expect(waive.status).toBe(200);
    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${lateSubId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_late" });
    expect(adv.status).toBe(200);
    expect(adv.body.subscription.status).toBe("committed");
  });

  it("waive route is admin-only (non-admin → 403)", async () => {
    const id = await createSpv("FeeOb WaiveAuth SPV", { minCheckMinor: 10000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor: 1000 });
    const subId = await subscribeVerifiedLp(id, "inv_fee4", 100000);
    await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed");
    const waive = await post(`/api/admin/consortium-spv/${id}/fee-obligations/${fixed.id}/waive`, MANAGING, { reason: "nope" });
    expect(waive.status).toBe(403);
  });
});

describe("Blocker 3 — carry collected at distribution (fail-closed)", () => {
  it("carry is collected with a recorded payment ref at distribution", async () => {
    const id = await createSpv("Carry Collect SPV", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(id, "inv_carry1", 100000);

    // WAVE 1A / S-2 — carry settlement now requires an unforgeable authorization,
    // so the operable path today is the admin distributions route.
    const dist = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000, // realized profit 500000
      settlementOutcome: "succeeded", settlementReason: "carry collected off-platform",
    });
    expect(dist.status).toBe(201);
    expect(dist.body.distribution.gpCarryMinor).toBe(100000); // 20% of 500000 profit

    const gpTier = dist.body.distribution.waterfall.find((w: any) => w.tier === "gp_carry");
    expect(gpTier.paymentRef).toBeTruthy(); // collected through the ledger

    const obs = await get(`/api/partner/me/spv/${id}/fee-obligations`, MANAGING);
    const carry = obs.body.obligations.find((o: any) => o.portion === "carry" && o.timing === "distribution");
    expect(carry).toBeTruthy();
    expect(carry.state).toBe("paid");
    expect(carry.paymentRef).toBeTruthy();
  });

  it("a carry collection FAILURE fails closed — distribution is NOT recorded", async () => {
    const id = await createSpv("Carry Fail SPV");
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(id, "inv_carry2", 100000);

    // A partner may not smuggle the outcome in at all any more.
    const smuggle = await post(`/api/partner/me/spv/${id}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000, collectionOutcome: "failed",
    });
    expect(smuggle.status).toBe(400);
    expect(smuggle.body.error).toBe("SETTLEMENT_NOT_CLIENT_SUPPLIED");

    const dist = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
      settlementOutcome: "failed", settlementReason: "gateway declined",
    });
    expect(dist.status).toBe(402);
    expect(dist.body.error).toBe("FEE_COLLECTION_FAILED");

    // Fail-closed: no distribution row persisted.
    const detail = await get(`/api/partner/me/spv/${id}`, MANAGING);
    expect(detail.body.distributions.length).toBe(0);
  });
});
