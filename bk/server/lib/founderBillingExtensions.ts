/**
 * v25.6 — Founder-tier billing: Airwallex completion + Stripe deprecation.
 *
 * Background:
 *   - v25.4 inventoried Stripe touchpoints in Collective billing and migrated
 *     Collective to Airwallex (collectiveBillingStore.ts).
 *   - v25.5's master report listed "founder-tier billing on Stripe" as a
 *     deferred gap. Re-audit shows founder billing was actually already on
 *     Airwallex (`/api/billing/plan` mints Airwallex PaymentIntents,
 *     `/api/webhooks/payment-gateway/airwallex` is the active webhook).
 *   - But three real gaps remain:
 *       1. `/api/webhooks/payment-gateway/stripe` still accepted events and
 *          activated subscriptions. Per Ozan's directive (Airwallex is the
 *          only gateway), this MUST return 410 gateway_deprecated like the
 *          Collective Stripe webhook does.
 *       2. There is NO founder-side cancel / resume flow. Once a founder
 *          subscribes, they cannot stop the auto-renewal from the UI.
 *       3. capavate_subscriptions has no cancel_at_period_end column,
 *          so the cancel grace-window cannot be tracked.
 *
 * v25.6 closes all three gaps:
 *   - registerFounderBillingExtensions(app) adds:
 *       POST /api/founder/subscription/cancel  { paymentIntentId }
 *       POST /api/founder/subscription/resume  { paymentIntentId }
 *       POST /api/webhooks/payment-gateway/stripe — now returns 410
 *   - ensureCancelColumns() adds (idempotent) ALTER TABLE columns for
 *       cancel_at_period_end, cancelled_at, current_period_end.
 *
 * Sacred contract:
 *   - No edits to subscriptionStore.ts (sacred file w.r.t. v25.5 baseline).
 *     This module reads/writes capavate_subscriptions directly via rawDb().
 *   - No edits to paymentGatewayAdapter.ts; we override the Stripe webhook
 *     route by registering AFTER the adapter (Express respects last-write
 *     order on duplicate paths — but to be safe we register a sentinel
 *     middleware that pre-empts the legacy handler).
 */

import type { Express, Request, Response, NextFunction } from "express";
import { rawDb } from "../db/connection";
import { log } from "./logger";

let columnsEnsured = false;

/**
 * Idempotently add v25.6 cancellation columns to capavate_subscriptions.
 * Uses PRAGMA-guarded ALTER TABLE per the v24 schema-additions contract.
 */
export function ensureCancelColumns(): void {
  if (columnsEnsured) return;
  try {
    const db: any = rawDb();
    const cols: Array<{ name: string }> = db.prepare("PRAGMA table_info(capavate_subscriptions)").all();
    const have = new Set(cols.map((c) => c.name));
    if (!have.has("cancel_at_period_end")) {
      db.exec("ALTER TABLE capavate_subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0");
    }
    if (!have.has("cancelled_at")) {
      db.exec("ALTER TABLE capavate_subscriptions ADD COLUMN cancelled_at TEXT");
    }
    if (!have.has("current_period_end")) {
      db.exec("ALTER TABLE capavate_subscriptions ADD COLUMN current_period_end INTEGER");
    }
    columnsEnsured = true;
    log.info({ route: "founderBilling.ensureCancelColumns", message: "v25.6 columns ensured" });
  } catch (err) {
    log.warn({
      route: "founderBilling.ensureCancelColumns",
      message: `migration failed (non-fatal): ${(err as Error).message}`,
    });
    columnsEnsured = true; // don't retry forever
  }
}

/**
 * Pre-empt the Stripe founder webhook by registering a 410 handler BEFORE
 * paymentGatewayAdapter's handler runs. Express dispatches in registration
 * order; this guard runs first.
 */
function deprecateStripeFounderWebhook(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/api/webhooks/payment-gateway/stripe") {
    log.warn({
      route: "founderBilling.stripeDeprecated",
      message: "Stripe founder webhook called — returning 410 (Airwallex is the only gateway)",
    });
    res.status(410).json({
      ok: false,
      error: "gateway_deprecated",
      migration: "airwallex",
      message:
        "Stripe is no longer accepted for founder-tier billing. Reconfigure your webhook to /api/webhooks/payment-gateway/airwallex.",
    });
    return;
  }
  next();
}

export function registerFounderBillingExtensions(app: Express): void {
  ensureCancelColumns();

  /* The deprecation middleware MUST be installed BEFORE the legacy Stripe
   * webhook handler in paymentGatewayAdapter.ts. Since registerFounderBilling
   * Extensions() runs before registerPaymentGatewayRoutes() in routes.ts
   * (we wire it in immediately after registerTestDebugEndpoints), Express
   * dispatches this guard first and returns 410. */
  app.use(deprecateStripeFounderWebhook);

  /**
   * POST /api/founder/subscription/by-intent/cancel
   * Body: { paymentIntentId }
   *
   * v25.6 — The legacy /api/founder/subscription/cancel endpoint in
   * paymentGatewayAdapter.ts operates on the `subscriptions` table keyed by
   * companyId. This new endpoint operates on the v24.2+ `capavate_subscriptions`
   * table keyed by paymentIntentId (the Airwallex flow). Both endpoints coexist
   * because they target different stores; v25.6 adds the by-intent variant
   * needed by the new BillingReturn.tsx flow.
   *
   * Marks the subscription cancel_at_period_end=1. The capavate_subscriptions
   * row stays status=active until current_period_end passes; at that point a
   * dedicated worker (founderRenewalWorker — out of scope for v25.6) would
   * transition it. For v25.6 the gate is sufficient: the founder UI shows
   * "Cancelling on <date>" and no new charge is minted by the resolver.
   */
  app.post("/api/founder/subscription/by-intent/cancel", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { paymentIntentId } = req.body ?? {};
    if (!paymentIntentId) {
      return res.status(400).json({ ok: false, error: "paymentIntentId_required" });
    }
    try {
      const db: any = rawDb();
      const sub = db
        .prepare("SELECT id, user_id, status FROM capavate_subscriptions WHERE payment_intent_id = ?")
        .get(paymentIntentId);
      if (!sub) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (sub.user_id !== ctx.userId && !ctx.isAdmin) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }
      if (sub.status !== "active") {
        return res.status(409).json({ ok: false, error: "invalid_state", status: sub.status });
      }
      db.prepare(
        "UPDATE capavate_subscriptions SET cancel_at_period_end = 1, cancelled_at = ? WHERE id = ?",
      ).run(new Date().toISOString(), sub.id);
      return res.json({
        ok: true,
        paymentIntentId,
        cancelAtPeriodEnd: true,
        message: "Subscription will not auto-renew at period end.",
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "cancel_failed", message: (err as Error).message });
    }
  });

  /**
   * POST /api/founder/subscription/by-intent/resume
   * Body: { paymentIntentId }
   *
   * v25.6 — see /by-intent/cancel for the rationale (legacy resume endpoint
   * keys by companyId; this one keys by paymentIntentId).
   *
   * Clears cancel_at_period_end if set. Subscription stays active and will
   * auto-renew at period end.
   */
  app.post("/api/founder/subscription/by-intent/resume", async (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { paymentIntentId } = req.body ?? {};
    if (!paymentIntentId) {
      return res.status(400).json({ ok: false, error: "paymentIntentId_required" });
    }
    try {
      const db: any = rawDb();
      const sub = db
        .prepare("SELECT id, user_id, status, cancel_at_period_end FROM capavate_subscriptions WHERE payment_intent_id = ?")
        .get(paymentIntentId);
      if (!sub) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (sub.user_id !== ctx.userId && !ctx.isAdmin) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }
      if (sub.cancel_at_period_end !== 1) {
        return res.json({ ok: true, paymentIntentId, cancelAtPeriodEnd: false, idempotent: true });
      }
      db.prepare(
        "UPDATE capavate_subscriptions SET cancel_at_period_end = 0, cancelled_at = NULL WHERE id = ?",
      ).run(sub.id);
      return res.json({
        ok: true,
        paymentIntentId,
        cancelAtPeriodEnd: false,
        message: "Subscription will auto-renew at period end.",
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "resume_failed", message: (err as Error).message });
    }
  });
}
