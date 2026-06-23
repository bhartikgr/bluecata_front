/**
 * Sprint 10 — Collective Application tests.
 *
 *   • Eligibility passes when an investor portfolio exists (preview model)
 *   • Schema rejects invalid thesis / check / sectors / accreditation
 *   • Schema accepts a complete payload
 *   • Min/max check ordering enforced
 */
import { describe, it, expect } from "vitest";
import { isEligibleForCollective } from "../collectiveAppStore";
import { collectiveApplicationSchema } from "../../shared/schema";

describe("isEligibleForCollective", () => {
  // v24.0 C12: eligibility no longer falls back to the investorPortfolio /
  // currentInvestor MOCK. When no LIVE membership data is available the caller
  // is ineligible with reason "no_portfolio_data" (not synthetic signals).
  it("returns eligible=false + no_portfolio_data when no live membership exists", () => {
    const r = isEligibleForCollective("u_investor_demo");
    expect(r.eligible).toBe(false);
    expect(r.passes.investorOnCapTable).toBe(false);
    expect(r.reasons).toContain("no_portfolio_data");
  });

  it("anonymous / undefined caller is ineligible (no_portfolio_data)", () => {
    const r = isEligibleForCollective(undefined);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no_portfolio_data");
  });
});

describe("collectiveApplicationSchema", () => {
  const valid = {
    thesis: "Backing technical founders building infrastructure for cross-border fintech.",
    minCheckUsd: 25_000,
    maxCheckUsd: 250_000,
    sectors: ["Fintech"],
    stages: ["Seed"],
    geoFocus: ["North America"],
    memberTier: "silver",
    referralCode: "",
    passportFilename: "passport.pdf",
    proofOfAddressFilename: "utility.pdf",
    additionalDocs: [],
    jurisdiction: "US",
    accreditationDeclaration: "I qualify under SEC 501(a)…",
    paymentMethod: "card_mock",
    cardholderName: "Ozan Isinak",
  };

  it("accepts a fully populated valid payload", () => {
    const r = collectiveApplicationSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects when thesis is too short", () => {
    const r = collectiveApplicationSchema.safeParse({ ...valid, thesis: "too short" });
    expect(r.success).toBe(false);
  });

  it("rejects min check below $5,000", () => {
    const r = collectiveApplicationSchema.safeParse({ ...valid, minCheckUsd: 1_000 });
    expect(r.success).toBe(false);
  });

  it("rejects when max check < min check", () => {
    const r = collectiveApplicationSchema.safeParse({ ...valid, minCheckUsd: 500_000, maxCheckUsd: 100_000 });
    expect(r.success).toBe(false);
  });

  it("rejects empty sectors / stages / geoFocus", () => {
    expect(collectiveApplicationSchema.safeParse({ ...valid, sectors: [] }).success).toBe(false);
    expect(collectiveApplicationSchema.safeParse({ ...valid, stages: [] }).success).toBe(false);
    expect(collectiveApplicationSchema.safeParse({ ...valid, geoFocus: [] }).success).toBe(false);
  });

  it("rejects unknown jurisdiction", () => {
    const r = collectiveApplicationSchema.safeParse({ ...valid, jurisdiction: "ZZ" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown payment method", () => {
    const r = collectiveApplicationSchema.safeParse({ ...valid, paymentMethod: "bitcoin" });
    expect(r.success).toBe(false);
  });
});
