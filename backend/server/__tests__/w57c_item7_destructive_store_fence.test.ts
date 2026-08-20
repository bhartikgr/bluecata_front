/**
 * WAVE 57c · ITEM 7 (R37 approved order #7) — the guard on `clearLedger()`,
 * `clearFundedQueue()` and `deleteSoftCircle()`.
 *
 * These three exported functions destroy financially significant data
 * (`captable_commits`, `funded_queue`, `compliance_holds`, `soft_circles`), have
 * ZERO non-test callers, and had no guard of their own. R37: "one `import` from
 * being live … Add the guard now, not when called."
 *
 * `clearLedger` / `clearFundedQueue` live in SACRED `server/captableCommitStore.ts`,
 * so no in-function guard is available to this wave. The guard is therefore an
 * IMPORT FENCE (`scripts/lint/destructiveStoreFence.ts`) that fails if any
 * production source file imports, re-exports or calls them.
 *
 * ── BOTH POLES, WHICH IS THE WHOLE POINT OF A FENCE TEST ───────────────────
 * A fence that passes because it scans nothing is worse than no fence — Wave 7B
 * DA-3 found exactly that in `partnerClassificationScopeFence` (three fenced
 * paths that had never existed, silently checking nothing). So this file asserts:
 *   POSITIVE — the fence is CURRENTLY CLEAN over a non-trivial file count.
 *   NEGATIVE — the fence DETECTS each of the three names when they appear as an
 *              import, a re-export, or a call, in synthetic source. If the
 *              detector were broken, the clean run above would be meaningless.
 *   COVERAGE — the exemption list does not accidentally exempt the whole tree.
 */
import { describe, it, expect } from "vitest";
import {
  FENCED,
  isFenced,
  scanSource,
  collectSourceFiles,
  runDestructiveStoreFence,
  isExempt,
} from "../../scripts/lint/destructiveStoreFence";

describe("W57c item 7 — destructive-store import fence", () => {
  it("POSITIVE: the fence is clean over the production tree right now", () => {
    const { checked, violations } = runDestructiveStoreFence();
    // If this ever fails, a production file reached a cap-table-erasing function.
    expect(violations).toEqual([]);
    // …and it really scanned something. A fence over 0 files always passes.
    expect(checked.length).toBeGreaterThan(200);
  });

  it("COVERAGE: the fence scans the real route/store modules it is meant to protect", () => {
    const checked = collectSourceFiles();
    expect(checked).toContain("server/routes.ts");
    expect(checked).toContain("server/founderOpsRoutes.ts");
    expect(checked).toContain("server/adminV25Store.ts");
    // The two DEFINING modules are exempt (a definition is not a call site).
    expect(isExempt("server/captableCommitStore.ts")).toBe(true);
    expect(isExempt("server/softCircleStore.ts")).toBe(true);
    // Tests are exempt; production code is not.
    expect(isExempt("server/__tests__/anything.test.ts")).toBe(true);
    expect(isExempt("server/routes.ts")).toBe(false);
  });

  it("all three destructive names are fenced, and only by own-property lookup", () => {
    expect(Object.keys(FENCED).sort()).toEqual([
      "clearFundedQueue",
      "clearLedger",
      "deleteSoftCircle",
    ]);
    /* REGRESSION: the first version of this fence used `FENCED[name]`, which
       inherits Object.prototype, so every `x.toString()` in the tree matched and
       the fence reported hundreds of false violations. */
    expect(isFenced("toString")).toBe(false);
    expect(isFenced("constructor")).toBe(false);
    expect(isFenced("clearLedger")).toBe(true);
  });

  it("NEGATIVE: an IMPORT of a fenced name in production source is detected", () => {
    for (const name of Object.keys(FENCED)) {
      const v = scanSource(
        "server/someNewRoute.ts",
        `import { ${name} } from "./captableCommitStore";\nexport const x = 1;\n`,
      );
      expect(v.map((r) => `${r.kind}:${r.name}`)).toContain(`import:${name}`);
    }
  });

  it("NEGATIVE: a RENAMED import and a RE-EXPORT are detected too", () => {
    const renamed = scanSource(
      "server/someNewRoute.ts",
      `import { clearLedger as wipeEverything } from "./captableCommitStore";\n`,
    );
    expect(renamed.some((r) => r.name === "clearLedger" && r.kind === "import")).toBe(true);

    const reexport = scanSource(
      "server/someNewBarrel.ts",
      `export { deleteSoftCircle } from "./softCircleStore";\n`,
    );
    expect(reexport.some((r) => r.name === "deleteSoftCircle" && r.kind === "import")).toBe(true);
  });

  it("NEGATIVE: a CALL through a namespace object is detected", () => {
    const v = scanSource(
      "server/someNewRoute.ts",
      `import * as store from "./captableCommitStore";\nstore.clearFundedQueue();\n`,
    );
    expect(v.some((r) => r.name === "clearFundedQueue" && r.kind === "call")).toBe(true);
  });

  it("a COMMENT naming a fenced function does not trip the fence (comments are not code)", () => {
    const v = scanSource(
      "server/someNewRoute.ts",
      `/* Never import clearLedger() here — see W57c item 7. deleteSoftCircle too. */\nexport const y = 2;\n`,
    );
    expect(v).toEqual([]);
  });
});
