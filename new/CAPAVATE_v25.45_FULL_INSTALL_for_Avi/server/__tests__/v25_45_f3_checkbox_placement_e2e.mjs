/* v25.45 F3a/F3b — Save Profile legal-consent checkbox placement + vanish fix.
 * Source-level assertions on Company.tsx:
 *  - consent container is ABOVE the button row (DOM/source order)
 *  - container has the brand-red border classes
 *  - checkbox is NOT wrapped in {!legalConsentChecked && (...)} (no vanish)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const src = readFileSync(resolve(ROOT, "client/src/pages/founder/Company.tsx"), "utf8");

describe("v25.45 F3 checkbox placement — source", () => {
  it("F3a: consent container rendered ABOVE the button row", () => {
    const containerIdx = src.indexOf('data-testid="legal-consent-container"');
    const buttonRowIdx = src.indexOf('data-testid="button-step-back"');
    expect(containerIdx).toBeGreaterThan(-1);
    expect(buttonRowIdx).toBeGreaterThan(-1);
    expect(containerIdx).toBeLessThan(buttonRowIdx);
  });
  it("F3a: container has brand-red border + padding classes", () => {
    const m = src.match(/legal-consent-container[\s\S]{0,200}/);
    // The className appears just before the data-testid in the JSX.
    const ctx = src.slice(Math.max(0, src.indexOf('data-testid="legal-consent-container"') - 200),
                          src.indexOf('data-testid="legal-consent-container"') + 40);
    expect(ctx).toContain("border-[#cc0001]");
    expect(ctx).toContain("bg-[#cc0001]/5");
    expect(ctx).toContain("rounded-md");
  });
  it("F3b: LegalConsentCheckbox is NOT conditionally hidden on check", () => {
    // The checkbox must be a direct child of the always-rendered container,
    // not wrapped in {!legalConsentChecked && (<LegalConsentCheckbox .../>)}.
    expect(src).not.toMatch(/\{!legalConsentChecked && \(\s*<LegalConsentCheckbox/);
    // And it lives inside the step===4 container block.
    const containerIdx = src.indexOf('data-testid="legal-consent-container"');
    // Use the JSX *element* occurrence (the one carrying ref={legalConsentRef}),
    // not the import statement at the top of the file.
    const checkboxIdx = src.indexOf("<LegalConsentCheckbox\n ref={legalConsentRef}");
    expect(checkboxIdx).toBeGreaterThan(containerIdx);
  });
});
