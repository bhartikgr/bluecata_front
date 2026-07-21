/**
 * W-FIX2c F4 — systemic "first click doesn't register" flakiness.
 *
 * Confirmed live across sidebar nav ("Cap Table", "New round") and category
 * tabs: the first pixel-click no-ops, a second click works.
 *
 * Root cause (shared): (a) Radix controlled `onValueChange` can drop the first
 * pointer interaction (already guarded on the RoundNew category tabs by an
 * idempotent onClick in W-FIX1 — locked here so it can't regress); and (b) a
 * primary action rendered as <Link><Button/></Link> nests a <button> inside an
 * <a> (invalid interactive nesting) which swallows the first click. A real
 * single <button> that navigates via setLocation acts on the first click.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rounds = readFileSync(resolve(__dirname, "..", "Rounds.tsx"), "utf8");
const roundNew = readFileSync(resolve(__dirname, "..", "RoundNew.tsx"), "utf8");

describe('W-FIX2c F4 — "New round" primary button acts on the first click', () => {
  it("renders a real button that navigates via setLocation (no nested button-in-anchor)", () => {
    const block = rounds.slice(
      rounds.indexOf('data-testid="button-new-round"') - 400,
      rounds.indexOf('data-testid="button-new-round"') + 120,
    );
    expect(block).toContain('onClick={() => setLocation("/founder/rounds/new")}');
    // the old <Link href="/founder/rounds/new"><Button ...> nesting is gone.
    expect(rounds).not.toMatch(/<Link href="\/founder\/rounds\/new">\s*<Button/);
  });
});

describe("W-FIX2c F4 — category tabs keep the idempotent first-click guard", () => {
  it("the controlled round-category tabs still call setRoundCategory on click", () => {
    const tabs = roundNew.slice(
      roundNew.indexOf("round-category-tabs"),
      roundNew.indexOf("round-category-tabs") + 700,
    );
    expect(tabs).toContain("onClick={() => setRoundCategory(cat.value)}");
  });
});
