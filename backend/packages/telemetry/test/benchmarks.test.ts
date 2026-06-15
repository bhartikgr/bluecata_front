/**
 * Cohort benchmark tests.
 */
import { describe, it, expect } from "vitest";
import { BenchmarkStore, seedSyntheticBenchmarks, defaultBenchmarkStore } from "../src/benchmarks.js";

describe("benchmarks", () => {
  it("seeds 130 synthetic rounds across multiple cohorts (incl. HK, CN, IN, JP, AU)", () => {
    const s = new BenchmarkStore();
    seedSyntheticBenchmarks(s);
    // 50 original + 16 HK (6+5+5) + 16 CN (6+5+5) + 16 IN (6+5+5) + 16 JP (6+5+5) + 16 AU (6+5+5) = 130
    expect(s.size()).toBe(130);
    expect(s.listCohorts().length).toBeGreaterThanOrEqual(20);
    // Region coverage: at least one cohort each for HK, CN, IN, JP, AU
    for (const region of ["HK", "CN", "IN", "JP", "AU"]) {
      expect(
        s.listCohorts().some((c) => c.cohort.region === region)
      ).toBe(true);
    }
  });

  it("computes percentiles for fintech / seed / US", () => {
    const p = defaultBenchmarkStore.getCohortBenchmarks({ sector: "fintech", stage: "seed", region: "US" });
    expect(p).not.toBeNull();
    expect(p!.count).toBe(15);
    expect(p!.durationDays.p25).toBeLessThanOrEqual(p!.durationDays.p50);
    expect(p!.durationDays.p50).toBeLessThanOrEqual(p!.durationDays.p75);
    expect(p!.durationDays.p75).toBeLessThanOrEqual(p!.durationDays.p90);
  });

  it("returns null for empty cohort", () => {
    const p = defaultBenchmarkStore.getCohortBenchmarks({ sector: "biotech", stage: "later", region: "CA" });
    expect(p).toBeNull();
  });

  it("addToCohort grows the cohort", () => {
    const s = new BenchmarkStore();
    s.addToCohort("r1", { sector: "x", stage: "seed", region: "US" }, {
      durationDays: 30, preMoneyValuation: 5_000_000, softCircleConversionRate: 0.5,
      leadInvestorChequeSize: 1_000_000, totalRoundSize: 2_000_000, timeToCloseDays: 35,
    });
    s.addToCohort("r2", { sector: "x", stage: "seed", region: "US" }, {
      durationDays: 60, preMoneyValuation: 10_000_000, softCircleConversionRate: 0.7,
      leadInvestorChequeSize: 2_000_000, totalRoundSize: 4_000_000, timeToCloseDays: 65,
    });
    const p = s.getCohortBenchmarks({ sector: "x", stage: "seed", region: "US" });
    expect(p!.count).toBe(2);
  });
});
