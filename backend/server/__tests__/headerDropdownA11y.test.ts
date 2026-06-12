/**
 * Wave E Fix E8 — Header3 Sign-In dropdown a11y.
 *
 * Trigger now has aria-haspopup="menu" + aria-controls; menu has role="menu";
 * Escape closes the open dropdown and returns focus to the trigger.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = path.join(
  __dirname,
  "..",
  "..",
  "client",
  "src",
  "components",
  "home3compo",
  "Header3.jsx",
);

describe("Wave E E8 — Header dropdown a11y", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("trigger has aria-haspopup=\"menu\"", () => {
    expect(src).toMatch(/aria-haspopup="menu"/);
  });

  it("trigger has aria-controls matching menu id", () => {
    expect(src).toMatch(/aria-controls="header-signin-menu"/);
    expect(src).toMatch(/id="header-signin-menu"/);
  });

  it("menu container has role=\"menu\"", () => {
    expect(src).toMatch(/<div\s+className="dropdown__menu"[^>]*role="menu"/);
  });

  it("Escape key closes open dropdown and returns focus", () => {
    expect(src).toMatch(/e\.key\s*!==\s*"Escape"/);
    expect(src).toMatch(/trig\?\.focus\(\)/);
  });
});
