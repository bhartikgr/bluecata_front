/**
 * Sprint 28 Billing — Payment Gateway Adapter.
 *
 * Thin wrapper over paymentStore.chargeOrIdempotent + invoiceStore.createInvoice.
 * Exposes:
 *   - chargeSubscription(...)  → payment entry + invoice (status: paid)
 *   - chargeRefund(...)        → refund payment + invoice.refunded event
 *   - getPublicConfig()        → gateway info for admin Payment Gateway tab
 *   - webhook handler (POST /api/webhooks/payment-gateway) — idempotent
 *
 * Key design decisions (Stripe-compatible):
 *   - Intent IDs are derived from {subscriptionId}:{periodStart} so the same
 *     billing period can never be charged twice.
 *   - All money is integer minor units + ISO 4217. Floats are BANNED.
 *   - On success the invoice is automatically marked "paid".
 *   - 3DS flow: if gateway returns requires_3ds the caller gets
 *     { ok: false, requires3ds: true, clientSecret } and must redirect.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { chargeOrIdempotent, type PaymentEntry } from "./paymentStore";
import { createInvoice, refundInvoice, markInvoicePaid, getInvoice, type Invoice } from "./invoiceStore";
import { getSubscription, updateSubscription, createSubscriptionForNewCompany } from "./subscriptionsStore";
import { appendAdminAudit } from "./adminPlatformStore";
// Patch v6 — free-plan activation needs a company + user context.
import { getUserContext } from "./lib/userContext";
import { addCompanyForFounder, getCompaniesForFounder, getActiveCompanyId, setActiveCompanyId, type FounderCompanyMembership } from "./multiCompanyStore";
// v19 Wave A / Change 3 — AirWallex is the new default gateway. The resolver
// picks between AirWallex and Stripe per env (PAYMENT_GATEWAY_DEFAULT). We do
// NOT touch the existing chargeSubscription / chargeRefund signatures — those
// remain stable. We do, however, augment getPublicConfig() to return BOTH
// gateways and add per-gateway webhook handlers below.
import {
  getDefaultGatewayId,
  listPublicGatewayConfig,
  isGatewayReady,
} from "./lib/paymentGatewayResolver";
import { verifyWebhookSignature as verifyAirwallexSig } from "./lib/airwallexGateway";
import { verifyWebhookSignature as verifyStripeSig } from "./lib/stripeGateway";
import { log } from "./lib/logger";

/* ---------- Types ---------- */

export interface ChargeSubscriptionInput {
  companyId: string;
  subscriptionId: string;
  pricingModelId: string;
  currency: string;
  region?: string;
  amountMinor: number;
  planLabel: string;
  periodStart: string;
  periodEnd: string;
  paymentMethodToken: string;
  cardLast4?: string;
  couponCode?: string;
}

export interface ChargeSubscriptionResult {
  ok: boolean;
  deduped?: boolean;
  paymentEntry: PaymentEntry;
  invoice: Invoice;
  requires3ds?: boolean;
  clientSecret?: string;
}

export interface ChargeRefundInput {
  paymentEntryId: string;
  invoiceId: string;
  amountMinor: number;
  reason: string;
  actor?: string;
}

export interface GatewayConfig {
  name: string;
  mode: "test" | "live";
  supportedMethods: string[];
  webhookUrl: string;
  version: string;
}

/* ---------- Idempotency ---------- */

// Tracks processed webhook events: (intentId, type) → boolean
const processedWebhookEvents = new Set<string>();

function webhookKey(intentId: string, type: string): string {
  return `${intentId}::${type}`;
}

/* ---------- Core operations ---------- */

/**
 * Charge a subscription billing cycle. Idempotent on (subscriptionId, periodStart).
 */
export function chargeSubscription(input: ChargeSubscriptionInput): ChargeSubscriptionResult {
  // Derive a stable intent ID from the billing period
  const intentId = createHash("sha256")
    .update(`${input.subscriptionId}:${input.periodStart}`)
    .digest("hex")
    .slice(0, 24);

  // Charge via paymentStore (idempotent)
  const { entry, deduped } = chargeOrIdempotent({
    intentId,
    kind: "company_billing",
    amountCents: input.amountMinor,
    currency: input.currency,
    customerId: input.companyId,
    description: `${input.planLabel} — ${input.periodStart} to ${input.periodEnd}`,
    couponCode: input.couponCode,
    forceState: process.env.NODE_ENV === "production" ? "succeeded" : "succeeded",
  });

  // Check for 3DS
  if (entry.state === "requires_3ds") {
    return {
      ok: false,
      requires3ds: true,
      clientSecret: `3ds_${randomBytes(8).toString("hex")}`,
      paymentEntry: entry,
      invoice: {} as Invoice, // not yet created — pending 3DS completion
    };
  }

  // Create or retrieve invoice
  // If deduped, find the existing invoice for this payment
  let invoice: Invoice;
  if (deduped && entry.invoiceId) {
    const existing = getInvoice(entry.invoiceId);
    if (existing) {
      return { ok: true, deduped: true, paymentEntry: entry, invoice: existing };
    }
  }

  invoice = createInvoice({
    companyId: input.companyId,
    subscriptionId: input.subscriptionId,
    planLabel: input.planLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    amountMinor: entry.amountCents, // net after any coupon
    currency: input.currency,
    taxMinor: 0,
    paymentEntryId: entry.id,
    cardLast4: input.cardLast4,
    actor: "gateway:subscription_charge",
  });

  // Bump invoiceCount on subscription
  const sub = getSubscription(input.companyId);
  if (sub) {
    updateSubscription(
      input.companyId,
      { invoicesCount: sub.invoicesCount + 1, status: "active" },
      "system:payment_gateway",
    );
  }

  return { ok: true, deduped: false, paymentEntry: entry, invoice };
}

/**
 * Refund a payment. Creates a negative-amount invoice linked to the original.
 */
export function chargeRefund(input: ChargeRefundInput): { ok: boolean; refundEntry: PaymentEntry; refundInvoice: Invoice } {
  const actor = input.actor ?? "system:refund";

  // Issue a refund payment entry
  const intentId = `refund_${input.paymentEntryId}_${createHash("sha256").update(input.reason).digest("hex").slice(0, 8)}`;
  const { entry: refundEntry } = chargeOrIdempotent({
    intentId,
    kind: "refund",
    amountCents: -Math.abs(input.amountMinor),
    currency: "USD", // will be overridden by invoice currency
    customerId: "system",
    description: `Refund: ${input.reason}`,
    forceState: "succeeded",
  });

  // Create negative invoice
  const refInv = refundInvoice(input.invoiceId, input.amountMinor, input.reason, actor);

  return { ok: true, refundEntry, refundInvoice: refInv };
}

/**
 * Public gateway configuration returned to the admin Payment Gateway tab.
 *
 * v19 Wave A / Change 3: now reports the v19 default gateway (AirWallex)
 * alongside Stripe. The legacy single-gateway shape is preserved for
 * back-compat — callers that want the per-gateway list should hit
 * `getPublicGatewayList()`.
 */
export function getPublicConfig(): GatewayConfig & { defaultGateway?: string; defaultWebhookUrl?: string } {
  const def = getDefaultGatewayId();
  return {
    name: def === "airwallex" ? "AirWallex" : "Stripe",
    mode: process.env.NODE_ENV === "production" ? "live" : "test",
    supportedMethods: def === "airwallex"
      ? ["card", "wechat_pay", "alipay", "bank_transfer"]
      : ["card", "sepa", "ach"],
    // Legacy generic webhook path — PRESERVED for back-compat with sprint28 tests
    // and existing integrations. The v19 per-gateway path is exposed in
    // `defaultWebhookUrl` below.
    webhookUrl: "/api/webhooks/payment-gateway",
    version: "2.0",
    defaultGateway: def,
    defaultWebhookUrl: `/api/webhooks/payment-gateway/${def}`,
  };
}

/**
 * v19 Wave A / Change 3 — per-gateway public config (admin Payment Gateway tab).
 */
export function getPublicGatewayList() {
  return listPublicGatewayConfig();
}

/* ---------- Routes ---------- */

/**
 * v23.4.5 BUG 018 — per-user auto-provision lock.
 *
 * Serializes concurrent calls to /api/founder/subscription/charge for the
 * same userId. When a second request arrives while the first is still
 * running, it awaits the in-flight Promise and then runs `task()` with the
 * companies cache already updated by the first one — so it short-circuits
 * to the existing company instead of minting a duplicate.
 */
const AUTO_PROVISION_LOCKS = new Map<string, Promise<string | null>>();
async function acquireAutoProvisionLock(
  userId: string,
  task: () => Promise<string | null>,
): Promise<string | null> {
  const pending = AUTO_PROVISION_LOCKS.get(userId);
  if (pending) {
    // Wait for the first holder to release; then run our task (which will
    // re-check the cache and short-circuit if a company now exists).
    await pending.catch(() => null);
  }
  const run = (async () => {
    try {
      return await task();
    } finally {
      AUTO_PROVISION_LOCKS.delete(userId);
    }
  })();
  AUTO_PROVISION_LOCKS.set(userId, run);
  return run;
}

export function registerPaymentGatewayRoutes(app: Express): void {
  /**
   * GET /api/admin/payment-gateway/config
   * Returns gateway config for the admin UI tab.
   */
  app.get("/api/admin/payment-gateway/config", (_req: Request, res: Response) => {
    res.json({ ok: true, gateway: getPublicConfig() });
  });

  /**
   * GET /api/admin/payment-gateway/webhook-events
   * Returns recent webhook event log.
   */
  app.get("/api/admin/payment-gateway/webhook-events", (_req: Request, res: Response) => {
    res.json({ ok: true, events: recentWebhookEvents.slice(-50) });
  });

  /**
   * POST /api/founder/subscription/activate-free  — Patch v6
   * Brand-new authenticated founder activates the Founder Free plan.
   * - If the founder has no company, auto-creates a personal sandbox company.
   * - If a subscription does not exist for that company, creates one (plan=founder_free).
   * - Updates the subscription status to 'active' (free tier requires no payment).
   * Idempotent: a subsequent call returns the same active subscription.
   */
  app.post("/api/founder/subscription/activate-free", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    // V3 (Patch v8): respect body `companyId` so multi-company founders can
    // activate a specific company. Falls back to active company when absent.
    // Also enforces ownership: the founder must own the requested companyId.
    const bodyCompanyId = typeof (req.body as { companyId?: unknown })?.companyId === "string"
      ? (req.body as { companyId: string }).companyId
      : null;

    // 1) Ensure the founder has a company.
    let companies = getCompaniesForFounder(ctx.userId);
    let companyId: string | null = bodyCompanyId
      ? (companies.some((c) => c.companyId === bodyCompanyId) ? bodyCompanyId : null)
      : getActiveCompanyId(ctx.userId);
    if (bodyCompanyId && companyId === null) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company", companyId: bodyCompanyId });
    }
    if (!companies.length || !companyId) {
      const newId = `co_${randomBytes(6).toString("hex")}`;
      const founderName = (ctx.identity?.name ?? "My Company").trim() || "My Company";
      const newCompany: FounderCompanyMembership = {
        companyId: newId,
        companyName: `${founderName}'s Workspace`,
        legalName: `${founderName}'s Workspace, Inc.`,
        logoUrl: null,
        role: "founder",
        lastActiveAt: new Date().toISOString(),
        kpi: {
          capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
          dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0,
        },
        collective: { status: "none" },
        billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
        sector: "",
        stage: "",
        hq: "",
      };
      addCompanyForFounder(ctx.userId, newCompany);
      setActiveCompanyId(ctx.userId, newId);
      companyId = newId;
    }

    if (!companyId) {
      return res.status(500).json({ ok: false, error: "failed_to_provision_company" });
    }

    // 2) Ensure a subscription exists for this company.
    let sub = getSubscription(companyId);
    if (!sub) {
      const created = createSubscriptionForNewCompany(companyId, {
        plan: "founder_free",
        actor: `founder:${ctx.userId}`,
      });
      sub = created.subscription;
    }

    // 3) Activate (free tier doesn't require payment).
    const upd = updateSubscription(
      companyId,
      { status: "active", plan: "founder_free" },
      `founder:${ctx.userId}`,
    );
    if (!upd.ok) {
      return res.status(500).json({ ok: false, error: upd.error });
    }

    return res.json({ ok: true, companyId, subscription: upd.subscription });
  });

  /**
   * POST /api/founder/subscription/charge
   * Founder triggers a subscription charge. Body: { pricingModelId, paymentMethod: { tokenized, cardLast4 } }
   *
   * v23.4.3 BUG-001 FIX — Founders paying on a fresh account previously had to
   * "choose a payment plan all over again" on every re-login. Root cause:
   * the paid-plan charge endpoint required an existing companyId, but the
   * fresh-founder UX has no company yet at this step. After paying, the
   * subscription row was created against an empty companyId and the
   * founder.activeCompanyId stayed null — so RequireActiveSubscription
   * (client/src/App.tsx:190) kept redirecting them to /founder/subscribe.
   *
   * Fix: mirror the activate-free pattern — if the founder has no company
   * yet, auto-provision a placeholder workspace before charging. The
   * subscription then anchors to that real companyId, user_prefs.active_tenant_id
   * gets set, and subsequent logins resolve activeCompanyId correctly,
   * landing the founder on /founder/dashboard instead of /founder/subscribe.
   * Founders can rename / edit the workspace at /founder/company afterward.
   *
   * Subscription is PER-COMPANY (each company a founder owns is independent),
   * so this auto-create runs ONLY when the founder has zero companies. If
   * they already own one or more, this endpoint requires an explicit
   * companyId (existing behavior preserved).
   */
  app.post("/api/founder/subscription/charge", async (req: Request, res: Response) => {
    let companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    const { pricingModelId, paymentMethod, plan: planRaw } = req.body ?? {};

    // v23.4.11 Phase 2 (B-202) — the founder's SELECTED plan must be persisted.
    // Root cause of B-202: the charge handler processed payment (chargeSubscription
    // sets status:"active" + bumps invoicesCount) but NEVER wrote the chosen plan
    // onto the subscription row. So a Free founder who paid for Pro saw the
    // "Subscribed!" toast + status active, yet companies.plan stayed founder_free
    // — badge showed FREE and /founder/rounds/new kept bouncing. We whitelist the
    // requested plan against the Plan union (NEVER trust the body blindly) and
    // apply it after a successful, non-3DS charge below.
    const ALLOWED_PAID_PLANS = ["founder_pro", "founder_scale", "founder_enterprise"] as const;
    type AllowedPaidPlan = (typeof ALLOWED_PAID_PLANS)[number];
    const requestedPlan: AllowedPaidPlan | null =
      typeof planRaw === "string" && (ALLOWED_PAID_PLANS as readonly string[]).includes(planRaw)
        ? (planRaw as AllowedPaidPlan)
        : null;

    // v23.4.3 BUG-001: if no companyId resolved AND founder has zero
    // companies, auto-provision a placeholder workspace so the paid
    // subscription has somewhere to anchor.
    //
    // v23.4.5 BUG 018 fix: idempotency guard against duplicate auto-provision.
    // Symptom: when the Subscribe call is retried (double-click, webhook
    // retry, network re-issue) two concurrent requests each see
    // `companies.length === 0`, each mint a fresh `co_<rand>` id, and both
    // succeed — the founder ends up with 2–3 phantom "X's Workspace" rows.
    // Fix: serialize per-user via an in-flight Promise; re-check the founder
    // companies count after acquiring the lock and re-fetching context.
    if (!companyId) {
      try {
        const ctx = await getUserContext(req);
        if (ctx.isAuthed) {
          companyId = await acquireAutoProvisionLock(ctx.userId, async () => {
            // Re-check inside the lock: a concurrent request may have already
            // provisioned the workspace and updated USER_COMPANIES.
            const existing = getCompaniesForFounder(ctx.userId);
            if (existing.length > 0) {
              // Pick the first owned company — honour active selection if set.
              const activeId = getActiveCompanyId(ctx.userId);
              return activeId || existing[0].companyId;
            }
            const newId = `co_${randomBytes(6).toString("hex")}`;
            const founderName = (ctx.identity?.name ?? "My Company").trim() || "My Company";
            const placeholder: FounderCompanyMembership = {
              companyId: newId,
              companyName: `${founderName}'s Workspace`,
              legalName: `${founderName}'s Workspace, Inc.`,
              logoUrl: null,
              role: "founder",
              lastActiveAt: new Date().toISOString(),
              kpi: {
                capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
                dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0,
              },
              collective: { status: "none" },
              billing: { plan: "Founder Pro", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
              sector: "",
              stage: "",
              hq: "",
            };
            addCompanyForFounder(ctx.userId, placeholder);
            setActiveCompanyId(ctx.userId, newId);
            // Anchor a pending_payment subscription to the new company so the
            // charge below has a row to update.
            createSubscriptionForNewCompany(newId, {
              plan: "founder_pro",
              actor: `founder:${ctx.userId}`,
            });
            appendAdminAudit(
              `founder:${ctx.userId}`,
              `company:${newId}`,
              "company.auto_provisioned_on_charge",
              { reason: "bug001_paid_plan_fresh_founder" },
            );
            return newId;
          }) || companyId;
        }
      } catch (err) {
        // Non-fatal: if auto-provision fails, the charge endpoint returns
        // 404 below with the original error, which preserves prior behavior.
        log.warn("[paymentGatewayAdapter.charge] auto-provision failed (non-fatal):", (err as Error).message);
      }
    }

    let sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "subscription_not_found" });

    // v23.4.11 Phase 2 (B-202) — persist the SELECTED plan BEFORE we compute the
    // charge so the amount, plan label and renewal all reflect the plan the
    // founder actually bought (updateSubscription recomputes annualAmountMinor +
    // currency from PLAN_PRICES). This is the fix for the "Subscribed! but still
    // FREE" symptom. It is idempotent: re-charging with the same plan re-sets the
    // same value (no duplicate rows — updateSubscription upserts the current row
    // and the payment intent below is itself idempotent on subscriptionId+period).
    // Skipped when no valid paid plan was supplied (legacy callers / renewals),
    // which preserves prior behavior.
    if (requestedPlan && sub.plan !== requestedPlan) {
      const planUpd = updateSubscription(
        companyId,
        { plan: requestedPlan },
        `founder:charge:${companyId}`,
      );
      if (planUpd.ok) sub = planUpd.subscription;
    }

    // Derive period dates (annual billing)
    const now = new Date();
    const periodStart = now.toISOString().slice(0, 10);
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    try {
      const result = chargeSubscription({
        companyId,
        subscriptionId: `sub_${companyId}`,
        pricingModelId: pricingModelId ?? "pm_founder_pro_v1",
        currency: sub.currency,
        amountMinor: sub.annualAmountMinor,
        planLabel: sub.plan.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        periodStart,
        periodEnd,
        paymentMethodToken: paymentMethod?.tokenized ?? "tok_demo",
        cardLast4: paymentMethod?.cardLast4 ?? "4242",
      });

      if (!result.ok && result.requires3ds) {
        return res.json({ ok: false, requires3ds: true, clientSecret: result.clientSecret });
      }

      // v23.4.11 Phase 2 (B-202) — persist the card-on-file last4 so the billing
      // surfaces (and the company switcher badge via mergeBillingFromSubscription)
      // reflect the real payment method. chargeSubscription already flipped
      // status to "active"; this only records the card. Non-fatal on failure.
      const last4 = paymentMethod?.cardLast4 ?? null;
      if (last4) {
        updateSubscription(companyId, { cardLast4: last4 }, `founder:charge:${companyId}`);
      }

      res.json({ ok: true, subscription: getSubscription(companyId), invoice: result.invoice });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * GET /api/founder/subscription
   * Returns the subscription for the founder's active company.
   */
  app.get("/api/founder/subscription", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    const sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, subscription: sub });
  });

  /**
   * PATCH /api/founder/subscription
   * Founder can cancel their own subscription: set status to cancel_at_period_end.
   * Allowed changes: status (cancel_at_period_end only from this endpoint).
   */
  app.patch("/api/founder/subscription", (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    const { status } = req.body ?? {};

    // From founder side only cancel_at_period_end is allowed via this endpoint
    const allowed: string[] = ["cancel_at_period_end"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: "invalid_status_transition", allowed });
    }

    const result = updateSubscription(
      companyId,
      { status: status as any },
      `founder:${companyId}`,
    );
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  /**
   * POST /api/founder/subscription/resume
   * Resumes a cancel_at_period_end subscription back to active.
   * Double-confirm: requires x-confirm: true header.
   */
  app.post("/api/founder/subscription/resume", (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    const sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "subscription_not_found" });
    if (sub.status !== "cancel_at_period_end") {
      return res.status(400).json({ ok: false, error: "subscription_not_cancelling", current_status: sub.status });
    }

    const result = updateSubscription(companyId, { status: "active" }, `founder:${companyId}`);
    if (!result.ok) return res.status(404).json(result);

    appendAdminAudit(`founder:${companyId}`, `subscription:${companyId}`, "subscription.resumed", { from: "cancel_at_period_end", to: "active" });
    res.json({ ok: true, subscription: result.subscription });
  });

  /**
   * PATCH /api/founder/subscription/payment-method
   * Updates the card on file. Requires Luhn-valid card.
   */
  app.patch("/api/founder/subscription/payment-method", (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    const { cardLast4, cardholderName, tokenized } = req.body ?? {};
    if (!cardLast4 || cardLast4.length !== 4 || !/^\d{4}$/.test(cardLast4)) {
      return res.status(400).json({ ok: false, error: "invalid_card_last4" });
    }
    if (!tokenized) {
      return res.status(400).json({ ok: false, error: "missing_payment_token" });
    }
    const result = updateSubscription(companyId, { cardLast4 }, `founder:${companyId}`);
    if (!result.ok) return res.status(404).json(result);
    appendAdminAudit(`founder:${companyId}`, `subscription:${companyId}`, "payment_method.changed", { cardLast4, cardholderName });
    res.json({ ok: true, subscription: result.subscription });
  });

  /**
   * v19 Wave A / Change 3 — per-gateway webhook handlers.
   *
   * `/api/webhooks/payment-gateway/airwallex`
   * `/api/webhooks/payment-gateway/stripe`
   *
   * Both verify the inbound HMAC signature against the gateway-specific
   * secret. Verification is REQUIRED in production (NODE_ENV === "production")
   * but advisory in dev/test (where shared secrets are typically unset).
   *
   * Payloads are normalised to the existing `{ type, intentId, status,
   * companyId }` shape and forwarded through the same dispatch logic used by
   * the legacy `/api/webhooks/payment-gateway` endpoint.
   */
  function handleGatewayWebhook(gateway: "airwallex" | "stripe", req: Request, res: Response) {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const isProd = process.env.NODE_ENV === "production";
    const sigOk = gateway === "airwallex"
      ? verifyAirwallexSig(req.headers as Record<string, string | string[] | undefined>, rawBody)
      : verifyStripeSig(req.headers as Record<string, string | string[] | undefined>, rawBody);

    if (isProd && isGatewayReady(gateway) && !sigOk) {
      return res.status(401).json({ ok: false, error: "invalid_webhook_signature", gateway });
    }

    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    // Normalise AirWallex (`event_type`, `data.id`) / Stripe (`type`, `data.object.id`) shapes.
    let type: string | undefined;
    let intentId: string | undefined;
    let status: string | undefined;
    let companyId: string | undefined;
    if (gateway === "airwallex") {
      type = (body.name as string | undefined) ?? (body.type as string | undefined);
      const data = body.data as { object?: { id?: string; status?: string; merchant_order_id?: string } } | undefined;
      intentId = data?.object?.id ?? (body.intentId as string | undefined);
      status = data?.object?.status ?? (body.status as string | undefined);
      companyId = data?.object?.merchant_order_id ?? (body.companyId as string | undefined);
    } else {
      type = body.type as string | undefined;
      const data = body.data as { object?: { id?: string; status?: string; metadata?: { companyId?: string } } } | undefined;
      intentId = data?.object?.id ?? (body.intentId as string | undefined);
      status = data?.object?.status ?? (body.status as string | undefined);
      companyId = data?.object?.metadata?.companyId ?? (body.companyId as string | undefined);
    }

    if (!type || !intentId) {
      return res.status(400).json({ ok: false, error: "missing_fields", gateway });
    }

    const key = webhookKey(intentId, type);
    if (processedWebhookEvents.has(key)) {
      return res.json({ ok: true, idempotent: true, gateway });
    }
    processedWebhookEvents.add(key);

    recentWebhookEvents.push({
      id: `wh_${randomBytes(4).toString("hex")}`,
      type,
      intentId,
      status: status ?? "received",
      companyId: companyId ?? null,
      receivedAt: new Date().toISOString(),
    });

    // Normalise type into the legacy dispatch verbs.
    const isSuccess = /succeed|paid|captured|completed/i.test(type) || /SUCCEEDED|succeeded/.test(status ?? "");
    const isFailure = /fail|declined|errored|cancelled/i.test(type) || /FAILED|failed/.test(status ?? "");
    if (isSuccess && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "past_due") {
        updateSubscription(companyId, { status: "active" }, `system:webhook:${gateway}`);
      }
    } else if (isFailure && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "active") {
        updateSubscription(companyId, { status: "past_due" }, `system:webhook:${gateway}`);
      }
    }

    return res.json({ ok: true, gateway });
  }

  app.post("/api/webhooks/payment-gateway/airwallex", (req: Request, res: Response) => {
    handleGatewayWebhook("airwallex", req, res);
  });
  app.post("/api/webhooks/payment-gateway/stripe", (req: Request, res: Response) => {
    handleGatewayWebhook("stripe", req, res);
  });

  /**
   * POST /api/webhooks/payment-gateway
   * Idempotent on (intentId, type). Routes events to stores.
   */
  app.post("/api/webhooks/payment-gateway", (req: Request, res: Response) => {
    const { type, intentId, status, companyId } = req.body ?? {};

    if (!type || !intentId) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Idempotency check
    const key = webhookKey(intentId, type);
    if (processedWebhookEvents.has(key)) {
      return res.json({ ok: true, idempotent: true });
    }
    processedWebhookEvents.add(key);

    // Record event for the admin UI
    recentWebhookEvents.push({
      id: `wh_${randomBytes(4).toString("hex")}`,
      type,
      intentId,
      status: status ?? "received",
      companyId: companyId ?? null,
      receivedAt: new Date().toISOString(),
    });

    // Route to appropriate store action
    if (type === "payment.succeeded" && companyId) {
      // Mark subscription active if it was past_due
      const sub = getSubscription(companyId);
      if (sub?.status === "past_due") {
        updateSubscription(companyId, { status: "active" }, "system:webhook");
      }
    } else if (type === "payment.failed" && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "active") {
        updateSubscription(companyId, { status: "past_due" }, "system:webhook");
      }
    }

    res.json({ ok: true });
  });
}

/* ---------- Webhook event log ---------- */

interface WebhookEvent {
  id: string;
  type: string;
  intentId: string;
  status: string;
  companyId: string | null;
  receivedAt: string;
}

const recentWebhookEvents: WebhookEvent[] = [];

/* ---------- Testing exports ---------- */
export const _testGateway = {
  processedWebhookEvents,
  recentWebhookEvents,
  reset(): void {
    processedWebhookEvents.clear();
    recentWebhookEvents.length = 0;
  },
};
