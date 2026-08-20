/**
 * WAVE 58 · owner ruling R27 — THE POOL PERCENTAGE, AS EXACT DECIMAL ARITHMETIC.
 *
 * R27: "The option pool is entered as a PERCENTAGE of fully diluted, per R16
 * percent-as-written (25 = 25%). The share count becomes the derived output,
 * shown to the founder, never the input."
 *
 * These are unit tests of `derivePoolTopUpFromPercent`, the single source of the
 * wizard's pool arithmetic. They are NOT the reachability proof — that is
 * `server/__tests__/w58_option_pool_percent_reachability.test.ts`, which goes
 * through HTTP routes, because this project has twice shipped correct arithmetic
 * that no screen reached.
 *
 * MUTATION TRANSCRIPTS: build_log/wave58/W58_NEW_TESTS.md.
 */
import { describe, it, expect } from "vitest";
import {
  derivePoolTopUpFromPercent,
  parsePoolPercentAsWritten,
  formatPct,
} from "../roundMath";

/** The canonical example R27 itself cites, including its $25,000,000 figure. */
const R27_CANONICAL = {
  /* WAVE 58b · DEFECT 1 — `poolPlacement` is now a REQUIRED input, because the
     old signature had no placement argument at all and therefore priced every
     post-money round as pre-money. These fixtures were always pre-money cases;
     they now SAY SO instead of relying on a default. No expected value in this
     file changes. */
  poolPlacement: "pre_money" as const,
  fdPreMoneyShares: "10000000",
  preMoneyValuation: "30000000",
  investmentAmount: "5000000",
  existingPoolShares: "1000000",
};

describe("W58 · R27 — percent-as-written validation refuses by name (R16 range [0,100))", () => {
  it("W58-P1 — a blank percentage is REFUSED, and is not read as 0%", () => {
    /* A blank field is not a zero. Reading it as 0% would silently create no
       pool while the founder believed they had asked for one. */
    const r = parsePoolPercentAsWritten("");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("pool_percent_missing");
      expect(r.reason).toContain("not 0%");
    }
  });

  it("W58-P2 — nonsense is REFUSED with a named message, never coerced", () => {
    /* THE LIVE DEFECT THIS CLOSES: the wizard's "Pool size (shares)" field
       accepted `0.25` — and anything else — with NO error, NO warning and NO
       coercion (W58 live finding 1). */
    for (const [raw, code] of [
      ["abc", "pool_percent_not_a_number"],
      ["twenty five", "pool_percent_not_a_number"],
      ["NaN", "pool_percent_not_finite"],
      ["-1", "pool_percent_negative"],
      ["-0.5", "pool_percent_negative"],
    ] as const) {
      const r = parsePoolPercentAsWritten(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        /* A named message, not a code shown to a founder. */
        expect(r.reason.length).toBeGreaterThan(30);
      }
    }
  });

  it("W58-P3 — 100 and above are REFUSED: the gross-up divides by (100 − target)", () => {
    for (const raw of ["100", "100.0001", "150", "1000"]) {
      const r = parsePoolPercentAsWritten(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("pool_percent_out_of_range");
    }
    /* 99.9999 is inside R16's range and must NOT be refused. */
    expect(parsePoolPercentAsWritten("99.9999").ok).toBe(true);
  });

  it("W58-P4 — 0.25 means A QUARTER OF ONE PERCENT and is NOT rescaled to 25", () => {
    /* R16, verbatim: magnitude is not evidence of unit. A "did you mean 25?"
       coercion here would be the factor-of-100 defect class this build has spent
       months removing. */
    const r = parsePoolPercentAsWritten("0.25");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.percent.toFixed()).toBe("0.25");
    const r2 = parsePoolPercentAsWritten("25");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.percent.toFixed()).toBe("25");
  });

  it("W58-P5 — 0 is a legitimate value and is accepted, distinct from blank", () => {
    expect(parsePoolPercentAsWritten("0").ok).toBe(true);
    expect(parsePoolPercentAsWritten("").ok).toBe(false);
  });
});

describe("W58 · R27 — the derived share count, and the numbers R27 itself quotes", () => {
  it("W58-P6 — the canonical case reproduces the $25,000,000 EFFECTIVE pre-money R27 cites", () => {
    /* R27: "on the canonical example the effective pre-money is $25,000,000, not
       the headline $30,000,000." Reproduced here rather than quoted.

       Target 21.428571…% of post-money. Exact arithmetic:
         S = 2,000,000
         D = 10,000,000 + 2,000,000 = 12,000,000
         p = $30,000,000 / 12,000,000 = $2.50
         N = $5,000,000 / $2.50 = 2,000,000
         T = 14,000,000
         pool = 1,000,000 + 2,000,000 = 3,000,000 = 21.4286% of T
         effective pre-money = $30,000,000 − 2,000,000 × $2.50 = $25,000,000 */
    const r = derivePoolTopUpFromPercent({
      ...R27_CANONICAL,
      poolPercentPostMoney: "21.428571",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.poolTopUpShares.toString()).toBe("2000000");
    expect(r.resultingPoolShares.toString()).toBe("3000000");
    expect(r.postMoneyFdShares.toString()).toBe("14000000");
    expect(r.pricePerShare).toBe("2.5");
    expect(r.newInvestorShares.toString()).toBe("2000000");
    /* THE FIGURE R27 NAMES. */
    expect(r.effectivePreMoney).toBe("25000000");
  });

  it("W58-P7 — the derived count round-trips: it PRODUCES the target percentage", () => {
    /* The share count is derived from the percentage, so the percentage the share
       count produces must be the percentage asked for. Rounded UP so the target
       is MET rather than missed (industry standard §4.3), which is why the
       resulting figure is at or fractionally above the target and never below. */
    /* Targets must be ABOVE the floor set by the pool already reserved. With
       1,000,000 already under the plan the resulting pool cannot fall below
       8.571% however small the target, so asking for 5% correctly yields a ZERO
       top-up and a resulting 8.571% — asserted separately in W58-P11 rather than
       swept into this loop. Testing a target below the floor here would assert
       that the platform can un-reserve shares, which it must not. */
    for (const target of ["10", "12.5", "15", "20", "25"]) {
      const r = derivePoolTopUpFromPercent({ ...R27_CANONICAL, poolPercentPostMoney: target });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const got = Number(r.resultingPoolPercent.value);
      expect(got).toBeGreaterThanOrEqual(Number(target) - 0.0005);
      expect(got).toBeLessThan(Number(target) + 0.001);
      /* And it never comes back as a bare number: the denominator travels with it. */
      expect(r.resultingPoolPercent.denominator).toBe("FD_POST");
      expect(r.resultingPoolPercent.denominatorShares).toBe(r.postMoneyFdShares.toString());
      expect(formatPct(r.resultingPoolPercent)).toContain("FD post-money");
    }
  });

  it("W58-P8 — a bigger pool means a LOWER price per share: the pool shuffle, measured", () => {
    /* existingPoolShares "0" so that every step of the ladder actually creates
       shares; with a pre-existing pool the small targets are already met and the
       price correctly does not move (see W58-P11). */
    const LADDER = { ...R27_CANONICAL, existingPoolShares: "0" };
    const prices = ["0", "5", "10", "15", "20"].map((t) => {
      const r = derivePoolTopUpFromPercent({ ...LADDER, poolPercentPostMoney: t });
      expect(r.ok).toBe(true);
      return r.ok ? Number(r.pricePerShare) : NaN;
    });
    for (let i = 1; i < prices.length; i += 1) {
      expect(prices[i]).toBeLessThan(prices[i - 1]);
    }
    /* And the effective pre-money falls with it — the founder pays for the pool. */
    const none = derivePoolTopUpFromPercent({ ...LADDER, poolPercentPostMoney: "0" });
    const twenty = derivePoolTopUpFromPercent({ ...LADDER, poolPercentPostMoney: "20" });
    expect(none.ok && twenty.ok).toBe(true);
    if (none.ok && twenty.ok) {
      expect(Number(twenty.effectivePreMoney)).toBeLessThan(Number(none.effectivePreMoney));
    }
  });

  it("W58-P9 — the EXISTING pool reduces the top-up needed, and is never assumed", () => {
    const withExisting = derivePoolTopUpFromPercent({ ...R27_CANONICAL, poolPercentPostMoney: "15" });
    const withoutExisting = derivePoolTopUpFromPercent({
      ...R27_CANONICAL, existingPoolShares: "0", poolPercentPostMoney: "15",
    });
    expect(withExisting.ok && withoutExisting.ok).toBe(true);
    if (!withExisting.ok || !withoutExisting.ok) return;
    /* This is scope 5's whole point: the founder must be able to SEE that the
       shares already reserved count toward the target they just agreed. */
    expect(withExisting.poolTopUpShares).toBeLessThan(withoutExisting.poolTopUpShares);

    /* AND IT IS NEVER ASSUMED TO BE ZERO. `null` means "not established", which
       is refused by name — assuming zero would over-size the top-up and dilute
       the founder by more than they agreed. */
    const unknown = derivePoolTopUpFromPercent({
      ...R27_CANONICAL, existingPoolShares: null, poolPercentPostMoney: "15",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.code).toBe("existing_pool_unknown");
      expect(unknown.reason).toContain("will not assume zero");
    }
  });

  it("W58-P10 — every missing input is refused BY NAME, and no number is substituted", () => {
    const cases: Array<[Partial<typeof R27_CANONICAL> & { poolPercentPostMoney: string }, string]> = [
      [{ ...R27_CANONICAL, poolPercentPostMoney: "15", preMoneyValuation: "" }, "pre_money_missing_for_pool"],
      [{ ...R27_CANONICAL, poolPercentPostMoney: "15", investmentAmount: "" }, "investment_missing_for_pool"],
      [{ ...R27_CANONICAL, poolPercentPostMoney: "15", fdPreMoneyShares: "" }, "Fully-diluted pre-money shares_missing"],
      [{ ...R27_CANONICAL, poolPercentPostMoney: "15", fdPreMoneyShares: "10000000.5" }, "Fully-diluted pre-money shares_fractional"],
    ];
    for (const [input, code] of cases) {
      const r = derivePoolTopUpFromPercent(input as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    }
  });

  it("W58-P11 — an already-oversized pool yields ZERO top-up, not a negative one", () => {
    const r = derivePoolTopUpFromPercent({ ...R27_CANONICAL, poolPercentPostMoney: "1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.poolTopUpShares.toString()).toBe("0");
    expect(r.resultingPoolShares.toString()).toBe("1000000");
    /* And the percentage reported is the TRUE resulting one — well above the 1%
       asked for — rather than the target echoed back. The floor is
       1,000,000 / 11,666,666 = 8.571%, and the screen shows 8.571%, not 1%. */
    expect(r.resultingPoolPercent.value).toBe("8.571");
    expect(r.resultingPoolPercent.denominatorShares).toBe("11666666");
    expect(Number(r.resultingPoolPercent.value)).toBeGreaterThan(1);
  });

  it("W58-P12 — a pool that cannot be grossed up at this valuation is refused, not clamped", () => {
    /* 100·pre-money − target·(pre-money + raise) ≤ 0. With a $1,000,000 pre-money
       and a $50,000,000 raise, a 50% pool has no solution: there is not enough
       pre-money to carve it out of. Clamping would print a number nobody agreed. */
    const r = derivePoolTopUpFromPercent({
      poolPlacement: "pre_money",
      fdPreMoneyShares: "10000000",
      preMoneyValuation: "1000000",
      investmentAmount: "50000000",
      existingPoolShares: "0",
      poolPercentPostMoney: "50",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("pool_percent_ungrossable");
  });

  it("W58-P13 — the derivation is RENDERED, so every figure on screen can be checked", () => {
    const r = derivePoolTopUpFromPercent({ ...R27_CANONICAL, poolPercentPostMoney: "15" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.derivation.join("\n");
    expect(r.derivation.length).toBeGreaterThanOrEqual(9);
    for (const must of [
      "percent-as-written",
      "Already reserved under the plan",
      "rounded UP so the target is met",
      "the pool is INSIDE the pre-money",
      "Effective (pool-adjusted) pre-money",
      "paid for by the existing holders alone",
    ]) {
      expect(text).toContain(must);
    }
  });

  it("W58-P14 — the client derivation AGREES with the engine on the canonical fixture", () => {
    /* The wizard and `computeEsopTopUp` must answer the same question or the
       founder sees one number on Step 2 and another on the Projection — which is
       exactly the class of split R21 forbids.

       Engine fixture (post-conversion): existingShares 10,500,000, existingPool
       2,000,000, target 22.5, pre-money $30,000,000, raise $10,000,000. The
       engine's canonical answers are S = 2,500,000, D = 15,000,000, p = $2.00,
       N = 5,000,000, T = 20,000,000. */
    const r = derivePoolTopUpFromPercent({
      poolPlacement: "pre_money",
      fdPreMoneyShares: "12500000",     // 10,500,000 + the 2,000,000 already reserved
      existingPoolShares: "2000000",
      preMoneyValuation: "30000000",
      investmentAmount: "10000000",
      poolPercentPostMoney: "22.5",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.poolTopUpShares.toString()).toBe("2500000");
    expect(r.pricePerShare).toBe("2");
    expect(r.newInvestorShares.toString()).toBe("5000000");
    expect(r.postMoneyFdShares.toString()).toBe("20000000");
    expect(r.resultingPoolPercent.value).toBe("22.500");
  });
});
