/**
 * Wave E Fix E5 + E6 — Landmark regions + skip-to-content link.
 *
 * a11y baseline: every page needs a banner, main, and contentinfo landmark
 * with a skip-to-content link before the nav so keyboard users can bypass
 * repetitive navigation.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

describe("Wave E E5/E6 — landmarks + skip link on marketing home", () => {
  it("Header3 renders a skip-to-content link before the nav", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "home3compo", "Header3.jsx"),
      "utf8",
    );
    expect(src).toMatch(/href="#main-content"/);
    expect(src).toMatch(/Skip to content/);
    expect(src).toMatch(/data-testid="link-skip-to-content"/);
    // skip link must appear before <nav.
    const skipIdx = src.indexOf('href="#main-content"');
    const navIdx = src.indexOf('<nav className="nav"');
    expect(skipIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(navIdx);
  });

  it("Header3 nav has role=banner landmark", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "home3compo", "Header3.jsx"),
      "utf8",
    );
    expect(src).toMatch(/<nav[^>]*role="banner"/);
  });

  it("Footer3 has role=contentinfo landmark", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "home3compo", "Footer3.jsx"),
      "utf8",
    );
    expect(src).toMatch(/<footer[^>]*role="contentinfo"/);
  });

  it("Home page wraps content in <main id=\"main-content\">", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "home", "Home.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<main\s+id="main-content"/);
  });
});
