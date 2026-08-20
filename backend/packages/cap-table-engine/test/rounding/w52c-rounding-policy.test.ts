/**
 * WAVE 52c — B4 (percent-as-written) and B5 (the rounding policy).
 *
 * B4. Owner ruling R16 / OR-1 is binding: PERCENT-AS-WRITTEN, `1 = 1%`,
 *     `100 = 100%`, no conversion at any layer. Before this wave
 *     `computeEsopTopUp({ targetPoolPercent: "25" })` THREW
 *     "Pool target must be < 100%" because it computed `1 − 25 = −24`, and
 *     `"0.25"` produced a FRACTION out (`0.25000003…`). Both halves of that are
 *     asserted here, in the direction that is now correct.
 *
 * B5. `RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` — ALREADY SENT to an external
 *     reviewer — quotes the Orrick rule (ROUNDDOWN shares, ROUNDUP subscription
 *     "so that shares are fully paid up") and the worked figure `$499,998.97`.
 *     Before this wave no executable rule implemented the ROUNDUP half. The
 *     reviewer can test the sentence, so the sentence is tested here.
 *
 * Every figure below is recomputed by hand in the comment above it. Nothing is
 * read back out of the implementation and asserted against itself.
 */
import { describe, it, expect } from "vitest";
import { computeEsopTopUp } from "../../src/instruments/esopTopUp.js";
import {
  computeSubscriptionAmount,
  ROUNDING_DIRECTIONS,
  roundingDeviations,
} from "../../src/primitives/roundingPolicy.js";

const TOPUP_BASE = {
  mode: "pre_money" as const,
  existingShares: 10_500_000n,
  existingPool: 2_000_000n,
  newInvestorShares: 0n,
  formulaId: "esop.topup",
  formulaVersion: "1.0.0",
  region: "US" as const,
  formulaDef: { formula: "w52c" },
};

describe("WAVE 52c B4 — computeEsopTopUp is PERCENT-AS-WRITTEN (R16 / OR-1)", () => {
  it("B4-1 — targetPoolPercent \"25\" is accepted and means 25%, where it used to THROW", () => {
    /* Canonical Wave 52 case. E + N = 10,500,000, existing pool 2,000,000.

       WAVE 58 · R27 — THE EXPECTED NUMBER CHANGED, AND THIS IS WHY.
       Wave 52c pinned 833,334, which was the output of the DEFECTIVE
       denominator: it solved the target against E + N only, omitting the
       2,000,000 already reserved. R27 orders that defect fixed, so:
         T = (25·(10,500,000 + 2,000,000 + 0) − 100·2,000,000) / (100 − 25)
           = (312,500,000 − 200,000,000) / 75
           = 112,500,000 / 75 = 1,500,000  EXACTLY (no rounding at all)
       newPoolTotal   = 2,000,000 + 1,500,000 = 3,500,000
       newTotalShares = 10,500,000 + 2,000,000 + 0 + 1,500,000 = 14,000,000
       and 3,500,000 / 14,000,000 = 25% EXACTLY.
       Gross-up identity check (§4.2): 10,500,000/(1 − 0.25) = 14,000,000 =
       10,500,000 + 3,500,000. It holds with NO residual.
       The OLD pin, 833,334, gave 2,833,334/11,333,334 = 25.000004% of a total
       that was 2,000,000 shares short of the real one. This case still isolates
       the UNIT; it now also carries the correct DENOMINATOR. */
    const r = computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "25" });
    expect(r.poolSharesToAdd.toString()).toBe("1500000");
    expect(r.newPoolTotal.toString()).toBe("3500000");
    expect(r.newTotalShares.toString()).toBe("14000000");
  });

  it("B4-2 — the OUTPUT is percent-as-written too, not a fraction", () => {
    /* WAVE 58 · R27 — newPoolTotal 3,500,000 over newTotalShares
       10,500,000 + 2,000,000 + 0 + 1,500,000 = 14,000,000 → exactly 25 percent.
       Before Wave 52c the same call returned a FRACTION (0.25…); before Wave 58
       it returned 25.0000007058… against a denominator short by 2,000,000. The
       strict `> 25` became `>= 25` because the corrected arithmetic lands on the
       target EXACTLY here — there is no ceil residual to push it above. */
    const r = computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "25" });
    const pct = parseFloat(r.resultingPoolPercent);
    expect(pct).toBeGreaterThanOrEqual(25);
    expect(pct).toBeLessThan(25.001);
    /* The decisive assertion: the number is NOT in [0,1]. A fraction would be. */
    expect(pct).toBeGreaterThan(1);
    expect(r.trace.outputs.resultingPoolPercentUnit).toBe("percent_as_written_r16");
    expect(r.trace.inputs.targetPoolPercentUnit).toBe("percent_as_written_r16");
    /* Echoed back in the unit it arrived in — 25, never 0.25. */
    expect(r.trace.inputs.targetPoolPercent).toBe("25");
  });

  it("B4-3 — \"0.25\" now means a QUARTER OF ONE PERCENT, and is not rescaled to 25%", () => {
    /* T = (0.25·(10,500,000+2,000,000) − 100·2,000,000) / (100 − 0.25)
         = (3,125,000 − 200,000,000) / 99.75  → negative → clamped to 0,
       because the existing 2,000,000 pool already far exceeds 0.25%.
       This is the R16 behaviour: the magnitude of a number is not evidence of
       its unit, so 0.25 is honoured as 0.25%. */
    const r = computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "0.25" });
    expect(r.poolSharesToAdd.toString()).toBe("0");
  });

  it("B4-4 — a 100% target is refused BY NAME, and 99.9% is not", () => {
    expect(() => computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "100" })).toThrow(
      "Pool target must be < 100%",
    );
    expect(() => computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "150" })).toThrow(
      "Pool target must be < 100%",
    );
    /* 99.9 is a legitimate percent and must NOT throw. Under the old fraction
       interface `99.9` gave 1 − 99.9 = −98.9 and threw. */
    const r = computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "99.9" });
    expect(r.poolSharesToAdd > 0n).toBe(true);
  });

  it("B4-5 — post_money mode refuses a 100% target too (it used to compute a negative denominator silently)", () => {
    expect(() =>
      computeEsopTopUp({ ...TOPUP_BASE, mode: "post_money", targetPoolPercent: "100" }),
    ).toThrow("Pool target must be < 100%");
  });

  it("B4-6 — the KNOWN out-of-scope denominator defect is NAMED in the trace, not smoothed over", () => {
    /* WAVE 58 · R27 — the defect this assertion guarded is now FIXED, so the
       assertion is INVERTED rather than deleted: the trace must NO LONGER carry
       the "omits existingPool" disclosure, and must instead name a denominator
       that is true of the number beside it. Deleting the assertion would have
       lost the record that the disclosure ever existed. */
    const r = computeEsopTopUp({ ...TOPUP_BASE, targetPoolPercent: "25" });
    const denom = String(r.trace.outputs.resultingPoolPercentDenominator);
    expect(denom).not.toContain("omits existingPool");
    expect(denom).toContain("existingShares + existingPool + newInvestorShares + poolSharesToAdd");
    /* And the base the TARGET was solved against is stated as a number. */
    expect(String(r.trace.outputs.poolTargetBase)).toBe("12500000");
    expect(String(r.trace.outputs.poolTargetBaseDefinition)).toBe(
      "existingShares + existingPool + newInvestorShares",
    );
  });
});

describe("WAVE 52c B5 — the Orrick rounding rule is executable", () => {
  it("B5-1 — reproduces the $499,998.97 figure ALREADY SENT to the external reviewer", () => {
    /* From the sent document, §6.5 / §13.3 and §10 item 7:
         $500,000.00 at $1.1144 per share
         500,000 / 1.1144        = 448,671.9310… → ROUNDDOWN = 448,671 shares
         448,671 × 1.1144        = $499,998.9624
         ROUNDUP to the cent     = $499,998.97   = 49,999,897 minor units
         residual                = 50,000,000 − 49,999,897 = 103 = $1.03 */
    const r = computeSubscriptionAmount({
      committedMinor: 50_000_000n,
      pricePerShare: "1.1144",
      minorUnitExponent: 2,
    });
    expect(r.shares.toString()).toBe("448671");
    expect(r.subscriptionMinor.toString()).toBe("49999897");
    expect(r.residualMinor.toString()).toBe("103");
    /* I-5: applied + residual == committed, exactly, in integers. */
    expect(r.subscriptionMinor + r.residualMinor).toBe(50_000_000n);
  });

  it("B5-2 — the subscription is rounded UP, never half-up (this is the figure one review got wrong)", () => {
    /* A review flagged $499,998.97 as wrong and computed $499,998.96 by rounding
       HALF-UP on 499,998.9624. The Orrick rule rounds UP, so .9624 → .97. If this
       function ever half-rounds, this assertion fails. */
    const r = computeSubscriptionAmount({
      committedMinor: 50_000_000n,
      pricePerShare: "1.1144",
      minorUnitExponent: 2,
    });
    expect(r.subscriptionMinor.toString()).not.toBe("49999896");
    expect(r.exactProductMinor.startsWith("49999896.24")).toBe(true);
  });

  it("B5-3 — an exact division leaves a ZERO residual and nothing is invented", () => {
    /* $1,000.00 at $2.00 → 500 shares, subscription $1,000.00, residual 0. */
    const r = computeSubscriptionAmount({
      committedMinor: 100_000n,
      pricePerShare: "2.00",
      minorUnitExponent: 2,
    });
    expect(r.shares.toString()).toBe("500");
    expect(r.residualMinor.toString()).toBe("0");
  });

  it("B5-4 — the currency exponent is REQUIRED and honoured; JPY is not silently /100'd", () => {
    /* ¥1,000,000 (exponent 0, so committedMinor === 1,000,000 yen) at ¥3 per
       share → 333,333 shares; 333,333 × 3 = ¥999,999; residual ¥1. */
    const jpy = computeSubscriptionAmount({
      committedMinor: 1_000_000n,
      pricePerShare: "3",
      minorUnitExponent: 0,
    });
    expect(jpy.shares.toString()).toBe("333333");
    expect(jpy.subscriptionMinor.toString()).toBe("999999");
    expect(jpy.residualMinor.toString()).toBe("1");
    /* The same integer read as USD cents is a hundredth of the money and buys a
       hundredth of the shares — which is exactly why a hardcoded exponent is a
       defect and why this argument has no default. */
    const usd = computeSubscriptionAmount({
      committedMinor: 1_000_000n,
      pricePerShare: "3",
      minorUnitExponent: 2,
    });
    expect(usd.shares.toString()).toBe("3333");
    expect(() =>
      computeSubscriptionAmount({
        committedMinor: 1_000n,
        pricePerShare: "3",
        minorUnitExponent: -1,
      }),
    ).toThrow("ROUNDING_POLICY_BAD_EXPONENT");
  });

  it("B5-5 — a zero or negative price is refused by name, never divided by", () => {
    expect(() =>
      computeSubscriptionAmount({ committedMinor: 100n, pricePerShare: "0", minorUnitExponent: 2 }),
    ).toThrow("ROUNDING_POLICY_BAD_PRICE:0");
    expect(() =>
      computeSubscriptionAmount({ committedMinor: 100n, pricePerShare: "-1", minorUnitExponent: 2 }),
    ).toThrow("ROUNDING_POLICY_BAD_PRICE:-1");
  });

  it("B5-6 — every rounding direction in the pipeline is declared, with a disclosure sentence", () => {
    expect(ROUNDING_DIRECTIONS.investor_shares.direction).toBe("floor");
    expect(ROUNDING_DIRECTIONS.safe_conversion_shares.direction).toBe("floor");
    expect(ROUNDING_DIRECTIONS.subscription_amount.direction).toBe("ceil");
    expect(ROUNDING_DIRECTIONS.pool_topup_shares.direction).toBe("ceil");
    expect(ROUNDING_DIRECTIONS.safe_company_capitalization.direction).toBe("nearest");
    for (const key of Object.keys(ROUNDING_DIRECTIONS)) {
      const d = ROUNDING_DIRECTIONS[key];
      expect(d.disclosure.length).toBeGreaterThan(40);
      expect(d.authority.length).toBeGreaterThan(10);
    }
  });

  it("B5-7 — the two intentional DEVIATIONS are labelled as deviations, not described as policy", () => {
    const devs = roundingDeviations().map((d) => d.site).sort();
    expect(devs).toEqual(["pool_topup_shares", "safe_company_capitalization"]);
    for (const d of roundingDeviations()) {
      expect(d.authorityBacked).toBe(false);
      expect(d.authority.startsWith("DEVIATION")).toBe(true);
      expect(d.disclosure).toContain("deviation");
    }
    /* And the authority-backed ones are not quietly labelled deviations. */
    expect(ROUNDING_DIRECTIONS.investor_shares.authorityBacked).toBe(true);
    expect(ROUNDING_DIRECTIONS.subscription_amount.authority).toContain("Orrick");
  });

  it("B5-8 — an investor is never invoiced MORE than they committed", () => {
    /* Adversarial: a price that divides the commitment exactly. The ROUNDUP must
       not push the subscription one minor unit past the commitment. */
    for (const [minor, price] of [
      [1n, "0.01"],
      [3n, "0.01"],
      [100n, "1"],
      [999n, "0.03"],
    ] as Array<[bigint, string]>) {
      const r = computeSubscriptionAmount({
        committedMinor: minor,
        pricePerShare: price,
        minorUnitExponent: 2,
      });
      expect(r.subscriptionMinor <= minor).toBe(true);
      expect(r.residualMinor >= 0n).toBe(true);
      expect(r.subscriptionMinor + r.residualMinor).toBe(minor);
    }
  });
});
