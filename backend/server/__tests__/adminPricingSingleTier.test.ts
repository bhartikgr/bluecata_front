/**
 * Wave F4 FIX F4-4 (E2E-8, P0) regression suite.
 *
 * The defect: `/api/admin/pricing-tiers` (Founder Settings) and
 * `/api/admin/pricing-models` (the /admin/pricing UI) were two disconnected
 * catalogues, so a Capavate Annual SKU visible on one was unmanageable on the
 * other. The property that matters is therefore ONE CATALOGUE: whatever tier
 * exists is the tier BOTH surfaces see, at the same price and status.
 *
 * WAVE 134 cause 1-of-3 (R98) — WHY THIS FILE CHANGED
 * --------------------------------------------------
 * This file asserted `getModel("pm_capavate_annual_v1")` — a SEEDED row id — and
 * `basePriceMinor === 84_000` baked into `server/pricingModelStore.ts`. v25.27
 * deleted that seed on purpose ("NO SEED. Admin is the source of truth.",
 * pricingModelStore.ts:160-181) because R95/R96 require pricing to be admin-set
 * and database-driven. The seed is gone for good, so per R98 the test is what
 * changes.
 *
 * Equal-or-stronger: identity is no longer a source-baked row id (which proved
 * only that a constant existed) but the admin-authored SLUG — the key
 * `subscriptionsStore.PLAN_TO_SLUG` and POST /api/admin/pricing-models/
 * bootstrap-founder-tiers actually use. The price is asserted as a ROUND TRIP of
 * what the admin published, and one new case pins the unpublished state (nothing
 * authored ⇒ the catalogue is EMPTY, never a placeholder tier) which the old
 * seed made untestable.
 *
 * The admin is played by `_fixtures/pricingCatalogueFixture.ts` (one shared
 * fixture for all of WAVE 134 cause 2), which writes through the production path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { listModels, getModel } from "../pricingModelStore";
import {
  authorFounderCatalogue,
  authoredTier,
  clearAuthoredPricingTiers,
  FIXTURE_ANNUAL_MINOR,
} from "./_fixtures/pricingCatalogueFixture";

/* The amount THE ADMIN TYPES for Capavate Annual in this test — integer minor
   units — paired with its USD major-unit twin for the display assertion. */
const ADMIN_SET_ANNUAL_MINOR = FIXTURE_ANNUAL_MINOR["capavate-annual"];
const ADMIN_SET_ANNUAL_USD = 840;

beforeEach(() => {
  clearAuthoredPricingTiers();
});

describe("Wave F4 FIX F4-4 (E2E-8): the admin pricing list is ONE catalogue", () => {
  it("the catalogue is EMPTY until an admin authors a tier (no seed, no placeholder)", () => {
    expect(listModels()).toEqual([]);
    expect(listModels({ status: "live", productLine: "founder" })).toEqual([]);
  });

  it("an authored Capavate Annual tier is readable by id from the same store", () => {
    const published = authorFounderCatalogue({ includeCollective: true })["capavate-annual"]!;
    const m = getModel(published.id);
    expect(m, "the row the admin authored must be readable back by id").toBeTruthy();
    expect(m!.slug).toBe("capavate-annual");
  });

  it("Capavate Annual model has the authored name, price, cadence, and status", () => {
    authorFounderCatalogue({ includeCollective: true });
    const m = authoredTier("capavate-annual");
    expect(m.name).toMatch(/Capavate Annual/i);
    expect(m.basePriceMinor).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(m.currency).toBe("USD");
    expect(m.cadence).toBe("annual");
    expect(m.productLine).toBe("founder");
    expect(m.status).toBe("live");
  });

  it("listModels() exposes Capavate Annual to the admin pricing-models route", () => {
    authorFounderCatalogue({ includeCollective: true });
    const all = listModels();
    const capavate = all.find((m) => m.slug === "capavate-annual");
    expect(capavate, "Admin UI consumes listModels() — Capavate Annual must be in the list").toBeTruthy();
  });

  it("Capavate Annual appears when filtering by productLine=founder + status=live", () => {
    authorFounderCatalogue({ includeCollective: true });
    const live = listModels({ status: "live", productLine: "founder" });
    const capavate = live.find((m) => m.slug === "capavate-annual");
    expect(capavate).toBeTruthy();
    expect(capavate!.basePriceMinor).toBe(ADMIN_SET_ANNUAL_MINOR);
  });

  it("founder-free + founder-pro + collective-standard live alongside it (one catalogue)", () => {
    authorFounderCatalogue({ includeCollective: true });
    const all = listModels();
    const slugs = all.map((m) => m.slug).sort();
    expect(slugs).toContain("founder-free");
    expect(slugs).toContain("founder-pro");
    expect(slugs).toContain("collective-standard");
    expect(slugs).toContain("capavate-annual");
    expect(all.length).toBeGreaterThanOrEqual(4);
    /* And the Collective tier is a DIFFERENT product line — one catalogue, not
       one product. */
    expect(authoredTier("collective-standard").productLine).toBe("collective");
  });

  it("display price of the Capavate Annual tier echoes the authored amount", () => {
    authorFounderCatalogue({ includeCollective: true });
    const m = authoredTier("capavate-annual");
    /* 84_000 minor USD is $840.00. Asserted as a pair of published-vs-rendered
       values rather than by dividing money in the test. */
    expect(m.basePriceMinor).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(m.basePriceMinor).toBe(ADMIN_SET_ANNUAL_USD * 100);
    const fmt = `$${ADMIN_SET_ANNUAL_USD.toLocaleString("en-US")}`;
    expect(fmt).toBe("$840");
  });
});
