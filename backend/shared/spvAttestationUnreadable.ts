/**
 * WAVE 192 · ITEM B · R164.3 — AN UNREADABLE ATTESTATION RECORD IS NOT A YES.
 *
 * ══ WHAT WAS WRONG ══════════════════════════════════════════════════════════
 * `server/lib/spvAttestationGate.ts:spvIsAttested` caught every read failure on
 * `spv_launch_signoffs` and `return true` — ATTESTED. It logged a warning and
 * called it a deliberate, narrow fail-open.
 *
 * It is neither narrow nor safe, because of WHO CALLS IT. `spvIsAttested` has
 * exactly one production caller: `assertSpvAttestedForNewCapital`, which is wave
 * 189's draft-gating enforcement. So an unreadable table reported EVERY VEHICLE
 * ATTESTED and let capital attach to an unattested draft — defeating the gate
 * wave 189 had just built, and reporting success while doing it.
 *
 * **A gate that fails open is worse than no gate, because it reports success.**
 *
 * ══ WHY REFUSING IS ALWAYS THE SAFE ANSWER HERE ═════════════════════════════
 * Every sink that calls the gate is a NEW-CAPITAL sink: a subscription, a
 * commitment, or a fee. There is no read sink, no listing sink and no settlement
 * sink among them. So the two possible outcomes of an unreadable sign-off table
 * are:
 *
 *   · PERMIT: capital is recorded against a vehicle for which the platform cannot
 *     demonstrate that any general partner ever vouched, and nobody learns of it,
 *     because the gate reported success. The money is in the ledger and the
 *     record it should have been checked against is the thing that was unreadable.
 *     Unrecoverable.
 *   · REFUSE: a general partner is told, in words, that new capital cannot be
 *     attached right now because the launch sign-off records could not be read.
 *     Costs a retry. Recoverable in full.
 *
 * The asymmetry is total. The original header's argument — that refusing is "a
 * larger and less recoverable failure" — inverts the actual recoverability.
 *
 * ══ AND IT DOES NOT TRAP LEGITIMATE SETTLEMENT (WAVE 182's RULE) ════════════
 * Wave 182: *block new capacity, never block settling commitments that already
 * exist.* That holds STRUCTURALLY here, not by care. `engineTransitionCommitment`
 * — the settlement path behind `PATCH /api/partner/me/spvs/:id/commitments/:id` —
 * does not call the gate at all, and neither do `chargeFeeObligation` or
 * `waiveFeeObligation`. `shared/spvUnattestedDraft.ts` states the carve-out in
 * its own header. Failing the gate closed therefore cannot trap settlement,
 * because settlement never asks the gate. Proven at route level regardless,
 * because "cannot happen by construction" is exactly the claim wave 182 found to
 * be false about disabled buttons.
 *
 * ══ THE REFUSAL IS A STATED FACT, NOT A CODE ════════════════════════════════
 * R159.6 item 4, applied again: there is no ALL-CAPS underscore code in any
 * sentence in this file. The refusal NAMES what could not be read — the launch
 * sign-off records for the vehicle — in prose a general partner can act on.
 *
 * ══ MODELLED ON `shared/spvUnattestedDraft.ts` ══════════════════════════════
 * Same file shape, same headline/sentence split, same 240-character discipline
 * for the headline (see below), same `vehicleName` fallback. ONE spelling of the
 * copy, called by the gate and by every route responder, so a sixth write path
 * added later cannot pick different words.
 *
 * MONEY. No arithmetic, no scaling, no formatting, no `Number()`, `parseInt` or
 * `parseFloat`. This module compares nothing numeric.
 */

/** The machine code. Carried as the thrown `Error.message` so a route error
 *  mapper can key on it — it is NEVER the text a general partner reads. */
export const SPV_ATTESTATION_UNREADABLE_CODE = "SPV_ATTESTATION_UNREADABLE";

/** The name to print when the vehicle has none recorded. Same value and same
 *  reasoning as `shared/spvUnattestedDraft.ts` and the closed-vehicle module. */
export const SPV_ATTESTATION_UNREADABLE_UNNAMED_VEHICLE = "This vehicle";

function vehicleName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed : SPV_ATTESTATION_UNREADABLE_UNNAMED_VEHICLE;
}

/** What was being attached when the refusal fired — the same three kinds
 *  `shared/spvUnattestedDraft.ts` names, in the same words, so a refusal can say
 *  which one was refused without a caller parsing prose. */
export type SpvAttestationUnreadableAttachKind = "limited_partner" | "commitment" | "fee";

function attachPhrase(kind: SpvAttestationUnreadableAttachKind): string {
  if (kind === "limited_partner") return "a limited partner cannot be added to it";
  if (kind === "commitment") return "a commitment cannot be recorded on it";
  return "a fee cannot be attached to it";
}

/** What could not be read, named in words. Not a table name on a customer
 *  surface: the RECORDS, described as a general partner would recognise them. */
export const SPV_ATTESTATION_UNREADABLE_SUBJECT = "the launch attestation sign-off records";

/**
 * The SHORT form. Sized to survive `client/src/lib/queryClient.ts`'s 240-character
 * `looksHuman` gate, which silently substitutes a generic sentence for anything
 * longer — the same reason `spvUnattestedDraftHeadline` exists. Measured, not
 * assumed: a test asserts it is under 240 characters for every attach kind and
 * for a long vehicle name.
 */
export function spvAttestationUnreadableHeadline(args: {
  spvName: string | null | undefined;
  kind: SpvAttestationUnreadableAttachKind;
}): string {
  return (
    /* MEASURED, NOT ASSUMED. The first draft of this sentence was 244 characters
       for the `limited_partner` kind — four over the gate — and the client would
       have replaced the whole thing with a generic status message, so the named
       subject would never have reached a screen. The test in
       `w192_itemB_fail_closed_attestation_routes.test.ts` §B-0 caught it and
       asserts the bound for every kind INCLUDING a long vehicle name. The WHY
       clause moved to `spvAttestationUnreadableSentence`, which is not gated. */
    `${SPV_ATTESTATION_UNREADABLE_SUBJECT} could not be read, so ${attachPhrase(args.kind)}. ` +
    "Nothing was saved: capital must not attach to a vehicle nobody can be shown to have vouched for."
  );
}

/**
 * The UNABRIDGED sentence. States five facts and no code: what could not be read,
 * which vehicle, that nothing was saved, WHY the platform refused instead of
 * permitting, and what happens next.
 */
export function spvAttestationUnreadableSentence(args: {
  spvName: string | null | undefined;
  kind: SpvAttestationUnreadableAttachKind;
}): string {
  return (
    `${SPV_ATTESTATION_UNREADABLE_SUBJECT} could not be read, so the platform cannot tell whether ` +
    `${vehicleName(args.spvName)} has a signed launch attestation, and ${attachPhrase(args.kind)}. ` +
    "Nothing was saved: no limited partner, no commitment and no fee is attached to this vehicle. " +
    "The platform refuses in this situation rather than assuming the attestation exists, because " +
    "recording capital against a vehicle nobody can be shown to have vouched for cannot be undone, " +
    "whereas this refusal costs only a retry. Commitments already recorded on this vehicle are " +
    "unaffected and can still be settled. Once the sign-off records are readable again, record the " +
    "limited partner, the commitment or the fee again."
  );
}
