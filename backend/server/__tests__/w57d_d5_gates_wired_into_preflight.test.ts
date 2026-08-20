/**
 * WAVE 57d · D5 — TWO GATES EXISTED AND NOTHING RAN THEM.
 *
 * `npm run preflight` chained eight gates. `lint:destructive-store-fence` (the
 * Wave 57c item-7 guard on the cap-table-erasing functions) and
 * `lint:percent-denominator-fence` (the Wave 52b AC-7 guard) were BOTH absent
 * from it, from every shell script, and from every CI config — the destructive
 * fence appeared exactly once in package.json: its own definition. Independent
 * Review 2 graded the gate area FAIL for exactly this.
 *
 * A gate nobody runs is worse than no gate: it manufactures false confidence,
 * which is the R21 dead-promise pattern applied to our own safety net.
 *
 * This test is the thing that keeps them wired. It is a pure static assertion
 * over package.json — no process is spawned — so it cannot be flaky, and if a
 * future wave drops either gate from `preflight` the suite goes red by NAME.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("W57d D5 — the standing gates are actually chained into preflight", () => {
  it("preflight runs lint:destructive-store-fence", () => {
    expect(pkg.scripts.preflight).toContain("npm run lint:destructive-store-fence");
  });

  it("preflight runs lint:percent-denominator-fence", () => {
    expect(pkg.scripts.preflight).toContain("npm run lint:percent-denominator-fence");
  });

  it("both gates are still DEFINED and point at the scripts they are named for", () => {
    expect(pkg.scripts["lint:destructive-store-fence"]).toContain("scripts/lint/destructiveStoreFence.ts");
    expect(pkg.scripts["lint:percent-denominator-fence"]).toContain("scripts/lint/percentDenominatorFence.ts");
  });

  it("REGRESSION FLOOR: preflight still runs everything it ran before 57d (nothing was traded away)", () => {
    for (const gate of [
      "npm run sacred",
      "npm run lint:money-exponent-fence",
      "npm run guard:snapshot:verify",
      "npm run guard:test",
      "npm run guard",
      "npm run reachability",
      "npm run coverage:ci",
      "npm run docs:verify",
    ]) {
      expect(pkg.scripts.preflight).toContain(gate);
    }
  });

  it("the money fence and the two newly wired fences are chained with && so a failure stops the run", () => {
    const chain = pkg.scripts.preflight.split("&&").map((s) => s.trim());
    expect(chain).toContain("npm run lint:destructive-store-fence");
    expect(chain).toContain("npm run lint:percent-denominator-fence");
    expect(chain).toContain("npm run lint:money-exponent-fence");
  });
});
