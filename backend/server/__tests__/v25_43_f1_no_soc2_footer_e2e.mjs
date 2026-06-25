/* v25.43 F1 — E2E: SOC 2 Type II footer chip removed from Landing.tsx.
 *
 * Ozan approved removing ONLY the "SOC 2 Type II" ShieldCheck chip from the
 * landing-page footer (the sibling "Connected to Capavate Collective" chip
 * stays). This test asserts the rendered Landing source no longer contains the
 * SOC 2 chip / its data-testid, while the Collective chip is preserved.
 *
 * Implemented as a source-render assertion (the chip is static JSX) — this is
 * deterministic and needs no browser, matching the .mjs harness used by the
 * rest of the v25_43 suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING = resolve(__dirname, "../../client/src/pages/Landing.tsx");

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 F1 — SOC 2 footer chip removed", () => {
  const src = readFileSync(LANDING, "utf8");

  it("the SOC 2 Type II chip text is gone", () => {
    const hit = /SOC 2 Type II/.test(src);
    record("no 'SOC 2 Type II' text", !hit);
    expect(hit).toBe(false);
  });

  it("the chip-soc2 data-testid is gone", () => {
    const hit = /data-testid="chip-soc2"/.test(src);
    record("no chip-soc2 testid", !hit);
    expect(hit).toBe(false);
  });

  it("the ShieldCheck icon import is no longer needed for the chip", () => {
    const hit = /ShieldCheck/.test(src);
    record("no ShieldCheck reference", !hit);
    expect(hit).toBe(false);
  });

  it("the Collective sibling chip is preserved", () => {
    const ok = /data-testid="chip-collective"/.test(src) && /Connected to Capavate Collective/.test(src);
    record("Collective chip preserved", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F1 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
