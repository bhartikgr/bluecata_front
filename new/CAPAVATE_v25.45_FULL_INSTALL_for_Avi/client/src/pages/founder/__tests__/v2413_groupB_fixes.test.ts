/**
 * v23.4.13 GROUP B regression guards
 *
 * B.1 — L-007: AuthRedeemPage reads token from URL (window.location.search) + manual paste
 * B.2 — L-008: investor portal gate on signup page
 * B.3 — B-401: ApplyToCollective uses session founderId + surfaces errors
 * B.4 — L-002: NewCompanyDialog invalidates /api/auth/me
 * B.5 — L-004: Entity type dropdown includes Canadian province-specific options
 * B.6 — L-005: Save profile validation shows count + scrolls to first error
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REDEEM_SRC = readFileSync(resolve(__dirname, "../../auth/Redeem.tsx"), "utf8");
const SIGNUP_SRC = readFileSync(resolve(__dirname, "../../auth/Signup.tsx"), "utf8");
const APPLY_COLLECTIVE_SRC = readFileSync(
  resolve(__dirname, "../ApplyToCollective.tsx"),
  "utf8",
);
const NEW_COMPANY_DIALOG_SRC = readFileSync(
  resolve(__dirname, "../../../components/NewCompanyDialog.tsx"),
  "utf8",
);
const ENUMS_SRC = readFileSync(
  resolve(__dirname, "../../../lib/profile/data/enums.ts"),
  "utf8",
);
const COMPANY_SRC = readFileSync(resolve(__dirname, "../Company.tsx"), "utf8");

// ---- B.1 L-007: AuthRedeemPage token fix -----------------------------------

describe("v23.4.13 B.1 — L-007: Redeem reads URL token from search params", () => {
  it("has marker L-007 fix v23.4.13", () => {
    expect(REDEEM_SRC).toContain("L-007 fix v23.4.13");
  });

  it("uses window.location.search (not hash) to read token", () => {
    expect(REDEEM_SRC).toContain("window.location.search");
    // Must NOT still use the old hash-based approach
    expect(REDEEM_SRC).not.toContain("window.location.hash.split");
  });

  it("has manual paste field for users without email link", () => {
    expect(REDEEM_SRC).toContain('data-testid="input-manual-token"');
    expect(REDEEM_SRC).toContain('data-testid="button-redeem-manual-token"');
  });

  it("manualToken state is declared", () => {
    expect(REDEEM_SRC).toContain("manualToken");
    expect(REDEEM_SRC).toContain("setManualToken");
  });

  it("effectiveToken uses manualToken as fallback", () => {
    expect(REDEEM_SRC).toContain("manualTokenSubmitted");
    expect(REDEEM_SRC).toMatch(/const token = .+urlToken/);
  });
});

// ---- B.2 L-008: investor signup gate ----------------------------------------

describe("v23.4.13 B.2 — L-008: investor portal gate on signup page", () => {
  it("has marker L-008 fix v23.4.13", () => {
    expect(SIGNUP_SRC).toContain("L-008 fix v23.4.13");
  });

  it("reads portal query param from window.location.search", () => {
    expect(SIGNUP_SRC).toContain("window.location.search");
    expect(SIGNUP_SRC).toMatch(/portal.*URLSearchParams|URLSearchParams.*portal/);
  });

  it("shows investor gate card when portal=investor", () => {
    expect(SIGNUP_SRC).toContain('data-testid="text-investor-gate"');
    expect(SIGNUP_SRC).toContain("Investors join Capavate by invitation only");
  });

  it("isInvestorPortal flag checks portal === investor", () => {
    expect(SIGNUP_SRC).toContain('portalParam === "investor"');
    expect(SIGNUP_SRC).toContain("isInvestorPortal");
  });

  it("investor gate renders sign-in and onboarding links", () => {
    expect(SIGNUP_SRC).toContain('data-testid="link-investor-login"');
    expect(SIGNUP_SRC).toContain('data-testid="link-onboarding"');
  });
});

// ---- B.3 B-401: ApplyToCollective session founderId -------------------------

describe("v23.4.13 B.3 — B-401: ApplyToCollective uses session founderId", () => {
  it("has marker B-401 fix v23.4.13", () => {
    expect(APPLY_COLLECTIVE_SRC).toContain("B-401 fix v23.4.13");
  });

  it("queries /api/auth/me for session founderId", () => {
    expect(APPLY_COLLECTIVE_SRC).toContain('"/api/auth/me"');
    expect(APPLY_COLLECTIVE_SRC).toContain("sessionFounderId");
  });

  it("PathB mutation passes founderId from session", () => {
    // meId must come from session, not a stale form default
    expect(APPLY_COLLECTIVE_SRC).toContain("meId || companyId");
  });

  it("PathB has onError handler that shows toast", () => {
    expect(APPLY_COLLECTIVE_SRC).toContain("onError: (e: Error)");
    expect(APPLY_COLLECTIVE_SRC).toContain("Application failed");
  });

  it("meId is passed from parent to PathB", () => {
    expect(APPLY_COLLECTIVE_SRC).toContain("meId={sessionFounderId}");
  });
});

// ---- B.4 L-002: NewCompanyDialog invalidates auth/me -----------------------

describe("v23.4.13 B.4 — L-002: NewCompanyDialog invalidates /api/auth/me", () => {
  it("has marker L-002 fix v23.4.13", () => {
    expect(NEW_COMPANY_DIALOG_SRC).toContain("L-002 fix v23.4.13");
  });

  it("invalidates /api/auth/me in onSuccess", () => {
    expect(NEW_COMPANY_DIALOG_SRC).toContain('"/api/auth/me"');
  });
});

// ---- B.5 L-004: Entity type Canadian options --------------------------------

describe("v23.4.13 B.5 — L-004: entity type dropdown includes Canadian options", () => {
  it("has marker L-004 fix v23.4.13", () => {
    expect(ENUMS_SRC).toContain("L-004 fix v23.4.13");
  });

  it("includes CA — Ontario Corporation", () => {
    expect(ENUMS_SRC).toContain("ca_inc_on");
    expect(ENUMS_SRC).toContain("Ontario Corporation");
  });

  it("includes CA — BC Corporation", () => {
    expect(ENUMS_SRC).toContain("ca_inc_bc");
    expect(ENUMS_SRC).toContain("BC Corporation");
  });

  it("includes CA — LP", () => {
    expect(ENUMS_SRC).toContain("ca_lp");
  });

  it("includes CA — Sole Proprietorship", () => {
    expect(ENUMS_SRC).toContain("ca_sole_prop");
    expect(ENUMS_SRC).toContain("Sole Proprietorship");
  });

  it("CA array in entityTypesForCountry includes new values", () => {
    expect(ENUMS_SRC).toContain('"ca_inc_on"');
    expect(ENUMS_SRC).toContain('"ca_inc_bc"');
    expect(ENUMS_SRC).toContain('"ca_sole_prop"');
  });
});

// ---- B.6 L-005: Save profile validation feedback ----------------------------

describe("v23.4.13 B.6 — L-005: save profile validation feedback", () => {
  it("has marker L-005 fix v23.4.13", () => {
    expect(COMPANY_SRC).toContain("L-005 fix v23.4.13");
  });

  it("button-save-profile is no longer disabled by isProfileValid", () => {
    // Old pattern was: disabled={!legalConsentChecked || !isProfileValid}
    // New: disabled={false}
    expect(COMPANY_SRC).toContain("disabled={false}");
  });

  it("shows missing count text near button", () => {
    expect(COMPANY_SRC).toContain('data-testid="text-save-missing-count"');
  });

  it("scrolls to first missing field on click", () => {
    expect(COMPANY_SRC).toContain("scrollIntoView");
  });
});
