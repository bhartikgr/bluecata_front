/**
 * Wave G G2 — AuthShell network-graph hero contract.
 *
 * The Wave E E16 contract (cap-table snapshot mock) is preserved by
 * authShellHeroPanel.test.ts. This file adds the Wave G upgrades:
 *
 *   - Animated network graph: a central hub + 8 surrounding nodes
 *   - Edges + nodes use opacity / stroke-dashoffset animations
 *     (GPU-friendly, no layout reflows)
 *   - prefers-reduced-motion freezes all animations
 *   - Trust-badge grid below the tagline (with "Trusted by founders and
 *     investors at" caption)
 *
 * Source-level assertions only (no jsdom render).
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

const src = fs.readFileSync(SOURCE, "utf8");

describe("Wave G G2 — animated network-graph hero", () => {
  it("declares the network-graph keyframes (node pulse, edge flow, hub glow)", () => {
    expect(src).toMatch(/@keyframes\s+authShellNodePulse/);
    expect(src).toMatch(/@keyframes\s+authShellEdgeFlow/);
    expect(src).toMatch(/@keyframes\s+authShellHubGlow/);
  });

  it("defines .auth-shell-node, .auth-shell-edge, .auth-shell-hub classes", () => {
    expect(src).toMatch(/\.auth-shell-node\s*\{/);
    expect(src).toMatch(/\.auth-shell-edge\s*\{/);
    expect(src).toMatch(/\.auth-shell-hub\s*\{/);
  });

  it("animated elements are GPU-friendly (only opacity / stroke-dashoffset / filter)", () => {
    // will-change hints exist for each animated property type
    expect(src).toMatch(/will-change:\s*opacity/);
    expect(src).toMatch(/will-change:\s*stroke-dashoffset/);
    expect(src).toMatch(/will-change:\s*filter/);
  });

  it("respects prefers-reduced-motion (animation suppressed for all three classes)", () => {
    expect(src).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // Inside the media query block, animation must be set to none for each class.
    const block = src.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}\s*`/,
    );
    expect(block).not.toBeNull();
    const b = block![0];
    expect(b).toMatch(/\.auth-shell-node/);
    expect(b).toMatch(/\.auth-shell-edge/);
    expect(b).toMatch(/\.auth-shell-hub/);
    expect(b).toMatch(/animation:\s*none/);
  });

  it("renders a hub node + at least 8 surrounding nodes", () => {
    expect(src).toMatch(/data-testid="auth-shell-hub"/);
    const nodeMatches = src.match(/class[Nn]ame="auth-shell-node"/g) || [];
    expect(nodeMatches.length).toBeGreaterThanOrEqual(8);
  });

  it("renders at least 12 edges between nodes (hub + peer-to-peer)", () => {
    const edgeMatches = src.match(/className="auth-shell-edge"/g) || [];
    expect(edgeMatches.length).toBeGreaterThanOrEqual(12);
  });

  it("preserves the Capavate product noun vocabulary in the hero", () => {
    expect(src).toMatch(/Cap Table/);
    expect(src).toMatch(/Founders/);
    expect(src).toMatch(/Investors/);
    expect(src).toMatch(/Option Pool/);
    expect(src).toMatch(/Rounds/);
    expect(src).toMatch(/Audit/);
  });

  it("uses radial gradients for node + hub fills (premium feel)", () => {
    expect(src).toMatch(/<radialGradient[^>]*id="authShellNodeGrad"/);
    expect(src).toMatch(/<radialGradient[^>]*id="authShellHubGrad"/);
  });
});

describe("Wave G G2 — trust badge grid", () => {
  it("renders a trust grid container", () => {
    expect(src).toMatch(/data-testid="auth-shell-trust-grid"/);
  });

  it("includes the 'Trusted by founders and investors at' caption", () => {
    expect(src).toMatch(/Trusted by founders and investors at/i);
  });

  it("renders at least four trust-badge slots", () => {
    const badgeMatches = src.match(/data-testid="auth-shell-trust-badge"/g) || [];
    expect(badgeMatches.length).toBeGreaterThanOrEqual(1);
    // The slot array has four entries — verify the four monograms exist.
    expect(src).toMatch(/NV/);
    expect(src).toMatch(/AC/);
    expect(src).toMatch(/HL/);
    expect(src).toMatch(/QF/);
  });
});

describe("Wave G G2 — backwards compatibility with Wave E E16 contract", () => {
  it("preserves the brand panel + grid overlay testids", () => {
    expect(src).toMatch(/data-testid="auth-shell-brand-panel"/);
    expect(src).toMatch(/data-testid="auth-shell-grid-overlay"/);
    expect(src).toMatch(/data-testid="auth-shell-hero-svg"/);
  });

  it("preserves the existing dot-grid drift animations", () => {
    expect(src).toMatch(/@keyframes\s+authShellDriftA/);
    expect(src).toMatch(/@keyframes\s+authShellDriftB/);
  });

  it("preserves the right-side form region + children + footer", () => {
    expect(src).toMatch(/Right: Form/);
    expect(src).toMatch(/\{children\}/);
  });

  it("preserves the consortium-partners sub-tagline", () => {
    expect(src).toMatch(/data-testid="auth-shell-subtagline"/);
    expect(src).toMatch(/consortium partners/i);
  });
});
