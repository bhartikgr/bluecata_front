/* v25.43 F10 — E2E: the founder Subscribe page renders the brand logo image.
 *
 * Brief: replace the text-only "Capavate" wordmark in Subscribe.tsx with an
 * <img> whose src ends in capavate-logo.png. The wrapping flex container (which
 * carries layout semantics) stays.
 *
 * Source-render assertion: the wordmark is static JSX, so we verify the source
 * renders an <img> with the brand-logo src and that the old text-only wordmark
 * <span>Capavate</span> is gone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUBSCRIBE = resolve(__dirname, "../../client/src/pages/founder/Subscribe.tsx");

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 F10 — Subscribe logo image", () => {
  const src = readFileSync(SUBSCRIBE, "utf8");

  it("renders an <img> with data-testid=subscribe-logo", () => {
    const ok = /<img[^>]*data-testid="subscribe-logo"[^>]*>/.test(src);
    record("img with data-testid=subscribe-logo", ok);
    expect(ok).toBe(true);
  });

  it("imports the logo as a Vite asset (no dev-server /src/ literal path)", () => {
    // R2-1: the logo must be a proper Vite asset import so the production
    // build emits a hashed asset under dist/public/assets/ — a literal
    // "/src/assets/capavate-logo.png" only resolves on the dev server and
    // 404s in production (falls through to SPA HTML).
    const hasImport = /import\s+capavateLogoUrl\s+from\s+"@\/assets\/capavate-logo\.png"/.test(src);
    record("capavateLogoUrl Vite asset import present", hasImport);
    expect(hasImport).toBe(true);

    const usesImportedVar = /<img[^>]*src=\{capavateLogoUrl\}[^>]*>/.test(src);
    record("img uses the imported capavateLogoUrl variable", usesImportedVar);
    expect(usesImportedVar).toBe(true);

    const hasDevLiteral = /src="\/src\/assets\//.test(src);
    record("no /src/assets/ dev-server literal in source", !hasDevLiteral);
    expect(hasDevLiteral).toBe(false);
  });

  it("the logo img has an accessible alt attribute", () => {
    const ok = /<img[^>]*alt="Capavate"[^>]*>/.test(src);
    record("img alt=Capavate", ok);
    expect(ok).toBe(true);
  });

  it("the old text-only <span>Capavate</span> wordmark is gone", () => {
    const hit = /<span[^>]*>Capavate<\/span>/.test(src);
    record("no text-only wordmark span", !hit);
    expect(hit).toBe(false);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F10 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
