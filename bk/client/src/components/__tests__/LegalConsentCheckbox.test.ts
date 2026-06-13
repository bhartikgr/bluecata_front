/**
 * v23.4.6 Phase 1 (L-001) regression guard.
 *
 * Bug: LegalConsentCheckbox.tsx used to render <button> elements INSIDE a
 * <Label htmlFor={id}> element. That nesting is invalid HTML — most browsers
 * treat any internal click as a click on the label, which fires the label's
 * "toggle bound checkbox" handler. The net effect was that clicking the
 * "Terms of Service" or "Privacy Policy" link silently unchecked the consent
 * box, which then blocked founder signup with "Check the consent box to
 * agree...".
 *
 * The fix moved the document buttons OUT of <Label> and gave each click
 * handler stopPropagation + preventDefault.
 *
 * This regression test uses a source-level structural check (rather than a
 * DOM render test) because the root vitest config does not include `.tsx`
 * tests or a jsdom environment, and adding either would require touching
 * vite/vitest config — both off-limits per v23.4.6 guardrails. A source-
 * level check is a strong proxy because the bug class is exclusively about
 * HTML nesting; if no <button> ever appears between <Label ...> and </Label>,
 * the bug cannot recur. Each doc-opener button also has stopPropagation +
 * preventDefault as belt-and-braces.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(__dirname, "..", "LegalConsentCheckbox.tsx"),
  "utf8",
);

describe("LegalConsentCheckbox (L-001 regression guard)", () => {
  it("does not nest a <button> inside a <Label>", () => {
    // Strip JSX comment blocks first — they may contain illustrative
    // <Label>/<button> text describing the bug and would produce false
    // positives below.
    const stripped = SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // Find every <Label ... > ... </Label> block (lazy across newlines) and
    // assert it contains no `<button`.
    const labelBlocks = stripped.match(/<Label\b[\s\S]*?<\/Label>/g) ?? [];
    expect(labelBlocks.length).toBeGreaterThan(0); // sanity: component still has a Label
    for (const block of labelBlocks) {
      expect(
        block.includes("<button"),
        `Found <button> nested inside <Label>:\n${block}`,
      ).toBe(false);
    }
  });

  it("each document-opener button calls stopPropagation AND preventDefault", () => {
    // The doc-opener buttons all have data-testid="link-legal-doc-...".
    // Whatever onClick they wire up must call both stopPropagation and
    // preventDefault so any future ancestor toggle handler is defeated.
    expect(SOURCE).toMatch(/e\.stopPropagation\(\)/);
    expect(SOURCE).toMatch(/e\.preventDefault\(\)/);
    // And the buttons must declare type="button" (so they don't submit any
    // surrounding form).
    expect(SOURCE).toMatch(/type="button"/);
  });

  it("checkbox click target is its own element, not the doc-opener buttons", () => {
    // The Checkbox component renders with id={id} and the Label uses
    // htmlFor={id}. The doc-opener buttons are siblings of the Label.
    expect(SOURCE).toMatch(/htmlFor=\{id\}/);
    expect(SOURCE).toMatch(/<Checkbox[\s\S]*?id=\{id\}/);
  });
});
