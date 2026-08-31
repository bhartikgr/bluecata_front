/**
 * WAVE 189 · ITEM C · R159.6 — AN UNATTESTED DRAFT MAY EXIST. IT MAY NOT HOLD
 * CAPITAL.
 *
 * Owner, verbatim (R159.6): *"Go with your recommendation."* The recommendation
 * adopted: **drafts allowed, clearly labelled unattested, and no LP, no
 * commitment and no fee may attach until the attestation is signed.** The risk
 * was never the draft — it is a draft quietly becoming real.
 *
 * WHAT THE ATTESTATION IS. `spv_launch_signoffs` (migration 0108) holds the
 * ESIGN/UETA-style record that a general partner typed their full legal name and
 * explicitly assented to the versioned attestation text
 * (`shared/spvAttestation.ts`, UNTOUCHED by this wave). A vehicle with a row in
 * that table linked to its id is ATTESTED. A vehicle with none is not.
 *
 * WHY THE RULE LIVES IN `shared/` AND NOT AT A ROUTE OR A BUTTON. Wave 182's
 * lesson, in the owner's own words: a disabled button is not enforcement — a
 * CLOSED vehicle still accepted capital because the check was missing where the
 * write happens. This module is modelled directly on
 * `shared/spvClosedToNewCapital.ts` for exactly that reason: ONE spelling of the
 * predicate, called by the store sinks AND at the route boundary, so a sixth
 * write path added later cannot pick a different rule by accident.
 *
 * WHAT COUNTS AS CAPITAL ATTACHING. Three kinds, named separately so a refusal
 * can say which one was refused without a caller parsing prose:
 *   · `limited_partner`  — a subscription / LP seat on the vehicle.
 *   · `commitment`       — a commitment amount, new or increased.
 *   · `fee`              — a fee term or a fee obligation on the vehicle.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT COVER.
 *   · An ATTESTED vehicle. `spvUnattestedDraftDecision` returns NOT REFUSED for
 *     every attested vehicle in every status, so R159.6's "do not break attested
 *     vehicles" is a property of the predicate rather than of its callers.
 *   · The attestation TEXT. `ATTESTATION_TEXT_V1` / `ATTESTATION_VERSION` are not
 *     imported, read or re-authored here (wave 176/C1 verified the live wording).
 *   · Reads. Listing, viewing or reporting on an unattested draft is untouched —
 *     the whole point of allowing drafts is that a GP can build one up first.
 *   · Settlement of capital already recorded. Confirming funds received writes no
 *     commitment amount; it is not an attach and is not gated here, mirroring the
 *     carve-out `shared/spvClosedToNewCapital.ts` documents for the close.
 *
 * MONEY. This module performs no arithmetic, no scaling and no formatting, and
 * never calls `Number()`, `parseInt` or `parseFloat`. It compares nothing
 * numeric: the decision is a boolean about a legal record.
 */

/** The machine code. Carried as the thrown `Error.message` so the route error
 *  mapper can key on it — it is NEVER the text a general partner reads. */
export const SPV_UNATTESTED_DRAFT_CODE = "SPV_ATTESTATION_REQUIRED";

/** What was being attached when the refusal fired. */
export type SpvUnattestedAttachKind = "limited_partner" | "commitment" | "fee";

export interface SpvUnattestedDraftDecision {
  refused: boolean;
  kind: SpvUnattestedAttachKind | null;
}

const NOT_REFUSED: SpvUnattestedDraftDecision = { refused: false, kind: null };

/**
 * The whole rule. Pure: reads nothing, writes nothing, throws nothing.
 *
 * `attested` is whether a durable launch sign-off exists for this vehicle. The
 * caller resolves it (the resolver is `server/lib/spvAttestationGate.ts`), so
 * this predicate stays testable without a database and cannot be made to depend
 * on how the lookup happens to be spelled today.
 */
export function spvUnattestedDraftDecision(args: {
  attested: boolean;
  kind: SpvUnattestedAttachKind;
}): SpvUnattestedDraftDecision {
  if (args.attested) return NOT_REFUSED;
  return { refused: true, kind: args.kind };
}

/** The name to print when the vehicle has none recorded. Never a blank quote and
 *  never an internal identifier — a GP reading a refusal should not have to
 *  recognise one. Same value and same reasoning as the closed-vehicle module. */
export const SPV_UNATTESTED_UNNAMED_VEHICLE = "This vehicle";

function vehicleName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed : SPV_UNATTESTED_UNNAMED_VEHICLE;
}

/** The words for each attach kind, so the refusal names what was refused. */
function attachPhrase(kind: SpvUnattestedAttachKind): string {
  if (kind === "limited_partner") return "a limited partner cannot be added to it";
  if (kind === "commitment") return "a commitment cannot be recorded on it";
  return "a fee cannot be attached to it";
}

/**
 * The SHORT form. Sized to survive `client/src/lib/queryClient.ts`'s 240-char
 * `looksHuman` gate, which silently substitutes a generic sentence for anything
 * longer — the same reason `spvClosedToNewCapitalHeadline` exists.
 *
 * R159.6 item 4: a refusal is a STATED FACT. There is no ALL-CAPS underscore
 * code in this sentence, and the missing attestation is named in words.
 */
export function spvUnattestedDraftHeadline(args: {
  spvName: string | null | undefined;
  kind: SpvUnattestedAttachKind;
}): string {
  return (
    `${vehicleName(args.spvName)} is still an unattested draft, so ${attachPhrase(args.kind)}. ` +
    "Nothing was saved. Sign the launch attestation first."
  );
}

/**
 * The UNABRIDGED sentence. States four facts and no code: which vehicle, that
 * its launch attestation has not been signed, that nothing was saved, and what
 * the general partner must do to proceed.
 */
export function spvUnattestedDraftSentence(args: {
  spvName: string | null | undefined;
  kind: SpvUnattestedAttachKind;
}): string {
  return (
    `${vehicleName(args.spvName)} has no signed launch attestation on record, so it is an unattested draft and ` +
    `${attachPhrase(args.kind)}. Nothing was saved: no limited partner, no commitment and no fee is attached to ` +
    "this vehicle. A draft is deliberately allowed to exist so that its terms can be prepared, but it cannot " +
    "hold capital until the general partner signs the launch attestation for it. Sign the attestation, then " +
    "record the limited partner, the commitment or the fee again."
  );
}

/**
 * The PROACTIVE statement, for the surfaces an unattested draft appears on.
 *
 * WHY IT IS SEPARATE FROM THE REFUSAL. The refusal above is past tense: it
 * explains a write that was declined. This one is present tense and is rendered
 * BEFORE the general partner types anything, because the honest place to say
 * "this vehicle cannot take capital yet" is on the vehicle, not in a toast after
 * the attempt.
 *
 * IT IS A STATEMENT, NOT AN ENFORCEMENT (wave 182's lesson, restated): the
 * refusal that matters lives at the store and route layers. This only means a GP
 * is never surprised by it.
 */
export const SPV_UNATTESTED_DRAFT_LABEL = "Unattested draft";

export function spvUnattestedDraftNotice(spvName: string | null | undefined): string {
  return (
    `${vehicleName(spvName)} has no signed launch attestation on record. It is an unattested draft: it can be ` +
    "prepared and edited, but no limited partner, commitment or fee will be accepted on it until the launch " +
    "attestation is signed. Signing the attestation is what turns a draft into a vehicle that can hold capital."
  );
}
