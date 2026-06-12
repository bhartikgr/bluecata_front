/**
 * Sprint 10 — M&A intelligence aggregator tests.
 *
 * Covers:
 *   • computeAcquirerFitScore weight sum and bounds
 *   • filterComparableExits 24-month window
 *   • getMaIntelligenceFor known and unknown companies
 */
import { describe, it, expect } from "vitest";
import {
  computeAcquirerFitScore,
  filterComparableExits,
  getMaIntelligenceFor,
} from "../maIntelligenceStore";

describe("computeAcquirerFitScore", () => {
  it("weights sum to 1.0 (within float tolerance)", () => {
    // Verify by passing all-100 inputs; result should be ~100.
    const score = computeAcquirerFitScore({ pmf: 100, tech: 100, mgmt: 100, growth: 100, share: 100, lowChurn: 100 });
    expect(score).toBeGreaterThan(99);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns 0 for all-zero inputs", () => {
    expect(computeAcquirerFitScore({ pmf: 0, tech: 0, mgmt: 0, growth: 0, share: 0, lowChurn: 0 })).toBe(0);
  });

  it("respects pmf and lowChurn as the heaviest weights (>= tech weight)", () => {
    const lifted = computeAcquirerFitScore({ pmf: 100, tech: 0, mgmt: 0, growth: 0, share: 0, lowChurn: 0 });
    const tech   = computeAcquirerFitScore({ pmf: 0, tech: 100, mgmt: 0, growth: 0, share: 0, lowChurn: 0 });
    const churn  = computeAcquirerFitScore({ pmf: 0, tech: 0, mgmt: 0, growth: 0, share: 0, lowChurn: 100 });
    expect(lifted).toBe(churn);
    expect(lifted).toBeGreaterThanOrEqual(tech);
  });
});

describe("filterComparableExits", () => {
  const now = "2026-05-01";
  const data = [
    { date: "2026-01-15", sector: "Fintech",   id: 1 },
    { date: "2025-04-30", sector: "Fintech",   id: 2 }, // ~12 months back — in
    { date: "2024-04-30", sector: "Fintech",   id: 3 }, // > 24 months — out
    { date: "2025-12-01", sector: "Healthtech", id: 4 }, // wrong sector — out
  ];
  it("keeps entries within window and matching sector", () => {
    const out = filterComparableExits(data, now, "Fintech", 24);
    expect(out.map((e) => e.id).sort()).toEqual([1, 2]);
  });
  it("returns empty if no comps in window", () => {
    expect(filterComparableExits(data, now, "Climate", 24)).toEqual([]);
  });
});

describe("getMaIntelligenceFor", () => {
  it("returns intelligence for a seeded company", () => {
    const r = getMaIntelligenceFor("co_novapay") as Record<string, unknown>;
    expect(r.companyId).toBe("co_novapay");
    expect((r.acquirerFitScore as number)).toBeGreaterThan(0);
    expect((r.acquirerFitScore as number)).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.comparableExits)).toBe(true);
    // Buyer list field can be either `topStrategicBuyers` or `buyerShortlist`.
    const buyers = (r.topStrategicBuyers ?? r.buyerShortlist) as unknown[];
    expect(Array.isArray(buyers)).toBe(true);
  });
  it("returns a graceful default for unknown companies", () => {
    const r = getMaIntelligenceFor("co_does_not_exist") as Record<string, unknown>;
    expect(r.companyId).toBe("co_does_not_exist");
    expect(typeof r.acquirerFitScore).toBe("number");
  });
});
