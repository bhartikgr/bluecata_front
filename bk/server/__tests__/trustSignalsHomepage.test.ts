/**
 * Wave G Track 2 — G6: Trust signals homepage tests.
 *
 * Asserts:
 *   - TrustSignals component file exists with the canonical structure.
 *   - Home.tsx imports + renders the component.
 *   - Headline + the three trust rows are present.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const COMPONENT = path.join(
  ROOT,
  "client",
  "src",
  "components",
  "home3compo",
  "TrustSignals.jsx"
);
const HOME = path.join(ROOT, "client", "src", "pages", "home", "Home.tsx");

const compSrc = fs.readFileSync(COMPONENT, "utf8");
const homeSrc = fs.readFileSync(HOME, "utf8");

describe("Wave G Track 2 G6 — homepage trust signals", () => {
  it("TrustSignals component file exists and default-exports a React component", () => {
    expect(fs.existsSync(COMPONENT)).toBe(true);
    expect(compSrc).toMatch(/export\s+default\s+function\s+TrustSignals/);
  });

  it("includes the canonical heading", () => {
    expect(compSrc).toMatch(/Trusted infrastructure for modern fundraising/);
  });

  it("renders a customer-logo grid (placeholder 'Logo here' boxes)", () => {
    expect(compSrc).toMatch(/data-testid=["']trust-signals-logos["']/);
    expect(compSrc).toMatch(/Logo here/);
  });

  it("renders the security/compliance row with all five badges", () => {
    expect(compSrc).toMatch(/data-testid=["']trust-signals-compliance["']/);
    expect(compSrc).toMatch(/SOC 2 Type II/);
    expect(compSrc).toMatch(/GDPR Ready/);
    expect(compSrc).toMatch(/CCPA Ready/);
    expect(compSrc).toMatch(/AES-256 Encryption/);
    expect(compSrc).toMatch(/Hash-chain Audit/);
  });

  it("renders the three quantitative trust stats", () => {
    expect(compSrc).toMatch(/data-testid=["']trust-signals-stats["']/);
    expect(compSrc).toMatch(/\$2\.4M/);
    expect(compSrc).toMatch(/committed via Capavate/);
    expect(compSrc).toMatch(/companies/);
    expect(compSrc).toMatch(/investors/);
  });

  it("is wired into the Home page between the hero and other sections", () => {
    expect(homeSrc).toMatch(
      /import\s+TrustSignals\s+from\s+["']\.\.\/\.\.\/components\/home3compo\/TrustSignals["']/
    );
    expect(homeSrc).toMatch(/<TrustSignals\s*\/>/);
    // appears after <Hero />
    const heroIdx = homeSrc.indexOf("<Hero");
    const trustIdx = homeSrc.indexOf("<TrustSignals");
    expect(heroIdx).toBeGreaterThan(-1);
    expect(trustIdx).toBeGreaterThan(heroIdx);
  });

  it("section is accessible — semantic <section>, aria-labelledby, heading id", () => {
    expect(compSrc).toMatch(/<section[\s\S]*?aria-labelledby=["']trust-signals-heading["']/);
    expect(compSrc).toMatch(/id=["']trust-signals-heading["']/);
  });
});
