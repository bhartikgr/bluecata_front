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

const TREE = "/home/user/workspace/avi_v14_tree";

const BANNED = [
  '?? "u_aisha_patel"',
  '?? "u_demo"',
  '?? "u_admin"',
  '?? "co_novapay"',
];

describe("v14: hard-coded identity fallbacks banned in production", () => {
  it("zero hits in non-test, non-seed, non-comment server code", () => {
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
