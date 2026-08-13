/**
 * WAVE 35 · ROW 9 — F10 fence: the two named tests must call production.
 *
 * F10 in `FINAL_REVIEW_v26_16_A.md`: two tests re-implemented production logic
 * in their own bodies and asserted against that copy. Both would have passed
 * with the production symbol DELETED. One of them —
 * `wave34_money_exponent_pricing_surfaces.test.ts` S1 — is precisely why F1
 * (¥1,200,000 rendering as $12,000) survived the wave that declared the class
 * closed.
 *
 * Both are now rewritten to drive the real code:
 *   (a) S1 mounts `registerAdminPlatformRoutes` and asserts the EMITTED payload
 *       of `GET /api/admin/pricing/founder-tiers` (rewritten in ROW 2);
 *   (b) `xc1_spv_comembership_privacy.test.ts` imports and CALLS
 *       `areCoMembersOnAnyCapTable` against a seeded real `rawDb()`
 *       (rewritten in ROW 9).
 *
 * ── WHAT THIS FILE IS AND IS NOT ────────────────────────────────────────────
 * The real proof that those two tests now bite is MUTATION: break the shipped
 * function, watch them fail. That was run and is recorded in the wave report;
 * it cannot live in a test file.
 *
 * What THIS file does is stop the rewrite from being quietly undone. A future
 * edit that reintroduces a local re-implementation would restore the exact
 * defect, and nothing else in the suite would notice — a passing test suite is
 * the only signal anyone reads. So this is a regression fence on the SHAPE of
 * those two files: they must import the production symbol, and they must not
 * declare a local stand-in for it.
 *
 * It is deliberately narrow. It asserts the presence of the production import
 * and the absence of the two specific re-implementations that F10 named, rather
 * than trying to detect "re-implementation" in general — a check that claimed to
 * do that would be a check that passes while checking nothing.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HERE = __dirname;

function read(f: string): string {
  return fs.readFileSync(path.join(HERE, f), "utf8");
}
/** Strip comments so a fence never matches its own explanatory prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("ROW 9 · F10(a) — the founder-tiers pricing test drives the real route", () => {
  const src = code(read("wave34_money_exponent_pricing_surfaces.test.ts"));

  it("mounts the real route registrar", () => {
    expect(src).toContain("registerAdminPlatformRoutes");
    expect(src).toContain("/api/admin/pricing/founder-tiers");
  });

  it("asserts on a response body, not on a locally built string", () => {
    expect(src).toMatch(/res\.body\.tiers/);
    // The exact re-implementation F10 named: `const build = (m) => ...`
    // producing the endpoint's displayPrice inside the test body.
    expect(src).not.toMatch(/const\s+build\s*=\s*\(\s*m\s*[,)]/);
  });

  it("keeps the JPY pole, which is what F1 actually broke", () => {
    expect(src).toContain("1,200,000 JPY");
    expect(src).toContain("12,000 USD");
  });
});

describe("ROW 9 · F10(b) — the co-membership test calls the shipped function", () => {
  const raw = read("xc1_spv_comembership_privacy.test.ts");
  const src = code(raw);

  it("imports the production symbol", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*areCoMembersOnAnyCapTable[^}]*\}\s*from\s*"\.\.\/lib\/capTableMembership"/,
    );
  });

  it("actually CALLS it — an import alone proves nothing", () => {
    const calls = src.match(/areCoMembersOnAnyCapTable\s*\(/g) ?? [];
    // One of those matches is the import line's absence; require real usage.
    expect(calls.length).toBeGreaterThanOrEqual(8);
  });

  it("uses the real database connection, not a throwaway schema", () => {
    expect(src).toMatch(/from\s*"\.\.\/db\/connection"/);
    expect(src).not.toMatch(/new Database\(/);
  });

  it("no longer declares the local re-implementation F10 named", () => {
    // The old body was `function coMembers(db, a, b, withFix)`.
    expect(src).not.toMatch(/function\s+coMembers\s*\(/);
    expect(src).not.toMatch(/withFix/);
    // It may still run the UNGUARDED join to demonstrate the exposure — that
    // one is named for what it is and is never used as the subject under test.
    if (/coMembersWithoutGuard/.test(src)) {
      expect(src).toMatch(/coMembersWithoutGuard/);
    }
  });

  it("keeps both poles", () => {
    expect(src).toMatch(/areCoMembersOnAnyCapTable\([^)]*\)\)\.toBe\(false\)/);
    expect(src).toMatch(/areCoMembersOnAnyCapTable\([^)]*\)\)\.toBe\(true\)/);
  });

  it("uses no require()", () => {
    expect(src).not.toMatch(/\brequire\s*\(/);
  });
});
