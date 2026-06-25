/* v25.43 R3-5 — E2E (source assertion): the founder Subscribe page shows ONLY
 * the logo image at the top — no duplicate "Capavate" text label.
 *
 * Asserts against client/src/pages/founder/Subscribe.tsx:
 *   1. The logo <img> carries alt="Capavate" (the single accessible brand
 *      reference).
 *   2. "Capavate" appears EXACTLY ONCE in JSX-rendered content (the alt
 *      attribute) — no visible <span>Capavate</span> text node, and none in
 *      body copy. We count occurrences inside the JSX (the component return),
 *      ignoring the top-of-file comment block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../client/src/pages/founder/Subscribe.tsx");
const raw = readFileSync(SRC, "utf8");

/* Strip block comments and line comments so we count only live JSX/source —
 * the file header documents the bug history and legitimately mentions the
 * brand name. */
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const occurrences = (code.match(/Capavate/g) || []).length;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 R3-5 — Subscribe has no duplicate wordmark", () => {
  it("the logo image carries alt=\"Capavate\"", () => {
    const ok = /<img[^>]*alt="Capavate"/.test(code);
    record('logo img alt="Capavate" present', ok);
    expect(ok).toBe(true);
  });

  it('"Capavate" appears exactly once in live source (the alt attr)', () => {
    record('exactly 1 "Capavate" occurrence', occurrences === 1, `found ${occurrences}`);
    expect(occurrences).toBe(1);
  });

  it("there is no <span>Capavate</span> visible text node", () => {
    const hasSpanWordmark = /<span[^>]*>\s*Capavate\s*<\/span>/.test(code);
    record("no <span>Capavate</span> text node", !hasSpanWordmark);
    expect(hasSpanWordmark).toBe(false);
  });

  it("summary", () => {
    console.log(
      `\n  v25.43 R3-5 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`,
    );
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
