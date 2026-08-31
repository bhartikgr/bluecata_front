/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 193 · ITEM A.5 (the five committed-total reductions) and ITEM B (the route
 * that returned 200 for a change it dropped).
 * ══════════════════════════════════════════════════════════════════════════════
 * `spvEngineStore.subscribe` records `currency: data.currency ?? s.currency`, and
 * the subscription route forwards `req.body` WHOLESALE, so a vehicle really can
 * end up holding commitments in two currencies. Five reductions then add those
 * amounts together with no currency check. Three of them are the denominator of
 * every limited partner's ownership percentage; two of them decide whether real
 * money moves. Capavate converts no currency (R156.1), so each must REFUSE.
 *
 * EACH OF THE FIVE IS PROVED SEPARATELY, against its own real method, over a
 * population built for that method's own basis — `investorRegister` and
 * `lpRosterForViewer` read every non-withdrawn subscription (the capacity basis),
 * while `committedRegister`, the deployment gate and the distribution preview read
 * only committed ones (the money basis). A single test that happened to cross one
 * shared guard would not prove the other four.
 *
 * NO 200 IS EVER TAKEN AS EVIDENCE. Item B's proofs read the stored row back,
 * because a route replying 200 while dropping the write is the exact defect.
 *
 *   A5-1..A5-5  each reduction refuses on a genuinely mixed vehicle
 *   A5-6        a single-currency vehicle computes exactly as before — the
 *               regression that matters
 *   A5-7        the refusal carries readable words, no ALL-CAPS code on screen
 *   A5-8        the five sites are independently guarded, not transitively
 *   B-1         PATCH {currency} — the change the store drops is now REFUSED
 *   B-2         the refusal names the fields that were not applied
 *   B-3         a legitimate PATCH still returns 200 AND PERSISTS
 *   B-4         a mixed patch does not half-apply
 *   B-5         the sweep, pinned: the applied allow-list is what it claims
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { recordPendingSubscription, activateByPaymentIntent } from "../subscriptionStore";
import { updateCompanyProfile } from "../companyProfileStore";
import { createRound } from "../roundsStore";
import { SPV_PATCH_APPLIED_KEYS } from "../lib/spvVehiclePatchApplicability";
import {
  spvEngineStore,
  assertSingleCurrencyTotal,
  isSpvMixedCurrencyTotalError,
  SPV_MIXED_CURRENCY_TOTAL_CODE,
  type SpvMixedCurrencyTotalError,
} from "../spvEngineStore";

const MANAGING = "u_avi_managing";

let app: express.Express;
let seq = 0;

const post = (path: string, body?: unknown) =>
  request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});
const patch = (path: string, body?: unknown) =>
  request(app).patch(path).set("x-user-id", MANAGING).send(body ?? {});
const put = (path: string, body?: unknown) =>
  request(app).put(path).set("x-user-id", MANAGING).send(body ?? {});

async function makeSpv(): Promise<{ spvId: string; partnerId: string }> {
  const r = await post("/api/partner/me/spv", {
    name: `W193 Vehicle ${seq++}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    currency: "USD",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { spvId: r.body.spv.id as string, partnerId: r.body.spv.sponsorPartnerId as string };
}

/** Subscribe an LP, optionally in a currency of its own. The route forwards the
 *  body wholesale, so this is a REAL path a caller can take today — not a row
 *  hand-written into the table to manufacture the defect. */
async function subscribeLp(
  spvId: string,
  investorId: string,
  commitmentMinor: number,
  currency?: string,
): Promise<string> {
  const r = await post(`/api/partner/me/spv/${spvId}/subscriptions`, {
    investorId,
    commitmentMinor,
    ...(currency === undefined ? {} : { currency }),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.subscription.id as string;
}

/** Carry an LP all the way to `committed`, which is the only status the money
 *  basis counts. */
async function commitLp(
  spvId: string,
  investorId: string,
  commitmentMinor: number,
  currency?: string,
): Promise<void> {
  const subId = await subscribeLp(spvId, investorId, commitmentMinor, currency);
  await put(`/api/partner/me/compliance/${investorId}`, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, {
    to: "committed",
    subscriptionDocRef: `sig_${investorId}`,
  });
  expect(adv.status, JSON.stringify(adv.body)).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
}

/** A vehicle whose two LPs are recorded in two different currencies, built only
 *  through the platform's own routes. */
async function mixedVehicle(committed: boolean): Promise<{ spvId: string; partnerId: string; lpA: string }> {
  const { spvId, partnerId } = await makeSpv();
  const lpA = `inv_w193_a_${seq++}`;
  const lpB = `inv_w193_b_${seq++}`;
  if (committed) {
    await commitLp(spvId, lpA, 1_000_000, "USD");
    await commitLp(spvId, lpB, 1_000_000, "GBP");
  } else {
    await subscribeLp(spvId, lpA, 1_000_000, "USD");
    await subscribeLp(spvId, lpB, 1_000_000, "GBP");
  }
  return { spvId, partnerId, lpA };
}

/** The same vehicle in ONE currency — the control for every refusal below. */
async function singleCurrencyVehicle(committed: boolean): Promise<{ spvId: string; partnerId: string; lpA: string }> {
  const { spvId, partnerId } = await makeSpv();
  const lpA = `inv_w193_s_${seq++}`;
  const lpB = `inv_w193_t_${seq++}`;
  if (committed) {
    await commitLp(spvId, lpA, 1_000_000, "USD");
    await commitLp(spvId, lpB, 1_000_000, "USD");
  } else {
    await subscribeLp(spvId, lpA, 1_000_000, "USD");
    await subscribeLp(spvId, lpB, 1_000_000, "USD");
  }
  return { spvId, partnerId, lpA };
}

/** A company that PASSES the deployment gate's fail-closed eligibility, plus the
 *  mandate that matches it — built exactly as `spvEngine.test.ts` builds one, so
 *  the gate is reached at its money check rather than short-circuiting earlier. */
async function makeDeployableTarget(spvId: string): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_w193_ready_${seq++}`;
  const pi = `pi_${companyId}`;
  recordPendingSubscription({
    companyId, tierId: "tier_growth", userId: "u_setup", billingCycle: "annual",
    paymentIntentId: pi, amountMinor: 100000, currency: "USD",
  });
  activateByPaymentIntent(pi, { expiresAt: "2099-01-01T00:00:00.000Z" });
  updateCompanyProfile(companyId, { sector: "fintech", stage: "seed", ma_stage: "exploring" }, "u_setup");
  const round = createRound({
    companyId, name: "Seed", type: "seed", state: "active",
    targetAmount: 5000000, instrument: "safe", actorUserId: "u_setup",
  });
  const m = await put(`/api/partner/me/spv/${spvId}/mandate`, {
    mode: "open", sector: ["fintech"],
    ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["fintech"] }] },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  return { companyId, roundId: round.id };
}

function refusalFrom(fn: () => unknown): SpvMixedCurrencyTotalError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(isSpvMixedCurrencyTotalError(caught), `expected a refusal, got ${String(caught)}`).toBe(true);
  return caught as SpvMixedCurrencyTotalError;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("WAVE 193 · A.5 — each of the five committed-total reductions refuses on mixed currency", () => {
  it("A5-1 SITE 1 `investorRegister` — the ownership-percentage denominator refuses", async () => {
    const { spvId, partnerId } = await mixedVehicle(false);
    const e = refusalFrom(() => spvEngineStore.investorRegister(partnerId, spvId));
    expect(e.totalName).toBe("ownership-percentage denominator");
    expect(e.statedCurrencies).toBe("GBP and USD");
  });

  it("A5-2 SITE 2 `committedRegister` — the committed-capital total refuses", async () => {
    const { spvId, partnerId } = await mixedVehicle(true);
    const e = refusalFrom(() => spvEngineStore.committedRegister(partnerId, spvId));
    expect(e.totalName).toBe("committed-capital total");
    expect(e.statedCurrencies).toBe("GBP and USD");
  });

  it("A5-3 SITE 3 `lpRosterForViewer` — the roster an LP reads refuses", async () => {
    const { spvId, lpA } = await mixedVehicle(false);
    /* An LP reading their own roster is a DIFFERENT entry point from the GP's
       register, over the same capacity basis, and it renders a percentage. If it
       were left unguarded the refused figure would simply reappear on the LP's
       screen. */
    const e = refusalFrom(() => spvEngineStore.lpRosterForViewer(spvId, lpA));
    expect(e.totalName).toBe("ownership-percentage denominator");
  });

  it("A5-4 SITE 4 `_assertDeploymentReadiness` — the MONEY GATE refuses", async () => {
    const { spvId, partnerId } = await mixedVehicle(true);
    const { companyId, roundId } = await makeDeployableTarget(spvId);
    /* This is the one where a wrong total moves cash: it asks whether committed
       capital covers the amount about to be wired to a company. A mixed sum could
       clear a gate that real capital does not cover. The target is fully eligible
       and the round is active, so the gate is reached AT ITS MONEY CHECK — an
       earlier refusal (NO_MANDATE, COMPANY_NOT_ELIGIBLE) would prove nothing. */
    const e = refusalFrom(() =>
      spvEngineStore._assertDeploymentReadiness(partnerId, spvId, companyId, roundId, 1_500_000),
    );
    expect(e.totalName).toContain("committed");
  });

  it("A5-5 SITE 5 `previewDistributionSplit` — the contributed base refuses", async () => {
    const { spvId, partnerId } = await mixedVehicle(true);
    const e = refusalFrom(() =>
      spvEngineStore.previewDistributionSplit(partnerId, spvId, { grossProceedsMinor: 5_000_000 }),
    );
    expect(e.totalName).toBe("contributed-capital base");
  });

  it("A5-6 THE REGRESSION THAT MATTERS — a single-currency vehicle still computes at all five sites", async () => {
    /* Every vehicle on the platform today is single-currency (the wizard has always
       required a currency and subscriptions inherit it), so if this wave breaks
       anything, it breaks it here. */
    const { spvId, partnerId, lpA } = await singleCurrencyVehicle(true);

    const reg = spvEngineStore.investorRegister(partnerId, spvId);
    expect(reg.length).toBe(2);
    const committed = spvEngineStore.committedRegister(partnerId, spvId);
    expect(committed.reduce((a, r) => a + r.commitmentMinor, 0)).toBe(2_000_000);
    /* Still exact halves — the guard changed no arithmetic. */
    /* Ownership is carried as a FRACTION on this row, not a percentage — asserted
       as the store really returns it rather than as it reads on screen. */
    expect(committed.map((r) => r.ownershipPct)).toEqual([0.5, 0.5]);

    expect(() => spvEngineStore.lpRosterForViewer(spvId, lpA)).not.toThrow();
    expect(() =>
      spvEngineStore.previewDistributionSplit(partnerId, spvId, { grossProceedsMinor: 5_000_000 }),
    ).not.toThrow();
    /* The gate may still refuse for its OWN reasons (insufficient capital, an
       ineligible company); what it must not do is refuse on currency. */
    const target = await makeDeployableTarget(spvId);
    let gateErr: unknown;
    try {
      spvEngineStore._assertDeploymentReadiness(partnerId, spvId, target.companyId, target.roundId, 1_000_000);
    } catch (e) {
      gateErr = e;
    }
    expect(isSpvMixedCurrencyTotalError(gateErr)).toBe(false);
  });

  it("A5-6b an ABSENT currency never refuses, and one stated code among absent ones does not either", () => {
    /* The same absent-vs-mixed rule as the cap-table engine, asserted here on the
       store's own helper so the two cannot drift apart. */
    expect(() => assertSingleCurrencyTotal("t", [{ currency: null }, { currency: undefined }, {}])).not.toThrow();
    expect(() => assertSingleCurrencyTotal("t", [{ currency: "USD" }, { currency: null }])).not.toThrow();
    expect(() => assertSingleCurrencyTotal("t", [])).not.toThrow();
    expect(() => assertSingleCurrencyTotal("t", [{ currency: "USD" }, { currency: "GBP" }])).toThrow();
  });

  it("A5-7 the refusal reads as a sentence, names the currencies, and shows no ALL-CAPS code", () => {
    const e = refusalFrom(() =>
      assertSingleCurrencyTotal("committed-capital total", [{ currency: "USD" }, { currency: "SGD" }], "Fund I"),
    );
    /* `message` is EXACTLY the machine code, because `err()` maps by exact key. */
    expect(e.message).toBe(SPV_MIXED_CURRENCY_TOTAL_CODE);
    expect(e.refusalHeadline).toContain("Fund I");
    expect(e.refusalHeadline).toContain("SGD and USD");
    expect(e.refusalHeadline).toContain("committed-capital total");
    expect(e.refusalGuidance).toContain("does not convert currency");
    /* R152 item 3 — the WORDS a person reads carry no machine code. */
    expect(e.refusalHeadline).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    expect(e.refusalGuidance).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    /* And it stays under the 240-character ceiling `queryClient.ts:60-65`
       silently discards messages at. */
    expect(e.refusalHeadline.length).toBeLessThan(240);
  });

  it("A5-8 the five guards are INDEPENDENT — each site calls the assertion itself", () => {
    /* Source-text proof, and it is here for a specific reason: a later refactor
       that routed four sites through the fifth would still pass A5-1..A5-5 while
       making four of the five guards deletable in one line. Comments are stripped
       before anything is concluded from a search. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "..", "spvEngineStore.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const calls = code.match(/assertSingleCurrencyTotal\(/g) ?? [];
    /* Five call sites plus the declaration itself. */
    expect(calls.length).toBe(6);
    expect(code).toContain("export function assertSingleCurrencyTotal(");
  });
});

describe("WAVE 193 · B — the route no longer reports success for a change it drops", () => {
  it("B-1 PATCH {currency} is REFUSED, and the row is unchanged", async () => {
    const { spvId } = await makeSpv();
    const before = spvEngineStore.getSpv(
      (await request(app).get("/api/partner/me/spv").set("x-user-id", MANAGING)).body.spvs[0].sponsorPartnerId,
      spvId,
    );
    const r = await patch(`/api/partner/me/spv/${spvId}`, { currency: "GBP" });
    /* WAS 200 WITH THE FIELD SILENTLY DROPPED. A vehicle's denomination is fixed
       at creation by design (wave 191 verified the store's allow-list); what was
       broken was telling the caller the change had been made. */
    expect(r.status).toBe(400);
    expect(String(r.body.message ?? "")).not.toBe("");
    expect(String(r.body.message ?? "")).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    expect(String(r.body.guidance ?? "")).toContain("currency");
    /* And the read-back: refused means unchanged, not merely reported. */
    const after = await request(app).get(`/api/partner/me/spv/${spvId}`).set("x-user-id", MANAGING);
    expect(after.body.spv.currency).toBe(before?.currency ?? "USD");
    expect(after.body.spv.currency).not.toBe("GBP");
  });

  it("B-2 the refusal NAMES the fields that would not have been applied", async () => {
    const { spvId } = await makeSpv();
    const r = await patch(`/api/partner/me/spv/${spvId}`, { currency: "GBP", jurisdiction: "cayman" });
    expect(r.status).toBe(400);
    expect(r.body.unappliedFields).toEqual(expect.arrayContaining(["currency", "jurisdiction"]));
    /* The words say WHICH fields, so the caller is not left guessing which half of
       the patch was the problem. */
    expect(String(r.body.message)).toContain("currency");
  });

  it("B-3 a LEGITIMATE change still returns 200 and PERSISTS", async () => {
    const { spvId } = await makeSpv();
    const r = await patch(`/api/partner/me/spv/${spvId}`, { status: "closed" });
    expect(r.status).toBe(200);
    const back = await request(app).get(`/api/partner/me/spv/${spvId}`).set("x-user-id", MANAGING);
    expect(back.body.spv.status).toBe("closed");

    /* The two bodies the shipped client actually sends — `{status}` from
       PartnerPipeline and `{distributionScope}` from both PartnerPipeline and the
       SPV engine screen. Neither may regress into a refusal. */
    const r2 = await patch(`/api/partner/me/spv/${spvId}`, { distributionScope: "network" });
    expect(r2.status).toBe(200);
    const back2 = await request(app).get(`/api/partner/me/spv/${spvId}`).set("x-user-id", MANAGING);
    expect(back2.body.spv.distributionScope).toBe("network");
  });

  it("B-4 a patch that mixes an applied and a dropped field does NOT half-apply", async () => {
    const { spvId } = await makeSpv();
    const r = await patch(`/api/partner/me/spv/${spvId}`, { status: "closed", currency: "GBP" });
    expect(r.status).toBe(400);
    /* THE POINT. The refusal lands BEFORE the store is called, so the applied half
       is not written either. A partial write reported as a failure is its own
       silent-corruption path: the caller retries, and `status` is applied twice. */
    const back = await request(app).get(`/api/partner/me/spv/${spvId}`).set("x-user-id", MANAGING);
    expect(back.body.spv.status).toBe("open");
    expect(back.body.spv.currency).not.toBe("GBP");
  });

  it("B-5 the applicability list is an ACCEPT-list and matches what `updateSpv` really assigns", () => {
    /* R163.1 — a wave breached the sacred gate by assuming a five-name list was
       exhaustive. This test fails closed the same way the code does: it reads the
       real `updateSpv` body and checks every accepted key is genuinely assigned
       there, so adding a key to the accept-list without teaching the store is
       caught here rather than on live. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const ROOT = path.resolve(__dirname, "..", "..");
    const store = fs.readFileSync(path.join(ROOT, "server", "spvEngineStore.ts"), "utf8");
    const start = store.indexOf(
      "  updateSpv(partnerId: string, spvId: string, patch: Partial<SpvDTO>, actor: string): SpvDTO {",
    );
    expect(start).toBeGreaterThan(0);
    const body = store.slice(start, store.indexOf("\n  },", start));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(SPV_PATCH_APPLIED_KEYS.length).toBeGreaterThan(0);
    for (const key of SPV_PATCH_APPLIED_KEYS) {
      expect(code, `updateSpv never assigns "${key}", but the route accepts it`).toContain(`patch.${key}`);
    }
    /* And the fields this wave refuses are NOT quietly on the accept-list. */
    for (const dropped of ["currency", "carryBasis", "jurisdiction", "spvType", "gpUserId"]) {
      expect(SPV_PATCH_APPLIED_KEYS as readonly string[]).not.toContain(dropped);
    }
  });
});
