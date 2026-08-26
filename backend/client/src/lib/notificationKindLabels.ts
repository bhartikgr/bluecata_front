/**
 * WAVE 149 · ITEM 4 — A HUMAN LABEL FOR EVERY NOTIFICATION KIND (R77).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `NotificationBell.tsx:167` rendered `{n.kind}` — the persisted machine value —
 * as a JSX text node under every notification, and `pages/NotificationCenter.tsx`
 * rendered the same value inside a `<Badge>`. So a Collective member read
 * `collective.screening_event.rsvp_changed` with their own eyes. **R77** bans
 * internal identifiers in rendered text; **R111 Q14** repeats it ("raw codes must
 * never reach a user's eye"). The value is legitimate in `data-kind`, in the API
 * payload and in a query key — all three are untouched here.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY A MAP AND NOT A FUNCTION OF THE STRING.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Mechanical de-snaking produces text that is *shaped* like English but is still
 * the schema talking: `dsc.company_assigned` → "Dsc.company assigned" tells a
 * member nothing, and `soft_circle.lapsed` → "Soft circle lapsed" hides that it is
 * a *commitment* that lapsed. Every one of the 38 canonical kinds therefore has a
 * written label. `humanizeMachineKey` in `@/lib/partnerDisplay` was considered and
 * deliberately not reused as the primary path: it does not split on `.`, so the
 * namespace segment would survive into rendered text and the R77 breach would only
 * be half closed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE SOURCE OF THE KEYS, AND WHY THIS FILE IS NOT A SECOND SOURCE OF TRUTH.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `server/notificationsStore.ts` is **SACRED** (manifest row 9) and defines
 * `NotificationKind` / `ALL_NOTIFICATION_KINDS` — 38 members, additive-only, order
 * significant because `kind` is persisted. It is READ, never edited: these keys
 * were copied from it, and `notificationKindLabels.test.ts` re-reads that union at
 * test time and fails if this map falls behind. So a future wave that appends a
 * 39th kind is told by a test, not by a member reading a raw key in production.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE FALLBACK IS A GENERIC HUMAN PHRASE, NEVER THE KEY.
 * ═══════════════════════════════════════════════════════════════════════════════
 * An unknown kind can genuinely arrive: rows persisted by an older build, or a
 * newer server than the loaded bundle. `notificationKindLabel()` then returns
 * **"Platform update"** — true (it is one), useful (it says this is platform news,
 * not a message from a person), and it leaks nothing. It does **not** return the
 * key, an empty string, a dash, or "Unknown". Note this is NOT the R111 Q13
 * "Not on record" case: the value is not missing from the record, it is present and
 * simply not something this build has a name for, so wording it as absent would be
 * a lie about the record.
 */

/** Written labels for the 38 kinds in `server/notificationsStore.ts:26-83`.
 *  Sentence case, no trailing punctuation, no internal namespace. */
export const NOTIFICATION_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // Round lifecycle
  "round.invitation_received": "Round invitation",
  "round.invitation_accepted": "Invitation accepted",
  "round.invitation_declined": "Invitation declined",
  "round.soft_circle_received": "Soft commitment received",
  "round.document_ready_to_sign": "Document ready to sign",
  "round.document_signed": "Document signed",
  "round.closed": "Round closed",
  // Data room
  "dataroom.access_granted": "Data room access granted",
  "dataroom.document_uploaded": "New data room document",
  "dataroom.access_revoked": "Data room access ended",
  // Reporting and messaging
  "investor_report.published": "Investor report published",
  "message.received": "New message",
  // Collective membership
  "collective.eligibility_gained": "Collective eligibility",
  "collective.membership_approved": "Membership approved",
  "collective.membership_rejected": "Membership decision",
  "membership.renewal_due": "Membership renewal due",
  "membership.lapsed": "Membership lapsed",
  // Consortium partner
  "partner.referral_received": "Referral received",
  "partner.application_submitted": "Application submitted",
  "partner.application_approved": "Application approved",
  "partner.application_rejected": "Application decision",
  "partner.attribution_granted": "Attribution granted",
  "partner.attribution_revoked": "Attribution withdrawn",
  "partner.promotion_approved": "Deal promotion approved",
  "partner.promotion_rejected": "Deal promotion declined",
  "partner.promotion_changes_requested": "Changes requested on a promotion",
  // Vehicles
  "spv.launched": "Vehicle launched",
  "spv.subscription_countersigned": "Subscription countersigned",
  // Screening committee
  "dsc.company_assigned": "Company assigned for screening",
  "dsc.review_received": "Screening review received",
  "dsc.feedback_summary": "Screening feedback summary",
  // Cap table, compliance, payments
  "cap_table.drift_detected": "Cap table needs attention",
  "cap_table.broadcast": "Cap table update shared",
  "compliance.hold_placed": "Compliance hold placed",
  "kyc.status_changed": "Verification status changed",
  "payment.failure": "Payment could not be completed",
  "soft_circle.lapsed": "Soft commitment lapsed",
  "crm.intro_request": "Introduction requested",
});

/** The generic phrase for a kind this build has no written label for. */
export const NOTIFICATION_KIND_FALLBACK_LABEL = "Platform update";

/**
 * The ONLY thing any rendering site should call. Never render `n.kind` directly.
 * A missing, empty or unrecognised kind resolves to a generic human phrase.
 */
export function notificationKindLabel(kind: string | null | undefined): string {
  const raw = String(kind ?? "").trim();
  if (!raw) return NOTIFICATION_KIND_FALLBACK_LABEL;
  return NOTIFICATION_KIND_LABELS[raw] ?? NOTIFICATION_KIND_FALLBACK_LABEL;
}
