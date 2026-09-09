/**
 * WAVE 93 · ITEM 1 — CLIENT-SIDE GUARD (the second half of Wave 83's pattern).
 *
 * The SOURCE fix is on the server: `/api/activity` and `/api/admin/audit-log`
 * now both emit `actorLabel` / `targetLabel` / `entityLabel` alongside the raw
 * ids, resolved by `server/lib/actorIdentityDescriber.ts`. That is where the
 * class of defect is actually closed.
 *
 * This module exists because Wave 83 proved the server fix alone is not enough:
 * a renderer that still reaches for the raw field will leak again the moment
 * some other writer forgets. So every actor/target rendered in this app passes
 * through here, and if what arrives still looks like a database key, the key is
 * NOT printed — a description of the record is printed instead.
 *
 * R77 — the id is not deleted. Callers keep it in `data-testid` and in CSV
 * export, where a machine-readable value is exactly what is wanted.
 */

/* RESIDUALS · ITEM 4 — the platform's EXISTING identifier-labelling helpers. They
   are reused, not reimplemented: `shared/partyIdentifierShape.ts` pins one prefix
   list against `partyReferenceLabel`, and a second copy here would be a second
   thing to keep in step. */
import { partyReferenceLabel, humanizeMachineKey } from "./partnerDisplay";

/** Shaped like a raw platform user id. */
function looksLikeUserId(s: string): boolean {
  return /^(u|usr)_[A-Za-z0-9_-]*$/.test(s);
}

/** Shaped like any raw key at all — an id, a tenant key, a bare hex digest. */
export function looksLikeRawKey(s: string): boolean {
  const v = (s ?? "").trim();
  if (!v) return false;
  return (
    looksLikeUserId(v) ||
    /^(co|cmp|rnd|inv|ext|prt|spv|sub|tenant|fcrm|ccm)_[A-Za-z0-9_-]{3,}$/.test(v) ||
    /^[0-9a-f]{32,}$/i.test(v) ||
    /^(user|company|founder|partner|investor|subscription|accountant|system|round|tenant):/i.test(v)
  );
}

/** Humanise a machine token into words, derived from the token itself. */
function humaniseToken(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return "";
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Describe a raw actor/entity id when no server label is available.
 * Never returns the key. Mirrors the server describer's vocabulary.
 */
export function describeRawActor(raw: string | null | undefined): string {
  const id = String(raw ?? "").trim();
  if (!id) return "Not recorded";
  /* The `:` exclusion keeps `accountant:books@example.com` out of this branch —
     see server/lib/actorIdentityDescriber.ts. */
  if (/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(id)) return id;

  const colon = id.indexOf(":");
  if (colon > 0) {
    const type = id.slice(0, colon).toLowerCase();
    const rest = id.slice(colon + 1).trim();
    if (type === "system") {
      const detail = humaniseToken(rest);
      return detail ? `Automatic · ${detail}` : "Automatic";
    }
    if (type === "company" || type === "subscription") return "A company (name not on record)";
    if (type === "founder") return "A founder (name not on record)";
    if (type === "partner") return "A partner organisation (name not on record)";
    if (type === "user" || type === "investor") return describeRawActor(rest);
    if (type === "accountant") return "An accountant (name not on record)";
  }

  if (/^u_redeemed_/.test(id)) return "Invited member";
  if (id === "u_public") return "Public applicant";
  if (/^u_(unknown_admin|admin_unknown)$/.test(id)) return "Administrator (not identified)";
  if (/^u_system(_|$)/.test(id)) {
    const detail = humaniseToken(id.replace(/^u_system_?/, ""));
    return detail ? `Automatic · ${detail}` : "Automatic";
  }
  if (/^u_admin(_|$)/.test(id)) return "An administrator (name not on record)";
  if (/^u_founder_/.test(id)) return "A founder (name not on record)";
  if (/^u_rnd_/.test(id)) return "A contact (name not on record)";
  if (looksLikeUserId(id)) return "Member (name not recorded)";
  if (looksLikeRawKey(id)) return "Not identified";
  return id;
}

/**
 * The one function render sites call.
 *
 * `serverLabel` is preferred because the server can BIND the id to a real name
 * from a table; this file can only describe. A server label that is itself a
 * raw key is rejected — that is the guard.
 */
export function safeActorLabel(
  serverLabel: string | null | undefined,
  rawId: string | null | undefined,
): string {
  const label = String(serverLabel ?? "").trim();
  if (label && !looksLikeRawKey(label)) return label;
  return describeRawActor(rawId);
}

/**
 * WAVE 93 · ITEM 1 — the TARGET/entity column, which is a different judgement.
 *
 * An audit ledger's Target is sometimes a PERSON (`user:u_founder_…` — the live
 * leak) and sometimes an OBJECT REFERENCE (a round id, a company id, a document
 * id). Describing an object reference away would delete information an operator
 * needs, and R77 explicitly allows the id to remain as a machine-readable value.
 * So: a person-shaped target is always described; anything else keeps the server
 * label when there is one and otherwise stays exactly as it was.
 */
export function safeTargetLabel(
  serverLabel: string | null | undefined,
  rawTarget: string | null | undefined,
): string {
  const raw = String(rawTarget ?? "").trim();
  const label = String(serverLabel ?? "").trim();
  if (label && !looksLikeRawKey(label)) return label;
  const isPersonShaped =
    /^(user|investor|founder|accountant):/i.test(raw) || /^(u|usr)_/.test(raw);
  if (isPersonShaped) return describeRawActor(raw);
  return raw;
}

/* ══════════════════════════════════════════════════════════════════════════════
   RESIDUALS · ITEM 4 — `dataroom:co_a2e5ca95c358:drf_54fe72c0` IN A FOUNDER FEED.
   ══════════════════════════════════════════════════════════════════════════════
   THE MEASUREMENT, BEFORE ANY CHANGE. Two things were wrong, not one.

   (1) `client/src/pages/founder/Dashboard.tsx` renders the activity feed's target
       as `{a.targetLabel || a.target}` — RAW, at two places (the bento card and
       the main activity list). It never called a formatter at all. This is the
       same shape as the currency card: THE FORMATTER ALREADY EXISTED one file
       away (`founder/Activity.tsx:68 formatTarget`) and this screen was not using
       it.

   (2) But routing the dashboard through the existing formatter would NOT have
       fixed the reported string, and saying otherwise would have been a false
       green. `safeTargetLabel` deliberately returns a non-person target
       UNCHANGED — a considered decision, because on the ADMIN AUDIT LEDGER an
       object reference is information an operator needs. So the founder's
       Activity page leaks this string too, today.

   HENCE A SEPARATE FUNCTION RATHER THAN A CHANGE TO `safeTargetLabel`.
   `safeTargetLabel` is byte-unchanged and `admin/AuditLog.tsx:616` keeps its
   exact current behaviour AND its `data-target-id` raw attribute. This layer is
   for the two FOUNDER-facing surfaces, where the reader is a customer who has
   no use for a storage key.

   WHAT IT DOES, AND ONLY THAT: a colon-joined composite whose LAST segment is
   shaped like a storage key (`drf_54fe72c0`) is rendered as its humanised kind
   plus the platform's existing Wave 115 reference label — `dataroom:co_…:drf_…`
   becomes `Dataroom · Reference DRF-54FE72C0`. The reference stays unique, so
   two different files never collapse into the same words, and support can still
   read it aloud.

   ANYTHING ELSE IS RETURNED EXACTLY AS `safeTargetLabel` RETURNED IT. A real
   server label, a person, a plain human string like "Series A" — untouched.
   NOTHING IS INVENTED: every word out of here is either the server's, or
   derived from characters the id already contained.
   ══════════════════════════════════════════════════════════════════════════════ */

/** A single path segment that is a storage key: a short prefix, then a body. */
const COMPOSITE_KEY_SEGMENT = /^[a-z][a-z0-9]*_[a-z0-9][a-z0-9_-]{5,}$/i;

export function founderTargetLabel(
  serverLabel: string | null | undefined,
  rawTarget: string | null | undefined,
): string {
  const base = safeTargetLabel(serverLabel, rawTarget);
  if (!base.includes(":")) return base;

  const segments = base.split(":").map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length < 2) return base;

  const last = segments[segments.length - 1];
  if (!COMPOSITE_KEY_SEGMENT.test(last)) return base;

  const kind = humanizeMachineKey(segments[0], "").trim();
  const reference = partyReferenceLabel(last).trim();
  if (!reference) return base;
  return kind ? `${kind} · ${reference}` : reference;
}
