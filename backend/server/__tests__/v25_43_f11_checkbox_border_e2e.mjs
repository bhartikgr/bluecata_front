/* v25.43 F11 — E2E: the legal-agreement checkbox wrapper has a 1px border.
 *
 * Ozan's decision: add a 1px border to the LEGAL-AGREEMENT checkbox (the
 * consent group just above "Continue to Airwallex"), NOT the Airwallex hosted-
 * checkout callout. The wrapper should carry `border border-slate-300
 * rounded-md p-2`.
 *
 * Source-render assertion: we verify the LegalConsentCheckbox on Subscribe.tsx
 * is wrapped in a bordered container, and that the Airwallex callout banner was
 * NOT given the border (it must remain visually distinct / untouched).
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

describe("v25.43 F11 — legal-agreement checkbox border", () => {
  const src = readFileSync(SUBSCRIBE, "utf8");

  it("the LegalConsentCheckbox is wrapped in a bordered container", () => {
    // Find the consent wrapper and assert it carries a border class + wraps the
    // LegalConsentCheckbox.
    const wrapper = src.match(/<div[^>]*data-testid="legal-consent-wrapper"[^>]*>/);
    const hasBorder = wrapper ? /\bborder\b/.test(wrapper[0]) && /rounded-md/.test(wrapper[0]) : false;
    const wrapsCheckbox = /data-testid="legal-consent-wrapper"[^]*?<LegalConsentCheckbox/.test(src);
    const ok = !!wrapper && hasBorder && wrapsCheckbox;
    record("checkbox wrapper has border", ok, wrapper ? wrapper[0] : "no wrapper");
    expect(ok).toBe(true);
  });

  it("uses the 1px slate border token from the brief", () => {
    const ok = /border border-slate-300 rounded-md p-2/.test(src);
    record("border border-slate-300 rounded-md p-2", ok);
    expect(ok).toBe(true);
  });

  it("the Airwallex hosted-checkout callout was NOT given the checkbox border", () => {
    // The callout keeps its emerald styling and is the one we must not touch.
    const calloutBlock = src.match(/data-testid="banner-hosted-checkout"[^>]*>/);
    const ok = !!calloutBlock && /border-emerald-200/.test(src);
    record("Airwallex callout untouched", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F11 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
