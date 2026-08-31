/**
 * WAVE 211 — PARTNER MONEY GATES · THE TEXT AUTHORITY
 * ===================================================
 *
 * The problem this closes, in the owner's words: "Record Distribution" states
 * that distributions are append-only and cannot be edited or deleted once
 * recorded, and then requires nothing at all. The same was true of "Record
 * Capital Call", "Invite an LP" and "Commit an LP to the cap table" — real
 * financial steps with no accreditation step, no consent and no disclosure.
 *
 * This module is the SINGLE source of the words. The client renders from it and
 * the server re-renders from it, so both sides build byte-identical text from
 * the same request facts. That is what makes the server's identity check
 * enforceable rather than decorative, and it is what makes the stored text
 * provably the text that was shown.
 *
 * Copy provenance — every string below is transcribed from the drafted text, not
 * composed here:
 *   · money events        → build_log/legal/drafts/03_DISTRIBUTION_AND_CAPITAL_EVENT_CONFIRMATION.md
 *   · LP invitation       → build_log/legal/drafts/04_LP_INVITATION_AND_COMMITMENT_DISCLOSURES.md, Part A
 *   · LP commitment       → build_log/legal/drafts/04_LP_INVITATION_AND_COMMITMENT_DISCLOSURES.md, Part B5/B6
 * Structure follows the SPV launch sign-off (`shared/spvAttestation.ts` +
 * `client/src/pages/partner/PartnerSpvEngine.tsx:1483`): typed full legal name,
 * mandatory ticks, verbatim text stored, version tag, UTC timestamp.
 *
 * RULES OBEYED HERE, DELIBERATELY:
 *   · R-ASSERT (§14) — a figure that is absent is DECLARED absent. Never a zero,
 *     never a default, never an invented figure. `describeFigure` is a SHAPE
 *     TEST, not a parse: there is no `Number()`, `parseInt` or `parseFloat` in
 *     this file, and no currency is ever converted or hardcoded.
 *   · R188.5 — the platform never claims a verification it does not perform. The
 *     word "verified" appears only inside the drafts' own express negations
 *     (draft 04 A2). No affirmative verification claim exists in any string
 *     below; a test asserts that mechanically.
 *   · R197.4 — where a term genuinely lives in the signed Consortium Partner
 *     Agreement, the clause is QUOTED FROM THE SIGNED TEXT at render, not
 *     restated in new words that could diverge. Wave 213 paraphrased; this
 *     slices.
 *   · A shipped version is never mutated in place. Change the wording → new
 *     version token, so an old stored attestation stays interpretable.
 *
 * Dependency-free apart from `./consortiumAgreement` and
 * `./refusalHeadlineGate`, both of which are themselves dependency-free, so this
 * module is safe in the browser bundle.
 */
import { CONSORTIUM_AGREEMENT_TEXT, CONSORTIUM_AGREEMENT_VERSION } from "./consortiumAgreement";

/* ══════════════════════════════════════════════════════════════════════════
   1 · IDENTITY
   ══════════════════════════════════════════════════════════════════════════ */

/** The three attestation kinds wave 211 gates. */
export type Wave211AttestationKind = "money_event" | "lp_invitation" | "lp_commitment";

export const W211_MONEY_EVENT_ATTESTATION_VERSION = "W211-MONEY-EVENT-ATT-v1";
export const W211_LP_INVITE_ATTESTATION_VERSION = "W211-LP-INVITE-ATT-v1";
export const W211_LP_COMMIT_ATTESTATION_VERSION = "W211-LP-COMMIT-ATT-v1";

export function wave211AttestationVersion(kind: Wave211AttestationKind): string {
  if (kind === "lp_invitation") return W211_LP_INVITE_ATTESTATION_VERSION;
  if (kind === "lp_commitment") return W211_LP_COMMIT_ATTESTATION_VERSION;
  return W211_MONEY_EVENT_ATTESTATION_VERSION;
}

/**
 * The event nouns the money-event gate is parameterised by. Draft 03 is written
 * with an `{EVENT}` placeholder; these are the only substitutions wave 211 makes.
 * A noun is never invented at a call site.
 */
export const W211_EVENT_NOUN_DISTRIBUTION = "distribution";
export const W211_EVENT_NOUN_CAPITAL_CALL = "capital call";

const KNOWN_EVENT_NOUNS: readonly string[] = [
  W211_EVENT_NOUN_DISTRIBUTION,
  W211_EVENT_NOUN_CAPITAL_CALL,
];

/**
 * Refuse an unknown noun rather than interpolating whatever arrived. An attacker
 * who could choose the noun could choose the sentence the partner assents to.
 */
export function wave211EventNounOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return KNOWN_EVENT_NOUNS.includes(s) ? s : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · R-ASSERT — ABSENCE IS DECLARED, NEVER DEFAULTED
   ══════════════════════════════════════════════════════════════════════════ */

/** Shown where a name-ish fact the platform should hold is not recorded. */
export const W211_ABSENT_TEXT = "not recorded on this vehicle";
/** Shown where the partner entered no figure. NEVER a zero (R-ASSERT, §14). */
export const W211_ABSENT_FIGURE = "you did not enter a figure for this";
/**
 * Shown where a figure arrived in a shape that cannot be displayed exactly —
 * exponent notation, a thousands separator, a currency symbol. Declared
 * unshowable rather than printed as if it were a figure.
 */
export const W211_NOT_PLAIN_NUMBER =
  "the figure you entered is not in a form this confirmation can restate exactly, so it is not restated here — check it on the form above before you sign";
/** Shown where no currency code was supplied. A currency is never assumed. */
export const W211_ABSENT_CURRENCY = "no currency was recorded for this entry";
/** Shown where no date was supplied. A date is never defaulted to today. */
export const W211_ABSENT_DATE = "no date was recorded for this entry";

/**
 * A figure this module is willing to restate byte-for-byte. Digits, one optional
 * decimal point. No sign, no exponent, no separator, no symbol.
 */
const PLAIN_DECIMAL = /^\d{1,24}(\.\d{1,12})?$/;

/**
 * True only for a string already in plain-decimal form. This is a SHAPE TEST on
 * text, not a numeric parse: nothing here converts money to a JavaScript number,
 * so no precision can be lost and `MAX_SAFE_INTEGER` is never in play.
 */
export function wave211PlainDecimalOrNull(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : String(raw).trim();
  return PLAIN_DECIMAL.test(s) ? s : null;
}

/** A name-ish fact: shown as given, or declared absent. Never blank, never invented. */
function describeText(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return s.length > 0 ? s : W211_ABSENT_TEXT;
}

/**
 * A figure. Restated byte-for-byte when it is already a plain decimal; otherwise
 * DECLARED, in words, as absent or unshowable.
 *
 * A JavaScript `number` reaches this from callers that already hold one. `String(n)`
 * widens a value the caller already had — it is not a parse of typed text — and the
 * result is then REQUIRED to match `PLAIN_DECIMAL`. That is what the money-exponent
 * fence protects: `String(1e21)` yields `"1e+21"`, fails the test, and is declared
 * unshowable rather than shown. No rounding, no `toFixed`, no locale formatting.
 */
function describeFigure(raw: string | number | null | undefined): string {
  if (raw == null) return W211_ABSENT_FIGURE;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.length === 0) return W211_ABSENT_FIGURE;
    return PLAIN_DECIMAL.test(s) ? s : W211_NOT_PLAIN_NUMBER;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return W211_NOT_PLAIN_NUMBER;
    const s = String(raw);
    return PLAIN_DECIMAL.test(s) ? s : W211_NOT_PLAIN_NUMBER;
  }
  return W211_ABSENT_FIGURE;
}

/** A currency code, or `null`. Never defaulted, never converted, never hardcoded. */
function describeCurrencyOrNull(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null;
}

/**
 * How the amount reaching this module is denominated.
 *
 * This exists because the four gated routes do not agree, and pretending they did
 * would mean CONVERTING a figure to make one sentence fit — which is exactly what
 * §4 forbids. The distribution and capital-call routes carry the amount in the
 * currency's smallest units (`grossProceedsMinor`, `amount_minor`); the cap-table
 * commitment carries it as the whole-unit decimal string the partner typed. Each is
 * restated byte-for-byte and LABELLED for what it is. Nothing is divided,
 * multiplied, rounded or converted anywhere in this module.
 */
export type Wave211AmountUnit = "minor" | "as_entered";

export const W211_AMOUNT_UNIT_NOTE_MINOR =
  "in the smallest unit of the currency named below, exactly as this entry records it";
export const W211_AMOUNT_UNIT_NOTE_AS_ENTERED = "exactly as you entered it";

function amountUnitNote(unit: Wave211AmountUnit | null | undefined): string | null {
  if (unit === "minor") return W211_AMOUNT_UNIT_NOTE_MINOR;
  if (unit === "as_entered") return W211_AMOUNT_UNIT_NOTE_AS_ENTERED;
  return null;
}

/**
 * The amount line. The figure is restated or declared; the unit is named when the
 * caller said which unit it is, and omitted rather than guessed when it did not.
 */
function amountLine(
  raw: string | number | null | undefined,
  unit: Wave211AmountUnit | null | undefined,
): string {
  const shown = describeFigure(raw);
  const note = amountUnitNote(unit);
  /* No unit is appended to an ABSENCE. "you did not enter a figure for this, in the
     smallest unit of the currency" would read as though a unit had been chosen for
     a figure that does not exist. */
  if (note == null || shown === W211_ABSENT_FIGURE || shown === W211_NOT_PLAIN_NUMBER) {
    return `${W211_RECITAL_LABEL_AMOUNT}: ${shown}`;
  }
  return `${W211_RECITAL_LABEL_AMOUNT}: ${shown} — ${note}`;
}

/** A date, shown exactly as supplied when it is an ISO-8601 date or date-time. */
function describeDate(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length === 0) return W211_ABSENT_DATE;
  return /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) ? s : W211_ABSENT_DATE;
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · THE CONSORTIUM PARTNER AGREEMENT CLAUSE, QUOTED AT RENDER (R197.4)
   ══════════════════════════════════════════════════════════════════════════ */

/** Heading marker of the CPA section governing money events: SPV administration. */
export const W211_CPA_MARKER_MONEY_EVENT = "## 5.";
/** Heading marker of the CPA section governing eligibility: who may be invited. */
export const W211_CPA_MARKER_ELIGIBILITY = "## 4.";

export const W211_CPA_QUOTE_HEADING_MONEY_EVENT =
  "Your responsibility for this entry, quoted from the agreement you signed";
export const W211_CPA_QUOTE_HEADING_ELIGIBILITY =
  "Your responsibility for investor eligibility, quoted from the agreement you signed";

/** Where a partner reads the whole signed agreement, in-app, signed in. */
export const W211_CPA_LINK_PATH = "/collective/partner/agreement";
export const W211_CPA_LINK_LABEL =
  `Read your Consortium Partner Agreement (${CONSORTIUM_AGREEMENT_VERSION}) in full`;

/**
 * Slice one section out of the SIGNED agreement text at runtime.
 *
 * Deriving the quote is what makes divergence structurally impossible: if counsel
 * replaces `CONSORTIUM_AGREEMENT_TEXT` and bumps the version, this quote follows
 * automatically with no code surgery.
 *
 * Returns `null` rather than `""` on a miss. A caller that gets `null` renders the
 * no-clause fallback; a caller that got `""` would render a heading over nothing.
 * `null` cannot be mistaken for a quote and is never compared as if it were one.
 *
 * Re-implemented here rather than imported from `shared/wave213PublishGoverningClause.ts`
 * because wave 213 is still building and its surfaces are to be left alone.
 */
export function wave211AgreementSection(marker: string): string | null {
  if (typeof marker !== "string" || marker.length === 0) return null;
  const start = CONSORTIUM_AGREEMENT_TEXT.indexOf(marker);
  if (start < 0) return null;
  const rest = CONSORTIUM_AGREEMENT_TEXT.slice(start);
  const nextHeading = rest.indexOf("\n## ", marker.length);
  const body = (nextHeading < 0 ? rest : rest.slice(0, nextHeading)).trim();
  return body.length > 0 ? body : null;
}

/** The marker whose section governs a given attestation kind. */
export function wave211CpaMarkerFor(kind: Wave211AttestationKind): string {
  return kind === "money_event" ? W211_CPA_MARKER_MONEY_EVENT : W211_CPA_MARKER_ELIGIBILITY;
}

export function wave211CpaQuoteHeadingFor(kind: Wave211AttestationKind): string {
  return kind === "money_event"
    ? W211_CPA_QUOTE_HEADING_MONEY_EVENT
    : W211_CPA_QUOTE_HEADING_ELIGIBILITY;
}

/** Shown in place of the quote when the section cannot be located in the signed text. */
export const W211_CPA_QUOTE_UNAVAILABLE =
  "The relevant clause of your Consortium Partner Agreement could not be located in the signed text on this build, so it is not quoted here. Your obligations under that agreement are unchanged by its absence from this panel.";

/* ══════════════════════════════════════════════════════════════════════════
   4 · MONEY EVENTS — DRAFT 03, VERBATIM
   ══════════════════════════════════════════════════════════════════════════ */

export const W211_MONEY_EVENT_NAME_LABEL = "Full legal name *";
export const W211_MONEY_EVENT_NAME_PLACEHOLDER = "Type your full legal name";
export const W211_MONEY_EVENT_BASIS_LABEL = "Basis of determination (required, free text)";

/** Draft 03, heading. `{EVENT}` substituted with the event's own noun. */
export function wave211MoneyEventHeading(eventNoun: string): string {
  return `Confirm this ${eventNoun} (required)`;
}

/** Draft 03, the consequence paragraph shown BEFORE the ticks. */
export function wave211MoneyEventConsequence(eventNoun: string): string {
  return (
    `Recording this ${eventNoun} is permanent. Distribution and capital-event records on ` +
    `Capavate are append-only: once recorded, this entry cannot be edited or deleted. A ` +
    `correction can only be made by recording a further entry, and both entries will remain ` +
    `visible. It will change what each investor's record shows, what the vehicle's record ` +
    `shows, and what this firm is billed. Only record it if the statements below are true.`
  );
}

/** Draft 03, tick 1 — authority. */
export function wave211MoneyEventTick1(eventNoun: string): string {
  return (
    `I confirm I am authorised to record this ${eventNoun} for this vehicle on behalf of ` +
    `this firm.`
  );
}

/** Draft 03, tick 2 — the underlying determination is the partner's. */
export function wave211MoneyEventTick2(eventNoun: string): string {
  return (
    `I confirm that this ${eventNoun} has been determined and approved by the vehicle, its ` +
    `general partner or manager, or another person with authority to do so, in accordance ` +
    `with the vehicle's constitutional and subscription documents, and that the amounts, ` +
    `dates, currency and recipients I have entered match that determination.`
  );
}

/** Draft 03, tick 3 — the platform performs no calculation check of any kind. */
export function wave211MoneyEventTick3(eventNoun: string): string {
  return (
    `I understand that Capavate performs no check of any kind on this ${eventNoun}. Capavate ` +
    `does not calculate, recalculate, verify, approve or audit the amount, the allocation ` +
    `between investors, the waterfall, the hurdle, the carried interest, the withholding, or ` +
    `any other part of it. Capavate does not confirm that any money has moved. Capavate ` +
    `records what I enter.`
  );
}

/** Draft 03, the free-text field's own instruction. */
export function wave211MoneyEventBasisInstruction(eventNoun: string): string {
  return (
    `Identify the document, resolution, notice or calculation this ${eventNoun} is based on ` +
    `— for example a distribution notice, a manager's resolution, or a capital call notice, ` +
    `with its date.`
  );
}

/** Draft 03, the blocker shown while the sign-off is incomplete. */
export function wave211MoneyEventBlocker(eventNoun: string): string {
  return (
    `Type your full legal name, identify the basis of determination, and accept all three ` +
    `confirmations to record this ${eventNoun}.`
  );
}

/** Draft 03, the footnote under the sign-off. */
export const W211_MONEY_EVENT_FOOTNOTE =
  "Your name, your assent, the basis you identified and a UTC timestamp are recorded for audit. This record cannot be edited or deleted afterwards.";

export const W211_MONEY_EVENT_RECITAL_HEADING = "What you are confirming, as this entry stands now";
export const W211_RECITAL_LABEL_VEHICLE = "Vehicle";
export const W211_RECITAL_LABEL_EVENT = "Event";
export const W211_RECITAL_LABEL_AMOUNT = "Amount";
export const W211_RECITAL_LABEL_CURRENCY = "Currency";
export const W211_RECITAL_LABEL_DATE = "Date";

/**
 * The event's own data, as the request carries it. Every field optional, because
 * absence is a real state that must be DECLARED rather than filled in.
 */
export interface Wave211MoneyEventFacts {
  /** The event noun. Must be one of `KNOWN_EVENT_NOUNS`. */
  eventNoun: string;
  /** The vehicle's name as the platform holds it. */
  vehicleName?: string | null;
  /** The event's sub-type as chosen on the form, e.g. `exit`, `dividend`. */
  eventType?: string | null;
  /** The amount EXACTLY as supplied. Never parsed, never converted. */
  amountRaw?: string | number | null;
  /** Which unit `amountRaw` is in. Named, never assumed. */
  amountUnit?: Wave211AmountUnit | null;
  /** The currency code as supplied. Never defaulted. */
  currency?: string | null;
  /** The event date as supplied. Never defaulted to today. */
  eventDate?: string | null;
}

/** The recital lines: the event's own data, restated or declared absent. */
export function wave211MoneyEventRecitalLines(facts: Wave211MoneyEventFacts): string[] {
  const currency = describeCurrencyOrNull(facts.currency);
  return [
    `${W211_RECITAL_LABEL_VEHICLE}: ${describeText(facts.vehicleName)}`,
    `${W211_RECITAL_LABEL_EVENT}: ${describeText(facts.eventType)}`,
    amountLine(facts.amountRaw, facts.amountUnit),
    `${W211_RECITAL_LABEL_CURRENCY}: ${currency ?? W211_ABSENT_CURRENCY}`,
    `${W211_RECITAL_LABEL_DATE}: ${describeDate(facts.eventDate)}`,
  ];
}

/**
 * The full attestation, as an ordered list of paragraphs, generated live from the
 * event's own data. This is the text that is SHOWN and the text that is STORED.
 */
export function wave211MoneyEventParagraphs(facts: Wave211MoneyEventFacts): string[] {
  const noun = wave211EventNounOrNull(facts.eventNoun) ?? W211_EVENT_NOUN_DISTRIBUTION;
  const clause = wave211AgreementSection(W211_CPA_MARKER_MONEY_EVENT);
  return [
    wave211MoneyEventHeading(noun),
    W211_MONEY_EVENT_RECITAL_HEADING,
    ...wave211MoneyEventRecitalLines(facts),
    wave211MoneyEventConsequence(noun),
    wave211MoneyEventTick1(noun),
    wave211MoneyEventTick2(noun),
    wave211MoneyEventTick3(noun),
    W211_CPA_QUOTE_HEADING_MONEY_EVENT,
    clause ?? W211_CPA_QUOTE_UNAVAILABLE,
    W211_MONEY_EVENT_FOOTNOTE,
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · LP INVITATION — DRAFT 04 PART A, VERBATIM
   ══════════════════════════════════════════════════════════════════════════ */

export const W211_LP_INVITE_HEADING = "Confirm this invitation (required)";
export const W211_LP_INVITE_NAME_LABEL = "Full legal name *";
export const W211_LP_INVITE_NAME_PLACEHOLDER = "Type your full legal name";


/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE WIRE KEYS — ONE AUTHORITY FOR BOTH SIDES
 *
 *  These names were defined TWICE during this build — once in the client panel and
 *  once in the server gate — and the two spellings did not match, so every honest
 *  submission would have been refused for a missing name. That is the worst failure
 *  this wave could have: a partner blocked from recording a real distribution by a
 *  typo. The names now live here, in the module both sides already import, so the
 *  two cannot drift again. Do not restate these strings anywhere else.
 * ═══════════════════════════════════════════════════════════════════════════ */
export const W211_BODY_KEY_VERSION = "w211AttestationVersion";
export const W211_BODY_KEY_SIGNED_NAME = "w211AttestationSignedName";
export const W211_BODY_KEY_TICK_1 = "w211AttestationTick1";
export const W211_BODY_KEY_TICK_2 = "w211AttestationTick2";
export const W211_BODY_KEY_TICK_3 = "w211AttestationTick3";
export const W211_BODY_KEY_BASIS = "w211AttestationBasis";
export const W211_BODY_KEY_CURRENCY_CONFIRMED = "w211AttestationCurrencyConfirmed";

/** Every key a browser is allowed to set. Anything else `w211*` is stripped. */
export const W211_CLIENT_SUPPLIABLE_KEYS: readonly string[] = [
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
];

/** Any key in wave 211's namespace, suppliable or not. Deliberately BROADER than
 *  the suppliable list: the point is that nothing `w211*` reaches a ledger row. */
export const W211_BODY_KEY_PATTERN = /^w211/i;

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  HOW THE PARTNER IS NAMED IN ITS OWN CONFIRMATION — AND WHY IT IS NOT NAMED
 *
 *  Drafts 03 and 04 write `{PARTNER}` into the partner-facing paragraphs. The point
 *  of that substitution is ATTRIBUTION: the invitation, the commitment and the
 *  payment instruction belong to the partner firm and not to Capavate. It is not
 *  identification — the reader of these paragraphs IS the partner firm.
 *
 *  R187.3 requires that what is stored is the exact text SHOWN. The screen and the
 *  server must therefore produce the same bytes. The partner's registered
 *  organisation name is a SERVER-side row (`partner_organizations.name`); the partner
 *  client payload (`GET /api/partner/me` → `PartnerIdentity`) does not carry it, and
 *  the SPV detail payload does not carry it either. Rendering the name server-side
 *  while the screen rendered a placeholder would store text the partner never saw,
 *  which is precisely the failure R187.3 exists to prevent.
 *
 *  So the partner-facing paragraphs use this second-person phrase on BOTH sides, and
 *  BOTH sides pass `null`. Attribution is preserved in full — every one of these
 *  sentences still says the obligation is the firm's and not Capavate's — and the
 *  shown text and the stored text are the same bytes by construction.
 *
 *  This is deliberately NOT used for the INVESTOR-facing note
 *  (`wave211InvestorFacingDistributionNote`), where the reader is not the partner and
 *  the firm must be named. That function keeps `describeText`, so an absent name is
 *  declared as absent rather than rendered as "your firm" to an investor.
 * ═══════════════════════════════════════════════════════════════════════════ */
export const W211_PARTNER_SELF_REFERENCE = "your firm";

/**
 * The partner's own name for a PARTNER-FACING paragraph: the registered name when the
 * caller has one, and the second-person phrase when it does not. Never a blank, never
 * an invented placeholder.
 */
function describePartnerSelf(partnerName: string | null | undefined): string {
  const s = typeof partnerName === "string" ? partnerName.trim() : "";
  return s.length > 0 ? s : W211_PARTNER_SELF_REFERENCE;
}

/** Draft 04 A1 — who is inviting, and who is responsible. `{PARTNER}` substituted. */
export function wave211LpInviteAttribution(partnerName: string | null | undefined): string {
  const p = describePartnerSelf(partnerName);
  return (
    `You are sending this invitation, and ${p} is the party making it. Capavate hosts it and ` +
    `keeps the record; Capavate is not the person inviting anyone and does not invite anyone ` +
    `on your behalf. The content of this invitation and of the vehicle information it gives ` +
    `access to is yours.`
  );
}

/** Draft 04 A2, first paragraph — eligibility is the partner's determination. */
export const W211_LP_INVITE_ELIGIBILITY_IS_YOURS =
  "Before you invite this person you must satisfy yourself that you may lawfully do so, and that they are eligible to participate in this vehicle, under the law of the place where they are. Capavate does not make that determination and does not verify anything about this person. Capavate records what you tell it and stores the evidence you choose to store.";

/**
 * Draft 04 A2, second paragraph.
 *
 * Note on R188.5 and the word "verified": it occurs here only inside the draft's
 * own express NEGATION of a status claim. Removing it would weaken the very
 * disclosure the ruling exists to compel. No affirmative verification claim
 * exists anywhere in this module, and a test asserts that mechanically.
 */
export const W211_LP_INVITE_NO_STATUS_CLAIM =
  "Capavate does not describe any investor as accredited, professional, sophisticated, qualified, verified or screened. It records the category you have determined, the basis you relied on, the date, and the version of the declaration used.";

/** Draft 04 A3, the statement shown under the per-jurisdiction reference panel. */
export const W211_LP_INVITE_JURISDICTION_STATEMENT =
  "These definitions are not the same as each other. They differ in threshold, in what evidence is required, in what procedure must be followed, and in how long a declaration lasts. A declaration valid in one place is not valid in another, and a single global confirmation is not valid anywhere. Capavate therefore records a jurisdiction-specific declaration and its expiry, and does not offer one global confirmation.";

export const W211_LP_INVITE_JURISDICTION_HEADING =
  "Eligibility is per jurisdiction, and there is no single global answer";

/**
 * WAVE 215 OWNS THE ACCREDITATION MECHANISM. Wave 211 REFERENCES it and does not
 * rebuild it, and does not create a second one.
 *
 * The platform already contains a nine-jurisdiction eligibility component
 * (`client/src/components/AccreditationForm.tsx`, `ACCREDITATION_JURISDICTIONS`,
 * backed by `investor_accreditation_declaration`). Draft 04 A3 is explicit: "DO NOT
 * BUILD THIS TWICE … That component is the right architecture and should be
 * corrected and reused, not replaced." Two of its figures are out of date and it has
 * no submit path. Correcting and wiring it is wave 215's job, not this wave's.
 *
 * So wave 211 renders NO threshold, NO jurisdiction row and NO global "I am
 * accredited" tick. It renders the structural statement above — that a single global
 * confirmation is not valid anywhere — and this pointer.
 */
export const W211_LP_INVITE_ACCREDITATION_POINTER =
  "The per-jurisdiction investor declaration is a separate, versioned record with its own expiry. It is not collected here and it is not replaced by anything you tick on this form. Ticking the confirmations below is not a declaration that this person is eligible anywhere; it records that you, not Capavate, have made that determination.";

/** Draft 04 A6, tick 1 — authority to invite. */
export const W211_LP_INVITE_TICK_1 =
  "I confirm I am authorised to invite this person to this vehicle on behalf of this firm.";

/** Draft 04 A6, tick 2 — the eligibility determination is the firm's, per jurisdiction. */
export const W211_LP_INVITE_TICK_2 =
  "I confirm I have determined that this person is eligible to receive this invitation and to participate in this vehicle under the law of the place where they are, and that this firm — not Capavate — is responsible for that determination and for any warning, statement or categorisation the law of that place requires.";

/** Draft 04 A6, tick 3 — no identity, wealth, status, CDD or sanctions check is performed. */
export const W211_LP_INVITE_TICK_3 =
  "I understand that Capavate does not verify this person's identity, wealth, status, eligibility or source of funds, does not perform customer due diligence or sanctions screening on them, and does not check whether the invitation may lawfully be sent.";

/** Draft 04 A6, the blocker. */
export const W211_LP_INVITE_BLOCKER =
  "Type your full legal name and accept all three confirmations to send this invitation.";

export const W211_LP_INVITE_FOOTNOTE =
  "Your name, your assent and a UTC timestamp are recorded for audit against this invitation.";

export interface Wave211LpInviteFacts {
  /** The partner firm's name as the platform holds it. */
  partnerName?: string | null;
  /** The vehicle's name as the platform holds it. */
  vehicleName?: string | null;
  /** The invitee's email exactly as typed. Shown so the partner confirms the right person. */
  inviteeEmail?: string | null;
}

export function wave211LpInviteParagraphs(facts: Wave211LpInviteFacts): string[] {
  const clause = wave211AgreementSection(W211_CPA_MARKER_ELIGIBILITY);
  return [
    W211_LP_INVITE_HEADING,
    `${W211_RECITAL_LABEL_VEHICLE}: ${describeText(facts.vehicleName)}`,
    `Invitee: ${describeText(facts.inviteeEmail)}`,
    wave211LpInviteAttribution(facts.partnerName),
    W211_LP_INVITE_ELIGIBILITY_IS_YOURS,
    W211_LP_INVITE_NO_STATUS_CLAIM,
    W211_LP_INVITE_JURISDICTION_HEADING,
    W211_LP_INVITE_JURISDICTION_STATEMENT,
    W211_LP_INVITE_ACCREDITATION_POINTER,
    W211_LP_INVITE_TICK_1,
    W211_LP_INVITE_TICK_2,
    W211_LP_INVITE_TICK_3,
    W211_CPA_QUOTE_HEADING_ELIGIBILITY,
    clause ?? W211_CPA_QUOTE_UNAVAILABLE,
    W211_LP_INVITE_FOOTNOTE,
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · CAP-TABLE COMMITMENT — DRAFT 04 PART B5 / B6, VERBATIM
   ══════════════════════════════════════════════════════════════════════════ */

export const W211_LP_COMMIT_HEADING = "Confirm this commitment (required)";
export const W211_LP_COMMIT_NAME_LABEL = "Full legal name *";
export const W211_LP_COMMIT_NAME_PLACEHOLDER = "Type your full legal name";

/**
 * Draft 04 B5, the "Indication of interest (soft circle)" wording, quoted so the
 * partner can see the DIFFERENCE between the two states before choosing the
 * binding one. Wave 211 does not edit the existing soft-circle attestation text.
 */
export const W211_LP_COMMIT_SOFT_CIRCLE_CONTRAST =
  "An indication of interest is a non-binding indication of interest. It is not a contract, not a subscription and not an obligation to invest. It becomes binding only when definitive transaction documents are executed by both parties. What you are recording here is not that.";

/** Draft 04 B5, the commitment wording. `{PARTNER}` substituted. */
export function wave211LpCommitWhatItIs(partnerName: string | null | undefined): string {
  const p = describePartnerSelf(partnerName);
  return (
    `Recording a commitment records that the investor has agreed to subscribe on the terms ` +
    `set out in the vehicle's documents. It is their agreement with the vehicle and with ` +
    `${p}, not with Capavate. What they are actually bound by is what those documents say, ` +
    `and they prevail over anything shown here. Capavate does not hold or receive their ` +
    `money. Any payment is made to an account controlled by the vehicle or ${p}, on their ` +
    `instructions, outside Capavate.`
  );
}

/** Draft 04 B5, second paragraph — what the figures are and are not. */
export function wave211LpCommitFiguresAre(partnerName: string | null | undefined): string {
  const p = describePartnerSelf(partnerName);
  return (
    `The figures shown here are administrative records compiled from information ${p} has ` +
    `entered. They are not confirmations of legal entitlement, not statements of what any ` +
    `investor will receive, and not tax figures.`
  );
}

/** Draft 04 B6 — the non-custodial posture and the plain anti-fraud line. */
export function wave211LpCommitNonCustodial(partnerName: string | null | undefined): string {
  const p = describePartnerSelf(partnerName);
  return (
    `Capavate never holds money on an investor's behalf, and never asks an investor to send ` +
    `subscription money, capital contributions or investment money to Capavate. Any such ` +
    `payment is made to an account controlled by the vehicle or ${p}. If anything ever asks ` +
    `an investor to pay subscription or investment money to Capavate, it should not be paid ` +
    `and it should be raised with ${p}.`
  );
}

/** Commitment tick 1 — authority. */
export const W211_LP_COMMIT_TICK_1 =
  "I confirm I am authorised to commit this investor to this vehicle's cap table on behalf of this firm.";

/** Commitment tick 2 — the commitment is real, agreed, and evidenced outside the platform. */
export const W211_LP_COMMIT_TICK_2 =
  "I confirm this investor has agreed to subscribe on the terms set out in the vehicle's documents, that the amount and currency I have entered match that agreement, and that this is a commitment and not an indication of interest.";

/** Commitment tick 3 — no verification, no custody, and the entry is append-only. */
export const W211_LP_COMMIT_TICK_3 =
  "I understand that Capavate does not verify this investor's identity, wealth, status, eligibility or source of funds, does not hold or receive their money, and records this commitment on an append-only cap table that cannot be edited or deleted afterwards.";

export const W211_LP_COMMIT_BLOCKER =
  "Type your full legal name and accept all three confirmations to record this commitment.";

export const W211_LP_COMMIT_FOOTNOTE =
  "Your name, your assent and a UTC timestamp are recorded for audit against this commitment. The cap-table entry cannot be edited or deleted afterwards.";

export interface Wave211LpCommitFacts {
  partnerName?: string | null;
  vehicleName?: string | null;
  investorEmail?: string | null;
  /** The commitment amount EXACTLY as supplied. Never parsed, never converted. */
  amountRaw?: string | number | null;
  /** Which unit `amountRaw` is in. Named, never assumed. */
  amountUnit?: Wave211AmountUnit | null;
  /** The currency code as supplied. Never defaulted, never converted. */
  currency?: string | null;
}

export function wave211LpCommitRecitalLines(facts: Wave211LpCommitFacts): string[] {
  const currency = describeCurrencyOrNull(facts.currency);
  return [
    `${W211_RECITAL_LABEL_VEHICLE}: ${describeText(facts.vehicleName)}`,
    `Investor: ${describeText(facts.investorEmail)}`,
    amountLine(facts.amountRaw, facts.amountUnit),
    `${W211_RECITAL_LABEL_CURRENCY}: ${currency ?? W211_ABSENT_CURRENCY}`,
  ];
}

export function wave211LpCommitParagraphs(facts: Wave211LpCommitFacts): string[] {
  const clause = wave211AgreementSection(W211_CPA_MARKER_ELIGIBILITY);
  return [
    W211_LP_COMMIT_HEADING,
    W211_MONEY_EVENT_RECITAL_HEADING,
    ...wave211LpCommitRecitalLines(facts),
    W211_LP_COMMIT_SOFT_CIRCLE_CONTRAST,
    wave211LpCommitWhatItIs(facts.partnerName),
    wave211LpCommitFiguresAre(facts.partnerName),
    wave211LpCommitNonCustodial(facts.partnerName),
    W211_LP_COMMIT_TICK_1,
    W211_LP_COMMIT_TICK_2,
    W211_LP_COMMIT_TICK_3,
    W211_CPA_QUOTE_HEADING_ELIGIBILITY,
    clause ?? W211_CPA_QUOTE_UNAVAILABLE,
    W211_LP_COMMIT_FOOTNOTE,
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · INVESTOR-FACING TEXT ALONGSIDE A RECORDED DISTRIBUTION — DRAFT 03
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Draft 03's investor-facing paragraphs. Shown to the INVESTOR beside a recorded
 * distribution, not to the partner.
 *
 * The second paragraph is why the platform must never label anything "tax summary"
 * or "taxable": these figures are not tax figures, and saying so in the place the
 * investor reads is the whole point.
 */
export function wave211InvestorFacingDistributionNote(
  partnerName: string | null | undefined,
  eventNoun: string,
): string[] {
  const p = describeText(partnerName);
  const noun = wave211EventNounOrNull(eventNoun) ?? W211_EVENT_NOUN_DISTRIBUTION;
  return [
    `This record was entered by ${p}. It states what ${p} has recorded about this ${noun} ` +
      `for this vehicle. It is not a receipt, not a confirmation of payment, and not a ` +
      `statement of what you are entitled to receive. Capavate does not hold or move money ` +
      `and does not confirm that any payment has been made. The vehicle's constitutional and ` +
      `subscription documents govern what you are entitled to, and they prevail over this ` +
      `record. If this record does not match what you received, or does not match what you ` +
      `expected, raise it with ${p}. Capavate cannot amend, correct or reverse it.`,

    `This record is not a tax document and the figures in it are not tax figures. They do ` +
      `not reflect tax basis, tax character, timing differences or withholding, and must not ` +
      `be used as the basis of any tax return or filing.`,
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · TEXT ASSEMBLY
   ══════════════════════════════════════════════════════════════════════════ */

export type Wave211AttestationFacts =
  | ({ kind: "money_event" } & Wave211MoneyEventFacts)
  | ({ kind: "lp_invitation" } & Wave211LpInviteFacts)
  | ({ kind: "lp_commitment" } & Wave211LpCommitFacts);

export function wave211AttestationParagraphs(facts: Wave211AttestationFacts): string[] {
  if (facts.kind === "lp_invitation") return wave211LpInviteParagraphs(facts);
  if (facts.kind === "lp_commitment") return wave211LpCommitParagraphs(facts);
  return wave211MoneyEventParagraphs(facts);
}

/**
 * The exact text shown, joined by blank lines. This is what is stored verbatim and
 * what is hashed (R187.3). Client and server call this with the same facts and get
 * the same bytes.
 */
export function buildWave211AttestationText(facts: Wave211AttestationFacts): string {
  return wave211AttestationParagraphs(facts)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/* ══════════════════════════════════════════════════════════════════════════
   9 · THE SIGN-OFF ITSELF
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A human name is not truncated to fit a column. It is refused with its length
 * named, so the partner knows what to do. 200 matches the launch sign-off.
 */
export const W211_SIGNED_NAME_MAX_LENGTH = 200;
/** The basis-of-determination free text. Long enough for a notice title and a date. */
export const W211_BASIS_MAX_LENGTH = 500;

export const W211_ERR_NAME_REQUIRED = "WAVE211_ATTESTATION_NAME_REQUIRED";
export const W211_ERR_NAME_TOO_LONG = "WAVE211_ATTESTATION_NAME_TOO_LONG";
export const W211_ERR_BASIS_REQUIRED = "WAVE211_ATTESTATION_BASIS_REQUIRED";
export const W211_ERR_BASIS_TOO_LONG = "WAVE211_ATTESTATION_BASIS_TOO_LONG";
export const W211_ERR_TICKS_REQUIRED = "WAVE211_ATTESTATION_TICKS_REQUIRED";
export const W211_ERR_VERSION_MISMATCH = "WAVE211_ATTESTATION_VERSION_MISMATCH";
export const W211_ERR_STORAGE_UNAVAILABLE = "WAVE211_ATTESTATION_STORAGE_UNAVAILABLE";

export type Wave211TextOutcome =
  | { ok: true; value: string }
  | { ok: false; code: string; length?: number };

/**
 * Fold whitespace and REFUSE what is too long. Never truncates: a silently
 * shortened legal name is a forged legal name.
 *
 * Presence and type are checked BEFORE any equality or length comparison (R176.1),
 * so a `null`, a number or an object is reported as missing rather than coerced.
 */
export function wave211SignedNameOutcome(raw: unknown): Wave211TextOutcome {
  if (typeof raw !== "string") return { ok: false, code: W211_ERR_NAME_REQUIRED };
  const folded = raw.replace(/\s+/g, " ").trim();
  if (folded.length === 0) return { ok: false, code: W211_ERR_NAME_REQUIRED };
  if (folded.length > W211_SIGNED_NAME_MAX_LENGTH) {
    return { ok: false, code: W211_ERR_NAME_TOO_LONG, length: folded.length };
  }
  return { ok: true, value: folded };
}

/** The basis of determination. Draft 03 marks it required for money events. */
export function wave211BasisOutcome(raw: unknown): Wave211TextOutcome {
  if (typeof raw !== "string") return { ok: false, code: W211_ERR_BASIS_REQUIRED };
  const folded = raw.replace(/\s+/g, " ").trim();
  if (folded.length === 0) return { ok: false, code: W211_ERR_BASIS_REQUIRED };
  if (folded.length > W211_BASIS_MAX_LENGTH) {
    return { ok: false, code: W211_ERR_BASIS_TOO_LONG, length: folded.length };
  }
  return { ok: true, value: folded };
}

/**
 * A tick is accepted ONLY on a literal boolean `true`.
 *
 * Not `"true"`, not `1`, not `"on"`, not `[]`. R176.1: the type is established by
 * the comparison itself, so nothing is coerced on the way in. A partner who cannot
 * tick a box is blocked; a partner whose box is unreadable is told it is missing.
 */
export function wave211TickAccepted(raw: unknown): boolean {
  return raw === true;
}

/** All three ticks, in draft order. Every one is mandatory. */
export function wave211AllTicksAccepted(
  t1: unknown,
  t2: unknown,
  t3: unknown,
): boolean {
  return wave211TickAccepted(t1) && wave211TickAccepted(t2) && wave211TickAccepted(t3);
}

/**
 * The version token the client claims to have rendered.
 *
 * The server compares the VERSION, not the prose. Comparing prose would refuse a
 * legitimate partner whose figure round-trips a byte differently; comparing the
 * version catches a forged or paraphrased attestation, which is the actual threat,
 * and the server then stores ITS OWN rendered text so what is kept is what the
 * platform stands behind.
 */
export function wave211VersionMatches(kind: Wave211AttestationKind, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return raw.trim() === wave211AttestationVersion(kind);
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  ONE ACCESSOR PER SURFACE — SO THE SCREEN AND THE SERVER CANNOT DRIFT
 *
 *  The three attestation kinds have three sets of ticks, three headings and three
 *  blocker sentences. The panel that RENDERS them and the tests that ASSERT them
 *  both read the accessors below rather than reaching for the per-kind constants,
 *  so a kind cannot end up rendering one kind's heading over another kind's ticks.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The three confirmations for a kind, in the order they are rendered and in the
 * order the server checks them. `eventNoun` is required for `money_event` and
 * ignored for the other two.
 */
export function wave211TickLabels(
  kind: Wave211AttestationKind,
  eventNoun?: string | null,
): [string, string, string] {
  if (kind === "money_event") {
    /* The noun is REQUIRED here. Defaulting it to "distribution" would put the
       wrong word in a capital call's confirmation, so an unknown noun is refused
       upstream (`W211_ERR_EVENT_NOUN_UNKNOWN`) rather than papered over. */
    const noun = wave211EventNounOrNull(eventNoun);
    const n = noun ?? W211_EVENT_NOUN_DISTRIBUTION;
    return [
      wave211MoneyEventTick1(n),
      wave211MoneyEventTick2(n),
      wave211MoneyEventTick3(n),
    ];
  }
  if (kind === "lp_invitation") {
    return [W211_LP_INVITE_TICK_1, W211_LP_INVITE_TICK_2, W211_LP_INVITE_TICK_3];
  }
  return [W211_LP_COMMIT_TICK_1, W211_LP_COMMIT_TICK_2, W211_LP_COMMIT_TICK_3];
}

/** The panel heading for a kind. */
export function wave211PanelHeading(
  kind: Wave211AttestationKind,
  eventNoun?: string | null,
): string {
  if (kind === "money_event") {
    return wave211MoneyEventHeading(wave211EventNounOrNull(eventNoun) ?? W211_EVENT_NOUN_DISTRIBUTION);
  }
  return kind === "lp_invitation" ? W211_LP_INVITE_HEADING : W211_LP_COMMIT_HEADING;
}

/** The sentence shown while the confirmation is incomplete. */
export function wave211BlockerText(
  kind: Wave211AttestationKind,
  eventNoun?: string | null,
): string {
  if (kind === "money_event") {
    return wave211MoneyEventBlocker(wave211EventNounOrNull(eventNoun) ?? W211_EVENT_NOUN_DISTRIBUTION);
  }
  return kind === "lp_invitation" ? W211_LP_INVITE_BLOCKER : W211_LP_COMMIT_BLOCKER;
}

/** The small print under the panel — what is captured, in plain words. */
export function wave211FootnoteText(kind: Wave211AttestationKind): string {
  if (kind === "money_event") return W211_MONEY_EVENT_FOOTNOTE;
  return kind === "lp_invitation" ? W211_LP_INVITE_FOOTNOTE : W211_LP_COMMIT_FOOTNOTE;
}

/** The typed-name field label for a kind. */
export function wave211NameLabel(kind: Wave211AttestationKind): string {
  if (kind === "money_event") return W211_MONEY_EVENT_NAME_LABEL;
  return kind === "lp_invitation" ? W211_LP_INVITE_NAME_LABEL : W211_LP_COMMIT_NAME_LABEL;
}

/** The typed-name placeholder for a kind. */
export function wave211NamePlaceholder(kind: Wave211AttestationKind): string {
  if (kind === "money_event") return W211_MONEY_EVENT_NAME_PLACEHOLDER;
  return kind === "lp_invitation" ? W211_LP_INVITE_NAME_PLACEHOLDER : W211_LP_COMMIT_NAME_PLACEHOLDER;
}

/** True when a kind also requires the basis of the underlying determination. */
export function wave211RequiresBasis(kind: Wave211AttestationKind): boolean {
  return kind === "money_event";
}
