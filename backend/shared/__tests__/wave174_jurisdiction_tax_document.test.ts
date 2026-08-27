/**
 * WAVE 174 · R142 / R144.3 — THE JURISDICTION → TAX-DOCUMENT MODEL.
 *
 * Owner, verbatim: "With regard to taxes, remember that this is an
 * international platform. Maybe we can first focus on high level guidance for
 * US, Canadian, and MAYBE Hong Kong and Singapore GP/LPs?"
 *
 * This file pins the SHAPE of the honesty, not just the two known answers. The
 * dangerous failure mode here is not a missing entry — it is a CONFIDENT WRONG
 * ONE, so most of the assertions below exist to prove the table refuses to
 * invent a form name:
 *
 *  - A2/A3  the only two owner-stated forms, exactly.
 *  - B      every other jurisdiction is NOT on record, INCLUDING `hong_kong`
 *           and `singapore` which the owner named as "maybe".
 *  - C      EXHAUSTIVENESS: adding a jurisdiction without a tax entry fails
 *           here, and fails `tsc`, and the test proves the enum and the table
 *           have identical key sets rather than trusting the type.
 *  - D      no US form name can leak into a non-US entry, by content sweep.
 *  - E      unresolvable / empty / hostile input lands on a NOT-on-record
 *           answer — never a defaulted K-1 (R142.2.3).
 *  - F      the copy contains no tax advice, no figures and no filing guidance
 *           (R142.2.4), asserted by content, not by intention.
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
  SPV_TAX_DOCUMENT_US_FEDERAL_PACKAGE_CLARIFIER,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS,
  SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION,
  spvJurisdictionTaxDocument,
  type SpvJurisdiction,
} from "../spvEngine";

/* The two the owner actually stated. Nothing else may be `onRecord`. */
const OWNER_STATED: ReadonlyArray<{ code: SpvJurisdiction; documentName: string }> = [
  { code: "delaware", documentName: "Schedule K-1" },
  { code: "canadian_lp", documentName: "T5013" },
];

describe("WAVE 174 · A — the two owner-stated forms, and only those", () => {
  it("A1 anti-vacuity: the enum really carries all sixteen values, including the two 'maybe' ones", () => {
    expect(SPV_JURISDICTIONS.length).toBe(16);
    expect(SPV_JURISDICTIONS).toContain("hong_kong");
    expect(SPV_JURISDICTIONS).toContain("singapore");
    expect(SPV_JURISDICTIONS).toContain("delaware");
    expect(SPV_JURISDICTIONS).toContain("canadian_lp");
  });

  it("A2 delaware → Schedule K-1, attributed to the US authority", () => {
    const d = SPV_JURISDICTION_TAX_DOCUMENT.delaware;
    expect(d.onRecord).toBe(true);
    expect(d.documentName).toBe("Schedule K-1");
    expect(d.authority).toBe("US Internal Revenue Service");
    expect(d.jurisdictionLabel).toBe(SPV_JURISDICTION_LABELS.delaware);
  });

  it("A3 canadian_lp → T5013, attributed to the Canadian authority", () => {
    const c = SPV_JURISDICTION_TAX_DOCUMENT.canadian_lp;
    expect(c.onRecord).toBe(true);
    expect(c.documentName).toBe("T5013");
    expect(c.authority).toBe("Canada Revenue Agency");
    expect(c.jurisdictionLabel).toBe(SPV_JURISDICTION_LABELS.canadian_lp);
  });

  it("A4 EXACTLY two jurisdictions are on record — a third would be a guess", () => {
    /* ── SUPERSEDED BY WAVE 175, ON RESEARCH (R144.4 stale-test precedent) ────
       When this was written, a third on-record jurisdiction WOULD have been a
       guess: only two form names had been stated and R142.2.5 forbids inventing
       one. Wave 175 established three more against the issuing authority itself
       — the United Kingdom's SA800(PS), Mauritius's approved-form statement and
       Australia's statement of distribution — each carrying its source URL in
       `sources`. So "exactly two" is no longer the honest answer; it is now the
       stale one, and asserting it would keep four true statutory documents off
       an LP's screen.

       The ORIGINAL INTENT of this test is preserved and strengthened rather than
       dropped: the on-record set must be EXACTLY the researched, cited set, and
       nothing may join it without a citation. Wave 174's two remain pinned. */
    const onRecord = SPV_JURISDICTIONS.filter((c) => SPV_JURISDICTION_TAX_DOCUMENT[c].onRecord);
    for (const owner of OWNER_STATED) {
      expect(onRecord).toContain(owner.code);
    }
    expect(onRecord.sort()).toEqual(
      ["delaware", "canadian_lp", "united_kingdom", "mauritius", "australia"].sort(),
    );
    expect(onRecord.length).toBe(5);
    /* THE FENCE THAT REPLACES "two": every on-record jurisdiction must name a
       document AND cite where that name comes from. A guessed sixth entry cannot
       satisfy this, which is the protection the original count was standing in
       for. */
    for (const code of onRecord) {
      const t = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(t.documentName).not.toBeNull();
      expect(t.authority).not.toBeNull();
      expect(t.sources.length).toBeGreaterThanOrEqual(1);
      expect(t.sources.every((s) => s.url.startsWith("https://"))).toBe(true);
    }
  });
});

describe("WAVE 174 · B — everything else is 'Not on record', by ruling", () => {
  /* ── SUPERSEDED IN PART BY WAVE 175 (R144.4) ──────────────────────────────
     `united_kingdom`, `mauritius` and `australia` have LEFT this list: wave 175
     established a real statutory investor document for each, cited to the
     issuing authority. They are now covered by wave 175's own on-record tests
     and by A4 above. The eleven that remain still name no form, and each is
     still asserted below exactly as wave 174 asserted it. */
  const MUST_BE_NOT_ON_RECORD: SpvJurisdiction[] = [
    "singapore", "hong_kong", "cayman", "bvi", "other",
    "luxembourg", "ireland", "uae",
    "jersey", "guernsey", "netherlands",
  ];

  /* The three that moved, kept EXPLICIT rather than silently deleted, so the
     change of answer is visible in the test file that used to assert it. */
  const MOVED_TO_ON_RECORD_IN_WAVE_175: SpvJurisdiction[] = [
    "united_kingdom",
    "mauritius",
    "australia",
  ];

  it.each(MOVED_TO_ON_RECORD_IN_WAVE_175)(
    "B1b %s left this list in wave 175 because a real form was ESTABLISHED, not guessed",
    (code) => {
      const t = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(t.onRecord).toBe(true);
      expect(t.documentName).not.toBeNull();
      expect(t.authority).not.toBeNull();
      /* the condition on which it was allowed to move: a citation */
      expect(t.sources.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(MUST_BE_NOT_ON_RECORD)("B1 %s is NOT on record and names no form", (code) => {
    const t = SPV_JURISDICTION_TAX_DOCUMENT[code];
    expect(t.onRecord).toBe(false);
    /* null, not "" and not a placeholder string — a caller must be forced to
       choose the refusal copy rather than render an empty form name. */
    expect(t.documentName).toBeNull();
    expect(t.authority).toBeNull();
    expect(t.code).toBe(code);
  });

  it("B2 hong_kong and singapore are FIRST-CLASS enum members that still refuse to name a form", () => {
    /* The owner said "MAYBE Hong Kong and Singapore". A maybe is not a form
       name. R142.2.5: a wrong tax document name is worse than a missing one. */
    for (const code of ["hong_kong", "singapore"] as const) {
      expect(SPV_JURISDICTIONS).toContain(code);
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].documentName).toBeNull();
    }
  });

  it("B3 the not-on-record list is DERIVED and covers all fourteen", () => {
    /* SUPERSEDED COUNT (wave 175): fourteen became eleven when three real forms
       were established. The PROPERTY the test exists for is unchanged and is
       still asserted — the list is DERIVED from the table, so it cannot drift
       from what is actually rendered. */
    expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS.length).toBe(11);
    expect([...SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS].sort()).toEqual([...MUST_BE_NOT_ON_RECORD].sort());
    /* derived, not retyped: every member genuinely names no form, and every
       non-member genuinely does */
    for (const code of SPV_JURISDICTIONS) {
      const inList = SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS.includes(code);
      expect(inList).toBe(!SPV_JURISDICTION_TAX_DOCUMENT[code].onRecord);
    }
    /* and the three that left are NOT in it */
    for (const code of MOVED_TO_ON_RECORD_IN_WAVE_175) {
      expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD_JURISDICTIONS).not.toContain(code);
    }
  });

  it("B4 the OPEN OWNER DECISION list is the same minus `other`, which is unanswerable", () => {
    /* ── SUPERSEDED BY WAVE 175: THE OWNER DECISION ITSELF CHANGED ───────────
       Wave 174's open decision was "which form name applies in these thirteen".
       The research closed that question for every one of them. What it EXPOSED
       instead is a platform gap: in seven jurisdictions the answer depends on the
       vehicle's LEGAL FORM, and legal form is not a recorded field anywhere in
       the schema, so those seven can only ever be answered conditionally until
       the owner decides to record it. Wave 175 did not invent that field. So this
       list now holds the seven form-dependent jurisdictions.

       The two INVARIANTS this test was protecting are both kept: the list never
       contains the unanswerable `other`, and it is never empty while a question
       is open. */
    expect(SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION.length).toBe(7);
    expect(SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION).not.toContain(SPV_JURISDICTION_UNKNOWN);
    /* Hong Kong and Singapore were the owner's own two "maybe" jurisdictions.
       Hong Kong is now fully ANSWERED — it issues no investor form because it
       taxes the partnership itself — so it is correctly no longer pending.
       Singapore is still pending, on the legal-form question. */
    expect(SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION).toContain("singapore");
    expect(SPV_JURISDICTION_TAX_DOCUMENT.hong_kong.recordStatus).toBe("no_standard_form");
    expect(SPV_JURISDICTION_TAX_DOCUMENT.hong_kong.noStandardFormExplanation).not.toBeNull();
    /* every pending jurisdiction states the conditional it is pending ON */
    for (const code of SPV_TAX_DOCUMENT_PENDING_OWNER_DECISION) {
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].vehicleFormDependent).toBe(true);
      expect(SPV_JURISDICTION_TAX_DOCUMENT[code].vehicleFormConditional).not.toBeNull();
    }
  });
});

describe("WAVE 174 · C — EXHAUSTIVENESS: a new jurisdiction cannot be silently forgotten", () => {
  it("C1 the table's key set is IDENTICAL to the enum — no missing key, no stray key", () => {
    /* Deliberately checked at RUNTIME as well as by the Record<> type. A future
       builder who silences the compile error with a cast still fails here. */
    const tableKeys = Object.keys(SPV_JURISDICTION_TAX_DOCUMENT).sort();
    const enumKeys = [...SPV_JURISDICTIONS].sort();
    expect(tableKeys).toEqual(enumKeys);
  });

  it("C2 every entry is fully populated and self-consistent", () => {
    for (const code of SPV_JURISDICTIONS) {
      const t = SPV_JURISDICTION_TAX_DOCUMENT[code];
      expect(t, `missing tax-document entry for jurisdiction "${code}"`).toBeDefined();
      /* The key and the payload agree, so a copy-paste cannot mis-file an entry
         under the wrong jurisdiction. */
      expect(t.code).toBe(code);
      /* The label is not re-typed; it is the one already shown elsewhere. */
      expect(t.jurisdictionLabel).toBe(SPV_JURISDICTION_LABELS[code]);
      /* onRecord and documentName can never disagree in either direction. */
      expect(t.onRecord).toBe(t.documentName !== null);
      if (!t.onRecord) expect(t.authority).toBeNull();
      else expect(typeof t.authority).toBe("string");
    }
  });

  it("C3 `other` is on record for NOTHING — the explicit unknown stays unknown", () => {
    expect(SPV_JURISDICTION_UNKNOWN).toBe("other");
    expect(SPV_JURISDICTION_TAX_DOCUMENT[SPV_JURISDICTION_UNKNOWN].onRecord).toBe(false);
    expect(SPV_JURISDICTION_TAX_DOCUMENT[SPV_JURISDICTION_UNKNOWN].documentName).toBeNull();
  });
});

describe("WAVE 174 · D — no US form name may leak into a non-US entry", () => {
  const US_FORM_TOKENS = ["K-1", "K1", "1099", "1065", "Schedule K"];

  it("D1 content sweep: no non-US entry mentions a US form anywhere in its payload", () => {
    for (const code of SPV_JURISDICTIONS) {
      if (code === "delaware") continue;
      const blob = JSON.stringify(SPV_JURISDICTION_TAX_DOCUMENT[code]);
      for (const token of US_FORM_TOKENS) {
        expect(blob, `jurisdiction "${code}" leaks US form token "${token}"`).not.toContain(token);
      }
    }
  });

  it("D2 a Hong Kong vehicle's resolved document is not a K-1 under ANY spelling of the input", () => {
    for (const input of ["hong_kong", "Hong Kong", "hong kong sar", "HONG_KONG"]) {
      const t = spvJurisdictionTaxDocument(input);
      expect(t.documentName).toBeNull();
      expect(JSON.stringify(t)).not.toContain("K-1");
    }
  });
});

describe("WAVE 174 · E — resolution never DEFAULTS to a US form", () => {
  it("E1 empty, null, undefined and whitespace all resolve to a NOT-on-record answer", () => {
    for (const input of ["", "   ", null, undefined]) {
      const t = spvJurisdictionTaxDocument(input as string | null | undefined);
      expect(t.onRecord).toBe(false);
      expect(t.documentName).toBeNull();
    }
  });

  it("E2 an unrecognised jurisdiction string is NOT on record", () => {
    for (const input of ["atlantis", "zzz", "Republic of Nowhere", "{}"]) {
      expect(spvJurisdictionTaxDocument(input).onRecord).toBe(false);
    }
  });

  it("E3 the two known aliases for the US DO resolve to the K-1 — the fence is not vacuous", () => {
    /* Anti-vacuity for E1/E2: the resolver genuinely can reach `onRecord`, so
       the refusals above are refusals and not a broken lookup. */
    for (const input of ["delaware", "USA", "United States of America", "Delaware, USA"]) {
      const t = spvJurisdictionTaxDocument(input);
      expect(t.onRecord, `expected "${input}" to resolve to the US entry`).toBe(true);
      expect(t.documentName).toBe("Schedule K-1");
    }
    expect(spvJurisdictionTaxDocument("Canada").documentName).toBe("T5013");
  });
});

describe("WAVE 174 · F — the copy is informational, plain, and gives no advice", () => {
  const ALL_COPY = [
    SPV_TAX_DOCUMENT_NOT_ON_RECORD,
    SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE,
    SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
    SPV_TAX_DOCUMENT_US_FEDERAL_PACKAGE_CLARIFIER,
  ];

  it("F1 the refusal string is exactly the R111 Q13 wording", () => {
    expect(SPV_TAX_DOCUMENT_NOT_ON_RECORD).toBe("Not on record");
  });

  it("F2 it says plainly that this is not tax advice", () => {
    expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE.toLowerCase()).toContain("not tax advice");
  });

  it("F3 no copy contains a money figure, a percentage or a filing deadline", () => {
    for (const s of ALL_COPY) {
      expect(s).not.toMatch(/[$£€¥]/);
      expect(s).not.toMatch(/\d+\s*%/);
      /* No dates and no bare numbers that could read as an amount or a due
         date. "K-1", "1099" and "T5013" are FORM NAMES, not figures, so they
         are removed before the numeric sweep. */
      const withoutFormNames = s.replace(/K-1|1099|1065|T5013/g, "");
      expect(withoutFormNames).not.toMatch(/\d/);
    }
  });

  it("F4 no copy offers filing guidance or computes anything", () => {
    const FORBIDDEN = ["you must file", "file by", "deadline", "you owe", "your tax liability", "we calculate", "we will file"];
    for (const s of ALL_COPY) {
      for (const phrase of FORBIDDEN) {
        expect(s.toLowerCase(), `copy offers guidance via "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("F5 plain language (R77): no ALL-CAPS jargon token and no raw enum value on screen", () => {
    for (const s of ALL_COPY) {
      expect(s).not.toMatch(/\b[A-Z]{4,}\b/);
      expect(s).not.toContain("canadian_lp");
      expect(s).not.toContain("hong_kong");
      expect(s).not.toContain("SPV_");
    }
  });
});
