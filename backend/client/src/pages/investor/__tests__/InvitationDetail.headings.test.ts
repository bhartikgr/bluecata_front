// @vitest-environment jsdom
/**
 * FIX #9 (Wave 3) — semantic heading outline on the deal-detail page.
 *
 * The deal title is already exposed as the ONE <h1> per page via PageHeader
 * (data-testid="text-page-title"). This wave adds section-level headings: every
 * section CardTitle on InvitationDetail now carries role="heading" aria-level=2,
 * giving a valid h1 → h2 outline with NO visual change (className untouched) and
 * NO empty heading nodes (each has text/icon content). data-testids preserved.
 *
 * Source-invariant test (a full render of InvitationDetail requires mocking the
 * entire invitation/entitlement/query surface; the a11y semantics are static
 * markup best pinned by source assertions, matching the repo's existing
 * source-invariant test convention).
 *
 * Plain `.test.ts` → excluded from the tsc budget.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "InvitationDetail.tsx"),
  "utf8",
);
const APPSHELL = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "components", "AppShell.tsx"),
  "utf8",
);

describe("FIX #9 — deal-detail heading outline", () => {
  it("deal title is the single <h1> (via PageHeader) with its data-testid intact", () => {
    // PageHeader emits exactly one <h1> for the page title.
    expect(APPSHELL).toMatch(/<h1[\s\S]*?data-testid="text-page-title"/);
    // InvitationDetail passes the deal title to PageHeader.
    expect(SRC).toMatch(/<PageHeader[\s\S]*?title=\{i\.company\.name\}/);
  });

  it("every section CardTitle is a level-2 heading (role + aria-level)", () => {
    const total = (SRC.match(/<CardTitle\b/g) || []).length;
    const asHeading = (SRC.match(/<CardTitle role="heading" aria-level=\{2\}/g) || []).length;
    expect(total).toBeGreaterThan(0);
    // All CardTitle usages carry the heading semantics.
    expect(asHeading).toBe(total);
  });

  it("adds no empty heading nodes (headings retain their text/content)", () => {
    // No CardTitle is rendered empty: none is immediately self/closed with no children.
    expect(SRC).not.toMatch(/<CardTitle[^>]*\/>/);
    expect(SRC).not.toMatch(/<CardTitle[^>]*>\s*<\/CardTitle>/);
  });

  it("preserves section content data-testids (no silent drops)", () => {
    for (const id of [
      "card-wire-instructions-investor",
      "card-softcircle-recorded",
      "button-submit-softcircle",
    ]) {
      expect(SRC).toContain(`data-testid="${id}"`);
    }
  });
});
