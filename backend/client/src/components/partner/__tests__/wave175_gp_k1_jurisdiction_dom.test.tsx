/**
 * WAVE 175 · R145.3.3 · R137.1 — THE GP-SIDE HALF OF THE MISLABELLING DEFECT.
 *
 * Wave 174 closed the LP-facing half: an LP in a Hong Kong vehicle is no longer
 * told to expect a "1099 / K-1". The GP-facing half stayed open, and R145.3.3
 * names it: a general partner with a Hong Kong vehicle could still open the K-1
 * tab and generate a document labelled "Schedule K-1" — a US FEDERAL form — with
 * nothing on that surface saying it is not this vehicle's investor tax document.
 *
 * WHAT THIS WAVE CHANGED, AND WHAT IT DID NOT.
 *
 * NOT the generation machinery. `server/spvK1Store.ts`, `server/spvK1Routes.ts`
 * and `server/lib/spvK1.ts` are byte-unchanged and still read no jurisdiction,
 * by ruling. Group D fences the untouched half from the client side: nothing in
 * this wave gates, blocks or alters generation.
 *
 * WHY IT LABELS RATHER THAN GATES — a considered decision, not an omission.
 * Disabling generation for every non-Delaware vehicle would break a workflow the
 * research documents as CORRECT: a US-taxable investor in a Cayman or BVI feeder
 * does receive a US Schedule K-1 prepared under US rules, even though the
 * vehicle's own jurisdiction levies no tax and issues no form. Removing the tool
 * from those GPs would trade a labelling defect for a functional one. So the
 * surface is made to tell the truth instead: it names the vehicle's jurisdiction,
 * says plainly that a Schedule K-1 is a US federal form and not this vehicle's
 * investor tax document, names what that jurisdiction does produce, and cites the
 * authority. Group C proves that is on screen for a Hong Kong vehicle.
 *
 * Group E is the R143.1 fence. The existing `spv-k1-policy` copy is NOT edited,
 * replaced or allow-listed — six previous builders tripped `drop:restyle` doing
 * exactly that. The new notice is a STATIC SIBLING above it, and the original
 * literal must still be on screen byte-verbatim.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GpTaxDocumentNotice } from "../GpTaxDocumentNotice";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_LABELS,
  SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
  SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS,
} from "@shared/spvEngine";

const P = "spv-k1-jurisdiction";

function mount(jurisdiction?: string | null) {
  render(<GpTaxDocumentNotice jurisdiction={jurisdiction} />);
}

afterEach(() => cleanup());

describe("WAVE 175 · A — a Delaware vehicle is told nothing is wrong", () => {
  it("A1 · a US vehicle gets the plain confirmation, not a warning", () => {
    mount("delaware");
    const us = screen.getByTestId(`${P}-us`);
    expect(us.textContent).toContain(SPV_JURISDICTION_LABELS.delaware);
    expect(us.textContent).toContain("A Schedule K-1 is this vehicle's investor tax document.");
    /* No warning box, because there is nothing to correct. */
    expect(screen.queryByTestId(`${P}-warning`)).toBeNull();
    expect(screen.queryByTestId(`${P}-not-this-vehicle`)).toBeNull();
  });
});

describe("WAVE 175 · B — every non-US vehicle gets the warning on screen", () => {
  it("B1 · the warning box is present for all fifteen non-Delaware jurisdictions", () => {
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      mount(code);
      if (code === "delaware") {
        expect(screen.queryByTestId(`${P}-warning`)).toBeNull();
        continue;
      }
      const box = screen.getByTestId(`${P}-warning`);
      expect(box).toBeTruthy();
      expect(screen.getByTestId(`${P}-heading`).textContent).toContain("Check the tax document");
      expect(screen.getByTestId(`${P}-label`).textContent).toContain(SPV_JURISDICTION_LABELS[code]);
      expect(screen.getByTestId(`${P}-informational`).textContent).toBe(
        SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
      );
      expect((box.textContent ?? "").length).toBeGreaterThan(200);
    }
  });

  it("B2 · a recorded non-US jurisdiction is told the US form is not this vehicle's document", () => {
    for (const code of SPV_JURISDICTIONS) {
      if (code === "delaware" || code === "other") continue;
      cleanup();
      mount(code);
      expect(screen.getByTestId(`${P}-not-this-vehicle`).textContent).toBe(
        SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
      );
      /* and it says what this jurisdiction DOES produce */
      expect((screen.getByTestId(`${P}-expected`).textContent ?? "").length).toBeGreaterThan(20);
      /* and it cites the authority it is relying on */
      expect(screen.getByTestId(`${P}-sources`)).toBeTruthy();
    }
  });

  it("B3 · a jurisdiction WITH a document names that document to the GP", () => {
    const expected: Array<[string, string]> = [
      ["canadian_lp", "T5013"],
      ["united_kingdom", "Partnership Statement SA800(PS)"],
      ["mauritius", "Statement of share of net income and tax deducted"],
      ["australia", "Statement of distribution"],
    ];
    for (const [code, doc] of expected) {
      cleanup();
      mount(code);
      const line = screen.getByTestId(`${P}-expected`).textContent ?? "";
      expect(line).toContain("This vehicle's partners expect:");
      expect(line).toContain(doc);
    }
  });

  it("B4 · a jurisdiction with NO form says so, and says what partners get instead", () => {
    for (const code of ["hong_kong", "singapore", "cayman", "bvi", "netherlands"] as const) {
      cleanup();
      mount(code);
      const line = screen.getByTestId(`${P}-expected`).textContent ?? "";
      expect(line).toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
      expect(line).toContain("Partners receive instead:");
    }
  });
});

describe("WAVE 175 · C — the Hong Kong case named in the ruling", () => {
  it("C1 · a Hong Kong vehicle's K-1 surface states the jurisdictional truth", () => {
    mount("hong_kong");
    /* anti-vacuity first: the box exists and is identified as Hong Kong */
    const box = screen.getByTestId(`${P}-warning`);
    expect(box).toBeTruthy();
    expect(screen.getByTestId(`${P}-label`).textContent).toContain(
      SPV_JURISDICTION_LABELS.hong_kong,
    );
    /* then the correction itself, on screen */
    const text = box.textContent ?? "";
    expect(text).toContain("A Schedule K-1 is a United States federal form.");
    expect(text).toContain("not this vehicle's investor tax document");
    expect(text).toContain("must not be issued");
    expect(text).toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
    expect(text).toContain("audited financial statements");
    /* and the source for that statement */
    expect(box.querySelector('a[href*="ird.gov.hk"]')).toBeTruthy();
  });

  it("C2 · an unrecorded jurisdiction is NOT told it is non-US — it is told nothing is known", () => {
    /* The platform must not claim a vehicle is non-US when it does not know
       where the vehicle is. `other` gets its own, weaker statement. */
    for (const input of [undefined, null, "", "atlantis"]) {
      cleanup();
      mount(input);
      expect(screen.getByTestId(`${P}-unknown`).textContent).toBe(
        SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
      );
      expect(screen.queryByTestId(`${P}-not-this-vehicle`)).toBeNull();
      expect(screen.queryByTestId(`${P}-expected`)).toBeNull();
      /* nothing to cite, so nothing is cited */
      expect(screen.queryByTestId(`${P}-sources`)).toBeNull();
    }
  });

  it("C3 · a vehicle-form-dependent jurisdiction shows the GP the conditional too", () => {
    for (const code of SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS) {
      cleanup();
      mount(code);
      expect(screen.getByTestId(`${P}-vehicle-form`).textContent).toContain(
        "Depends on this vehicle's legal form",
      );
      expect(screen.getByTestId(`${P}-vehicle-form-notice`).textContent).toBe(
        SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
      );
    }
    /* anti-vacuity: it is not simply always rendered */
    cleanup();
    mount("hong_kong");
    expect(screen.queryByTestId(`${P}-vehicle-form`)).toBeNull();
  });
});

describe("WAVE 175 · D — no jurisdiction is hardcoded on this surface", () => {
  it("D1 · the notice contains no country name of its own; all copy is shared", () => {
    /* Everything the GP reads is authored in `shared/spvEngine.ts` and resolved
       from the vehicle's stored value, so the surface cannot drift from the
       model or grow a per-country branch. */
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      mount(code);
      const root =
        screen.queryByTestId(`${P}-warning`) ?? screen.getByTestId(`${P}-us`);
      const text = root.textContent ?? "";
      /* the ONLY jurisdiction name on screen is this vehicle's own */
      for (const other of SPV_JURISDICTIONS) {
        if (other === code) continue;
        const label = SPV_JURISDICTION_LABELS[other];
        /* labels can legitimately share words (e.g. "United"), so only a whole
           label match counts as a leak */
        if (label === SPV_JURISDICTION_LABELS[code]) continue;
        expect(text.includes(`Vehicle jurisdiction: ${label}`)).toBe(false);
      }
    }
  });

  it("D2 · resolution is by the shared ontology, so a country name works too", () => {
    cleanup();
    mount("Hong Kong");
    expect(screen.getByTestId(`${P}-label`).textContent).toContain(
      SPV_JURISDICTION_LABELS.hong_kong,
    );
    cleanup();
    mount("Canada");
    expect(screen.getByTestId(`${P}-expected`).textContent).toContain("T5013");
  });
});
