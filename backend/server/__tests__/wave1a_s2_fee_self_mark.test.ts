/**
 * WAVE 1A / S-2 — a Consortium Partner CANNOT mark their own platform fee paid.
 *
 * THIS SUITE TESTS WHAT THE FIX PREVENTS, NOT WHAT IT CHANGES.
 *
 * Review A's finding against v7: a hardcoded `"succeeded"` at
 * `server/spvEngineRoutes.ts:257` passed all four of v7's acceptance criteria
 * and left the hole wide open. So the load-bearing assertions here are all of
 * the same shape:
 *
 *     for EVERY partner-reachable route × EVERY parameter × EVERY enum value,
 *     the PERSISTED obligation state is never "paid".
 *
 * They are asserted on the persisted state read back from the store — never on
 * a response code — so an implementation that returns 200 while writing `paid`
 * still fails, and an implementation that hardcodes a literal outcome anywhere
 * in the chain still fails.
 *
 * `state = "paid"` has exactly ONE assignment in this object graph
 * (`server/spvEngineStore.ts`, `o.state = "paid"` inside `chargeFeeObligation`).
 * ATTACK-6 below re-proves that count against the source at run time, so this
 * suite cannot be satisfied by adding a second, ungated assignment elsewhere.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { chargeOrIdempotent } from "../paymentStore";
import { __authorizeForTest, isFeeSettlementAuthorization } from "../lib/feeSettlementAuthority";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});
const put = (p: string, u: string, b?: unknown) => request(app).put(p).set("x-user-id", u).send(b ?? {});
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);

const SRC_DIR = path.resolve(__dirname, "..");
const storeSrc = fs.readFileSync(path.join(SRC_DIR, "spvEngineStore.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(SRC_DIR, "spvEngineRoutes.ts"), "utf8");

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Accrue a pending FIXED funding obligation and return its id. */
async function accrueFixedObligation(spvId: string, investorId: string, fixedAmountMinor: number): Promise<{ obId: string; subId: string }> {
  await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor });
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor: 100000 });
  expect(sub.status).toBe(201);
  const subId = sub.body.subscription.id as string;
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
  const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
  const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed" && o.timing === "funding");
  expect(fixed).toBeTruthy();
  expect(fixed.state).toBe("pending");
  return { obId: fixed.id as string, subId };
}

/** THE assertion. Reads the PERSISTED state, not a response. */
async function persistedState(spvId: string, obId: string): Promise<string> {
  const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
  const o = obs.body.obligations.find((x: any) => x.id === obId);
  return o ? String(o.state) : "MISSING";
}

async function commitLp(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  const subId = sub.body.subscription.id as string;
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status).toBe(200);
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

/* ══════════════════════════════════════════════════════════════════════════
 * AC-S-2.a … AC-S-2.f — the partner can never reach `paid`
 * ══════════════════════════════════════════════════════════════════════════ */

describe("S-2 / SINK 1 — spvEngineRoutes charge route (was :253/:256, body `outcome`)", () => {
  it("AC-S-2.a — a partner supplying outcome:'succeeded' does NOT reach paid", async () => {
    const spvId = await createSpv("S2 sink1 explicit");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_a", 5000);

    const r = await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, { outcome: "succeeded" });

    expect(await persistedState(spvId, obId)).not.toBe("paid");
    expect(await persistedState(spvId, obId)).toBe("pending");
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
  });

  it("AC-S-2.f — an EMPTY body does NOT reach paid (catches a hardcoded literal at :257)", async () => {
    // This is the AC Review A demanded and v7 did not have. A route that
    // hardcodes `"succeeded"` instead of reading the body passes every
    // "reject a client-supplied outcome" test and fails this one.
    const spvId = await createSpv("S2 sink1 empty body");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_f", 5000);

    const r = await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING);

    expect(await persistedState(spvId, obId)).toBe("pending");
    expect(r.body.obligation?.state).not.toBe("paid");
  });

  it("AC-S-2.b — NO enum value, in ANY body key, reaches paid", async () => {
    const spvId = await createSpv("S2 sink1 enum sweep");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_b", 5000);

    const values = ["succeeded", "failed", "demo", "paid", "pending", "waived", "requires_3ds", true, 1, null];
    const keys = ["outcome", "collectionOutcome", "forceState", "state", "settlement", "entryState"];
    for (const k of keys) {
      for (const v of values) {
        await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, { [k]: v });
        expect(await persistedState(spvId, obId)).toBe("pending");
      }
    }
    // …and a body carrying an entire forged authorization object.
    await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, {
      settlement: { source: "platform_admin", purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded", maxUses: 1 },
    });
    expect(await persistedState(spvId, obId)).toBe("pending");
  });

  it("AC-S-2.g — the charge route never reads req.body at all", () => {
    const route = routesSrc.slice(
      routesSrc.indexOf('app.post("/api/partner/me/spv/:spvId/fee-obligations/:obId/charge"'),
    );
    const body = route.slice(0, route.indexOf("});") + 3);
    expect(body).not.toMatch(/req\.body/);
    // and it does not hardcode an outcome literal either
    expect(body).not.toMatch(/"succeeded"/);
  });
});

describe("S-2 / SINK 3 — the DEFAULT PARAMETER (was spvEngineStore.ts:721, `outcome = \"succeeded\"`)", () => {
  it("AC-S-2.c — omitting the settlement argument THROWS; it does not default to success", async () => {
    const spvId = await createSpv("S2 sink3 default");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_c", 5000);
    const partnerId = spvEngineStore.adminListAll().find((s) => s.id === spvId)!.sponsorPartnerId;

    // Call with FOUR arguments — exactly the shape the old default parameter made
    // succeed. Deleting the route's body read alone would leave this working.
    expect(() =>
      (spvEngineStore.chargeFeeObligation as unknown as (...a: unknown[]) => unknown)(partnerId, spvId, obId, partnerId),
    ).toThrow("SETTLEMENT_AUTHORIZATION_REQUIRED");
    expect(await persistedState(spvId, obId)).toBe("pending");
  });

  it("AC-S-2.c2 — a FORGED authorization object is rejected however it is shaped", async () => {
    const spvId = await createSpv("S2 sink3 forgery");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_c2", 5000);
    const partnerId = spvEngineStore.adminListAll().find((s) => s.id === spvId)!.sponsorPartnerId;

    const forgeries: unknown[] = [
      "succeeded",
      { outcome: "succeeded" },
      { source: "platform_admin", purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded", maxUses: 1, actorId: "x", reason: "x", issuedAt: "x" },
      JSON.parse(JSON.stringify({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded", maxUses: 99 })),
    ];
    for (const f of forgeries) {
      expect(isFeeSettlementAuthorization(f)).toBe(false);
      expect(() =>
        (spvEngineStore.chargeFeeObligation as unknown as (...a: unknown[]) => unknown)(partnerId, spvId, obId, partnerId, f),
      ).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
      expect(await persistedState(spvId, obId)).toBe("pending");
    }
  });

  it("AC-S-2.c3 — an authorization minted for ANOTHER obligation cannot settle this one", async () => {
    const spvA = await createSpv("S2 scope A");
    const a = await accrueFixedObligation(spvA, "inv_s2_c3a", 5000);
    const spvB = await createSpv("S2 scope B");
    const b = await accrueFixedObligation(spvB, "inv_s2_c3b", 5000);
    const pidB = spvEngineStore.adminListAll().find((s) => s.id === spvB)!.sponsorPartnerId;

    const authForA = __authorizeForTest({ purpose: "fee_obligation", spvId: spvA, obligationId: a.obId, outcome: "succeeded" });
    expect(() => spvEngineStore.chargeFeeObligation(pidB, spvB, b.obId, pidB, authForA)).toThrow(
      "SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH",
    );
    expect(await persistedState(spvB, b.obId)).toBe("pending");
  });

  it("AC-S-2.c4 — an authorization is single-use (no replay)", async () => {
    const spvId = await createSpv("S2 replay");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_c4", 5000);
    const pid = spvEngineStore.adminListAll().find((s) => s.id === spvId)!.sponsorPartnerId;

    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "failed" });
    expect(() => spvEngineStore.chargeFeeObligation(pid, spvId, obId, pid, auth)).toThrow("FEE_COLLECTION_FAILED");
    expect(() => spvEngineStore.chargeFeeObligation(pid, spvId, obId, pid, auth)).toThrow(
      "SETTLEMENT_AUTHORIZATION_REPLAYED",
    );
    expect(await persistedState(spvId, obId)).toBe("failed");
  });
});

describe('S-2 / SINK 4 — "demo" is no longer a settlement (was spvEngineStore.ts:747)', () => {
  it("AC-S-2.d — a DEMO ledger entry does NOT resolve to paid; it fails closed", async () => {
    const spvId = await createSpv("S2 sink4 demo");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_d", 5000);
    const pid = spvEngineStore.adminListAll().find((s) => s.id === spvId)!.sponsorPartnerId;

    // Pre-create the ledger entry this obligation's deterministic intent id maps
    // to, in the "demo" state that paymentStore.ts:127 defaults to. The next
    // charge dedupes onto it, so `entryState` really is "demo" at the check —
    // this is a live exercise of the sink, not a source assertion.
    const seeded = chargeOrIdempotent({
      intentId: `spvfee_${obId}`,
      kind: "company_billing",
      amountCents: 5000,
      currency: "USD",
      customerId: pid,
      description: "demo seam probe",
      forceState: "demo",
    });
    expect(seeded.entry.state).toBe("demo");

    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(() => spvEngineStore.chargeFeeObligation(pid, spvId, obId, pid, auth)).toThrow("FEE_COLLECTION_FAILED");
    expect(await persistedState(spvId, obId)).toBe("failed");
  });

  it("AC-S-2.d2 — the source no longer accepts \"demo\" at the settlement check", () => {
    expect(storeSrc).not.toMatch(/entryState !== "succeeded" && entryState !== "demo"/);
    expect(storeSrc).toMatch(/if \(entryState !== "succeeded"\) \{/);
  });
});

describe("S-2 / SINK 2 + SINK 5 — the distribution path (routes :395/:397 → store `collectionOutcome`)", () => {
  it("AC-S-2.e — a partner smuggling collectionOutcome is REJECTED and nothing is written", async () => {
    const spvId = await createSpv("S2 dist smuggle", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_s2_e", 100000);

    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000, collectionOutcome: "succeeded",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SETTLEMENT_NOT_CLIENT_SUPPLIED");

    const detail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(detail.body.distributions.length).toBe(0);
    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    expect(obs.body.obligations.filter((o: any) => o.state === "paid").length).toBe(0);
  });

  it("AC-S-2.e2 — a clean partner distribution with CARRY aborts fail-closed; no carry obligation is paid", async () => {
    const spvId = await createSpv("S2 dist clean carry", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_s2_e2", 100000);

    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("SETTLEMENT_AUTHORIZATION_REQUIRED");

    const detail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(detail.body.distributions.length).toBe(0);
    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    expect(obs.body.obligations.every((o: any) => o.state !== "paid")).toBe(true);
  });

  it("AC-S-2.e3 — a ZERO-carry partner distribution still works (no collateral damage)", async () => {
    const spvId = await createSpv("S2 dist zero carry", { carryBasis: "per_deployment" });
    await commitLp(spvId, "inv_s2_e3", 100000);
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
    });
    expect(r.status).toBe(201);
    expect(r.body.distribution.gpCarryMinor).toBe(0);
  });

  it("AC-S-2.e4 — recordDistribution's data type no longer carries a settlement field", () => {
    // Strip comments — the only surviving mentions are the explanatory notes
    // that document the removed sink. No CODE may reference it.
    const code = storeSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/collectionOutcome/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The admin-only settlement path (ASSUMPTION A-1) — a REAL outcome survives
 * ══════════════════════════════════════════════════════════════════════════ */

describe("S-2 — the admin settlement path exists, works, and is admin-only", () => {
  it("AC-S-2.h — a Capavate platform admin CAN record a real settlement → paid", async () => {
    const spvId = await createSpv("S2 admin settle");
    const { obId, subId } = await accrueFixedObligation(spvId, "inv_s2_h", 5000);

    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, {
      outcome: "succeeded", reason: "wire received 2026-08-09, ref BK-99321",
    });
    expect(r.status).toBe(200);
    expect(r.body.obligation.state).toBe("paid");
    expect(await persistedState(spvId, obId)).toBe("paid");

    // …and the fail-closed commit gate (hasUnsettledFixedFees) is cleared.
    const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_h" });
    expect(adv.status).toBe(200);
    expect(adv.body.subscription.status).toBe("committed");
  });

  it("AC-S-2.i — the admin settle route is 403 for a partner (managing_partner)", async () => {
    const spvId = await createSpv("S2 admin settle authz");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_i", 5000);

    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, MANAGING, {
      outcome: "succeeded", reason: "let me in",
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ADMIN_REQUIRED");
    expect(await persistedState(spvId, obId)).toBe("pending");
  });

  it("AC-S-2.i2 — the admin settle route is 403 for an unauthenticated caller", async () => {
    const spvId = await createSpv("S2 admin settle anon");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_i2", 5000);
    const r = await request(app)
      .post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`)
      .send({ outcome: "succeeded", reason: "anon" });
    expect(r.status).toBe(403);
    expect(await persistedState(spvId, obId)).toBe("pending");
  });

  it("AC-S-2.j — an admin must state an outcome AND a reason (no silent default)", async () => {
    const spvId = await createSpv("S2 admin settle args");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_j", 5000);

    let r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SETTLEMENT_OUTCOME_REQUIRED");
    r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, { outcome: "succeeded" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SETTLEMENT_REASON_REQUIRED");
    expect(await persistedState(spvId, obId)).toBe("pending");
  });

  it("AC-S-2.k — an admin can record a FAILED settlement (the outcome is real, not fixed)", async () => {
    const spvId = await createSpv("S2 admin settle failed");
    const { obId } = await accrueFixedObligation(spvId, "inv_s2_k", 5000);
    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, {
      outcome: "failed", reason: "wire returned",
    });
    expect(r.status).toBe(402);
    expect(await persistedState(spvId, obId)).toBe("failed");
  });
});

describe("S-2b — the consequence: carry distributions stay operable, admin-only", () => {
  it("AC-S-2b.a — a carry-bearing distribution SUCCEEDS through the admin route", async () => {
    const spvId = await createSpv("S2b admin carry dist", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_s2b_a", 100000);

    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
      settlementOutcome: "succeeded", settlementReason: "carry swept to platform account",
    });
    expect(r.status).toBe(201);
    expect(r.body.distribution.gpCarryMinor).toBe(100000);
    const gpTier = r.body.distribution.waterfall.find((w: any) => w.tier === "gp_carry");
    expect(gpTier.paymentRef).toBeTruthy();

    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    const carry = obs.body.obligations.find((o: any) => o.portion === "carry");
    expect(carry.state).toBe("paid");
  });

  it("AC-S-2b.b — BOTH carry legs settle under one admin authorization", async () => {
    const spvId = await createSpv("S2b two legs", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    const pf = await post(`/api/admin/consortium-spv/${spvId}/platform-fee`, ADMIN, {
      sponsorPartnerId: PARTNER_A, feeType: "carry", carryPct: 0.05,
    });
    expect(pf.status).toBe(201);
    await commitLp(spvId, "inv_s2b_b", 100000);

    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
      settlementOutcome: "succeeded", settlementReason: "both legs",
    });
    expect(r.status).toBe(201);
    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    const carries = obs.body.obligations.filter((o: any) => o.portion === "carry");
    expect(carries.length).toBe(2);
    expect(carries.every((c: any) => c.state === "paid")).toBe(true);
  });

  it("AC-S-2b.c — the admin distribution route is 403 for a partner", async () => {
    const spvId = await createSpv("S2b admin dist authz", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_s2b_c", 100000);
    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
      settlementOutcome: "succeeded", settlementReason: "nope",
    });
    expect(r.status).toBe(403);
    const detail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(detail.body.distributions.length).toBe(0);
  });

  it("AC-S-2b.d — an admin recording a FAILED carry collection fails closed (no distribution row)", async () => {
    const spvId = await createSpv("S2b admin dist failed", { carryBasis: "per_deployment" });
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_s2b_d", 100000);
    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000,
      settlementOutcome: "failed", settlementReason: "carry sweep bounced",
    });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe("FEE_COLLECTION_FAILED");
    const detail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(detail.body.distributions.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ATTACK SUITE — the assertions that a sixth null fix would fail
 * ══════════════════════════════════════════════════════════════════════════ */

describe("S-2 ATTACK — a partner cannot reach paid by ANY route, parameter, default or enum", () => {
  it("ATTACK-1 — exhaustive sweep across both partner routes and every settlement-shaped input", async () => {
    const spvId = await createSpv("S2 attack sweep");
    const { obId } = await accrueFixedObligation(spvId, "inv_attack", 5000);

    const bodies: unknown[] = [
      undefined, {}, { outcome: "succeeded" }, { outcome: "demo" }, { outcome: "paid" },
      { state: "paid" }, { forceState: "succeeded" }, { collectionOutcome: "succeeded" },
      { obligation: { state: "paid" } }, { settlement: { outcome: "succeeded" } },
      { outcome: ["succeeded"] }, { outcome: { valueOf: () => "succeeded" } },
    ];
    for (const b of bodies) {
      await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, b);
      await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, MANAGING, b);
      expect(await persistedState(spvId, obId)).toBe("pending");
    }
  });

  it("ATTACK-2 — no partner sub-role (managing_partner / associate / bd) can settle", async () => {
    const spvId = await createSpv("S2 attack roles");
    const { obId } = await accrueFixedObligation(spvId, "inv_attack_roles", 5000);
    for (const u of ["u_avi_managing", "u_partner_associate", "u_partner_bd", "u_investor_alice"]) {
      await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, u, { outcome: "succeeded" });
      await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, u, { outcome: "succeeded", reason: "x" });
      expect(await persistedState(spvId, obId)).toBe("pending");
    }
  });

  it("ATTACK-3 — self-marking cannot open the LP-commit / cap-table gate", async () => {
    const spvId = await createSpv("S2 attack gate");
    const { obId, subId } = await accrueFixedObligation(spvId, "inv_attack_gate", 5000);

    await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, { outcome: "succeeded" });
    const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: "sig_attack" });
    expect(adv.status).toBe(409);
    expect(adv.body.error).toBe("FEES_UNPAID");
    expect(spvEngineStore.hasUnsettledFixedFees(
      spvEngineStore.adminListAll().find((s) => s.id === spvId)!.sponsorPartnerId, spvId,
    )).toBe(true);
  });

  it("ATTACK-4 — the store's chargeFeeObligation has NO default parameter", () => {
    const sig = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("chargeFeeObligation(") + 400);
    expect(sig).not.toMatch(/outcome:\s*"succeeded"\s*\|\s*"failed"\s*=\s*"succeeded"/);
    expect(sig).toMatch(/settlement: FeeSettlementAuthorization,/);
  });

  it("ATTACK-5 — the derivation site forwards a DERIVED local, never a parameter", () => {
    // `forceState:` must be fed by the consumed authorization, and the consume
    // call must sit above it inside the same function.
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    const consumeAt = fn.indexOf("consumeSettlementAuthorization(");
    const forceAt = fn.indexOf("forceState: outcome");
    expect(consumeAt).toBeGreaterThan(-1);
    expect(forceAt).toBeGreaterThan(consumeAt);
    expect(fn).not.toMatch(/forceState:\s*"succeeded"/);
  });

  it('ATTACK-6 — `state = "paid"` still has EXACTLY ONE assignment, and it is behind the gate', () => {
    const assignments = [...storeSrc.matchAll(/\.state\s*=\s*"paid"/g)];
    expect(assignments.length).toBe(1);
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    expect(fn).toMatch(/\.state\s*=\s*"paid"/);
    expect(fn.indexOf("consumeSettlementAuthorization(")).toBeLessThan(fn.indexOf('.state = "paid"'));
    // No SQL back door either.
    expect(storeSrc).not.toMatch(/UPDATE\s+spv_fee_obligation[\s\S]{0,200}state\s*=\s*'paid'/i);
  });

  it("ATTACK-7 — the gateway mint takes no outcome argument and is unreachable today", () => {
    const authSrc = fs.readFileSync(path.join(SRC_DIR, "lib", "feeSettlementAuthority.ts"), "utf8");
    const fn = authSrc.slice(authSrc.indexOf("export function authorizeGatewaySettlement"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toMatch(/outcome:\s*SettlementOutcome/);
    expect(body).toMatch(/PAYMENT_GATEWAY_UNAVAILABLE/);
  });

  it("ATTACK-8 — the sacred files are untouched by this wave", () => {
    for (const f of ["paymentGatewayAdapter.ts", "captableCommitStore.ts"]) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), "utf8");
      expect(src).not.toMatch(/feeSettlementAuthority/);
      expect(src).not.toMatch(/WAVE 1A/);
    }
  });
});
