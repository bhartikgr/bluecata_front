/**
 * WAVE 175 · R142 / R145.1 — THE RESEARCHED TAX-DOCUMENT MODEL, ALL FIFTEEN.
 *
 * Wave 174 shipped a table with two answers and fourteen refusals. That was
 * correct THEN — no other form name had been stated, and R142.2.5 forbids
 * guessing one. It is not correct now: every jurisdiction has been researched
 * against its own tax authority, and the finding is not "thirteen unknowns".
 *
 * THE FINDING THAT DRIVES THESE ASSERTIONS. Entity tax treatment is
 * VEHICLE-specific rather than jurisdiction-specific in seven of the fifteen
 * jurisdictions, and Capavate records `spv.jurisdiction` but does NOT record the
 * vehicle's legal form. So for those seven a single jurisdiction-to-form answer
 * would be confidently WRONG, and the model must state the CONDITIONAL instead
 * of asserting one treatment. Group D is the fence around exactly that, and it
 * asserts BOTH directions: the conditional is present AND no single treatment is
 * asserted as the answer.
 *
 * Group E is the fence around the second honesty distinction this wave adds:
 * "this jurisdiction issues no investor tax form" is an ESTABLISHED, SOURCED
 * ABSENCE and is NOT the same claim as "Capavate does not hold this". Ten
 * jurisdictions are the former; `other` alone is the latter. Collapsing the two
 * would report research as a data gap, or a data gap as research.
 *
 * Group F is the anti-guessing fence (R142.2.5 / R111 Q13): no form NUMBER is
 * stated for a document whose number the research could not establish, and no US
 * form token appears anywhere outside the `delaware` entry.
 *
 * Group G is the citation fence: every real jurisdiction carries at least one
 * source URL, because an investor-grade platform shows where its statements come
 * from and an uncited tax statement is indistinguishable from a guess.
 *
 * Group A keeps and EXTENDS wave 174's exhaustiveness fence: the runtime key-set
 * equality test that makes it impossible to add a jurisdiction without an entry.
 */
import { describe, it, expect } from "vitest";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_UNKNOWN,
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
  SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
  SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
  SPV_TAX_DOCUMENT_ON_RECORD_JURISDICTIONS,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS,
  SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION,
  spvJurisdictionTaxDocument,
  type SpvJurisdiction,
} from "../spvEngine";

/* The five jurisdictions with a real statutory investor document, and the exact
   document name each must carry. Retyped DELIBERATELY: these are statutory form
   names carried by a cited authority, and the test must fail if any is edited. */
const ON_RECORD: ReadonlyArray<[SpvJurisdiction, string, string]> = [
  ["delaware", "Schedule K-1", "US Internal Revenue Service"],
  ["canadian_lp", "T5013", "Canada Revenue Agency"],
  ["united_kingdom", "Partnership Statement SA800(PS)", "HM Revenue & Customs"],
  ["mauritius", "Statement of share of net income and tax deducted", "Mauritius Revenue Authority"],
  ["australia", "Statement of distribution", "Australian Taxation Office"],
];

/* The ten ESTABLISHED ABSENCES. */
const NO_STANDARD_FORM: readonly SpvJurisdiction[] = [
  "hong_kong",
  "singapore",
  "cayman",
  "bvi",
  "luxembourg",
  "ireland",
  "uae",
  "jersey",
  "guernsey",
  "netherlands",
];

/* The seven whose answer turns on the vehicle's LEGAL FORM. */
const VEHICLE_FORM_DEPENDENT: readonly SpvJurisdiction[] = [
  "singapore",
  "luxembourg",
  "ireland",
  "uae",
  "jersey",
  "guernsey",
  "australia",
];

/* US federal form tokens. None may appear outside the `delaware` entry. */
const US_FORM_TOKENS = ["K-1", "K1", "1099", "1065", "Schedule K"];

describe("WAVE 175 · A — exhaustiveness survives (extends wave 174)", () => {
  it("A1 · the tax table's key set EQUALS the jurisdiction enum, both ways", () => {
    const keys = Object.keys(SPV_JURISDICTION_TAX_DOCUMENT).sort();
    expect(keys).toEqual([...SPV_JURISDICTIONS].sort());
    /* Both directions, so neither an orphan entry nor a missing one can pass. */
    for (const code of SPV_JURISDICTIONS) {
      expect(Object.prototype.hasOwnProperty.call(SPV_JURISDICTION_TAX_DOCUMENT, code)).toBe(true);
    }
    for (const key of keys) {
      expect(SPV_JURISDICTIONS).toContain(key as SpvJurisdiction);
    }
    expect(keys.length).toBe(16);
  });

  it("A2 · every entry is self-consistent and labelled from the shared label table", () => {
    for (const code of SPV_JURISDICTIONS) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(e.code).toBe(code);
      expect(e.jurisdictionLabel).toBe(SPV_JURISDICTION_LABELS[code]);
      /* Treatment is ALWAYS stated — there is no silent entry. */
      expect(typeof e.entityTreatment).toBe("string");
      expect(e.entityTreatment.trim().length).toBeGreaterThan(20);
      /* `authority` is non-null exactly when a document is named (wave 174). */
      expect(e.authority === null).toBe(!e.onRecord);
      expect((e.documentName === null) === !e.onRecord).toBe(true);
      expect(Array.isArray(e.additionalDocuments)).toBe(true);
      expect(Array.isArray(e.sources)).toBe(true);
    }
  });

  it("A3 · recordStatus partitions the enum into exactly three disjoint groups", () => {
    const on = SPV_JURISDICTIONS.filter((c) => SPV_JURISDICTION_TAX_DOCUMENT[c].recordStatus === "on_record");
    const none = SPV_JURISDICTIONS.filter(
      (c) => SPV_JURISDICTION_TAX_DOCUMENT[c].recordStatus === "no_standard_form",
    );
    const unknown = SPV_JURISDICTIONS.filter(
      (c) => SPV_JURISDICTION_TAX_DOCUMENT[c].recordStatus === "not_on_record",
    );
    expect(on.length).toBe(5);
    expect(none.length).toBe(10);
    expect(unknown.length).toBe(1);
    expect(on.length + none.length + unknown.length).toBe(SPV_JURISDICTIONS.length);
    /* `onRecord` is true for exactly the on_record group and nothing else. */
    expect(on.every((c) => SPV_JURISDICTION_TAX_DOCUMENT[c].onRecord)).toBe(true);
    expect(none.every((c) => !SPV_JURISDICTION_TAX_DOCUMENT[c].onRecord)).toBe(true);
    expect(unknown).toEqual([SPV_JURISDICTION_UNKNOWN]);
  });

  it("A4 · the persisted enum order and membership are untouched", () => {
    /* These values are PERSISTED in `spv.jurisdiction`. Renaming or reordering
       them silently repoints live vehicles, so the order is pinned here. */
    expect([...SPV_JURISDICTIONS]).toEqual([
      "delaware",
      "cayman",
      "bvi",
      "canadian_lp",
      "united_kingdom",
      "singapore",
      "luxembourg",
      "ireland",
      "hong_kong",
      "uae",
      "jersey",
      "guernsey",
      "netherlands",
      "mauritius",
      "australia",
      "other",
    ]);
  });
});

describe("WAVE 175 · B — the five real statutory investor documents", () => {
  it("B1 · each names its document, its authority and its status", () => {
    for (const [code, name, authority] of ON_RECORD) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(e.documentName).toBe(name);
      expect(e.authority).toBe(authority);
      expect(e.onRecord).toBe(true);
      expect(e.recordStatus).toBe("on_record");
      /* A named document always carries its full statutory description and its
         governing revenue authority. */
      expect(typeof e.documentLongName).toBe("string");
      expect((e.documentLongName ?? "").length).toBeGreaterThan(40);
      expect(typeof e.taxAuthority).toBe("string");
      /* No "instead" content on a jurisdiction that HAS a form. */
      expect(e.investorReceivesInstead).toBeNull();
      expect(e.noStandardFormExplanation).toBeNull();
    }
    expect(ON_RECORD.length).toBe(5);
  });

  it("B2 · the derived on-record list is exactly those five, in enum order", () => {
    expect([...SPV_TAX_DOCUMENT_ON_RECORD_JURISDICTIONS]).toEqual([
      "delaware",
      "canadian_lp",
      "united_kingdom",
      "mauritius",
      "australia",
    ]);
  });

  it("B3 · Delaware carries the Form 1065 number plus K-3 and 1042-S", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.delaware;
    expect(e.formNumber).toBe("Schedule K-1 (Form 1065)");
    expect(e.taxAuthority).toBe("Internal Revenue Service");
    const extras = e.additionalDocuments.join(" | ");
    expect(extras).toContain("Schedule K-3");
    expect(extras).toContain("1042-S");
  });

  it("B4 · Canada carries T5013 plus NR4 for a non-resident partner", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.canadian_lp;
    expect(e.formNumber).toBe("T5013");
    expect(e.taxAuthority).toBe("Canada Revenue Agency");
    expect(e.additionalDocuments.join(" | ")).toContain("NR4");
    expect(e.documentLongName).toContain("Statement of Partnership Income");
  });

  it("B5 · the United Kingdom carries the SA800(PS) allocation", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.united_kingdom;
    expect(e.formNumber).toBe("SA800(PS)");
    expect(e.taxAuthority).toBe("HM Revenue & Customs");
    expect(e.documentLongName).toContain("Partnership Statement");
    expect(e.documentLongName).toContain("SA800");
  });

  it("B6 · Mauritius names the approved-form statement and states no number", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.mauritius;
    /* R111 Q13 / R142.2.5 — the authority describes it only as "a statement in
       an approved form", so there IS no number and none is invented. */
    expect(e.formNumber).toBeNull();
    expect(e.documentLongName).toContain("approved form");
    expect(e.documentLongName).toContain("share of net income");
    expect(e.documentLongName).toContain("tax deducted");
    expect(e.taxAuthority).toBe("Mauritius Revenue Authority");
  });

  it("B7 · Australia names the distribution statement AND the AMMA statement", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.australia;
    expect(e.formNumber).toBeNull();
    expect(e.documentLongName).toContain("statement of distribution");
    expect(e.documentLongName).toContain("AMMA");
    expect(e.documentLongName).toContain("attribution managed investment trust");
    expect(e.taxAuthority).toBe("Australian Taxation Office");
  });

  it("B8 · Australia states the Division 5A corporate-limited-partnership case", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.australia;
    const all = `${e.entityTreatment} ${e.vehicleFormConditional ?? ""}`;
    expect(all).toContain("Division 5A");
    expect(all).toContain("corporate limited partnership");
    /* And it says WHAT that means: taxed as a company, not as a partnership. */
    expect(all).toContain("as a company");
  });
});

describe("WAVE 175 · C — no US form leaks into a non-US jurisdiction", () => {
  it("C1 · no US form token appears anywhere in any non-Delaware entry", () => {
    for (const code of SPV_JURISDICTIONS) {
      if (code === "delaware") continue;
      const blob = JSON.stringify(SPV_JURISDICTION_TAX_DOCUMENT[code]);
      for (const token of US_FORM_TOKENS) {
        expect(blob).not.toContain(token);
      }
    }
  });

  it("C2 · anti-vacuity — the Delaware entry DOES contain those tokens", () => {
    const blob = JSON.stringify(SPV_JURISDICTION_TAX_DOCUMENT.delaware);
    for (const token of ["K-1", "1065", "Schedule K"]) {
      expect(blob).toContain(token);
    }
  });

  it("C3 · a Hong Kong vehicle resolves to no document at all", () => {
    const e = spvJurisdictionTaxDocument("hong_kong");
    expect(e.code).toBe("hong_kong");
    expect(e.documentName).toBeNull();
    expect(e.formNumber).toBeNull();
    expect(e.onRecord).toBe(false);
    /* Positively: Hong Kong taxes the PARTNERSHIP, in the partnership's name. */
    expect(e.taxAuthority).toBe("Inland Revenue Department");
    expect(e.entityTreatment).toContain("partnership's own name");
    expect(e.noStandardFormExplanation).toContain("taxes the partnership itself");
  });

  it("C4 · unresolvable, empty and unknown input all land on `other`, not on a form", () => {
    for (const input of [null, undefined, "", "   ", "atlantis", "K-1", "delaware "]) {
      const e = spvJurisdictionTaxDocument(input as string | null | undefined);
      if (input === "delaware ") {
        /* trimmed and resolved — the one input that legitimately IS Delaware */
        expect(e.code).toBe("delaware");
        continue;
      }
      expect(e.code).toBe(SPV_JURISDICTION_UNKNOWN);
      expect(e.documentName).toBeNull();
      expect(e.recordStatus).toBe("not_on_record");
    }
  });
});

describe("WAVE 175 · D — vehicle-form dependence is STATED, never resolved by guess", () => {
  it("D1 · exactly the seven researched jurisdictions are form-dependent", () => {
    expect([...SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS].sort()).toEqual(
      [...VEHICLE_FORM_DEPENDENT].sort(),
    );
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_DEPENDENT_JURISDICTIONS.length).toBe(7);
  });

  it("D2 · the conditional is present exactly when the flag is set, and says both cases", () => {
    for (const code of SPV_JURISDICTIONS) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(e.vehicleFormConditional === null).toBe(!e.vehicleFormDependent);
      if (!e.vehicleFormDependent) continue;
      const c = e.vehicleFormConditional as string;
      /* It must SAY it depends, and must not silently assert one answer. */
      expect(c).toContain("Depends on this vehicle's legal form");
      expect(c).toContain("Confirm with your administrator.");
      /* Two cases, contrasted — the wording carries a contrast conjunction. */
      expect(/\b(whereas|but|, and|or)\b/.test(c)).toBe(true);
      expect(c.length).toBeGreaterThan(120);
    }
  });

  it("D3 · Singapore states LP-transparent versus VCC-taxed-as-a-company", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.singapore;
    expect(e.vehicleFormDependent).toBe(true);
    const c = e.vehicleFormConditional as string;
    expect(c).toContain("limited partnership");
    expect(c).toContain("tax-transparent");
    expect(c).toContain("variable capital company");
    expect(c).toContain("taxed as a company");
    /* And it does NOT assert one of them as the answer for this vehicle. */
    expect(e.documentName).toBeNull();
  });

  it("D4 · Ireland states ILP-transparent versus regulated-fund gross roll-up", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.ireland;
    expect(e.vehicleFormDependent).toBe(true);
    const c = e.vehicleFormConditional as string;
    expect(c).toContain("investment limited partnership");
    expect(c).toContain("gross roll-up");
    expect(c).toContain("exit tax");
    expect(e.entityTreatment).toContain("13 February 2013");
  });

  it("D5 · the UAE states the opaque election and the authorised-partner declaration", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.uae;
    expect(e.vehicleFormDependent).toBe(true);
    expect(e.taxAuthority).toBe("Federal Tax Authority");
    expect((e.vehicleFormConditional as string)).toContain("elect to be treated as a taxable person");
    expect(e.noStandardFormExplanation).toContain("annual declaration");
    expect(e.noStandardFormExplanation).toContain("authorised partner");
    expect(e.noStandardFormExplanation).toContain("Federal Tax Authority");
  });

  it("D6 · Jersey and Guernsey each state partnership versus company", () => {
    for (const code of ["jersey", "guernsey"] as const) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(e.vehicleFormDependent).toBe(true);
      const c = e.vehicleFormConditional as string;
      expect(c.toLowerCase()).toContain("partnership");
      expect(c.toLowerCase()).toContain("company");
      expect(c).toContain("entity level");
    }
    expect(SPV_JURISDICTION_TAX_DOCUMENT.jersey.vehicleFormConditional).toContain(
      "limited liability company",
    );
  });

  it("D7 · Luxembourg states that the reverse-hybrid rule can displace transparency", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.luxembourg;
    expect(e.vehicleFormDependent).toBe(true);
    expect(e.entityTreatment).toContain("reverse-hybrid");
    expect((e.vehicleFormConditional as string)).toContain("reverse-hybrid");
  });

  it("D8 · the open OWNER DECISION is now the missing legal-form field, not form names", () => {
    /* Wave 174 exported this as the jurisdictions whose FORM NAME was unknown.
       The research closed every one of those. What is still open is a SCHEMA
       gap: the vehicle's legal form is not a recorded field anywhere, so these
       seven can only ever be answered conditionally until the owner decides to
       record it. This wave did NOT invent that field. */
    expect([...SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION].sort()).toEqual([...VEHICLE_FORM_DEPENDENT].sort());
    /* Every pending jurisdiction carries the conditional it is pending ON. */
    for (const code of SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION) {
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].vehicleFormConditional).not.toBeNull();
    }
  });

  it("D9 · the notice explains WHY both cases are shown, and names the gap", () => {
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE).toContain("depends on this vehicle's legal form");
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE).toContain("does not record the legal form");
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE).toContain("both cases");
    expect(SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE).toContain("administrator");
  });
});

describe("WAVE 175 · E — an established absence is not a data gap", () => {
  it("E1 · exactly the ten researched jurisdictions are no_standard_form", () => {
    expect([...SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS].sort()).toEqual(
      [...NO_STANDARD_FORM].sort(),
    );
    expect(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_JURISDICTIONS.length).toBe(10);
  });

  it("E2 · each states POSITIVELY why no form exists and what arrives instead", () => {
    for (const code of NO_STANDARD_FORM) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(e.recordStatus).toBe("no_standard_form");
      expect(typeof e.noStandardFormExplanation).toBe("string");
      expect((e.noStandardFormExplanation ?? "").length).toBeGreaterThan(80);
      expect(typeof e.investorReceivesInstead).toBe("string");
      expect((e.investorReceivesInstead ?? "").length).toBeGreaterThan(20);
      /* It must NOT be phrased as Capavate not holding something. */
      expect(e.noStandardFormExplanation).not.toContain("Capavate does not hold");
      expect(e.noStandardFormExplanation).not.toBe(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
    }
  });

  it("E3 · what arrives instead is a real artefact, not a placeholder", () => {
    /* At least one of the three things an investor actually gets. */
    for (const code of NO_STANDARD_FORM) {
      const instead = (SPV_JURISDICTION_TAX_DOCUMENT[code].investorReceivesInstead ?? "").toLowerCase();
      expect(
        instead.includes("financial statement") ||
          instead.includes("accounts") ||
          instead.includes("allocation") ||
          instead.includes("profit-share") ||
          instead.includes("distribution"),
      ).toBe(true);
    }
  });

  it("E4 · the governing authority is named wherever one exists", () => {
    const expected: Partial<Record<SpvJurisdiction, string>> = {
      hong_kong: "Inland Revenue Department",
      singapore: "Inland Revenue Authority of Singapore",
      luxembourg: "Administration des contributions directes",
      ireland: "Office of the Revenue Commissioners",
      uae: "Federal Tax Authority",
      jersey: "Revenue Jersey",
      guernsey: "Guernsey Revenue Service",
      netherlands: "Belastingdienst",
    };
    for (const [code, authority] of Object.entries(expected) as [SpvJurisdiction, string][]) {
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].taxAuthority).toBe(authority);
    }
    /* Cayman and the BVI have NO revenue administration, and the model says so
       by holding null rather than by naming an information-exchange body as if
       it were a tax authority. */
    expect(SPV_JURISDICTION_TAX_DOCUMENT.cayman.taxAuthority).toBeNull();
    expect(SPV_JURISDICTION_TAX_DOCUMENT.bvi.taxAuthority).toBeNull();
    expect(SPV_JURISDICTION_TAX_DOCUMENT.cayman.noStandardFormExplanation).toContain("no direct taxes");
    expect(SPV_JURISDICTION_TAX_DOCUMENT.bvi.noStandardFormExplanation).toContain(
      "no corporate income or capital gains tax",
    );
  });

  it("E5 · Singapore's duty is the precedent partner INFORMING the partners", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.singapore;
    expect(e.noStandardFormExplanation).toContain("precedent partner inform all the partners");
    expect(e.investorReceivesInstead).toContain("precedent partner");
  });

  it("E6 · the Netherlands states the 1 January 2025 change", () => {
    const e = SPV_JURISDICTION_TAX_DOCUMENT.netherlands;
    expect(e.entityTreatment).toContain("1 January 2025");
    expect(e.entityTreatment).toContain("no longer independently liable for corporate income tax");
    expect(e.noStandardFormExplanation).toContain("1 January 2025");
  });

  it("E7 · `other` is the ONLY not-on-record answer and is kept distinct", () => {
    expect([...SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS].sort()).toEqual(
      [...NO_STANDARD_FORM, SPV_JURISDICTION_UNKNOWN].sort(),
    );
    /* The DERIVED list is "does not name a form", which is 11 entries; the
       `not_on_record` STATUS is `other` alone. Those are different questions
       and the model answers both. */
    expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS.length).toBe(11);
    const e = SPV_JURISDICTION_TAX_DOCUMENT.other;
    expect(e.recordStatus).toBe("not_on_record");
    expect(e.noStandardFormExplanation).toBeNull();
    expect(e.investorReceivesInstead).toBeNull();
    expect(e.taxAuthority).toBeNull();
    expect(e.vehicleFormDependent).toBe(false);
    expect(e.sources).toEqual([]);
    expect(e.entityTreatment).toContain("Not on record");
  });

  it("E8 · the two headline strings are different sentences saying different things", () => {
    expect(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL).toBe("No standard investor tax form");
    expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD).toBe("Not on record");
    expect(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL).not.toBe(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
    expect(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE).toContain("not missing information");
    expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE).toContain("does not hold a confirmed tax document name");
  });
});

describe("WAVE 175 · F — nothing is guessed", () => {
  it("F1 · a form number is held ONLY where the research established one", () => {
    const withNumber = SPV_JURISDICTIONS.filter((c) => SPV_JURISDICTION_TAX_DOCUMENT[c].formNumber !== null);
    expect([...withNumber]).toEqual(["delaware", "canadian_lp", "united_kingdom"]);
    /* And the two documents that exist WITHOUT an established number hold null,
       so the surface renders "Not established" instead of a guess (R111 Q13). */
    for (const code of ["mauritius", "australia"] as const) {
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].onRecord).toBe(true);
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].formNumber).toBeNull();
    }
    expect(SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED).toBe("Not established");
  });

  it("F2 · no entry without a document names a form number or a document", () => {
    for (const code of SPV_JURISDICTIONS) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      if (e.onRecord) continue;
      expect(e.documentName).toBeNull();
      expect(e.documentLongName).toBeNull();
      expect(e.formNumber).toBeNull();
      expect(e.authority).toBeNull();
    }
  });

  it("F3 · no entry invents a form-like token in its treatment text", () => {
    /* A plausible-looking form number in prose is the same defect as one in the
       form field. Nothing outside Delaware, Canada, the UK and Australia's own
       statutory citations may look like a numbered form. */
    const allowed = new Set<SpvJurisdiction>(["delaware", "canadian_lp", "united_kingdom", "australia"]);
    for (const code of SPV_JURISDICTIONS) {
      if (allowed.has(code)) continue;
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      const prose = `${e.entityTreatment} ${e.vehicleFormConditional ?? ""} ${e.noStandardFormExplanation ?? ""} ${e.investorReceivesInstead ?? ""}`;
      expect(/\bForm\s+\d/.test(prose)).toBe(false);
      expect(/\bT\d{4}\b/.test(prose)).toBe(false);
      expect(/\bSA\d{3}\b/.test(prose)).toBe(false);
    }
  });

  it("F4 · Mauritius keeps I.T. form references OUT of the investor prose", () => {
    /* Mauritius genuinely has numbered ENTITY returns. They belong in the
       additional-documents list as context, not in the investor statement. */
    const e = SPV_JURISDICTION_TAX_DOCUMENT.mauritius;
    expect(e.additionalDocuments.join(" | ")).toContain("I.T. Form 6");
    expect(e.entityTreatment).not.toContain("I.T. Form");
    expect(e.documentName).not.toContain("I.T. Form");
  });
});

describe("WAVE 175 · G — every statement is attributable", () => {
  it("G1 · every real jurisdiction carries at least one source; only `other` has none", () => {
    for (const code of SPV_JURISDICTIONS) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      if (code === SPV_JURISDICTION_UNKNOWN) {
        expect(e.sources.length).toBe(0);
        continue;
      }
      expect(e.sources.length).toBeGreaterThanOrEqual(1);
    }
    const total = SPV_JURISDICTIONS.reduce(
      (n, c) => n + SPV_JURISDICTION_TAX_DOCUMENT[c].sources.length,
      0,
    );
    /* Fifteen jurisdictions, at least one apiece and several with three. */
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it("G2 · every source has a human label and an absolute https URL", () => {
    const seen = new Set<string>();
    for (const code of SPV_JURISDICTIONS) {
      for (const s of SPV_JURISDICTION_TAX_DOCUMENT[code].sources) {
        expect(typeof s.label).toBe("string");
        /* A label is a source NAME, never a bare URL, so the sentence still
           reads when the link is stripped. */
        expect(s.label.length).toBeGreaterThan(8);
        expect(s.label.startsWith("http")).toBe(false);
        expect(s.url.startsWith("https://")).toBe(true);
        expect(s.url).not.toContain(" ");
        seen.add(`${code}::${s.url}`);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(30);
  });

  it("G3 · each jurisdiction's sources are on its OWN authority's domain", () => {
    /* A citation that points at another country's tax authority would be worse
       than no citation, so the host is pinned per jurisdiction. */
    const expectedHost: Partial<Record<SpvJurisdiction, string>> = {
      delaware: "irs.gov",
      canadian_lp: "canada.ca",
      united_kingdom: "gov.uk",
      mauritius: "mra.mu",
      australia: "ato.gov.au",
      hong_kong: "ird.gov.hk",
      singapore: "iras.gov.sg",
      ireland: "revenue.ie",
      uae: "tax.gov.ae",
      jersey: "gov.je",
      netherlands: "belastingdienst.nl",
    };
    for (const [code, host] of Object.entries(expectedHost) as [SpvJurisdiction, string][]) {
      const hosts = SPV_JURISDICTION_TAX_DOCUMENT[code].sources.map((s) => s.url);
      expect(hosts.some((u) => u.includes(host))).toBe(true);
    }
    /* Guernsey's guidance is on gov.gg; Luxembourg's on a public .lu domain;
       Cayman's and the BVI's on their own government domains. */
    expect(SPV_JURISDICTION_TAX_DOCUMENT.guernsey.sources.every((s) => s.url.includes("gov.gg"))).toBe(true);
    expect(SPV_JURISDICTION_TAX_DOCUMENT.luxembourg.sources.every((s) => s.url.includes(".lu"))).toBe(true);
    expect(SPV_JURISDICTION_TAX_DOCUMENT.cayman.sources.some((s) => s.url.includes("ky"))).toBe(true);
    expect(SPV_JURISDICTION_TAX_DOCUMENT.bvi.sources.some((s) => s.url.includes("vg"))).toBe(true);
  });

  it("G4 · the sources label is a phrase a person would read", () => {
    expect(SPV_TAX_DOCUMENT_SOURCES_LABEL).toBe("Where this comes from");
  });
});

describe("WAVE 175 · H — it is information, not tax advice", () => {
  it("H1 · the not-advice line is reused unchanged from wave 174", () => {
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE).toContain("not tax advice");
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE).toContain("does not work out your tax");
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE).toContain("tax adviser");
  });

  it("H2 · no copy in the model contains a computed amount, rate figure or deadline date", () => {
    /* R142.2.4 — this model names documents. It must not drift into numbers a
       reader could mistake for their own position. Statutory dates and named
       statutory provisions are allowed; currency and per-cent figures are not. */
    for (const code of SPV_JURISDICTIONS) {
      const e = SPV_JURISDICTION_TAX_DOCUMENT[code];
      const prose = [
        e.entityTreatment,
        e.vehicleFormConditional ?? "",
        e.noStandardFormExplanation ?? "",
        e.investorReceivesInstead ?? "",
        e.documentLongName ?? "",
        ...e.additionalDocuments,
      ].join(" ");
      expect(/[$£€¥]/.test(prose)).toBe(false);
      expect(/\d\s?%/.test(prose)).toBe(false);
    }
  });

  it("H3 · the GP-side notices are informational and non-directive about filing", () => {
    expect(SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE).toContain("United States federal form");
    expect(SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE).toContain(
      "not this vehicle's investor tax document",
    );
    expect(SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE).toContain("must not be issued");
    expect(SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE).toContain("not on record");
    expect(SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE).toContain("Confirm the vehicle's jurisdiction");
  });
});
