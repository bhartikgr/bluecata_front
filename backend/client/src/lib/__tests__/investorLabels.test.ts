/**
 * W1P — unit tests for the pure investor display helpers.
 *
 * Covers the Batch 1 label maps (notification kind, KYC variant) and the
 * Batch 2 templating helpers (roundPhrase, nonEmpty), plus the rule #13
 * identity guards shared by BUG-01/02/21.
 */
import { describe, it, expect } from "vitest";
import {
  notificationKindLabel,
  kycVariantLabel,
  roundPhrase,
  nonEmpty,
  fullLegalName,
  greetingName,
  safeInitials,
  safeMemberName,
  looksLikeEmail,
} from "../investorLabels";

describe("notificationKindLabel (BUG-28)", () => {
  it("humanizes known enum chips", () => {
    expect(notificationKindLabel("round_update")).toBe("Round update");
    expect(notificationKindLabel("all")).toBe("All");
    expect(notificationKindLabel("invitation")).toBe("Invitation");
    expect(notificationKindLabel("collective")).toBe("Collective");
  });
  it("title-cases unknown raw enums as a fallback", () => {
    expect(notificationKindLabel("deal_closed")).toBe("Deal Closed");
    expect(notificationKindLabel("foo")).toBe("Foo");
  });
});

describe("kycVariantLabel (BUG-24)", () => {
  it("humanizes the generic variant via the canonical option label", () => {
    expect(kycVariantLabel("generic")).toBe("Other — generic KYC + AML");
  });
  it("humanizes a jurisdiction-specific variant", () => {
    expect(kycVariantLabel("us_reg_d_506c")).toBe("US — Reg D 506(c) third-party verification");
  });
  it("title-cases unknown variants instead of leaking the raw enum", () => {
    expect(kycVariantLabel("mars_special")).toBe("Mars Special");
  });
  it("renders an em-dash for empty input", () => {
    expect(kycVariantLabel("")).toBe("—");
    expect(kycVariantLabel(null)).toBe("—");
    expect(kycVariantLabel(undefined)).toBe("—");
  });
});

describe("roundPhrase (BUG-09/10/19)", () => {
  it("returns the round name as-is without appending ' round'", () => {
    expect(roundPhrase("Seed")).toBe("Seed");
    expect(roundPhrase("Series A")).toBe("Series A");
  });
  it("does not double the word 'round' for names that already contain it", () => {
    expect(roundPhrase("TEST ROUND")).toBe("TEST ROUND");
    expect(roundPhrase("TEST ROUND")).not.toMatch(/round\s+round/i);
  });
  it("falls back to a stable phrase when empty", () => {
    expect(roundPhrase("")).toBe("the round");
    expect(roundPhrase("   ")).toBe("the round");
    expect(roundPhrase(undefined)).toBe("the round");
    expect(roundPhrase(null)).toBe("the round");
  });
});

describe("nonEmpty (BUG-19/20)", () => {
  it("returns the value when non-blank", () => {
    expect(nonEmpty("Acme", "this company")).toBe("Acme");
  });
  it("returns the fallback when blank/nullish", () => {
    expect(nonEmpty("", "this company")).toBe("this company");
    expect(nonEmpty("   ", "this company")).toBe("this company");
    expect(nonEmpty(null, "the company")).toBe("the company");
    expect(nonEmpty(undefined, "the company")).toBe("the company");
  });
});

describe("looksLikeEmail", () => {
  it("detects emails", () => {
    expect(looksLikeEmail("a@b.com")).toBe(true);
    expect(looksLikeEmail("Jane Doe")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail(null)).toBe(false);
  });
});

describe("fullLegalName (BUG-21, rule #13)", () => {
  it("returns a genuine full legal name", () => {
    expect(fullLegalName("Jane Doe")).toBe("Jane Doe");
    expect(fullLegalName("  Mary Jane Watson ")).toBe("Mary Jane Watson");
  });
  it("returns empty for a lone first name (no last name)", () => {
    expect(fullLegalName("Jane")).toBe("");
  });
  it("never surfaces an email or placeholder", () => {
    expect(fullLegalName("jane@firm.com")).toBe("");
    expect(fullLegalName("New")).toBe("");
    expect(fullLegalName("New User")).toBe("");
    expect(fullLegalName("")).toBe("");
    expect(fullLegalName(null)).toBe("");
  });
});

describe("greetingName (BUG-01)", () => {
  it("prefers a safe screen name", () => {
    expect(greetingName("Janey", "Jane Doe")).toBe("Janey");
  });
  it("falls back to the first token of a real name", () => {
    expect(greetingName(undefined, "Jane Doe")).toBe("Jane");
  });
  it("never surfaces an email or 'New' placeholder", () => {
    expect(greetingName(undefined, "jane@firm.com")).toBe("there");
    expect(greetingName("New", "New User")).toBe("there");
    expect(greetingName(undefined, undefined)).toBe("there");
    expect(greetingName(undefined, undefined, "investor")).toBe("investor");
  });
});

describe("safeInitials (BUG-02)", () => {
  it("derives up to two initials from a full name", () => {
    expect(safeInitials("Jane Doe")).toBe("JD");
    expect(safeInitials("Mary Jane Watson")).toBe("MJ");
  });
  it("uses a single initial for a lone name", () => {
    expect(safeInitials("Jane")).toBe("J");
  });
  it("never derives initials from an email or placeholder", () => {
    expect(safeInitials("jane@firm.com")).toBe("");
    expect(safeInitials("New User")).toBe("");
    expect(safeInitials("")).toBe("");
    expect(safeInitials(null)).toBe("");
  });
});

describe("safeMemberName (GROUP-D, rule #13)", () => {
  it("returns a real name when present and non-raw", () => {
    expect(safeMemberName("Jane Doe", "jane@firm.com", "u_123")).toBe("Jane Doe");
    expect(safeMemberName("  Mary Watson ", null, "u_abc")).toBe("Mary Watson");
  });
  it("falls back to email when the name is null/empty", () => {
    expect(safeMemberName(null, "jane@firm.com", "u_123")).toBe("jane@firm.com");
    expect(safeMemberName("", "jane@firm.com", "u_123")).toBe("jane@firm.com");
    expect(safeMemberName("   ", "jane@firm.com", "u_123")).toBe("jane@firm.com");
  });
  it("returns 'Pending member' when both name and email are absent — never a u_ id", () => {
    expect(safeMemberName(null, null, "u_redeemed_123")).toBe("Pending member");
    expect(safeMemberName("", "", "u_redeemed_123")).toBe("Pending member");
    expect(safeMemberName(null, null, "u_redeemed_123")).not.toMatch(/^u_/);
  });
  it("NEVER returns a raw synthetic id even if one is passed as the name", () => {
    expect(safeMemberName("u_redeemed_123", null, "u_redeemed_123")).not.toMatch(/^u_/);
    expect(safeMemberName("u_redeemed_123", null, "u_redeemed_123")).toBe("Pending member");
    expect(safeMemberName("u_redeemed_123", "jane@firm.com", "u_redeemed_123")).toBe("jane@firm.com");
  });
});
