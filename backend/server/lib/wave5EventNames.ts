/**
 * server/lib/wave5EventNames.ts — WAVE 5 / CP-SUB-15, CP-PROMO-23.
 *
 * REUSE THE EXISTING OUTBOUND EVENT VOCABULARY. DO NOT MINT A PARALLEL ONE.
 *
 * CP-SUB-15's promise is emitted subscription events. The temptation is to
 * invent `partner.subscription.created` and friends. That would give the
 * platform TWO vocabularies for the same lifecycle — the one every existing
 * consumer, webhook and notification rule already subscribes to, and a new one
 * nobody listens to. New events that nobody consumes are indistinguishable from
 * no events at all, which is the "wired to nothing" failure this wave is
 * explicitly guarding against.
 *
 * Every name below was harvested from string literals ALREADY EMITTED in this
 * tree (verified by grep over server/, excluding tests and built bundles). The
 * list is a re-use inventory, not a declaration.
 *
 * `assertReusedEventName` is the enforcement point: `emitMoneyEvent` in
 * ./partnerBillingStore refuses to write an event name that is not in this set,
 * so a future edit cannot quietly start a second vocabulary.
 */

/** Subscription lifecycle. Emitted today by the Capavate subscription paths. */
export const SUBSCRIPTION_EVENTS = [
  "subscription.activated",
  "subscription.updated",
  "subscription.failed",
  "subscription.resumed",
] as const;

/** Invoice lifecycle. Emitted today by the founder invoice paths. */
export const INVOICE_EVENTS = [
  "invoice.issued",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.refunded",
  "invoice.voided",
] as const;

/** Promotion moderation. Emitted today by the partner deal-promotion paths. */
export const PROMOTION_EVENTS = [
  "partner.promotion.approved",
  "partner.promotion.rejected",
  "partner.promotion_changes_requested",
] as const;

/** Partner-state events reused for tier/commission changes. */
export const PARTNER_STATE_EVENTS = [
  "partner.tier_changed",
  "partner.updated",
] as const;

export const REUSED_EVENT_NAMES: ReadonlySet<string> = new Set<string>([
  ...SUBSCRIPTION_EVENTS,
  ...INVOICE_EVENTS,
  ...PROMOTION_EVENTS,
  ...PARTNER_STATE_EVENTS,
]);

export const EVENT_NAME_NOT_REUSED = "EVENT_NAME_NOT_REUSED";

/**
 * @throws `EVENT_NAME_NOT_REUSED:<name>` when the name is not part of the
 *   existing vocabulary. Fail closed: minting a new name is a decision, not an
 *   implementation detail, and it must be made deliberately by adding the name
 *   here with evidence that a consumer exists.
 */
export function assertReusedEventName(name: string): string {
  if (!REUSED_EVENT_NAMES.has(name)) {
    throw new Error(
      `${EVENT_NAME_NOT_REUSED}:${name} — CP-SUB-15 requires reusing the existing ` +
        `outbound event vocabulary. Known names: ${Array.from(REUSED_EVENT_NAMES).sort().join(", ")}`,
    );
  }
  return name;
}
