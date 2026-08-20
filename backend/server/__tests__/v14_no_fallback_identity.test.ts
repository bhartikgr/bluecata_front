/**
 * v14 Tier-1 Fix 2 lint test — hard-coded identity fallbacks are banned in
 * production code.
 *
 * The patterns `?? "u_aisha_patel"`, `?? "u_demo"`, `?? "u_admin"`,
 * `?? "co_novapay"` were used as "demo defaults" but masked unauthenticated
 * requests in production. v14 forbids them outside seed/migration/test paths.
 *
 * Allowed locations (excluded by this lint):
 *   - server/__tests__/**         test harness
 *   - server/seedDemoData*        explicit seed data
 *   - server/migrations/**        DB migrations
 *   - *.bak                       backups left by previous patches
 *   - comments (// or *)          documentation of the ban itself
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/* REPAIR WAVE 1 · ITEM 2 — THIS LINT WAS GREPPING A DIRECTORY THAT DOES NOT EXIST.
 *
 * It used to read:
 *     const TREE = "/home/user/workspace/avi_v14_tree";
 *
 * That path is not present in this environment. `grep -rn … server/ || true`
 * with a cwd that does not exist emitted nothing, `allHits` stayed empty, and the
 * test passed GREEN against a codebase it does not live in — which is how ~70
 * banned fallback sites accumulated under a documented ban
 * (server/lib/requireIdentity.ts:5). See W57_REVIEW_3_RISK.md §2.4.
 *
 * Two changes, both required:
 *   1. TREE is now resolved RELATIVE TO THIS FILE (…/server/__tests__ → repo
 *      root), so it points at whatever tree the test is executed from and cannot
 *      be broken by moving the checkout or by an absolute developer path.
 *   2. The lint FAILS LOUDLY when the target tree or its `server/` directory is
 *      missing. A lint that cannot find the thing it is linting must never pass.
 *      Silence is not evidence of compliance.
 */
const TREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const BANNED = [
  '?? "u_aisha_patel"',
  '?? "u_demo"',
  '?? "u_admin"',
  '?? "co_novapay"',
];

describe("v14: hard-coded identity fallbacks banned in production", () => {
  /* REPAIR WAVE 1 · ITEM 2 — the tree must exist, or the lint is vacuous. */
  it("the tree it lints actually exists and contains server/ (a lint that cannot find its tree must never pass)", () => {
    expect(fs.existsSync(TREE)).toBe(true);
    expect(fs.statSync(TREE).isDirectory()).toBe(true);
    const serverDir = path.join(TREE, "server");
    expect(fs.existsSync(serverDir)).toBe(true);
    expect(fs.statSync(serverDir).isDirectory()).toBe(true);
    // Anchor on a file the ban itself is documented in, so a coincidentally
    // present but wrong `server/` directory is also caught.
    expect(fs.existsSync(path.join(serverDir, "lib", "requireIdentity.ts"))).toBe(true);
  });

  it("zero hits in non-test, non-seed, non-comment server code", () => {
    /* REPAIR WAVE 1 · ITEM 2 — fail loudly rather than grep a missing tree. */
    if (!fs.existsSync(path.join(TREE, "server"))) {
      throw new Error(
        `v14 lint: target tree is missing (${TREE}/server). A lint that cannot ` +
        `find its tree must FAIL, never pass vacuously.`,
      );
    }
    const allHits: string[] = [];
    for (const pat of BANNED) {
      const escaped = pat.replace(/"/g, '\\"');
      const raw = execSync(
        `grep -rn '${escaped}' server/ || true`,
        { cwd: TREE, encoding: "utf8" },
      );
      const hits = raw
        .split("\n")
        .filter((l) => l.length > 0)
        .filter((l) => {
          const file = l.split(":")[0] ?? "";
          if (file.includes("__tests__")) return false;
          if (file.includes("seedDemoData")) return false;
          if (file.includes("migrations")) return false;
          if (file.endsWith(".bak")) return false;
          if (file.includes(".bak.")) return false;
          // Drop comment-only lines.
          const content = l
            .slice(l.indexOf(":", l.indexOf(":") + 1) + 1)
            .trimStart();
          if (content.startsWith("//")) return false;
          if (content.startsWith("*")) return false;
          return true;
        });
      allHits.push(...hits);
    }
    if (allHits.length > 0) {
      throw new Error(
        `v14 lint: hard-coded identity fallback in production:\n  ${allHits.join("\n  ")}`,
      );
    }
    expect(allHits).toHaveLength(0);
  });
});
