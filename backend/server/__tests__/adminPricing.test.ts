/**
 * Sprint 11 — Admin pricing tier tests.
 *
 * v19 Wave A / Change 2: Per founder directive (Ozan, 24-May-2026), display
 * only ONE pricing option — full Capavate functionality per company, billed
 * annually. Collective + Consortium are explicit exclusions.
 *
 * WAVE 134 cause 1-of-3 (R98) — WHY THIS FILE CHANGED
 * --------------------------------------------------
 * This file used to read:
 *
 *     expect(PRICING_TIERS.length).toBe(1);
 *     expect(PRICING_TIERS[0]!.id).toBe("founder_capavate_annual");
 *     expect(tier.annualUsd).toBe(840);
 *
 * i.e. it asserted that a tier and a price exist IN THE SOURCE. v25.27 deleted
 * exactly that: `pricingModelStore.ts:160-181` ("NO SEED. Admin is the source of
 * truth.") removed all source-baked pricing, and `adminPricingStore.PRICING_TIERS`
 * became a live read adapter over the admin-authored, DB-backed store. Per R95
 * and R96 pricing is admin-set and database-driven and must never be compiled in,
 * so the removal is correct and THE TEST is the stale artefact (R98).
 *
 * The re-based assertions are STRONGER, not weaker. The old test passed whether
 * $840 came from an admin or from a constant — it could not tell those apart, and
 * would have gone green again the day someone re-hardcoded a price. The new ones
 * pin the whole chain: nothing published ⇒ nothing displayed; a published tier is
 * echoed EXACTLY; a re-published amount MOVES the display. The tier id is no
 * longer pinned to the deleted seed's id `founder_capavate_annual` (a source
 * artefact); identity is now the admin-authored slug, which is what
 * `subscriptionsStore.PLAN_TO_SLUG` and the bootstrap endpoint actually key on.
 *
 * The admin is played by the ONE shared fixture `_fixtures/pricingCatalogueFixture.ts`,
 * which authors tiers through the production write path (createModel →
 * promoteModel). Its amounts cannot leak into product code: see
 * `w134_pricing_catalogue_fixture.test.ts` §3.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PRICING_TIERS } from "../adminPricingStore";
import { updateModel } from "../pricingModelStore";
import {
  authorPricingTier,
  clearAuthoredPricingTiers,
  CAPAVATE_CORE_FEATURE_KEYS,
  CAPAVATE_EXCLUDED_FEATURE_KEYS,
  FIXTURE_PRICING_ADMIN,
} from "./_fixtures/pricingCatalogueFixture";

/* The amount THE ADMIN TYPES in this test, in integer minor units, plus its USD
   major-unit twin. Declared as a pair so the display assertions below compare a
   published input against a rendered output instead of dividing money. */
const ADMIN_SET_ANNUAL_MINOR = 84_000;
const ADMIN_SET_ANNUAL_USD = 840;
const ADMIN_SET_MONTHLY_USD = 70; // 840 / 12, display-only derivation

beforeEach(() => {
  clearAuthoredPricingTiers();
});

describe("adminPricingStore (v19 single-plan)", () => {
  it("displays NOTHING until an admin publishes a founder tier", () => {
    /* WAVE 134 (R98): the assertion the deleted seed made impossible. */
    expect(PRICING_TIERS.length).toBe(0);
    expect(PRICING_TIERS[0]).toBeUndefined();
  });

  it("exposes exactly the one founder tier the admin published", () => {
    const published = authorPricingTier({
      slug: "capavate-annual",
      name: "Capavate Annual",
      annualMinor: ADMIN_SET_ANNUAL_MINOR,
    });
    expect(PRICING_TIERS.length).toBe(1);
    expect(PRICING_TIERS[0]!.id).toBe(published.id);
    expect(published.slug).toBe("capavate-annual");
    expect(published.createdBy).toBe(FIXTURE_PRICING_ADMIN);
  });

  it("the lone tier is displayed at the amount the admin set (annual billing)", () => {
    authorPricingTier({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: ADMIN_SET_ANNUAL_MINOR });
    const tier = PRICING_TIERS[0]!;
    expect(tier.annualPriceCents).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(tier.annualMinor).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(tier.annualUsd).toBe(ADMIN_SET_ANNUAL_USD);
    expect(tier.currency).toBe("USD");
    expect(tier.billingCycle).toBe("annual");
    expect(tier.displayPrice).toMatch(new RegExp(String(ADMIN_SET_ANNUAL_USD)));
    expect(tier.displayPrice).toMatch(/year/i);
  });

  it("re-publishing a different amount MOVES the display (no compiled-in price)", () => {
    const published = authorPricingTier({
      slug: "capavate-annual",
      name: "Capavate Annual",
      annualMinor: ADMIN_SET_ANNUAL_MINOR,
    });
    const REPRICED_MINOR = 96_000;
    const REPRICED_USD = 960;
    const edited = updateModel(
      published.id,
      { basePriceMinor: REPRICED_MINOR, cadenceOptions: [{ cadence: "annual", priceMinor: REPRICED_MINOR }] },
      FIXTURE_PRICING_ADMIN,
    );
    expect(edited.ok).toBe(true);
    const tier = PRICING_TIERS[0]!;
    expect(tier.annualPriceCents).toBe(REPRICED_MINOR);
    expect(tier.annualUsd).toBe(REPRICED_USD);
    expect(tier.displayPrice).toMatch(new RegExp(String(REPRICED_USD)));
  });

  it("monthly equivalent is the annual amount / 12 for display only", () => {
    authorPricingTier({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: ADMIN_SET_ANNUAL_MINOR });
    expect(PRICING_TIERS[0]!.monthlyUsd).toBe(ADMIN_SET_MONTHLY_USD);
  });

  it("Collective and Consortium are explicitly EXCLUDED from the tier", () => {
    authorPricingTier({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: ADMIN_SET_ANNUAL_MINOR });
    const tier = PRICING_TIERS[0]!;
    for (const key of CAPAVATE_EXCLUDED_FEATURE_KEYS) {
      const f = tier.features.find((x) => x.key === key);
      expect(f, `expected feature ${key} to be declared on the tier`).toBeDefined();
      expect(f!.included, `${key} must be EXCLUDED from a Capavate founder tier`).toBe(false);
    }
  });

  it("declares a feature matrix with included flags (all flags boolean)", () => {
    authorPricingTier({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: ADMIN_SET_ANNUAL_MINOR });
    const tier = PRICING_TIERS[0]!;
    expect(tier.features.length).toBeGreaterThan(0);
    for (const f of tier.features) {
      expect(f.label).toBeTruthy();
      expect(typeof f.included).toBe("boolean");
    }
  });

  it("includes the core Capavate features as ENABLED", () => {
    authorPricingTier({ slug: "capavate-annual", name: "Capavate Annual", annualMinor: ADMIN_SET_ANNUAL_MINOR });
    const tier = PRICING_TIERS[0]!;
    for (const key of CAPAVATE_CORE_FEATURE_KEYS) {
      const f = tier.features.find((x) => x.key === key);
      expect(f, `expected feature ${key} on tier`).toBeDefined();
      expect(f!.included).toBe(true);
    }
  });
});
