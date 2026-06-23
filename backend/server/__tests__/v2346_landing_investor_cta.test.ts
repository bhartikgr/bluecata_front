/**
 * v23.4.6 Phase 4 (L-005) regression guard.
 *
 * Bug: the hero "Investor? Access your portfolio \u2192" CTA on the live
 * production deployment routed investors to `/onboarding`, which is the
 * founder/company-create flow. Investors are invitation-only and must go to
 * `/auth/login?portal=investor` (or `/investor/login`) instead.
 *
 * The v23.4.5 source already routes correctly. This test PINS that contract
 * so a future refactor can't silently regress investors back to the founder
 * onboarding path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LANDING = readFileSync(
  path.resolve(__dirname, "..", "..", "client/src/pages/Landing.tsx"),
  "utf8",
);

describe("v23.4.6 Phase 4 (L-005) \u2014 Landing investor CTA regression guard", () => {
  it("Landing.tsx does NOT route any handler to /onboarding", () => {
    // The original bug used <a href=\"/onboarding\"> or navigate(\"/onboarding\")
    // for the investor card. We assert no such target appears anywhere on the
    // public Landing page.
    expect(LANDING).not.toMatch(/["']\/onboarding["']/);
    expect(LANDING).not.toMatch(/navigate\(["']\/onboarding/);
  });

  it("the investor handler routes to an investor-appropriate destination", () => {
    // Either /auth/login?portal=investor OR /investor/login is acceptable.
    // /auth/redeem is also acceptable for token-redemption paths.
    const acceptable = [
      /navigate\(["']\/auth\/login\?portal=investor["']/,
      /navigate\(["']\/investor\/login["']/,
      /navigate\(["']\/auth\/redeem["']/,
    ];
    const matched = acceptable.some((r) => r.test(LANDING));
    expect(
      matched,
      "Landing.tsx investor handler must route to /auth/login?portal=investor, /investor/login, or /auth/redeem",
    ).toBe(true);
  });

  it("the investor card has an explicit \"INVESTOR\" badge so the visitor can self-classify", () => {
    expect(LANDING).toMatch(/INVESTOR/);
    expect(LANDING).toMatch(/I'm an investor/);
  });
});
