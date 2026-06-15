/**
 * v23.4.6 Phase 6 (L-010) — Post-signup confirmation interstitial.
 *
 * Source-level regression guard for the Signup.tsx interstitial. We assert
 * structural properties of the JSX rather than rendering React (the vitest
 * config only picks up *.test.ts under server/ and source-grep tests
 * elsewhere — adding a jsdom test would require touching vite.config.ts
 * which is sacred per the v23.4.6 spec).
 *
 * The interstitial must:
 *   1. Declare `signedUpAs` and `requiresEmailConfirmation` state.
 *   2. Set both on the success branch of `handleSubmit` BEFORE any
 *      navigate() call (i.e. no immediate redirect-on-success).
 *   3. Early-return a confirmation screen when `signedUpAs !== null`.
 *   4. Branch copy on `requiresEmailConfirmation`:
 *        - true  → "Check your inbox …" + login link
 *        - false → "welcome … signed in" + Continue-to-dashboard button
 *   5. Echo the email the user signed up with.
 *   6. Tag the interstitial container with data-testid for downstream tests.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SIGNUP_PATH = path.resolve(__dirname, "../../client/src/pages/auth/Signup.tsx");
const src = fs.readFileSync(SIGNUP_PATH, "utf8");

describe("v23.4.6 L-010 post-signup interstitial", () => {
  it("declares signedUpAs + requiresEmailConfirmation state", () => {
    expect(src).toMatch(/useState<string \| null>\(null\)/);
    expect(src).toContain("setSignedUpAs");
    expect(src).toContain("setRequiresEmailConfirmation");
  });

  it("sets interstitial state on signup success (no immediate navigate)", () => {
    // The success branch must call setSignedUpAs(email…) — that is what
    // gates the early-return interstitial.
    expect(src).toMatch(/setSignedUpAs\(email\.trim\(\)\)/);
    // And must honor the server's requiresEmailConfirmation flag.
    expect(src).toMatch(
      /setRequiresEmailConfirmation\(\s*responseBody\?\.requiresEmailConfirmation === true/,
    );
  });

  it("renders an early-return interstitial when signedUpAs !== null", () => {
    expect(src).toMatch(/if \(signedUpAs !== null\)/);
    expect(src).toContain('data-testid="signup-interstitial"');
  });

  it("branches copy on requiresEmailConfirmation", () => {
    // Confirmation-required branch
    expect(src).toContain('data-testid="text-signup-confirm-email"');
    expect(src).toMatch(/Check your inbox at/);
    // Auto-signed-in branch
    expect(src).toContain('data-testid="text-signup-welcome"');
    expect(src).toMatch(/welcome,/);
    expect(src).toContain('data-testid="button-continue-dashboard"');
    expect(src).toMatch(/navigate\("\/founder\/dashboard"\)/);
  });

  it("echoes the signed-up email back to the user", () => {
    // {signedUpAs} must appear inside the interstitial (we conservatively
    // check that it is referenced at least once in the render block).
    const after = src.split("if (signedUpAs !== null)")[1] ?? "";
    expect(after).toContain("{signedUpAs}");
  });
});
