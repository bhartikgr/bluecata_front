/**
 * Wave E Fix E2 — Toast config sanity guard.
 *
 * Previously TOAST_REMOVE_DELAY was 1_000_000ms (~16min, so toasts never
 * auto-dismissed) and TOAST_LIMIT was 1 (consecutive toasts replaced each
 * other instead of stacking). This test freezes the now-sane values so
 * a future inadvertent revert is caught.
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
  "hooks",
  "use-toast.ts",
);

describe("Wave E E2 — toast config", () => {
  const src = fs.readFileSync(SOURCE, "utf8");

  it("TOAST_REMOVE_DELAY is < 30000ms (auto-dismiss within reasonable time)", () => {
    const m = src.match(/const\s+TOAST_REMOVE_DELAY\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    const v = Number(m![1]);
    expect(v).toBeLessThan(30000);
    expect(v).toBeGreaterThanOrEqual(1000);
  });

  it("TOAST_LIMIT is >= 3 (allows quick consecutive toasts to stack)", () => {
    const m = src.match(/const\s+TOAST_LIMIT\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(3);
  });
});
