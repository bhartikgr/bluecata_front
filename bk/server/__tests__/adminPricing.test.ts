/**
 * Sprint 11 — Admin pricing tier tests.
 *
 * v19 Wave A / Change 2: Per founder directive (Ozan, 24-May-2026), display
 * only ONE pricing option — \$840 USD/year — that delivers full Capavate
 * functionality per company. Collective + Consortium are explicit exclusions.
 *
 * The previous 3-tier matrix (Free / Pro / Scale) was removed from the
 * displayed seed. Subscription enum / `subscriptionsStore.PLAN_PRICES` still
 * carries the legacy Plan keys for back-compat with existing subscriptions —
 * see server/subscriptionsStore.ts and sprint28_* tests. This file locks the
 * DISPLAY layer (PRICING_TIERS) only.
 */
import { describe, it, expect } from "vitest";
import { PRICING_TIERS } from "../adminPricingStore";

describe("adminPricingStore (v19 single-plan)", () => {
  it("defines exactly one default founder tier", () => {
    expect(PRICING_TIERS.length).toBe(1);
    expect(PRICING_TIERS[0]!.id).toBe("founder_capavate_annual");
  });

  it("the lone tier is \\$840 USD/year (annual billing)", () => {
    const tier = PRICING_TIERS[0]!;
    expect(tier.annualUsd).toBe(840);
    expect(tier.annualPriceCents).toBe(84_000);
    expect(tier.billingCycle).toBe("annual");
    expect(tier.displayPrice).toMatch(/840/);
    expect(tier.displayPrice).toMatch(/year/i);
  });

  it("monthly equivalent is \\$70 (= 840 / 12) for display only", () => {
    expect(PRICING_TIERS[0]!.monthlyUsd).toBe(70);
  });

  it("Collective and Consortium are explicitly EXCLUDED from the tier", () => {
    const tier = PRICING_TIERS[0]!;
    const collective = tier.features.find((f) => f.key === "collective");
    const consortium = tier.features.find((f) => f.key === "consortium");
    expect(collective).toBeDefined();
    expect(consortium).toBeDefined();
    expect(collective!.included).toBe(false);
    expect(consortium!.included).toBe(false);
  });

  it("declares a feature matrix with included flags (all flags boolean)", () => {
    const tier = PRICING_TIERS[0]!;
    expect(tier.features.length).toBeGreaterThan(0);
    for (const f of tier.features) {
      expect(f.label).toBeTruthy();
      expect(typeof f.included).toBe("boolean");
    }
  });

  it("includes the core Capavate features as ENABLED", () => {
    const tier = PRICING_TIERS[0]!;
    const required = [
      "cap_table",
      "rounds",
      "data_room",
      "investors_crm",
      "documents",
      "esop",
    ];
    for (const key of required) {
      const f = tier.features.find((x) => x.key === key);
      expect(f, `expected feature ${key} on tier`).toBeDefined();
      expect(f!.included).toBe(true);
    }
  });
});
