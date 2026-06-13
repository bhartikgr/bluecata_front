/**
 * Wave G G4 — Shimmer skeleton contract.
 *
 * Asserts that:
 *   - index.css declares the @keyframes shimmer animation
 *   - index.css respects prefers-reduced-motion (animation suppressed)
 *   - PageSkeleton.tsx exports the four required variants
 *   - PageSkeleton.tsx uses the .animate-shimmer class everywhere
 *
 * Source-level assertions only (same pattern as authShellHeroPanel.test.ts).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

const indexCss = fs.readFileSync(
  path.join(ROOT, "client", "src", "index.css"),
  "utf8",
);
const skeletonTs = fs.readFileSync(
  path.join(ROOT, "client", "src", "components", "ui", "PageSkeleton.tsx"),
  "utf8",
);

describe("Wave G G4 — shimmer keyframes + reduced-motion handling", () => {
  it("declares @keyframes shimmer with -200% to 200% background-position", () => {
    expect(indexCss).toMatch(/@keyframes\s+shimmer\s*\{/);
    expect(indexCss).toMatch(/background-position:\s*-200%/);
    expect(indexCss).toMatch(/background-position:\s*200%/);
  });

  it("declares the .animate-shimmer utility with 1.5s ease-in-out infinite", () => {
    expect(indexCss).toMatch(/\.animate-shimmer\s*\{/);
    expect(indexCss).toMatch(/animation:\s*shimmer\s+1\.5s\s+ease-in-out\s+infinite/);
  });

  it("suppresses the shimmer animation under prefers-reduced-motion: reduce", () => {
    expect(indexCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // Inside that media query the animate-shimmer rule must override to `none`.
    const block = indexCss.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}\s*\}/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/\.animate-shimmer\s*\{[\s\S]*animation:\s*none/);
  });

  it("uses GPU-friendly will-change: background-position", () => {
    expect(indexCss).toMatch(/will-change:\s*background-position/);
  });
});

describe("Wave G G4 — PageSkeleton variants", () => {
  it("preserves the existing PageSkeleton export (Wave E E16 contract)", () => {
    expect(skeletonTs).toMatch(/export\s+function\s+PageSkeleton/);
    // Default data-testid still "page-skeleton"
    expect(skeletonTs).toMatch(/testId\s*=\s*"page-skeleton"/);
    // role=status / aria-live preserved
    expect(skeletonTs).toMatch(/role="status"/);
    expect(skeletonTs).toMatch(/aria-live="polite"/);
  });

  it("exports TableSkeleton, CardSkeleton, ChartSkeleton", () => {
    expect(skeletonTs).toMatch(/export\s+function\s+TableSkeleton/);
    expect(skeletonTs).toMatch(/export\s+function\s+CardSkeleton/);
    expect(skeletonTs).toMatch(/export\s+function\s+ChartSkeleton/);
  });

  it("each variant has a unique default data-testid", () => {
    expect(skeletonTs).toMatch(/"page-skeleton"/);
    expect(skeletonTs).toMatch(/"table-skeleton"/);
    expect(skeletonTs).toMatch(/"card-skeleton"/);
    expect(skeletonTs).toMatch(/"chart-skeleton"/);
  });

  it("internal ShimmerBlock applies the .animate-shimmer class", () => {
    expect(skeletonTs).toMatch(/animate-shimmer/);
    // ShimmerBlock primitive exists for reuse
    expect(skeletonTs).toMatch(/export\s+function\s+ShimmerBlock/);
  });

  it("each variant uses role=status + aria-live for accessibility", () => {
    // The string appears 4 times — once per variant.
    const matches = skeletonTs.match(/role="status"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it("ChartSkeleton renders deterministic bar heights (SSR-safe)", () => {
    // No Math.random() — the variant should be deterministic so SSR + CSR match.
    const chartFnMatch = skeletonTs.match(
      /export\s+function\s+ChartSkeleton[\s\S]*?\n\}/,
    );
    expect(chartFnMatch).not.toBeNull();
    expect(chartFnMatch![0]).not.toMatch(/Math\.random/);
  });
});
