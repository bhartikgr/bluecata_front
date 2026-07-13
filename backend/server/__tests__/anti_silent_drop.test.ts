/**
 * server/__tests__/anti_silent_drop.test.ts
 *
 * v26.1.1-qa2 — Anti-Silent-Drop protection as a FIRST-CLASS TEST.
 *
 * Rule #8 (no primary functionality may silently disappear) used to be enforced
 * by hard-failing the BUILD from script/build.ts. That coupling blocked installs
 * on Windows/PowerShell (the guard was launched via spawnSync("tsx", ...), whose
 * tsx.cmd spawn raised a NativeCommandError) even when NOTHING had been dropped.
 *
 * The guard tool itself is correct and unchanged; it is simply no longer wired
 * into the build. Instead, this test runs the SAME guard logic against the real
 * committed baseline + the current tree under `npm test`. If any server route,
 * client route/page, or nav entry present in the baseline has disappeared without
 * an allow-list entry, this test FAILS and prints the guard's report naming every
 * dropped identifier — so a genuine drop is caught in CI/verification, never at
 * install time.
 *
 * (Additions since baseline are informational and never fail — same as the tool.)
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "../../scripts/silent-drop-guard/guard";
import { buildInventory } from "../../scripts/silent-drop-guard/extract-inventory";

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
// server/__tests__ -> repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname_, "..", "..");
const GUARD_DIR = path.join(REPO_ROOT, "scripts", "silent-drop-guard");

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

describe("anti-silent-drop (rule #8) — live baseline vs current tree", () => {
  it("no server route, client page, or nav entry has been silently dropped", () => {
    const baseline = readJson<any>(path.join(GUARD_DIR, "baseline.json"));
    const allowlist = fs.existsSync(path.join(GUARD_DIR, "allowlist.json"))
      ? readJson<any>(path.join(GUARD_DIR, "allowlist.json"))
      : { removedRoutes: [], removedClientRoutes: [], removedNav: [] };
    const current = buildInventory(REPO_ROOT);

    const { code, report } = runGuard({ baseline, current, allowlist });

    if (code !== 0) {
      // Surface exactly what dropped so the failure is actionable.

      console.error(report);
    }
    expect(code).toBe(0);
  });
});
