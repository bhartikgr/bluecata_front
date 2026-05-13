/**
 * Sprint 11 \u2014 Admin pricing tier tests.
 *
 * Locks the 3 founder pricing tiers (Free $0, Pro $249/mo, Scale $749/mo)
 * and the feature matrix structure consumed by the Settings > Plan & Pricing
 * tab.
 */
import { describe, it, expect } from "vitest";
import { PRICING_TIERS } from "../adminPricingStore";

describe("adminPricingStore", () => {
  it("defines exactly 3 founder tiers", () => {
    expect(PRICING_TIERS.length).toBe(3);
    expect(PRICING_TIERS.map((t) => t.id).sort()).toEqual([
      "founder_free",
      "founder_pro",
      "founder_scale",
    ]);
  });

  it("free tier costs $0/mo", () => {
    const free = PRICING_TIERS.find((t) => t.id === "founder_free")!;
    expect(free.monthlyUsd).toBe(0);
    expect(free.annualUsd).toBe(0);
  });

  it("pro tier costs $249/mo and has annual discount", () => {
    const pro = PRICING_TIERS.find((t) => t.id === "founder_pro")!;
    expect(pro.monthlyUsd).toBe(249);
    expect(pro.annualUsd).toBeGreaterThan(0);
    expect(pro.annualUsd).toBeLessThan(pro.monthlyUsd * 12);
  });

  it("scale tier costs $749/mo and has annual discount", () => {
    const scale = PRICING_TIERS.find((t) => t.id === "founder_scale")!;
    expect(scale.monthlyUsd).toBe(749);
    expect(scale.annualUsd).toBeLessThan(scale.monthlyUsd * 12);
  });

  it("each tier declares a feature matrix with included flags", () => {
    for (const t of PRICING_TIERS) {
      expect(t.features.length).toBeGreaterThan(0);
      for (const f of t.features) {
        expect(f.label).toBeTruthy();
        expect(typeof f.included).toBe("boolean");
      }
    }
  });
});
