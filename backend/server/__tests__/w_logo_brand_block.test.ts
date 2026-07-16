/**
 * W-LOGO — brand block contract guard.
 *
 * Ozan directive: the Consortium Partner (and Collective) shell + the partner
 * login page must use the REAL Capavate logo with the product name written
 * UNDERNEATH it — replacing the old "C" tile + inline CONSORTIUM/COLLECTIVE chip.
 *   - Partner-only sessions read "Consortium Partner".
 *   - Collective/combined sessions read "Collective".
 *
 * These are static source-contract assertions (no browser needed) so the brand
 * treatment cannot silently regress in a future wave. Visual correctness was
 * additionally verified by screenshot during W-LOGO.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("W-LOGO — CollectiveShell sidebar brand block", () => {
  const src = read("client/src/components/CollectiveShell.tsx");

  it("imports and renders the real <CapavateLogo/> in the shell", () => {
    expect(src).toMatch(/import\s*\{\s*CapavateLogo\s*\}\s*from\s*["']@\/components\/CapavateLogo["']/);
    // narrow to the brand block region
    const start = src.indexOf('data-testid="brand-block"');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 600);
    expect(block).toContain("<CapavateLogo");
  });

  it("labels the product UNDER the logo: 'Consortium Partner' for partner, 'Collective' otherwise", () => {
    const start = src.indexOf('data-testid="brand-block"');
    const block = src.slice(start, start + 600);
    expect(block).toContain('data-testid="brand-product-label"');
    expect(block).toMatch(/partnerOnly\s*\?\s*["']Consortium Partner["']\s*:\s*["']Collective["']/);
  });

  it("removed the old 'C' tile + CONSORTIUM/COLLECTIVE chip badge", () => {
    // The old inline chip carried data-testid="brand-chip"; it must be gone.
    expect(src).not.toContain('data-testid="brand-chip"');
    // The old literal uppercase chip text must no longer be rendered as a badge.
    expect(src).not.toMatch(/\?\s*["']CONSORTIUM["']\s*:\s*["']COLLECTIVE["']/);
  });
});

describe("W-LOGO — partner login page", () => {
  const authShell = read("client/src/pages/auth/AuthShell.tsx");
  const partnerLogin = read("client/src/pages/partner/PartnerLogin.tsx");

  it("AuthShell accepts an optional productLabel rendered under the logo", () => {
    expect(authShell).toMatch(/productLabel\?\s*:\s*string/);
    expect(authShell).toContain('data-testid="auth-shell-product-label"');
    // label sits next to the CapavateLogo (same brand column)
    expect(authShell).toContain("<CapavateLogo");
  });

  it("PartnerLogin passes productLabel='Consortium Partner'", () => {
    expect(partnerLogin).toMatch(/productLabel\s*=\s*["']Consortium Partner["']/);
  });
});
