/* v25.43 R3-1 — E2E (source assertion): the auth brand panel illustration is
 * removed; the logo + tagline copy remain.
 *
 * Asserts against client/src/pages/auth/AuthShell.tsx:
 *   1. The cap-table network-graph SVG topology is GONE (no <svg>, no
 *      auth-shell-edge / auth-shell-node / auth-shell-hub markup, no
 *      auth-shell-hero-svg testid).
 *   2. The Capavate logo is still present (CapavateLogo component import + use).
 *   3. The tagline + subline copy props are still wired (auth-shell-tagline /
 *      auth-shell-subtagline testids).
 *   4. The left panel uses the solid navy brand surface (#041e41), not the old
 *      cyan/burgundy gradient.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../client/src/pages/auth/AuthShell.tsx");
const src = readFileSync(SRC, "utf8");

const results = [];
function record(name, pass) {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}`);
}

describe("v25.43 R3-1 — AuthShell illustration removed", () => {
  it("the network-graph SVG topology is removed", () => {
    const hasSvg = /<svg[\s>]/.test(src);
    const hasEdge = src.includes("auth-shell-edge");
    const hasNode = src.includes("auth-shell-node");
    const hasHub = src.includes("auth-shell-hub");
    const hasHeroSvg = src.includes("auth-shell-hero-svg");
    const removed = !hasSvg && !hasEdge && !hasNode && !hasHub && !hasHeroSvg;
    record("SVG topology removed", removed);
    expect(removed).toBe(true);
  });

  it("the Capavate logo is still present", () => {
    const ok = src.includes("CapavateLogo");
    record("logo present", ok);
    expect(ok).toBe(true);
  });

  it("the tagline + subline copy are still wired", () => {
    const ok =
      src.includes('data-testid="auth-shell-tagline"') &&
      src.includes('data-testid="auth-shell-subtagline"') &&
      src.includes("heroTagline") &&
      src.includes("heroSubline");
    record("tagline + subline present", ok);
    expect(ok).toBe(true);
  });

  it("the left panel uses the solid navy brand surface (#041e41)", () => {
    const ok = src.includes("bg-[#041e41]") && !src.includes("from-[hsl(213");
    record("solid navy bg, no old gradient", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(
      `\n  v25.43 R3-1 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`,
    );
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
