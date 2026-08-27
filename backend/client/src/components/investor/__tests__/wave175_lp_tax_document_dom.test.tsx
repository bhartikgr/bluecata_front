/**
 * WAVE 175 · R137.1 — RENDERED-DOM PROOF OF THE RESEARCHED TAX STATEMENTS.
 *
 * R137.1: "an LP-facing claim is only verified when the MOUNTED component is
 * verified — a passing store test is not evidence that a user sees anything."
 * The shared-model test next door proves the researched TABLE is right. It
 * cannot prove an LP sees any of it, and the defect this line of work exists to
 * fix was exactly that: a correct jurisdiction model that the LP-facing screens
 * ignored. So every assertion below reads text OUT OF A MOUNTED COMPONENT.
 *
 * ── WHAT IS PROVEN ON SCREEN, EACH IN BOTH DIRECTIONS ───────────────────────
 *  A  `delaware`       shows Schedule K-1, with Form 1065 and K-3 / 1042-S
 *  B  `canadian_lp`    shows T5013
 *  C  `united_kingdom` shows Partnership Statement SA800(PS)
 *  D  `mauritius`      shows its approved-form statement and "Not established"
 *  E  `australia`      shows its statement AND names the Division 5A case
 *  F  `hong_kong`      shows NO US form token anywhere in its subtree
 *  G  form-dependent   shows the CONDITIONAL and asserts no single treatment
 *  H  no-standard-form shows the positive absence and what arrives instead
 *  I  `other`          shows "Not on record"
 *  J  all sixteen      render a non-empty, identified card through one loop
 *
 * ANTI-VACUITY IS ASSERTED FIRST, ALWAYS. "Hong Kong does not say K-1" passes
 * trivially against a component that renders nothing, or that threw. So group F
 * proves the card is PRESENT, IDENTIFIED as Hong Kong and CARRYING its Hong Kong
 * content BEFORE it makes a single negative assertion — and a Delaware card
 * mounted through the identical code path does show the K-1, so the negative is
 * a fact about the jurisdiction and not about the test.
 *
 * Assertions read the EXPORTED copy constants rather than retyped prose, so a
 * copy edit cannot make an assertion quietly stop matching and pass anyway. The
 * statutory FORM NAMES are retyped deliberately: they are the researched answer
 * and the test must fail if any of them changes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LpTaxDocumentNote } from "../LpTaxDocumentNote";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_LABELS,
  SPV_JURISDICTION_TAX_DOCUMENT,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE,
  SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  SPV_TAX_DOCUMENT_SOURCES_LABEL,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS,
  type SpvJurisdiction,
} from "@shared/spvEngine";

const P = "investor-lp-tax-document";

/* US federal form tokens. None of these may appear in a non-US vehicle's card. */
const US_FORM_TOKENS = ["Schedule K-1", "Schedule K", "K-1", "1099", "IRS", "Form 1065"];

function mount(jurisdiction: string | null | undefined) {
  render(<LpTaxDocumentNote jurisdiction={jurisdiction} />);
  return screen.getByTestId(P);
}

afterEach(() => cleanup());

describe("WAVE 175 · A — a Delaware vehicle names the Schedule K-1 on screen", () => {
  it("A1 · the mounted card names Schedule K-1 and the Internal Revenue Service", () => {
    const card = mount("delaware");
    expect(card).toBeTruthy();
    expect(screen.getByTestId(`${P}-name`).textContent).toBe("Schedule K-1");
    expect(screen.getByTestId(`${P}-jurisdiction`).textContent).toContain(
      SPV_JURISDICTION_LABELS.delaware,
    );
    expect(screen.getByTestId(`${P}-authority`).textContent).toContain("Internal Revenue Service");
    /* NOT the refusal, and NOT the established-absence headline. */
    expect(screen.queryByTestId(`${P}-not-on-record`)).toBeNull();
    expect(screen.queryByTestId(`${P}-no-standard-form`)).toBeNull();
  });

  it("A2 · the form number and the extra US documents are on screen", () => {
    mount("delaware");
    expect(screen.getByTestId(`${P}-form-number`).textContent).toContain("Schedule K-1 (Form 1065)");
    const extras = screen.getByTestId(`${P}-additional`).textContent ?? "";
    expect(extras).toContain("Schedule K-3");
    expect(extras).toContain("1042-S");
    expect(screen.getByTestId(`${P}-long-name`).textContent).toContain("Partner's Share of Income");
  });

  it("A3 · the sources are on screen as real links to the tax authority", () => {
    const card = mount("delaware");
    const sources = screen.getByTestId(`${P}-sources`);
    expect(sources.textContent).toContain(SPV_TAX_DOCUMENT_SOURCES_LABEL);
    const links = Array.from(card.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.some((a) => (a.getAttribute("href") ?? "").includes("irs.gov"))).toBe(true);
    /* A citation must read as a source NAME, not as a bare URL. */
    for (const a of links) {
      expect((a.textContent ?? "").startsWith("http")).toBe(false);
      expect((a.textContent ?? "").length).toBeGreaterThan(8);
    }
  });
});

describe("WAVE 175 · B — a Canadian vehicle names the T5013 on screen", () => {
  it("B1 · T5013, the Canada Revenue Agency, and NR4 for a non-resident", () => {
    const card = mount("canadian_lp");
    expect(screen.getByTestId(`${P}-name`).textContent).toBe("T5013");
    expect(screen.getByTestId(`${P}-form-number`).textContent).toContain("T5013");
    expect(screen.getByTestId(`${P}-authority`).textContent).toContain("Canada Revenue Agency");
    expect(screen.getByTestId(`${P}-additional`).textContent).toContain("NR4");
    /* No US form has leaked into the Canadian card. */
    for (const token of US_FORM_TOKENS) {
      expect(card.textContent ?? "").not.toContain(token);
    }
  });
});

describe("WAVE 175 · C — a United Kingdom vehicle names SA800(PS) on screen", () => {
  it("C1 · the Partnership Statement and HM Revenue & Customs are on screen", () => {
    const card = mount("united_kingdom");
    expect(screen.getByTestId(`${P}-name`).textContent).toBe("Partnership Statement SA800(PS)");
    expect(screen.getByTestId(`${P}-form-number`).textContent).toContain("SA800(PS)");
    expect(screen.getByTestId(`${P}-authority`).textContent).toContain("HM Revenue & Customs");
    expect(screen.getByTestId(`${P}-long-name`).textContent).toContain("SA800 Partnership Tax Return");
    expect(card.querySelector('a[href*="gov.uk"], a[href*="publishing.service.gov.uk"]')).toBeTruthy();
  });
});

describe("WAVE 175 · D — Mauritius shows its statement and refuses to invent a number", () => {
  it("D1 · the approved-form statement is named and the number says Not established", () => {
    mount("mauritius");
    expect(screen.getByTestId(`${P}-name`).textContent).toBe(
      "Statement of share of net income and tax deducted",
    );
    expect(screen.getByTestId(`${P}-long-name`).textContent).toContain("approved form");
    /* R111 Q13 / R142.2.5 — the authority publishes no number, so none is shown
       and none is guessed. */
    expect(screen.getByTestId(`${P}-form-number`).textContent).toContain(
      SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED,
    );
    expect(screen.getByTestId(`${P}-authority`).textContent).toContain("Mauritius Revenue Authority");
  });
});

describe("WAVE 175 · E — Australia shows its statement AND the Division 5A case", () => {
  it("E1 · the statement of distribution and the AMMA statement are both on screen", () => {
    mount("australia");
    expect(screen.getByTestId(`${P}-name`).textContent).toBe("Statement of distribution");
    const long = screen.getByTestId(`${P}-long-name`).textContent ?? "";
    expect(long).toContain("statement of distribution");
    expect(long).toContain("AMMA");
    expect(screen.getByTestId(`${P}-authority`).textContent).toContain("Australian Taxation Office");
    expect(screen.getByTestId(`${P}-form-number`).textContent).toContain(
      SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED,
    );
  });

  it("E2 · the corporate limited partnership case is named ON SCREEN, with Division 5A", () => {
    const card = mount("australia");
    const text = card.textContent ?? "";
    expect(text).toContain("corporate limited partnership");
    expect(text).toContain("Division 5A");
    expect(text).toContain("as a company");
    /* And it is presented as a CONDITIONAL, not as this vehicle's answer. */
    expect(screen.getByTestId(`${P}-vehicle-form`).textContent).toContain(
      "Depends on this vehicle's legal form",
    );
  });
});

describe("WAVE 175 · F — a Hong Kong vehicle shows NO US form, anywhere", () => {
  it("F1 · ANTI-VACUITY FIRST — the Hong Kong card is present and full of Hong Kong content", () => {
    const card = mount("hong_kong");
    /* 1. it exists */
    expect(card).toBeTruthy();
    /* 2. it is identified as Hong Kong */
    expect(screen.getByTestId(`${P}-jurisdiction`).textContent).toContain(
      SPV_JURISDICTION_LABELS.hong_kong,
    );
    /* 3. it carries the researched Hong Kong answer, not a blank */
    expect(screen.getByTestId(`${P}-no-standard-form`).textContent).toBe(
      SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
    );
    expect(screen.getByTestId(`${P}-tax-authority`).textContent).toContain("Inland Revenue Department");
    expect(screen.getByTestId(`${P}-entity-treatment`).textContent).toContain("partnership's own name");
    expect(screen.getByTestId(`${P}-no-standard-form-note`).textContent).toContain(
      "taxes the partnership itself",
    );
    expect(screen.getByTestId(`${P}-receives-instead`).textContent).toContain("audited financial statements");
    expect((card.textContent ?? "").length).toBeGreaterThan(400);
  });

  it("F2 · and ONLY THEN — no US form token appears anywhere in its subtree", () => {
    const card = mount("hong_kong");
    const text = card.textContent ?? "";
    for (const token of US_FORM_TOKENS) {
      expect(text).not.toContain(token);
    }
    /* Including in every attribute of every node, so a testid, title or href
       cannot smuggle a US form name onto the screen either. */
    const all = Array.from(card.querySelectorAll("*")) as HTMLElement[];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        for (const token of ["Schedule K", "1099", "1065"]) {
          expect(attr.value).not.toContain(token);
        }
      }
    }
  });

  it("F3 · the negative is a fact about Hong Kong, not about this test", () => {
    /* The identical code path, given `delaware`, DOES print the US form. If it
       did not, F2 would be worthless. */
    cleanup();
    const us = mount("delaware");
    expect(us.textContent ?? "").toContain("Schedule K-1");
    cleanup();
    const hk = mount("hong_kong");
    expect(hk.textContent ?? "").not.toContain("Schedule K-1");
  });

  it("F4 · no non-Delaware jurisdiction prints a US form token on screen", () => {
    for (const code of SPV_JURISDICTIONS) {
      if (code === "delaware") continue;
      cleanup();
      const card = mount(code);
      const text = card.textContent ?? "";
      for (const token of US_FORM_TOKENS) {
        expect(text).not.toContain(token);
      }
    }
  });
});

describe("WAVE 175 · G — a vehicle-form-dependent jurisdiction shows the CONDITIONAL", () => {
  it("G1 · Singapore states both cases on screen and asserts neither", () => {
    const card = mount("singapore");
    const conditional = screen.getByTestId(`${P}-vehicle-form`).textContent ?? "";
    expect(conditional).toContain("Depends on this vehicle's legal form");
    expect(conditional).toContain("limited partnership");
    expect(conditional).toContain("tax-transparent");
    expect(conditional).toContain("variable capital company");
    expect(conditional).toContain("taxed as a company");
    expect(conditional).toContain("Confirm with your administrator.");
    /* Nowhere does the card name a document as THE answer for this vehicle. */
    expect(screen.queryByTestId(`${P}-name`)).toBeNull();
    expect(screen.queryByTestId(`${P}-form-number`)).toBeNull();
    expect(card.textContent ?? "").toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
  });

  it("G2 · and the screen explains WHY it is showing a conditional at all", () => {
    mount("singapore");
    /* The platform records the jurisdiction and not the legal form, and says so
       rather than quietly picking one. */
    expect(screen.getByTestId(`${P}-vehicle-form-notice`).textContent).toBe(
      SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
    );
  });

  it("G3 · every one of the seven form-dependent jurisdictions shows both blocks", () => {
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS.length).toBe(7);
    for (const code of SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS) {
      cleanup();
      mount(code);
      const conditional = screen.getByTestId(`${P}-vehicle-form`).textContent ?? "";
      expect(conditional).toContain("Depends on this vehicle's legal form");
      expect(conditional).toContain("Confirm with your administrator.");
      expect(screen.getByTestId(`${P}-vehicle-form-notice`).textContent).toBe(
        SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
      );
    }
  });

  it("G4 · and a NON-dependent jurisdiction shows neither block", () => {
    /* Anti-vacuity for G3: the conditional is not simply always on screen. */
    for (const code of ["delaware", "canadian_lp", "united_kingdom", "hong_kong", "cayman", "other"] as const) {
      cleanup();
      mount(code);
      expect(screen.queryByTestId(`${P}-vehicle-form`)).toBeNull();
      expect(screen.queryByTestId(`${P}-vehicle-form-notice`)).toBeNull();
    }
  });

  it("G5 · Ireland, the UAE, Jersey, Guernsey and Luxembourg each show their own contrast", () => {
    const expected: Array<[SpvJurisdiction, string[]]> = [
      ["ireland", ["investment limited partnership", "gross roll-up", "exit tax"]],
      ["uae", ["unincorporated partnership", "elect to be treated as a taxable person"]],
      ["jersey", ["limited liability company", "entity level"]],
      ["guernsey", ["private-equity limited partnership", "entity level"]],
      ["luxembourg", ["reverse-hybrid", "entity level"]],
    ];
    for (const [code, phrases] of expected) {
      cleanup();
      mount(code);
      const conditional = screen.getByTestId(`${P}-vehicle-form`).textContent ?? "";
      for (const phrase of phrases) {
        expect(conditional).toContain(phrase);
      }
    }
  });
});

describe("WAVE 175 · H — an established absence reads as a finding, not as a gap", () => {
  it("H1 · all ten no-standard-form jurisdictions show the positive headline", () => {
    expect(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS.length).toBe(10);
    for (const code of SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS) {
      cleanup();
      const card = mount(code);
      expect(screen.getByTestId(`${P}-no-standard-form`).textContent).toBe(
        SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
      );
      /* what arrives instead, the sourced reason, and the "not missing data" line */
      expect((screen.getByTestId(`${P}-receives-instead`).textContent ?? "").length).toBeGreaterThan(30);
      expect((screen.getByTestId(`${P}-no-standard-form-note`).textContent ?? "").length).toBeGreaterThan(80);
      expect(screen.getByTestId(`${P}-no-standard-form-notice`).textContent).toBe(
        SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE,
      );
      /* and it is NOT the "we do not hold this" refusal */
      expect(screen.queryByTestId(`${P}-not-on-record`)).toBeNull();
      expect(screen.queryByTestId(`${P}-not-on-record-note`)).toBeNull();
      expect(card.textContent ?? "").not.toContain(SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE);
      /* every one of them cites its own authority on screen */
      expect(card.querySelectorAll("a").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("H2 · the Netherlands shows the 1 January 2025 change on screen", () => {
    const card = mount("netherlands");
    const text = card.textContent ?? "";
    expect(text).toContain("1 January 2025");
    expect(text).toContain("no longer independently liable for corporate income tax");
    expect(screen.getByTestId(`${P}-tax-authority`).textContent).toContain("Belastingdienst");
  });

  it("H3 · Singapore shows the precedent partner's inform-the-partners duty", () => {
    const card = mount("singapore");
    expect(card.textContent ?? "").toContain("precedent partner inform all the partners");
  });

  it("H4 · the UAE shows the authorised partner's annual declaration", () => {
    const card = mount("uae");
    const text = card.textContent ?? "";
    expect(text).toContain("annual declaration");
    expect(text).toContain("authorised partner");
    expect(text).toContain("Federal Tax Authority");
  });

  it("H5 · Cayman and the BVI show tax neutrality and name no tax authority", () => {
    for (const code of ["cayman", "bvi"] as const) {
      cleanup();
      const card = mount(code);
      expect(screen.getByTestId(`${P}-entity-treatment`).textContent).toContain("Tax-neutral");
      /* No revenue administration exists, so none is named — rather than naming
         an information-exchange body as though it were one. */
      expect(screen.queryByTestId(`${P}-tax-authority`)).toBeNull();
      expect(card.textContent ?? "").toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
    }
  });
});

describe("WAVE 175 · I — an unrecorded jurisdiction still says Not on record", () => {
  it("I1 · `other` shows the refusal, the reason, and no document", () => {
    const card = mount("other");
    expect(screen.getByTestId(`${P}-not-on-record`).textContent).toBe(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
    expect(screen.getByTestId(`${P}-not-on-record-note`).textContent).toBe(
      SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE,
    );
    expect(screen.queryByTestId(`${P}-name`)).toBeNull();
    expect(screen.queryByTestId(`${P}-no-standard-form`)).toBeNull();
    /* It is NOT dressed up as a researched absence — there is nothing to cite. */
    expect(card.textContent ?? "").not.toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
    expect(card.querySelectorAll("a").length).toBe(0);
  });

  it("I2 · an unrecognised, empty or missing value behaves identically", () => {
    for (const input of [null, undefined, "", "atlantis", "K-1"]) {
      cleanup();
      const card = mount(input);
      expect(screen.getByTestId(`${P}-not-on-record`).textContent).toBe(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
      expect(card.textContent ?? "").not.toContain("Schedule K-1");
    }
  });
});

describe("WAVE 175 · J — all sixteen jurisdictions render something true", () => {
  it("J1 · every jurisdiction renders an identified, non-empty card", () => {
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      const card = mount(code);
      expect(card).toBeTruthy();
      expect(screen.getByTestId(`${P}-jurisdiction`).textContent).toContain(
        SPV_JURISDICTION_LABELS[code],
      );
      /* exactly ONE of the three headlines, never zero and never two */
      const headlines = [
        screen.queryByTestId(`${P}-name`),
        screen.queryByTestId(`${P}-no-standard-form`),
        screen.queryByTestId(`${P}-not-on-record`),
      ].filter(Boolean);
      expect(headlines.length).toBe(1);
      /* the treatment is always stated, and the not-advice line is always shown */
      expect((screen.getByTestId(`${P}-entity-treatment`).textContent ?? "").length).toBeGreaterThan(20);
      expect(screen.getByTestId(`${P}-informational`).textContent).toBe(
        SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
      );
    }
  });

  it("J2 · a jurisdiction added without a tax entry cannot render a blank", () => {
    /* The compile-time fence is the exhaustive Record; this is its RUNTIME twin,
       because a cast or a JSON-loaded value would defeat the type. */
    for (const code of SPV_JURISDICTIONS) {
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code]).toBeDefined();
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].code).toBe(code);
    }
    expect(Object.keys(SPV_JURISDICTION_TAX_DOCUMENT).sort()).toEqual([...SPV_JURISDICTIONS].sort());
  });

  it("J3 · no rendered card contains a currency symbol or a per-cent figure", () => {
    /* R142.2.4 — this surface names documents. A number on it could be mistaken
       for the reader's own tax position. */
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      const card = mount(code);
      const text = card.textContent ?? "";
      expect(/[$£€¥]/.test(text)).toBe(false);
      expect(/\d\s?%/.test(text)).toBe(false);
    }
  });

  it("J4 · every citation link is safe and outward-pointing", () => {
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      const card = mount(code);
      for (const a of Array.from(card.querySelectorAll("a"))) {
        expect((a.getAttribute("href") ?? "").startsWith("https://")).toBe(true);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
      }
    }
  });
});
