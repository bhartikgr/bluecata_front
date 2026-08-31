/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 198 · ITEM D — FOUR MORE ROUTES THAT REPORT SUCCESS FOR A DROPPED WRITE.
 * ══════════════════════════════════════════════════════════════════════════════
 * The class waves 193 and 194 fixed on the vehicle-patch routes: the handler hands
 * `req.body` to a store, the store keeps the keys it recognises and silently
 * discards the rest, and the route answers 200 with the object it just failed to
 * change. The partner reloads, sees the old value, and concludes the platform
 * loses data — which is exactly what it does, while saying it did not.
 *
 * ── THE FINDING THAT CHANGED THE SHAPE OF THIS FIX ────────────────────────────
 * The brief instructed a per-handler accept-list ladder mirroring each handler's
 * own drops, on wave 194's finding that wave 193's store-shaped list would have
 * accepted three keys these handlers actually drop. Wave 198 enumerated the
 * CALLERS and the store WRITE PATHS before writing the list, and the enumeration
 * overturned that design for three of the four routes.
 *
 * `persistWorkspaceSettings`, `persistNote` and `persistEntry` do NOT write named
 * columns for the fields in question. They `JSON.stringify` THE WHOLE OBJECT into
 * `settings_json` / `note_json` / `payload_json`. An unknown key handed to those
 * stores is therefore DURABLY STORED AND ROUND-TRIPS on read. It is not dropped.
 *
 * That is not a technicality — it is the difference between a fix and an outage.
 * `client/src/pages/partner/PartnerSettings.tsx` sends a 13-key settings object of
 * which TWELVE are absent from the `PartnerWorkspaceSettings` interface and all
 * twelve persist correctly today. An interface-derived accept-list would have
 * returned 400 with a refusal naming the partner's own display name, legal name,
 * website and payout currency as "not applied" — on every Partner Settings save,
 * for every partner. It would have replaced a silent-drop defect with a total loss
 * of the settings screen, and it would have looked correct in review, because
 * "mirror the handler's own accept-list" is what the brief asked for.
 *
 * SO THE RULE HERE IS NARROWER AND EVIDENCE-LED: refuse a key ONLY where this wave
 * traced the store code and found that key PROVABLY overwritten or ignored. For
 * D-1 that is a genuine accept-list, because `persistContact` writes named columns
 * and `extractMetadata` reads a fixed key set — anything else is truly gone. For
 * D-2/D-3/D-4 it is the identity and revision keys the store forces in its own
 * spread tail, where a caller's value is provably discarded. A key this wave could
 * not PROVE is dropped is left alone rather than refused on suspicion, because
 * Item A's lesson applies to writes as much as to cap tables: a false refusal
 * blocks correct work, and is the more dangerous direction of the guard.
 */

import { fitToGate, boundedFragment } from "../../shared/refusalHeadlineGate";

export const PARTNER_PATCH_UNAPPLIED_CODE = "PARTNER_PATCH_FIELD_NOT_APPLIED";

export interface PartnerPatchUnappliedError extends Error {
  partnerPatchUnapplied: true;
  /** The keys from the request body that this handler provably would not apply. */
  unappliedFields: string[];
  refusalHeadline: string;
  refusalGuidance: string;
}

export function isPartnerPatchUnappliedError(e: unknown): e is PartnerPatchUnappliedError {
  return (
    e instanceof Error &&
    e.message === PARTNER_PATCH_UNAPPLIED_CODE &&
    (e as PartnerPatchUnappliedError).partnerPatchUnapplied === true &&
    typeof (e as PartnerPatchUnappliedError).refusalHeadline === "string"
  );
}

/* ── D-1 · PATCH /api/admin/partners/:id ────────────────────────────────────────
   The one genuine accept-list of the four. `updateContact` -> `persistContact`
   writes NAMED COLUMNS, and the metadata blob is assembled by `extractMetadata`
   from a FIXED key set, so a key in neither list is written nowhere and is gone
   on the next read. Derived by reading `persistContact` and `extractMetadata` in
   `server/adminContactsStore.ts`, not from an interface. */
export const ADMIN_PARTNER_PATCH_APPLIED_KEYS: readonly string[] = [
  /* named columns */
  "kind", "legalName", "displayName", "email", "phone", "region", "status", "verification",
  /* metadata blob, per `extractMetadata`'s fixed key set */
  "type", "hqCity", "hqCountry", "aumMinor", "aumCurrency",
  "checkSizeMinMinor", "checkSizeMaxMinor", "industries", "stages", "companyIds",
  "partnerWeight", "partnerSince", "website", "linkedinUrl", "tags", "notes",
  "tier", "tierSince", "foundingMember", "partnerType", "regionCode",
  "preferredPayoutCurrency", "configJson", "isSeed",
];

/* ── IDENTITY AND REVISION KEYS, PER STORE ─────────────────────────────────────
   Each list is the spread TAIL of that store's own update — the keys it writes
   AFTER `...patch`, so a caller's value for them is provably overwritten within
   the same statement. Quoted per store rather than shared, because the tails
   genuinely differ: D-3's does not force `updatedBy` and D-4's does not force
   `id`, and inventing a union would refuse keys those stores actually honour. */
export const ADMIN_PARTNER_IDENTITY_KEYS: readonly string[] = [
  "id", "createdAt", "createdBy", "updatedAt", "updatedBy",
  "version", "prevRevisionHash", "revisionHash",
];
export const PARTNER_PIPELINE_FORCED_KEYS: readonly string[] = [
  "id", "partnerId", "version", "prevRevisionHash", "revisionHash", "updatedAt", "updatedBy",
];
/* WAVE 200 ITEM B — R173.9.1. `authorUserId` and `createdAt` joined this list
   because the note store now forces both back to their originals: an edit
   APPENDS an entry instead of rewriting who wrote the note or when. Without
   this, such a patch would be accepted and then quietly discarded — the exact
   defect wave 198 built this refusal to end. `body` is deliberately NOT listed:
   it is how a caller appends new text, and it remains accepted. `title` stays
   editable. */
export const PARTNER_NOTE_FORCED_KEYS: readonly string[] = [
  "id", "partnerId", "version", "prevRevisionHash", "revisionHash", "updatedAt",
  "authorUserId", "createdAt",
];
export const PARTNER_WORKSPACE_SETTINGS_FORCED_KEYS: readonly string[] = [
  "partnerId", "version", "prevRevisionHash", "revisionHash", "updatedAt", "updatedBy",
];

const READABLE: Record<string, string> = {
  id: "record id",
  partnerId: "partner id",
  createdAt: "created date",
  createdBy: "created-by",
  updatedAt: "last-updated date",
  updatedBy: "last-updated-by",
  version: "revision number",
  prevRevisionHash: "previous revision fingerprint",
  revisionHash: "revision fingerprint",
  legalName: "legal name",
  displayName: "display name",
  /* WAVE 200 ITEM B — a refusal naming this field is read by a partner, not by a
     developer, so it is named in words like every sibling above. */
  authorUserId: "author",
};

function readable(key: string): string {
  return READABLE[key] ?? key;
}

function nameList(keys: readonly string[]): string {
  const names = keys.map(readable);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function raise(
  unapplied: string[],
  subject: string,
  guidance: string,
): never {
  const list = nameList(unapplied);
  const e = new Error(PARTNER_PATCH_UNAPPLIED_CODE) as PartnerPatchUnappliedError;
  e.partnerPatchUnapplied = true;
  e.unappliedFields = unapplied;
  /* Item C's discipline applies here too, and this is precisely the shape that
     caused it: `list` grows with the request body, so a 30-key body would push the
     headline past the client's 240-char gate and this refusal would be swallowed —
     reproducing, in the fix for silent drops, the silent drop it replaces. The
     unabridged list stays available in `unappliedFields` and in the guidance. */
  e.refusalHeadline = fitToGate((b) =>
    unapplied.length === 1
      ? `${subject} ${boundedFragment(list, b)} cannot be changed here, so nothing was saved.`
      : `These fields cannot be changed here, so nothing was saved: ${boundedFragment(list, b)}.`,
  );
  e.refusalGuidance = guidance.replace("{list}", list);
  throw e;
}

/**
 * D-1 — refuses any key `persistContact`/`extractMetadata` would not write.
 * Call BEFORE `updateContact`, and OUTSIDE the handler's try/catch, so the
 * pre-existing `PARTNER_NOT_FOUND` 404 for a missing partner is untouched.
 */
export function assertAdminPartnerPatchFullyApplied(body: unknown): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => ADMIN_PARTNER_PATCH_APPLIED_KEYS.indexOf(k) === -1);
  if (unapplied.length === 0) return;
  const identityOnly = unapplied.every((k) => ADMIN_PARTNER_IDENTITY_KEYS.indexOf(k) !== -1);
  const applied = ADMIN_PARTNER_PATCH_APPLIED_KEYS.map(readable).join(", ");
  raise(
    unapplied,
    "This partner's",
    identityOnly
      ? `{list} identifies this partner's record and its audit history, so it is set when the record ` +
        `is created or by the platform itself and is never edited through this screen. Nothing on the ` +
        `partner was changed by this request. The fields this screen can change are: ${applied}.`
      : `Capavate saved no part of this request, rather than saving part of it and reporting success ` +
        `for the rest. This screen writes named columns and a fixed set of profile fields; {list} is ` +
        `in neither, so it was previously accepted and then discarded without saying so, which is the ` +
        `defect this refusal replaces. The fields it does apply are: ${applied}. If {list} needs to ` +
        `change on this partner, raise it with Capavate and it will be recorded with its reason.`,
  );
}

const FORCED_GUIDANCE =
  `{list} identifies this record and its audit history. The platform sets it itself on every save, so ` +
  `a value sent for it is overwritten in the same operation that writes it — it was previously ` +
  `accepted and then discarded without saying so, which is the defect this refusal replaces. Nothing ` +
  `was saved by this request, rather than part of it being saved and success reported for the rest. ` +
  `Send the request again without {list} and the rest of your change will save.`;

/** D-2 — `PATCH /api/partner/me/pipeline/:id`. */
export function assertPartnerPipelinePatchFullyApplied(body: unknown): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => PARTNER_PIPELINE_FORCED_KEYS.indexOf(k) !== -1);
  if (unapplied.length === 0) return;
  raise(unapplied, "This deal's", FORCED_GUIDANCE);
}

/** D-3 — `PATCH /api/partner/me/notes/:id`. */
export function assertPartnerNotePatchFullyApplied(body: unknown): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => PARTNER_NOTE_FORCED_KEYS.indexOf(k) !== -1);
  if (unapplied.length === 0) return;
  raise(unapplied, "This note's", FORCED_GUIDANCE);
}

/** D-4 — `PATCH /api/partner/me/workspace-settings`. */
export function assertPartnerWorkspaceSettingsPatchFullyApplied(body: unknown): void {
  const keys = Object.keys((body ?? {}) as Record<string, unknown>);
  const unapplied = keys.filter((k) => PARTNER_WORKSPACE_SETTINGS_FORCED_KEYS.indexOf(k) !== -1);
  if (unapplied.length === 0) return;
  raise(unapplied, "This workspace's", FORCED_GUIDANCE);
}
