/**
 * v25.49 Phase-4C / Blocker 4 — correct distribution waterfall math.
 *
 * Contract: explicit basis REQUIRED (no silent cost-basis 0); FAIL with no
 * committed LPs; RETURN-OF-CAPITAL FIRST then carry ONLY on realized profit;
 * per_deployment uses the deal's own cost/proceeds while whole_spv nets against
 * the portfolio's total contributed capital → the two bases give DIFFERENT (each
 * correct) carry; per-LP gross/carry/net are persisted with net = gross − carry.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { recordPendingSubscription, activateByPaymentIntent } from "../subscriptionStore";
import { updateCompanyProfile } from "../companyProfileStore";
import { createRound } from "../roundsStore";

const MANAGING = "u_avi_managing";
// WAVE 1A / S-2 — a CARRY-bearing distribution now needs an unforgeable
// settlement authorization. The partner route can no longer supply one (that was
// the fee self-mark hole); the operable path until Airwallex lands is the
// Capavate platform-admin distributions route.
const ADMIN = "u_admin";
const SETTLE = { settlementOutcome: "succeeded", settlementReason: "waterfall math fixture" };
let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function put(path: string, user: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}

/** Blocker 4 — fully commit an LP (subscribe → verify compliance → e-sign →
 *  `committed`) so its capital counts toward the committed-only register that
 *  backs deployment readiness and the distribution waterfall. */
async function commitLp(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
  return sub.body.subscription.id as string;
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open", signoffLegalName: "Avi Managing", signoffAccepted: true, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}
async function mgmtCarry(spvId: string, pct: number) {
  const r = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: pct });
  expect(r.status).toBe(201);
}

let coSeq = 0;
function makeEligibleCompanyWithRound(): { companyId: string; roundId: string } {
  const companyId = `co_wf_${Date.now()}_${coSeq++}`;
  const pi = `pi_${companyId}`;
  recordPendingSubscription({ companyId, tierId: "tier_growth", userId: "u_setup", billingCycle: "annual", paymentIntentId: pi, amountMinor: 100000, currency: "USD" });
  activateByPaymentIntent(pi, { expiresAt: "2099-01-01T00:00:00.000Z" });
  updateCompanyProfile(companyId, { sector: "fintech", stage: "seed", ma_stage: "exploring" }, "u_setup");
  const round = createRound({ companyId, name: "Seed", type: "seed", state: "active", targetAmount: 5000000, instrument: "safe", actorUserId: "u_setup" });
  return { companyId, roundId: round.id };
}
async function setFintechMandate(spvId: string) {
  const m = await put(`/api/partner/me/spv/${spvId}/mandate`, MANAGING, {
    mode: "open", sector: ["fintech"],
    ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["fintech"] }] },
  });
  expect(m.status).toBe(200);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("Blocker 4 — waterfall math", () => {
  it("missing basis data → 400 DISTRIBUTION_BASIS_REQUIRED", async () => {
    const id = await createSpv("WF Basis SPV");
    await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_b", commitmentMinor: 100000 });
    const r = await post(`/api/partner/me/spv/${id}/distributions`, MANAGING, { event: "exit", grossProceedsMinor: 100000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("DISTRIBUTION_BASIS_REQUIRED");
  });

  it("no committed LPs → 409 NO_COMMITTED_LPS", async () => {
    const id = await createSpv("WF NoLp SPV");
    const r = await post(`/api/partner/me/spv/${id}/distributions`, MANAGING, { event: "exit", grossProceedsMinor: 100000, costBasisMinor: 50000 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("NO_COMMITTED_LPS");
  });

  it("Blocker 4 — subscribed-but-UNCOMMITTED LPs do NOT enter the waterfall → 409 NO_COMMITTED_LPS", async () => {
    const id = await createSpv("WF Uncommitted SPV", { carryBasis: "per_deployment" });
    await mgmtCarry(id, 0.2);
    // A raw subscription (status `review`) — real money has not been committed.
    const sub = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_unc", commitmentMinor: 100000 });
    expect(sub.status).toBe(201);
    expect(sub.body.subscription.status).toBe("review");
    // Even with a valid basis, an uncommitted sub allocates over NOBODY.
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 600000, ...SETTLE,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("NO_COMMITTED_LPS");
  });

  it("return-of-capital only (proceeds ≤ basis) → ZERO carry, per-LP net = gross", async () => {
    const id = await createSpv("WF ROC SPV", { carryBasis: "per_deployment" });
    await mgmtCarry(id, 0.2);
    await commitLp(id, "inv_roc", 100000);
    const r = await post(`/api/partner/me/spv/${id}/distributions`, MANAGING, {
      event: "partial return", grossProceedsMinor: 400000, costBasisMinor: 500000, // underwater
    });
    expect(r.status).toBe(201);
    expect(r.body.distribution.gpCarryMinor).toBe(0);
    const alloc = r.body.distribution.allocations[0];
    expect(alloc.carryMinor).toBe(0);
    expect(alloc.netMinor).toBe(alloc.grossMinor);
  });

  it("profit → carry ONLY on realized profit; per-LP net = gross − carry", async () => {
    const id = await createSpv("WF Profit SPV", { carryBasis: "per_deployment", minCheckMinor: 1000 });
    await mgmtCarry(id, 0.2);
    await commitLp(id, "inv_a", 75000);
    await commitLp(id, "inv_bb", 25000);
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 600000, ...SETTLE, // profit 400000
    });
    expect(r.status).toBe(201);
    expect(r.body.distribution.gpCarryMinor).toBe(80000); // 20% of 400000 profit only
    const allocs = r.body.distribution.allocations as Array<{ investorId: string; grossMinor: number; carryMinor: number; netMinor: number }>;
    for (const a of allocs) expect(a.netMinor).toBe(a.grossMinor - a.carryMinor);
    const a75 = allocs.find((a) => a.investorId === "inv_a")!;
    expect(a75.grossMinor).toBe(750000);
    expect(a75.carryMinor).toBe(60000); // 75% of 80000
    expect(a75.netMinor).toBe(690000);
  });

  it("per_deployment vs whole_spv give DIFFERENT (each correct) carry for identical inputs", async () => {
    const perDep = await createSpv("WF PerDep SPV", { carryBasis: "per_deployment" });
    await mgmtCarry(perDep, 0.2);
    await commitLp(perDep, "inv_pd", 100000);
    const rPd = await post(`/api/admin/consortium-spv/${perDep}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 600000, ...SETTLE,
    });
    // per_deployment: carry on THIS deal's profit (1,000,000 − 600,000 = 400,000).
    expect(rPd.body.distribution.gpCarryMinor).toBe(80000);

    const whole = await createSpv("WF Whole SPV", { carryBasis: "whole_spv" });
    await mgmtCarry(whole, 0.2);
    await commitLp(whole, "inv_ws", 100000);
    const rWs = await post(`/api/admin/consortium-spv/${whole}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 600000, ...SETTLE,
    });
    // whole_spv: no capital DEPLOYED yet → nets against portfolio contributed
    // capital (0) → the whole gain is above basis (1,000,000).
    expect(rWs.body.distribution.gpCarryMinor).toBe(200000);

    expect(rPd.body.distribution.gpCarryMinor).not.toBe(rWs.body.distribution.gpCarryMinor);
  });

  it("whole_spv nets against total contributed capital (deployed) before carry", async () => {
    const id = await createSpv("WF WholeDeploy SPV", { carryBasis: "whole_spv" });
    await setFintechMandate(id);
    await mgmtCarry(id, 0.2);
    const { companyId, roundId } = makeEligibleCompanyWithRound();
    await commitLp(id, "inv_wd", 500000);
    // Record 500,000 of contributed capital as a deployment (portfolio basis).
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, { companyId, companyRoundId: roundId, amountMinor: 500000 });
    expect(dep.status).toBe(201);

    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 600000, costBasisMinor: 600000, ...SETTLE,
    });
    expect(r.status).toBe(201);
    // carry base = max(0, 600000 − 500000 contributed) = 100000 → 20% = 20000,
    // strictly LESS than carrying the whole 600000 of proceeds (120000).
    expect(r.body.distribution.gpCarryMinor).toBe(20000);
    expect(r.body.distribution.gpCarryMinor).toBeLessThan(600000 * 0.2);
  });
});
