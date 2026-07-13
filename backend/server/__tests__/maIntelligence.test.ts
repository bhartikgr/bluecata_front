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
  buildMaAggregateResponse,
  buildMaFullBody,
} from "../maIntelligenceStore";
import type { DerivedMaIntel } from "../lib/maProfileSource";
import type { MaAccessDecision } from "../lib/maAuthzGate";
import { MA_PRIVACY_DEFAULT } from "../../shared/schema";

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

/* Wave 5 M&A fix — expose comparableExits + revenueMultipleRange to all
 * authorized investors (FULL/DETAIL), never in AGGREGATE, never fabricated. */
describe("M&A intelligence endpoint body builders", () => {
  const baseIntel: DerivedMaIntel = {
    companyId: "co_test",
    maScore: 72,
    acquirerFitScore: 66,
    intentSignal: "inbound",
    productMarketFit: 70,
    technologyDifferentiation: 60,
    customerConcentration: 85,
    growthRate: 55,
    marketShare: 40,
    managementTeamStrength: 68,
    strategicPriorities: ["scale"],
    transactionInterests: ["strategic_acquisition"],
    topBuyer: { name: "Acme", rationale: "adjacency" },
  };
  const decision = (over: Partial<MaAccessDecision> = {}): MaAccessDecision => ({
    level: "FULL",
    canSeeNarrative: true,
    canSeeBuyers: true,
    privacy: { ...MA_PRIVACY_DEFAULT },
    companyChapter: null,
    ...over,
  });

  it("FULL body includes comparableExits (array) and revenueMultipleRange ({low,high} numbers)", () => {
    const body = buildMaFullBody("co_test", baseIntel, decision(), null);
    expect(Array.isArray(body.comparableExits)).toBe(true);
    const range = body.revenueMultipleRange as { low: number; high: number };
    expect(typeof range.low).toBe("number");
    expect(typeof range.high).toBe("number");
  });

  it("DETAIL body also includes both fields (same tier as basic scores, not buyer-gated)", () => {
    const body = buildMaFullBody(
      "co_test",
      baseIntel,
      decision({ level: "DETAIL", canSeeNarrative: false, canSeeBuyers: false }),
      null,
    );
    expect(Array.isArray(body.comparableExits)).toBe(true);
    expect(body.revenueMultipleRange).toBeDefined();
    // Present even when buyers are hidden.
    expect(body.topStrategicBuyers).toEqual([]);
  });

  it("passes real comps + range through when present (never fabricated, never dropped)", () => {
    const withComps: DerivedMaIntel = {
      ...baseIntel,
      comparableExits: [
        { target: "T1", acquirer: "A1", date: "2025-11-04", valuationUsd: 680_000_000, revenueMultiple: 11.4 },
      ],
      revenueMultipleRange: { low: 2.1, high: 4.8 },
    };
    const body = buildMaFullBody("co_test", withComps, decision(), null);
    expect(body.comparableExits).toHaveLength(1);
    expect(body.revenueMultipleRange).toEqual({ low: 2.1, high: 4.8 });
  });

  it("derived record without comps yields honest empty list / zero range (no fabrication)", () => {
    const body = buildMaFullBody("co_test", baseIntel, decision(), null);
    expect(body.comparableExits).toEqual([]);
    expect(body.revenueMultipleRange).toEqual({ low: 0, high: 0 });
  });

  it("AGGREGATE body does NOT include comparableExits or revenueMultipleRange", () => {
    const body = buildMaAggregateResponse("co_test", {
      ...baseIntel,
      comparableExits: [
        { target: "T1", acquirer: "A1", date: "2025-11-04", valuationUsd: 1, revenueMultiple: 5 },
      ],
      revenueMultipleRange: { low: 5, high: 5 },
    });
    expect("comparableExits" in body).toBe(false);
    expect("revenueMultipleRange" in body).toBe(false);
    expect(body.strategicBuyerCount).toBe(1);
  });

  it("narrative stays gated behind canSeeNarrative", () => {
    const shown = buildMaFullBody("co_test", baseIntel, decision({ canSeeNarrative: true }), "hello");
    expect(shown.maReadinessNarrative).toBe("hello");
    const hidden = buildMaFullBody("co_test", baseIntel, decision({ canSeeNarrative: false }), "hello");
    expect("maReadinessNarrative" in hidden).toBe(false);
  });
});
