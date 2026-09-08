/**
 * WAVE 216 — THE BYTES THE SIGNER ACTUALLY SIGNS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `migrations/0168_wave11_esignature_envelope.sql` says of the document bytes, in
 * its own design note: "The bytes are NOT copied here." That is deliberate and it
 * is not being reversed. The consequence is that the platform has never held the
 * PDF, cannot hash it, and must not pretend otherwise.
 *
 * What the platform DOES hold, and what the signer actually reads and assents to
 * on the signing surface, is a SIGNING STATEMENT: which vehicle, which document,
 * an express statement of intent, and an express ESIGN/UETA consent. This module
 * is the ONE place those bytes are composed.
 *
 * THE INVARIANT THIS MODULE EXISTS TO MAKE PROVABLE:
 *
 *     the bytes rendered to the signer  ===  the bytes hashed and stored
 *
 * Both sides call `buildWave216SignedStatement()`. The client renders its return
 * value into a single text node and posts that same text; the server hashes the
 * posted text and stores the digest. There is exactly ONE hash implementation in
 * the system (node's `createHash` in `server/lib/esignatureRoutes.ts`) so the
 * comparison can never be a comparison of two look-alike implementations.
 *
 * WHAT THIS DOES NOT CLAIM. It does not prove which bytes of the underlying file
 * were signed. Nothing in this platform can, because the file never arrives here.
 * `WAVE216_STATEMENT_SCOPE_NOTE` below says that to the signer in their own
 * language, on the screen, rather than leaving it to be inferred.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO NEW LEGAL PROSE IS AUTHORED HERE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Both operative sentences are the platform's own shipped wording:
 *
 *  · CONSENT — the final sentence of `ATTESTATION_TEXT_V1` (shared/spvAttestation.ts),
 *    the SPV launch sign-off's competent express ESIGN/UETA consent. It is
 *    EXTRACTED from that constant at runtime rather than retyped, so it cannot
 *    drift from the sentence that is actually shipped. A byte-identical frozen
 *    copy is the fallback if the marker is ever absent, and a test pins the two
 *    to be equal.
 *
 *  · INTENT — the platform's shipped SES intent sentence, rendered today at
 *    `client/src/pages/investor/InvitationDetail.tsx:1866`:
 *      "I confirm I have read the term sheet and intend to sign this document.
 *       This constitutes my electronic signature."
 *    The object noun is substituted positionally — "the term sheet" → "this
 *    document" — because an e-signature envelope is not always a term sheet. That
 *    is the same construction `shared/spvAttestation.ts` used to derive its own v2
 *    from v1 ("v2 is v1 with ONE noun substituted"), and it is pinned by test.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ABSENCE IS DECLARED, NEVER BLANKED AND NEVER ZEROED.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Same discipline as `shared/wave211MoneyEventAttestation.ts`: a field with no
 * stored value produces a sentence saying so. There is no `?? ""`, no `?? 0`, no
 * defaulted title and no defaulted currency anywhere in this file.
 */
import { ATTESTATION_TEXT_V1 } from "./spvAttestation";

/** Version of the statement construction. Bump — never mutate — if the shape changes. */
export const WAVE216_STATEMENT_VERSION = "esign-statement-v1";

/** Version of the intent + consent pairing that was assented to. */
export const WAVE216_INTENT_VERSION = "ESIGN-INTENT-v1";

/** What a field with no stored value says about itself. */
export const WAVE216_ABSENT_FIELD = "not on record";

/**
 * The `esign_event.event_kind` written when an envelope's `document_sha256` is a
 * digest of a SIGNING STATEMENT rather than a raw document hash supplied by a
 * caller. Its presence in the envelope's immutable event history — not anything in
 * a request — is what arms the sign-time fence.
 */
export const WAVE216_STATEMENT_BOUND_EVENT = "envelope.statement_bound";

/* ─────────────────────────────────────────────────────────────────────────────
   THE CONSENT SENTENCE — extracted from the shipped SPV launch attestation.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * The first words of the consent sentence inside `ATTESTATION_TEXT_V1`. Used to
 * locate it. If wave N ever rewords the launch attestation such that this marker
 * disappears, the frozen copy below takes over and the pinning test goes RED,
 * which is the outcome we want: a human is told, and no signer is ever shown a
 * half-sentence or an empty string.
 */
const WAVE216_CONSENT_MARKER = "I understand this action creates";

/**
 * A byte-identical copy of the consent sentence as shipped in
 * `ATTESTATION_TEXT_V1`. It exists ONLY as the fallback described above. The test
 * `w216_signed_statement` asserts it equals the extracted value, so the two can
 * never diverge silently.
 */
const WAVE216_CONSENT_SENTENCE_FROZEN =
  "I understand this action creates a recorded, timestamped commitment on the " +
  "Capavate platform, and I consent to the use of my electronic signature as " +
  "the legal equivalent of a handwritten signature under applicable e-signature " +
  "law (ESIGN/UETA).";

function extractConsentSentence(): string {
  const at = ATTESTATION_TEXT_V1.indexOf(WAVE216_CONSENT_MARKER);
  if (at < 0) return WAVE216_CONSENT_SENTENCE_FROZEN;
  return ATTESTATION_TEXT_V1.slice(at);
}

/** The express ESIGN/UETA consent. The platform's own shipped sentence. */
export const WAVE216_CONSENT_SENTENCE: string = extractConsentSentence();

/** Exported for the pinning test only — never rendered. */
export const WAVE216_CONSENT_SENTENCE_FROZEN_FOR_TEST = WAVE216_CONSENT_SENTENCE_FROZEN;

/* ─────────────────────────────────────────────────────────────────────────────
   THE INTENT SENTENCE — the shipped SES intent, one noun substituted.
   ───────────────────────────────────────────────────────────────────────────── */

/** The shipped SES intent sentence, quoted so the substitution is auditable. */
export const WAVE216_SES_INTENT_AS_SHIPPED =
  "I confirm I have read the term sheet and intend to sign this document. " +
  "This constitutes my electronic signature.";

/**
 * The same sentence with its object noun substituted, because an envelope is not
 * always a term sheet. Derived positionally from the shipped string rather than
 * retyped, so a reword of the shipped sentence carries through and the test that
 * pins the substitution goes RED if the phrase it replaces disappears.
 */
export const WAVE216_INTENT_SENTENCE: string = WAVE216_SES_INTENT_AS_SHIPPED.replace(
  "the term sheet",
  "the document identified above",
);

/**
 * The scope of what the hash proves, said out loud on the signing surface.
 * This is not a disclaimer bolted on afterwards — it is the difference between an
 * honest artifact and one that implies a byte-level guarantee over a file the
 * platform has never seen.
 */
export const WAVE216_STATEMENT_SCOPE_NOTE =
  "This statement, exactly as shown here, is what is hashed and stored with your " +
  "signature. It identifies the document; it is not a copy of the document's own " +
  "contents, which Capavate does not hold.";

/** Labels. Named so a test and a screen assert the same bytes. */
export const WAVE216_LABEL_HEADING = "What you are signing";
export const WAVE216_LABEL_VEHICLE = "Vehicle";
export const WAVE216_LABEL_DOCUMENT_KIND = "Document type";
export const WAVE216_LABEL_DOCUMENT_TITLE = "Document";
export const WAVE216_LABEL_DOCUMENT_REF = "Document reference";
export const WAVE216_LABEL_STATEMENT_VERSION = "Statement version";

/** The facts the statement recites. Every one is a STORED envelope field. */
export interface Wave216StatementFacts {
  /** The SPV the envelope is against (`esign_envelope.subject_id`). */
  vehicleRef: string | null | undefined;
  /** `esign_envelope.document_kind`. */
  documentKind: string | null | undefined;
  /** `esign_envelope.document_title`. */
  documentTitle: string | null | undefined;
  /** `esign_envelope.document_ref`. */
  documentRef: string | null | undefined;
}

/** A stored string, restated exactly, or declared absent. Never blanked. */
function statedOrAbsent(raw: string | null | undefined): string {
  if (typeof raw !== "string") return WAVE216_ABSENT_FIELD;
  const s = raw.trim();
  return s.length === 0 ? WAVE216_ABSENT_FIELD : s;
}

/**
 * THE CANONICAL SIGNING STATEMENT.
 *
 * Paragraphs are separated by a single "\n" and the string has no trailing
 * newline, so that `element.textContent` of a single text node holding this value
 * is byte-identical to the value itself. That is the whole point: the comparison
 * in `w216_rendered_bytes_are_hashed_bytes` uses no normalising call, so the bytes
 * must survive the DOM round trip untouched.
 */
export function buildWave216SignedStatement(facts: Wave216StatementFacts): string {
  return [
    WAVE216_LABEL_HEADING,
    `${WAVE216_LABEL_VEHICLE}: ${statedOrAbsent(facts.vehicleRef)}`,
    `${WAVE216_LABEL_DOCUMENT_KIND}: ${statedOrAbsent(facts.documentKind)}`,
    `${WAVE216_LABEL_DOCUMENT_TITLE}: ${statedOrAbsent(facts.documentTitle)}`,
    `${WAVE216_LABEL_DOCUMENT_REF}: ${statedOrAbsent(facts.documentRef)}`,
    `${WAVE216_LABEL_STATEMENT_VERSION}: ${WAVE216_STATEMENT_VERSION}`,
    WAVE216_INTENT_SENTENCE,
    WAVE216_CONSENT_SENTENCE,
    WAVE216_STATEMENT_SCOPE_NOTE,
  ].join("\n");
}

/* ─────────────────────────────────────────────────────────────────────────────
   REFUSALS. Sentences, never bare codes (R77), and each one under the
   240-character `looksHuman` gate — measured, not assumed, by
   `w216_signed_statement`'s length assertions.
   ───────────────────────────────────────────────────────────────────────────── */

export const WAVE216_REFUSAL_INTENT_REQUIRED =
  "This signature was not recorded. A signature needs your express confirmation " +
  "that you intend to sign, so the box above must be ticked before the signature " +
  "can be stored.";

export const WAVE216_REFUSAL_HASH_MISMATCH =
  "This signature was not recorded. The statement your screen showed does not " +
  "match the statement stored with this envelope, so nothing was signed. Reload " +
  "the page and try again.";

/** Why the sign button is disabled, said plainly rather than left to be guessed. */
export const WAVE216_BLOCKED_HINT =
  "Tick the confirmation above before recording a signature. A signature with no " +
  "recorded intent is a weaker record, so the platform will not store one.";

/* ══════════════════════════════════════════════════════════════════════════════
   W6c · D4 — THE THREE IDENTIFIERS IN THE STATEMENT, EXPLAINED BESIDE IT.
   ══════════════════════════════════════════════════════════════════════════════
   QA read the "What you are signing" box and found three strings it could not
   interpret: `spv_24e2f7d0e2d54c5d`, `lpa` in lower case while the dropdown two
   inches above says "LPA", and `esign-statement-v1`. "LPA" itself is never
   spelled out on the surface.

   THESE ARE NOT FIXED BY EDITING THE STATEMENT. The statement's bytes are
   hashed and stored with the signature, and the whole point of this module is
   that the bytes rendered === the bytes hashed. Rewording them would change the
   digest of every future signature and break the equality with every stored one
   — the file header already says "Bump — never mutate". A copy defect must not
   become a data-integrity defect.

   So the identifiers stay EXACTLY as they are, and a legend rendered NEXT TO the
   statement (never inside the hashed text node) says what each one is. This is
   additive: it explains three terms that were not explained anywhere, and it
   changes no signed byte.
   ══════════════════════════════════════════════════════════════════════════════ */
export const WAVE216_IDENTIFIER_LEGEND =
  "About the lines above. \"Vehicle\" is Capavate's own internal reference for this " +
  "SPV — an identifier, not a registered company number. \"Document type\" is the " +
  "category the document was filed under; \"lpa\" is the Limited Partnership " +
  "Agreement, the contract between the general partner running this vehicle and " +
  "the limited partners investing in it. \"Statement version\" identifies the " +
  "wording of this signing statement itself, so a later change to the wording can " +
  "be told apart from this one; it says nothing about the version of your " +
  "document. These lines are shown exactly as they are stored because they are " +
  "part of what is hashed with your signature, and changing how they read would " +
  "change that record.";

/** Shown when this envelope carries a stored statement hash. */
export const WAVE216_BOUND_NOTICE =
  "The statement above is bound to this envelope by a SHA-256 digest of these " +
  "exact bytes.";
