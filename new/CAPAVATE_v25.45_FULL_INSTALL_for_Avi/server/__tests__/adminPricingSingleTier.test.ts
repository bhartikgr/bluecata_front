/**
 * Wave F4 FIX F4-4 (E2E-8, P0) regression suite.
 *
 * Proves the Capavate Annual canonical tier ($840/yr) is present in the
 * `/api/admin/pricing-models` list (the source of the /admin/pricing UI).
 *
 * Before this fix: only `Founder Free`, `Founder Pro`, and
 * `Collective Standard` were seeded; the admin UI could not surface or
 * manage the Capavate Annual SKU even though `/api/admin/pricing-tiers`
 * (a separate read API consumed by the Founder Settings page) advertised
 * the $840 tier in `adminPricingStore.ts`. The two stores were
 * inconsistent.
 *
 * After this fix: the canonical `pm_capavate_annual_v1` row is seeded in
 * `server/pricingModelStore.ts` with `productLine: "founder"`,
 * `status: "live"`, `basePriceMinor: 84_000`, and surfaces in the admin
 * pricing-models list.
 */
import { describe, it, expect } from "vitest";
import { listModels, getModel } from "../pricingModelStore";

describe("Wave F4 FIX F4-4 (E2E-8): admin pricing list contains Capavate Annual $840", () => {
  it("seeded model with id pm_capavate_annual_v1 exists", () => {
    const m = getModel("pm_capavate_annual_v1");
    expect(m, "Capavate Annual seed must exist").toBeTruthy();
  });

  it("Capavate Annual model has correct name, price, cadence, and status", () => {
    const m = getModel("pm_capavate_annual_v1");
    expect(m).toBeTruthy();
    if (!m) return;
    expect(m.name).toMatch(/Capavate Annual/i);
    expect(m.basePriceMinor).toBe(84_000); // $840.00
    expect(m.currency).toBe("USD");
    expect(m.cadence).toBe("annual");
    expect(m.productLine).toBe("founder");
    expect(m.status).toBe("live");
  });

  it("listModels() exposes Capavate Annual to the admin pricing-models route", () => {
    const all = listModels();
    const capavate = all.find((m) => m.slug === "capavate-annual");
    expect(capavate, "Admin UI consumes listModels() — Capavate Annual must be in the list").toBeTruthy();
  });

  it("Capavate Annual appears when filtering by productLine=founder + status=live", () => {
    const live = listModels({ status: "live", productLine: "founder" });
    const capavate = live.find((m) => m.slug === "capavate-annual");
    expect(capavate).toBeTruthy();
    expect(capavate!.basePriceMinor).toBe(84_000);
  });

  it("legacy founder-free + founder-pro + collective-standard seeds are preserved (no regression)", () => {
    const all = listModels();
    const slugs = all.map((m) => m.slug).sort();
    expect(slugs).toContain("founder-free");
    expect(slugs).toContain("founder-pro");
    expect(slugs).toContain("collective-standard");
    expect(slugs).toContain("capavate-annual");
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("display price of the Capavate Annual tier formats to $840 USD", () => {
    const m = getModel("pm_capavate_annual_v1");
    expect(m).toBeTruthy();
    if (!m) return;
    const dollars = m.basePriceMinor / 100;
    expect(dollars).toBe(840);
    const fmt = `$${dollars.toLocaleString("en-US")}`;
    expect(fmt).toBe("$840");
  });
});
