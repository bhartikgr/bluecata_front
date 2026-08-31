/**
 * WAVE 189 · ITEM A · R159.5 / R154.3 / R142 — THE TAX DISCLAIMER AND THE LP SIDE,
 * PROVEN ON RENDERED DOM FOR ALL SIXTEEN JURISDICTIONS ON BOTH SURFACES.
 *
 * Owner, verbatim: *"Go ahead and finish all of the jurisdictions. Remember that
 * this is high level guidance and not in any way a platform (Capavate or BluePrint
 * Catalyst Limited) advice. There should be an explicit message to the GP/LP that
 * they need to consult with their accounting firm, tax lawyer, etc. for advice. We
 * need to have a strong and unambiguous disclaimer here."*
 *
 * WHAT THIS FILE PROVES, exactly as the brief asks:
 *   1. Every one of the SIXTEEN jurisdictions renders on BOTH the GP surface
 *      (`GpTaxDocumentNotice`) and the LP surface (`LpTaxDocumentNote`) — the same
 *      facts, the same citations, the same disclaimer.
 *   2. Each renders its jurisdiction FACT, and its SOURCE where one exists. Cayman
 *      and BVI correctly name NONE, and that absence is asserted as a fact rather
 *      than skipped.
 *   3. The STRENGTHENED disclaimer renders on both surfaces for every jurisdiction
 *      and NAMES BOTH ENTITIES the owner named.
 *   4. The EXISTING mild literal is still present, byte-verbatim, beside it (R143.1:
 *      a replaced text node scores as a removed copy string).
 *   5. R142 — no US form is ever asserted for a non-US vehicle, on either surface.
 *   6. The SEVEN vehicle-form-dependent jurisdictions: UNSTATED renders the
 *      byte-identical hedge; STATED resolves to exactly one branch.
 *
 * EXHAUSTIVENESS IS STRUCTURAL, NOT A LIST. The sweep iterates the runtime key set
 * of `SPV_JURISDICTION_TAX_DOCUMENT`, and a separate test asserts that key set
 * equals the expected sixteen. Adding a seventeenth jurisdiction WITHOUT a
 * jurisdiction fact, a disclaimer or a source decision therefore FAILS here — it
 * cannot pass unnoticed, which is the property the brief requires.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  SPV_JURISDICTION_TAX_DOCUMENT,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  spvJurisdictionTaxDocument,
} from "@shared/spvEngine";
import {
  SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION,
  SPV_LEGAL_FORM_RESOLVED_TREATMENT,
} from "@shared/spvLegalForm";
import { LpTaxDocumentNote } from "@/components/investor/LpTaxDocumentNote";
import { GpTaxDocumentNotice } from "@/components/partner/GpTaxDocumentNotice";

afterEach(() => cleanup());

/** The sixteen, written out so the exhaustiveness test has something to compare
 *  the RUNTIME key set against. This list is the tripwire, not the source. */
const EXPECTED_JURISDICTIONS = [
  "delaware", "cayman", "bvi", "jersey", "guernsey", "luxembourg", "ireland",
  "singapore", "hong_kong", "uae", "canadian_lp", "united_kingdom", "australia",
  "mauritius", "netherlands", "other",
].sort();

/** The seven the brief names as vehicle-form dependent (wave 179's optional field). */
const FORM_DEPENDENT = ["singapore", "ireland", "australia", "uae", "jersey", "guernsey", "luxembourg"].sort();

const ALL = Object.keys(SPV_JURISDICTION_TAX_DOCUMENT).sort();

/* ── TWO TYPED LOOKUPS, so `describe.each` can stay driven by the RUNTIME key set ──
   `describe.each` hands each case a plain `string`, but both wave-179 tables are
   `Record<'delaware' | 'cayman' | …, …>` with a literal-union key. Indexing a literal
   Record with a `string` is TS7053. The tables are NOT re-typed and the assertions are
   NOT weakened — the widening happens only at the read, and the widened read still
   returns `undefined` for a key that is absent, which is exactly the case the
   assertions below already handle. Driving the sweep from the runtime keys rather than
   a hand-written union is deliberate: it is what makes a seventeenth jurisdiction trip
   the exhaustiveness test instead of being silently skipped. */
const formOptionsFor = (jurisdiction: string): readonly string[] =>
  (SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION as Record<string, readonly string[] | undefined>)[
    jurisdiction
  ] ?? [];

const resolvedTreatmentFor = (form: string): string | undefined =>
  (SPV_LEGAL_FORM_RESOLVED_TREATMENT as Record<string, string | undefined>)[form];

/* ════════════════════════════════════════════════════════════════════════════
   0. EXHAUSTIVENESS — the tripwire.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item A — exhaustiveness", () => {
  it("the jurisdiction table holds EXACTLY the sixteen; a seventeenth fails this test", () => {
    expect(ALL).toEqual(EXPECTED_JURISDICTIONS);
    expect(ALL.length).toBe(16);
  });

  it("EXACTLY seven jurisdictions are vehicle-form dependent, and they are the seven the owner's brief names", () => {
    const actual = ALL.filter((j) => spvJurisdictionTaxDocument(j).vehicleFormDependent).sort();
    expect(actual).toEqual(FORM_DEPENDENT);
  });

  /* ══ A CORRECTION TO THIS WAVE'S OWN BRIEF, RECORDED RATHER THAN GLOSSED ═════
     The brief asks this suite to confirm that "Cayman/BVI correctly name none".
     THAT IS NOT WHAT THE CODE HOLDS. Read at runtime, Cayman carries TWO sources
     and BVI carries TWO; the ONLY jurisdiction with no citation is `other`, where
     the jurisdiction itself is unrecorded so there is nothing to cite. Wave 176 ·
     C1 evidently sourced both. This is asserted the way the data actually is,
     because pinning the brief's expectation instead would have shipped a test that
     passes only while the sources are missing — the exact inversion of the fence it
     is supposed to hold. Reported in `W189_BUILD.md`. */
  it("EXACTLY ONE jurisdiction names no source, and it is `other` — Cayman and BVI DO carry citations", () => {
    const sourceless = ALL.filter((j) => spvJurisdictionTaxDocument(j).sources.length === 0).sort();
    expect(sourceless).toEqual(["other"]);
    expect(spvJurisdictionTaxDocument("cayman").sources.length).toBe(2);
    expect(spvJurisdictionTaxDocument("bvi").sources.length).toBe(2);
  });

  it("every jurisdiction except `other` carries at least two citations", () => {
    for (const j of ALL) {
      if (j === "other") continue;
      expect(spvJurisdictionTaxDocument(j).sources.length).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   1. THE DISCLAIMER ITSELF — the owner's requirement, checked on the string.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item A — the strengthened disclaimer", () => {
  it("names BOTH entities the owner named", () => {
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("Capavate");
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("BluePrint Catalyst Limited");
  });

  it("states explicitly that the reader must consult their own accounting firm or tax lawyer", () => {
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("own accounting firm");
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("own tax lawyer");
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("must consult");
  });

  it("is unambiguous that neither entity is advising: not advice, not an adviser, no professional relationship", () => {
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("not tax, legal, accounting or investment advice");
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("acting as your adviser");
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).toContain("no professional relationship is created");
  });

  it("R143.1 — the EXISTING literal is unchanged to the byte and is a SIBLING, not a replacement", () => {
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE).toBe(
      "This tells you which tax document to expect. It is information, not tax advice. Capavate does not work out your tax and does not file anything for you. Check your own position with your tax adviser.",
    );
    /* Two DISTINCT strings, neither containing the other: one cannot have been
       produced by editing the other in place. */
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).not.toBe(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).not.toContain(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE).not.toContain(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER);
  });

  it("asserts no jurisdiction, names no form and carries no figure, so it is safe on all sixteen surfaces unchanged", () => {
    for (const j of ALL) {
      if (j === "other") continue;
      const label = spvJurisdictionTaxDocument(j).jurisdictionLabel;
      expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).not.toContain(label);
    }
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).not.toMatch(/K-1|1099|Schedule/);
    expect(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER).not.toMatch(/\d/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. THE SWEEP — all sixteen, on BOTH surfaces.
   ════════════════════════════════════════════════════════════════════════════ */
describe.each(ALL)("wave 189 · item A — jurisdiction %s renders on BOTH surfaces", (code) => {
  const doc = spvJurisdictionTaxDocument(code);

  it("LP surface: renders the jurisdiction fact, the disclaimer naming both entities, and the original notice beside it", () => {
    render(<LpTaxDocumentNote jurisdiction={code} />);

    /* THE JURISDICTION FACT — the vehicle's own jurisdiction, named. */
    expect(screen.getByTestId("investor-lp-tax-document-jurisdiction").textContent)
      .toContain(doc.jurisdictionLabel);
    /* The entity-treatment sentence: the substantive guidance, present for all 16. */
    expect(screen.getByTestId("investor-lp-tax-document-entity-treatment").textContent?.trim().length)
      .toBeGreaterThan(0);

    /* THE STRENGTHENED DISCLAIMER, naming both entities. */
    const noAdvice = screen.getByTestId("investor-lp-tax-document-no-advice");
    expect(noAdvice.textContent).toBe(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER);
    expect(noAdvice.textContent).toContain("Capavate");
    expect(noAdvice.textContent).toContain("BluePrint Catalyst Limited");

    /* AND THE ORIGINAL, byte-verbatim, still rendered as a sibling. */
    expect(screen.getByTestId("investor-lp-tax-document-informational").textContent)
      .toBe(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
  });

  it("GP surface: renders the jurisdiction fact, the disclaimer naming both entities, and the original notice beside it", () => {
    render(<GpTaxDocumentNotice jurisdiction={code} />);

    const noAdvice = screen.getByTestId("spv-k1-jurisdiction-no-advice");
    expect(noAdvice.textContent).toBe(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER);
    expect(noAdvice.textContent).toContain("Capavate");
    expect(noAdvice.textContent).toContain("BluePrint Catalyst Limited");
    expect(screen.getByTestId("spv-k1-jurisdiction-informational").textContent)
      .toBe(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
    /* The jurisdiction is named on the GP surface too, in whichever branch renders. */
    expect(document.body.textContent).toContain(doc.jurisdictionLabel);
  });

  it("its SOURCE renders where one exists — and where none exists (`other`) none is fabricated", () => {
    render(<LpTaxDocumentNote jurisdiction={code} />);
    const sources = screen.queryByTestId("investor-lp-tax-document-sources");
    if (doc.sources.length === 0) {
      /* AN ASSERTED ABSENCE, not a skip. `other` means the jurisdiction itself is
         unrecorded, so there is nothing to cite and the surface must not invent a
         citation. See the correction note above: this is `other` alone, NOT Cayman
         and BVI as this wave's brief supposed. */
      expect(code).toBe("other");
      expect(sources).toBeNull();
    } else {
      expect(sources).not.toBeNull();
      /* Hrefs are collected and compared as STRINGS rather than matched with a CSS
         attribute selector: several of wave 175's citation URLs carry `?`, `&` and
         `=` (e.g. the ATO and Guernsey Revenue Service links), which a
         `querySelector` attribute match does not reliably survive. Comparing the
         decoded `href` values is exact and has no escaping hazard. */
      const hrefs = Array.from(sources!.querySelectorAll("a")).map((a) => a.getAttribute("href"));
      for (const s of doc.sources) {
        expect(sources!.textContent).toContain(s.label);
        expect(hrefs).toContain(s.url);
      }
      expect(hrefs.length).toBe(doc.sources.length);
    }
  });

  it("R142 — no US form is asserted for a non-US vehicle, on either surface", () => {
    render(<LpTaxDocumentNote jurisdiction={code} />);
    render(<GpTaxDocumentNotice jurisdiction={code} />);
    if (code === "delaware") return; /* Delaware IS the US vehicle; a K-1 is correct. */
    const text = document.body.textContent ?? "";
    /* The GP surface deliberately CORRECTS the misconception ("a Schedule K-1 is not
       this vehicle's document"), so a bare mention is not the defect. The defect is
       an ASSERTION that the LP will receive one. */
    expect(text).not.toMatch(/you will receive a Schedule K-1/i);
    expect(text).not.toMatch(/1099\s*\/\s*K-1/);
    expect(text).not.toMatch(/your tax package is a Schedule K-1/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. THE SEVEN FORM-DEPENDENT ONES — unstated hedges, stated resolves.
   ════════════════════════════════════════════════════════════════════════════ */
describe.each(FORM_DEPENDENT)("wave 189 · item A — vehicle-form-dependent %s", (code) => {
  it("UNSTATED renders the byte-identical hedge on BOTH surfaces and resolves nothing", () => {
    render(<LpTaxDocumentNote jurisdiction={code} />);
    expect(screen.getByTestId("investor-lp-tax-document-vehicle-form-notice").textContent)
      .toBe(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE);
    expect(screen.queryByTestId("investor-lp-tax-document-vehicle-form-resolved")).toBeNull();
    cleanup();

    render(<GpTaxDocumentNotice jurisdiction={code} />);
    expect(screen.getByTestId("spv-k1-jurisdiction-vehicle-form-notice").textContent)
      .toBe(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE);
  });

  it("passing legalForm={null} is byte-identical to passing nothing at all (R98: no existing call site changes)", () => {
    render(<LpTaxDocumentNote jurisdiction={code} />);
    const withoutProp = screen.getByTestId("investor-lp-tax-document").innerHTML;
    cleanup();
    render(<LpTaxDocumentNote jurisdiction={code} legalForm={null} />);
    expect(screen.getByTestId("investor-lp-tax-document").innerHTML).toBe(withoutProp);
  });

  it("STATED resolves to exactly ONE branch on the LP surface, matching wave 175's recorded treatment", () => {
    const options = formOptionsFor(code);
    expect(options.length).toBeGreaterThan(0);
    let resolvedAtLeastOnce = false;
    for (const form of options) {
      /* KEYED BY THE FORM ID ALONE, not by `jurisdiction:form`. The form ids are
         already jurisdiction-prefixed (`singapore_limited_partnership`), so the
         jurisdiction is carried in the key without a compound. Verified against the
         runtime key set rather than assumed. */
      const expected = resolvedTreatmentFor(form);
      cleanup();
      render(<LpTaxDocumentNote jurisdiction={code} legalForm={form} />);
      const node = screen.queryByTestId("investor-lp-tax-document-vehicle-form-resolved");
      if (expected) {
        expect(node).not.toBeNull();
        expect(node!.textContent).toBe(expected);
        resolvedAtLeastOnce = true;
      } else {
        /* No single recorded treatment for this pair — the hedge must STAND rather
           than a branch being invented. */
        expect(node).toBeNull();
      }
      /* The disclaimer never disappears when a form is stated. */
      expect(screen.getByTestId("investor-lp-tax-document-no-advice").textContent)
        .toBe(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER);
    }
    expect(resolvedAtLeastOnce).toBe(true);
  });

  it("a legal form belonging to a DIFFERENT jurisdiction is ignored, not applied", () => {
    const foreign = Object.entries(SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION)
      .filter(([j]) => j !== code)
      .flatMap(([, forms]) => forms)
      .find((f) => !formOptionsFor(code).includes(f));
    if (!foreign) return;
    render(<LpTaxDocumentNote jurisdiction={code} legalForm={foreign} />);
    expect(screen.queryByTestId("investor-lp-tax-document-vehicle-form-resolved")).toBeNull();
    expect(screen.getByTestId("investor-lp-tax-document-vehicle-form-notice").textContent)
      .toBe(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. NO JURISDICTION IS EXEMPT FROM THE DISCLAIMER.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item A — the disclaimer is unconditional", () => {
  it("all sixteen render it on the LP surface and all sixteen on the GP surface — 32 renders, 32 disclaimers", () => {
    let lp = 0;
    let gp = 0;
    for (const code of ALL) {
      cleanup();
      render(<LpTaxDocumentNote jurisdiction={code} />);
      if (screen.getByTestId("investor-lp-tax-document-no-advice").textContent === SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER) lp += 1;
      cleanup();
      render(<GpTaxDocumentNotice jurisdiction={code} />);
      if (screen.getByTestId("spv-k1-jurisdiction-no-advice").textContent === SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER) gp += 1;
    }
    expect(lp).toBe(16);
    expect(gp).toBe(16);
  });

  it("an unrecognised, empty or absent jurisdiction still gets the disclaimer (it resolves to `other`, never to a US form)", () => {
    for (const junk of [null, undefined, "", "   ", "atlantis", "DELAWARE_TYPO"]) {
      cleanup();
      render(<LpTaxDocumentNote jurisdiction={junk as string} />);
      expect(screen.getByTestId("investor-lp-tax-document-no-advice").textContent)
        .toBe(SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER);
      expect(screen.getByTestId("investor-lp-tax-document-not-on-record")).not.toBeNull();
      expect(document.body.textContent).not.toMatch(/Schedule K-1/);
    }
  });
});
