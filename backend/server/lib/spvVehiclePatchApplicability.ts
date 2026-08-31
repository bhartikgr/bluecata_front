/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 193 · ITEM B · R165.4 — A ROUTE MAY NOT REPORT SUCCESS FOR A CHANGE IT
 * DROPS.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT. `PATCH /api/partner/me/spv/:spvId` forwards the whole request body
 * to `spvEngineStore.updateSpv`, which assigns exactly NINE fields and silently
 * ignores everything else, and then answers `200 { spv }` with the unchanged
 * vehicle. So a general partner who corrects a vehicle's CURRENCY — the unit of
 * every figure on it — is told the correction succeeded, and it was not applied.
 * The store is right to refuse the write; the route is wrong to call it a
 * success.
 *
 * `currency` is not the only one. Measured against `SpvDTO`, the same 200 is
 * returned for a dropped `carryBasis` (which base the GP's carry is charged on),
 * `jurisdiction`, `spvType`, `targetCompanyId` and `gpUserId`. So this is written
 * as an ACCEPT-LIST over the keys the store actually applies, not as a special
 * case for `currency`: a defect class, closed once.
 *
 * WHY AN ACCEPT-LIST AND NOT A DENY-LIST. R163.1's breach was a wave assuming a
 * five-name list was exhaustive. A deny-list of "keys we know are dropped" has
 * exactly that failure mode — every field added to `SpvDTO` in future is silently
 * droppable again. The accept-list mirrors `updateSpv`'s assignments, so a NEW
 * `SpvDTO` field is refused until someone teaches the store to apply it. It fails
 * CLOSED.
 *
 * WHY THIS BREAKS NO EXISTING CALLER. Every caller of this route was enumerated
 * before the accept-list was chosen: `PartnerSpvEngine.tsx:507` sends
 * `{ distributionScope }`, `PartnerPipeline.tsx:212` sends `{ status }`, `:229`
 * sends `{ distributionScope }`. All three keys are applied. Server-internal
 * callers reach `updateSpv` directly and never pass through this module.
 *
 * NOTE ON THE SISTER DEFECT, REPORTED AND NOT SILENTLY EXPANDED INTO.
 * `server/partnerRoutes.ts:2680` (legacy vehicle PATCH) and `:2880` (fund PATCH)
 * build their own whitelisted patch and therefore drop unrecognised keys with a
 * 200 as well — the same class, one file outside this route's scope. This module
 * is exported so adopting it there is a small, separable change; W193_BUILD.md
 * §Item B lists both instances.
 *
 * NO CURRENCY IS NAMED IN THIS FILE (R156.2). `currency` appears only as a FIELD
 * NAME; no code is written as a literal or defaulted.
 */

/**
 * The keys `spvEngineStore.updateSpv` actually assigns. Mirrors its body
 * one-for-one; if a key is added there, add it here and the refusal stops firing
 * for it.
 */
/* WAVE 198 · ITEM C · R166.2 — the ONE length discipline for refusal headlines,
   reused rather than re-implemented. Wave 195 built `fitToGate`; wave 198 moved it
   to a dependency-free module so `shared/` and client-reachable callers can use the
   same one. */
import { fitToGate, boundedFragment } from "../../shared/refusalHeadlineGate";
export const SPV_PATCH_APPLIED_KEYS: readonly string[] = [
  "status",
  "distributionScope",
  "lpVisibility",
  "name",
  "targetRaiseMinor",
  "minCheckMinor",
  "capMinor",
  "closeDate",
  "terms",
];

/**
 * Field names rendered as the words a general partner would recognise, so the
 * refusal says "its currency" rather than echoing a camel-case key. A key with no
 * entry here is echoed as-is rather than guessed at — an invented label would be
 * a statement about the platform that nobody has made.
 */
const READABLE_FIELD_NAMES: Record<string, string> = {
  currency: "currency",
  carryBasis: "carry basis",
  jurisdiction: "jurisdiction",
  spvType: "vehicle type",
  targetCompanyId: "target company",
  gpUserId: "general partner",
  migratedFrom: "migration source",
  legalForm: "legal form",
};

/** Keys that identify or audit the row rather than describe it. Never settable by
 *  a caller, on this route or any other, so naming them in a refusal would invite
 *  a GP to try to set them. They are refused with the same sentence as any other
 *  unapplied key; this list exists only so the sentence can be honest about why. */
const IDENTITY_KEYS: readonly string[] = [
  "id", "sponsorPartnerId", "createdAt", "createdBy", "updatedAt", "updatedBy",
  "archivedAt", "revisionHash",
];

export const SPV_PATCH_UNAPPLIED_CODE = "SPV_PATCH_FIELD_NOT_APPLIED";

export interface SpvPatchUnappliedError extends Error {
  spvPatchUnapplied: true;
  /** The offending keys, machine-readably, so a caller need not parse prose. */
  unappliedFields: string[];
  refusalHeadline: string;
  refusalGuidance: string;
}

export function isSpvPatchUnappliedError(e: unknown): e is SpvPatchUnappliedError {
  return (
    e instanceof Error &&
    e.message === SPV_PATCH_UNAPPLIED_CODE &&
    (e as SpvPatchUnappliedError).spvPatchUnapplied === true &&
    typeof (e as SpvPatchUnappliedError).refusalHeadline === "string"
  );
}

function readable(key: string): string {
  return READABLE_FIELD_NAMES[key] ?? key;
}

/**
 * Refuses when `body` carries any key `updateSpv` would not apply. Reads nothing,
 * persists nothing, emits nothing.
 *
 * Called BEFORE `updateSpv`, so a refused request changes nothing at all — there
 * is no partial write to explain and no half-applied patch to unwind.
 */
export function assertSpvPatchFullyApplied(body: unknown): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => SPV_PATCH_APPLIED_KEYS.indexOf(k) === -1);
  if (unapplied.length === 0) return;

  const names = unapplied.map(readable);
  const nameList =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const identityOnly = unapplied.every((k) => IDENTITY_KEYS.indexOf(k) !== -1);
  const appliedList = SPV_PATCH_APPLIED_KEYS.map(readable).join(", ");

  const e = new Error(SPV_PATCH_UNAPPLIED_CODE) as SpvPatchUnappliedError;
  e.spvPatchUnapplied = true;
  e.unappliedFields = unapplied;
  /* ── WAVE 198 · ITEM C · R166.2 — THE 240-CHAR DEFECT INSIDE THE FIX FOR IT ────
     Wave 194 found this line live: `nameList` is built from EVERY unapplied key in
     the request body, so the multi-key branch grows without bound. Wave 198
     measured it — a 30-key body produces 531 characters, and a single 300-character
     key produces 361 — both far past the client's 240-char gate, at which point
     wave 193's refusal is discarded and the founder sees "something went wrong"
     about a save that silently did nothing. That is the ORIGINAL defect, restored
     by the fix for it.
     Both sentences are byte-unchanged (R143.1). The interpolated key list is now
     bounded through the shared `fitToGate`, on the DEFAULT machine-identifier
     ladder because these are field keys, not human-chosen names. The full,
     unabridged list is not lost: it travels in `unappliedFields` and is spelled out
     again in `refusalGuidance`, which the client renders separately and does not
     length-gate. */
  e.refusalHeadline = fitToGate((b) =>
    names.length === 1
      ? `This vehicle's ${boundedFragment(nameList, b)} cannot be changed here, so nothing was saved.`
      : `These fields cannot be changed here, so nothing was saved: ${boundedFragment(nameList, b)}.`,
  );
  e.refusalGuidance = identityOnly
    ? `${nameList} identifies this vehicle's record and its audit history, so it is set once when the ` +
      `vehicle is created and is never edited afterwards. Nothing on the vehicle was changed by this ` +
      `request. The fields this screen can change are: ${appliedList}.`
    : `Capavate did not save any part of this request, rather than saving part of it and reporting ` +
      `success for the rest. This edit does not apply ${nameList} — it was previously accepted and then ` +
      `discarded without saying so, which is the defect this refusal replaces. The fields it does ` +
      `apply are: ${appliedList}. If ${nameList} needs to change on a vehicle that already holds ` +
      `capital, that is a decision about the vehicle's own terms rather than an edit, so raise it with ` +
      `Capavate and it will be recorded with its reason.`;
  throw e;
}
