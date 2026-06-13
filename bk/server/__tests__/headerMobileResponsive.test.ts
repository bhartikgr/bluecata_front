/**
 * Wave E Fix E14 — Header mobile responsive fix.
 *
 * Previously .nav__inner was `width: 1200px` (a fixed pixel width), causing
 * horizontal overflow on viewports < 1200px and pushing the hamburger
 * button off-screen at 375px/768px. Now uses `width: 100%; max-width:
 * var(--content-wide)` so the nav shrinks to the viewport.
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
  "pages",
  "home",
  "home3style.css",
);

describe("Wave E E14 — .nav__inner responsive width", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it(".nav__inner uses width:100% and max-width (not fixed width)", () => {
    // Match the .nav__inner block.
    const block = src.match(/\.nav__inner\s*\{[^}]*\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/width:\s*100%/);
    expect(block![0]).toMatch(/max-width:\s*var\(--content-wide\)/);
    // The old fixed-width form must be gone.
    // Check by ensuring no line begins with `width: var(--content-wide)`.
    const lines = block![0].split("\n").map(l => l.trim());
    expect(
      lines.find(l => /^width:\s*var\(--content-wide\)/.test(l)),
    ).toBeUndefined();
  });
});
