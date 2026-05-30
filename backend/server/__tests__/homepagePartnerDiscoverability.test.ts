/**
 * 23-May Fix 8 — Homepage discoverability of partner + admin sign-in.
 *
 * Avi flagged that consortium partners had no discoverable entry from the
 * public homepage: the header dropdown shipped only Investors + Companies.
 * This is a CSS/JSX-class regression guard on the marketing components,
 * mirroring server/__tests__/signupCheckboxVisible.test.ts.
 *
 * Pins:
 *   1. Header3 dropdown lists Consortium Partners → #/partner/login.
 *   2. Header3 mobile menu has the same partner link.
 *   3. Footer3 Account column exposes Sign in (#/partner/login) and
 *      Apply (#/apply/consortium) — plus an Admin link.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HEADER = path.join(
  __dirname, "..", "..", "client", "src", "components", "home3compo", "Header3.jsx",
);
const FOOTER = path.join(
  __dirname, "..", "..", "client", "src", "components", "home3compo", "Footer3.jsx",
);

describe("23-May Fix 8 — Header dropdown exposes partner login", () => {
  const src = fs.readFileSync(HEADER, "utf8");

  it("dropdown contains a Consortium Partners item pointing to /partner/login", () => {
    expect(src).toMatch(/href="\/partner\/login"/);
    expect(src).toMatch(/Consortium Partners/);
    expect(src).toMatch(/data-testid="link-header-partner-login"/);
  });

  it("mobile menu exposes the same Consortium Partner sign-in link", () => {
    expect(src).toMatch(/data-testid="link-mobile-partner-login"/);
    expect(src).toMatch(/Consortium Partner Sign In/);
  });
});

describe("23-May Fix 8 — Footer Account column", () => {
  const src = fs.readFileSync(FOOTER, "utf8");

  it("exposes a Partner sign-in link", () => {
    expect(src).toMatch(/data-testid="link-footer-partner-signin"/);
    expect(src).toMatch(/href="\/partner\/login"/);
  });

  it("exposes a partner application link", () => {
    expect(src).toMatch(/data-testid="link-footer-partner-apply"/);
    expect(src).toMatch(/href="\/apply\/consortium"/);
  });

  it("exposes an Admin link in the footer dropdown", () => {
    expect(src).toMatch(/data-testid="link-footer-admin-login"/);
    expect(src).toMatch(/href="\/admin\/login"/);
  });
});
