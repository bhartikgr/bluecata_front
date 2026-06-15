/**
 * 23-May Fix 2 — Legal-consent checkbox visibility regression.
 *
 * Avi reported on 22-May that the "I agree to ToS" checkbox on the signup
 * page was effectively invisible until hover. Root cause: the previous CSS
 * override was a 1px border-[hsl(219 30% 65%)] line on a transparent
 * background \u2014 against the white card it read as nothing.
 *
 * This test is a CSS-class regression guard. It does not render the page
 * (jsdom + Radix Checkbox add too much complexity for what is a styling
 * change), but it does freeze the className contract on the source file so
 * any future regression that drops the visible-border / bg-white / shadow
 * combo will fail CI.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = path.join(
  __dirname,
  "..",
  "..",
  "client",
  "src",
  "components",
  "LegalConsentCheckbox.tsx",
);

describe("23-May Fix 2 — LegalConsentCheckbox unchecked-state visibility", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("uses border-2 (not the old thin 1px border) on the checkbox", () => {
    // Negative assertion: the old light-grey 1px border must be gone.
    expect(src).not.toMatch(/border-\[hsl\(219_30%_65%\)\][^"']*data-\[state=checked\]/);
    // Positive assertion: the new 2px stronger border is present
    // (Fix 5 strengthened the saturation from 45% → 35% lightness).
    expect(src).toMatch(/border-2\s+border-\[hsl\(219_45%_35%\)\]/);
  });

  it("uses bg-white + shadow-sm so the unchecked state reads as a control", () => {
    expect(src).toMatch(/bg-white\s+shadow-sm/);
  });

  it("preserves the checked-state colour (no regression on positive affordance)", () => {
    // Checked state still uses the brand blue.
    expect(src).toMatch(/data-\[state=checked\]:bg-\[hsl\(219_45%_35%\)\]/);
    expect(src).toMatch(/data-\[state=checked\]:border-\[hsl\(219_45%_35%\)\]/);
  });

  it("forces white checkmark icon when checked (Fix 5 — prevent invisible check)", () => {
    expect(src).toMatch(/data-\[state=checked\]:text-white/);
  });

  it("uses larger h-5 w-5 hit target (Fix 5 — was h-4 w-4)", () => {
    expect(src).toMatch(/h-5\s+w-5/);
  });

  it("renders an aria-label so screen readers can find the unchecked control", () => {
    expect(src).toMatch(/aria-label="Agree to legal documents"/);
  });
});

describe("23-May Fix 5 — Signup deterministic disabled-button hint", () => {
  const SIGNUP = path.join(__dirname, "..", "..", "client", "src", "pages", "auth", "Signup.tsx");
  const src = fs.readFileSync(SIGNUP, "utf8");

  it("renders text-form-pending hint when canSubmit is false", () => {
    expect(src).toMatch(/data-testid="text-form-pending"/);
  });

  it("explicitly mentions the consent box in the hint copy", () => {
    expect(src).toMatch(/Check the consent box to agree/);
  });

  it("keeps the canSubmit predicate dependent on legalChecked", () => {
    expect(src).toMatch(/legalChecked/);
    // canSubmit is the AND of five preconditions — ensure legalChecked is the
    // last clause so behaviour is unchanged.
    expect(src).toMatch(/canSubmit\s*=\s*[\s\S]*legalChecked;/);
  });
});
