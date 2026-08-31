/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 212 · R186.2 · D3/C3 — THE FOUNDER ROUND-CREATION ATTESTATION.
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE authority for the words shown to a founder at the moment a round is created
 * and for the words stored on the round row afterwards. Client and server both
 * assemble the text from THIS module, so the sentence a founder ticked and the
 * sentence the platform can produce years later are the same bytes rather than two
 * copies that drift. This mirrors `shared/spvAttestation.ts`, which exists for
 * exactly that reason and is the pattern draft 02 says to follow
 * (`build_log/legal/drafts/02_ROUND_CREATION_ATTESTATION.md`).
 *
 * WORDING PROVENANCE. Every sentence below is draft 02's, verbatim. Nothing here
 * is authored, paraphrased or "improved" by the builder. The draft deliberately
 * does NOT reproduce the SPV launch attestation's "legal equivalent of a
 * handwritten signature … (ESIGN/UETA)" clause, and neither does this module.
 *
 * VERSIONS ARE ADDED, NEVER EDITED (R44). `ROUND-ATT-v1` is frozen the moment a
 * single row stores it. A change of wording is `ROUND-ATT-v2` alongside it, so a
 * stored row keeps proving what was actually on the screen.
 *
 * NO FIGURE IS EVER INVENTED OR DEFAULTED (R-ASSERT, handbook §14; R143.4). The
 * round's own facts are interpolated live, and a fact the round does not carry is
 * NAMED AS ABSENT IN WORDS. It is never rendered as `0`, never as an em dash and
 * never as a blank. The soft-circle flow's `Number(amount) || 0` — which prints a
 * confident `$0` for an empty field — is the anti-pattern this module refuses to
 * repeat.
 *
 * NO PARSING OF MONEY, EVER (R190 / the money-exponent fence). Figures are shown
 * exactly as the founder typed them. There is no `Number()`, no `parseFloat`, no
 * rounding, no formatting and no arithmetic in this file. A value that cannot be
 * shown as a plain decimal is declared unshowable rather than being coerced into
 * something that looks authoritative.
 *
 * NO CURRENCY IS NAMED HERE (R156.2). The currency code is interpolated from the
 * round; when the round carries none, a separate frozen sentence says so instead
 * of a placeholder.
 *
 * This module is dependency-free on purpose: it is imported by the browser bundle
 * and by the server, so it may never reach for the database or `node:crypto`.
 */

/** Frozen version identifier. A wording change is a NEW constant, never an edit. */
export const ROUND_CREATION_ATTESTATION_VERSION = "ROUND-ATT-v1";

/* ─────────────────────────── DRAFT 02 · VERBATIM COPY ─────────────────────── */

export const ROUND_CREATION_ATTESTATION_HEADING = "Authorised sign-off (required)";

export const ROUND_CREATION_ATTESTATION_NAME_LABEL = "Full legal name *";

export const ROUND_CREATION_ATTESTATION_NAME_PLACEHOLDER = "Type your full legal name";

/** Draft 02 · Statement 1 — what creating a round does and does not do. */
export const ROUND_CREATION_ATTESTATION_STATEMENT_1 =
  "Creating a round records the terms you have entered. It does not create, offer, issue or allot any security, it does not open any offering, and it does not make anything available to anyone until you invite them. Capavate is not a party to your round and takes no part in whether or how you raise capital.";

/**
 * Draft 02 · Statement 2 — currency. The draft writes `{CURRENCY}` twice; both
 * occurrences are filled from the round's own currency code and from nothing else.
 */
const STATEMENT_2_HEAD = "This round will be recorded in ";
const STATEMENT_2_MIDDLE = ". Every amount recorded against it will be recorded in ";
const STATEMENT_2_TAIL =
  ". Capavate does not convert currencies and will not add amounts in different currencies together.";

/**
 * The no-currency branch. Reachable only by a caller that supplies no usable
 * currency code — the wizard's create control already requires the founder to
 * choose one. It states the absence instead of printing `{CURRENCY}`, a blank, or
 * a guessed code. The second and third sentences are Statement 2's own wording.
 */
export const ROUND_CREATION_ATTESTATION_STATEMENT_2_NO_CURRENCY =
  "No currency is recorded on this round, so Capavate cannot state here which currency its amounts are in. Capavate does not convert currencies and will not add amounts in different currencies together.";

/** Draft 02 · Statement 3 — no verification, no advice. */
export const ROUND_CREATION_ATTESTATION_STATEMENT_3 =
  "Capavate does not check your valuation, your price per share, your terms, or your authority to set them. Capavate does not advise on any of them and gives no opinion on whether they are appropriate. Terms of this kind have legal and tax consequences for your company and for your existing holders. You should take advice from your own qualified counsel before you rely on this round's terms or share them with anyone.";

/** Draft 02 · Statement 4 — who may see it. */
export const ROUND_CREATION_ATTESTATION_STATEMENT_4 =
  "Nothing about this round is public. It becomes visible to another person only when you invite them or grant them access. Before you invite anyone, read the invitation disclosures, because whether you may lawfully invite a particular person depends on where they are and what they are.";

/** Draft 02 · the checkbox label. This is the sentence the founder ticks. */
export const ROUND_CREATION_ATTESTATION_CHECKBOX_LABEL =
  "I certify that I am authorised to create this fundraising round on behalf of this company. I confirm that the information I have entered — including the round type, the amount sought, the valuation, the price per share, the instrument, the currency and the other terms — is accurate and complete to the best of my knowledge. I understand that Capavate does not verify any of it, that other people including prospective investors may rely on it, and that the company's executed transaction documents, and not this record, are the authoritative statement of the round's terms. I understand that Capavate's cap table and round records are administrative records and are not authoritative legal records of ownership or entitlement. I understand this action creates a recorded, timestamped entry on the Capavate platform, and I consent to the use of my electronic signature for that record.";

/** Draft 02 · shown while the sign-off is incomplete. Under the 240-char gate. */
export const ROUND_CREATION_ATTESTATION_BLOCKER =
  "Type your full legal name and accept the attestation to create this round.";

/** Draft 02 · footnote. */
export const ROUND_CREATION_ATTESTATION_FOOTNOTE =
  "Your name, your assent and a UTC timestamp are recorded for audit.";

/* ──────────────────── THE ROUND'S OWN FACTS, NAMED OR ABSENT ───────────────── */

/**
 * Heading for the recital of the round's own facts.
 *
 * WHY IT DOES NOT SAY "AS YOU ENTERED IT". An earlier draft of this heading did,
 * and it was wrong. On a priced round the wizard DERIVES the price per share from
 * the pre-money valuation and the fully-diluted pre-money share count
 * (`client/src/pages/founder/RoundNew.tsx` — `derivedPricePerShare`) and writes it
 * into the form, so the price recited here is a figure the platform worked out, not
 * one the founder typed. The platform likewise derives a target raise for a common
 * priced round and for a warrant issuance inside the create handler. Telling a
 * founder they "entered" a figure the platform computed would be a false statement
 * inside the very sentence they are signing.
 *
 * "AS IT STANDS ON THIS ROUND RIGHT NOW" is true in every branch: entered, derived,
 * and absent. Where a figure is absent, `RECITAL_ABSENT_FIGURE` still addresses the
 * founder directly, because absence IS about what they did not enter.
 */
export const ROUND_CREATION_ATTESTATION_RECITAL_HEADING =
  "What you are about to create, as it stands on this round right now:";

/** Labels. Kept as constants so the client cannot render a different label. */
export const RECITAL_LABEL_COMPANY = "Company";
export const RECITAL_LABEL_ROUND_NAME = "Round name";
export const RECITAL_LABEL_PRICE_PER_SHARE = "Price per share";
export const RECITAL_LABEL_TARGET_AMOUNT = "Target amount";

/**
 * How an absent NAME is said — not a dash, not a blank.
 */
export const RECITAL_ABSENT = "not recorded on this round";

/**
 * How an absent FIGURE is said. Never `0`, never a dash, never blank (R143.4 —
 * "Capavate will not show a zero total for a figure it does not hold"). The wording
 * addresses the founder because the recital is about what they entered.
 */
export const RECITAL_ABSENT_FIGURE = "you did not enter a figure for this";

/**
 * How a present-but-unshowable figure is said. Reached when a caller supplies
 * something that is not a plain decimal number — exponent notation, a currency
 * symbol, a range, a word. The platform will not restate it as if it were a clean
 * figure and will not parse it, so it says what it is instead.
 */
export const RECITAL_NOT_PLAIN_NUMBER =
  "recorded on this round, but not in a plain number form, so it is not restated here";

/** A plain decimal. No exponent, no separators, no sign, no currency symbol. */
const PLAIN_DECIMAL = /^\d{1,24}(\.\d{1,12})?$/;

/**
 * THE ONE NORMALISER BOTH SIDES USE, so the screen and the stored row cannot say
 * different things about the same figure.
 *
 * The wizard normalises the founder's typed text before it sends it, so the server
 * never receives exactly what was on screen. If each side described the figure from
 * what IT holds, a comma-grouped entry would read one way to the founder and another
 * way in the record. Both sides therefore pass the value through here first: the
 * result is either a plain decimal string or `null`, and `null` is described as
 * "you did not enter a figure for this" on both sides.
 *
 * This is a SHAPE TEST, not a parse. Nothing is summed, rounded or converted.
 */
export function plainDecimalOrNull(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : String(raw).trim();
  return PLAIN_DECIMAL.test(s) ? s : null;
}

export interface RoundCreationAttestationFacts {
  /** The company's name as the platform holds it. */
  companyName?: string | null;
  /** The round's name as typed. */
  roundName?: string | null;
  /** Price per share EXACTLY as supplied. Never parsed. */
  pricePerShareRaw?: string | number | null;
  /** Target amount EXACTLY as supplied. Never parsed. */
  targetAmountRaw?: string | number | null;
  /** The round's currency code as supplied. */
  currency?: string | null;
}

/** A name-ish fact: shown as given, or declared absent. Never blank. */
function describeText(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return s.length > 0 ? s : RECITAL_ABSENT;
}

/**
 * A figure. Shown byte-for-byte as supplied when it is already a plain decimal.
 *
 * A JavaScript `number` reaches this function from non-wizard callers. `String(n)`
 * is a widening of a value the caller already held as a number — it is not a parse
 * of typed text, and the result is then REQUIRED to match `PLAIN_DECIMAL`, which is
 * precisely what the money-exponent fence protects against: `String(1e21)` yields
 * `"1e+21"`, fails the test, and is declared unshowable rather than being printed
 * as if it were a figure. No rounding, no `toFixed`, no locale formatting.
 */
function describeFigure(raw: string | number | null | undefined): string {
  if (raw == null) return RECITAL_ABSENT_FIGURE;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.length === 0) return RECITAL_ABSENT_FIGURE;
    return PLAIN_DECIMAL.test(s) ? s : RECITAL_NOT_PLAIN_NUMBER;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return RECITAL_NOT_PLAIN_NUMBER;
    const s = String(raw);
    return PLAIN_DECIMAL.test(s) ? s : RECITAL_NOT_PLAIN_NUMBER;
  }
  return RECITAL_NOT_PLAIN_NUMBER;
}

/** A 3-letter currency code as supplied, or `null`. No code is ever invented. */
function describeCurrency(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z]{3}$/.test(s) ? s : null;
}

/** Draft 02 · Statement 2, filled from the round's own currency or its absence. */
export function roundCreationCurrencyStatement(currency: string | null | undefined): string {
  const code = describeCurrency(currency);
  if (code == null) return ROUND_CREATION_ATTESTATION_STATEMENT_2_NO_CURRENCY;
  return `${STATEMENT_2_HEAD}${code}${STATEMENT_2_MIDDLE}${code}${STATEMENT_2_TAIL}`;
}

/** The recital of the round's own facts, one line per fact, in a fixed order. */
export function roundCreationRecitalLines(facts: RoundCreationAttestationFacts): string[] {
  return [
    `${RECITAL_LABEL_COMPANY}: ${describeText(facts.companyName)}`,
    `${RECITAL_LABEL_ROUND_NAME}: ${describeText(facts.roundName)}`,
    `${RECITAL_LABEL_PRICE_PER_SHARE}: ${describeFigure(facts.pricePerShareRaw)}`,
    `${RECITAL_LABEL_TARGET_AMOUNT}: ${describeFigure(facts.targetAmountRaw)}`,
  ];
}

/**
 * THE ORDERED BLOCK, as one paragraph per screen element.
 *
 * The client renders this array and the server stores the same array joined; a
 * wave-212 test walks the rendered DOM and asserts the concatenation equals the
 * stored column byte for byte. Neither side owns a private copy of a sentence.
 */
export function roundCreationAttestationParagraphs(
  facts: RoundCreationAttestationFacts,
): { key: string; text: string }[] {
  const recital = roundCreationRecitalLines(facts);
  return [
    { key: "heading", text: ROUND_CREATION_ATTESTATION_HEADING },
    { key: "statement-1", text: ROUND_CREATION_ATTESTATION_STATEMENT_1 },
    { key: "statement-2", text: roundCreationCurrencyStatement(facts.currency) },
    { key: "statement-3", text: ROUND_CREATION_ATTESTATION_STATEMENT_3 },
    { key: "statement-4", text: ROUND_CREATION_ATTESTATION_STATEMENT_4 },
    { key: "recital-heading", text: ROUND_CREATION_ATTESTATION_RECITAL_HEADING },
    { key: "recital-company", text: recital[0] },
    { key: "recital-round-name", text: recital[1] },
    { key: "recital-price-per-share", text: recital[2] },
    { key: "recital-target-amount", text: recital[3] },
    { key: "checkbox-label", text: ROUND_CREATION_ATTESTATION_CHECKBOX_LABEL },
    { key: "footnote", text: ROUND_CREATION_ATTESTATION_FOOTNOTE },
  ];
}

/**
 * The exact text shown, as one string, for storage (draft 02: "Attestation text
 * as displayed, verbatim"). Deterministic: same facts in, same bytes out.
 */
export function buildRoundCreationAttestationText(facts: RoundCreationAttestationFacts): string {
  return roundCreationAttestationParagraphs(facts)
    .map((p) => p.text)
    .join("\n\n");
}

/* ───────────────────────────── THE TWO INPUTS ─────────────────────────────── */

/** The longest signature the platform will store. Longer is refused, not cut. */
export const ROUND_CREATION_SIGNED_NAME_MAX_LENGTH = 200;

export const ERR_SIGNED_NAME_REQUIRED = "ROUND_CREATION_ATTESTATION_NAME_REQUIRED";
export const ERR_SIGNED_NAME_TOO_LONG = "ROUND_CREATION_ATTESTATION_NAME_TOO_LONG";
export const ERR_ATTESTATION_REQUIRED = "ROUND_CREATION_ATTESTATION_REQUIRED";

export type SignedNameOutcome =
  | { ok: true; signedName: string }
  | { ok: false; code: string };

/**
 * Validate the typed signature. Whitespace-only is empty. Internal runs of
 * whitespace are folded to single spaces so the stored signature is the name and
 * not the founder's keystrokes; nothing else about it is altered, and it is never
 * truncated — an over-long name is REFUSED, because silently storing half of a
 * signature would be storing a signature nobody gave.
 */
export function roundCreationSignedNameOutcome(raw: unknown): SignedNameOutcome {
  if (typeof raw !== "string") return { ok: false, code: ERR_SIGNED_NAME_REQUIRED };
  const folded = raw.replace(/\s+/g, " ").trim();
  if (folded.length === 0) return { ok: false, code: ERR_SIGNED_NAME_REQUIRED };
  if (folded.length > ROUND_CREATION_SIGNED_NAME_MAX_LENGTH) {
    return { ok: false, code: ERR_SIGNED_NAME_TOO_LONG };
  }
  return { ok: true, signedName: folded };
}

/**
 * Was the attestation accepted? STRICTLY the boolean `true`. A truthy string, a
 * `1`, or a present-but-false flag is not an acceptance, and nothing here coerces
 * one into being one: this is the difference between a founder who ticked a box
 * and a caller who sent a field.
 */
export function roundCreationAttestationAccepted(raw: unknown): boolean {
  return raw === true;
}

/** True when both inputs are present and usable — the client's enable condition. */
export function roundCreationSignoffComplete(rawName: unknown, rawAccepted: unknown): boolean {
  return roundCreationSignedNameOutcome(rawName).ok && roundCreationAttestationAccepted(rawAccepted);
}
