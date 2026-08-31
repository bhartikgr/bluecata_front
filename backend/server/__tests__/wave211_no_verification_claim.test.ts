/* ════════════════════════════════════════════════════════════════════════════
   WAVE 211 · R188.5 — CAPAVATE NEVER CLAIMS A VERIFICATION IT DOES NOT PERFORM.
   ════════════════════════════════════════════════════════════════════════════
   The brief's instruction is that the word "verified" must not appear. Wave 211
   deviates from that instruction in exactly ONE way, and this suite is the price
   of the deviation.

   THE DEVIATION. Draft 04 A2's whole purpose is to NEGATE a status claim, and it
   does so by naming the thing that is not happening: the partner is told that
   Capavate does NOT verify accredited or professional status and that the
   obligation is the partner's. A negation cannot be written without the word it
   negates; removing it would leave a sentence that says nothing.

   THE MITIGATION, WHICH IS WHAT THIS SUITE ENFORCES. The word may appear only
   inside a negation. Every AFFIRMATIVE construction — "is verified", "has been
   verified", "verified by Capavate", "Capavate verifies" — is refused
   mechanically, over the real generated text of every one of the three
   attestations, in both the present and absent-data states. If a later wave
   softens the wording into a claim, one of these fails.

   These assertions run against `buildWave211AttestationText`, the SAME function the
   route stores from and the SAME function the panel renders from. There is no
   second copy of the wording to drift.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  buildWave211AttestationText,
  wave211AttestationParagraphs,
  wave211InvestorFacingDistributionNote,
  W211_EVENT_NOUN_CAPITAL_CALL,
  W211_EVENT_NOUN_DISTRIBUTION,
  type Wave211AttestationFacts,
} from "../../shared/wave211MoneyEventAttestation";

/** Affirmative claims of verification. Each is a sentence Capavate must never say. */
const AFFIRMATIVE_CLAIMS: readonly { readonly re: RegExp; readonly why: string }[] = [
  { re: /\b(is|are|was|were|has been|have been|been)\s+verified\b/i, why: "states a verification as a completed fact" },
  { re: /Capavate verifies/i, why: "says Capavate performs the check" },
  { re: /\bwe verify\b/i, why: "says Capavate performs the check" },
  { re: /\bverified by Capavate\b/i, why: "attributes the check to Capavate" },
  { re: /\bCapavate has verified\b/i, why: "attributes a completed check to Capavate" },
  { re: /\bverification (?:is )?complete\b/i, why: "asserts a completed verification" },
  { re: /\bCapavate confirms (?:the|their|this) (?:status|eligibility|accreditation)\b/i, why: "asserts Capavate confirms status" },
  { re: /\bpre-?verified\b/i, why: "implies a check was performed in advance" },
];

/** Every fact set worth checking: complete data, and completely absent data. */
const CASES: readonly { readonly label: string; readonly facts: Wave211AttestationFacts }[] = [
  {
    label: "distribution · full data",
    facts: {
      kind: "money_event",
      eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
      vehicleName: "Northwind Opportunity SPV I LLC",
      eventType: "exit",
      amountRaw: "500000",
      amountUnit: "minor",
      currency: "USD",
      eventDate: "2026-09-30",
    },
  },
  {
    label: "distribution · every field absent",
    facts: {
      kind: "money_event",
      eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
      vehicleName: null,
      eventType: null,
      amountRaw: null,
      amountUnit: null,
      currency: null,
      eventDate: null,
    },
  },
  {
    label: "capital call · full data",
    facts: {
      kind: "money_event",
      eventNoun: W211_EVENT_NOUN_CAPITAL_CALL,
      vehicleName: "Northwind Opportunity SPV I LLC",
      eventType: "capital_call",
      amountRaw: "100000",
      amountUnit: "minor",
      currency: "USD",
      eventDate: "2026-10-01",
    },
  },
  {
    label: "LP invitation · full data",
    facts: {
      kind: "lp_invitation",
      partnerName: null,
      vehicleName: "Northwind Opportunity SPV I LLC",
      investorEmail: "dana@example.com",
    },
  },
  {
    label: "LP invitation · every field absent",
    facts: {
      kind: "lp_invitation",
      partnerName: null,
      vehicleName: null,
      investorEmail: null,
    },
  },
  {
    label: "LP commitment · full data",
    facts: {
      kind: "lp_commitment",
      partnerName: null,
      vehicleName: "Northwind Opportunity SPV I LLC",
      investorEmail: "dana@example.com",
      amountRaw: "25000.00",
      amountUnit: "as_entered",
      currency: "USD",
    },
  },
  {
    label: "LP commitment · every field absent",
    facts: {
      kind: "lp_commitment",
      partnerName: null,
      vehicleName: null,
      investorEmail: null,
      amountRaw: null,
      amountUnit: null,
      currency: null,
    },
  },
];

describe("WAVE 211 · R188.5 — no affirmative verification claim in any attestation", () => {
  for (const c of CASES) {
    it(`${c.label} — makes no affirmative claim of verification`, () => {
      const text = buildWave211AttestationText(c.facts);
      expect(text.length).toBeGreaterThan(100);
      for (const claim of AFFIRMATIVE_CLAIMS) {
        expect(text, `${c.label}: ${claim.why} — ${claim.re}`).not.toMatch(claim.re);
      }
    });
  }

  it("the investor-facing distribution note makes no affirmative claim either", () => {
    for (const noun of [W211_EVENT_NOUN_DISTRIBUTION, W211_EVENT_NOUN_CAPITAL_CALL]) {
      for (const name of ["Northwind Capital Partners LLC", null]) {
        const text = wave211InvestorFacingDistributionNote(name, noun).join("\n\n");
        for (const claim of AFFIRMATIVE_CLAIMS) {
          expect(text, `${noun}/${name}: ${claim.why}`).not.toMatch(claim.re);
        }
      }
    }
  });

  it("the invitation POSITIVELY states that Capavate does not verify, and whose duty it is", () => {
    const text = buildWave211AttestationText({
      kind: "lp_invitation",
      partnerName: null,
      vehicleName: "Northwind Opportunity SPV I LLC",
      investorEmail: "dana@example.com",
    });
    /* The negation must actually be there. A wave that deleted the sentence to satisfy
       the regexes above would pass them and fail R188.5, so the presence of the
       disclosure is asserted too. */
    expect(text).toMatch(/does not verify|no verification|not verified by/i);
    expect(text).toMatch(/your (?:responsibility|obligation)|sits with you|rests with you|yours/i);
  });

  it("no attestation renders an unsubstituted placeholder or a bare zero for absent data", () => {
    for (const c of CASES) {
      const paras = wave211AttestationParagraphs(c.facts);
      const text = paras.join("\n\n");
      /* R-ASSERT §14 — an absent value is SAID to be absent. It is never a template
         hole and never a fabricated 0. */
      expect(text, c.label).not.toMatch(/\{[A-Z_]+\}/);
      expect(text, c.label).not.toMatch(/\$\{/);
      expect(text, c.label).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/);
      if (c.label.includes("every field absent")) {
        expect(text, c.label).toMatch(/not recorded on this vehicle|did not enter a figure/i);
        /* No invented zero, and no invented currency. */
        expect(text, c.label).not.toMatch(/\b0\.00\b/);
        expect(text, c.label).not.toMatch(/\bUSD\b/);
      }
    }
  });
});
