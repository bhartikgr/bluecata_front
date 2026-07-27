/**
 * W-AVI65 REVISE BLOCKER B (Gemini) — a co-member's EMAIL must never become the
 * DM displayTitle.
 *
 * displayNameResolver returns the user's EMAIL as `.name` with resolved:true
 * when no legal/display name exists. FIX 2's co-membership widening routes
 * founder↔investor pairs PAST the resolver's "Private Investor" early return and
 * into commsStore's own name backstops (dbLegalNameFor → sanitizeCommsName).
 * Both backstops must reject an email ('@'), matching the sibling
 * resolveCommsDisplayName which already forbids '@' ("NEVER returns an email").
 *
 * Round-1 hardened dbLegalNameFor; round-2 review found sanitizeCommsName still
 * lacked the guard on the same live return path. This test pins BOTH guards.
 *
 * These helpers are module-internal (not exported), so we assert the guard on
 * the actual source of the two functions — the precise thing that was missing —
 * rather than re-implementing the predicate inline (which would pass against
 * reverted code, the exact flaw called out in the earlier test).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "commsStore.ts"), "utf8");

/** Extract a function's source region by name: from its `function <name>`
 *  declaration up to the NEXT top-level `\nfunction ` (or EOF). This avoids the
 *  fragile brace-walker that mis-anchored on a TS inline object-type parameter
 *  (the exact bug the R3 review flagged). It intentionally over-captures (whole
 *  region incl. signature), which is safe because we only assert that a guard
 *  IS present in the region. */
function bodyOf(fnName: string): string {
  const start = src.indexOf(`function ${fnName}`);
  expect(start, `${fnName} must exist`).toBeGreaterThan(-1);
  const rest = src.slice(start + `function ${fnName}`.length);
  const nextDecl = rest.indexOf("\nfunction ");
  return nextDecl >= 0 ? rest.slice(0, nextDecl) : rest;
}

describe("W-AVI65 BLOCKER B — no email as DM display name (both backstops)", () => {
  it("dbLegalNameFor rejects an email", () => {
    const body = bodyOf("dbLegalNameFor");
    // must test for '@' (email) AND still reject raw ids.
    expect(body).toMatch(/includes\(["']@["']\)/);
    expect(body).toMatch(/u_|usr_|co_|cmp_|rnd_/);
  });

  it("sanitizeCommsName (the downstream backstop) also rejects an email", () => {
    const body = bodyOf("sanitizeCommsName");
    expect(body).toMatch(/includes\(["']@["']\)/);
  });

  it("the sibling resolveCommsDisplayName still forbids '@' (contract anchor)", () => {
    const body = bodyOf("resolveCommsDisplayName");
    expect(body).toMatch(/includes\(["']@["']\)/);
  });

  it("regression guard: no name backstop returns before an '@' test is applied", () => {
    // Both internal name helpers must contain the '@' guard; if a future edit
    // drops either, this suite goes red.
    for (const fn of ["dbLegalNameFor", "sanitizeCommsName"]) {
      expect(bodyOf(fn), `${fn} lost its '@' guard`).toContain('includes("@")');
    }
  });
});
