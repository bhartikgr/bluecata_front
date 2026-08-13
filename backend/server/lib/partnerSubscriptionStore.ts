// server/lib/partnerSubscriptionStore.ts
//
// WAVE 11 / EN-6 — partner subscription checkout, through the EXISTING founder
// charge path's machinery, with a real POST.
//
// ============================================================================
// WHAT WAS ACTUALLY BROKEN (verified at source, not from the citation)
// ============================================================================
// DEF-058 / PRM-008 / PRM-013 say the partner checkout "dead-ends". Reading the
// code confirms it and shows WHY it could not be fixed by pointing the client at
// the founder route:
//
//   • server/lib/partnerSelfServiceRoutes.ts:459  POST /api/partner/me/subscribe
//     resolves a price and returns `checkoutPath: "/api/billing/plan"`. It never
//     charges anything. Its own comment says so.
//   • client/src/pages/partner/PartnerBilling.tsx:348  renders
//     `<a href={quote.checkoutPath}>` — a GET navigation to a POST-only route.
//   • server/routes.ts:4592  POST /api/billing/plan requires `{tierId,
//     companyId}` and then, at :4599-4604, checks
//     `ctx.founder?.companies.some(c => c.id === companyId)` and returns 403
//     `not_owner` otherwise. A managing partner has no founder company, so even
//     a correct POST from the partner UI is a guaranteed 403.
//
// So "make the anchor a POST" alone would have moved the dead end one hop and
// called it done. EN-6 needs a partner-scoped checkout that reuses the same
// gateway adapter, the same sacred subscription writer and the same stub-mode
// behaviour, without weakening the founder route's tenant isolation.
//
// ============================================================================
// THE SINK, AND THE SECOND PATH
// ============================================================================
// SINK: `startPartnerCheckout` below — `createPaymentIntent` (the real charge)
// at the marked line, then `recordPendingSubscription` (the sacred money row,
// server/subscriptionStore.ts:199, UNMODIFIED) and the `partner_subscription`
// INSERT, joined on the same `payment_intent_id`.
//
// SECOND PATH TO THE SAME AMOUNT: there were two candidates and both are now
// closed by construction rather than by comment.
//   1. `POST /api/partner/me/subscribe` computed the amount inline. It now calls
//      `quotePartnerCheckout()` from this module — the SAME function the charge
//      path calls. One producer, so a quote can no longer disagree with the
//      charge. (Before: the quote route and any new charge route would each
//      have called `quotePartnerSubscription` with their own arguments.)
//   2. `POST /api/billing/plan` still exists and is still the founder path. It
//      is untouched, and its `not_owner` check means it cannot become a partner
//      charge path by accident. `partnerCheckoutIsExclusiveProducer()` is
//      asserted by the proving test.
//
// MONEY: integer minor units end to end. No `Math.round` anywhere in this file;
// the only division is the proration in subscriptionChangeStore.ts, done in
// BigInt. Percentages do not appear here at all.
import { randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";
import { isSqlite } from "../db/portable";
import { log } from "./logger";
import { applyWave11SubscriptionSchema } from "./applyWave11SubscriptionSchema";
import { applyWave38EventLedgerSchema } from "./applyWave38EventLedgerSchema";
import {
  quotePartnerSubscription,
  supersedeGrandfatheredForInsert,
} from "./partnerBillingStore";
import { resolvePartnerEffectivePlan, EffectivePlanError } from "./partnerEffectivePlan";

/* ==========================================================================
 * 0. Schema readiness (A-22 — the sacred bootstrap does not run 0167).
 * ======================================================================== */

let _w11SchemaEnsured = false;
function db(): any {
  if (!_w11SchemaEnsured) {
    _w11SchemaEnsured = true;
    try {
      if (isSqlite()) {
        applyWave11SubscriptionSchema(rawDb());
        // WAVE 38 ROW 4 — 0183 re-types `partner_subscription_event.amount_minor`
        // to STRICT INTEGER and adds the ledger primitives. The bootstrap path
        // never runs 0183, so the heal must.
        applyWave38EventLedgerSchema(rawDb());
      }
    } catch {
      /* fail-soft: the migration runner is the primary path */
    }
  }
  return rawDb();
}

/** Test hook — lets a suite re-run the heal against a fresh :memory: db. */
export function _resetWave11SchemaGuardForTests(): void {
  _w11SchemaEnsured = false;
}

/** Anti-vacuity probe: a suite must be able to prove the table is really here. */
export function partnerSubscriptionSchemaInstalled(): boolean {
  try {
    return !!db()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partner_subscription'`)
      .get();
  } catch {
    return false;
  }
}

export type SubjectKind = "partner" | "founder" | "collective";
export type SubscriptionCycle = "monthly" | "annual";
export type PartnerSubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "grace"
  | "suspended"
  | "cancelled"
  | "failed";

export interface PartnerSubscriptionRow {
  id: string;
  subjectKind: SubjectKind;
  subjectId: string;
  tierSlug: string;
  cycle: SubscriptionCycle;
  amountMinor: number;
  currency: string;
  listAmountMinor: number | null;
  discountMinor: number;
  discountCode: string | null;
  priceDerivation: string | null;
  paymentIntentId: string | null;
  merchantOrderId: string | null;
  status: PartnerSubscriptionStatus;
  createdAt: string;
  activatedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  createdBy: string | null;
}

export interface PartnerCheckoutQuote {
  tierSlug: string;
  cycle: SubscriptionCycle;
  amountMinor: number;
  currency: string;
  listAmountMinor: number;
  discountMinor: number;
  discountCode: string | null;
  discountRejectedReason: string | null;
  trialExtensionDays: number;
  priceDerivation: string;
  computedVia: "partner_override" | "consortium_pricing_advertised";
  /**
   * WAVE 14 / CP-PROMO-19 — does the applied promotion SUPERSEDE a grandfathered
   * free tier? Surfaced on the quote so the charge path can act on it before it
   * mints a payment intent. See the note on SubscriptionQuote in
   * ./partnerBillingStore for why this could not stay inside the other writer.
   */
  supersedesGrandfathered: boolean;
  /** The promotion id behind the discount, or null. */
  promotionId: string | null;
}

export class PartnerCheckoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
  ) {
    super(message);
    this.name = "PartnerCheckoutError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(r: any): PartnerSubscriptionRow {
  return {
    id: String(r.id),
    subjectKind: r.subject_kind as SubjectKind,
    subjectId: String(r.subject_id),
    tierSlug: String(r.tier_slug),
    cycle: r.cycle as SubscriptionCycle,
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    listAmountMinor: r.list_amount_minor === null ? null : Number(r.list_amount_minor),
    discountMinor: Number(r.discount_minor ?? 0),
    discountCode: r.discount_code ?? null,
    priceDerivation: r.price_derivation ?? null,
    paymentIntentId: r.payment_intent_id ?? null,
    merchantOrderId: r.merchant_order_id ?? null,
    status: r.status as PartnerSubscriptionStatus,
    createdAt: String(r.created_at),
    activatedAt: r.activated_at ?? null,
    currentPeriodStart: r.current_period_start ?? null,
    currentPeriodEnd: r.current_period_end ?? null,
    graceUntil: r.grace_until ?? null,
    suspendedAt: r.suspended_at ?? null,
    cancelledAt: r.cancelled_at ?? null,
    updatedAt: String(r.updated_at),
    createdBy: r.created_by ?? null,
  };
}

/* ==========================================================================
 * 1. THE ONE AMOUNT PRODUCER.
 *
 * Both the quote route and the charge route call this. That is the whole point:
 * a quote that is computed by different code from the charge is a quote that
 * will eventually lie. `POST /api/partner/me/subscribe` was rewritten to call
 * it rather than composing the resolver + quoter itself.
 * ======================================================================== */
export function quotePartnerCheckout(input: {
  partnerId: string;
  tierSlug: string;
  cycle: SubscriptionCycle;
  promotionCode?: string | null;
}): PartnerCheckoutQuote {
  let plan;
  try {
    plan = resolvePartnerEffectivePlan(input.partnerId, input.tierSlug as never, {
      cycle: input.cycle,
    });
  } catch (err) {
    if (err instanceof EffectivePlanError) {
      throw new PartnerCheckoutError(
        "PARTNER_SUBSCRIPTION_NOT_AVAILABLE",
        "This partner tier is not available for subscription (not on the advertised pricing surface).",
        409,
      );
    }
    throw err;
  }
  const isOverride = plan.effectivePrice.source === "partner_override";
  const q = quotePartnerSubscription({
    partnerId: input.partnerId,
    tierSlug: String(input.tierSlug),
    cycle: input.cycle,
    monthlyAmountMinor: plan.effectivePrice.amountMinor,
    currency: plan.effectivePrice.currency,
    isPartnerOverride: isOverride,
    overrideAmountMinor: plan.effectivePrice.amountMinor,
    promotionCode: input.promotionCode ?? null,
  });
  return {
    tierSlug: String(input.tierSlug),
    cycle: input.cycle,
    amountMinor: q.amountMinor,
    currency: q.currency,
    listAmountMinor: q.listAmountMinor,
    discountMinor: q.discountMinor,
    discountCode: q.discountCode,
    discountRejectedReason: q.discountRejectedReason,
    trialExtensionDays: q.trialExtensionDays,
    priceDerivation: q.priceDerivation,
    computedVia: isOverride ? "partner_override" : "consortium_pricing_advertised",
    supersedesGrandfathered: q.supersedesGrandfathered,
    promotionId: q.promotionId,
  };
}

/* ==========================================================================
 * 2. Period arithmetic. Calendar-month/year addition, not a 30-day
 *    approximation: a partner who subscribes on the 31st must not be billed
 *    early every other month. Kept here so EN-7 and EN-8 share it.
 * ======================================================================== */
export function addCycle(fromIso: string, cycle: SubscriptionCycle): string {
  const d = new Date(fromIso);
  const day = d.getUTCDate();
  const target = new Date(d.getTime());
  if (cycle === "annual") target.setUTCFullYear(target.getUTCFullYear() + 1);
  else target.setUTCMonth(target.getUTCMonth() + 1);
  /* setUTCMonth on the 31st of a 31-day month rolls into the next month.
     Clamp back to the last day of the intended month instead. */
  if (target.getUTCDate() !== day) target.setUTCDate(0);
  return target.toISOString();
}

/* ==========================================================================
 * 3. Append-only lifecycle audit.
 * ======================================================================== */

/**
 * WAVE 38 ROW 4 — `actor_id` is NOT NULL on the canonical event shape, but the
 * legacy `actor` column is nullable and several shipped callers genuinely have
 * no actor (renewal sweeps, dunning timers). 'system' is the honest name for
 * those, and it is NOT a user id: no user row may be created with that id.
 * A blank or whitespace-only actor is treated as absent rather than stored as
 * an empty string masquerading as an identity.
 */
export function normaliseActorId(actor: string | null | undefined): string {
  const trimmed = (actor ?? "").trim();
  return trimmed === "" ? "system" : trimmed;
}
export function appendSubscriptionEvent(input: {
  subscriptionId: string;
  eventKind: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  detail?: unknown;
  actor?: string | null;
  idempotencyKey?: string | null;
}): string {
  const id = `pse_${randomUUID()}`;
  db()
    .prepare(
      // WAVE 38 ROW 4 — canonical event columns. `actor_id` is NOT NULL and
      // falls back to 'system' when the caller had no actor, which is the
      // truthful record of a machine-originated transition. `seq` is per-parent
      // over `subscription_id`.
      `INSERT INTO partner_subscription_event
         (id, subscription_id, event_kind, from_status, to_status,
          amount_minor, currency, detail_json, actor,
          actor_id, idempotency_key, seq, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,
               (SELECT COALESCE(MAX(seq), 0) + 1 FROM partner_subscription_event
                 WHERE subscription_id = ?),
               ?)`,
    )
    .run(
      id,
      input.subscriptionId,
      input.eventKind,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      // The column is now STRICT INTEGER. A caller that hands us a non-integer
      // is refused by the engine rather than silently coerced — that is the
      // whole point of migration 0183 — so we do not pre-round here.
      input.amountMinor ?? null,
      input.currency ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      input.actor ?? null,
      normaliseActorId(input.actor),
      input.idempotencyKey ?? null,
      input.subscriptionId,
      nowIso(),
    );
  return id;
}

export function listSubscriptionEvents(subscriptionId: string): Array<{
  id: string;
  eventKind: string;
  fromStatus: string | null;
  toStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
  detail: unknown;
  actor: string | null;
  createdAt: string;
}> {
  const rows = db()
    .prepare(
      `SELECT * FROM partner_subscription_event
        WHERE subscription_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(subscriptionId) as any[];
  return rows.map((r) => ({
    id: String(r.id),
    eventKind: String(r.event_kind),
    fromStatus: r.from_status ?? null,
    toStatus: r.to_status ?? null,
    amountMinor: r.amount_minor === null ? null : Number(r.amount_minor),
    currency: r.currency ?? null,
    detail: r.detail_json ? safeParse(r.detail_json) : null,
    actor: r.actor ?? null,
    createdAt: String(r.created_at),
  }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/* ==========================================================================
 * 4. THE CHARGE PATH.
 * ======================================================================== */

export interface StartCheckoutInput {
  subjectKind: SubjectKind;
  subjectId: string;
  tierSlug: string;
  cycle: SubscriptionCycle;
  promotionCode?: string | null;
  /** The authenticated user id — carried into the gateway + the sacred row. */
  actorUserId: string;
  /** Absolute origin, e.g. https://app.capavate.com — used for the return URL. */
  appOrigin: string;
  returnPath?: string;
}

export interface StartCheckoutResult {
  subscription: PartnerSubscriptionRow;
  quote: PartnerCheckoutQuote;
  paymentIntentId: string;
  clientSecret: string | null;
  merchantOrderId: string;
  hostedPaymentPageUrl: string;
  returnUrl: string;
  stubMode: boolean;
  status: string;
}

export async function startPartnerCheckout(
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const quote = quotePartnerCheckout({
    partnerId: input.subjectId,
    tierSlug: input.tierSlug,
    cycle: input.cycle,
    promotionCode: input.promotionCode ?? null,
  });

  /* A zero amount is legitimate ONLY as an explicit admin per-partner override
     (the same rule the quote route already enforces). Anything else that
     resolves to 0 is a misconfiguration and must not silently "succeed". */
  if (quote.amountMinor === 0 && quote.computedVia !== "partner_override") {
    throw new PartnerCheckoutError(
      "PARTNER_SUBSCRIPTION_PRICE_UNRESOLVED",
      "No price is configured for this tier and cycle. An administrator must set it before checkout.",
      409,
    );
  }
  if (!Number.isInteger(quote.amountMinor) || quote.amountMinor < 0) {
    throw new PartnerCheckoutError(
      "PARTNER_SUBSCRIPTION_AMOUNT_INVALID",
      "Resolved amount is not a non-negative integer number of minor units.",
      500,
    );
  }

  /* ── WAVE 14 / CP-PROMO-19 — THE SECOND PATH, AND A LIVE MONEY DEFECT. ──
     `uq_psub_one_live` (migration 0169) is a partial UNIQUE index over
     status IN ('pending','active','past_due','grace','grandfathered'). But
     `getActiveForSubject` below only looks at ('active','grace','past_due'),
     so a partner sitting on a GRANDFATHERED row passed every guard in this
     function, had a payment intent minted, had the sacred pending-subscription
     row written — and only THEN hit a raw SQLITE_CONSTRAINT on the INSERT
     below. The money had moved and no subscription existed.

     Wave 5's supersession logic lived in partnerBillingStore.createSubscription,
     which has NO ROUTE CALLER, so it never ran on this path. Both writers now
     call the same helper.

     Two outcomes, both explicit:
       · the applied promotion supersedes  -> the grandfathered row is moved to
         'superseded' in the SAME transaction as the INSERT (below), so the
         unique index is satisfied and the supersession is auditable;
       · it does not                       -> a 409 the client can render,
         BEFORE any charge, instead of a 500 after one. */
  const grandfathered = getGrandfatheredForSubject(input.subjectKind, input.subjectId);
  if (grandfathered && !quote.supersedesGrandfathered) {
    throw new PartnerCheckoutError(
      "PARTNER_SUBSCRIPTION_GRANDFATHERED",
      "This partner holds a grandfathered plan. Only a promotion marked as superseding a grandfathered tier may replace it; otherwise use the plan-change endpoint.",
      409,
    );
  }

  const existingActive = getActiveForSubject(input.subjectKind, input.subjectId);
  if (existingActive) {
    /* PRM-010 (SUB-04: "not billed until a subscription exists") has a mirror
       obligation: not billed TWICE once one does. A plan change is EN-7's job,
       not a second checkout. */
    throw new PartnerCheckoutError(
      "PARTNER_SUBSCRIPTION_ALREADY_ACTIVE",
      "This subject already has an active subscription. Use the plan-change endpoint to upgrade, downgrade or switch cycle.",
      409,
    );
  }

  const merchantOrderId = `cap_psub_${input.subjectKind}_${input.subjectId}_${input.tierSlug}_${Date.now()}`;
  const idempotencyKey = `idem_psub_${input.actorUserId}_${input.tierSlug}_${input.cycle}_${Date.now()}`;
  const origin = input.appOrigin.replace(/\/$/, "");
  const returnPath = input.returnPath ?? "/collective/partner/billing/return";
  const returnUrlEarly = `${origin}${returnPath}?merchantOrderId=${encodeURIComponent(merchantOrderId)}`;

  const { createPaymentIntent, AirwallexNotConfiguredError } = await import("./airwallexGateway");
  let intent;
  try {
    /* ---- THE SINK: the real charge. ---- */
    intent = await createPaymentIntent({
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      merchantOrderId,
      customerId: input.actorUserId,
      description: `Capavate partner subscription ${input.tierSlug} (${input.cycle})`,
      metadata: {
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        tierSlug: input.tierSlug,
        cycle: input.cycle,
        userId: input.actorUserId,
      },
      idempotencyKey,
      returnUrl: returnUrlEarly,
    });
  } catch (e) {
    if (e instanceof AirwallexNotConfiguredError) {
      throw new PartnerCheckoutError(
        "gateway_not_configured",
        "Airwallex credentials are not set. Contact your administrator.",
        503,
      );
    }
    throw e;
  }

  /* The sacred money row. server/subscriptionStore.ts is in the sacred manifest
     and is NOT modified: it is CALLED. `companyId` is the tenant-ish key that
     column requires; a partner has no founder company, so the subject is
     namespaced (`partner:<id>`) — unambiguous, and it can never collide with a
     real companyId, which is why the namespace is not optional. */
  const subStore = await import("../subscriptionStore");
  const sacredCompanyKey = `${input.subjectKind}:${input.subjectId}`;
  try {
    subStore.recordPendingSubscription({
      companyId: sacredCompanyKey,
      tierId: input.tierSlug,
      userId: input.actorUserId,
      billingCycle: input.cycle,
      paymentIntentId: intent.id,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      merchantOrderId,
    });
  } catch (dbErr) {
    /* Same rule as the founder path (routes.ts:4698): the intent is already
       minted, so if we cannot durably record it we must NOT send the partner to
       hosted checkout. */
    throw new PartnerCheckoutError(
      "pending_subscription_persist_failed",
      `Could not durably record the pending subscription: ${(dbErr as Error).message}`,
      503,
    );
  }

  const id = `psub_${randomUUID()}`;
  const ts = nowIso();
  /* ONE TRANSACTION. The supersession and the insert must be atomic or the
     partial unique index has a window in which the partner has no live row. */
  const w14SupersedeThenInsert = db().transaction(() => {
    if (grandfathered) {
      const supersededId = supersedeGrandfatheredForInsert(db(), input.subjectId, id, ts);
      if (supersededId) {
        appendSubscriptionEvent({
          subscriptionId: supersededId,
          eventKind: "superseded_by_promotion",
          fromStatus: "grandfathered",
          toStatus: "superseded",
          detail: {
            supersededBy: id,
            promotionId: quote.promotionId,
            discountCode: quote.discountCode,
            item: "CP-PROMO-19",
          },
          actor: input.actorUserId,
        });
      }
    }
  db()
    .prepare(
      `INSERT INTO partner_subscription
         (id, subject_kind, subject_id, tier_slug, cycle, amount_minor, currency,
          list_amount_minor, discount_minor, discount_code, price_derivation,
          payment_intent_id, merchant_order_id, status, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
    )
    .run(
      id,
      input.subjectKind,
      input.subjectId,
      input.tierSlug,
      input.cycle,
      quote.amountMinor,
      quote.currency,
      quote.listAmountMinor,
      quote.discountMinor,
      quote.discountCode,
      quote.priceDerivation,
      intent.id,
      merchantOrderId,
      ts,
      ts,
      input.actorUserId,
    );
  });
  w14SupersedeThenInsert();
  appendSubscriptionEvent({
    subscriptionId: id,
    eventKind: "checkout_started",
    toStatus: "pending",
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    detail: {
      merchantOrderId,
      paymentIntentId: intent.id,
      priceDerivation: quote.priceDerivation,
      discountCode: quote.discountCode,
      discountMinor: quote.discountMinor,
    },
    actor: input.actorUserId,
  });

  const returnUrl = `${origin}${returnPath}?paymentIntentId=${encodeURIComponent(intent.id)}&merchantOrderId=${encodeURIComponent(merchantOrderId)}`;

  /* Stub mode has no webhook, so nothing would ever flip the row to active and
     the partner would sit on a pending subscription forever. The founder path
     solves this at routes.ts:4722 by activating immediately; mirrored here so
     the two personas behave the same way in the same environment. */
  const { getAirwallexMode } = await import("./paymentGatewayResolver");
  const stubMode = getAirwallexMode() === "stub";
  if (stubMode) {
    subStore.activateByPaymentIntent(intent.id);
    activateByPaymentIntent(intent.id, input.actorUserId);
    log.info(`[wave11/EN-6] stub mode: auto-activated partner subscription ${intent.id}`);
  }

  const row = getByPaymentIntent(intent.id);
  return {
    subscription: row!,
    quote,
    paymentIntentId: intent.id,
    clientSecret: (intent as { client_secret?: string }).client_secret ?? null,
    merchantOrderId,
    hostedPaymentPageUrl: stubMode
      ? returnUrl
      : ((intent as { next_action?: { url?: string } }).next_action?.url ?? returnUrl),
    returnUrl,
    stubMode,
    status: stubMode ? "SUCCEEDED" : String((intent as { status?: string }).status ?? "PENDING"),
  };
}

/* ==========================================================================
 * 5. Activation + reads.
 * ======================================================================== */

export function activateByPaymentIntent(
  paymentIntentId: string,
  actor: string | null = null,
): PartnerSubscriptionRow | null {
  const row = getByPaymentIntent(paymentIntentId);
  if (!row) return null;
  if (row.status === "active") return row;
  const ts = nowIso();
  const periodEnd = addCycle(ts, row.cycle);
  db()
    .prepare(
      `UPDATE partner_subscription
          SET status='active', activated_at=COALESCE(activated_at, ?),
              current_period_start=?, current_period_end=?,
              grace_until=NULL, suspended_at=NULL, updated_at=?
        WHERE id=?`,
    )
    .run(ts, ts, periodEnd, ts, row.id);
  appendSubscriptionEvent({
    subscriptionId: row.id,
    eventKind: "activated",
    fromStatus: row.status,
    toStatus: "active",
    amountMinor: row.amountMinor,
    currency: row.currency,
    detail: { currentPeriodEnd: periodEnd },
    actor,
  });
  return getById(row.id);
}

export function failByPaymentIntent(
  paymentIntentId: string,
  reason: string,
): PartnerSubscriptionRow | null {
  const row = getByPaymentIntent(paymentIntentId);
  if (!row) return null;
  const ts = nowIso();
  db()
    .prepare(`UPDATE partner_subscription SET status='failed', updated_at=? WHERE id=?`)
    .run(ts, row.id);
  appendSubscriptionEvent({
    subscriptionId: row.id,
    eventKind: "payment_failed",
    fromStatus: row.status,
    toStatus: "failed",
    detail: { reason },
  });
  return getById(row.id);
}

export function getById(id: string): PartnerSubscriptionRow | null {
  const r = db().prepare(`SELECT * FROM partner_subscription WHERE id=?`).get(id);
  return r ? mapRow(r) : null;
}

export function getByPaymentIntent(paymentIntentId: string): PartnerSubscriptionRow | null {
  const r = db()
    .prepare(`SELECT * FROM partner_subscription WHERE payment_intent_id=?`)
    .get(paymentIntentId);
  return r ? mapRow(r) : null;
}

export function listForSubject(
  subjectKind: SubjectKind,
  subjectId: string,
): PartnerSubscriptionRow[] {
  const rows = db()
    .prepare(
      `SELECT * FROM partner_subscription
        WHERE subject_kind=? AND subject_id=?
        ORDER BY created_at DESC, id DESC`,
    )
    .all(subjectKind, subjectId) as any[];
  return rows.map(mapRow);
}

/** 'active' | 'grace' | 'past_due' all mean "currently subscribed". */
export function getActiveForSubject(
  subjectKind: SubjectKind,
  subjectId: string,
): PartnerSubscriptionRow | null {
  const r = db()
    .prepare(
      `SELECT * FROM partner_subscription
        WHERE subject_kind=? AND subject_id=? AND status IN ('active','grace','past_due')
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(subjectKind, subjectId);
  return r ? mapRow(r) : null;
}

/**
 * WAVE 14 / CP-PROMO-19 — the status `getActiveForSubject` deliberately omits.
 *
 * 'grandfathered' is NOT an active paying subscription, so excluding it from
 * `getActiveForSubject` is correct. It IS in the `uq_psub_one_live` index,
 * because it is an entitlement. That asymmetry is exactly what let a checkout
 * proceed to the gateway and then fail on INSERT. This function makes the
 * missing half of the pair explicit and greppable.
 */
export function getGrandfatheredForSubject(
  subjectKind: SubjectKind,
  subjectId: string,
): PartnerSubscriptionRow | null {
  const r = db()
    .prepare(
      `SELECT * FROM partner_subscription
        WHERE subject_kind=? AND subject_id=? AND status='grandfathered'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(subjectKind, subjectId);
  return r ? mapRow(r) : null;
}

export function setStatus(
  id: string,
  to: PartnerSubscriptionStatus,
  patch: {
    graceUntil?: string | null;
    suspendedAt?: string | null;
    cancelledAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    amountMinor?: number;
    tierSlug?: string;
    cycle?: SubscriptionCycle;
  } = {},
  meta: { eventKind: string; actor?: string | null; detail?: unknown } = {
    eventKind: "status_changed",
  },
): PartnerSubscriptionRow | null {
  const row = getById(id);
  if (!row) return null;
  const ts = nowIso();
  /* An EXPLICIT null must CLEAR the column, not be ignored.

     COALESCE(?, col) cannot express "clear this": it treats a deliberate null
     exactly like an omitted field. That is how `reinstate` left a stale
     `grace_until` on a row it had just made active again — a subscription that
     is active but still carries a grace deadline is a row the next enforcement
     sweep can misread. So presence of the KEY decides, and `undefined` means
     "leave alone". */
  const clearGrace = "graceUntil" in patch && patch.graceUntil === null;
  const clearSuspended = "suspendedAt" in patch && patch.suspendedAt === null;
  db()
    .prepare(
      `UPDATE partner_subscription
          SET status=?,
              grace_until=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?, grace_until) END,
              suspended_at=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?, suspended_at) END,
              cancelled_at=COALESCE(?, cancelled_at),
              current_period_start=COALESCE(?, current_period_start),
              current_period_end=COALESCE(?, current_period_end),
              amount_minor=COALESCE(?, amount_minor),
              tier_slug=COALESCE(?, tier_slug),
              cycle=COALESCE(?, cycle),
              updated_at=?
        WHERE id=?`,
    )
    .run(
      to,
      clearGrace ? 1 : 0,
      patch.graceUntil ?? null,
      clearSuspended ? 1 : 0,
      patch.suspendedAt ?? null,
      patch.cancelledAt ?? null,
      patch.currentPeriodStart ?? null,
      patch.currentPeriodEnd ?? null,
      patch.amountMinor ?? null,
      patch.tierSlug ?? null,
      patch.cycle ?? null,
      ts,
      id,
    );
  appendSubscriptionEvent({
    subscriptionId: id,
    eventKind: meta.eventKind,
    fromStatus: row.status,
    toStatus: to,
    amountMinor: patch.amountMinor ?? null,
    currency: row.currency,
    detail: meta.detail,
    actor: meta.actor ?? null,
  });
  return getById(id);
}

/**
 * Evidence helper for the proving test: the ONLY module that mints a partner
 * subscription charge is this one. If a second producer appears, the test that
 * greps for `createPaymentIntent` alongside a partner subject fails.
 */
export const _en6Provenance = {
  sink: "server/lib/partnerSubscriptionStore.ts startPartnerCheckout -> createPaymentIntent",
  sacredWriter: "server/subscriptionStore.ts recordPendingSubscription (unmodified)",
  founderPathUntouched: "server/routes.ts POST /api/billing/plan",
} as const;
