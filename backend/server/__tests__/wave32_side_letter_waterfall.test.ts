/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 2 — SIDE-LETTER WATERFALL FALSIFICATION.
 *
 * "23 instances of a check that passed while checking nothing" is the rule this
 * file is written against, so every assertion here asserts BOTH POLES: the
 * arrangement that must be accepted AND the arrangement that must be refused,
 * and every fixture establishes its own preconditions. Nothing reads
 * `process.env`.
 *
 * Part A — the pure re-rating function (`server/lib/spvSideLetterWaterfall.ts`).
 * Part B — THE SINK: the persisted `spv_distribution` row written by
 *          `spvEngineStore.recordDistribution` through the real HTTP route.
 *          A pure function that computes the right number and never reaches the
 *          database has shipped nothing, so Part B proves the re-rating BY
 *          EXECUTION at the place the money actually lands.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { applySideLetterCarry, type WaterfallLpLine } from "../lib/spvSideLetterWaterfall";
import {
  createSideLetter,
  revokeSideLetter,
  activeCarryOverrides,
  lpOwnSideLetter,
  listSideLetters,
  ensureSideLetterSchemaForTests,
  SideLetterValidationError,
} from "../spvSideLetterStore";

const SCALE = 1_000_000_000;
const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const SETTLE = { settlementOutcome: "succeeded", settlementReason: "wave32 side-letter fixture" };
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

async function commitLp(spvId: string, investorId: string, commitmentMinor: number) {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, {
    kycStatus: "verified", accreditationStatus: "self_certified",
  });
  const adv = await patch(
    `/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`,
    MANAGING,
    { to: "committed", subscriptionDocRef: `sig_${investorId}` },
  );
  expect(adv.status).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

async function mgmtCarry(spvId: string, pct: number) {
  const r = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
    layer: "management", feeType: "carry", carryPct: pct,
  });
  expect(r.status).toBe(201);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureSideLetterSchemaForTests();
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 0 — THE PRECONDITION. A fixture that cannot write a side letter would
 * make every later "the side letter changed the outcome" assertion pass for
 * the wrong reason, so prove the table exists and round-trips FIRST.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("W32-C2 / 0 — schema precondition", () => {
  it("0.1 `spv_side_letter` exists and a written letter reads back with its rate intact", () => {
    const t = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spv_side_letter'`)
      .get() as { name?: string } | undefined;
    expect(t?.name).toBe("spv_side_letter");

    const created = createSideLetter({
      spvId: "spv_probe_0", tenantId: "tenant_probe", investorId: "inv_probe",
      carryFractionScaled: SCALE / 10, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    expect(created.carryFractionScaled).toBe(100_000_000);
    expect(lpOwnSideLetter("spv_probe_0", "inv_probe")?.id).toBe(created.id);
  });

  it("0.2 NULL carry is preserved as NULL — 'inherit' is not collapsed into 0% carry", () => {
    const created = createSideLetter({
      spvId: "spv_probe_1", tenantId: "tenant_probe", investorId: "inv_inherit",
      carryFractionScaled: null, minCheckMinor: 5_000_000, currency: "USD",
      effectiveDate: "2026-01-01", actor: "u_test",
    });
    expect(created.carryFractionScaled).toBeNull();
    // THE OTHER POLE: an explicit zero is a REAL no-carry term and must survive
    // as 0, distinguishable from the null above.
    const zero = createSideLetter({
      spvId: "spv_probe_1", tenantId: "tenant_probe", investorId: "inv_zero",
      carryFractionScaled: 0, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    expect(zero.carryFractionScaled).toBe(0);
    expect(zero.carryFractionScaled).not.toBeNull();

    // And the waterfall reader must see the explicit zero but NOT the null.
    const overrides = activeCarryOverrides("spv_probe_1");
    expect(overrides.map((o) => o.investorId)).toEqual(["inv_zero"]);
  });

  it("0.3 one active letter per (spv, investor): superseding stamps the old row, never deletes it", () => {
    createSideLetter({
      spvId: "spv_probe_2", tenantId: "t", investorId: "inv_a",
      carryFractionScaled: SCALE / 5, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    const second = createSideLetter({
      spvId: "spv_probe_2", tenantId: "t", investorId: "inv_a",
      carryFractionScaled: SCALE / 10, currency: "USD", effectiveDate: "2026-06-01", actor: "u_test",
    });
    const all = listSideLetters("spv_probe_2");
    expect(all.length).toBe(2);                                   // history survives
    expect(all.filter((l) => l.status === "active").length).toBe(1);
    expect(lpOwnSideLetter("spv_probe_2", "inv_a")?.id).toBe(second.id);
    expect(all.find((l) => l.status === "superseded")?.supersededAt).toBeTruthy();
  });

  it("0.4 an out-of-domain rate is REFUSED, not clamped and not divided by 100", () => {
    // 20 typed as a percent into a fraction-scaled field is 0.00000002% — but
    // guessing is worse than refusing, so the store refuses only what is
    // genuinely outside [0, 1e9] and never rewrites what is inside it.
    expect(() =>
      createSideLetter({
        spvId: "spv_probe_3", tenantId: "t", investorId: "inv_bad",
        carryFractionScaled: SCALE + 1, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
      }),
    ).toThrow(SideLetterValidationError);
    expect(() =>
      createSideLetter({
        spvId: "spv_probe_3", tenantId: "t", investorId: "inv_bad2",
        carryFractionScaled: -1, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
      }),
    ).toThrow(SideLetterValidationError);
    // POLE: a legal rate at the exact boundary is ACCEPTED, so 0.4 is not
    // passing merely because the store rejects everything.
    const ok = createSideLetter({
      spvId: "spv_probe_3", tenantId: "t", investorId: "inv_ok",
      carryFractionScaled: SCALE, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    expect(ok.carryFractionScaled).toBe(SCALE);
  });

  it("0.5 revoking returns the LP to the fund default — the override disappears from the waterfall read", () => {
    const l = createSideLetter({
      spvId: "spv_probe_4", tenantId: "t", investorId: "inv_r",
      carryFractionScaled: SCALE / 20, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    expect(activeCarryOverrides("spv_probe_4").length).toBe(1);   // pole 1: in force
    revokeSideLetter("spv_probe_4", l.id, "u_test");
    expect(activeCarryOverrides("spv_probe_4").length).toBe(0);   // pole 2: gone
    expect(listSideLetters("spv_probe_4").length).toBe(1);        // but not deleted
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART A — THE PURE RE-RATING.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Fund: 20% carry, split 15% GP / 5% platform. */
function baseCase(): Parameters<typeof applySideLetterCarry>[0] {
  // Carry base 1,000,000 minor. Two equal LPs. Fund carry 20% = 200,000, of
  // which GP 150,000 and platform 50,000. Gross 5,000,000 split 2,500,000 each.
  const perLp: WaterfallLpLine[] = [
    { investorId: "lp_a", grossMinor: 2_500_000, carryMinor: 100_000, netMinor: 2_400_000 },
    { investorId: "lp_b", grossMinor: 2_500_000, carryMinor: 100_000, netMinor: 2_400_000 },
  ];
  return {
    perLp,
    lpWeightsMinor: [1_000_000, 1_000_000],
    grossMinor: 5_000_000,
    carryBaseMinor: 1_000_000,
    gpCarryMinor: 150_000,
    platformCarryMinor: 50_000,
    fundCombinedCarryScaled: SCALE / 5,      // 20%
    combinedCarryCapScaled: SCALE / 2,       // 50% cap
    overrides: [],
  };
}

describe("W32-C2 / A — pure re-rating", () => {
  it("A1 NO side letters → the base allocation is returned BY IDENTITY, not recomputed", () => {
    const input = baseCase();
    const out = applySideLetterCarry(input);
    expect(out.adjusted).toBe(false);
    // Identity, not deep equality: a vehicle with no side letters cannot drift
    // by so much as a rounding decision, because nothing recomputed anything.
    expect(out.perLp).toBe(input.perLp);
    expect(out.gpCarryMinor).toBe(150_000);
    expect(out.platformCarryMinor).toBe(50_000);
    expect(out.totalCarryMinor).toBe(200_000);
    expect(out.distributableMinor).toBe(4_800_000);
    expect(out.adjustments).toEqual([]);
  });

  it("A2 an override for an investor who is NOT in this register changes nothing", () => {
    const input = baseCase();
    input.overrides = [{ investorId: "lp_stranger", carryFractionScaled: 0, sideLetterId: "sl_x" }];
    const out = applySideLetterCarry(input);
    expect(out.adjusted).toBe(false);
    expect(out.perLp).toBe(input.perLp);
  });

  it("A3 a 10% side letter halves THAT LP's carry and leaves the other LP untouched", () => {
    const input = baseCase();
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE / 10, sideLetterId: "sl_a" }];
    const out = applySideLetterCarry(input);
    expect(out.adjusted).toBe(true);

    // Carry base 1,000,000 splits 500,000 / 500,000.
    // LP A at 10% -> 50,000. LP B at the fund's 20% -> 100,000.
    expect(out.perLp[0].carryMinor).toBe(50_000);
    expect(out.perLp[1].carryMinor).toBe(100_000);   // POLE: unchanged
    expect(out.perLp[0].netMinor).toBe(2_450_000);   // 50,000 MORE than before
    expect(out.perLp[1].netMinor).toBe(2_400_000);   // POLE: identical to base
    expect(out.totalCarryMinor).toBe(150_000);
    expect(out.distributableMinor).toBe(4_850_000);
    // The reduction comes out of both carry legs in the fund's own proportion.
    expect(out.gpCarryMinor + out.platformCarryMinor).toBe(150_000);
    expect(out.gpCarryMinor).toBe(112_500);
    expect(out.platformCarryMinor).toBe(37_500);
    expect(out.adjustments).toEqual([{
      investorId: "lp_a", sideLetterId: "sl_a",
      fundCarryScaled: 200_000_000, lpCarryScaled: 100_000_000,
      carryBeforeMinor: 100_000, carryAfterMinor: 50_000,
      netBeforeMinor: 2_400_000, netAfterMinor: 2_450_000,
    }]);
  });

  it("A4 a ZERO-carry side letter pays that LP their full gross — and does not zero anyone else", () => {
    const input = baseCase();
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: 0, sideLetterId: "sl_free" }];
    const out = applySideLetterCarry(input);
    expect(out.perLp[0].carryMinor).toBe(0);
    expect(out.perLp[0].netMinor).toBe(2_500_000);
    expect(out.perLp[1].carryMinor).toBe(100_000);   // POLE
    expect(out.totalCarryMinor).toBe(100_000);
  });

  it("A5 a HIGHER side-letter rate raises that LP's carry — the mechanism is not one-directional", () => {
    const input = baseCase();
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE / 4, sideLetterId: "sl_hi" }];
    const out = applySideLetterCarry(input);
    expect(out.perLp[0].carryMinor).toBe(125_000);   // 25% of 500,000
    expect(out.totalCarryMinor).toBe(225_000);
    expect(out.distributableMinor).toBe(4_775_000);
  });

  it("A6 CONSERVATION: parts sum to the whole exactly, on awkward numbers", () => {
    // Three LPs on coprime weights and a carry base that does not divide.
    const input: Parameters<typeof applySideLetterCarry>[0] = {
      perLp: [
        { investorId: "lp_a", grossMinor: 333_334, carryMinor: 33_334, netMinor: 300_000 },
        { investorId: "lp_b", grossMinor: 333_333, carryMinor: 33_333, netMinor: 300_000 },
        { investorId: "lp_c", grossMinor: 333_333, carryMinor: 33_333, netMinor: 300_000 },
      ],
      lpWeightsMinor: [1, 1, 1],
      grossMinor: 1_000_000,
      carryBaseMinor: 500_000,
      gpCarryMinor: 75_000,
      platformCarryMinor: 25_000,
      fundCombinedCarryScaled: SCALE / 5,
      combinedCarryCapScaled: SCALE / 2,
      overrides: [{ investorId: "lp_b", carryFractionScaled: 133_333_333, sideLetterId: "sl_odd" }],
    };
    const out = applySideLetterCarry(input);
    const sumCarry = out.perLp.reduce((a, l) => a + l.carryMinor, 0);
    const sumNet = out.perLp.reduce((a, l) => a + l.netMinor, 0);
    const sumGross = out.perLp.reduce((a, l) => a + l.grossMinor, 0);
    expect(sumCarry).toBe(out.totalCarryMinor);
    expect(out.gpCarryMinor + out.platformCarryMinor).toBe(out.totalCarryMinor);
    expect(sumGross).toBe(1_000_000);
    expect(sumNet).toBe(1_000_000 - out.totalCarryMinor);
    expect(sumNet + sumCarry).toBe(1_000_000);   // not one cent created or lost
  });

  it("A7 JPY fixture — a zero-decimal currency, and the SAME inputs in a 2-decimal currency", () => {
    /* Every money test needs a JPY fixture. The arithmetic here is in MINOR
       UNITS and therefore currency-agnostic by construction — which is exactly
       the claim that needs testing rather than assuming, because a hidden
       `/100` or a hardcoded exponent 2 would break JPY and only JPY. ¥1,000,000
       of carry base is minor 1000000 (JPY has no subunit). */
    const jpy: Parameters<typeof applySideLetterCarry>[0] = {
      perLp: [
        { investorId: "lp_a", grossMinor: 2_500_000, carryMinor: 100_000, netMinor: 2_400_000 },
        { investorId: "lp_b", grossMinor: 2_500_000, carryMinor: 100_000, netMinor: 2_400_000 },
      ],
      lpWeightsMinor: [1_000_000, 1_000_000],
      grossMinor: 5_000_000, carryBaseMinor: 1_000_000,
      gpCarryMinor: 150_000, platformCarryMinor: 50_000,
      fundCombinedCarryScaled: SCALE / 5, combinedCarryCapScaled: SCALE / 2,
      overrides: [{ investorId: "lp_a", carryFractionScaled: SCALE / 10, sideLetterId: "sl_jpy" }],
    };
    const out = applySideLetterCarry(jpy);
    // ¥50,000 of carry for LP A — a whole number of yen, no phantom subunit.
    expect(out.perLp[0].carryMinor).toBe(50_000);
    expect(out.totalCarryMinor).toBe(150_000);
    // The USD run of the identical minor-unit inputs must agree exactly; if it
    // did not, some code path is scaling by the currency exponent behind our
    // backs and one of the two currencies is being computed wrongly.
    const usd = applySideLetterCarry({ ...baseCase(), overrides: jpy.overrides });
    expect(out.perLp.map((l) => l.carryMinor)).toEqual(usd.perLp.map((l) => l.carryMinor));
    expect(out.totalCarryMinor).toBe(usd.totalCarryMinor);
  });

  it("A8 an override ABOVE the durable cap is REFUSED, not clamped", () => {
    const input = baseCase();
    input.combinedCarryCapScaled = SCALE / 4;   // 25% cap
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE / 2, sideLetterId: "sl_greedy" }];
    expect(() => applySideLetterCarry(input)).toThrow("SIDE_LETTER_CARRY_EXCEEDS_CAP");
    // POLE: exactly AT the cap is allowed, so A8 is not passing because the
    // function rejects everything above the fund rate.
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE / 4, sideLetterId: "sl_at_cap" }];
    const ok = applySideLetterCarry(input);
    expect(ok.perLp[0].carryMinor).toBe(125_000);
  });

  it("A9 a rate outside [0,1] is refused; duplicate active overrides for one LP are refused", () => {
    const a = baseCase();
    a.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE * 2, sideLetterId: "sl_x" }];
    expect(() => applySideLetterCarry(a)).toThrow(/SIDE_LETTER_CARRY_(OUT_OF_DOMAIN|EXCEEDS_CAP)/);
    const b = baseCase();
    b.overrides = [
      { investorId: "lp_a", carryFractionScaled: 0, sideLetterId: "sl_1" },
      { investorId: "lp_a", carryFractionScaled: SCALE / 10, sideLetterId: "sl_2" },
    ];
    expect(() => applySideLetterCarry(b)).toThrow("SIDE_LETTER_DUPLICATE_ACTIVE");
  });

  it("A10 a side letter cannot drive an LP's net negative", () => {
    const input = baseCase();
    // Carry base larger than gross is already refused upstream by the
    // allocator; here the pathological shape is a tiny gross with a huge base.
    input.perLp = [
      { investorId: "lp_a", grossMinor: 10, carryMinor: 2, netMinor: 8 },
      { investorId: "lp_b", grossMinor: 10, carryMinor: 2, netMinor: 8 },
    ];
    input.grossMinor = 20;
    input.carryBaseMinor = 1_000_000;
    expect(() => applySideLetterCarry({
      ...input,
      overrides: [{ investorId: "lp_a", carryFractionScaled: SCALE / 10, sideLetterId: "sl_neg" }],
    })).toThrow(/SIDE_LETTER_(NEGATIVE_LP_NET|CARRY_EXCEEDS_GROSS|CARRY_EXCEEDS_BASE)/);

    /* AND THE ISOLATED CASE. The refusal above could be produced by any of
       three guards, so it does not prove the per-LP one exists. Here a small
       LP sits beside a large one: the TOTAL carry stays comfortably below the
       gross (so the aggregate guards stay silent) while LP A's own carry
       exceeds LP A's own gross. Only the per-LP net check can catch this, and
       it must, or one LP would be handed a negative payment. */
    const skewed: Parameters<typeof applySideLetterCarry>[0] = {
      perLp: [
        { investorId: "lp_small", grossMinor: 10, carryMinor: 2, netMinor: 8 },
        { investorId: "lp_big", grossMinor: 1_990, carryMinor: 198, netMinor: 1_792 },
      ],
      lpWeightsMinor: [1, 1],
      grossMinor: 2_000, carryBaseMinor: 1_000,
      gpCarryMinor: 150, platformCarryMinor: 50,
      fundCombinedCarryScaled: SCALE / 5, combinedCarryCapScaled: SCALE,
      overrides: [{ investorId: "lp_small", carryFractionScaled: SCALE, sideLetterId: "sl_skew" }],
    };
    expect(() => applySideLetterCarry(skewed)).toThrow("SIDE_LETTER_NEGATIVE_LP_NET");
    // POLE: the same shape with a survivable rate goes through, so the refusal
    // is about the negative net and not about this fixture being unusable.
    const ok = applySideLetterCarry({
      ...skewed,
      overrides: [{ investorId: "lp_small", carryFractionScaled: SCALE / 100, sideLetterId: "sl_ok" }],
    });
    expect(ok.perLp[0].netMinor).toBeGreaterThanOrEqual(0);
  });

  it("A11 a side letter on a fund with NO carry schedule is refused, not attributed to a made-up leg", () => {
    const input = baseCase();
    input.gpCarryMinor = 0;
    input.platformCarryMinor = 0;
    input.fundCombinedCarryScaled = 0;
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: SCALE / 10, sideLetterId: "sl_orphan" }];
    expect(() => applySideLetterCarry(input)).toThrow("SIDE_LETTER_CARRY_WITHOUT_FEE_SCHEDULE");
    // POLE: a ZERO-rate letter on a zero-carry fund is a legitimate no-op.
    input.overrides = [{ investorId: "lp_a", carryFractionScaled: 0, sideLetterId: "sl_zero" }];
    const out = applySideLetterCarry(input);
    expect(out.totalCarryMinor).toBe(0);
  });

  it("A13 the carry base is split by the PINNED ALLOCATOR — a float proportion would create a unit", () => {
    /* Three equal LPs on a carry base of 5. Largest remainder gives 2 + 2 + 1.
       `round(5 * 1/3)` gives 2 + 2 + 2 = 6 — a unit of money conjured out of a
       rounding rule. At 100% rates the difference is visible directly in the
       per-LP carry, so this fixture distinguishes the two implementations by
       OUTPUT and not merely by an internal assertion. */
    const input: Parameters<typeof applySideLetterCarry>[0] = {
      perLp: [
        { investorId: "lp_a", grossMinor: 100, carryMinor: 2, netMinor: 98 },
        { investorId: "lp_b", grossMinor: 100, carryMinor: 2, netMinor: 98 },
        { investorId: "lp_c", grossMinor: 100, carryMinor: 1, netMinor: 99 },
      ],
      lpWeightsMinor: [1, 1, 1],
      grossMinor: 300, carryBaseMinor: 5,
      gpCarryMinor: 4, platformCarryMinor: 1,
      fundCombinedCarryScaled: SCALE, combinedCarryCapScaled: SCALE,
      overrides: [{ investorId: "lp_c", carryFractionScaled: SCALE, sideLetterId: "sl_full" }],
    };
    const out = applySideLetterCarry(input);
    // Every LP is on 100%, so each takes exactly their allocated share of the
    // base: 2, 2, 1 — summing to 5, the base itself. Never 6.
    expect(out.perLp.map((l) => l.carryMinor)).toEqual([2, 2, 1]);
    expect(out.totalCarryMinor).toBe(5);
    expect(out.totalCarryMinor).toBeLessThanOrEqual(input.carryBaseMinor);
    expect(out.perLp.reduce((a, l) => a + l.netMinor, 0)).toBe(295);
  });

  it("A12 rounding is HALF-EVEN and applied to each LP's own rate, never a float", () => {
    // Carry base 3 across two equal LPs -> shares 2 and 1 (largest remainder).
    // LP A at 25% of 2 = 0.5 -> half-even -> 0. LP B at fund 20% of 1 = 0.2 -> 0.
    const input: Parameters<typeof applySideLetterCarry>[0] = {
      perLp: [
        { investorId: "lp_a", grossMinor: 5, carryMinor: 1, netMinor: 4 },
        { investorId: "lp_b", grossMinor: 5, carryMinor: 0, netMinor: 5 },
      ],
      lpWeightsMinor: [2, 1],
      grossMinor: 10, carryBaseMinor: 3,
      gpCarryMinor: 1, platformCarryMinor: 0,
      fundCombinedCarryScaled: SCALE / 5, combinedCarryCapScaled: SCALE / 2,
      overrides: [{ investorId: "lp_a", carryFractionScaled: SCALE / 4, sideLetterId: "sl_r" }],
    };
    const out = applySideLetterCarry(input);
    expect(out.perLp[0].carryMinor).toBe(0);   // 0.5 -> 0 (half to even), not 1
    expect(out.perLp[1].carryMinor).toBe(0);
    expect(out.totalCarryMinor).toBe(0);
    expect(out.perLp.reduce((a, l) => a + l.netMinor, 0)).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — THE SINK. `spv_distribution.allocations_json`, written through the
 * real route. This is rule 2: name the sink, prove it BY EXECUTION.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("W32-C2 / B — the persisted distribution", () => {
  async function twoLpSpv(name: string) {
    const id = await createSpv(name);
    await mgmtCarry(id, 0.2);
    await commitLp(id, "inv_sl_a", 1_000_000);
    await commitLp(id, "inv_sl_b", 1_000_000);
    return id;
  }

  it("B1 CONTROL — with no side letters the persisted allocations are the base waterfall", async () => {
    const id = await twoLpSpv("W32 SL Control SPV");
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(r.status).toBe(201);
    const d = r.body.distribution;
    // Carry base 1,000,000 at 20% = 200,000, split equally between two equal LPs.
    expect(d.gpCarryMinor + d.platformCarryMinor).toBe(200_000);
    expect(d.allocations.map((a: any) => a.carryMinor)).toEqual([100_000, 100_000]);
    expect(d.allocations.map((a: any) => a.netMinor)).toEqual([2_400_000, 2_400_000]);
    // And no side-letter tier is invented on a vehicle that has none.
    expect(d.waterfall.map((t: any) => t.tier)).not.toContain("side_letter_adjustment");
  });

  it("B2 PROBE — an active side letter changes what is PERSISTED, not just what is computed", async () => {
    const id = await twoLpSpv("W32 SL Probe SPV");
    createSideLetter({
      spvId: id, tenantId: "tenant_test", investorId: "inv_sl_a",
      carryFractionScaled: SCALE / 10, currency: "USD",
      effectiveDate: "2026-01-01", actor: "u_test",
    });
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(r.status).toBe(201);
    const d = r.body.distribution;
    const byInvestor = Object.fromEntries(d.allocations.map((a: any) => [a.investorId, a]));
    expect(byInvestor["inv_sl_a"].carryMinor).toBe(50_000);
    expect(byInvestor["inv_sl_b"].carryMinor).toBe(100_000);   // POLE: untouched
    expect(byInvestor["inv_sl_a"].netMinor).toBe(2_450_000);
    expect(d.gpCarryMinor + d.platformCarryMinor).toBe(150_000);

    // THE SINK ITSELF — read the row back out of SQLite, not the HTTP echo. A
    // response body proves what the route returned; only the table proves what
    // the vehicle will report tomorrow.
    const row = rawDb()
      .prepare(`SELECT allocations_json, waterfall_json, gp_carry_minor, platform_carry_minor
                FROM spv_distribution WHERE id = ?`)
      .get(d.id) as any;
    const persisted = JSON.parse(row.allocations_json);
    expect(persisted.find((a: any) => a.investorId === "inv_sl_a").carryMinor).toBe(50_000);
    expect(persisted.find((a: any) => a.investorId === "inv_sl_b").carryMinor).toBe(100_000);
    expect(row.gp_carry_minor + row.platform_carry_minor).toBe(150_000);

    // The adjustment is AUDITABLE: the waterfall records what changed and why.
    const tiers = JSON.parse(row.waterfall_json);
    const sl = tiers.find((t: any) => t.tier === "side_letter_adjustment");
    expect(sl).toBeTruthy();
    expect(sl.amountMinor).toBe(-50_000);
    expect(sl.adjustments[0]).toMatchObject({
      investorId: "inv_sl_a", lpCarryScaled: 100_000_000, fundCarryScaled: 200_000_000,
    });
    // Appended at the END — the five canonical tiers keep their positions.
    expect(tiers.slice(0, 5).map((t: any) => t.tier)).toEqual([
      "return_of_capital", "carry_base", "gp_carry", "platform_carry", "pro_rata_lp",
    ]);
  });

  it("B3 CONSERVATION at the sink — persisted parts sum to the persisted whole", async () => {
    const id = await createSpv("W32 SL Conservation SPV");
    await mgmtCarry(id, 0.2);
    await commitLp(id, "inv_c1", 333_333);
    await commitLp(id, "inv_c2", 333_333);
    await commitLp(id, "inv_c3", 333_334);
    createSideLetter({
      spvId: id, tenantId: "tenant_test", investorId: "inv_c2",
      carryFractionScaled: 133_333_333, currency: "USD",
      effectiveDate: "2026-01-01", actor: "u_test",
    });
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1_000_001, costBasisMinor: 500_000, ...SETTLE,
    });
    expect(r.status).toBe(201);
    const row = rawDb()
      .prepare(`SELECT allocations_json, gross_proceeds_minor, gp_carry_minor, platform_carry_minor
                FROM spv_distribution WHERE id = ?`)
      .get(r.body.distribution.id) as any;
    const allocs = JSON.parse(row.allocations_json);
    const sumGross = allocs.reduce((a: number, x: any) => a + x.grossMinor, 0);
    const sumCarry = allocs.reduce((a: number, x: any) => a + x.carryMinor, 0);
    const sumNet = allocs.reduce((a: number, x: any) => a + x.netMinor, 0);
    expect(sumGross).toBe(row.gross_proceeds_minor);
    expect(sumCarry).toBe(row.gp_carry_minor + row.platform_carry_minor);
    expect(sumNet + sumCarry).toBe(row.gross_proceeds_minor);
    for (const a of allocs) expect(a.netMinor).toBe(a.grossMinor - a.carryMinor);
  });

  it("B4 REVOKING the letter restores the fund economics on the NEXT distribution", async () => {
    const id = await twoLpSpv("W32 SL Revoke SPV");
    const letter = createSideLetter({
      spvId: id, tenantId: "tenant_test", investorId: "inv_sl_a",
      carryFractionScaled: 0, currency: "USD", effectiveDate: "2026-01-01", actor: "u_test",
    });
    const first = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit-1", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(first.status).toBe(201);
    const a1 = first.body.distribution.allocations.find((a: any) => a.investorId === "inv_sl_a");
    expect(a1.carryMinor).toBe(0);   // pole 1 — the letter was in force

    revokeSideLetter(id, letter.id, "u_test");
    const second = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit-2", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(second.status).toBe(201);
    const a2 = second.body.distribution.allocations.find((a: any) => a.investorId === "inv_sl_a");
    expect(a2.carryMinor).toBeGreaterThan(0);   // pole 2 — back on fund terms
    // The first distribution is UNCHANGED by the revocation. History is history.
    const persistedFirst = JSON.parse(
      (rawDb().prepare(`SELECT allocations_json FROM spv_distribution WHERE id = ?`)
        .get(first.body.distribution.id) as any).allocations_json,
    );
    expect(persistedFirst.find((a: any) => a.investorId === "inv_sl_a").carryMinor).toBe(0);
  });

  it("B5 a side letter above the vehicle's cap ABORTS the distribution with NOTHING written", async () => {
    const id = await twoLpSpv("W32 SL Cap SPV");
    /* The cap is DURABLE CONFIGURATION, not a constant, and the platform
       genesis row is 100% — so this test must install the vehicle's own
       stricter cap rather than assume one exists, or it would assert nothing.
       (WAVE 3D / ITEM 3: `spv_carry_cap_policy`, most specific scope wins.) */
    const nowIso = new Date().toISOString();
    rawDb().prepare(
      `INSERT OR REPLACE INTO spv_carry_cap_policy
         (id, scope_kind, scope_id, cap_scaled, scale, active, description, created_at, updated_at, updated_by)
       VALUES (?, 'spv', ?, ?, 1000000000, 1, 'wave32 side-letter cap fixture', ?, ?, 'u_test')`,
    ).run(`sccp_w32_${id}`, id, SCALE / 4, nowIso, nowIso);
    const installed = rawDb()
      .prepare(`SELECT cap_scaled FROM spv_carry_cap_policy WHERE scope_kind='spv' AND scope_id=? AND active=1`)
      .get(id) as any;
    expect(installed?.cap_scaled).toBe(SCALE / 4);   // precondition established

    createSideLetter({
      spvId: id, tenantId: "tenant_test", investorId: "inv_sl_a",
      carryFractionScaled: SCALE / 2, currency: "USD",   // 50% — above the 25% cap
      effectiveDate: "2026-01-01", actor: "u_test",
    });
    const before = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv_distribution WHERE spv_id = ?`).get(id) as any).n;
    const r = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const after = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv_distribution WHERE spv_id = ?`).get(id) as any).n;
    expect(after).toBe(before);   // fail-closed: no money moved, no row written

    /* THE OTHER POLE. Bring the letter back inside the cap and the SAME
       distribution succeeds — so B5 is failing on the cap breach and not
       because this vehicle simply cannot distribute. */
    createSideLetter({
      spvId: id, tenantId: "tenant_test", investorId: "inv_sl_a",
      carryFractionScaled: SCALE / 4, currency: "USD",
      effectiveDate: "2026-02-01", actor: "u_test",
    });
    const ok = await post(`/api/admin/consortium-spv/${id}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(ok.status).toBe(201);
    const finalCount = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv_distribution WHERE spv_id = ?`).get(id) as any).n;
    expect(finalCount).toBe(before + 1);
  });
});
