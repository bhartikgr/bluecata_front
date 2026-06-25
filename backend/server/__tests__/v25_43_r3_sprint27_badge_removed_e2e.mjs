/* v25.43 R3-7 — E2E (source assertion): the "Sprint 27 · admin separation"
 * debug badge is fully removed.
 *
 * Asserts:
 *   1. Zero occurrences of the literal "Sprint 27" across all client/src/**\/*.tsx.
 *   2. The AppShell no longer imports or renders SPRINT_BANNER (the badge JSX
 *      line is gone, not merely gated behind import.meta.env.DEV).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = join(__dirname, "../../client/src");

function walkTsx(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTsx(p));
    else if (entry.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

describe("v25.43 R3-7 — Sprint 27 badge removed", () => {
  it("no .tsx file under client/src contains the literal 'Sprint 27'", () => {
    const files = walkTsx(CLIENT_SRC);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("Sprint 27"));
    record("zero 'Sprint 27' matches in client/src/**/*.tsx", offenders.length === 0, offenders.join(", "));
    expect(offenders).toEqual([]);
  });

  it("AppShell no longer renders the SPRINT_BANNER badge", () => {
    const appShell = readFileSync(join(CLIENT_SRC, "components/AppShell.tsx"), "utf8");
    const ok = !appShell.includes("SPRINT_BANNER") && !appShell.includes('data-testid="badge-sprint"');
    record("AppShell badge JSX + import removed", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(
      `\n  v25.43 R3-7 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`,
    );
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
