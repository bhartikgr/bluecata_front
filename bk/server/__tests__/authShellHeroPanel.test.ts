/**
 * 23-May Fix 6 (Issue 8) \u2014 AuthShell hero panel regression guard.
 *
 * Ozan reported the left brand panel of /auth/login + /auth/signup was a flat
 * gradient with no visual content. This test freezes the contract that the
 * panel now contains:
 *
 *   - a brand-panel container marker (data-testid)
 *   - an animated grid overlay (data-testid="auth-shell-grid-overlay")
 *   - an inline SVG hero (data-testid="auth-shell-hero-svg") with cap-table mock content
 *   - a sub-tagline mentioning consortium partners (so partner discoverability
 *     starts at the auth surface)
 *
 * Source-level assertions only (no jsdom render) \u2014 same approach as
 * signupCheckboxVisible.test.ts. Cheap, deterministic, catches regressions.
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
  "pages",
  "auth",
  "AuthShell.tsx",
);

describe("23-May Fix 6 \u2014 AuthShell hero brand panel", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("renders a brand-panel container with data-testid", () => {
    expect(src).toMatch(/data-testid="auth-shell-brand-panel"/);
  });

  it("renders an animated grid overlay", () => {
    expect(src).toMatch(/data-testid="auth-shell-grid-overlay"/);
    expect(src).toMatch(/@keyframes\s+authShellDriftA/);
    expect(src).toMatch(/@keyframes\s+authShellDriftB/);
  });

  it("renders an inline SVG hero composition", () => {
    expect(src).toMatch(/data-testid="auth-shell-hero-svg"/);
    // The composition includes a cap-table mock with founders / investors / option pool
    expect(src).toMatch(/Cap Table/);
    expect(src).toMatch(/Founders/);
    expect(src).toMatch(/Investors/);
    expect(src).toMatch(/Option Pool/);
  });

  it("renders a sub-tagline that mentions consortium partners", () => {
    // Cross-link to Fix 7: partner discoverability begins at the auth surface.
    expect(src).toMatch(/data-testid="auth-shell-subtagline"/);
    expect(src).toMatch(/consortium partners/i);
  });

  it("preserves the right-side form region (no regression on auth flow)", () => {
    expect(src).toMatch(/Right: Form/);
    expect(src).toMatch(/\{children\}/);
  });

  it("preserves the existing gradient (defense in depth)", () => {
    expect(src).toMatch(/bg-gradient-to-br/);
    expect(src).toMatch(/from-\[hsl\(219_45%_20%\)\]/);
  });

  it("uses overflow-hidden so the animated overlay clips correctly", () => {
    expect(src).toMatch(/overflow-hidden/);
  });
});
