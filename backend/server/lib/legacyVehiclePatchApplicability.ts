/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 194 · ITEM B · R165.4 / R166.2 — THE OTHER TWO ROUTES THAT REPORT SUCCESS
 * FOR A CHANGE THEY DROP, AND A REFUSAL WHOSE LENGTH IS PROVABLE.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, IN THE TWO PLACES WAVE 193 NAMED AND DID NOT FIX.
 * `server/lib/spvVehiclePatchApplicability.ts`'s own header says it:
 *
 *     "`server/partnerRoutes.ts:2680` (legacy vehicle PATCH) and `:2880` (fund
 *      PATCH) build their own whitelisted patch and therefore drop unrecognised
 *      keys with a 200 as well — the same class, one file outside this route's
 *      scope. This module is exported so adopting it there is a small, separable
 *      change."
 *
 * These two routes are a DIFFERENT shape of the same defect, and the difference
 * is what makes this file necessary rather than a one-line import. Wave 193's
 * route forwards the whole body to `updateSpv` and the STORE drops the extras.
 * These two build their own `patch` object key by key, so the drop happens AT THE
 * ROUTE, before the store is ever called, and each accepts a different set of
 * LEGACY-NAMED keys:
 *
 *     PATCH /api/partner/me/spvs/:id   spvName  name status targetRaiseMinor
 *                                      minCheckMinor capMinor closeDate
 *     PATCH /api/partner/me/funds/:id  fundName name status targetSizeMinor
 *                                      closeDate
 *
 * WHY WAVE 193'S NINE-KEY LIST CANNOT SIMPLY BE REUSED, AND WHY REUSING IT WOULD
 * HAVE RE-CREATED THE DEFECT. `SPV_PATCH_APPLIED_KEYS` is the nine keys
 * `spvEngineStore.updateSpv` assigns, which includes `distributionScope`,
 * `lpVisibility` and `terms`. NEITHER of these two routes maps any of those three,
 * and neither maps `targetRaiseMinor` under that name on the fund side. Pointing
 * the nine-key list at these routes would therefore have ACCEPTED
 * `distributionScope`, `lpVisibility` and `terms` with a 200 on routes that
 * discard them — the exact defect, re-introduced by the fix for it. Each accept-
 * list here mirrors its own route's `if (…) patch.… =` ladder one for one.
 *
 * WHY AN ACCEPT-LIST (R163.1). Same reasoning as wave 193, and it is the reason
 * that ruling exists: a deny-list of "keys we know are dropped" is only correct
 * until someone adds a field, and R163.1's breach was a wave assuming a list was
 * exhaustive. An accept-list mirroring the route's own ladder fails CLOSED — a new
 * legacy key is refused until someone teaches the route to map it.
 *
 * THE HEADLINE'S LENGTH IS BOUNDED HERE, AND THAT IS ITEM B.2 (R166.2).
 * `client/src/lib/queryClient.ts:60-65` shows a server message to a user only when
 * `serverMessage.length < 240` — STRICTLY, so 239 is the maximum — and contains a
 * lower-case letter. Anything else is thrown away and replaced by
 * `friendlyMessageForStatus(res.status)`. Wave 192 lost a 244-character headline to
 * that gate and did not notice. A headline built by interpolating a list of field
 * names is only as short as the request happens to be, so `boundedHeadline` below
 * FALLS BACK to a fixed sentence when the interpolated one would not fit, and the
 * full list is never lost: it stays in `refusalGuidance` and in the machine-
 * readable `unappliedFields`. Asserted by test with a deliberately absurd body,
 * not eyeballed.
 *
 * NOTE, REPORTED NOT SILENTLY FIXED: wave 193's `assertSpvPatchFullyApplied` builds
 * its headline the same interpolating way and does NOT bound it, so a body with
 * enough unrecognised keys can still produce a >=240-character headline on
 * `PATCH /api/partner/me/spv/:spvId` and be replaced by the generic message. It is
 * a live instance of R166.2 in a route outside this wave's two sites, so it is
 * named in `W194_BUILD.md` rather than expanded into here.
 *
 * NO CURRENCY CODE APPEARS IN THIS FILE (R156.2), and no ALL-CAPS underscore code
 * is ever put on a screen: the code travels in `error`, the prose in `message`.
 * This module READS a request body. It reads no database, persists nothing and
 * emits nothing, and it is called BEFORE the store, so a refused request leaves
 * the vehicle exactly as it was — there is no partial write to explain.
 */
import {
  SPV_PATCH_UNAPPLIED_CODE,
  isSpvPatchUnappliedError,
  type SpvPatchUnappliedError,
} from "./spvVehiclePatchApplicability";

export { SPV_PATCH_UNAPPLIED_CODE, isSpvPatchUnappliedError };
export type { SpvPatchUnappliedError };

/**
 * The keys `PATCH /api/partner/me/spvs/:id` actually maps into its patch
 * (`server/partnerRoutes.ts:2681-2698`). Mirrors that ladder one-for-one.
 */
export const LEGACY_SPV_PATCH_APPLIED_KEYS: readonly string[] = [
  "spvName",
  "name",
  "status",
  "targetRaiseMinor",
  "minCheckMinor",
  "capMinor",
  "closeDate",
];

/**
 * The keys `PATCH /api/partner/me/funds/:id` actually maps
 * (`server/partnerRoutes.ts:2890-2894`). `targetSizeMinor` is the legacy name and
 * the route translates it to `targetRaiseMinor`; `targetRaiseMinor` is NOT accepted
 * here because this route does not read it, and accepting a key the route ignores
 * is the defect being closed.
 */
export const LEGACY_FUND_PATCH_APPLIED_KEYS: readonly string[] = [
  "fundName",
  "name",
  "status",
  "targetSizeMinor",
  "closeDate",
];

/**
 * Field names as the words a partner would recognise. A key with no entry is
 * echoed verbatim rather than guessed at: an invented label would be a statement
 * about the platform that nobody has made.
 */
const READABLE_FIELD_NAMES: Record<string, string> = {
  spvName: "name",
  fundName: "name",
  targetRaiseMinor: "target raise",
  targetSizeMinor: "target size",
  minCheckMinor: "minimum check",
  capMinor: "cap",
  closeDate: "close date",
  currency: "currency",
  carryBasis: "carry basis",
  jurisdiction: "jurisdiction",
  spvType: "vehicle type",
  targetCompanyId: "target company",
  gpUserId: "general partner",
  distributionScope: "distribution scope",
  lpVisibility: "LP visibility",
  terms: "terms",
  legalForm: "legal form",
};

/** Keys that identify or audit the row rather than describe it. Never settable on
 *  any route. Refused with the same sentence as any other unapplied key; this list
 *  exists only so the sentence can be honest about WHY it will never apply. */
const IDENTITY_KEYS: readonly string[] = [
  "id", "sponsorPartnerId", "createdAt", "createdBy", "updatedAt", "updatedBy",
  "archivedAt", "revisionHash",
];

/** The gate in `client/src/lib/queryClient.ts:60-65` is `length < 240`. */
export const LOOKS_HUMAN_MAX_LENGTH = 240 as const;

function readable(key: string): string {
  return READABLE_FIELD_NAMES[key] ?? key;
}

function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * R166.2, enforced rather than hoped for. Returns the specific headline when it
 * fits inside the client's gate and a fixed, always-short one when it does not.
 * The dropped detail is not lost — the caller puts the full list in the guidance
 * and in `unappliedFields`.
 */
export function boundedHeadline(specific: string, fallback: string): string {
  return specific.length < LOOKS_HUMAN_MAX_LENGTH ? specific : fallback;
}

/**
 * Refuses when `body` carries any key the route would not map. `vehicleWord` is
 * the noun the caller's own screen uses ("SPV", "fund") so the sentence reads as
 * the partner's own language rather than the schema's.
 */
export function assertLegacyVehiclePatchFullyApplied(
  body: unknown,
  appliedKeys: readonly string[],
  vehicleWord: string,
): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => appliedKeys.indexOf(k) === -1);
  if (unapplied.length === 0) return;

  const names = unapplied.map(readable);
  const nameList = joinNames(names);
  const identityOnly = unapplied.every((k) => IDENTITY_KEYS.indexOf(k) !== -1);
  const appliedList = appliedKeys.map(readable).join(", ");

  const e = new Error(SPV_PATCH_UNAPPLIED_CODE) as SpvPatchUnappliedError;
  e.spvPatchUnapplied = true;
  e.unappliedFields = unapplied;
  e.refusalHeadline = boundedHeadline(
    names.length === 1
      ? `This ${vehicleWord}'s ${nameList} cannot be changed here, so nothing was saved.`
      : `These fields cannot be changed here, so nothing was saved: ${nameList}.`,
    `${names.length} of the fields in this request cannot be changed here, so nothing was saved. ` +
      `Each one is listed in this response.`,
  );
  e.refusalGuidance = identityOnly
    ? `${nameList} identifies this ${vehicleWord}'s record and its audit history, so it is set once when ` +
      `the ${vehicleWord} is created and is never edited afterwards. Nothing on the ${vehicleWord} was ` +
      `changed by this request. The fields this screen can change are: ${appliedList}.`
    : `Capavate did not save any part of this request, rather than saving part of it and reporting ` +
      `success for the rest — which is what this route did before, and it is why a correction could be ` +
      `made twice and still not be on record. This edit does not apply ${nameList}. The fields it does ` +
      `apply are: ${appliedList}. If ${nameList} needs to change on a ${vehicleWord} that already holds ` +
      `capital, that is a decision about its own terms rather than an edit, so raise it with Capavate ` +
      `and it will be recorded with its reason.`;
  throw e;
}
