/**
 * v23.4.7 Phase 2 (BUG 024) regression guard.
 *
 * Bug: the "+ New company" tile on SelectCompany.tsx used to call
 *   `navigate("/auth/signup")` which dropped already-authenticated founders
 *   back onto signup → and when /auth/signup redirected re-authed users away,
 *   they landed on the last-selected company's dashboard instead of a "create
 *   new company" UX. The fix wires the tile to open the existing
 *   `NewCompanyDialog` modal (same modal used by the top-bar CompanySwitcher).
 *
 * Source-level test (matches the vitest config which is .test.ts only — no
 * jsdom available). Asserts:
 *   1. NewCompanyDialog is imported.
 *   2. The "+ New company" tile's onClick opens the dialog (setNewCompanyOpen(true))
 *      and NO LONGER navigates to /auth/signup from that tile.
 *   3. The dialog is mounted with open/onOpenChange wired to the state setter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(__dirname, "..", "SelectCompany.tsx"),
  "utf8",
);

describe("SelectCompany — v23.4.7 Phase 2 (BUG 024) new-company tile", () => {
  it("imports NewCompanyDialog from @/components/NewCompanyDialog", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*NewCompanyDialog\s*\}\s*from\s*["']@\/components\/NewCompanyDialog["']/,
    );
  });

  it("declares a newCompanyOpen useState boolean", () => {
    expect(SOURCE).toMatch(/useState[^;]*newCompanyOpen|newCompanyOpen[^;]*useState/);
    expect(SOURCE).toMatch(/setNewCompanyOpen/);
  });

  it("\u201C+ New company\u201D tile (data-testid=card-new-company) wires onClick to open the dialog, NOT to /auth/signup", () => {
    // Locate the tile block by its data-testid, then check the onClick within
    // a reasonable window.
    const idx = SOURCE.indexOf('data-testid="card-new-company"');
    expect(idx).toBeGreaterThan(-1);
    // Take a window around the testid declaration covering the surrounding
    // props (the entire <Card ...> opening tag).
    const window = SOURCE.slice(Math.max(0, idx - 200), idx + 600);
    // The handler MUST open the modal:
    expect(window).toMatch(/setNewCompanyOpen\(true\)/);
    // And it MUST NOT navigate to /auth/signup from this tile anymore:
    expect(window).not.toMatch(/navigate\(["']\/auth\/signup["']\)/);
  });

  it("mounts <NewCompanyDialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen}/>", () => {
    expect(SOURCE).toMatch(
      /<NewCompanyDialog[\s\S]*?open=\{newCompanyOpen\}[\s\S]*?onOpenChange=\{setNewCompanyOpen\}/,
    );
  });
});
