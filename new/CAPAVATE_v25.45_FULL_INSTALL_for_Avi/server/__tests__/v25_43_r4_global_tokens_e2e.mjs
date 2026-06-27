/* v25.43 R4-2 — E2E: the GLOBAL theme tokens are flipped to the capavate.com
 * brand red (#cc0001 = hsl(0 100% 40%)) so every bg-primary / text-primary /
 * ring-primary / accent surface inherits red automatically (shadcn pattern).
 *
 * Asserts:
 *   - client/src/index.css: --primary, --accent, --ring all resolve to red (0 100% 40%)
 *   - --primary-foreground stays white
 *   - tailwind.config.ts: primary/accent/ring flow from the CSS vars (not hardcoded)
 *   - APP-WIDE sweep: no hardcoded teal hsl(184 98% 22%) or burgundy
 *     hsl(327 77% 30%) base-brand literal survives in any client/src .tsx/.css
 *     SURFACE (excluding the dormant --cap-* token defs + the data-viz chart
 *     palette + design-token docs/tests, which are explicitly retained).
 *   - the Button default variant is a red pill (bg-primary + rounded-full).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(__dirname, "../..");
const CLIENT_SRC = join(PROJ, "client", "src");
const read = (p) => readFileSync(p, "utf8");

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

// Walk client/src for .tsx/.css files, excluding intentional retentions.
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const fp = join(dir, name);
    const st = statSync(fp);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(fp, acc);
    } else if (/\.(tsx|css)$/.test(name)) {
      acc.push(fp);
    }
  }
  return acc;
}

describe("v25.43 R4-2 — app-wide global token flip to brand red", () => {
  const css = read(join(CLIENT_SRC, "index.css"));
  const tw = read(join(PROJ, "tailwind.config.ts"));

  it("index.css --primary resolves to red (0 100% 40%)", () => {
    const ok = /--primary:\s*0\s+100%\s+40%/.test(css);
    record("--primary = red", ok);
    expect(ok).toBe(true);
  });

  it("index.css --accent resolves to red (0 100% 40%)", () => {
    const ok = /--accent:\s*0\s+100%\s+40%/.test(css);
    record("--accent = red", ok);
    expect(ok).toBe(true);
  });

  it("index.css --ring resolves to red (0 100% 40%)", () => {
    const ok = /--ring:\s*0\s+100%\s+40%/.test(css);
    record("--ring = red", ok);
    expect(ok).toBe(true);
  });

  it("index.css --primary-foreground stays white", () => {
    const ok = /--primary-foreground:\s*0\s+0%\s+100%/.test(css);
    record("--primary-foreground = white", ok);
    expect(ok).toBe(true);
  });

  it("tailwind primary/accent/ring flow from CSS vars (not hardcoded)", () => {
    const ok =
      /DEFAULT:\s*"hsl\(var\(--primary\)\s*\/\s*<alpha-value>\)"/.test(tw) &&
      /DEFAULT:\s*"hsl\(var\(--accent\)\s*\/\s*<alpha-value>\)"/.test(tw) &&
      /ring:\s*"hsl\(var\(--ring\)\s*\/\s*<alpha-value>\)"/.test(tw);
    record("tailwind tokens flow from vars", ok);
    expect(ok).toBe(true);
  });

  it("APP-WIDE: no base-brand teal/burgundy literal survives in any surface", () => {
    const teal = /184[ _]98%[ _]22%/;
    const burg = /327[ _]77%[ _]30%/;
    const dirty = [];
    for (const fp of walk(CLIENT_SRC)) {
      const rel = relative(CLIENT_SRC, fp);
      // Retained, documented exceptions (see v25.43 R4 report):
      //  - index.css holds the dormant --cap-* token defs + data-viz chart palette
      //  - design-tokens.* is a separate documented namespace locked by tests
      if (rel === "index.css") continue;
      if (rel.startsWith("design-tokens") || rel.includes("design-tokens")) continue;
      const src = read(fp);
      if (teal.test(src) || burg.test(src)) dirty.push(rel);
    }
    record("no surface teal/burgundy literals", dirty.length === 0, dirty.slice(0, 10).join(", "));
    expect(dirty).toEqual([]);
  });

  it("index.css only retains teal in the dormant --cap-* token + chart palette (with comments)", () => {
    // The only permitted 184-teal occurrences in index.css are the dormant
    // --cap-primary token (locked by brandColorVars.test.ts) and --chart-2.
    const lines = css.split("\n").filter((l) => /184[ _]98%[ _]2[28]%/.test(l));
    const allAccountedFor = lines.every(
      (l) => /--cap-primary|--chart-2|Hydra Teal|hardcoded `hsl\(184/.test(l)
    );
    record("index.css teal only in retained tokens", allAccountedFor,
      `${lines.length} retained line(s)`);
    expect(allAccountedFor).toBe(true);
  });

  it("Button default variant is a red pill (bg-primary + rounded-full)", () => {
    const btn = read(join(CLIENT_SRC, "components", "ui", "button.tsx"));
    const ok = /default:\s*\n?\s*"bg-primary[^"]*rounded-full/.test(btn);
    record("Button default = red pill", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 R4-2 global-tokens E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
