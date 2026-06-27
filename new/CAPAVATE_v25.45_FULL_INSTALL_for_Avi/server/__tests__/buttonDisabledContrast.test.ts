/**
 * Wave E Fix E9 — Disabled button contrast lifted from 50% to 60% opacity
 * and disabled cursor changed to not-allowed for clearer affordance.
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
  "ui",
  "button.tsx",
);

describe("Wave E E9 — disabled button polish", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("uses disabled:opacity-60 (raised from 50)", () => {
    expect(src).toMatch(/disabled:opacity-60/);
    expect(src).not.toMatch(/disabled:opacity-50/);
  });

  it("uses disabled:cursor-not-allowed", () => {
    expect(src).toMatch(/disabled:cursor-not-allowed/);
  });

  it("still disables pointer events on disabled buttons", () => {
    expect(src).toMatch(/disabled:pointer-events-none/);
  });
});
