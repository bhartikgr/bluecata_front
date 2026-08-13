/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — NAV FALSIFICATION HARNESS.
 *
 * RULE 1, PAID FOR IN BLOOD: twenty-three checks in this tree passed while
 * checking nothing. The most recent pinned "buckets are per identity" against a
 * single collapsed anonymous identity, because the identifying header was only
 * honoured under the dev bypass. So:
 *
 *   · EVERY test here ESTABLISHES ITS OWN PRECONDITIONS. Nothing reads
 *     `process.env`. There is no skip, no conditional assertion, and no test
 *     that would still pass if the code under test were deleted.
 *   · BOTH POLES are asserted. For every "it refuses X" there is a paired
 *     "and it does NOT refuse the legitimate near-miss", because a function
 *     that refuses everything passes a one-poled refusal suite.
 *   · The mark lookup is INJECTED, so a mark's presence or absence is a fact
 *     the test creates rather than a fact it hopes the fixture database holds.
 *     A vacuous pass caused by an empty rounds table is therefore impossible:
 *     assertions below FAIL if the injected mark is ignored.
 *
 * MUTANTS RUN AGAINST THIS FILE are recorded in build_log/WAVE32_REPORT.md.
 */
import { describe, it, expect } from "vitest";
import {
  computeSpvNav,
  holdingFairValueMinor,
  parseExactDecimal,
  allocateLpNavShares,
  isHoldingState,
  NON_HOLDING_DEPLOYMENT_STATES,
  type NavHoldingInput,
} from "../lib/spvNav";
import type { DerivedMark } from "../wave9ReportingStore";

const THRESHOLDS = { staleWarnDays: 180, staleExpiredDays: 365 };

function mark(over: Partial<DerivedMark> & { pricePerShare: number }): DerivedMark {
  return {
    companyId: over.companyId ?? "co_1",
    pricePerShare: over.pricePerShare,
    valuationDate: over.valuationDate ?? "2026-01-15",
    roundId: over.roundId ?? "rnd_1",
    roundName: over.roundName ?? "Series A",
    ageDays: over.ageDays ?? 30,
    badge: over.badge ?? "fresh",
    method: over.method ?? "last_priced_round",
    source: over.source ?? "derived_priced_round",
  };
}

function holding(over: Partial<NavHoldingInput> = {}): NavHoldingInput {
  return {
    deploymentId: over.deploymentId ?? "dep_1",
    companyId: over.companyId ?? "co_1",
    shares: over.shares !== undefined ? over.shares : "1000",
    costMinor: over.costMinor ?? 100000,
    currency: over.currency ?? "USD",
    status: over.status ?? "deployed",
  };
}

/* ==========================================================================
 * A. EXACT ARITHMETIC — shares × price, in minor units.
 * ======================================================================== */
describe("W32/NAV A — exact shares × price arithmetic", () => {
  it("A1 multiplies exactly in USD (exponent 2) with no binary-float drift", () => {
    // 1000 shares at $12.34 = $12,340.00 = 1,234,000 cents.
    expect(holdingFairValueMinor("1000", 12.34, "USD")).toBe(BigInt(1234000));
  });

  it("A2 JPY FIXTURE (ISO-4217 exponent 0): the minor unit IS the yen", () => {
    // Rule 4: every money test needs a JPY fixture. 1,000 shares at ¥250
    // is ¥250,000 — and 250000, not 25000000. A hardcoded 2-decimal exponent
    // would inflate this 100x, which is the defect `decimalStringToMinor`
    // exists to prevent.
    expect(holdingFairValueMinor("1000", 250, "JPY")).toBe(BigInt(250000));
    // The negative pole: the SAME inputs in USD must NOT equal the JPY answer,
    // otherwise the currency argument is being ignored and A2 proves nothing.
    expect(holdingFairValueMinor("1000", 250, "USD")).toBe(BigInt(25000000));
  });

  it("A3 rounds a sub-minor product HALF TO EVEN, not half up", () => {
    // 1 share at $0.005 = half a cent exactly. Half-even -> 0 (0 is even).
    expect(holdingFairValueMinor("1", 0.005, "USD")).toBe(BigInt(0));
    // 3 shares at $0.005 = 1.5 cents exactly. Half-even -> 2 (2 is even).
    expect(holdingFairValueMinor("3", 0.005, "USD")).toBe(BigInt(2));
    // Both poles: a NON-tie must round normally in each direction.
    expect(holdingFairValueMinor("1", 0.006, "USD")).toBe(BigInt(1));
    expect(holdingFairValueMinor("1", 0.004, "USD")).toBe(BigInt(0));
  });

  it("A4 handles a fractional share count exactly", () => {
    // 1,234.5678 shares at $3.21 = $3,962.96... -> exact integer cents.
    // 12345678 * 321 = 3962962438 ; scale 4+2=6 ; /10^4 (after *10^2 for cents)
    const v = holdingFairValueMinor("1234.5678", 3.21, "USD");
    expect(v).toBe(BigInt(396296));
  });

  it("A5 refuses, rather than guesses, an unparseable or negative input", () => {
    expect(holdingFairValueMinor(null, 1, "USD")).toBeNull();
    expect(holdingFairValueMinor("", 1, "USD")).toBeNull();
    expect(holdingFairValueMinor("not-a-number", 1, "USD")).toBeNull();
    expect(holdingFairValueMinor("-100", 1, "USD")).toBeNull();
    expect(holdingFairValueMinor("100", -1, "USD")).toBeNull();
    // NEGATIVE POLE: a legitimate zero share count is NOT a refusal — zero
    // shares is a real, known fact worth exactly nothing. If this returned null
    // the refusal branch would be swallowing valid data.
    expect(holdingFairValueMinor("0", 12.34, "USD")).toBe(BigInt(0));
  });

  it("A6 parseExactDecimal keeps exponent notation exact", () => {
    expect(parseExactDecimal("1e3")).toEqual({ digits: BigInt(1), scale: -3 });
    expect(parseExactDecimal("0.001")).toEqual({ digits: BigInt(1), scale: 3 });
    expect(parseExactDecimal("abc")).toBeNull();
  });
});

/* ==========================================================================
 * B. THE CORE PROMISE — no fabricated NAV, ever.
 * ======================================================================== */
describe("W32/NAV B — a blank beats a fabricated number", () => {
  it("B1 an UNMARKED holding makes the TOTAL null — it does not fall back to cost", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ deploymentId: "d1", companyId: "co_marked" }),
                 holding({ deploymentId: "d2", companyId: "co_unmarked", costMinor: 500000 })],
      markLookup: (companyId) => (companyId === "co_marked" ? mark({ pricePerShare: 12.34 }) : null),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("partial_unmarked");
    expect(r.totalNavMinor).toBeNull();
    // The specific defect being excluded: PRIOR_ART_SWEEP §A,
    // `portfolioAnalyticsStore.ts:100` set currentValue = invested. If the NAV
    // total ever equals the cost total, that defect has been reintroduced.
    expect(r.totalNavMinor).not.toBe(r.totalCostMinor);
    const unmarkedLine = r.holdings.find((h) => h.deploymentId === "d2")!;
    expect(unmarkedLine.fairValueMinor).toBeNull();
    expect(unmarkedLine.fairValueMinor).not.toBe(unmarkedLine.costMinor);
    expect(unmarkedLine.refusal).toBe("NO_PRICED_ROUND");
    expect(r.refusalCopy).toBeTruthy();
  });

  it("B2 BOTH POLES: a fully marked portfolio DOES produce a number", () => {
    // Without this pole, B1 would pass against a function that returns null
    // unconditionally — the classic vacuous refusal test.
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ deploymentId: "d1", companyId: "co_a", shares: "1000" }),
                 holding({ deploymentId: "d2", companyId: "co_b", shares: "500" })],
      markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("complete");
    expect(r.totalNavMinor).toBe(1500 * 1000); // 1500 shares * $10 = $15,000
    expect(r.unmarkedHoldings).toBe(0);
    expect(r.refusalCopy).toBeNull();
  });

  it("B3 a SHARE COUNT the platform does not know is unmarked, not zero", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ shares: null })],
      markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("partial_unmarked");
    expect(r.holdings[0].refusal).toBe("SHARE_COUNT_UNKNOWN");
    expect(r.holdings[0].fairValueMinor).toBeNull();
    expect(r.holdings[0].fairValueMinor).not.toBe(0);
  });

  it("B4 NEVER sums across currencies", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ deploymentId: "d1", companyId: "co_a", currency: "USD" }),
                 holding({ deploymentId: "d2", companyId: "co_b", currency: "JPY" })],
      markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("mixed_currency");
    expect(r.totalNavMinor).toBeNull();
    expect(r.totalCostMinor).toBeNull();
    // Every holding is still individually valued — refusing the TOTAL must not
    // silently drop the per-line data (never silently drop functionality).
    expect(r.holdings.every((h) => h.fairValueMinor !== null)).toBe(true);
    expect(r.refusalCopy).toContain("JPY");
  });

  it("B5 an empty vehicle says 'no holdings', not 'NAV 0'", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [], markLookup: () => null, thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("no_holdings");
    expect(r.totalNavMinor).toBeNull();
    expect(r.totalNavMinor).not.toBe(0);
  });
});

/* ==========================================================================
 * C. Q5 — badging and staleness are carried, not dropped.
 * ======================================================================== */
describe("W32/NAV C — Q5 badging survives aggregation", () => {
  it("C1 the vehicle badge is the WORST across holdings", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ deploymentId: "d1", companyId: "co_fresh" }),
                 holding({ deploymentId: "d2", companyId: "co_expired" })],
      markLookup: (companyId) =>
        companyId === "co_fresh"
          ? mark({ pricePerShare: 10, badge: "fresh", ageDays: 10 })
          : mark({ pricePerShare: 10, badge: "expired", ageDays: 400 }),
      thresholds: THRESHOLDS,
    });
    expect(r.worstMarkBadge).toBe("expired");
    // BOTH POLES: an all-fresh vehicle must NOT be badged expired, or C1 would
    // pass against a function hardcoded to "expired".
    const fresh = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding()], markLookup: () => mark({ pricePerShare: 10, badge: "fresh" }),
      thresholds: THRESHOLDS,
    });
    expect(fresh.worstMarkBadge).toBe("fresh");
  });

  it("C2 an EXPIRED mark still produces a number, badged — it is not silently voided", () => {
    // Q5 says marks EXPIRE at 365 days; it does not say an expired mark ceases
    // to exist. Dropping it would be silently dropping functionality. The
    // number is reported WITH its badge so the reader can judge it.
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding()],
      markLookup: () => mark({ pricePerShare: 10, badge: "expired", ageDays: 400 }),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("complete");
    expect(r.totalNavMinor).toBe(1000 * 1000);
    expect(r.worstMarkBadge).toBe("expired");
  });

  it("C3 a GP override is badged as such, so a NAV never hides that it was overridden", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding()],
      markLookup: () => mark({ pricePerShare: 99, badge: "gp_override", method: "gp_override" }),
      thresholds: THRESHOLDS,
    });
    expect(r.holdings[0].markBadge).toBe("gp_override");
    expect(r.holdings[0].markMethod).toBe("gp_override");
    expect(r.worstMarkBadge).toBe("gp_override");
  });

  it("C4 the thresholds in force are CARRIED on the result, not re-derived by the reader", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding()], markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: { staleWarnDays: 90, staleExpiredDays: 200 },
    });
    // Proves the value is threaded through rather than hardcoded to 180/365.
    expect(r.thresholds).toEqual({ staleWarnDays: 90, staleExpiredDays: 200 });
  });
});

/* ==========================================================================
 * D. HOLDING STATE — a pending deployment is not an asset.
 * ======================================================================== */
describe("W32/NAV D — only real holdings count", () => {
  it("D1 pending / cancelled deployments are excluded from NAV", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ deploymentId: "d1", status: "pending" }),
                 holding({ deploymentId: "d2", status: "cancelled" })],
      markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: THRESHOLDS,
    });
    expect(r.status).toBe("no_holdings");
    expect(r.holdings).toHaveLength(0);
  });

  it("D2 BOTH POLES: a deployed holding IS included", () => {
    const r = computeSpvNav({
      spvId: "spv_1", asOfDate: "2026-08-11", vehicleCurrency: "USD",
      holdings: [holding({ status: "deployed" })],
      markLookup: () => mark({ pricePerShare: 10 }),
      thresholds: THRESHOLDS,
    });
    expect(r.holdings).toHaveLength(1);
    expect(r.status).toBe("complete");
  });

  it("D3 the non-holding state set is PINNED, so a new status cannot silently join a NAV", () => {
    expect(Array.from(NON_HOLDING_DEPLOYMENT_STATES.values()).sort())
      .toEqual(["cancelled", "failed", "pending", "rejected"]);
    expect(isHoldingState("deployed")).toBe(true);
    expect(isHoldingState("pending")).toBe(false);
  });
});

/* ==========================================================================
 * E. PER-LP NAV SHARES — allocated, never rounded per party.
 * ======================================================================== */
describe("W32/NAV E — per-LP NAV shares conserve every minor unit", () => {
  it("E1 shares sum EXACTLY to the total, including an indivisible residual", () => {
    const shares = allocateLpNavShares(10001, [
      { investorId: "lp_a", commitmentMinor: 1000 },
      { investorId: "lp_b", commitmentMinor: 1000 },
      { investorId: "lp_c", commitmentMinor: 1000 },
    ]);
    expect(shares.map((s) => s.navShareMinor)).toEqual([3334, 3334, 3333]);
    expect(shares.reduce((a, s) => a + (s.navShareMinor ?? 0), 0)).toBe(10001);
  });

  it("E2 JPY FIXTURE: ¥100 across three equal LPs is 34/33/33 and sums to 100", () => {
    const shares = allocateLpNavShares(100, [
      { investorId: "lp_a", commitmentMinor: 1 },
      { investorId: "lp_b", commitmentMinor: 1 },
      { investorId: "lp_c", commitmentMinor: 1 },
    ]);
    expect(shares.map((s) => s.navShareMinor)).toEqual([34, 33, 33]);
    expect(shares.reduce((a, s) => a + (s.navShareMinor ?? 0), 0)).toBe(100);
  });

  it("E3 the residual goes to the LARGEST holder on a remainder tie (weight DESC)", () => {
    // money.ts's pinned vector 4: 2 units, weights (1,3) -> [0, 2].
    const shares = allocateLpNavShares(2, [
      { investorId: "lp_small", commitmentMinor: 1 },
      { investorId: "lp_big", commitmentMinor: 3 },
    ]);
    expect(shares.map((s) => s.navShareMinor)).toEqual([0, 2]);
  });

  it("E4 an UNKNOWN vehicle NAV yields UNKNOWN per-LP shares, never zeros", () => {
    const shares = allocateLpNavShares(null, [
      { investorId: "lp_a", commitmentMinor: 1000 },
    ]);
    expect(shares[0].navShareMinor).toBeNull();
    expect(shares[0].navShareMinor).not.toBe(0);
  });

  it("E5 a register with no committed capital yields UNKNOWN, not an invented even split", () => {
    const shares = allocateLpNavShares(1000, [
      { investorId: "lp_a", commitmentMinor: 0 },
      { investorId: "lp_b", commitmentMinor: 0 },
    ]);
    expect(shares.every((s) => s.navShareMinor === null)).toBe(true);
  });
});
