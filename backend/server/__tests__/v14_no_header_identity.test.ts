/**
 * v14 Tier-1 Fix 1 lint test — identity-from-header is banned in production code.
 *
 * Production routes MUST NOT consult x-user-id / x-actor-user-id /
 * x-actor-email / x-company-id to resolve the caller. Identity comes from the
 * session cookie (cap_uid) via loadUserContext. Headers are only consumed by
 * the test-only `installV14TestIdentity` shim under server/__tests__/.
 *
 * This test greps the production tree and fails if any non-test file still
 * reads those headers.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

const TREE = "/home/user/workspace/avi_v14_tree";

describe("v14: identity-from-header banned in production", () => {
  it("zero hits in non-test, non-comment server code", () => {
    // grep -n gives file:line:content so we can post-filter out comment lines
    // (// or * prefix). Anchor only on the literal header keys.
    const raw = execSync(
      `grep -rn 'headers\\["x-\\(user-id\\|actor-user-id\\|actor-email\\|company-id\\)"\\]' server/ || true`,
      { cwd: TREE, encoding: "utf8" },
    );
    const hits = raw
      .split("\n")
      .filter((l) => l.length > 0)
      .filter((l) => {
        const file = l.split(":")[0] ?? "";
        if (file.includes("__tests__")) return false;
        if (file.includes("_v14TestIdentity")) return false;
        if (file.includes(".bak")) return false;
        if (file.endsWith(".test.ts")) return false;
        // Drop comment-only lines (// ... or * ...).
        const content = l.slice(l.indexOf(":", l.indexOf(":") + 1) + 1).trimStart();
        if (content.startsWith("//")) return false;
        if (content.startsWith("*")) return false;
        return true;
      });
    if (hits.length > 0) {
      throw new Error(
        `v14 lint: identity-from-header in production code:\n  ${hits.join("\n  ")}`,
      );
    }
    expect(hits).toHaveLength(0);
  });
});
