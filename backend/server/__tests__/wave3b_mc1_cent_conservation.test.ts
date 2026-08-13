/**
 * WAVE 3B — MC-1 (single-pass integer allocation) + P-5 (summed-carry rejection
 * in the PERSISTED path).
 *
 * THESE TESTS ASSERT ON MONEY THAT WAS ACTUALLY WRITTEN.
 *
 * The previous attempt at this fix put its guard inside
 * `previewDistributionSplit`, whose own comment says it "does NOT persist or
 * move money". It satisfied its own acceptance criteria and protected nothing.
 * So every end-to-end assertion below is read back from the PERSISTED
 * distribution (`listDistributions` / the SPV detail response), never from a
 * preview and never from a response code alone:
 *
 *     sum_i allocations[i].grossMinor === grossProceedsMinor
 *     sum_i allocations[i].carryMinor === gpCarryMinor + platformCarryMinor
 *     sum_i allocations[i].netMinor   === gross - (gpCarry + platformCarry)
 *     allocations[i].netMinor >= 0 for every i
 *
 * and the adversarial case asserts that NO ROW EXISTS at all.
 *
 * Call graph the guard sits on:
 *   spvEngineRoutes.ts:499  POST /api/partner/me/spv/:spvId/distributions ─┐
 *   spvEngineRoutes.ts:522  POST /api/admin/consortium-spv/:spvId/distributions ─┤
 *                                                                          ├─> spvEngineStore.recordDistribution
 *                                                                          │      └─> allocateDistributionMinor  (money.ts)
 *                                                                          │      └─> _collectCarryObligation    (WRITES)
 *                                                                          └─>      persist("spv_distribution")  (WRITES)
 * Both writes happen strictly after the allocator returns, so a thrown
 * assertion aborts with nothing persisted. CALL-GRAPH-1 re-proves that ordering
 * against the source text at run time.
 *
 * WAVE 1A INTERACTION: closing the fee self-mark hole made `paid` reachable
 * only by a platform admin, and `_collectCarryObligation` is fail-closed, so a
 * carry-bearing distribution ABORTS without a minted authorization. These tests
 * therefore use the admin settlement path documented in
 * docs/ADMIN_SETTLEMENT_API.md — the admin distribution route for the HTTP
 * cases, and `__authorizeForTest` (the NODE_ENV-guarded test mint in
 * server/lib/feeSettlementAuthority.ts, already used by the WAVE 1A suite) for
 * the store-level cases. The security fix is not weakened anywhere here.
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
import { resolveCombinedCarryCapScaled } from "../lib/combinedCarryCapPolicy";
import { __authorizeForTest } from "../lib/feeSettlementAuthority";
import {
  allocateDistributionMinor,
  allocateResidualCents,
  CARRY_FRACTION_SCALE,
  /* WAVE 3D / ITEM 2 — the extracted per-LP net post-condition. */
  assertPerLpNetNonNegative,
  /* WAVE 3D / ITEM 4 — exact fixed-scale rate conversion. */
  decimalStringToCarryScaled,
  exactFractionToCarryScaled,
} from "../lib/money";

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
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

async function commitLp(spvId: string, investorId: string, commitmentMinor: number): Promise<void> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  const subId = sub.body.subscription.id as string;
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status).toBe(200);
}

/** The admin settlement path (docs/ADMIN_SETTLEMENT_API.md §3). Store-level so a
 *  property test can run many distributions without an HTTP round trip per case. */
function recordViaAdminSettlement(spvId: string, data: { event: string; grossProceedsMinor: number; costBasisMinor: number }) {
  return spvEngineStore.recordDistribution(
    PARTNER_A,
    spvId,
    data,
    ADMIN,
    __authorizeForTest({ purpose: "distribution_carry", spvId, outcome: "succeeded" }),
  );
}

/* WAVE 3F / ITEM 3 — OWNER RULING A-16. Seed an over-cap PLATFORM carry leg
 * DIRECTLY AT STORE LEVEL, bypassing the config API (which A-16 made blocking)
 * and nothing else. Every other validation in addFee still runs; only the
 * cross-layer combined-carry refusal is skipped, and only because the state
 * being seeded is precisely the illegal one PERSIST-5/PERSIST-6 exist to prove
 * the DISTRIBUTION SINK rejects. `__unsafeSeedOverCapForTests` is refused under
 * NODE_ENV=production and is passed by no route in the tree. */
function seedOverCapPlatformCarry(spvId: string, carryPct: number) {
  return spvEngineStore.addFee(
    PARTNER_A,
    spvId,
    { layer: "platform", feeType: "carry", carryPct },
    ADMIN,
    { adminPlatform: true, __unsafeSeedOverCapForTests: true },
  );
}

/** THE conservation assertion, applied to a PERSISTED distribution row. */
function assertConserved(dist: {
  grossProceedsMinor: number;
  gpCarryMinor: number;
  platformCarryMinor: number;
  allocations: Array<{ grossMinor: number; carryMinor: number; netMinor: number }>;
}): void {
  const totalCarry = dist.gpCarryMinor + dist.platformCarryMinor;
  const sum = (f: "grossMinor" | "carryMinor" | "netMinor") =>
    dist.allocations.reduce((a, x) => a + x[f], 0);
  expect(sum("grossMinor")).toBe(dist.grossProceedsMinor);
  expect(sum("carryMinor")).toBe(totalCarry);
  expect(sum("netMinor")).toBe(dist.grossProceedsMinor - totalCarry);
  for (const a of dist.allocations) {
    expect(a.netMinor).toBeGreaterThanOrEqual(0);
    expect(a.carryMinor).toBeLessThanOrEqual(a.grossMinor);
    expect(a.grossMinor + 0).toBe(a.carryMinor + a.netMinor);
  }
  expect(totalCarry).toBeLessThanOrEqual(dist.grossProceedsMinor);
}

/** A deterministic PRNG so a failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
 * DEFECT PROOF — the old arithmetic, run against the same inputs
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3B DEFECT PROOF — the replaced arithmetic loses cents and can go negative", () => {
  /** Byte-for-byte the arithmetic that was at spvEngineStore.ts:1440-1449. */
  function legacy(gross: number, carryBase: number, gpPct: number, platPct: number, commitments: number[]) {
    const total = commitments.reduce((a, c) => a + c, 0);
    const gpCarryMinor = Math.round(carryBase * gpPct);
    const platformCarryMinor = Math.round(carryBase * platPct);
    const totalCarryMinor = gpCarryMinor + platformCarryMinor;
    const allocations = commitments.map((c) => {
      const ownershipPct = total > 0 ? c / total : 0;
      const grossShare = Math.round(gross * ownershipPct);
      const carryShare = Math.round(totalCarryMinor * ownershipPct);
      return { grossMinor: grossShare, carryMinor: carryShare, netMinor: grossShare - carryShare };
    });
    return { gpCarryMinor, platformCarryMinor, totalCarryMinor, distributable: gross - totalCarryMinor, allocations };
  }

  it("DEFECT-1 — the old per-LP rounding does NOT conserve cents (3 equal LPs, 10001 minor)", () => {
    const old = legacy(10001, 0, 0, 0, [1000, 1000, 1000]);
    const oldSum = old.allocations.reduce((a, x) => a + x.grossMinor, 0);
    // 3 × round(10001/3) = 3 × 3334 = 10002. One cent CREATED out of nothing.
    expect(oldSum).toBe(10002);
    expect(oldSum).not.toBe(10001);

    // The fix allocates the same money exactly, with the documented tie-break.
    const fixed = allocateDistributionMinor({
      grossMinor: 10001, carryBaseMinor: 0, gpCarryFraction: 0, platformCarryFraction: 0,
      lpWeightsMinor: [1000, 1000, 1000],
    });
    expect(fixed.perLp.map((x) => x.grossMinor)).toEqual([3334, 3334, 3333]);
    expect(fixed.perLp.reduce((a, x) => a + x.grossMinor, 0)).toBe(10001);
  });

  it("DEFECT-2 — combined carry above 1 drove `distributable` and every netMinor NEGATIVE", () => {
    // Each leg passes the [0,1] check at spvEngineStore.ts:557 on its own.
    const old = legacy(1_000_000, 1_000_000, 0.6, 0.6, [500_000, 500_000]);
    expect(old.distributable).toBeLessThan(0);
    expect(old.allocations.every((a) => a.netMinor < 0)).toBe(true);

    // The fix refuses the same input outright.
    expect(() =>
      allocateDistributionMinor({
        grossMinor: 1_000_000, carryBaseMinor: 1_000_000,
        gpCarryFraction: 0.6, platformCarryFraction: 0.6,
        lpWeightsMinor: [500_000, 500_000],
      }),
    ).toThrow("COMBINED_CARRY_EXCEEDS_CAP");
  });

  it("DEFECT-3 — two independent carry roundings could exceed the base even under the cap", () => {
    // gpPct + platPct === 1 exactly, base = 1 minor unit. Math.round rounds
    // half AWAY from zero, so both legs round UP: 1 + 1 = 2 > base of 1.
    const old = legacy(1, 1, 0.5, 0.5, [1]);
    expect(old.totalCarryMinor).toBe(2);
    expect(old.distributable).toBe(-1);

    // One allocation over the base cannot do that: the parts sum to the base.
    const fixed = allocateDistributionMinor({
      grossMinor: 1, carryBaseMinor: 1, gpCarryFraction: 0.5, platformCarryFraction: 0.5,
      lpWeightsMinor: [1],
    });
    expect(fixed.gpCarryMinor + fixed.platformCarryMinor).toBe(1);
    expect(fixed.distributableMinor).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AC-MC-1.a — exact-sum property tests over many random splits (pure)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("AC-MC-1.a — exact summation over many random splits", () => {
  it("500 random (gross, base, rates, LP weights) cases conserve every component exactly", () => {
    const rnd = mulberry32(0x3b0f11ce);
    for (let iter = 0; iter < 500; iter++) {
      const n = 1 + Math.floor(rnd() * 9);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(1 + Math.floor(rnd() * 1_000_000));
      const gross = Math.floor(rnd() * 50_000_000);
      const carryBase = Math.floor(rnd() * (gross + 1));
      // Rates constrained to a legal pair: their sum never exceeds the cap.
      const gp = Math.round(rnd() * 1e6) / 1e6;
      const plat = Math.round(rnd() * (1 - gp) * 1e6) / 1e6;

      const r = allocateDistributionMinor({
        grossMinor: gross, carryBaseMinor: carryBase,
        gpCarryFraction: gp, platformCarryFraction: plat,
        lpWeightsMinor: weights,
      });

      const ctx = `iter=${iter} n=${n} gross=${gross} base=${carryBase} gp=${gp} plat=${plat}`;
      expect(r.perLp.reduce((a, x) => a + x.grossMinor, 0), ctx).toBe(gross);
      expect(r.perLp.reduce((a, x) => a + x.carryMinor, 0), ctx).toBe(r.totalCarryMinor);
      expect(r.perLp.reduce((a, x) => a + x.gpCarryMinor, 0), ctx).toBe(r.gpCarryMinor);
      expect(r.perLp.reduce((a, x) => a + x.platformCarryMinor, 0), ctx).toBe(r.platformCarryMinor);
      expect(r.perLp.reduce((a, x) => a + x.netMinor, 0), ctx).toBe(gross - r.totalCarryMinor);
      expect(r.gpCarryMinor + r.platformCarryMinor + r.retainedCarryBaseMinor, ctx).toBe(carryBase);
      expect(r.distributableMinor, ctx).toBeGreaterThanOrEqual(0);
      for (const lp of r.perLp) {
        expect(lp.netMinor, ctx).toBeGreaterThanOrEqual(0);
        expect(lp.gpCarryMinor + lp.platformCarryMinor, ctx).toBe(lp.carryMinor);
        expect(lp.grossMinor, ctx).toBe(lp.carryMinor + lp.netMinor);
        /* WAVE 3D / ITEM 2 — THE INDEPENDENT PER-LP INEQUALITY.
         *
         * W3 REVIEW A showed this suite was self-satisfying: the mutation
         * `l3_uses_original_weights` (L3 taking `weights` instead of the L2
         * result `lpGross`) survived all 22 tests. It survived because every
         * assertion above is either a SUM or is derived from `netMinor`, and
         * the mutant still conserves sums — it just moves carry to the wrong
         * LPs. The moment `netMinor` is also derived from the same mutated
         * `carryMinor`, `grossMinor === carryMinor + netMinor` holds trivially
         * and proves nothing.
         *
         * `carryMinor <= grossMinor` is the one relation the mutant cannot
         * satisfy: it is the L3 nesting invariant itself (c_i <= g_i, proved in
         * money.ts), stated on data the mutant actually changes and NOT
         * expressible as a total. It is asserted on EVERY LP of EVERY iteration
         * so no single lucky draw can hide the break. */
        expect(lp.carryMinor, `${ctx} carry<=gross`).toBeLessThanOrEqual(lp.grossMinor);
      }
    }
  });

  it("AC-MC-1.a2 — a full-carry (100%) distribution still conserves and never goes negative", () => {
    const rnd = mulberry32(7);
    for (let iter = 0; iter < 120; iter++) {
      const n = 1 + Math.floor(rnd() * 5);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(1 + Math.floor(rnd() * 97));
      const gross = Math.floor(rnd() * 1000);
      const r = allocateDistributionMinor({
        grossMinor: gross, carryBaseMinor: gross,
        gpCarryFraction: 0.5, platformCarryFraction: 0.5,
        lpWeightsMinor: weights,
      });
      expect(r.totalCarryMinor).toBe(gross);
      expect(r.distributableMinor).toBe(0);
      expect(r.perLp.every((x) => x.netMinor === 0)).toBe(true);
      expect(r.perLp.reduce((a, x) => a + x.carryMinor, 0)).toBe(gross);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 3D / ITEM 2 — MUTATION-KILLING TESTS
 *
 * W3 REVIEW A ran a mutation matrix against this suite and found it
 * SELF-SATISFYING. Two mutations survived all 22 tests:
 *
 *   l3_uses_original_weights  L3 allocates totalCarry over the ORIGINAL LP
 *                             weights instead of over the L2 result `lpGross`.
 *                             De-nests the allocator; breaks c_i <= g_i.
 *   net_assertion_deleted     the runtime `net < 0` post-condition assertion in
 *                             money.ts is removed.
 *
 * Applied TOGETHER they produce a NEGATIVE net paid to a real LP while the
 * whole suite stays green — the exact failure mode this wave exists to prevent.
 *
 * Each test below is written to kill ONE mutation on its own, so neither can
 * hide behind the other. The before/after matrix is in
 * build_log/WAVE3D_REPORT.md.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3D / ITEM 2 — mutation kills", () => {
  /* ── KILL 1: l3_uses_original_weights ─────────────────────────────────── */

  it("MUT-KILL-1 — the review's exact counterexample: gross=4, base=3, gp=1, weights=[1,3,3]", () => {
    /* This is the counterexample W3 REVIEW A derived by hand.
     *
     * CORRECT (nested) allocator:
     *   L1  base 3 at gp=1, plat=0        -> gpCarry = 3, totalCarry = 3
     *   L2  gross 4 over weights [1,3,3]  -> lpGross = [1, 2, 1]  (W=7:
     *       products 4,12,12; floors 0,1,1; remainders 4,5,5; residual 2 to the
     *       two tied 5s, weights tie at 3 so index decides -> [1,2,1] sums to 4)
     *   L3  carry 3 over lpGross [1,2,1]  -> carry_i <= gross_i, so net >= 0
     *
     * MUTANT (L3 over the ORIGINAL weights [1,3,3]):
     *   carry 3 over [1,3,3] -> [0, 2, 1]... but the mutant's shares track the
     *   ORIGINAL ownership, not the gross actually allocated, so an LP whose
     *   gross rounded DOWN can still be charged carry as if it had rounded up.
     *   The review reports net [-1, 1, 1] for this input.
     *
     * The assertion that kills it is per-LP, not a sum: the mutant still
     * conserves totals. */
    const r = allocateDistributionMinor({
      grossMinor: 4,
      carryBaseMinor: 3,
      gpCarryFraction: 1,
      platformCarryFraction: 0,
      lpWeightsMinor: [1, 3, 3],
    });

    // Totals are conserved (true for BOTH the correct allocator and the mutant
    // — which is precisely why the old suite could not tell them apart).
    expect(r.perLp.reduce((a, x) => a + x.grossMinor, 0)).toBe(4);
    expect(r.perLp.reduce((a, x) => a + x.carryMinor, 0)).toBe(r.totalCarryMinor);
    expect(r.totalCarryMinor).toBe(3);

    // These are the assertions the mutant fails. NO LP MAY BE CHARGED MORE
    // CARRY THAN THE GROSS IT WAS ALLOCATED, and no net may be negative.
    for (let i = 0; i < r.perLp.length; i++) {
      const lp = r.perLp[i];
      expect(lp.carryMinor, `lp[${i}] carry<=gross`).toBeLessThanOrEqual(lp.grossMinor);
      expect(lp.netMinor, `lp[${i}] net>=0`).toBeGreaterThanOrEqual(0);
    }
    // Explicitly pin the negative vector the review reproduced, so a future
    // regression to it is named in the failure output rather than inferred.
    expect(r.perLp.map((x) => x.netMinor)).not.toEqual([-1, 1, 1]);
  });

  it("MUT-KILL-1b — carry never exceeds gross for ANY LP across 400 adversarial draws", () => {
    /* The counterexample above is one point. This is the same inequality swept
     * over the region where it is FRAGILE: carryBase == gross (so totalCarry
     * can equal gross exactly), full carry rates, and small/skewed weights that
     * force heavy rounding. A de-nested L3 breaks here almost immediately. */
    const rnd = mulberry32(0x3d17ea52);
    for (let iter = 0; iter < 400; iter++) {
      const n = 1 + Math.floor(rnd() * 6);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(1 + Math.floor(rnd() * 9));
      const gross = Math.floor(rnd() * 40);
      const carryBase = gross; // the fragile edge: carry may consume all of it
      const gp = Math.round(rnd() * 100) / 100;
      const plat = Math.round(rnd() * (1 - gp) * 100) / 100;

      const r = allocateDistributionMinor({
        grossMinor: gross,
        carryBaseMinor: carryBase,
        gpCarryFraction: gp,
        platformCarryFraction: plat,
        lpWeightsMinor: weights,
      });

      const ctx = `iter=${iter} gross=${gross} w=[${weights}] gp=${gp} plat=${plat}`;
      expect(r.perLp.reduce((a, x) => a + x.grossMinor, 0), ctx).toBe(gross);
      for (let i = 0; i < r.perLp.length; i++) {
        expect(r.perLp[i].carryMinor, `${ctx} lp[${i}] carry<=gross`)
          .toBeLessThanOrEqual(r.perLp[i].grossMinor);
        expect(r.perLp[i].netMinor, `${ctx} lp[${i}] net>=0`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("MUT-KILL-1c — ZERO-WEIGHT LPs get exactly zero gross, zero carry and zero net", () => {
    /* Zero-weight LPs are where a de-nested L3 shows itself most starkly: with
     * the correct nesting a zero-weight LP receives gross 0, therefore carry 0.
     * A mutant that allocates carry over some other weight vector can hand a
     * zero-gross LP a POSITIVE carry, i.e. a negative net, and every SUM in the
     * old suite still balances. Random draws, always containing at least one
     * zero weight. */
    const rnd = mulberry32(0x3d02e0);
    for (let iter = 0; iter < 200; iter++) {
      const n = 2 + Math.floor(rnd() * 5);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(rnd() < 0.45 ? 0 : 1 + Math.floor(rnd() * 1000));
      if (weights.every((w) => w === 0)) weights[0] = 1; // total weight must be > 0
      if (weights.every((w) => w !== 0)) weights[iter % n] = 0; // guarantee a zero
      const gross = Math.floor(rnd() * 100_000);
      const carryBase = Math.floor(rnd() * (gross + 1));
      const gp = Math.round(rnd() * 1000) / 1000;
      const plat = Math.round(rnd() * (1 - gp) * 1000) / 1000;

      const r = allocateDistributionMinor({
        grossMinor: gross,
        carryBaseMinor: carryBase,
        gpCarryFraction: gp,
        platformCarryFraction: plat,
        lpWeightsMinor: weights,
      });

      const ctx = `iter=${iter} w=[${weights}] gross=${gross}`;
      expect(r.perLp.reduce((a, x) => a + x.grossMinor, 0), ctx).toBe(gross);
      expect(r.perLp.reduce((a, x) => a + x.carryMinor, 0), ctx).toBe(r.totalCarryMinor);
      for (let i = 0; i < n; i++) {
        const lp = r.perLp[i];
        if (weights[i] === 0) {
          expect(lp.grossMinor, `${ctx} zero-weight lp[${i}] gross`).toBe(0);
          expect(lp.carryMinor, `${ctx} zero-weight lp[${i}] carry`).toBe(0);
          expect(lp.netMinor, `${ctx} zero-weight lp[${i}] net`).toBe(0);
        }
        expect(lp.carryMinor, `${ctx} lp[${i}] carry<=gross`).toBeLessThanOrEqual(lp.grossMinor);
        expect(lp.netMinor, `${ctx} lp[${i}] net>=0`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  /* ── KILL 2: net_assertion_deleted ────────────────────────────────────── */

  it("MUT-KILL-2-LOGIC — the per-LP net post-condition throws on a negative net", () => {
    /* KILLS the mutation DIRECTLY. `net_assertion_deleted` survived the old
     * suite because, with a correct allocator, the assertion is UNREACHABLE:
     * the L3 nesting invariant proves carry_i <= gross_i, so no input can make
     * it fire. That is defence-in-depth, and no behavioural test through
     * `allocateDistributionMinor` can kill it.
     *
     * ITEM 2's answer is to extract the post-condition into
     * `assertPerLpNetNonNegative` (money.ts) and call IT with the state the
     * allocator must never produce. Delete or weaken the logic and this test
     * goes red on its own. */
    expect(() => assertPerLpNetNonNegative(0, BigInt(1), BigInt(2)))
      .toThrow("DISTRIBUTION_ALLOCATION_NET_NEGATIVE");
    expect(() => assertPerLpNetNonNegative(2, BigInt(0), BigInt(1)))
      .toThrow("DISTRIBUTION_ALLOCATION_NET_NEGATIVE:index=2:gross=0:carry=1");
    // The review's exact negative vector, asserted per position.
    expect(() => assertPerLpNetNonNegative(0, BigInt(0), BigInt(1)))
      .toThrow("DISTRIBUTION_ALLOCATION_NET_NEGATIVE");

    // ...and it must NOT throw on the legitimate boundary (net exactly zero) or
    // on any ordinary case, or it would be a different bug.
    expect(() => assertPerLpNetNonNegative(0, BigInt(5), BigInt(5))).not.toThrow();
    expect(() => assertPerLpNetNonNegative(0, BigInt(5), BigInt(0))).not.toThrow();
    expect(() => assertPerLpNetNonNegative(0, BigInt(0), BigInt(0))).not.toThrow();
  });

  it("MUT-KILL-2-CALLSITE — the allocator still CALLS the post-condition per LP", () => {
    /* Companion to MUT-KILL-2-LOGIC. Extracting the assertion makes the LOGIC
     * killable; this makes REMOVING THE CALL killable. Both deletions are
     * required to reopen the hole, and each now fails a test on its own.
     *
     * This is a source assertion, which is weaker than a behavioural one, and
     * it is used here only because the branch is provably unreachable while the
     * allocator is correct. It is scoped tightly to the per-LP loop so it
     * cannot be satisfied by a mention in a comment. */
    const src = fs.readFileSync(
      path.join(__dirname, "..", "lib", "money.ts"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    // Scope to allocateDistributionMinor: the same loop header also appears in
    // allocateResidualCents, and matching that one would prove nothing.
    const fnStart = code.indexOf("export function allocateDistributionMinor(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = code.slice(fnStart);
    const loopStart = fnBody.indexOf("for (let i = 0; i < weights.length; i++) {");
    expect(loopStart).toBeGreaterThan(-1);
    const loopBody = fnBody.slice(loopStart, loopStart + 1400);
    expect(loopBody).toContain("assertPerLpNetNonNegative(i, g, c);");
  });

  it("MUT-KILL-2 — a negative net is impossible for every LP of every generated case", () => {
    /* The runtime `net < 0` post-condition in money.ts is a LAST LINE OF
     * DEFENCE, and deleting it survived the old suite because nothing else
     * asserted non-negativity on data that could actually go negative.
     *
     * This test does not assert that the assertion EXISTS (a text check would
     * be trivially satisfiable and would not test behaviour). It asserts the
     * PROPERTY the assertion protects, over inputs chosen to sit exactly on the
     * boundary where it bites: carryBase == gross with the carry rates summing
     * to the full cap, so distributable is 0 and any single misallocated cent
     * makes some LP negative. Under the correct allocator every net is exactly
     * 0 here; under a de-nested or unguarded one, at least one goes below. */
    const rnd = mulberry32(0x4e6a71);
    for (let iter = 0; iter < 300; iter++) {
      const n = 1 + Math.floor(rnd() * 7);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(1 + Math.floor(rnd() * 31));
      const gross = Math.floor(rnd() * 200);
      const gp = Math.round(rnd() * 1e6) / 1e6;
      const plat = Math.round((1 - gp) * 1e6) / 1e6; // sums to exactly the cap

      const r = allocateDistributionMinor({
        grossMinor: gross,
        carryBaseMinor: gross,
        gpCarryFraction: gp,
        platformCarryFraction: plat,
        lpWeightsMinor: weights,
      });

      const ctx = `iter=${iter} gross=${gross} w=[${weights}] gp=${gp} plat=${plat}`;
      expect(r.distributableMinor, ctx).toBe(0);
      expect(r.totalCarryMinor, ctx).toBe(gross);
      for (let i = 0; i < n; i++) {
        expect(r.perLp[i].netMinor, `${ctx} lp[${i}] net`).toBe(0);
        expect(r.perLp[i].carryMinor, `${ctx} lp[${i}] carry`).toBe(r.perLp[i].grossMinor);
      }
    }
  });

  it("MUT-KILL-2b — sum(net) is never negative and equals gross - totalCarry, componentwise", () => {
    /* Companion to MUT-KILL-2 across the ordinary (non-boundary) region, so the
     * non-negativity property is pinned everywhere, not only at the edge. */
    const rnd = mulberry32(0x51de);
    for (let iter = 0; iter < 300; iter++) {
      const n = 1 + Math.floor(rnd() * 8);
      const weights: number[] = [];
      for (let i = 0; i < n; i++) weights.push(Math.floor(rnd() * 5000));
      if (weights.every((w) => w === 0)) weights[0] = 1;
      const gross = Math.floor(rnd() * 1_000_000);
      const carryBase = Math.floor(rnd() * (gross + 1));
      const gp = Math.round(rnd() * 500_000) / 1e6;
      const plat = Math.round(rnd() * 400_000) / 1e6;

      const r = allocateDistributionMinor({
        grossMinor: gross,
        carryBaseMinor: carryBase,
        gpCarryFraction: gp,
        platformCarryFraction: plat,
        lpWeightsMinor: weights,
      });

      const ctx = `iter=${iter} gross=${gross} base=${carryBase}`;
      expect(r.perLp.reduce((a, x) => a + x.netMinor, 0), ctx).toBe(gross - r.totalCarryMinor);
      expect(r.perLp.reduce((a, x) => a + x.netMinor, 0), ctx).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < n; i++) {
        expect(r.perLp[i].netMinor, `${ctx} lp[${i}]`).toBeGreaterThanOrEqual(0);
        expect(r.perLp[i].carryMinor, `${ctx} lp[${i}]`).toBeLessThanOrEqual(r.perLp[i].grossMinor);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 3D / ITEM 4 — the cap comparison is EXACT, not a float sum
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3D / ITEM 4 — exact fixed-scale cap comparison", () => {
  it("ITEM4-1 — 0.5000000000000001 + 0.5 is REJECTED, not silently rounded to 1", () => {
    /* W3 REVIEW A reproduction (build_log/w3_review_a_cap_precision.ts): the old
     * guard evaluated `gpCarryPct + platCarryPct > CAP` in binary floating point
     * and JavaScript computes 0.5000000000000001 + 0.5 as EXACTLY 1, so a pair
     * strictly above the cap was accepted.
     *
     * The rate now converts through its shortest exact decimal to an integer on
     * CARRY_FRACTION_SCALE (1e9), and precision finer than 1e-9 is REJECTED
     * rather than rounded away — refusing to guess is the correct behaviour for
     * a money rate. */
    expect(() =>
      allocateDistributionMinor({
        grossMinor: 1_000_000,
        carryBaseMinor: 1_000_000,
        gpCarryFraction: 0.5000000000000001,
        platformCarryFraction: 0.5,
        lpWeightsMinor: [1, 1],
      }),
    ).toThrow("DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED");
  });

  it("ITEM4-2 — rates AT the supported scale still convert exactly", () => {
    expect(decimalStringToCarryScaled("0.2", "t")).toBe(BigInt(200_000_000));
    expect(decimalStringToCarryScaled("1", "t")).toBe(BigInt(CARRY_FRACTION_SCALE));
    expect(decimalStringToCarryScaled("0", "t")).toBe(BigInt(0));
    expect(decimalStringToCarryScaled("0.000000001", "t")).toBe(BigInt(1));
    expect(exactFractionToCarryScaled(0.123456, "t")).toBe(BigInt(123_456_000));
    expect(exactFractionToCarryScaled(0.05, "t")).toBe(BigInt(50_000_000));
  });

  it("ITEM4-3 — one ulp beyond the scale is refused rather than rounded", () => {
    expect(() => exactFractionToCarryScaled(0.0000000001, "t"))
      .toThrow("DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED");
    expect(() => decimalStringToCarryScaled("0.1234567891", "t"))
      .toThrow("DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED");
    // Out of range is still the pre-existing error, not the new one.
    expect(() => exactFractionToCarryScaled(1.5, "t"))
      .toThrow("DISTRIBUTION_ALLOCATION_INVALID_RATE");
    expect(() => exactFractionToCarryScaled(-0.1, "t"))
      .toThrow("DISTRIBUTION_ALLOCATION_INVALID_RATE");
  });

  it("ITEM4-4 — the exact-boundary pair 0.7 + 0.3 is still ACCEPTED", () => {
    // Regression guard on the fix itself: making the comparison exact must not
    // start rejecting legitimate pairs that sum to exactly the cap.
    const r = allocateDistributionMinor({
      grossMinor: 1_000_000,
      carryBaseMinor: 1_000_000,
      gpCarryFraction: 0.7,
      platformCarryFraction: 0.3,
      lpWeightsMinor: [1, 2, 3],
    });
    expect(r.gpCarryMinor + r.platformCarryMinor).toBe(1_000_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 3D / ITEM 5 — residual tie-break is (remainder DESC, weight DESC,
 * index ASC). Owner ruling 2026-08-10.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3D / ITEM 5 — largest-holder residual tie-break", () => {
  it("ITEM5-1 — tied remainders, unequal weights: the LARGER holder takes the cent", () => {
    /* weights [1,3], total 2: totalWeight 4; products 2 and 6; floors 0 and 1;
     * remainders 2 and 2 — TIED. The old (remainder DESC, index ASC) rule gave
     * the residual to index 0, the SMALLER holder, purely because it was first.
     * The larger holder now takes it. */
    expect(allocateResidualCents(BigInt(2), [BigInt(1), BigInt(3)]).map(Number)).toEqual([0, 2]);
    // Mirror image: larger holder first — same rule, so index 0 wins on WEIGHT
    // this time, not on position.
    expect(allocateResidualCents(BigInt(2), [BigInt(3), BigInt(1)]).map(Number)).toEqual([2, 0]);
  });

  it("ITEM5-2 — the total is unchanged by the reordering", () => {
    const cases: Array<[number, number[]]> = [
      [2, [1, 3]], [2, [3, 1]], [7, [1, 2, 4]], [101, [5, 5, 1]],
      [13, [2, 2, 3, 3]], [1, [1, 1, 1, 1]], [999, [7, 11, 13]],
    ];
    for (const [total, w] of cases) {
      const out = allocateResidualCents(BigInt(total), w.map((x) => BigInt(x)));
      expect(out.reduce((a, x) => a + x, BigInt(0)), `total=${total} w=[${w}]`)
        .toBe(BigInt(total));
      expect(out.every((x) => x >= BigInt(0)), `total=${total} w=[${w}]`).toBe(true);
    }
  });

  it("ITEM5-3 — conservation and non-negativity hold over random draws under the new rule", () => {
    const rnd = mulberry32(0x1e5b0);
    for (let iter = 0; iter < 500; iter++) {
      const n = 1 + Math.floor(rnd() * 8);
      const w: bigint[] = [];
      for (let i = 0; i < n; i++) w.push(BigInt(Math.floor(rnd() * 50)));
      if (w.every((x) => x === BigInt(0))) w[0] = BigInt(1);
      const total = BigInt(Math.floor(rnd() * 10_000));
      const out = allocateResidualCents(total, w);
      const ctx = `iter=${iter} w=[${w}] total=${total}`;
      expect(out.reduce((a, x) => a + x, BigInt(0)), ctx).toBe(total);
      for (let i = 0; i < n; i++) {
        expect(out[i] >= BigInt(0), ctx).toBe(true);
        if (w[i] === BigInt(0)) expect(out[i], `${ctx} zero weight`).toBe(BigInt(0));
      }
    }
  });

  it("ITEM5-4 — the comparator is a TOTAL ORDER: repeated calls are identical (pure)", () => {
    const w = [BigInt(3), BigInt(3), BigInt(1), BigInt(5)];
    const first = allocateResidualCents(BigInt(37), w);
    for (let i = 0; i < 25; i++) {
      expect(allocateResidualCents(BigInt(37), w)).toEqual(first);
    }
  });

  it("ITEM5-5 — HONEST LIMIT: with ALL-EQUAL weights the bias is reduced, NOT eliminated", () => {
    /* Stated plainly rather than overclaimed. When every weight is equal the
     * weights tie too, the comparator falls through to its final determinism
     * fallback (index ASC), and index 0 still collects every residual cent.
     * W3 REVIEW A measured 19.996% of residuals landing on index 0 over 100,000
     * equal-weight distributions; that specific measurement is UNCHANGED by
     * this ruling. What the ruling fixes is every UNEQUAL-weight register,
     * where the residual now lands on the largest holder — where it is least
     * material — instead of on whoever happens to be listed first.
     *
     * Fully removing the equal-weight bias requires a persisted rotating
     * residual cursor, which is deliberately NOT built in this wave (it would
     * be net-new state, and the standing instruction is repair-only). Logged as
     * a follow-up in build_log/WAVE3D_REPORT.md. This test PINS the residual
     * bias so nobody later reads the tie-break change as having removed it. */
    const equal = [BigInt(1), BigInt(1), BigInt(1), BigInt(1)];
    expect(allocateResidualCents(BigInt(6), equal).map(Number)).toEqual([2, 2, 1, 1]);
    expect(allocateResidualCents(BigInt(5), equal).map(Number)).toEqual([2, 1, 1, 1]);

    // Aggregate the bias explicitly: index 0 wins every equal-weight residual.
    let idx0 = 0;
    let idxLast = 0;
    for (let t = 1; t <= 400; t++) {
      const out = allocateResidualCents(BigInt(t), equal);
      const floor = BigInt(Math.floor(t / 4));
      if (out[0] > floor) idx0++;
      if (out[3] > floor) idxLast++;
    }
    expect(idx0).toBeGreaterThan(0);
    expect(idxLast).toBe(0); // the last index NEVER wins an equal-weight residual
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AC-MC-1.b — tie-break, single LP, indivisible remainder, zero gross (pure)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("AC-MC-1.b — the documented tie-breaker and the named edge cases", () => {
  it("reuses allocateResidualCents with the tie-break (remainder DESC, weight DESC, index ASC)", () => {
    /* WAVE 3D / ITEM 5 — TITLE AND COMMENT UPDATED, VECTORS UNCHANGED.
     *
     * These three Wave 0 acceptance vectors are NOT affected by the owner's
     * tie-break ruling, and it is worth saying why rather than just leaving
     * them green:
     *   [1,1,1] cases — weights are EQUAL, so the new `weight DESC` term ties
     *     as well and the comparator falls through to index ASC exactly as
     *     before. Same output.
     *   [4,1] case — the remainders are 4 and 1, so there is NO TIE; the
     *     tie-break never runs. Same output.
     * The vectors that DO change are covered in the ITEM 5 suite above.
     *
     * The old title called this rule "DDL-pinned", after
     * `allocation_rule.CHECK (tie_break = 'remainder_desc_index_asc')` in
     * server/db/connection.ts. That table is created by DDL and never read or
     * written by production code, so it pins nothing at run time — the claim
     * is dropped rather than restated. See WAVE3D_REPORT.md follow-ups. */
    expect(allocateResidualCents(BigInt(10001), [BigInt(1), BigInt(1), BigInt(1)]).map(Number)).toEqual([3334, 3334, 3333]);
    expect(allocateResidualCents(BigInt(1), [BigInt(4), BigInt(1)]).map(Number)).toEqual([1, 0]);
    expect(allocateResidualCents(BigInt(100), [BigInt(1), BigInt(1), BigInt(1)]).map(Number)).toEqual([34, 33, 33]);
  });

  it("SINGLE LP — takes the entire gross and the entire net, to the cent", () => {
    const r = allocateDistributionMinor({
      grossMinor: 1_000_001, carryBaseMinor: 500_001,
      gpCarryFraction: 0.2, platformCarryFraction: 0.05,
      lpWeightsMinor: [123_456],
    });
    expect(r.perLp.length).toBe(1);
    expect(r.perLp[0].grossMinor).toBe(1_000_001);
    expect(r.perLp[0].carryMinor).toBe(r.totalCarryMinor);
    expect(r.perLp[0].netMinor).toBe(1_000_001 - r.totalCarryMinor);
    // 25% of 500001 = 125000.25 -> the base splits 100000 / 25000 / 375001.
    expect(r.gpCarryMinor).toBe(100_000);
    expect(r.platformCarryMinor).toBe(25_000);
    expect(r.gpCarryMinor + r.platformCarryMinor + r.retainedCarryBaseMinor).toBe(500_001);
  });

  it("THREE LPs, INDIVISIBLE REMAINDER — the odd cents land by tie-break, nothing is lost", () => {
    const r = allocateDistributionMinor({
      grossMinor: 10_001, carryBaseMinor: 10_001,
      gpCarryFraction: 0.2, platformCarryFraction: 0.1,
      lpWeightsMinor: [1, 1, 1],
    });
    expect(r.perLp.map((x) => x.grossMinor)).toEqual([3334, 3334, 3333]);
    // Base 10001 at 20% / 10% / 70% retained: floors 2000 / 1000 / 7000 = 10000,
    // residual 1 to the largest remainder (the 70% leg), so carry stays 3000.
    expect(r.gpCarryMinor).toBe(2000);
    expect(r.platformCarryMinor).toBe(1000);
    expect(r.retainedCarryBaseMinor).toBe(7001);
    expect(r.totalCarryMinor).toBe(3000);
    expect(r.perLp.reduce((a, x) => a + x.carryMinor, 0)).toBe(3000);
    expect(r.perLp.reduce((a, x) => a + x.netMinor, 0)).toBe(7001);
    expect(r.perLp.every((x) => x.netMinor >= 0)).toBe(true);
  });

  it("ZERO GROSS — everything is zero, nothing throws, nothing is invented", () => {
    const r = allocateDistributionMinor({
      grossMinor: 0, carryBaseMinor: 0,
      gpCarryFraction: 0.2, platformCarryFraction: 0.05,
      lpWeightsMinor: [100, 200, 300],
    });
    expect(r.totalCarryMinor).toBe(0);
    expect(r.distributableMinor).toBe(0);
    expect(r.perLp).toEqual([
      { grossMinor: 0, carryMinor: 0, gpCarryMinor: 0, platformCarryMinor: 0, netMinor: 0 },
      { grossMinor: 0, carryMinor: 0, gpCarryMinor: 0, platformCarryMinor: 0, netMinor: 0 },
      { grossMinor: 0, carryMinor: 0, gpCarryMinor: 0, platformCarryMinor: 0, netMinor: 0 },
    ]);
  });

  it("percentages are FRACTIONS, never converted: 0.2 means 20%, and 20 is rejected", () => {
    const r = allocateDistributionMinor({
      grossMinor: 1000, carryBaseMinor: 1000, gpCarryFraction: 0.2, platformCarryFraction: 0,
      lpWeightsMinor: [1],
    });
    expect(r.gpCarryMinor).toBe(200); // 20% of 1000 — not 0.2% and not 2000%.
    expect(() =>
      allocateDistributionMinor({
        grossMinor: 1000, carryBaseMinor: 1000, gpCarryFraction: 20, platformCarryFraction: 0,
        lpWeightsMinor: [1],
      }),
    ).toThrow("DISTRIBUTION_ALLOCATION_INVALID_RATE");
    expect(CARRY_FRACTION_SCALE).toBe(1000000000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AC-P-5 — adversarial rates whose SUM exceeds the cap
 * ══════════════════════════════════════════════════════════════════════════ */

describe("AC-P-5 — combined carry above the cap is rejected", () => {
  it("AC-P-5.a — every adversarial pair summing above 1 throws COMBINED_CARRY_EXCEEDS_CAP", () => {
    const pairs: Array<[number, number]> = [
      [0.6, 0.6], [1, 0.0000001], [0.9, 0.2], [0.51, 0.5], [1, 1], [0.5000001, 0.5],
    ];
    for (const [gp, plat] of pairs) {
      expect(
        () => allocateDistributionMinor({
          grossMinor: 1_000_000, carryBaseMinor: 1_000_000,
          gpCarryFraction: gp, platformCarryFraction: plat, lpWeightsMinor: [1, 2, 3],
        }),
        `gp=${gp} plat=${plat}`,
      ).toThrow("COMBINED_CARRY_EXCEEDS_CAP");
    }
  });

  it("AC-P-5.b — the boundary pair summing to exactly the cap is ACCEPTED", () => {
    const r = allocateDistributionMinor({
      grossMinor: 1_000_000, carryBaseMinor: 1_000_000,
      gpCarryFraction: 0.7, platformCarryFraction: 0.3, lpWeightsMinor: [1, 2, 3],
    });
    expect(r.gpCarryMinor).toBe(700_000);
    expect(r.platformCarryMinor).toBe(300_000);
    expect(r.distributableMinor).toBe(0);
    /* WAVE 3D / ITEM 3 — EXPECTATION MIGRATED, VALUE UNCHANGED. This line used
     * to read `expect(COMBINED_CARRY_CAP_FRACTION).toBe(1)` against a hardcoded
     * module constant. The cap now comes from durable DB configuration
     * (`spv_carry_cap_policy`, migration 0150) as an exact integer on
     * CARRY_FRACTION_SCALE. The seeded platform row is 1e9, i.e. the SAME cap of
     * 1.0 — upgrade behaviour is unchanged, only the source of truth moved. */
    expect(resolveCombinedCarryCapScaled({})).toBe(CARRY_FRACTION_SCALE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PERSISTED PATH — the assertions that a preview-only guard cannot satisfy
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3B PERSISTED — recordDistribution writes exactly-conserved money", () => {
  it("PERSIST-1 — 3 LPs with an indivisible gross: the PERSISTED row sums exactly", async () => {
    const spvId = await createSpv("W3B indivisible three");
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_w3b_i1", 1000);
    await commitLp(spvId, "inv_w3b_i2", 1000);
    await commitLp(spvId, "inv_w3b_i3", 1000);

    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 10001, costBasisMinor: 1,
      settlementOutcome: "succeeded", settlementReason: "wave 3b indivisible",
    });
    expect(r.status).toBe(201);

    const persisted = spvEngineStore.listDistributions(PARTNER_A, spvId);
    expect(persisted.length).toBe(1);
    const d = persisted[0];
    assertConserved(d);
    expect(d.allocations.map((a) => a.grossMinor)).toEqual([3334, 3334, 3333]);
    expect(d.allocations.reduce((a, x) => a + x.grossMinor, 0)).toBe(10001);
  });

  it("PERSIST-2 — single LP: the PERSISTED row gives the whole gross to that LP", async () => {
    const spvId = await createSpv("W3B single lp");
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_w3b_single", 777_777);

    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1_000_003, costBasisMinor: 500_001,
      settlementOutcome: "succeeded", settlementReason: "wave 3b single",
    });
    expect(r.status).toBe(201);
    const d = spvEngineStore.listDistributions(PARTNER_A, spvId)[0];
    assertConserved(d);
    expect(d.allocations.length).toBe(1);
    expect(d.allocations[0].grossMinor).toBe(1_000_003);
  });

  it("PERSIST-3 — zero gross with committed LPs: a zero row, no carry, no negative net", async () => {
    const spvId = await createSpv("W3B zero gross");
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_w3b_z1", 1000);
    await commitLp(spvId, "inv_w3b_z2", 3000);

    // No carry => no settlement authorization needed (WAVE 1A leaves the
    // zero-carry path open to the partner). This is the partner route.
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "wind_down", grossProceedsMinor: 0, costBasisMinor: 0,
    });
    expect(r.status).toBe(201);
    const d = spvEngineStore.listDistributions(PARTNER_A, spvId)[0];
    assertConserved(d);
    expect(d.grossProceedsMinor).toBe(0);
    expect(d.gpCarryMinor).toBe(0);
    expect(d.allocations.every((a) => a.grossMinor === 0 && a.carryMinor === 0 && a.netMinor === 0)).toBe(true);
  });

  it("PERSIST-4 — 40 random persisted distributions all conserve to the cent", async () => {
    const rnd = mulberry32(0xc0ffee);
    for (let iter = 0; iter < 40; iter++) {
      const spvId = await createSpv(`W3B random ${iter}`);
      const gpPct = Math.round(rnd() * 300) / 1000;          // 0 … 0.300
      const platPct = Math.round(rnd() * 100) / 1000;         // 0 … 0.100
      if (gpPct > 0) {
        await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: gpPct });
      }
      if (platPct > 0) {
        const pf = await post(`/api/admin/consortium-spv/${spvId}/platform-fee`, ADMIN, {
          sponsorPartnerId: PARTNER_A, feeType: "carry", carryPct: platPct,
        });
        expect(pf.status).toBe(201);
      }
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        await commitLp(spvId, `inv_w3b_r${iter}_${i}`, 1 + Math.floor(rnd() * 999_999));
      }
      const gross = Math.floor(rnd() * 9_999_999);
      const basis = Math.floor(rnd() * (gross + 1));

      const d = recordViaAdminSettlement(spvId, { event: `exit_${iter}`, grossProceedsMinor: gross, costBasisMinor: basis });
      const persisted = spvEngineStore.listDistributions(PARTNER_A, spvId);
      expect(persisted.length).toBe(1);
      expect(persisted[0].id).toBe(d.id);
      assertConserved(persisted[0]);
    }
  });

  it("PERSIST-5 — ADVERSARIAL summed carry: the write is REJECTED and NO ROW EXISTS", async () => {
    const spvId = await createSpv("W3B adversarial summed carry");
    /* ── WAVE 3F / ITEM 3 — SETUP ONLY. OWNER RULING A-16. ──────────────────
     * A-16 made the CONFIG-TIME cross-layer check BLOCKING: an admin must
     * never be able to SAVE 0.6 + 0.6. That is asserted immediately below —
     * the second config write is now REFUSED with 400. Consequently the
     * illegal state this test needs can no longer be reached through the
     * config API, so A-16 rules that the SETUP is adapted to seed it directly
     * at store level.
     *
     * NOTHING THIS TEST ASSERTS HAS CHANGED. The assertions below — that the
     * DISTRIBUTION WRITER rejects 0.6 + 0.6 with COMBINED_CARRY_EXCEEDS_CAP,
     * that no row exists, that the admin route answers 400, and that no carry
     * obligation was settled — are byte-for-byte the ones Wave 3B pinned. Only
     * how the test ARRIVES at the illegal state changed, which A-16 explicitly
     * permits. The sink IS reachable without the config API, so the STOP-and-
     * report condition in A-16 does not apply.
     *
     * Each leg is still individually legal under the [0,1] check at :557. */
    const gp = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.6 });
    expect(gp.status).toBe(201);
    // A-16 first half: the config API REFUSES the combination outright.
    const pf = await post(`/api/admin/consortium-spv/${spvId}/platform-fee`, ADMIN, {
      sponsorPartnerId: PARTNER_A, feeType: "carry", carryPct: 0.6,
    });
    expect(pf.status).toBe(400);
    expect(pf.body.error).toBe("COMBINED_CARRY_EXCEEDS_CAP");
    // A-16 second half: seed the illegal stack at STORE level so the SINK is
    // still exercised on exactly the state Wave 3B pinned.
    seedOverCapPlatformCarry(spvId, 0.6);
    await commitLp(spvId, "inv_w3b_adv1", 500_000);
    await commitLp(spvId, "inv_w3b_adv2", 500_000);

    // Store level — the authoritative assertion.
    expect(() =>
      recordViaAdminSettlement(spvId, { event: "exit", grossProceedsMinor: 1_000_000, costBasisMinor: 0 }),
    ).toThrow("COMBINED_CARRY_EXCEEDS_CAP");
    expect(spvEngineStore.listDistributions(PARTNER_A, spvId).length).toBe(0);

    // HTTP level — through the real admin route, same outcome, still no row.
    const r = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1_000_000, costBasisMinor: 0,
      settlementOutcome: "succeeded", settlementReason: "should never land",
    });
    expect(r.status).not.toBe(201);
    /* WAVE 4A / follow-up 1 — TIGHTENED. COMBINED_CARRY_EXCEEDS_CAP was missing
     * from the err() status map in server/spvEngineRoutes.ts, so a correctly
     * REFUSED distribution surfaced as a 500 (an unhandled server fault) rather
     * than a 4xx (an invalid request). It is now mapped to 400 alongside the
     * other configuration refusals (FEES_EXCEED_RAISE, EXCEEDS_CAP). */
    expect(r.status).toBe(400);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(r.body.error).toBe("COMBINED_CARRY_EXCEEDS_CAP");
    expect(spvEngineStore.listDistributions(PARTNER_A, spvId).length).toBe(0);

    // And no carry obligation was settled on the way out — the rejection
    // precedes _collectCarryObligation, so nothing in the payment ledger moved.
    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    const carries = (obs.body.obligations ?? []).filter((o: any) => o.portion === "carry");
    expect(carries.every((c: any) => c.state !== "paid")).toBe(true);
  });

  it("PERSIST-6 — the partner route cannot smuggle a carry distribution past the guard either", async () => {
    const spvId = await createSpv("W3B adversarial partner route");
    /* WAVE 3F / ITEM 3 — SETUP ONLY, same A-16 adaptation as PERSIST-5. The
     * over-cap platform leg can no longer be saved through the admin config
     * route (it now answers 400), so it is seeded at store level. This test's
     * assertions — that the PARTNER distribution route cannot smuggle the
     * carry past the sink and that no row exists — are unchanged. */
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.7 });
    const blocked = await post(`/api/admin/consortium-spv/${spvId}/platform-fee`, ADMIN, {
      sponsorPartnerId: PARTNER_A, feeType: "carry", carryPct: 0.7,
    });
    expect(blocked.status).toBe(400);
    seedOverCapPlatformCarry(spvId, 0.7);
    await commitLp(spvId, "inv_w3b_adv3", 100_000);
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1_000_000, costBasisMinor: 0,
    });
    expect(r.status).not.toBe(201);
    expect(spvEngineStore.listDistributions(PARTNER_A, spvId).length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CALL GRAPH — the guard is on the write path, not on the preview
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 3B CALL GRAPH — the guard sits in the persisted path", () => {
  it("CALL-GRAPH-1 — the guard and the allocator are inside recordDistribution, BEFORE every write", () => {
    const start = storeSrc.indexOf("  recordDistribution(");
    expect(start).toBeGreaterThan(-1);
    const end = storeSrc.indexOf("\n  listDistributions(", start);
    expect(end).toBeGreaterThan(start);
    const body = storeSrc.slice(start, end);

    const iGuard = body.indexOf("COMBINED_CARRY_EXCEEDS_CAP");
    const iAlloc = body.indexOf("allocateDistributionMinor({");
    const iCollect = body.indexOf("_collectCarryObligation(");
    const iPersist = body.indexOf('persist(\n      "spv_distribution"');

    expect(iGuard).toBeGreaterThan(-1);
    expect(iAlloc).toBeGreaterThan(-1);
    expect(iCollect).toBeGreaterThan(-1);
    expect(iPersist).toBeGreaterThan(-1);
    // Ordering IS the proof: nothing is written before the guard runs.
    expect(iGuard).toBeLessThan(iAlloc);
    expect(iAlloc).toBeLessThan(iCollect);
    expect(iCollect).toBeLessThan(iPersist);
  });

  it("CALL-GRAPH-2 — production routes call recordDistribution (partner + admin)", () => {
    const calls = routesSrc.match(/spvEngineStore\.recordDistribution\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(routesSrc).toContain('app.post("/api/partner/me/spv/:spvId/distributions"');
    expect(routesSrc).toContain('app.post("/api/admin/consortium-spv/:spvId/distributions"');
  });

  it("CALL-GRAPH-3 — the fix is NOT parked in previewDistributionSplit (the previous null fix)", () => {
    const pStart = storeSrc.indexOf("  previewDistributionSplit(");
    expect(pStart).toBeGreaterThan(-1);
    const pEnd = storeSrc.indexOf("\n  },", pStart);
    const preview = storeSrc.slice(pStart, pEnd);
    expect(preview).not.toContain("allocateDistributionMinor");

    /* WAVE 37 — THIS ASSERTION FOUND A REAL (SMALL) CODE DEFECT, and the
     * PROBE was also wrong.
     *
     * The probe searched a fixed 1200-character window BEFORE
     * `previewDistributionSplit(` for the words "does NOT persist or move".
     * A magic byte window is not a way to find a method's own doc comment:
     * WAVE 14 / P-7 inserted `storedHurdleFraction` — with a ~1.6KB doc block
     * — between the SPV-CORE-2 comment and the method it described, so the
     * window stopped reaching it.
     *
     * But the same insertion also ORPHANED the comment in the source: the
     * SPV-CORE-2 block, whose entire purpose is that "the preview still says
     * what it is, so nobody mistakes it for a sink", ended up sitting
     * immediately above `storedHurdleFraction` instead — where it reads as a
     * claim about THAT method. WAVE 37 moved the block back down to sit
     * directly on `previewDistributionSplit`. That is a CODE fix, not a test
     * edit; nothing executable changed.
     *
     * STRENGTHENED: the check no longer measures bytes. It takes the JSDoc
     * block IMMEDIATELY PRECEDING the method — nothing but whitespace between
     * the `*\/` and the signature — and requires the disclaimer to be in THAT
     * block. Detaching the comment again, for any reason, fails this. */
    const before = storeSrc.slice(0, pStart);
    const docEnd = before.lastIndexOf("*/");
    expect(docEnd).toBeGreaterThan(-1);
    // Nothing but whitespace may sit between the doc block and the signature.
    expect(before.slice(docEnd + 2).trim()).toBe("");
    const docStart = before.lastIndexOf("/**", docEnd);
    expect(docStart).toBeGreaterThan(-1);
    const ownDoc = before.slice(docStart, docEnd + 2);
    expect(ownDoc).toContain("does NOT persist or move");
    expect(ownDoc).toContain("SPV-CORE-2");
    // ...and it names the one real money path, so the contrast is explicit.
    expect(ownDoc).toContain("recordDistribution");
  });

  it("CALL-GRAPH-4 — the old independent Math.round allocation is GONE from the write path", () => {
    const start = storeSrc.indexOf("  recordDistribution(");
    const end = storeSrc.indexOf("\n  listDistributions(", start);
    const body = storeSrc.slice(start, end);
    // Only the archival comment block may mention the old expression; no live
    // statement may. Strip block comments, then assert.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("Math.round(gross * r.ownershipPct)");
    expect(code).not.toContain("Math.round(totalCarryMinor * r.ownershipPct)");
    expect(code).not.toContain("Math.round(carryBaseMinor * gpCarryPct)");
    expect(code).not.toContain("Math.round(carryBaseMinor * platCarryPct)");
  });
});
