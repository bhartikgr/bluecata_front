/**
 * WAVE 3C / J-1 · J-3 — the widened jurisdiction enum and the
 * jurisdiction-conditional compliance ontology.
 *
 * The commercial invariant these tests lock: a non-US vehicle must NEVER be
 * shown US securities-law content (Form D, blue-sky notices, the 3(c)(1) ~100
 * investor soft cap, Tax ID / EIN), and an unknown jurisdiction must NEVER
 * silently resolve to a US one.
 */
import { describe, it, expect } from "vitest";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_COUNTRY,
  SPV_JURISDICTION_LABELS,
  SPV_JURISDICTION_COMPLIANCE,
  SPV_JURISDICTION_GENERIC_NOTICE,
  SPV_TOP_JURISDICTION_COUNTRIES,
  SPV_JURISDICTION_ENTITY_STRUCTURES,
  isSpvJurisdiction,
  resolveSpvJurisdiction,
  spvJurisdictionCompliance,
  spvFormationChecklist,
  spvFilingsChecklist,
  type SpvJurisdiction,
} from "../spvEngine";

/** Every US-only string that must not leak onto a non-US vehicle. */
const US_ONLY = [/Form D/i, /blue[- ]sky/i, /3\(c\)\(1\)/, /\bEIN\b/, /\bSEC\b/];

describe("J-1 — the widened SPV_JURISDICTIONS enum", () => {
  it("preserves the four pre-existing members, in order, at the front", () => {
    expect(SPV_JURISDICTIONS.slice(0, 4)).toEqual(["delaware", "cayman", "bvi", "canadian_lp"]);
  });

  it("covers every country in the existing 15-country ontology", () => {
    const covered = new Set(
      SPV_JURISDICTIONS.map((j) => SPV_JURISDICTION_COUNTRY[j]).filter((c): c is string => !!c),
    );
    for (const country of SPV_TOP_JURISDICTION_COUNTRIES) {
      expect(covered.has(country), `no enum member for ontology country "${country}"`).toBe(true);
    }
    // …and the ontology is the SAME 15 the entity-structure map is keyed on.
    expect(Object.keys(SPV_JURISDICTION_ENTITY_STRUCTURES).sort())
      .toEqual([...SPV_TOP_JURISDICTION_COUNTRIES].sort());
  });

  it("carries an explicit unknown member instead of coercing to a US one", () => {
    expect(isSpvJurisdiction("other")).toBe(true);
    expect(SPV_JURISDICTION_COUNTRY.other).toBeNull();
  });

  it("has a label, a country entry and compliance content for EVERY member (no fall-through)", () => {
    for (const j of SPV_JURISDICTIONS) {
      expect(SPV_JURISDICTION_LABELS[j], `missing label for ${j}`).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(SPV_JURISDICTION_COUNTRY, j)).toBe(true);
      expect(SPV_JURISDICTION_COMPLIANCE[j], `missing compliance content for ${j}`).toBeTruthy();
      expect(SPV_JURISDICTION_COMPLIANCE[j].code).toBe(j);
    }
  });
});

describe("J-1 — resolveSpvJurisdiction replaces deriveEngineJurisdiction's delaware collapse", () => {
  it("maps every ontology country to its own member, not delaware", () => {
    const expected: Record<string, SpvJurisdiction> = {
      "United States": "delaware",
      "Cayman Islands": "cayman",
      "British Virgin Islands": "bvi",
      "United Kingdom": "united_kingdom",
      "Singapore": "singapore",
      "Luxembourg": "luxembourg",
      "Ireland": "ireland",
      "Canada": "canadian_lp",
      "Hong Kong": "hong_kong",
      "United Arab Emirates": "uae",
      "Jersey": "jersey",
      "Guernsey": "guernsey",
      "Netherlands": "netherlands",
      "Mauritius": "mauritius",
      "Australia": "australia",
    };
    for (const country of SPV_TOP_JURISDICTION_COUNTRIES) {
      expect(resolveSpvJurisdiction(country), country).toBe(expected[country]);
    }
  });

  it("is idempotent on enum members and case-insensitive on country labels", () => {
    for (const j of SPV_JURISDICTIONS) expect(resolveSpvJurisdiction(j)).toBe(j);
    expect(resolveSpvJurisdiction("netherlands")).toBe("netherlands");
    expect(resolveSpvJurisdiction("  NETHERLANDS  ")).toBe("netherlands");
  });

  it("resolves unknown / blank / free-text input to \"other\" — never delaware", () => {
    for (const bad of ["", "   ", null, undefined, "Kingdom of Wakanda", "Mars", "Republic of Nowhere"]) {
      expect(resolveSpvJurisdiction(bad as string | null | undefined)).toBe("other");
    }
  });

  it("still normalises the legacy US free-text forms the server shim relied on", () => {
    for (const s of ["US", "usa", "State of Delaware, USA", "United States of America"]) {
      expect(resolveSpvJurisdiction(s)).toBe("delaware");
    }
  });
});

describe("J-3 — US securities content is scoped to US vehicles ONLY", () => {
  it("marks exactly one member as United States", () => {
    const us = SPV_JURISDICTIONS.filter((j) => SPV_JURISDICTION_COMPLIANCE[j].isUnitedStates);
    expect(us).toEqual(["delaware"]);
  });

  it("keeps Form D / blue-sky / 3(c)(1) / EIN on the US vehicle", () => {
    const us = spvJurisdictionCompliance("United States");
    expect(us.filings.some((f) => /Form D/.test(f))).toBe(true);
    expect(us.filings.some((f) => /Blue-sky/i.test(f))).toBe(true);
    expect(us.formationIdItem).toMatch(/EIN/);
    expect(us.investorCountLimit).toBe(100);
    expect(us.investorCountNote).toMatch(/3\(c\)\(1\)/);
    expect(us.filingsAreJurisdictionSpecific).toBe(true);
  });

  it("shows NO US item on ANY non-US jurisdiction", () => {
    for (const j of SPV_JURISDICTIONS) {
      if (j === "delaware") continue;
      const text = [
        ...spvFilingsChecklist(j),
        ...spvFormationChecklist(j),
        SPV_JURISDICTION_COMPLIANCE[j].investorCountNote,
        SPV_JURISDICTION_LABELS[j],
      ].join(" | ");
      for (const pattern of US_ONLY) {
        expect(pattern.test(text), `${j} leaks US content matching ${pattern}: ${text}`).toBe(false);
      }
      expect(SPV_JURISDICTION_COMPLIANCE[j].investorCountLimit).toBeNull();
    }
  });

  it("the live-defect vehicles get their own content, not the US block", () => {
    for (const country of ["British Virgin Islands", "Netherlands", "Mauritius", "Canada"]) {
      const c = spvJurisdictionCompliance(country);
      expect(c.isUnitedStates).toBe(false);
      expect(c.filings.join(" ")).not.toMatch(/Form D/);
      expect(spvFormationChecklist(country).join(" ")).not.toMatch(/EIN/);
    }
  });
});

describe("J-3 — neutral placeholder where we have no verified content, and we say so", () => {
  it("flags every non-verified jurisdiction so the UI can disclose it", () => {
    const verified = SPV_JURISDICTIONS.filter((j) => SPV_JURISDICTION_COMPLIANCE[j].filingsAreJurisdictionSpecific);
    // Only the US has jurisdiction-specific filing content Capavate can stand behind.
    expect(verified).toEqual(["delaware"]);
    expect(SPV_JURISDICTION_GENERIC_NOTICE).toMatch(/does not hold verified filing requirements/);
  });

  it("uses the neutral counsel-referral filing item everywhere else — and invents nothing", () => {
    for (const j of SPV_JURISDICTIONS) {
      if (j === "delaware") continue;
      expect(spvFilingsChecklist(j)).toEqual(["Check local regulatory notice requirements with your counsel"]);
    }
  });

  it("keeps the already-shipped Cayman / BVI entity-identifier wording", () => {
    expect(spvFormationChecklist("cayman")).toContain("Registered number obtained");
    expect(spvFormationChecklist("bvi")).toContain("Company number obtained");
  });

  it("gives an unmapped jurisdiction a neutral identifier line, not a US one", () => {
    expect(spvFormationChecklist("Kingdom of Wakanda")).toEqual([
      "Legal entity filed / registered",
      "Registered agent appointed",
      "Bank account opened",
      "Local entity registration / tax identification number obtained",
    ]);
  });

  it("keeps the three universal formation steps for every jurisdiction", () => {
    for (const j of SPV_JURISDICTIONS) {
      expect(spvFormationChecklist(j).slice(0, 3)).toEqual([
        "Legal entity filed / registered",
        "Registered agent appointed",
        "Bank account opened",
      ]);
    }
  });
});
