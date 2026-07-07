/**
 * v25.53 Round-management fix wave — client source-level regression guards.
 *
 * Following the repo convention (see RoundDetail.invite-send.test.ts), these
 * assert the wiring at the source level so a later refactor that drops a guard
 * fails loudly. They cover the client-only halves of the brief:
 *   1a/N2/N3 — RoundNew Step-2 per-vehicle required-field validation blocks
 *              Continue/Create and renders inline errors (incl. PPS>0 for common).
 *   N4       — RoundNew rejects a malformed (non-4-digit) year and blocks past dates.
 *   N1       — RoundNew forwards strikePrice/expiryYears so warrants persist.
 *   5a       — Rounds edit-terms money fields use a thousands-separated MoneyInput.
 *   4a       — Rounds edit-terms carries the Target-close date.
 *   7a       — RoundDetail invite requires First + Last + Email before Send.
 *   8a       — RoundDetail invite collects optional Company/Stage/Market fields.
 *   N6       — Redeem shows a sign-in CTA (no password form) for existing accounts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const roundNew = readFileSync(resolve(__dirname, "../RoundNew.tsx"), "utf8");
const rounds = readFileSync(resolve(__dirname, "../Rounds.tsx"), "utf8");
const roundDetail = readFileSync(resolve(__dirname, "../RoundDetail.tsx"), "utf8");
const redeem = readFileSync(resolve(__dirname, "../../auth/Redeem.tsx"), "utf8");

describe("v25.53 1a/N2/N3 — RoundNew Step-2 required-field validation", () => {
  it("computes a step2Errors map and a step2Valid boolean", () => {
    expect(roundNew).toContain("const step2Errors");
    expect(roundNew).toContain("const step2Valid = Object.keys(step2Errors).length === 0");
  });

  it("Continue is blocked on Step 2 until valid", () => {
    expect(roundNew).toMatch(/disabled=\{\(step === 2 && !step2Valid\)/);
  });

  it("Create is blocked while Step-2 invalid or the schedule is invalid", () => {
    expect(roundNew).toMatch(/disabled=\{createRoundMut\.isPending \|\| scheduleInvalid \|\| !step2Valid\}/);
  });

  it("N3 — price-per-share must be > 0 (validated at Step 2, not only Step 5)", () => {
    expect(roundNew).toContain("Price per share is required and must be greater than 0.");
  });

  it("renders inline field errors for each vehicle's mandatory terms", () => {
    for (const id of ["err-targetAmount", "err-pricePerShare", "err-sharesAuthorized", "err-valuationCap", "err-strikePrice", "err-expiryYears", "err-poolSize"]) {
      expect(roundNew).toContain(`data-testid="${id}"`);
    }
  });
});

describe("v25.53 N4 / 3a — RoundNew date guards", () => {
  it("has a 4-digit-year guard and past-date guards", () => {
    expect(roundNew).toContain("const badYear");
    expect(roundNew).toContain("const dayInPast");
    expect(roundNew).toContain("const scheduleInvalid");
  });

  it("Continue on Step 3 is blocked when the schedule is invalid", () => {
    expect(roundNew).toMatch(/\(step === 3 && scheduleInvalid\)/);
  });
});

describe("v25.53 N1 — RoundNew forwards warrant terms so they persist", () => {
  it("payload includes strikePrice and expiryYears", () => {
    expect(roundNew).toContain("strikePrice:");
    expect(roundNew).toContain("expiryYears:");
  });
});

describe("v25.53 5a / 4a — Rounds edit-terms money formatting + close date", () => {
  it("defines a thousands-separating MoneyInput", () => {
    expect(rounds).toContain("function MoneyInput");
    expect(rounds).toContain("function formatMoney");
  });

  it("money fields use MoneyInput (not raw number inputs)", () => {
    for (const id of ["input-target", "input-min-ticket", "input-pre-money", "input-post-money", "input-pps", "input-valuation-cap"]) {
      expect(rounds).toMatch(new RegExp(`<MoneyInput[^>]*data-testid="${id}"`));
    }
  });

  it("4a — edit-terms carries the Target-close date through to the PATCH", () => {
    expect(rounds).toContain("useState(round.closeDate)");
    expect(rounds).toContain("closeDate");
    expect(rounds).toContain('data-testid="input-close-date"');
  });
});

describe("v25.53 7a / 8a — RoundDetail invite form", () => {
  it("7a — Send is blocked unless First, Last and Email are all filled", () => {
    expect(roundDetail).toContain("inviteFirstName.trim()");
    expect(roundDetail).toContain("inviteLastName.trim()");
    expect(roundDetail).toMatch(/inviteFirstName\.trim\(\) && inviteLastName\.trim\(\)/);
  });

  it("7a — First and Last labels are marked mandatory", () => {
    expect(roundDetail).toContain('data-testid="input-invite-last-name"');
    expect(roundDetail).toMatch(/Last name\s*<span[^>]*>\*<\/span>/);
  });

  it("8a — optional Company / Stage focus / Typical market size inputs exist and are forwarded", () => {
    for (const id of ["input-invite-company", "input-invite-stage-focus", "input-invite-market-size"]) {
      expect(roundDetail).toContain(`data-testid="${id}"`);
    }
    expect(roundDetail).toContain("investorCompany:");
    expect(roundDetail).toContain("stageFocus:");
    expect(roundDetail).toContain("typicalMarketSize:");
  });
});

describe("v25.53 N6 — Redeem offers sign-in (no password) for existing accounts", () => {
  it("reads the existingAccount flag from the preview", () => {
    expect(redeem).toContain("existingAccount");
    expect(redeem).toContain("previewQ.data!.existingAccount === true");
  });

  it("renders a sign-in CTA instead of the password-set form when existing", () => {
    expect(redeem).toContain('data-testid="button-redeem-existing-signin"');
    expect(redeem).toContain("Sign in to view this round");
  });
});

describe("v25.53 REVISE B1 — Redeem consumes the token via an authenticated round-trip", () => {
  it("the existing-account CTA POSTs the require-auth redeem (continue:true), not a password-set", () => {
    // redeemExisting posts { token, continue: true } — no password/agreedToTerms.
    expect(redeem).toContain("redeemExisting");
    expect(redeem).toMatch(/apiRequest\(\s*"POST",\s*"\/api\/auth\/redeem",\s*\{\s*token,\s*continue:\s*true\s*\}\s*\)/);
  });

  it("follows the server's requiresLogin redirect (login honors returnTo, NOT next)", () => {
    expect(redeem).toContain("requiresLogin");
    expect(redeem).toContain("navigate(json.redirectTo)");
    // The old `next=`-based sign-in href must be gone — Login only honors returnTo.
    expect(redeem).not.toContain("next=");
  });

  it("auto-fires exactly once on the post-login return trip (continue=1)", () => {
    expect(redeem).toContain('.get("continue") === "1"');
    expect(redeem).toContain("continueFlag");
    expect(redeem).toContain("autoFired");
    // Guarded so it can only fire a single time for an existing, non-team invite.
    expect(redeem).toMatch(/if\s*\(autoFired\)\s*return/);
    expect(redeem).toMatch(/d\?\.existingAccount && d\.invitation\.kind !== "team" && continueFlag/);
  });

  it("shows a finishing state (not the button) while the auto-consume is in flight", () => {
    expect(redeem).toContain('data-testid="text-redeem-finishing"');
  });
});
