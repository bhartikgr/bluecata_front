/* v25.45 F15 — Settings → Region is a READ-ONLY mirror of Legal Entity Info.
 *
 * Source-asserts the SettingsRegionTab: inputs are disabled/readOnly, the Save
 * button is removed, the helper text + "Open Company Profile" deep-link are
 * present, and the displayed values read from the profile (legalEntity.* with a
 * flat-field fallback) rather than local editable state.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let src;
const { results, record } = recorder();
beforeAll(() => {
  src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
});

// Narrow to the SettingsRegionTab function body for precise assertions.
function regionBody() {
  const start = src.indexOf("function SettingsRegionTab");
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("v25.45 F15 Region read-only — source assertions", () => {
  it("1. inputs are disabled + readOnly", () => {
    const body = regionBody();
    const ok = /readOnly/.test(body) && /disabled/.test(body);
    record("region inputs disabled + readOnly", ok);
    expect(ok).toBe(true);
  });

  it("2. Save changes button removed from Region tab", () => {
    const body = regionBody();
    const ok = !/button-save-region/.test(body) && !/Save changes/.test(body);
    record("save button removed", ok);
    expect(ok).toBe(true);
  });

  it("3. helper text + Open Company Profile deep-link present", () => {
    const body = regionBody();
    const ok = /managed in Company Profile → Legal Entity Information/.test(body)
      && /Open Company Profile/.test(body)
      && /\/founder\/company/.test(body);
    record("helper text + deep-link", ok);
    expect(ok).toBe(true);
  });

  it("4. values read from the profile (legalEntity.* mirror), not editable state", () => {
    const body = regionBody();
    const ok = /legalEntity/.test(body)
      && /incorporationJurisdiction/.test(body)
      && /secondaryJurisdiction/.test(body)
      && /taxResidencyJurisdiction/.test(body)
      && !/onChange=\{e => f\(/.test(body);
    record("values mirror legalEntity, no onChange editing", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F15 Region E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
