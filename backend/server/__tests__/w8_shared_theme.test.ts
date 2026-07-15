/**
 * W8 — Shared Collective + Consortium Partner brand reskin.
 *
 * Coverage (static CSS contract — no runtime needed):
 *   - capavate-tokens.css is BYTE-UNCHANGED (Tier-9 brand lock; W8 adds no hexes).
 *   - collective-theme.css exists and every scoped rule covers BOTH
 *     [data-product="collective"] AND [data-product="partner"] (so the two
 *     surfaces render identically — the whole point of W8).
 *   - The shared theme consumes ONLY canonical --cv-* tokens (no raw hex colors).
 *   - Scope isolation: the theme never targets the Capavate founder workspace
 *     (which sets no data-product) via a bare/global selector.
 *   - index.css imports the shared theme.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const tokensPath = join(ROOT, "client/src/styles/capavate-tokens.css");
const themePath = join(ROOT, "client/src/styles/collective-theme.css");
const indexPath = join(ROOT, "client/src/index.css");

describe("W8 capavate-tokens.css integrity", () => {
  it("is byte-unchanged (Tier-9 brand lock — sha256 pinned)", () => {
    const sha = createHash("sha256").update(readFileSync(tokensPath)).digest("hex");
    expect(sha).toBe("b4346f5a81be40fbd2791e43c8b671f6ab713265f024459d0be278766a88c766");
  });
});

describe("W8 shared theme covers BOTH product surfaces", () => {
  const theme = readFileSync(themePath, "utf8");

  it("exists and is non-trivial", () => {
    expect(theme.length).toBeGreaterThan(1000);
  });

  it("references both [data-product=\"collective\"] and [data-product=\"partner\"]", () => {
    expect(theme).toContain('[data-product="collective"]');
    expect(theme).toContain('[data-product="partner"]');
  });

  it("every collective-scoped selector count is matched by a partner-scoped selector count (symmetry)", () => {
    const collectiveCount = (theme.match(/\[data-product="collective"\]/g) || []).length;
    const partnerCount = (theme.match(/\[data-product="partner"\]/g) || []).length;
    // The shared theme pairs each rule for both scopes → counts must be equal.
    expect(collectiveCount).toBe(partnerCount);
    expect(collectiveCount).toBeGreaterThan(20);
  });

  it("consumes only canonical --cv-* tokens (no raw hex colors introduced)", () => {
    // Strip comments, then assert no 3/6-digit hex literal appears in declarations.
    const noComments = theme.replace(/\/\*[\s\S]*?\*\//g, "");
    const hexes = noComments.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
    expect(hexes).toEqual([]);
    // And it DOES use the token namespace.
    expect(noComments).toContain("var(--cv-");
  });

  it("does NOT target the founder workspace (no bare data-product/global reskin leak)", () => {
    // Every rule must be scoped to collective or partner. There must be no
    // selector that sets data-product to anything else, and no un-scoped global
    // element reskin (e.g. a bare `h1 {` / `main {` at column 0 outside a scope).
    expect(theme).not.toMatch(/\[data-product="founder"\]/);
    // No top-level bare element selectors (they'd leak into founder/AppShell).
    const noComments = theme.replace(/\/\*[\s\S]*?\*\//g, "");
    const bareGlobal = noComments.match(/^\s*(h1|h2|h3|main|table|button|aside|body)\s*[,{]/m);
    expect(bareGlobal).toBeNull();
  });
});

describe("W8 index.css wiring", () => {
  it("imports the shared collective-theme.css", () => {
    const idx = readFileSync(indexPath, "utf8");
    expect(idx).toContain('@import "./styles/collective-theme.css"');
  });
});
