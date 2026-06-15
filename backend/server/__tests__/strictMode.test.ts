/**
 * Wave E Fix E15 — StrictMode wraps the root render.
 *
 * StrictMode catches double-effect bugs and unsafe lifecycle usage in dev.
 * It's a no-op in production. We freeze its presence so a future refactor
 * doesn't silently drop it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = path.join(__dirname, "..", "..", "client", "src", "main.tsx");

describe("Wave E E15 — StrictMode", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("imports StrictMode from react", () => {
    expect(src).toMatch(/import\s+\{[^}]*\bStrictMode\b[^}]*\}\s+from\s+["']react["']/);
  });

  it("wraps the root render in <StrictMode>", () => {
    expect(src).toMatch(/<StrictMode>[\s\S]*<App\s*\/>[\s\S]*<\/StrictMode>/);
  });
});
