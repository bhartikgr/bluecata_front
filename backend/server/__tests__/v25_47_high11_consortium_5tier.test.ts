/**
 * v25.47 APD-030 (HIGH-11) — Consortium Partner 5-tier taxonomy.
 *
 * Coverage:
 *   1. PARTNER_TIERS is the canonical 5-tier order with correct seed amounts.
 *   2. resolvePartnerTierSlug maps legacy partner_basic/pro/enterprise → canonical.
 *   3. resolvePartnerTierSlug returns null for unknown slugs (fail-closed).
 *   4. resolveConsortiumPricing reads DB amounts and flags founding_member
 *      invite-only at $0.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import {
  PARTNER_TIERS,
  resolvePartnerTierSlug,
  resolveConsortiumPricing,
} from "../lib/partnerTiers";

beforeAll(() => {
  getDb();
});

describe("APD-030 consortium 5-tier taxonomy", () => {
  it("exposes the canonical 5-tier order with seed amounts", () => {
    expect(PARTNER_TIERS.map((t) => t.slug)).toEqual([
      "catalyst",
      "builder",
      "amplifier",
      "nexus",
      "founding_member",
    ]);
    const byslug = Object.fromEntries(PARTNER_TIERS.map((t) => [t.slug, t]));
    expect(byslug.catalyst.fallbackMinor).toBe(49900);
    expect(byslug.builder.fallbackMinor).toBe(99900);
    expect(byslug.amplifier.fallbackMinor).toBe(149900);
    expect(byslug.nexus.fallbackMinor).toBe(499900);
    expect(byslug.founding_member.fallbackMinor).toBe(0);
  });

  it("maps legacy partner_* slugs onto canonical tiers", () => {
    expect(resolvePartnerTierSlug("partner_basic")).toBe("catalyst");
    expect(resolvePartnerTierSlug("partner_pro")).toBe("builder");
    expect(resolvePartnerTierSlug("partner_enterprise")).toBe("amplifier");
    expect(resolvePartnerTierSlug("catalyst")).toBe("catalyst");
    expect(resolvePartnerTierSlug("nexus")).toBe("nexus");
  });

  it("returns null for unknown slugs (fail-closed)", () => {
    expect(resolvePartnerTierSlug("platinum")).toBeNull();
    expect(resolvePartnerTierSlug("")).toBeNull();
    expect(resolvePartnerTierSlug(undefined)).toBeNull();
    expect(resolvePartnerTierSlug(42 as unknown)).toBeNull();
  });

  it("resolveConsortiumPricing reads DB amounts; founding_member invite-only $0", () => {
    const pricing = resolveConsortiumPricing();
    expect(pricing.map((t) => t.slug)).toEqual([
      "catalyst",
      "builder",
      "amplifier",
      "nexus",
      "founding_member",
    ]);
    const fm = pricing.find((t) => t.slug === "founding_member")!;
    expect(fm.amountMinor).toBe(0);
    expect(fm.inviteOnly).toBe(true);
    const catalyst = pricing.find((t) => t.slug === "catalyst")!;
    expect(catalyst.amountMinor).toBe(49900);
    expect(catalyst.fromDb).toBe(true);
  });
});
