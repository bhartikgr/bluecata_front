/**
 * Bug 1 regression — Investor Invitation page crash:
 *   "can't access property 'replace', ke.category is undefined"
 *
 * Root cause: the data-room file table cell (and the use-of-proceeds list)
 * called `f.category.replace("_", " ")` with no null guard. A freshly invited
 * investor's dataroom file can have a null/undefined `category`, so the call
 * threw and the error boundary took down the whole page.
 *
 * The repository's vitest config (vitest.config.ts) matches only `*.test.ts`
 * and runs in the default node environment WITHOUT jsdom / RTL (see the
 * ChapterSelector smoke test for the same documented constraint). Importing
 * InvitationDetail/CompanyDetail here would crash on radix's top-level
 * `document` access, so this regression test pairs:
 *   1) a behavioral check of the exact category-formatting contract (the thing
 *      that threw), proving the undefined/null case renders the "Uncategorized"
 *      fallback and a normal `data_room` renders "data room" — no throw; and
 *   2) source-text pins on the ACTUAL edited lines so any revert back to the
 *      unguarded `{f.category.replace(...)}` fails this test.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** The exact null-safe transform applied at InvitationDetail.tsx:603 and
 *  CompanyDetail.tsx:379. Mirrors the shipped inline guard. */
function renderCategory(category: string | null | undefined): string {
  return category ? category.replace("_", " ") : "Uncategorized";
}

describe("Bug 1 — dataroom file category is null-safe", () => {
  it("does NOT throw and shows the fallback when category is undefined", () => {
    expect(() => renderCategory(undefined)).not.toThrow();
    expect(renderCategory(undefined)).toBe("Uncategorized");
  });

  it("does NOT throw and shows the fallback when category is null", () => {
    expect(() => renderCategory(null)).not.toThrow();
    expect(renderCategory(null)).toBe("Uncategorized");
  });

  it("renders a normal category with the underscore replaced (unchanged behavior)", () => {
    expect(renderCategory("data_room")).toBe("data room");
    expect(renderCategory("financials")).toBe("financials");
  });
});

const INVITATION = path.resolve(__dirname, "..", "InvitationDetail.tsx");
const COMPANY = path.resolve(__dirname, "..", "CompanyDetail.tsx");

describe("Bug 1 — the shipped source keeps the guard (no revert to the crash)", () => {
  const invSrc = fs.readFileSync(INVITATION, "utf8");
  const coSrc = fs.readFileSync(COMPANY, "utf8");

  it("InvitationDetail dataroom cell uses the null-safe guard", () => {
    expect(invSrc).toContain(`{f.category ? f.category.replace("_", " ") : "Uncategorized"}`);
  });

  it("CompanyDetail dataroom cell uses the null-safe guard", () => {
    expect(coSrc).toContain(`{(f.category ?? "").replace("_", " ") || "Uncategorized"}`);
  });

  it("neither file still contains the unguarded crashing form", () => {
    expect(invSrc).not.toContain(`>{f.category.replace("_", " ")}`);
    expect(coSrc).not.toContain(`>{f.category.replace("_", " ")}`);
  });

  it("InvitationDetail use-of-proceeds guards category key + label and defaults to []", () => {
    /* ══ UPDATED BY WAVE 80 · ITEM 2 — THE GUARD IS STRONGER, NOT WEAKER. ══
       This assertion pinned the literal `(i.round.useOfProceeds ?? []).map(...)`.
       That expression's PURPOSE is "never call `.map` on something that is not an
       array", and it was written when the only possible values were an array or
       nullish.

       WAVE 80 made the founder round wizard actually PERSIST use of proceeds, which
       it had been discarding on every create, and the wizard collects it as ONE
       FREE-TEXT NARRATIVE. A string is neither an array nor nullish, so `?? []`
       would have passed a STRING to `.map` — Bug 1's crash, reintroduced by the
       very field this pin was protecting. The guard is now
       `Array.isArray(i.round.useOfProceeds) ? i.round.useOfProceeds : []`, which is
       strictly stronger: it excludes every non-array value, not only nullish ones.

       WHY NOT DERIVE ROWS FROM THE TEXT instead: that would mean Capavate inventing
       per-bucket percentages and dollar amounts the founder never entered and
       printing them on the document an investor decides from. The narrative renders
       verbatim in its own branch, with no percentage and no bar.
       Evidence: build_log/wave80/WAVE80_REPORT.md; render proof in
       client/src/pages/founder/__tests__/w80_disclosure_readers_render.test.tsx. */
    expect(invSrc).toContain(`(Array.isArray(i.round.useOfProceeds) ? i.round.useOfProceeds : []).map((u, idx) =>`);
    expect(invSrc).toContain('key={u.category ?? `uof-${idx}`}');
    expect(invSrc).toContain(`{u.category ?? "Uncategorized"}`);
    /* AND THE WEAKER FORM IS GONE, so this cannot pass on both. */
    expect(invSrc).not.toContain(`(i.round.useOfProceeds ?? []).map(`);
    /* THE NARRATIVE BRANCH EXISTS and is guarded by a typeof check, so a string can
       never reach the rows branch and an array can never reach the narrative one. */
    expect(invSrc).toContain(`typeof i.round.useOfProceeds === "string"`);
  });

  it("InvitationDetail dataroom list defaults to [] before load", () => {
    expect(invSrc).toContain(`(dr.data ?? []).slice(0, 8).map(f =>`);
  });
});
