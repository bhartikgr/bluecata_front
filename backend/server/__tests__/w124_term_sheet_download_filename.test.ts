/* ════════════════════════════════════════════════════════════════════════════
   WAVE 124 · FINDING 3 — THE THIRD TERM-SHEET SURFACE, STILL NAMING FILES
                          AFTER A DATABASE KEY.
   ════════════════════════════════════════════════════════════════════════════
   `server/track1Routes.ts` served term-sheet downloads as

       attachment; filename="term-sheet-<docId>.pdf"      (and .md)

   where `docId` is the `term_sheets` primary key. Wave 117 fixed the FIRST
   generator's header (`server/lib/pdfGenerators.ts:156`) and wave 123 fixed the
   CLIENT-side blob download (`client/src/pages/founder/TermSheet.tsx:636`), both
   onto `companyExportSlug()`; this route was the third surface and was never
   converted, so one document could reach a counterparty under two different
   names — and these files travel by email to investors and to counsel.

   The name is now `<company-slug>-term-sheet-<as-of>.<ext>` from the SAME wave
   110 helper the other two surfaces use — one derivation, three surfaces. The
   company name is resolved through `getCompanyNameById`, the same reader the
   markdown builder in this file uses, with the same guard: a resolved "name" that
   is only the company id echoed back is treated as NO name rather than leaked.
   `companyId` is deliberately not passed to the helper (mirroring wave 123),
   because that argument is its last-resort fallback and would put the id straight
   back into the filename this change exists to clean.

   FAIL-BEFORE PROOF: the two `not.toContain` assertions below match the
   pre-wave source verbatim; run recorded in `build_log/wave124/W124_TESTS.md` §4.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyExportSlug } from "../../client/src/lib/captable/exportProvenance";

const SRC = readFileSync(resolve(__dirname, "../track1Routes.ts"), "utf8");
/** The download handler only, so nothing can pass on unrelated code. */
const HANDLER = SRC.slice(
  SRC.indexOf("function handleTermSheetDownload"),
  SRC.indexOf("function parseCsvText"),
);

describe("(A) no download filename carries an internal identifier", () => {
  it("no longer names either format after the document id", () => {
    expect(HANDLER).not.toContain('filename="term-sheet-${id}.pdf"');
    expect(HANDLER).not.toContain('filename="term-sheet-${id}.md"');
    expect(HANDLER).not.toMatch(/filename="[^"]*\$\{id\}/);
  });

  it("builds both formats from the shared slug and the document's own date", () => {
    expect(HANDLER).toContain('filename="${slug}-term-sheet-${asOf}.pdf"');
    expect(HANDLER).toContain('filename="${slug}-term-sheet-${asOf}.md"');
    expect(SRC).toContain(
      'import { companyExportSlug } from "../client/src/lib/captable/exportProvenance"',
    );
  });

  it("does not hand the company id to the slug helper as a fallback", () => {
    expect(HANDLER).toContain("companyExportSlug({ companyName: companyNameForFile })");
    expect(HANDLER).not.toMatch(/companyExportSlug\(\{[^}]*companyId/);
  });

  it("treats a name that is only the id echoed back as no name at all", () => {
    expect(HANDLER).toContain("resolvedCompanyName.trim() !== (round ? round.companyId");
  });
});

describe("(B) the helper's output is safe to put on an email attachment", () => {
  it("produces a readable company slug with no internal token", () => {
    const slug = companyExportSlug({ companyName: "NovaPay Technologies, Inc." });
    expect(slug).toBe("novapay-technologies-inc");
    expect(slug).not.toMatch(/(co_|rnd_|ts_|u_)/);
  });

  it("degrades to the neutral slug rather than inventing a company", () => {
    /* With no name on record the filename must not fall back to a key. */
    expect(companyExportSlug({ companyName: null })).toBe("captable");
  });

  it("agrees with the two surfaces already converted", () => {
    /* Wave 117's server header and wave 123's client blob build the same stem. */
    const slug = companyExportSlug({ companyName: "Arboreal Systems" });
    expect(`${slug}-term-sheet-2026-08-22.pdf`).toBe(
      "arboreal-systems-term-sheet-2026-08-22.pdf",
    );
  });
});
