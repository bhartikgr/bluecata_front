/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 93 · ITEM 1 — THE CLASS FIX: A USER NEVER SEES A KEY WHERE A NAME BELONGS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, MEASURED (build_log/wave93/W93_ACTOR_CENSUS.md).
 * 45 distinct UNBOUND ACTOR RECORD SHAPES are written into actor/identity
 * positions by non-test server code — 487 write occurrences across 80 files.
 * "Unbound" means exactly one thing: there is no `users` / `auth_users` row the
 * id can ever JOIN to, so no amount of joining will ever produce a name. The
 * five causes, each measured, not assumed:
 *
 *   1. MACHINE ACTORS      22 shapes — `system:stripe_webhook`,
 *                          `system:round_sweeper`, `system:webhook:<gateway>` …
 *                          These are not people at all. No row should exist.
 *   2. SEED ARTEFACTS      12 shapes — `u_maya_chen`, `u_admin`, `u_founder_demo` …
 *   3. TYPED PREFIXES       6 shapes — `partner:<id>`, `company:<id>`,
 *                          `founder:<id>`, `subscription:<id>`,
 *                          `accountant:<email>`, `investor:<id>`. These CAN be
 *                          bound — to a company or partner name — from data.
 *   4. RUNTIME PERSONAS     4 shapes — `u_redeemed_<ts>` (SACRED
 *                          server/lib/userContext.ts:783), `u_founder_<ts>_<rand>`
 *                          (:557), `u_rnd_<hex>`, `u_<hex>`. Minted in memory at
 *                          request time; a `users` row is never written.
 *   5. UNIDENTIFIED ADMIN   1 shape — `u_unknown_admin`, 30 occurrences. This
 *                          one is a GENUINE DATA FAULT: a mutating admin handler
 *                          could not identify its operator and recorded a
 *                          placeholder instead of refusing.
 *
 * WHY THE EXISTING RESOLVERS WERE NOT ENOUGH — and this is the part that made
 * the wave necessary rather than cosmetic. `resolveDisplayName()` already
 * guarantees "never a raw id", and it keeps that promise. But its fallback
 * (`humanizeFallback`) only knows three cases, so it answered **"Pending
 * member"** for a Stripe webhook, for an unidentified administrator, for a
 * company and for a partner organisation. That is not an id leak; it is worse —
 * it is a WRONG HUMAN DESCRIPTION on an audit ledger, and an audit ledger that
 * misattributes an automated payment event to a "Pending member" is misleading
 * in exactly the place misleading is most expensive.
 *
 * WHAT THIS MODULE DOES, in order, and it BINDS BEFORE IT DESCRIBES:
 *   1. BIND FROM DATA. The canonical `users` table, then the durable credential
 *      store, then the runtime user context — via `resolveDisplayName`, whose
 *      `resolved` flag distinguishes a real hit from its own placeholder. For a
 *      typed prefix the underlying entity is resolved from ITS store
 *      (`resolveCompanyName`, `resolvePartnerName`). NO HARDCODED id→name MAP
 *      EXISTS IN THIS FILE, and none may be added: every name returned here came
 *      out of a table.
 *   2. DESCRIBE, NEVER PRINT THE KEY. When nothing can be bound, say WHAT THE
 *      RECORD IS, derived from the id's own structure — Wave 83's precedent,
 *      set by the owner, where the holder id `u_redeemed_…` became
 *      "Redeemed holder" rather than a truncated hash.
 *
 * R77 — the id is NOT deleted. It stays a machine-readable value in payloads,
 * in CSV export and in `data-testid`. `describeActor()` returns it as `.id` for
 * exactly that purpose. What is forbidden is rendering it where a NAME belongs.
 *
 * ⚠ WAVE OWNERSHIP (three other agents are live). `resolveDisplayName` is SHARED
 * with the partner Team screen (W2-G) and investor surfaces, which belong to
 * WAVE 1D and WAVE 90. So this file does NOT modify it and does NOT change its
 * "Pending member" answer. This describer is ADDITIVE and is consumed only by
 * the activity feed and the admin audit surfaces — the surfaces WAVE 93 owns.
 * The consequence is deliberate and recorded as an owner question: the same
 * unbound `u_…` id reads "Pending member" on the partner Team screen and
 * "Member (name not recorded)" on the audit ledger until one wave owns both.
 *
 * SACRED: `server/lib/userContext.ts` is SACRED and is only READ here, through
 * its already-exported `resolveCompanyName`. Nothing in this file writes.
 */
import { resolveDisplayName } from "./displayNameResolver";
import { resolveCompanyName } from "./userContext";
import { resolvePartnerName } from "./partnerDelegatedContext";

/** What kind of record the actor id turned out to be. */
export type ActorKind =
  | "person"            // bound to a real identity from data
  | "company"           // bound to a company name from data
  | "partner"           // a partner organisation
  | "external_email"    // an email-only external party; the email IS the name
  | "machine"           // an automated platform actor — not a person
  | "seed"              // a demo/seed artefact
  | "runtime_persona"   // minted in memory at request time, no users row
  | "unidentified"      // a genuine data fault: the operator was not recorded
  | "unbound"           // shaped like a user id, nothing resolvable behind it
  | "empty";            // no actor recorded at all

export interface DescribedActor {
  /** The raw id, unchanged. Machine-readable value for payloads / data-testid (R77). */
  id: string;
  /** Safe to render where a NAME belongs. Never a raw key. */
  label: string;
  kind: ActorKind;
  /** True only when `label` came out of a table; false when it is a description. */
  bound: boolean;
}

/** Shaped like a raw platform user id (`u_…`, `usr_…`) — never a person's name. */
function looksLikeUserId(s: string): boolean {
  return /^(u|usr)_[A-Za-z0-9_-]*$/.test(s);
}

/** Shaped like any raw key at all — used to reject a "name" that is really an id. */
function looksLikeAnyRawKey(s: string): boolean {
  return (
    looksLikeUserId(s) ||
    /^(co|cmp|rnd|inv|ext|p|prt|spv|sub|tenant)_[A-Za-z0-9_-]{4,}$/.test(s) ||
    /^[0-9a-f]{32,}$/i.test(s)
  );
}

function isEmail(s: string): boolean {
  /* WAVE 93 — the `:` exclusion is load-bearing and was found by this wave's own
     test: without it `accountant:books@example.com` matched as an email and the
     TYPE PREFIX was rendered to the user as part of the "name". */
  return /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(s);
}

/* ============================================================================
 * WAVE 97 · ITEM 2 — A PAYMENT PROVIDER THE PLATFORM DOES NOT USE MUST NEVER BE
 * NAMED ON AN INTEGRITY RECORD.
 *
 * Wave 93 made `humaniseToken` derive its wording FROM THE TOKEN, which is the
 * right design and is preserved verbatim below — an automation added tomorrow
 * still describes itself with no edit here. But derivation is only as truthful
 * as the token, and one token was not truthful: `system:stripe_webhook`, which
 * Wave 93's own census recorded 12 times and rendered as "Automatic · Stripe
 * webhook". Every writer of that token is an AIRWALLEX path (measured this
 * wave: `POST /api/airwallex/webhook/collective`, verified by
 * `verifyAirwallexSig`) or the Stripe adapter the owner has instructed us to
 * remove. So the audit ledger was naming a payment provider this platform does
 * not use — the exact defect class Wave 93 existed to fix, reproduced one layer
 * further out.
 *
 * Owner instruction, 2026-08-21, verbatim: "We do not use Stripe." /
 * "remove stripe. I can add this at a later date. We are using Airwallex today."
 *
 * WHAT THIS DOES AND DOES NOT DO — it is a LABEL correction, not a history
 * rewrite. The stored actor id is never altered: `describeActor().id` still
 * returns `system:stripe_webhook` byte-for-byte, CSV export and `data-testid`
 * still carry the raw token, and no row is updated or deleted anywhere. Only
 * the HUMAN SENTENCE changes, from a false provider name to the honest
 * category, and it is explicitly marked `(legacy token)` so an auditor reading
 * the label knows the stored token differs from it and can go find the raw id.
 * Suppressing the mismatch silently would be the dishonest option.
 *
 * EXTENSION POINT: add a row here if another provider is named in a token but
 * is not actually in use. Do NOT add Airwallex — that one is genuinely true, and
 * `system:airwallex_webhook` must keep rendering "Airwallex webhook".
 * ============================================================================ */
interface UnusedProviderRule {
  /** Provider word as it appears in an actor token. */
  readonly provider: RegExp;
  /** Honest category to say instead. */
  readonly saidInstead: string;
  /** Why this provider is not in use — for the record, read by W97_ACTOR_PROVIDERS.md. */
  readonly reason: string;
}

export const UNUSED_PROVIDER_RULES: ReadonlyArray<UnusedProviderRule> = [
  {
    provider: /\bstripe\b/gi,
    saidInstead: "Payment provider",
    reason:
      'Owner, 2026-08-21: "We do not use Stripe." The platform gateway is Airwallex ' +
      "(PAYMENT_GATEWAY_DEFAULT, defaulting to airwallex). Every writer of a " +
      "`stripe`-named actor token is an Airwallex path or the removed adapter.",
  },
];

/**
 * Replace any named-but-unused payment provider in an already-humanised machine
 * label with the honest category, flagging that the stored token still says
 * otherwise. Returns the input unchanged when no rule matches — which is the
 * case for every one of the other 44 measured actor shapes.
 */
function correctUnusedProviderNames(humanised: string): string {
  if (!humanised) return humanised;
  let out = humanised;
  let corrected = false;
  for (const rule of UNUSED_PROVIDER_RULES) {
    rule.provider.lastIndex = 0;
    if (rule.provider.test(out)) {
      rule.provider.lastIndex = 0;
      out = out.replace(rule.provider, rule.saidInstead);
      corrected = true;
    }
  }
  if (!corrected) return humanised;
  /* Re-sentence-case: "Stripe webhook" -> "Payment provider webhook". */
  const lower = out.toLowerCase();
  const cased = lower.charAt(0).toUpperCase() + lower.slice(1);
  return `${cased} (legacy token)`;
}

/**
 * Humanise a machine token into readable words, DERIVED FROM THE TOKEN, so a
 * new automation added tomorrow describes itself without an edit here.
 *   "airwallex_webhook"               -> "Airwallex webhook"
 *   "subscriptionEnforcementWorker"   -> "Subscription enforcement worker"
 *   "webhook:airwallex"               -> "Webhook airwallex"
 *
 * WAVE 97 · ITEM 2 — one correction pass runs after derivation so a token that
 * names a payment provider the platform does not use is not repeated verbatim
 * onto an audit ledger:
 *   "stripe_webhook"                  -> "Payment provider webhook (legacy token)"
 */
function humaniseToken(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return "";
  const lower = spaced.toLowerCase();
  const humanised = lower.charAt(0).toUpperCase() + lower.slice(1);
  return correctUnusedProviderNames(humanised);
}

/** Try to bind a plain user id to a real identity from data. */
function bindPerson(id: string): { label: string; email: string | null } | null {
  try {
    const r = resolveDisplayName(id);
    // `resolved` is false when resolveDisplayName fell back to its own
    // placeholder — that is NOT a binding and must not be reported as one.
    if (r?.resolved && r.name && !looksLikeAnyRawKey(r.name)) {
      return { label: r.name, email: r.email ?? null };
    }
  } catch { /* fail-open to a description */ }
  return null;
}

function bindCompany(id: string): string | null {
  try {
    const nm = (resolveCompanyName(id) ?? "").toString().trim();
    if (nm && !looksLikeAnyRawKey(nm)) return nm;
  } catch { /* fail-open */ }
  return null;
}

function bindPartner(id: string): string | null {
  try {
    const nm = (resolvePartnerName(id) ?? "").toString().trim();
    if (nm && !looksLikeAnyRawKey(nm)) return nm;
  } catch { /* fail-open */ }
  return null;
}

/**
 * Describe ANY actor id. Never throws, never returns a raw key as the label.
 *
 * The order is load-bearing: bind from data first, describe only on failure.
 */
export function describeActor(actor: string | null | undefined): DescribedActor {
  const id = String(actor ?? "").trim();
  if (!id) return { id: "", label: "Not recorded", kind: "empty", bound: false };

  /* ── 1. An email in an actor position IS a human-readable identity. Prefer a
        bound name if the email belongs to a known user; otherwise the email
        itself is the honest answer for an email-only external party. ── */
  if (isEmail(id)) {
    const p = bindPerson(id);
    if (p) return { id, label: p.label, kind: "person", bound: true };
    return { id, label: id, kind: "external_email", bound: false };
  }

  /* ── 2. Typed prefixes: `<type>:<id>`. These are bindable from data. ── */
  const colon = id.indexOf(":");
  if (colon > 0) {
    const type = id.slice(0, colon).toLowerCase();
    const rest = id.slice(colon + 1).trim();

    if (type === "system") {
      const detail = humaniseToken(rest);
      return {
        id,
        label: detail ? `Automatic · ${detail}` : "Automatic",
        kind: "machine",
        bound: false,
      };
    }
    if (type === "company" || type === "subscription") {
      const nm = bindCompany(rest);
      if (nm) return { id, label: nm, kind: "company", bound: true };
      return { id, label: "A company (name not on record)", kind: "company", bound: false };
    }
    if (type === "founder") {
      // `founder:<companyId>` in the live tree, but a `founder:<userId>` form
      // also exists — try BOTH bindings before describing.
      const nm = bindCompany(rest);
      if (nm) return { id, label: `Founder of ${nm}`, kind: "company", bound: true };
      const p = bindPerson(rest);
      if (p) return { id, label: p.label, kind: "person", bound: true };
      return { id, label: "A founder (name not on record)", kind: "unbound", bound: false };
    }
    if (type === "partner") {
      const nm = bindPartner(rest);
      if (nm) return { id, label: nm, kind: "partner", bound: true };
      return { id, label: "A partner organisation (name not on record)", kind: "partner", bound: false };
    }
    if (type === "investor" || type === "user") {
      const p = bindPerson(rest);
      if (p) return { id, label: p.label, kind: "person", bound: true };
      return describeActor(rest);
    }
    if (type === "accountant") {
      if (isEmail(rest)) {
        const p = bindPerson(rest);
        if (p) return { id, label: p.label, kind: "person", bound: true };
        return { id, label: rest, kind: "external_email", bound: false };
      }
      return { id, label: "An accountant (name not on record)", kind: "unbound", bound: false };
    }
  }

  /* ── 3. A plain id: bind it if a table knows it. ── */
  const bound = bindPerson(id);
  if (bound) return { id, label: bound.label, kind: "person", bound: true };

  /* ── 4. Nothing is bindable. Describe WHAT THE RECORD IS, from its own shape.
        `u_redeemed_…` → "Redeemed holder" is the owner's Wave 83 precedent and
        is preserved verbatim in the cap-table Holder column; on an audit
        ledger the same record is the person who redeemed an invitation, so it
        reads "Invited member" there, matching the label the partner Team
        screen has used since W2-G. ── */
  if (/^u_redeemed_/.test(id)) {
    return { id, label: "Invited member", kind: "runtime_persona", bound: false };
  }
  if (id === "u_public") {
    return { id, label: "Public applicant", kind: "seed", bound: false };
  }
  if (id === "u_unknown_admin" || id === "u_admin_unknown") {
    return { id, label: "Administrator (not identified)", kind: "unidentified", bound: false };
  }
  if (/^u_system(_|$)/.test(id)) {
    const detail = humaniseToken(id.replace(/^u_system_?/, ""));
    return { id, label: detail ? `Automatic · ${detail}` : "Automatic", kind: "machine", bound: false };
  }
  if (/^u_admin(_|$)/.test(id)) {
    return { id, label: "An administrator (name not on record)", kind: "unbound", bound: false };
  }
  if (/^u_founder_/.test(id)) {
    return { id, label: "A founder (name not on record)", kind: "runtime_persona", bound: false };
  }
  if (/^u_rnd_/.test(id)) {
    return { id, label: "A contact (name not on record)", kind: "runtime_persona", bound: false };
  }
  if (looksLikeUserId(id)) {
    return { id, label: "Member (name not recorded)", kind: "unbound", bound: false };
  }

  /* ── 5. Not shaped like a key at all — a legacy seed label such as
        "Maya Chen". Passing it through is correct: it IS a name. But a value
        that merely LOOKS like some other raw key must still never render. ── */
  if (looksLikeAnyRawKey(id)) {
    return { id, label: "Not identified", kind: "unbound", bound: false };
  }
  return { id, label: id, kind: "person", bound: true };
}

/** Convenience: the render-safe label only. Never a raw key. */
export function describeActorLabel(actor: string | null | undefined): string {
  return describeActor(actor).label;
}
