/**
 * W3-B / C-5 — Accredited-investor self-certification clause + version
 * (CONFIGURABLE, NON-sacred).
 *
 * Single source of truth for the self-certification text, criteria list, and
 * version an individual reads and signs when they join the Collective as a
 * member (and any time they re-certify from settings). Both the client capture
 * surface and the server capture route import from here so the wording +
 * version never drift.
 *
 * Counsel's final copy can replace ACCREDITATION_CLAUSE_TEXT / criteria and bump
 * ACCREDITATION_CLAUSE_VERSION with NO code surgery — bumping the version tag
 * forces a fresh self-certification (12-month validity, note 3 in the draft).
 *
 * Intentionally dependency-free (no node:crypto) so it is safe to import from
 * the browser bundle. Any hashing lives server-side in investorComplianceRoutes.
 *
 * Seeded verbatim from capavate_work/ACCREDITATION_CLAUSE_DRAFT.md (approved
 * placeholder). NOT legal advice — pending external counsel finalization.
 */

/** Version tag recorded on every self-certification. Bump to force re-signature. */
export const ACCREDITATION_CLAUSE_VERSION = "ACCRED-v0.1-DRAFT";

/** Self-certification validity window (drives when a re-attestation is prompted). */
export const ACCREDITATION_VALIDITY_DAYS = 365;

/** One selectable eligibility criterion. `region` is a short display tag. */
export interface AccreditationCriterion {
  id: string;
  region: string;
  label: string;
}

/**
 * Eligibility criteria — the investor checks all that apply. Server validates
 * that every submitted id is a known criterion for the served clause version.
 */
export const ACCREDITATION_CRITERIA: AccreditationCriterion[] = [
  {
    id: "us_income",
    region: "US",
    label:
      "My individual income exceeded US$200,000 (or US$300,000 jointly with my spouse or spousal equivalent) in each of the two most recent years, and I reasonably expect the same for the current year.",
  },
  {
    id: "us_net_worth",
    region: "US",
    label:
      "My individual or joint net worth exceeds US$1,000,000, excluding the value of my primary residence.",
  },
  {
    id: "us_license",
    region: "US",
    label: "I hold, in good standing, a Series 7, Series 65, or Series 82 license.",
  },
  {
    id: "us_insider",
    region: "US",
    label: "I am a director, executive officer, or general partner of the issuer.",
  },
  {
    id: "us_entity",
    region: "US",
    label:
      "I am investing through an entity in which all equity owners are accredited investors, or an entity with assets exceeding US$5,000,000 not formed for the purpose of this investment.",
  },
  {
    id: "intl_equivalent",
    region: "INTL",
    label:
      "I qualify as a high-net-worth, sophisticated, professional, or accredited investor under the laws of my home jurisdiction (e.g. UK certified high-net-worth or self-certified sophisticated investor; EU/UK MiFID “professional client”; Canada NI 45-106 “accredited investor”; or the equivalent standard applicable to me), and the monetary thresholds I rely on are met in my local currency as of today.",
  },
];

/**
 * The viewable, read-only self-certification body shown before the investor
 * checks criteria and types their full legal name. Placeholder DRAFT (see
 * version tag) — pending external counsel finalization.
 */
export const ACCREDITATION_CLAUSE_TEXT = `# ACCREDITED / ELIGIBLE INVESTOR SELF-CERTIFICATION — DRAFT v0.1
### (Global investor-grade best-practice draft for Capavate — FOR LEGAL REVIEW; NOT LEGAL ADVICE)

By signing below, I certify that I qualify as an accredited, sophisticated, or otherwise eligible investor under the laws of my jurisdiction, on the basis of at least ONE of the criteria I have checked above.

I further acknowledge and agree that:
1. Private investments are high-risk, illiquid, and I may lose my entire investment; they are not registered with or approved by any securities regulator.
2. The information in this certification is true and accurate as of the date signed, and I will promptly notify Capavate if it ceases to be true.
3. This self-certification is valid for twelve (12) months from the date signed, after which I may be asked to re-certify.
4. Capavate and issuers may rely on this certification, and I understand Capavate may request additional documentation or third-party verification where required by applicable law.`;

/** The explicit acknowledgment the investor ticks before signing. */
export const ACCREDITATION_CLAUSE_ACK =
  "I have read, understood, and agree to the above certification, and I am signing it with my full legal name.";
