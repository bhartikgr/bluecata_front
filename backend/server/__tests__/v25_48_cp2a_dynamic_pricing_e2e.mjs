/**
 * v25.48 CP-2a — consortium /consortium/pricing is FULLY DYNAMIC: it iterates
 * the LIVE DB tiers (listTiers), so an admin soft-delete HIDES a tier and an
 * admin-added tier APPEARS. CP-2b — resolveChargeTier reads the SAME advertised
 * row (single source of truth).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db/connection.ts";
import {
  CONSORTIUM_SUBSCRIPTION_PREFIX,
  upsertTier,
  softDeleteTier,
} from "../subscriptionTierStore.ts";
import { resolveConsortiumPricing, resolveChargeTier } from "../lib/partnerTiers.ts";

beforeAll(() => { getDb(); });

describe("v25.48 CP-2a consortium pricing fully dynamic", () => {
  it("admin-added tier APPEARS on the pricing surface", () => {
    upsertTier({ prefix: CONSORTIUM_SUBSCRIPTION_PREFIX, slug: "cp2a_newtier", amountMinor: 79900, currency: "USD", updatedByUserId: "u_admin", billingPeriod: "monthly" });
    const pricing = resolveConsortiumPricing();
    const added = pricing.find((t) => t.slug === "cp2a_newtier");
    expect(added).toBeTruthy();
    expect(added.amountMinor).toBe(79900);
    expect(added.fromDb).toBe(true);
  });

  it("admin soft-delete HIDES a tier from the pricing surface", () => {
    upsertTier({ prefix: CONSORTIUM_SUBSCRIPTION_PREFIX, slug: "cp2a_temp", amountMinor: 1000, currency: "USD", updatedByUserId: "u_admin", billingPeriod: "monthly" });
    expect(resolveConsortiumPricing().some((t) => t.slug === "cp2a_temp")).toBe(true);
    softDeleteTier(CONSORTIUM_SUBSCRIPTION_PREFIX, "cp2a_temp");
    expect(resolveConsortiumPricing().some((t) => t.slug === "cp2a_temp")).toBe(false);
  });

  it("reprice is reflected dynamically", () => {
    upsertTier({ prefix: CONSORTIUM_SUBSCRIPTION_PREFIX, slug: "catalyst", amountMinor: 49900, currency: "USD", updatedByUserId: "u_admin", billingPeriod: "monthly" });
    let catalyst = resolveConsortiumPricing().find((t) => t.slug === "catalyst");
    expect(catalyst.amountMinor).toBe(49900);
    upsertTier({ prefix: CONSORTIUM_SUBSCRIPTION_PREFIX, slug: "catalyst", amountMinor: 52900, currency: "USD", updatedByUserId: "u_admin", billingPeriod: "monthly" });
    catalyst = resolveConsortiumPricing().find((t) => t.slug === "catalyst");
    expect(catalyst.amountMinor).toBe(52900);
  });

  it("CP-2b: resolveChargeTier reads the SAME advertised row (advertised == charged)", () => {
    upsertTier({ prefix: CONSORTIUM_SUBSCRIPTION_PREFIX, slug: "builder", amountMinor: 99900, currency: "USD", updatedByUserId: "u_admin", billingPeriod: "monthly" });
    const advertised = resolveConsortiumPricing().find((t) => t.slug === "builder");
    const charge = resolveChargeTier("builder");
    expect(charge).toBeTruthy();
    expect(charge.amountMinor).toBe(advertised.amountMinor);
    // legacy alias maps to the same canonical advertised row
    const chargeLegacy = resolveChargeTier("partner_pro");
    expect(chargeLegacy?.amountMinor).toBe(advertised.amountMinor);
  });
});
