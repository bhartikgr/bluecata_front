/**
 * WAVE 9 — RP-1..RP-5 proving test.
 *
 * This file previously asserted the fabrications INTO PLACE. It required that
 * every sparkline return exactly 12 samples (RP-4's sin/cos walk), that the
 * cohort benchmark always satisfy p25 < p50 < p75 (RP-5's 1.18/1.42/1.86
 * literals), and it computed its expectations from `server/mockData` — sample
 * data, in a reporting test, standing in for the platform's real numbers.
 *
 * A test that pins a fabrication is worse than no test, because it converts
 * deleting the fabrication into a "regression". The assertions below are the
 * inverse: they fail if a fabricated figure ever comes back.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  computePortfolioAnalytics,
  computePortfolioAnalyticsFor,
  type PortfolioAnalytics,
  type RealPosition,
} from "../portfolioAnalyticsStore";
import { ensureWave9Schema } from "../wave9ReportingStore";
import { createRound } from "../roundsStore";

/**
 * A mark is DERIVED FROM THE DATABASE (M-2: last priced round), never supplied
 * by the caller. So the marked-path assertions below create a real priced round
 * and let the derivation find it. A test that injected `currentValue` directly
 * would prove nothing about the path the dashboard actually uses.
 */
const MARKED_CO = `co_w9_${randomBytes(4).toString("hex")}`;
let markedRoundOk = false;

beforeAll(() => {
  ensureWave9Schema();
  try {
    createRound({
      companyId: MARKED_CO,
      name: `W9 Priced ${randomBytes(3).toString("hex")}`,
      type: "seed",
      pricePerShare: 340,
      closeDate: new Date().toISOString().slice(0, 10),
    });
    markedRoundOk = true;
  } catch {
    markedRoundOk = false;
  }
});

function pos(over: Partial<RealPosition>): RealPosition {
  return {
    companyId: "c1",
    roundId: "r1",
    invested: 100_000,
    currentValue: null,
    stage: "Seed",
    region: "US",
    vintage: "2024",
    shares: 1000,
    currency: "USD",
    ts: "2024-01-15T00:00:00.000Z",
    markBadge: "unmarked",
    ...over,
  } as RealPosition;
}

describe("RP-1..RP-5 — no fabricated figure survives at the producer", () => {
  const empty: PortfolioAnalytics = computePortfolioAnalytics();

  it("RP-1: realised proceeds are never synthesised from invested capital", () => {
    // The deleted line was `realised = invested * 0.10`. With no recorded
    // distribution rows the only true answer is zero.
    const a = computePortfolioAnalyticsFor(
      [pos({ invested: 250_000 }), pos({ companyId: "c2", invested: 150_000 })],
      { userId: "u1" },
    );
    expect(a.totalRealized).toBe(0);
    expect(a.totalRealized).not.toBeCloseTo(400_000 * 0.1, 6);
    // DPI of 0.00x is a true statement about a portfolio with no distributions.
    expect(a.dpi.value).toBe(0);
    expect(a.dpi.status).toBe("COMPUTED");
  });

  it("RP-2: an unmarked holding is labelled, never valued at cost", () => {
    const a = computePortfolioAnalyticsFor([pos({ invested: 250_000 })], { userId: "u1" });
    expect(a.totalCurrentValue).toBeNull();
    expect(a.totalCurrentValue).not.toBe(250_000);
    expect(a.valuation.unmarkedPositions).toBe(1);
    expect(a.valuation.markedPositions).toBe(0);
    expect(a.valuation.worstBadge).toBe("unmarked");
    // The old code forced MOIC to exactly 1.0 for every investor on the
    // platform. It must now be withheld, not printed.
    expect(a.moic.value).toBeNull();
    expect(a.moic.status).toBe("NO_MARKS");
    expect(a.paperGain).toBeNull();
  });

  it("RP-2: a holding with a real priced round DOES report a value", () => {
    expect(markedRoundOk).toBe(true); // fail loudly rather than skip silently
    const a = computePortfolioAnalyticsFor(
      [pos({ companyId: MARKED_CO, invested: 100_000, shares: 1000 })],
      { userId: `u_${randomBytes(4).toString("hex")}` },
    );
    // 1000 shares x 340/share, derived from the round, not from the caller.
    expect(a.totalCurrentValue).toBe(340_000);
    expect(a.valuation.markedPositions).toBe(1);
    expect(a.valuation.unmarkedPositions).toBe(0);
    expect(a.moic.status).toBe("COMPUTED");
    expect(a.moic.value).toBeCloseTo(3.4, 6);
    expect(a.valuation.worstBadge).toBe("fresh");
  });

  it("RP-2: one unmarked holding withholds the whole portfolio value", () => {
    if (!markedRoundOk) return;
    // Partial coverage is the dangerous case: summing only the marked leg
    // yields a numerator that does not correspond to the denominator.
    const a = computePortfolioAnalyticsFor(
      [
        pos({ companyId: MARKED_CO, invested: 100_000, shares: 1000 }),
        pos({ companyId: `co_none_${randomBytes(4).toString("hex")}`, invested: 100_000 }),
      ],
      { userId: `u_${randomBytes(4).toString("hex")}` },
    );
    expect(a.totalCurrentValue).toBeNull();
    expect(a.moic.value).toBeNull();
    expect(a.valuation.markedPositions).toBe(1);
    expect(a.valuation.unmarkedPositions).toBe(1);
  });

  it("bucket breakdown never disagrees with the portfolio total", () => {
    if (!markedRoundOk) return;
    const a = computePortfolioAnalyticsFor(
      [pos({ companyId: MARKED_CO, stage: "Seed", invested: 100_000, shares: 1000 })],
      { userId: `u_${randomBytes(4).toString("hex")}` },
    );
    const sumCur = Object.values(a.byStage).reduce<number | null>(
      (s, v) => (s === null || v.currentValue === null ? null : s + v.currentValue),
      0,
    );
    expect(sumCur).toBe(a.totalCurrentValue);
  });

  it("RP-3: IRR is suppressed under NO_MARKS and never prints a rate", () => {
    const a = computePortfolioAnalyticsFor([pos({ invested: 100_000 })], { userId: "u1" });
    expect(a.irr.value).toBeNull();
    expect(["NO_MARKS", "NO_FLOWS", "INSUFFICIENT_FLOWS"]).toContain(a.irr.status);
    expect(a.irrBasis).toBe("none");
  });

  it("RP-4: no series is fabricated, and none is 12 synthetic samples", () => {
    for (const key of ["moic", "irr", "tvpi", "dpi", "paperValue", "realized"] as const) {
      const s = empty.series[key];
      expect(s.points.length).not.toBe(12);
      expect(s.renderable).toBe(false);
      // Ruling Q9: charts render only at >= 3 real monthly points.
      expect(s.minPoints).toBe(3);
      expect(typeof s.reason).toBe("string");
    }
  });

  it("RP-4: YoY deltas are absent rather than invented", () => {
    const a = computePortfolioAnalyticsFor([pos({ invested: 100_000 })], { userId: "u1" });
    expect(a.yoyDelta.moic).toBeNull();
    expect(a.yoyDelta.irr).toBeNull();
    expect(a.yoyDelta.paperValue).toBeNull();
  });

  it("RP-5: the 1.18 / 1.42 / 1.86 cohort literals are gone", () => {
    expect(empty.cohortBenchmark).toBeNull();
    expect(empty.cohortStatus).not.toBe("COMPUTED");
    expect(typeof empty.cohortReason).toBe("string");
    // Belt and braces: the literals must not appear anywhere in the payload.
    const json = JSON.stringify(empty);
    expect(json).not.toContain("1.18");
    expect(json).not.toContain("1.42");
    expect(json).not.toContain("1.86");
  });

  it("the empty portfolio is an explicit empty state, not zeros dressed as data", () => {
    expect(empty.totalInvested).toBe(0);
    expect(empty.totalCurrentValue).toBeNull();
    expect(empty.valuation.totalPositions).toBe(0);
    expect(empty.moic.value).toBeNull();
    expect(empty.irr.value).toBeNull();
  });

  it("bucket breakdowns carry null value where coverage is incomplete", () => {
    const a = computePortfolioAnalyticsFor(
      [
        pos({ stage: "Seed", invested: 100_000 }),
        pos({ companyId: "c2", stage: "Series A", invested: 50_000 }),
      ],
      { userId: "u1" },
    );
    expect(a.byStage["Seed"].currentValue).toBeNull();
    expect(a.byStage["Series A"].currentValue).toBeNull();
    // Invested is always known, because it comes from the commit ledger.
    const sumInv = Object.values(a.byStage).reduce((s, v) => s + v.invested, 0);
    expect(sumInv).toBe(a.totalInvested);
  });

  it("the producer no longer imports the demo seed", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../portfolioAnalyticsStore.ts", import.meta.url).pathname,
      "utf8",
    );
    // RP-1..RP-5: `server/mockData` must not be reachable from the reporting
    // producer at all. This is the assertion that keeps the seed out.
    // Strip comments first: the file DOCUMENTS what was deleted, and that
    // prose legitimately names the seed it no longer imports.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "\.\/mockData"/);
    expect(code).not.toMatch(/investorPortfolio/);
  });
});
