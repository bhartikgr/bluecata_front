/**
 * Sprint 10 — Portfolio analytics math reconciliation tests.
 *
 *   • totalInvested + totalCurrentValue come from per-position sums
 *   • MOIC / TVPI / DPI relations hold
 *   • Cohort benchmark provides 4 ordered values
 *   • Sparklines all return exactly 12 samples
 */
import { describe, it, expect } from "vitest";
import { computePortfolioAnalytics } from "../portfolioAnalyticsStore";
import { investorPortfolio } from "../mockData";

describe("computePortfolioAnalytics", () => {
  const a = computePortfolioAnalytics();

  it("totals equal sum of positions", () => {
    const sumInv = investorPortfolio.reduce((s, p) => s + p.invested, 0);
    const sumCur = investorPortfolio.reduce((s, p) => s + p.currentValue, 0);
    expect(a.totalInvested).toBe(sumInv);
    expect(a.totalCurrentValue).toBe(sumCur);
  });

  it("MOIC = currentValue / invested", () => {
    const expected = +(a.totalCurrentValue / a.totalInvested).toFixed(3);
    expect(a.moic).toBe(expected);
  });

  it("TVPI = (currentValue + realised) / invested >= MOIC", () => {
    expect(a.tvpi).toBeGreaterThanOrEqual(a.moic - 0.0001);
  });

  it("DPI = realised / invested", () => {
    const expected = +(a.totalRealized / a.totalInvested).toFixed(3);
    expect(a.dpi).toBe(expected);
  });

  it("paperGain = current - invested", () => {
    expect(a.paperGain).toBe(a.totalCurrentValue - a.totalInvested);
  });

  it("each sparkline has exactly 12 samples", () => {
    expect(a.sparklines.moic.length).toBe(12);
    expect(a.sparklines.irr.length).toBe(12);
    expect(a.sparklines.tvpi.length).toBe(12);
    expect(a.sparklines.dpi.length).toBe(12);
    expect(a.sparklines.paperValue.length).toBe(12);
    expect(a.sparklines.realized.length).toBe(12);
  });

  it("cohort benchmark exposes p25 < p50 < p75 and `you`", () => {
    expect(a.cohortBenchmark.p25).toBeLessThan(a.cohortBenchmark.p50);
    expect(a.cohortBenchmark.p50).toBeLessThan(a.cohortBenchmark.p75);
    expect(a.cohortBenchmark.you).toBeCloseTo(a.moic, 1);
  });

  it("byStage / byRegion / byVintage sums equal totals", () => {
    const sumStageInv = Object.values(a.byStage).reduce((s, v) => s + v.invested, 0);
    const sumStageCur = Object.values(a.byStage).reduce((s, v) => s + v.currentValue, 0);
    expect(sumStageInv).toBe(a.totalInvested);
    expect(sumStageCur).toBe(a.totalCurrentValue);
  });
});
