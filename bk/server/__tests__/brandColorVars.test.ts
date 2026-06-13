/**
 * Wave E Fix E4 — Brand color CSS variables + Tailwind utilities.
 *
 * Additive only: no existing hardcoded color literal is changed. Future
 * PRs will migrate `hsl(184_98%_22%)` / `hsl(219_45%_20%)` to the
 * `bg-cap-primary` / `bg-cap-secondary` utilities defined here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

describe("Wave E E4 — brand CSS custom properties + Tailwind tokens", () => {
  it("index.css defines --cap-primary and --cap-secondary HSL triplets", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "index.css"),
      "utf8",
    );
    expect(src).toMatch(/--cap-primary:\s*184\s+98%\s+22%/);
    expect(src).toMatch(/--cap-primary-hover:\s*184\s+98%\s+18%/);
    expect(src).toMatch(/--cap-secondary:\s*219\s+45%\s+20%/);
    expect(src).toMatch(/--cap-secondary-hover:\s*219\s+45%\s+16%/);
  });

  it("tailwind.config exposes cap-primary and cap-secondary utilities", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "tailwind.config.ts"),
      "utf8",
    );
    expect(src).toMatch(/"cap-primary":\s*\{/);
    expect(src).toMatch(/"cap-secondary":\s*\{/);
    expect(src).toMatch(/hsl\(var\(--cap-primary\)\s*\/\s*<alpha-value>\)/);
    expect(src).toMatch(/hsl\(var\(--cap-secondary\)\s*\/\s*<alpha-value>\)/);
  });
});
