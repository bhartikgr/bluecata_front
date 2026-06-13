/**
 * v23.4.6 Phase 5 (L-006) regression guard.
 *
 * Bug: Submitting the founder signup form with name + email + password all
 * blank surfaced only "Enter your name to continue." Other required fields
 * weren't flagged simultaneously, forcing users into a submit-fix-submit-fix
 * loop.
 *
 * Fix: a missingFields() collector + aggregate banner with role="alert" +
 * per-field aria-invalid + the submit button enabled (so clicking it
 * triggers the banner instead of silently no-op'ing).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SIGNUP = readFileSync(
  path.resolve(__dirname, "..", "..", "client/src/pages/auth/Signup.tsx"),
  "utf8",
);

describe("v23.4.6 Phase 5 (L-006) - Signup aggregate validation guard", () => {
  it("declares a missingFields collector that returns an array", () => {
    expect(SIGNUP).toMatch(/missingFields/);
    expect(SIGNUP).toMatch(/missing:\s*string\[\]/);
    expect(SIGNUP).toMatch(/missing\.push\(/);
  });

  it("renders an aggregate-error alert with data-testid=text-signup-aggregate-error", () => {
    expect(SIGNUP).toMatch(/data-testid="text-signup-aggregate-error"/);
    expect(SIGNUP).toMatch(/role="alert"/);
  });

  it("submit handler sets the aggregate error when fields are missing instead of silently returning", () => {
    expect(SIGNUP).toMatch(/setAggregateError\(/);
    expect(SIGNUP).toMatch(/Please complete:/);
  });

  it("submit button is no longer disabled by !canSubmit - clicking it surfaces the aggregate banner", () => {
    const submitBtn = SIGNUP.match(
      /<Button[^>]*data-testid="button-submit-signup"[\s\S]*?>/,
    );
    expect(submitBtn).not.toBeNull();
    expect(submitBtn![0]).toMatch(/disabled=\{submitting\}/);
    expect(submitBtn![0]).not.toMatch(/!canSubmit/);
  });

  it("each required input declares aria-invalid based on its specific validity", () => {
    const inputBlocks = SIGNUP.match(/<Input[\s\S]*?\/>/g) ?? [];
    const namedIds = ["input-name", "input-email", "input-password"];
    for (const tid of namedIds) {
      const block = inputBlocks.find((b) => b.includes(`data-testid="${tid}"`));
      expect(block, `expected to find Input with data-testid="${tid}"`).toBeTruthy();
      expect(block!).toMatch(/aria-invalid=/);
    }
  });
});
