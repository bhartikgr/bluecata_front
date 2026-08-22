/**
 * WAVE 1D — the Consortium Partner "Ledger + Grid" skin: STATIC CSS CONTRACT.
 *
 * These are the invariants that make the wave safe. They are asserted rather
 * than asserted-in-prose because the whole risk of a restyle is leakage: one
 * unscoped selector and four other product areas change appearance.
 *
 * Coverage:
 *   1. EVERY selector in ledger-partner.css is scoped to
 *      [data-product="partner"]. No bare element selector, no other area.
 *   2. ledger-partner.css declares NO layout or visibility property. A restyle
 *      that can hide or move a control is not a restyle.
 *   3. ledger-ramps.css still declares exactly 125 ramp steps in EACH of its
 *      six blocks, and the four other area blocks plus :root are byte-identical
 *      to each other (which is what "no other area changed" means mechanically).
 *   4. The two Tier-9 LOCKED brand hexes are NOT redefined in the partner scope.
 *   5. index.css imports the new file, and imports it AFTER the two shared
 *      themes it overrides (cascade order is load-bearing here, not cosmetic).
 *   6. capavate-tokens.css is byte-unchanged — same sha256 w8_shared_theme.test
 *      pins, restated here so a Wave 1D regression is caught by a Wave 1D test.
 *   7. collective-theme.css keeps its collective/partner selector symmetry, so
 *      w8_shared_theme.test.ts cannot be turned red by this wave.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const P = (p: string) => join(ROOT, "client/src", p);
const partnerCss = readFileSync(P("styles/ledger-partner.css"), "utf8");
const rampsCss = readFileSync(P("styles/ledger-ramps.css"), "utf8");
const indexCss = readFileSync(P("index.css"), "utf8");

/** strip comments, then return every selector text at rule level */
function selectors(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const re = /(^|\})\s*([^{}@]+?)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare))) {
    for (const s of m[2].split(",")) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

describe("W1D · ledger-partner.css is scoped to the partner area and nothing else", () => {
  const sels = selectors(partnerCss);

  it("has a non-trivial rule set", () => {
    expect(sels.length).toBeGreaterThan(15);
  });

  it("every selector begins with [data-product=\"partner\"]", () => {
    const leaks = sels.filter((s) => !s.startsWith('[data-product="partner"]'));
    expect(leaks).toEqual([]);
  });

  it("names no other product area, and no marketing scope, in any RULE", () => {
    // Comments are excluded on purpose: the file's prose has to be able to
    // explain which shared blocks it overrides and why. What must never leak is
    // a live SELECTOR.
    const rules = partnerCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const area of ["collective", "founder", "admin", "investor"]) {
      expect(rules, area).not.toContain(`[data-product="${area}"]`);
    }
    expect(rules).not.toContain(".home3-root");
    expect(rules).not.toContain("home3compo");
  });

  it("declares NO layout, visibility, ordering or content property — a restyle cannot hide or move a control", () => {
    const decls = partnerCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const banned of [
      "display", "visibility", "opacity", "pointer-events", "order",
      "position", "content", "z-index", "float", "transform",
      "width", "height", "overflow", "flex-direction", "grid-template-columns",
    ]) {
      // property position only: start of a declaration, i.e. after `{` or `;`.
      const re = new RegExp(`[{;]\\s*${banned}\\s*:`);
      expect(re.test(decls), `banned property ${banned}`).toBe(false);
    }
  });

  it("does not redefine the two Tier-9 LOCKED brand tokens", () => {
    const decls = partnerCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toMatch(/--cv-color-primary\s*:/);
    expect(decls).not.toMatch(/--cv-color-navy\s*:/);
  });

  it("keeps the 999px pill available for status pills (--cv-radius-full untouched)", () => {
    const decls = partnerCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toMatch(/--cv-radius-full\s*:/);
  });
});

describe("W1D · ledger-ramps.css — only the partner block moved", () => {
  function block(name: string): string {
    const sel = name === "root" ? ":root" : `\\[data-product="${name}"\\]`;
    const re = new RegExp(`\\n${sel} \\{\\n([\\s\\S]*?)\\n\\}\\n`);
    const m = rampsCss.match(re);
    if (!m) throw new Error(`block ${name} not found`);
    // :root opens with a blank line; compare the declaration bodies, not the
    // incidental whitespace the generator happens to emit around them.
    return m[1].trim();
  }
  const AREAS = ["root", "partner", "collective", "founder", "admin", "investor"];

  it("all six blocks exist and each declares exactly 125 ramp steps", () => {
    for (const a of AREAS) {
      expect((block(a).match(/--ramp-/g) || []).length, a).toBe(125);
    }
  });

  it("the four OTHER area blocks are byte-identical to :root — no other area's colour can have moved", () => {
    const root = block("root");
    for (const a of ["collective", "founder", "admin", "investor"]) {
      expect(block(a), a).toBe(root);
    }
  });

  it("the partner block DIFFERS from :root — the wave actually happened", () => {
    expect(block("partner")).not.toBe(block("root"));
  });

  it("the partner block declares the same family/step SET as :root (no step added or lost)", () => {
    const keys = (s: string) =>
      (s.match(/--ramp-[a-z]+-\d+/g) || []).sort().join(",");
    expect(keys(block("partner"))).toBe(keys(block("root")));
  });

  it("every partner ramp value is a bare `R G B` channel triplet — Tailwind's alpha modifier depends on it", () => {
    for (const ln of block("partner").split("\n")) {
      const m = ln.match(/--ramp-[a-z]+-\d+:\s*([^;]+);/);
      if (m) expect(m[1].trim(), ln).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
});

describe("W1D · index.css wiring and cascade order", () => {
  it("imports ledger-partner.css", () => {
    expect(indexCss).toContain('@import "./styles/ledger-partner.css"');
  });

  it("imports it AFTER collective-theme.css and partner-theme.css — the override depends on it", () => {
    const at = (s: string) => indexCss.indexOf(s);
    expect(at('@import "./styles/ledger-partner.css"')).toBeGreaterThan(
      at('@import "./styles/collective-theme.css"'),
    );
    expect(at('@import "./styles/ledger-partner.css"')).toBeGreaterThan(
      at('@import "./styles/partner-theme.css"'),
    );
  });

  it("imports it before @tailwind, as CSS @import ordering requires", () => {
    expect(indexCss.indexOf('@import "./styles/ledger-partner.css"'))
      .toBeLessThan(indexCss.indexOf("@tailwind base"));
  });
});

describe("W1D · the files Wave 1D must NOT have touched", () => {
  it("capavate-tokens.css is byte-unchanged (SACRED 41/48)", () => {
    const sha = createHash("sha256")
      .update(readFileSync(P("styles/capavate-tokens.css")))
      .digest("hex");
    expect(sha).toBe("b4346f5a81be40fbd2791e43c8b671f6ab713265f024459d0be278766a88c766");
  });

  it("collective-theme.css keeps its collective/partner selector symmetry (w8 contract)", () => {
    const theme = readFileSync(P("styles/collective-theme.css"), "utf8");
    const c = (theme.match(/\[data-product="collective"\]/g) || []).length;
    const p = (theme.match(/\[data-product="partner"\]/g) || []).length;
    expect(c).toBe(p);
    expect(c).toBeGreaterThan(20);
  });

  it("partner-theme.css still exists and is still imported (nothing was retired out from under it)", () => {
    expect(readFileSync(P("styles/partner-theme.css"), "utf8").length).toBeGreaterThan(1000);
    expect(indexCss).toContain('@import "./styles/partner-theme.css"');
  });
});
