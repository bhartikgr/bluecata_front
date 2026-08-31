/**
 * WAVE 217 — THE PARTNER COMPLIANCE ATTESTATION AT CONSORTIUM PARTNER REGISTRATION.
 *
 * Decision A9 / ruling **R190.8**, which the owner designed himself:
 *
 *   1. A MANDATORY attestation gate at Consortium Partner registration that the
 *      Partner complies with all laws applicable to it and holds any licence or
 *      registration its activities require. Mandatory, blocking, recorded, audited.
 *   2. Self-declaration is the PRIMARY mechanism, with evidence upload OPTIONAL —
 *      because many jurisdictions issue no such document, and an exempt or
 *      unregulated Partner has nothing to upload.
 *   3. The platform must NEVER describe the result as "verified". It is a
 *      declaration the Partner makes and the platform records.
 *   4. Jurisdiction and regulatory status in STRUCTURED form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CLAUSE IS SLICED AND NEVER RETYPED
 * ─────────────────────────────────────────────────────────────────────────────
 * The Consortium Partner Agreement is signed (18 Jul 2026), competent, and an
 * ADEQUATE item that "must not be reopened" (R188.5, build doc §7 item 1). Its
 * §4 already allocates the regulatory duty to the Partner. So this module must
 * NOT restate §4 in new words: a paraphrase of a signed clause is a SECOND
 * VERSION of the term, and two versions of a term is the same defect as the two
 * legal corpora (R187.2) and the two accreditation paths (R187.5).
 *
 * R197.4 settled the construction: quote the clause, sliced from the agreement
 * text at render, so it CANNOT diverge from the executed document. Wave 213
 * built the slicer. **This module REUSES it — `consortiumAgreementSection` from
 * `./wave213PublishGoverningClause`, called with the marker "## 4." — and writes
 * no slicing code of its own.** If counsel replaces `CONSORTIUM_AGREEMENT_TEXT`
 * and bumps the version, the quote and the version tag both follow with no code
 * surgery.
 *
 * Wave 213 slices §7 (LP Handling, Confidentiality & Data Protection).
 * Wave 217 slices §4 (Eligibility, Licensing & Regulatory Compliance).
 * Same helper, different marker — which is why the helper takes one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TEXT LIVES IN `shared/`
 * ─────────────────────────────────────────────────────────────────────────────
 * One copy of a legal sentence. The sentence the applicant READS and the
 * sentence the server RECORDS and VERIFIES must be the same bytes, or the day
 * they diverge the applicant declares one thing and the platform files another.
 * `client/src/pages/public/ConsortiumApplyPage.tsx` imports it; the public apply
 * handler in `server/consortiumApplyStore.ts` imports it, rebuilds the sentence
 * itself, and refuses a submission whose text does not match byte-for-byte.
 * That is only sound if both sides read the same constant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS VERIFIED IN THE TREE BEFORE THIS MODULE WAS WRITTEN
 * ─────────────────────────────────────────────────────────────────────────────
 *  · ONE registrar mounts the apply routes: `registerConsortiumApplyRoutes`
 *    (`server/consortiumApplyStore.ts:1788`), called once, at
 *    `server/routes.ts:1911`. No dormant twin.
 *  · TWO HTTP paths share ONE handler — `/api/public/consortium/apply` and the
 *    alias `/api/consortium-applications`, both bound to `publicApplyHandler`
 *    (`consortiumApplyStore.ts:1887-1889`). A gate inside the handler therefore
 *    cannot be side-stepped by choosing the alias.
 *  · ONE registration page: `/apply/consortium` → `ConsortiumApplyPage`
 *    (`client/src/App.tsx:637`). `pages/partner/PartnerSignup.tsx` is a
 *    marketing CTA that links to it and holds no form.
 *  · `consortium_applications.jurisdiction` ALREADY EXISTS
 *    (`shared/schema.ts:2878`). This wave reuses it and adds no jurisdiction
 *    column.
 *  · There is NO `onConflictDoUpdate` and NO raw-SQL writer on
 *    `consortium_applications` — one `insert` and three `update ... where(id)`.
 *    So the R177.1/R181.1 "column missing from the upsert `set`" hazard is not
 *    reachable on this table. Recorded rather than assumed (§5.10).
 *  · The pre-wave submit gate was CLIENT-ONLY: `disabled={submitting ||
 *    !agreementAccepted || !agreementSignedName.trim()}`
 *    (`ConsortiumApplyPage.tsx:484`) with the server schema accepting
 *    `agreementSignedName` as `.optional().nullable()`. A direct POST with no
 *    tick and no name returned **201** on BOTH paths — captured before any code
 *    was written.
 *
 * Dependency-free apart from `./consortiumAgreement`, `./wave213PublishGoverningClause`
 * and `./refusalHeadlineGate`, all of which are browser-safe (no `node:crypto`),
 * so this module is safe in the client bundle.
 */
import {
  CONSORTIUM_AGREEMENT_VERSION,
} from "./consortiumAgreement";
import { consortiumAgreementSection } from "./wave213PublishGoverningClause";
import { fitToGate } from "./refusalHeadlineGate";

/* ============================================================================
 * IDENTITY
 * ========================================================================== */

/**
 * Attestation identity, recorded on every row so the exact wording assented to
 * is provable years later. Bumped — never mutated in place — when the wording
 * changes (the `shared/spvAttestation.ts` rule).
 *
 * The agreement version is part of the identity because the quoted clause is
 * sliced out of that agreement: an attestation against CPA-v1.0's §4 is not an
 * attestation against a future CPA-v2.0's §4.
 */
export const PARTNER_COMPLIANCE_ATTESTATION_VERSION =
  `W217-COMPLIANCE-v1/${CONSORTIUM_AGREEMENT_VERSION}`;

/** The section of the SIGNED agreement this attestation is made against. */
export const COMPLIANCE_CLAUSE_MARKER = "## 4.";

/** Human name of that section, for headings and for the attestation sentence. */
export const COMPLIANCE_CLAUSE_LABEL =
  "Section 4 (Eligibility, Licensing & Regulatory Compliance)";

/* ============================================================================
 * THE QUOTED CLAUSE — SLICED, NEVER RETYPED
 * ========================================================================== */

/**
 * §4 of the Consortium Partner Agreement, sliced out of the signed text at
 * render time by WAVE 213's helper.
 *
 * Returns `null` rather than `""` on a miss, exactly as the wave-213 helper
 * does, so a caller can render the honest fallback instead of a heading over an
 * empty panel — and so the value is never compared as if it were a quote.
 *
 * NOTE: no `.trim()`, `.toLowerCase()` or whitespace collapse is applied here or
 * anywhere in this module's comparison path. Wave 212 shipped a green test that
 * was blind to its own subject because a helper called `.trim()` (R200). The
 * bytes are the subject.
 */
export function complianceClauseQuote(): string | null {
  return consortiumAgreementSection(COMPLIANCE_CLAUSE_MARKER);
}

/** Rendered when the clause cannot be sliced. Names the absence; invents nothing. */
export const COMPLIANCE_CLAUSE_UNAVAILABLE_COPY =
  "Capavate could not read this section out of your Consortium Partner Agreement, " +
  "so it is not reproduced here. Read the full agreement above before you declare. " +
  "Tell us if this message appears — it means the agreement text and this screen " +
  "have come apart, and the declaration should not be made until it is fixed.";

/* ============================================================================
 * THE STRUCTURED REGULATORY POSITION
 * ========================================================================== */

/**
 * The five values, and only these five. Enforced THREE ways:
 *   1. this union type (compile time),
 *   2. `isRegulatoryStatus` (the HTTP boundary),
 *   3. a `CHECK` constraint in migration 0222 (the database).
 *
 * Handbook §11 — PREFER A CONSTRAINT TO A PROHIBITION: a rule the database
 * refuses cannot be reintroduced by a future wave or a careless brief.
 */
export const REGULATORY_STATUS_VALUES = [
  "licensed",
  "registered",
  "exempt",
  "not_required",
  "unsure",
] as const;

export type RegulatoryStatus = (typeof REGULATORY_STATUS_VALUES)[number];

/**
 * Presence and type are checked BEFORE any equality comparison (R176.1,
 * handbook §5.7). A missing value never enters an equality test as if it were a
 * value — which is how one boolean compared against `null` produced two
 * opposite defects on one screen.
 *
 * In particular: an ABSENT status is NOT `not_required`. `undefined`, `null`,
 * `""`, a number, an array and an object all return `false` here and are refused
 * upstream; none of them is silently coerced into a passing answer.
 */
export function isRegulatoryStatus(v: unknown): v is RegulatoryStatus {
  if (typeof v !== "string") return false;
  return (REGULATORY_STATUS_VALUES as readonly string[]).includes(v);
}

/**
 * Applicant-facing labels. Deliberately plain, and deliberately NOT ranked:
 * "exempt", "not required" and "unsure" are recorded and do NOT block. Whether
 * to refuse an unlicensed partner is a commercial decision the owner has not
 * made (build doc §217.2, Part IV item 5) and this module does not pre-empt it.
 */
export const REGULATORY_STATUS_LABELS: Readonly<Record<RegulatoryStatus, string>> = {
  licensed: "Licensed by a financial regulator for these activities",
  registered: "Registered with a financial regulator for these activities",
  exempt: "Exempt from licensing or registration for these activities",
  not_required: "No licence or registration is required for these activities",
  unsure: "I am not sure",
};

/** Shown under the select. States the platform's position without softening it. */
export const REGULATORY_STATUS_HELP =
  "Answer for the organisation applying, in the jurisdiction you gave above. " +
  "\"Exempt\", \"no licence required\" and \"I am not sure\" are all acceptable answers " +
  "and none of them stops your application. Capavate records your answer. Capavate " +
  "does not check it and does not advise you on it.";

/* ============================================================================
 * THE OPTIONAL EVIDENCE REFERENCE
 * ========================================================================== */

/**
 * OPTIONAL, and the label says so. This is the point the owner's own question
 * identified and it is the single most important harm guard in the wave:
 * requiring a certificate would exclude legitimate partners in jurisdictions
 * that issue none, AND would imply a verification the platform does not perform.
 *
 * The server NEVER checks this field's presence. A registration with an empty
 * evidence reference and status `exempt` succeeds, and a test drives exactly
 * that.
 */
export const COMPLIANCE_EVIDENCE_LABEL =
  "Licence or registration reference (optional)";

export const COMPLIANCE_EVIDENCE_HELP =
  "Optional. If you hold a licence or registration number, you may put it here. " +
  "Many jurisdictions issue no document at all, and an exempt or unregulated " +
  "organisation has nothing to give — so leaving this blank does not affect your " +
  "application and is not treated as a gap.";

/* ============================================================================
 * THE ATTESTATION SENTENCE
 * ========================================================================== */

export const COMPLIANCE_HEADING =
  "Your regulatory position, and what you are declaring";

export const COMPLIANCE_CLAUSE_HEADING =
  "Quoted from the Consortium Partner Agreement you are signing above";

/**
 * The substantive declaration — "full attestation" strength (build doc §3.1):
 * typed legal name plus a substantive statement, with the wording STORED
 * VERBATIM so it can be proved later.
 *
 * READ THIS BEFORE CHANGING A WORD OF IT. The sentence deliberately does NOT
 * restate what §4 says. It POINTS at §4 by name and adopts it. That distinction
 * is the whole reason the clause is sliced and quoted beside it: the substance
 * lives in the signed document, in the signed document's own words, and this
 * sentence adds only the four things the signed document cannot itself supply —
 * who is declaring, on whose behalf, that the quoted section was read on this
 * screen, and that the structured answers given here are accurate.
 *
 * The final sentence is the anti-"verified" clause. R190.8 item 3 makes
 * "verified" a named prohibition for this wave, and the honest statement of what
 * the platform does is stronger than a disclaimer bolted on elsewhere.
 */
export function complianceAttestationText(
  organizationName: string,
  signedName: string,
): string {
  const org = organizationName.trim().length > 0
    ? organizationName.trim()
    : "the applicant organisation";
  const who = signedName.trim().length > 0 ? signedName.trim() : "the signatory";
  return (
    `I, ${who}, am authorised to make this declaration for ${org}. ` +
    `I have read ${COMPLIANCE_CLAUSE_LABEL} of the Consortium Partner Agreement ` +
    `(${CONSORTIUM_AGREEMENT_VERSION}), quoted in full on this screen, and the ` +
    `obligations that section places on the Partner are ${org}'s own. ` +
    `The jurisdiction and the regulatory status recorded with this declaration are ` +
    `accurate and complete to the best of my knowledge, and I will tell Capavate if ` +
    `they change. ` +
    `Capavate records this declaration; Capavate does not check it, does not confirm ` +
    `it, and gives ${org} no regulatory advice or clearance of any kind.`
  );
}

/** The tick's own label. Short, because the declaration is rendered beside it. */
export const COMPLIANCE_TICK_LABEL =
  "I make the declaration above on behalf of this organisation.";

/** Field names on the wire. Named once so client and server cannot drift. */
export const COMPLIANCE_FIELD_ATTESTED = "complianceAttested";
export const COMPLIANCE_FIELD_TEXT = "complianceAttestationText";
export const COMPLIANCE_FIELD_VERSION = "complianceAttestationVersion";
export const COMPLIANCE_FIELD_STATUS = "regulatoryStatus";
export const COMPLIANCE_FIELD_EVIDENCE = "complianceEvidenceRef";

/* ============================================================================
 * REFUSALS — every one measured through fitToGate()
 * ========================================================================== */

/**
 * `client/src/lib/queryClient.ts:60-65` drops any server message that is not
 * strictly shorter than 240 characters, silently. It has swallowed real
 * refusals FOUR times. Every string below is built through `fitToGate()` and
 * its length is ASSERTED IN A TEST — not trimmed by hand and not assumed.
 */
export const COMPLIANCE_MISSING_MESSAGE = fitToGate(() =>
  "Before we can take your application you need to make the compliance declaration " +
  "and choose your regulatory status. Both are on the application form, just above " +
  "the submit button.",
);

export const COMPLIANCE_STATUS_INVALID_MESSAGE = fitToGate(() =>
  "Choose one of the five regulatory-status options on the form. We cannot record " +
  "an answer we do not recognise, and we will not guess one for you.",
);

export const COMPLIANCE_TEXT_MISMATCH_MESSAGE = fitToGate(() =>
  "The declaration we received is not the declaration this form shows. Please reload " +
  "the application page and make the declaration again from the current wording.",
);

export const COMPLIANCE_VERSION_STALE_MESSAGE = fitToGate(() =>
  "The Consortium Partner Agreement has been updated since you opened this page. " +
  "Please reload, read the current wording, and declare again.",
);

export const COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE = fitToGate(() =>
  "Type your full legal name to sign. The compliance declaration names the person " +
  "making it, so we cannot record it without a name.",
);

/* ============================================================================
 * THE SERVER-SIDE VERIFICATION
 * ========================================================================== */

/** Machine-readable refusal codes. Stable; the client may branch on them. */
export type ComplianceRefusalCode =
  | "COMPLIANCE_ATTESTATION_REQUIRED"
  | "COMPLIANCE_SIGNATURE_REQUIRED"
  | "COMPLIANCE_STATUS_INVALID"
  | "COMPLIANCE_TEXT_MISMATCH"
  | "COMPLIANCE_VERSION_STALE";

export interface ComplianceVerifyInput {
  readonly organizationName: unknown;
  readonly signedName: unknown;
  readonly attested: unknown;
  readonly text: unknown;
  readonly version: unknown;
  readonly status: unknown;
}

export type ComplianceVerifyResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly version: string;
      readonly status: RegulatoryStatus;
    }
  | {
      readonly ok: false;
      readonly code: ComplianceRefusalCode;
      readonly message: string;
    };

/**
 * THE GATE. Called by `publicApplyHandler`, which both HTTP paths share.
 *
 * ORDER IS LOAD-BEARING, and it is the R176.1 order: **presence and type are
 * checked for EVERY field BEFORE any equality comparison happens.** Nothing
 * absent, nothing of the wrong type, and nothing coerced ever reaches the `===`
 * on the last step. A forged `attested: "true"`, `attested: 1`,
 * `attested: {}`, `attested: []` or a missing `attested` is refused on type,
 * not compared.
 *
 * The text comparison is BYTE-FOR-BYTE. There is deliberately no `.trim()`, no
 * `.toLowerCase()` and no whitespace collapse in this function: wave 212 shipped
 * a green test whose helper called `.trim()` and thereby erased the exact
 * difference the test existed to detect (R200). A paraphrase differs from the
 * canonical sentence in bytes, and bytes are what is compared, so a paraphrase
 * is refused.
 */
export function verifyComplianceAttestation(
  input: ComplianceVerifyInput,
): ComplianceVerifyResult {
  // ---- 1. PRESENCE AND TYPE, for every field, before any comparison. ----
  if (typeof input.attested !== "boolean" || input.attested !== true) {
    return {
      ok: false,
      code: "COMPLIANCE_ATTESTATION_REQUIRED",
      message: COMPLIANCE_MISSING_MESSAGE,
    };
  }
  if (typeof input.organizationName !== "string" || input.organizationName.trim().length === 0) {
    return {
      ok: false,
      code: "COMPLIANCE_ATTESTATION_REQUIRED",
      message: COMPLIANCE_MISSING_MESSAGE,
    };
  }
  if (typeof input.signedName !== "string" || input.signedName.trim().length === 0) {
    return {
      ok: false,
      code: "COMPLIANCE_SIGNATURE_REQUIRED",
      message: COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE,
    };
  }
  if (!isRegulatoryStatus(input.status)) {
    // Absent, null, "", a number, an array, an object, or an unknown string.
    // NONE of them becomes `not_required`. R176.1.
    return {
      ok: false,
      code: "COMPLIANCE_STATUS_INVALID",
      message: COMPLIANCE_STATUS_INVALID_MESSAGE,
    };
  }
  if (typeof input.text !== "string" || input.text.length === 0) {
    return {
      ok: false,
      code: "COMPLIANCE_ATTESTATION_REQUIRED",
      message: COMPLIANCE_MISSING_MESSAGE,
    };
  }
  // The version may be omitted by an older client; it may NOT be a wrong type,
  // and if it is present it must be the current one.
  if (input.version !== undefined && input.version !== null) {
    if (
      typeof input.version !== "string" ||
      input.version !== PARTNER_COMPLIANCE_ATTESTATION_VERSION
    ) {
      return {
        ok: false,
        code: "COMPLIANCE_VERSION_STALE",
        message: COMPLIANCE_VERSION_STALE_MESSAGE,
      };
    }
  }

  // ---- 2. ONLY NOW, the equality. Byte-for-byte, no normalisation. ----
  const canonical = complianceAttestationText(input.organizationName, input.signedName);
  if (input.text !== canonical) {
    return {
      ok: false,
      code: "COMPLIANCE_TEXT_MISMATCH",
      message: COMPLIANCE_TEXT_MISMATCH_MESSAGE,
    };
  }

  return {
    ok: true,
    text: canonical,
    version: PARTNER_COMPLIANCE_ATTESTATION_VERSION,
    status: input.status,
  };
}

/**
 * Words this wave's copy must never contain, because each of them would imply a
 * verification the platform does not perform (R190.8 item 3, a named
 * prohibition). Exported so the DOM test asserts against ONE list rather than a
 * hand-written one that could drift from this module.
 */
export const COMPLIANCE_FORBIDDEN_WORDS = [
  "verified",
  "verify",
  "vetted",
  "screened",
  "pre-qualified",
  "prequalified",
  "approved",
] as const;
