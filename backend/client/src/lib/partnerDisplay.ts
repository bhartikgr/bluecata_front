/**
 * WAVE 106 · FINDING 4 — human labels for partner-facing machine values.
 *
 * Governing ruling for this file: rendered text must never expose an internal
 * identifier, a machine code, a storage unit, or this project's internals.
 * Machine-readable VALUES (a `data-testid`, an error `code` in a payload, a
 * query key) stay exactly as they are — this is only about what a human reads.
 *
 * Sites this replaces:
 *   · `PartnerDashboard.tsx` printed the raw event code `stage_change` as the
 *     primary text of a Recent-activity row.
 *   · `AttributionProvenancePanel.tsx` printed a raw ISO timestamp
 *     (`2026-07-27T12:46:53.408Z`) and a raw synthetic user id
 *     (`u_redeemed_1783181835779`) as if it were a person.
 *   · `PartnerClients.tsx` headed a column "Company ID" and printed the storage
 *     code for the attribution source.
 *
 * The activity labels mirror `TYPE_LABEL` in
 * `components/partner/PartnerPipelineActivityDialog.tsx:29-34`, which already
 * had the right copy but only for its own dialog. That local copy is left in
 * place deliberately (it is fenced by a WAVE 59 test); consolidating it onto
 * this module is recorded as an open item rather than done blind.
 */

import { PARTNER_PIPELINE_STAGE_LABELS } from "@shared/crmStages";

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  email: "Email",
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  stage_change: "Stage change",
  stage_changed: "Stage change",
  created: "Created",
  updated: "Updated",
};

/** "stage_change" → "Stage change". An unknown code is humanised, never printed raw. */
export function activityTypeLabel(code: string | null | undefined): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "Activity";
  const known = ACTIVITY_TYPE_LABELS[raw];
  if (known) return known;
  const words = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity";
}

const ATTRIBUTION_SOURCE_LABELS: Record<string, string> = {
  admin_manual: "Added by a Capavate administrator",
  referral_code: "Referral code",
  partner_claim: "Claimed by this partner",
  partner_portfolio: "Declared portfolio company",
};

/** The storage code for how a client was attributed → a sentence. */
export function attributionSourceLabel(code: string | null | undefined): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "Not recorded";
  const known = ATTRIBUTION_SOURCE_LABELS[raw];
  if (known) return known;
  const words = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not recorded";
}

/**
 * An ISO timestamp → a local date and time a human reads.
 *
 * A missing or unparseable value is stated as unknown. It is NOT rendered as
 * "Invalid Date", and it is NOT quietly rendered as the epoch: an unrecorded
 * time is not a time.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Time not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time not recorded";
  return d.toLocaleString();
}

/** Date only, same refusal rules as `formatTimestamp`. */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "Date not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date not recorded";
  return d.toLocaleDateString();
}

/**
 * A person, from whatever the row actually holds.
 *
 * Synthetic platform ids (`u_redeemed_1783181835779`, `u_public`, `ac_…`) are
 * NOT people's names and must never be printed as if they were. When only an id
 * is available the caller gets an explicit statement plus the id under a label,
 * because support does need to be able to read it — labelled, never bare.
 */
export function actorDisplay(value: string | null | undefined): {
  text: string;
  /** The raw reference, when the value was an id rather than a name. */
  reference: string | null;
} {
  const raw = String(value ?? "").trim();
  if (!raw) return { text: "Not recorded", reference: null };
  if (/^(u_|ac_|co_|ext_|spv|round_|inv_)/.test(raw)) {
    return { text: "A platform account", reference: raw };
  }
  return { text: raw, reference: null };
}

/**
 * WAVE 115 · FINDING 1, THE SWEEP — a row identified only by an internal id.
 *
 * Twelve partner-facing tables printed a bare `co_…` / `u_…` / `spvlp_…` storage
 * key as a row's identity, in a cell where a customer expects a name. Wave 106
 * fixed the actor columns via `actorDisplay` above; these twelve are the ones it
 * missed, and they are a harder case: `actorDisplay`'s honest "A platform
 * account" is the right answer for ONE actor and the wrong answer for a table,
 * where every row would collapse to the same string and the partner would lose
 * the ability to tell his own holders apart.
 *
 * So the id is presented as what it is: a labelled reference. The prefix — the
 * part that is purely an implementation detail of which table the row lives in —
 * is dropped, and what remains is the stable, unique, REAL discriminator, under
 * the word "Reference" so nobody mistakes it for a person or a company name.
 *
 * NOTHING IS FABRICATED and nothing is lost: the value is derived only from the
 * id the row already carried, it stays unique wherever the id was unique, and
 * support can still read it aloud. Where a real name IS available the caller
 * should render the name instead — this is the floor, not the preference.
 */
export function partyReferenceLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not recorded";
  /* Strip only a KNOWN prefix. An unrecognised value is left intact rather than
     truncated on a guess — losing characters could make two rows collide. */
  const stripped = raw.replace(/^(u_|ac_|co_|ext_|spvlp_|spv_|round_|inv_|mp_)/, "");
  if (!stripped) return `Reference ${raw.toUpperCase()}`;
  return `Reference ${stripped.replace(/_/g, "-").toUpperCase()}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 115 · FINDING 1 — the partner read `soft_circle` on his own dashboard.

   `PartnerDashboard.tsx:170` rendered `{s}` — the raw storage key — for every
   pipeline stage, so the Pipeline card read
   `invited · viewed · soft_circle · signed · funded · committed`.

   THE MAP ALREADY EXISTED. `PARTNER_PIPELINE_STAGE_LABELS`
   (shared/crmStages.ts:130-137) has governed the same six keys on
   PartnerPipeline.tsx since it was written. Nothing new is defined here for
   stages — this is an accessor over the canonical map, so there is exactly one
   partner stage vocabulary and one place to change it.

   THE TWO SOFT-CIRCLE SPELLINGS ARE NOT MERGED. Nine vocabularies in this tree
   spell it `soft_circle`; `CollectiveDecisionState` (shared/crmStages.ts:30-32)
   and `INVESTOR_LADDER` (lib/investor/investorSpine.ts:47-56) spell it
   `soft_circled`. They refer to the same real-world event — `normalizeLadderState`
   (investorSpine.ts:99-105) already accepts both — but they are NOT the same
   ladder: `normalizeLadderState` maps raw "committed" to "soft_circled", whereas
   on the partner pipeline `committed` is the FINAL stage, after `funded`. Merging
   them would require deciding what `committed` means. That needs an owner ruling
   and is reported in build_log/wave115/W115_PREFLIGHT.md, not decided here.

   EVERY accessor below has a humanising fallback, so an unmapped or
   newly-added key degrades to sentence case and can never render raw again.
   ═══════════════════════════════════════════════════════════════════════════ */


/**
 * The shared fallback: a machine key becomes a sentence. Handles snake_case,
 * kebab-case, SCREAMING_CASE and camelCase, because all four appear in payloads
 * this tree renders.
 *
 *   "soft_circle" → "Soft circle"   "wound_down" → "Wound down"
 *   "pastDue"     → "Past due"      "ACTIVE"     → "Active"
 *
 * Exported so tests can pin it rather than re-implement it.
 */
export function humanizeMachineKey(value: string | null | undefined, whenEmpty = "Not recorded"): string {
  const raw = String(value ?? "").trim();
  if (!raw) return whenEmpty;
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return whenEmpty;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A partner pipeline stage key → the label the partner already sees on the
 * Pipeline board. Delegates to the canonical shared map; defines no second
 * vocabulary.
 */
export function partnerPipelineStageLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Unknown stage";
  const known = (PARTNER_PIPELINE_STAGE_LABELS as Record<string, string>)[raw];
  return known ?? humanizeMachineKey(raw, "Unknown stage");
}

/* SPV lifecycle. The keys live in a LOCAL map on PartnerPipeline.tsx:45-57
   rather than in shared/, which is itself an open item; this accessor uses the
   same six labels so PartnerSpvDetail and PartnerPipeline cannot disagree. */
const SPV_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  deployed: "Deployed",
  distributing: "Distributing",
  closed: "Closed",
  wound_down: "Wound-down",
};

/** An SPV lifecycle status → a label. `wound_down` was reaching the screen raw. */
export function spvStatusLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Status not recorded";
  return SPV_STATUS_LABELS[raw] ?? humanizeMachineKey(raw, "Status not recorded");
}

const FUND_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  raising: "Raising",
  open: "Open",
  investing: "Investing",
  harvesting: "Harvesting",
  closed: "Closed",
  wound_down: "Wound-down",
};

/** A fund status → a label. */
export function fundStatusLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Status not recorded";
  return FUND_STATUS_LABELS[raw] ?? humanizeMachineKey(raw, "Status not recorded");
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "In trial",
  past_due: "Payment overdue",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  paused: "Paused",
  incomplete: "Incomplete",
  unpaid: "Unpaid",
  pending: "Pending",
  superseded: "Superseded",
  scheduled: "Scheduled",
  applied: "Applied",
};

/** A billing/subscription status → a label a partner can act on. */
export function subscriptionStatusLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Status not recorded";
  return SUBSCRIPTION_STATUS_LABELS[raw] ?? humanizeMachineKey(raw, "Status not recorded");
}

const BILLING_CADENCE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
  annually: "Annual",
  yearly: "Annual",
  quarterly: "Quarterly",
  one_time: "One-off",
};

/** A billing cadence key → a label. */
export function billingCadenceLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Not recorded";
  return BILLING_CADENCE_LABELS[raw] ?? humanizeMachineKey(raw);
}

/**
 * A plan/tier slug → a readable tier name. `partner_pro` is a storage slug, not
 * a product name; it was reaching the dashboard's plan-error line raw.
 */
export function planTierLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Not recorded";
  return humanizeMachineKey(raw.replace(/^(partner|founder|investor)[_-]/, ""), "Not recorded");
}

/**
 * A quota enforcement mode → what it means for the partner. `report` and `warn`
 * are engineering words for "we are only counting" and "we will warn you".
 */
export function quotaEnforcementLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "";
  if (raw === "report") return "counting only";
  if (raw === "warn") return "warning at the limit";
  if (raw === "block" || raw === "enforce") return "enforced at the limit";
  return humanizeMachineKey(raw, "").toLowerCase();
}

const MANAGED_FOUNDER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  invited: "Invited",
  pending: "Pending",
  paused: "Paused",
  archived: "Archived",
  suspended: "Suspended",
  revoked: "Revoked",
  ended: "Ended",
};

/**
 * A managed-founder engagement status → a label. The badge rendered the raw
 * value, which arrives upper-cased (`ACTIVE`) from the store.
 */
export function managedFounderStatusLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Status not recorded";
  return MANAGED_FOUNDER_STATUS_LABELS[raw.toLowerCase()] ?? humanizeMachineKey(raw, "Status not recorded");
}

const JURISDICTION_LABELS: Record<string, string> = {
  delaware: "Delaware, USA",
  de: "Delaware, USA",
  cayman: "Cayman Islands",
  bvi: "British Virgin Islands",
  luxembourg: "Luxembourg",
  singapore: "Singapore",
  ontario: "Ontario, Canada",
  bc: "British Columbia, Canada",
  uk: "United Kingdom",
  ireland: "Ireland",
  jersey: "Jersey",
  guernsey: "Guernsey",
  wyoming: "Wyoming, USA",
};

/** A jurisdiction key → a place a human recognises. */
export function jurisdictionDisplayLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Not recorded";
  return JURISDICTION_LABELS[raw.toLowerCase()] ?? humanizeMachineKey(raw);
}

const RECONCILE_BREAK_REASON_LABELS: Record<string, string> = {
  nav_mismatch: "Net asset value does not match",
  commitment_mismatch: "Commitment total does not match",
  share_mismatch: "Share count does not match",
  missing_entry: "An expected entry is missing",
  duplicate_entry: "A duplicate entry was found",
  stale_snapshot: "The snapshot is out of date",
  currency_mismatch: "Currencies do not match",
};

/** A reconciliation break reason code → a sentence. */
export function reconcileBreakReasonLabel(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Reason not recorded";
  return RECONCILE_BREAK_REASON_LABELS[raw] ?? humanizeMachineKey(raw, "Reason not recorded");
}

/**
 * WAVE 115 · FINDING 1 (L6) — `PartnerBilling.tsx` printed the raw storage id of
 * the superseding subscription inside the sentence "(replaced by …)". A partner
 * cannot do anything with `sub_01J…`. An internal-looking reference becomes a
 * noun phrase; a human-readable value (a real tier name) is passed through.
 *
 * The surrounding literal copy is UNCHANGED — only the interpolated expression
 * moved — so the silent-drop guard's copy fingerprint for that text node is
 * byte-identical.
 */
export function supersededPlanLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "a later plan";
  if (/^[a-z]{2,6}_/.test(raw) || /^[0-9a-f]{8,}$/i.test(raw)) return "a later plan";
  return planTierLabel(raw);
}
