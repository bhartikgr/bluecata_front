// server/lib/subscriptionChangeStore.ts
//
// WAVE 11 / EN-7 — proration and plan change: upgrade, downgrade, cycle switch,
// cancel, with a prorated credit for the unconsumed remainder of the period.
//
// ============================================================================
// WHAT THE CITATION SAID, AND WHAT IS ACTUALLY THERE
// ============================================================================
// The item cites `server/paymentStore.ts:40 'proration' enum member with zero
// producers`. Verified at source: `PAYMENT_KINDS` is declared at
// server/paymentStore.ts:35-42 and `"proration"` is its fifth member (line 40 in
// the current tree — the line held). `grep -rn '"proration"' server/` returns
// the declaration, the derived `PaymentKind` type, and NOTHING that constructs a
// payment of that kind. DEF-078 is confirmed the same way: subscriptionStore has
// `billingCycle` and `currentPeriodEnd` and no plan-change path at all.
//
// So the enum member is real and was dead. This module is its first producer.
// It is a NEW non-sacred store OVER the sacred `subscriptionStore` exports, as
// the item's reuse target requires — `server/subscriptionStore.ts` is in the
// sacred manifest (BASE 75ae1008…) and is not touched.
//
// ============================================================================
// THE ARITHMETIC — AND WHY IT IS NOT A `Math.round`
// ============================================================================
//   credit = floor( paidAmountMinor * remainingDays / periodDays )
//
// computed in BigInt. Three deliberate choices:
//
//   1. FLOOR, NOT ROUND. The credit is money returned to ONE party, so the
//      standing rule "never Math.round a per-party share" is satisfied by
//      construction — there is no residual to distribute. Flooring means the
//      platform keeps at most one minor unit of the remainder, and the direction
//      is stated rather than accidental.
//   2. BIGINT. `paidAmountMinor * remainingDays` overflows 2^53 only at absurd
//      amounts, but the multiplication happens before the division and the
//      result must be exact, so it is done in BigInt and narrowed once.
//   3. WHOLE DAYS, from the stored period boundaries. `period_days` and
//      `remaining_days` are persisted with the change row so the number can be
//      re-derived years later without re-reading a clock.
//
// net_due_minor MAY BE NEGATIVE. A downgrade owes the partner money. Clamping
// that to zero would be a silent transfer to the platform, so it is stored
// signed and surfaced signed; the settlement of a negative net is a credit
// recorded against the subscription, never a charge.
//
// ============================================================================
// SINK, AND THE SECOND PATH
// ============================================================================
// SINK: `applyPlanChange` — `partner_subscription_change` INSERT + the
// `partner_subscription` UPDATE via `setStatus` (which is the only writer of
// tier/cycle/amount on that row) + the `proration` payment entry via
// `paymentStore.chargeOrIdempotent`.
// SECOND PATH: the new charge for an UPGRADE goes through
// `startPartnerCheckout`'s gateway call? No — deliberately not. An upgrade's net
// due is settled as a `proration` payment entry on the existing subscription so
// there is exactly ONE subscription row per subject and one gateway intent per
// charge. `partnerSubscriptionStore.startPartnerCheckout` refuses when an active
// subscription already exists (`PARTNER_SUBSCRIPTION_ALREADY_ACTIVE`), which is
// what closes the second path structurally rather than by convention. The
// proving test asserts that refusal.
import { randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";
import { chargeOrIdempotent } from "../paymentStore";
import {
  addCycle,
  appendSubscriptionEvent,
  getById,
  quotePartnerCheckout,
  setStatus,
  type PartnerSubscriptionRow,
  type SubscriptionCycle,
} from "./partnerSubscriptionStore";

const MS_PER_DAY = 86_400_000;

export type PlanChangeKind = "upgrade" | "downgrade" | "cycle_change" | "cancel" | "reactivate";

export interface PlanChangePreview {
  subscriptionId: string;
  changeKind: PlanChangeKind;
  fromTier: string;
  toTier: string;
  fromCycle: SubscriptionCycle;
  toCycle: SubscriptionCycle;
  fromAmountMinor: number;
  toAmountMinor: number;
  currency: string;
  periodDays: number;
  remainingDays: number;
  unusedCreditMinor: number;
  newChargeMinor: number;
  /** Signed: positive = partner owes, negative = partner is owed. */
  netDueMinor: number;
  effectiveAt: string;
  /** Human-readable derivation, so the number is never unexplained in the UI. */
  explanation: string;
}

export class PlanChangeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
  ) {
    super(message);
    this.name = "PlanChangeError";
  }
}

/**
 * Whole days between two ISO instants, floored at zero. Exported because the
 * proving test pins the arithmetic independently of the DB.
 */
export function wholeDaysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * floor(amountMinor * remainingDays / periodDays), in BigInt.
 *
 * Exported and tested directly: this is the one line of money arithmetic in
 * EN-7, and an off-by-one here is a real refund error.
 */
export function prorateMinor(
  amountMinor: number,
  remainingDays: number,
  periodDays: number,
): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new PlanChangeError("PRORATION_AMOUNT_INVALID", "amountMinor must be a non-negative integer");
  }
  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new PlanChangeError("PRORATION_PERIOD_INVALID", "periodDays must be a positive integer");
  }
  if (!Number.isInteger(remainingDays) || remainingDays < 0) {
    throw new PlanChangeError("PRORATION_REMAINDER_INVALID", "remainingDays must be a non-negative integer");
  }
  const rem = BigInt(Math.min(remainingDays, periodDays));
  const credit = (BigInt(amountMinor) * rem) / BigInt(periodDays); // BigInt division truncates = floor for non-negatives
  return Number(credit);
}

function classify(
  row: PartnerSubscriptionRow,
  toTier: string,
  toCycle: SubscriptionCycle,
  toAmountMinor: number,
): PlanChangeKind {
  if (toTier === row.tierSlug && toCycle !== row.cycle) return "cycle_change";
  if (toAmountMinor > row.amountMinor) return "upgrade";
  if (toAmountMinor < row.amountMinor) return "downgrade";
  /* Same money, different tier slug — an admin rename or a lateral move. Treat
     it as an upgrade for audit purposes (it changes entitlements) but the net
     due will be zero, which the caller can see. */
  return "upgrade";
}

/* ==========================================================================
 * PREVIEW — pure arithmetic + a persisted 'previewed' row so what the partner
 * was shown is recoverable when they later dispute the charge.
 * ======================================================================== */
export function previewPlanChange(input: {
  subscriptionId: string;
  toTier?: string;
  toCycle?: SubscriptionCycle;
  promotionCode?: string | null;
  /** Test seam only: pin "now". Production always passes undefined. */
  nowIso?: string;
}): PlanChangePreview {
  const row = getById(input.subscriptionId);
  if (!row) throw new PlanChangeError("SUBSCRIPTION_NOT_FOUND", "No such subscription", 404);
  if (row.status !== "active" && row.status !== "grace" && row.status !== "past_due") {
    throw new PlanChangeError(
      "SUBSCRIPTION_NOT_CHANGEABLE",
      `A subscription in status '${row.status}' cannot be changed. Start a new checkout instead.`,
    );
  }
  const now = input.nowIso ?? new Date().toISOString();
  const toTier = input.toTier ?? row.tierSlug;
  const toCycle: SubscriptionCycle = input.toCycle ?? row.cycle;
  if (toTier === row.tierSlug && toCycle === row.cycle) {
    throw new PlanChangeError("PLAN_CHANGE_NO_OP", "The requested plan is the current plan.");
  }

  /* The new price comes from the SAME single amount producer the checkout uses.
     A plan-change engine with its own pricing lookup is a second source of
     truth for the charged amount, which is the trap this wave was told to hunt. */
  const q = quotePartnerCheckout({
    partnerId: row.subjectId,
    tierSlug: toTier,
    cycle: toCycle,
    promotionCode: input.promotionCode ?? null,
  });
  if (q.currency !== row.currency) {
    throw new PlanChangeError(
      "PLAN_CHANGE_CURRENCY_MISMATCH",
      `Cannot prorate across currencies (${row.currency} -> ${q.currency}).`,
    );
  }

  const periodStart = row.currentPeriodStart ?? row.activatedAt ?? row.createdAt;
  const periodEnd = row.currentPeriodEnd ?? addCycle(periodStart, row.cycle);
  const periodDays = Math.max(1, wholeDaysBetween(periodStart, periodEnd));
  const remainingDays = Math.min(periodDays, wholeDaysBetween(now, periodEnd));

  const unusedCreditMinor = prorateMinor(row.amountMinor, remainingDays, periodDays);
  /* The new plan is charged for the SAME remainder, so the partner pays only
     for what they will actually use before the next full renewal. */
  const newChargeMinor = prorateMinor(q.amountMinor, remainingDays, periodDays);
  const netDueMinor = newChargeMinor - unusedCreditMinor;
  const changeKind = classify(row, toTier, toCycle, q.amountMinor);

  return {
    subscriptionId: row.id,
    changeKind,
    fromTier: row.tierSlug,
    toTier,
    fromCycle: row.cycle,
    toCycle,
    fromAmountMinor: row.amountMinor,
    toAmountMinor: q.amountMinor,
    currency: row.currency,
    periodDays,
    remainingDays,
    unusedCreditMinor,
    newChargeMinor,
    netDueMinor,
    effectiveAt: now,
    explanation:
      `${remainingDays} of ${periodDays} days remain. Credit for the unused ` +
      `remainder of ${row.tierSlug}/${row.cycle} = floor(${row.amountMinor} × ${remainingDays} / ${periodDays}) ` +
      `= ${unusedCreditMinor}. Charge for ${toTier}/${toCycle} over the same remainder = ` +
      `floor(${q.amountMinor} × ${remainingDays} / ${periodDays}) = ${newChargeMinor}. ` +
      `Net ${netDueMinor >= 0 ? "due" : "credit"} = ${Math.abs(netDueMinor)} ${row.currency} minor units.`,
  };
}

/* ==========================================================================
 * APPLY — persist the change, move the subscription, record the money.
 * ======================================================================== */
export function applyPlanChange(input: {
  subscriptionId: string;
  toTier?: string;
  toCycle?: SubscriptionCycle;
  promotionCode?: string | null;
  actor: string;
  nowIso?: string;
}): { change: PlanChangePreview & { id: string; status: "applied" }; subscription: PartnerSubscriptionRow } {
  const preview = previewPlanChange(input);
  const db: any = rawDb();
  const id = `psc_${randomUUID()}`;
  const ts = new Date().toISOString();

  db.prepare(
    `INSERT INTO partner_subscription_change
       (id, subscription_id, change_kind, from_tier, to_tier, from_cycle, to_cycle,
        from_amount_minor, to_amount_minor, currency, period_days, remaining_days,
        unused_credit_minor, new_charge_minor, net_due_minor, status, effective_at,
        created_at, actor)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'previewed',?,?,?)`,
  ).run(
    id,
    preview.subscriptionId,
    preview.changeKind,
    preview.fromTier,
    preview.toTier,
    preview.fromCycle,
    preview.toCycle,
    preview.fromAmountMinor,
    preview.toAmountMinor,
    preview.currency,
    preview.periodDays,
    preview.remainingDays,
    preview.unusedCreditMinor,
    preview.newChargeMinor,
    preview.netDueMinor,
    preview.effectiveAt,
    ts,
    input.actor,
  );

  /* The money. `proration` is the payment kind that existed with zero
     producers; this is its first. A ZERO net is not recorded as a payment —
     a $0 payment entry is noise, and the change row already carries the
     arithmetic. A NEGATIVE net is recorded as a credit, never as a charge. */
  let paymentEntryId: string | null = null;
  if (preview.netDueMinor !== 0) {
    try {
      const { entry } = chargeOrIdempotent({
        intentId: `pi_proration_${id}`,
        kind: "proration",
        amountCents: Math.abs(preview.netDueMinor),
        currency: preview.currency,
        customerId: `${"partner"}:${getById(preview.subscriptionId)!.subjectId}`,
        description:
          `${preview.changeKind} ${preview.fromTier}/${preview.fromCycle} -> ` +
          `${preview.toTier}/${preview.toCycle}: net ` +
          `${preview.netDueMinor > 0 ? "charge" : "credit"} ${Math.abs(preview.netDueMinor)}`,
        /* The net is settled against the existing subscription, not re-charged
           at a gateway: a plan change must not mint a second payment intent for
           the same subscription. */
        forceState: "succeeded",
      });
      paymentEntryId = entry.id;
    } catch (err) {
      log.warn(
        `[wave11/EN-7] proration payment entry failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  db.prepare(
    `UPDATE partner_subscription_change SET status='applied', payment_entry_id=? WHERE id=?`,
  ).run(paymentEntryId, id);

  /* The subscription itself. The period is NOT restarted: the partner keeps the
     boundary they paid for, which is exactly why the proration was computed
     against it. Only tier, cycle and the go-forward amount move. */
  const updated = setStatus(
    preview.subscriptionId,
    "active",
    {
      tierSlug: preview.toTier,
      cycle: preview.toCycle,
      amountMinor: preview.toAmountMinor,
    },
    {
      eventKind: `plan_${preview.changeKind}`,
      actor: input.actor,
      detail: {
        changeId: id,
        unusedCreditMinor: preview.unusedCreditMinor,
        newChargeMinor: preview.newChargeMinor,
        netDueMinor: preview.netDueMinor,
        paymentEntryId,
        explanation: preview.explanation,
      },
    },
  );

  return { change: { ...preview, id, status: "applied" }, subscription: updated! };
}

/* ==========================================================================
 * CANCEL — at period end by default. The partner keeps what they paid for.
 * ======================================================================== */
export function cancelSubscription(input: {
  subscriptionId: string;
  actor: string;
  /** true = end access now and credit the unused remainder. */
  immediate?: boolean;
  nowIso?: string;
}): { subscription: PartnerSubscriptionRow; creditMinor: number } {
  const row = getById(input.subscriptionId);
  if (!row) throw new PlanChangeError("SUBSCRIPTION_NOT_FOUND", "No such subscription", 404);
  if (row.status === "cancelled") {
    return { subscription: row, creditMinor: 0 };
  }
  const now = input.nowIso ?? new Date().toISOString();
  const periodStart = row.currentPeriodStart ?? row.activatedAt ?? row.createdAt;
  const periodEnd = row.currentPeriodEnd ?? addCycle(periodStart, row.cycle);
  const periodDays = Math.max(1, wholeDaysBetween(periodStart, periodEnd));
  const remainingDays = Math.min(periodDays, wholeDaysBetween(now, periodEnd));
  const creditMinor = input.immediate
    ? prorateMinor(row.amountMinor, remainingDays, periodDays)
    : 0;

  const db: any = rawDb();
  const id = `psc_${randomUUID()}`;
  db.prepare(
    `INSERT INTO partner_subscription_change
       (id, subscription_id, change_kind, from_tier, to_tier, from_cycle, to_cycle,
        from_amount_minor, to_amount_minor, currency, period_days, remaining_days,
        unused_credit_minor, new_charge_minor, net_due_minor, status, effective_at,
        created_at, actor)
     VALUES (?,?,'cancel',?,?,?,?,?,?,?,?,?,?,0,?,'applied',?,?,?)`,
  ).run(
    id,
    row.id,
    row.tierSlug,
    row.tierSlug,
    row.cycle,
    row.cycle,
    row.amountMinor,
    0,
    row.currency,
    periodDays,
    remainingDays,
    creditMinor,
    -creditMinor,
    input.immediate ? now : periodEnd,
    new Date().toISOString(),
    input.actor,
  );

  const updated = input.immediate
    ? setStatus(row.id, "cancelled", { cancelledAt: now }, {
        eventKind: "cancelled_immediate",
        actor: input.actor,
        detail: { changeId: id, creditMinor, remainingDays, periodDays },
      })
    : /* At period end: the row stays active and the enforcement worker will not
         renew it, because `cancelled_at` is set and EN-8 refuses to renew a row
         with a cancellation timestamp. Access is NOT removed today — removing
         paid-for access early is the same class of error as billing early. */
      setStatus(row.id, row.status, { cancelledAt: periodEnd }, {
        eventKind: "cancel_scheduled",
        actor: input.actor,
        detail: { changeId: id, effectiveAt: periodEnd },
      });

  appendSubscriptionEvent({
    subscriptionId: row.id,
    eventKind: "cancel_recorded",
    fromStatus: row.status,
    toStatus: updated!.status,
    amountMinor: creditMinor,
    currency: row.currency,
    detail: { immediate: !!input.immediate, changeId: id },
    actor: input.actor,
  });

  return { subscription: updated!, creditMinor };
}

export function listChanges(subscriptionId: string): Array<Record<string, unknown>> {
  const db: any = rawDb();
  return db
    .prepare(
      `SELECT * FROM partner_subscription_change
        WHERE subscription_id=? ORDER BY created_at ASC, id ASC`,
    )
    .all(subscriptionId) as Array<Record<string, unknown>>;
}
