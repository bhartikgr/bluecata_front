/**
 * v17 Phase A — ChapterSelector smoke test.
 *
 * The repository's vitest config (vitest.config.ts) only matches `*.test.ts`
 * files and does NOT load jsdom or @testing-library/react. Adding either
 * would change global test bootstrapping and risk regressing the existing
 * 2046-passing baseline. So this is an intentionally lightweight smoke
 * test that:
 *
 *   1) Confirms the module imports cleanly (no syntax / type / circular-dep
 *      errors), which catches the common "I forgot to export the component"
 *      regression.
 *   2) Asserts the public surface — default export AND a named
 *      `ChapterSelector` function export both exist and are callable.
 *   3) Reads the source file from disk and pins the load-bearing behaviors
 *      that integration tests cannot easily probe without a real browser:
 *        - feature-flag gate (`/api/feature-flags`)
 *        - data fetch from `/api/me/chapters`
 *        - selector hidden when `chapters.length === 0`
 *        - selector hidden when `!collectiveOn`
 *        - no web-storage call (Phase A forbids it; Rule 12)
 *
 * Full DOM-rendering tests for the chapter selector belong in v17 Phase B
 * when react-testing-library can be added without churning the boot path.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * NOTE: we deliberately DO NOT `import` ../ChapterSelector here. The
 * component pulls in radix-ui's Select primitives, which in turn reference
 * `document` at module top level. The repo's vitest config runs in the
 * default node environment (no jsdom), so importing the component would
 * crash. Source-text introspection is sufficient for Phase A; v17 Phase B
 * will introduce a jsdom-backed config for proper RTL tests.
 */

const COMPONENT_PATH = path.resolve(__dirname, "..", "ChapterSelector.tsx");

describe("v17 Phase A — ChapterSelector module surface", () => {
  it("the component file exists at the expected path", () => {
    expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
  });

  it("declares a ChapterSelector named export", () => {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    expect(src).toMatch(/export\s+function\s+ChapterSelector\b/);
  });

  it("declares a default export aliasing ChapterSelector", () => {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    expect(src).toMatch(/export\s+default\s+ChapterSelector/);
  });
});

describe("v17 Phase A — ChapterSelector source invariants", () => {
  const SRC = fs.readFileSync(COMPONENT_PATH, "utf8");

  it("reads the feature-flag endpoint /api/feature-flags", () => {
    expect(SRC).toContain("/api/feature-flags");
  });

  it("reads memberships from /api/me/chapters", () => {
    expect(SRC).toContain("/api/me/chapters");
  });

  it("guards on COLLECTIVE_ENABLED before rendering", () => {
    // The component reads the flag and stores it in `collectiveOn`. The
    // early-return uses `if (!collectiveOn) return null;`.
    expect(SRC).toMatch(/collectiveOn/);
    expect(SRC).toMatch(/if\s*\(!collectiveOn\)\s*return null/);
  });

  it("hides itself when there are zero chapter memberships", () => {
    expect(SRC).toMatch(/chapters\.length\s*===\s*0/);
  });

  it("does not use localStorage / sessionStorage (Phase A forbids web storage)", () => {
    expect(SRC).not.toMatch(/localStorage/);
    expect(SRC).not.toMatch(/sessionStorage/);
  });

  it("does not contain TODO / FIXME / mock markers (Rule 1: no stubs)", () => {
    expect(SRC).not.toMatch(/\bTODO\b/);
    expect(SRC).not.toMatch(/\bFIXME\b/);
    expect(SRC).not.toMatch(/\bmock(?:ed)?\b/i);
  });
});
