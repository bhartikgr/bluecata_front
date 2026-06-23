/**
 * CP Phase C — loggerMigration.test.ts
 *
 * Assertion: production server/*.ts files (excluding __tests__/) must
 * not contain raw `console.log/warn/error/info/debug` calls beyond a
 * narrow intentional budget. The intentional wrappers live in:
 *   - server/lib/logger.ts          (the logger itself — emits via console)
 *   - server/lib/sanitize.ts        (redacting wrapper)
 *   - server/lib/sentry.ts          (Sentry-bridge stub)
 *   - server/durableMap.ts          (single docstring comment, not a call)
 *
 * The migration brought the count from 295 → 11. The test enforces a
 * ceiling of 15 — any future drift is caught immediately.
 *
 * NOTE: this test scans the repository on disk via grep; the working
 * directory at test time is the repo root because vitest is invoked
 * from there. Falls back to walking up from cwd if the relative path
 * doesn't resolve on first attempt.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../lib/logger";

function findRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(cur, "server/lib/logger.ts"))) return cur;
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

describe("CP Phase C — console.* migration budget", () => {
  it("production server/*.ts has ≤ 15 raw console.* calls (intentional wrappers only)", () => {
    const root = findRepoRoot();
    const out = execSync(
      String.raw`grep -rn 'console\.\(log\|warn\|error\|info\|debug\)' server --include='*.ts' --exclude-dir=__tests__ | wc -l`,
      { cwd: root, encoding: "utf8", shell: "/bin/bash" },
    ).trim();
    const count = Number(out);
    expect(Number.isFinite(count)).toBe(true);
    expect(count).toBeLessThanOrEqual(15);
  });

  it("remaining console.* calls are confined to the four intentional files", () => {
    const root = findRepoRoot();
    const out = execSync(
      String.raw`grep -rln 'console\.\(log\|warn\|error\|info\|debug\)' server --include='*.ts' --exclude-dir=__tests__ || true`,
      { cwd: root, encoding: "utf8", shell: "/bin/bash" },
    ).trim();
    const files = out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const allowed = new Set([
      "server/lib/logger.ts",
      "server/lib/sanitize.ts",
      "server/lib/sentry.ts",
      "server/durableMap.ts",
    ]);
    for (const f of files) {
      expect(allowed.has(f), `Unexpected console.* in ${f} — should use log.* from server/lib/logger`).toBe(true);
    }
  });

  it("logger.ts exports the polymorphic log object with info/warn/error/debug", async () => {
    const mod = await import("../lib/logger");
    expect(typeof mod.log.info).toBe("function");
    expect(typeof mod.log.warn).toBe("function");
    expect(typeof mod.log.error).toBe("function");
    expect(typeof mod.log.debug).toBe("function");
  });

  it("log.info accepts meta-object form without throwing", () => {
    expect(() => {
      log.info({ route: "test.loggerMigration", message: "meta_form_ok" });
    }).not.toThrow();
  });

  it("log.info accepts varargs (console-style) form without throwing", () => {
    expect(() => {
      log.info("vararg-test", { detail: 42 }, new Error("intentional"));
    }).not.toThrow();
  });
});
