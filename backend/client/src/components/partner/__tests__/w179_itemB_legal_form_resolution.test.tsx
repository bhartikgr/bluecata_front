/**
 * WAVE 179 · ITEM B · R151.3 — THE OPTIONAL LEGAL FORM, ON THE RENDERED SURFACE.
 *
 * R151.3's constraints are hard, and each one gets its own pole here, rendered
 * through the REAL `GpTaxDocumentNotice` — the component the K-1 tab actually
 * mounts — rather than asserted against the shared table alone. A resolution that
 * is correct in `shared/spvLegalForm.ts` and never reaches the GP's screen would
 * satisfy nothing (R137).
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   1 · UNSTATED IS BYTE-IDENTICAL TO TODAY. For each of the seven form-dependent
 *       jurisdictions, with no legal form, the two wave-175 hedge nodes render and
 *       their text is pinned CHARACTER-FOR-CHARACTER against the constants in
 *       `shared/spvEngine.ts`, which this wave did not edit. The resolved node is
 *       absent. `null`, `undefined`, `""` and whitespace all count as unstated.
 *   2 · STATED RESOLVES — every branch of every one of the seven. For each form,
 *       the resolved sentence renders, and the hedge is gone: the card no longer
 *       asks a question the GP has answered.
 *   3 · THE OTHER NINE ARE UNAFFECTED. They never render a hedge (they are not
 *       form-dependent) and they never render a resolution, even when a legal-form
 *       string is forced onto them.
 *   4 · NO CROSS-JURISDICTION LEAKAGE. A Singapore form on a Guernsey vehicle does
 *       NOT resolve; the Guernsey hedge stays. This is what makes pole 2 a proof
 *       about this vehicle rather than about the string.
 *   5 · NO INFERENCE. Nothing about the vehicle other than an explicit form value
 *       can produce a resolution: garbage strings, the jurisdiction's own name, the
 *       label text, and a form code with the wrong prefix all leave the hedge in
 *       place.
 *   6 · THE CITATIONS AND THE NOT-TAX-ADVICE SENTENCE SURVIVE RESOLUTION. Narrowing
 *       what we state must not quietly drop the sourcing or the disclaimer.
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GpTaxDocumentNotice } from "../GpTaxDocumentNotice";
import {
  SPV_JURISDICTIONS,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  spvJurisdictionTaxDocument,
} from "@shared/spvEngine";
import {
  SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION,
  SPV_LEGAL_FORM_RESOLVED_TREATMENT,
  SPV_LEGAL_FORM_LABELS,
} from "@shared/spvLegalForm";

const PREFIX = "spv-k1-jurisdiction";

/** The seven wave 175 recorded as legal-form dependent, read from the data itself. */
const FORM_DEPENDENT = SPV_JURISDICTIONS.filter(
  (j) => spvJurisdictionTaxDocument(j).vehicleFormDependent,
);
const NOT_FORM_DEPENDENT = SPV_JURISDICTIONS.filter(
  (j) => !spvJurisdictionTaxDocument(j).vehicleFormDependent,
);

function mount(jurisdiction: string, legalForm?: string | null) {
  cleanup();
  render(<GpTaxDocumentNotice jurisdiction={jurisdiction} legalForm={legalForm ?? null} />);
}

describe("WAVE 179 · ITEM B — legal form: hedge when unstated, resolve when stated", () => {
  it("POLE 0 — precondition: exactly SEVEN jurisdictions are form-dependent, and each offers options", () => {
    expect(FORM_DEPENDENT.length).toBe(7);
    expect(new Set(FORM_DEPENDENT)).toEqual(
      new Set(["singapore", "ireland", "australia", "uae", "jersey", "guernsey", "luxembourg"]),
    );
    for (const j of FORM_DEPENDENT) {
      expect(SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[j].length).toBeGreaterThan(0);
    }
    /* And the nine offer NONE — no invented forms. */
    expect(NOT_FORM_DEPENDENT.length).toBe(9);
    for (const j of NOT_FORM_DEPENDENT) {
      expect(SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[j]).toEqual([]);
    }
  });

  it("POLE 1 — UNSTATED renders wave 175's hedge BYTE-IDENTICALLY, for all four spellings of 'not stated'", () => {
    for (const j of FORM_DEPENDENT) {
      const doc = spvJurisdictionTaxDocument(j);
      for (const unstated of [null, undefined, "", "   "]) {
        mount(j, unstated as string | null);
        /* The conditional sentence, pinned to the wave-175 source string. */
        const hedge = screen.getByTestId(`${PREFIX}-vehicle-form`);
        expect(hedge.textContent).toBe(doc.vehicleFormConditional);
        /* And the sentence that names the legal form as the deciding factor. */
        const notice = screen.getByTestId(`${PREFIX}-vehicle-form-notice`);
        expect(notice.textContent).toBe(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE);
        /* Nothing resolved. */
        expect(screen.queryByTestId(`${PREFIX}-legal-form-resolved`)).toBeNull();
      }
    }
  });

  it("POLE 2 — STATED resolves to the single correct branch, for EVERY form of all seven", () => {
    let branches = 0;
    for (const j of FORM_DEPENDENT) {
      for (const form of SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[j]) {
        mount(j, form);
        const resolved = screen.getByTestId(`${PREFIX}-legal-form-resolved`);
        expect(resolved.textContent).toBe(SPV_LEGAL_FORM_RESOLVED_TREATMENT[form]);
        /* The hedge is GONE — the card no longer asks what it has been told. */
        expect(screen.queryByTestId(`${PREFIX}-vehicle-form`)).toBeNull();
        expect(screen.queryByTestId(`${PREFIX}-vehicle-form-notice`)).toBeNull();
        branches += 1;
      }
    }
    /* 2 + 2 + 3 + 3 + 3 + 3 + 2 branches across the seven. Pinned so a silently
       emptied option table cannot make this pole pass by iterating nothing. */
    expect(branches).toBe(18);
  });

  it("POLE 3 — the other NINE jurisdictions are unaffected, stated or not", () => {
    for (const j of NOT_FORM_DEPENDENT) {
      for (const attempt of [null, "singapore_variable_capital_company", "jersey_company", `${j}_company`]) {
        mount(j, attempt);
        expect(screen.queryByTestId(`${PREFIX}-vehicle-form`)).toBeNull();
        expect(screen.queryByTestId(`${PREFIX}-vehicle-form-notice`)).toBeNull();
        expect(screen.queryByTestId(`${PREFIX}-legal-form-resolved`)).toBeNull();
      }
    }
  });

  it("POLE 4 — NO CROSS-JURISDICTION LEAKAGE: another jurisdiction's form does not resolve here", () => {
    for (const j of FORM_DEPENDENT) {
      for (const other of FORM_DEPENDENT) {
        if (other === j) continue;
        for (const foreignForm of SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[other]) {
          mount(j, foreignForm);
          expect(screen.queryByTestId(`${PREFIX}-legal-form-resolved`)).toBeNull();
          /* The hedge must still be there: a foreign value is NOT an answer. */
          expect(screen.getByTestId(`${PREFIX}-vehicle-form-notice`)).toBeTruthy();
        }
      }
    }
  });

  it("POLE 5 — NO INFERENCE: nothing but an explicit valid form produces a resolution", () => {
    for (const j of FORM_DEPENDENT) {
      const attempts = [
        j, // the jurisdiction's own key
        `${j} limited partnership`, // prose
        SPV_LEGAL_FORM_LABELS[SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[j][0]], // the LABEL, not the code
        "limited partnership",
        "LP",
        "company",
        "Acme Ventures Fund I LP", // a vehicle NAME containing a form word
        `${j}_not_a_real_form`,
        "true",
        "0",
      ];
      for (const attempt of attempts) {
        mount(j, attempt);
        expect(screen.queryByTestId(`${PREFIX}-legal-form-resolved`)).toBeNull();
        expect(screen.getByTestId(`${PREFIX}-vehicle-form-notice`)).toBeTruthy();
      }
    }
  });

  it("POLE 6 — resolving does NOT drop the citations or the not-tax-advice sentence", () => {
    for (const j of FORM_DEPENDENT) {
      const doc = spvJurisdictionTaxDocument(j);
      const form = SPV_LEGAL_FORM_OPTIONS_BY_JURISDICTION[j][0];
      mount(j, form);
      if (doc.sources.length > 0) {
        expect(screen.getByTestId(`${PREFIX}-sources`)).toBeTruthy();
      }
      const informational = screen.getByTestId(`${PREFIX}-informational`);
      expect(informational.textContent).toBe(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
    }
  });
});
