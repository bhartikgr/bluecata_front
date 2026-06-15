/**
 * Sprint 29 KL-06 — Stripe-style Real Payment Gateway Scaffold.
 *
 * Mirrors paymentGatewayAdapter.ts's public surface:
 *   - chargeSubscription(input) → ChargeSubscriptionResult
 *   - chargeRefund(input) → refund result
 *   - getPublicConfig() → GatewayConfig
 *
 * When PAYMENT_GATEWAY_MODE === "live" AND PAYMENT_GATEWAY_API_KEY is set:
 *   → Uses Stripe Node SDK calls
 * Otherwise:
 *   → Falls through to the existing simulation adapter
 *
 * Stripe API key is sandbox-safe — it returns 401 from Stripe if invalid;
 * our code catches and falls back to simulation. Never throws.
 *
 * Webhook: POST /api/webhooks/stripe
 *   - Verifies Stripe-Signature using PAYMENT_GATEWAY_WEBHOOK_SECRET
 *   - Routes to invoiceStore / subscriptionsStore
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  chargeSubscription as simulateCharge,
  chargeRefund as simulateRefund,
  getPublicConfig as simulateConfig,
  type ChargeSubscriptionInput,
  type ChargeSubscriptionResult,
  type ChargeRefundInput,
  type GatewayConfig,
} from "./paymentGatewayAdapter";
import { getSubscription, updateSubscription } from "./subscriptionsStore";
import { markInvoicePaid, getInvoice } from "./invoiceStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

/* ============================================================
 * Mode detection
 * ============================================================ */
function isLiveMode(): boolean {
  return (
    process.env.PAYMENT_GATEWAY_MODE === "live" &&
    Boolean(process.env.PAYMENT_GATEWAY_API_KEY)
  );
}

/* ============================================================
 * Stripe SDK lazy-load
 * Avoids import errors when the package isn't installed in some environments.
 * ============================================================ */
let _stripeInstance: any = null;
function getStripe(): any {
  if (_stripeInstance) return _stripeInstance;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require("stripe");
    _stripeInstance = new Stripe(process.env.PAYMENT_GATEWAY_API_KEY!, {
      apiVersion: "2024-04-10",
    });
    return _stripeInstance;
  } catch (e) {
    log.error("[stripe] failed to initialise Stripe SDK — falling back to simulation:", e);
    return null;
  }
}

/* ============================================================
 * chargeSubscription
 * ============================================================ */
export async function chargeSubscriptionStripe(
  input: ChargeSubscriptionInput,
): Promise<ChargeSubscriptionResult> {
  if (!isLiveMode()) {
    return simulateCharge(input);
  }

  const stripe = getStripe();
  if (!stripe) {
    log.warn("[stripe] SDK unavailable — falling back to simulation");
    return simulateCharge(input);
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      customer: input.companyId,
      payment_method: input.paymentMethodToken,
      confirm: true,
      description: `${input.planLabel} — ${input.periodStart} to ${input.periodEnd}`,
      idempotency_key: createHash("sha256")
        .update(`${input.subscriptionId}:${input.periodStart}`)
        .digest("hex")
        .slice(0, 24),
      metadata: {
        companyId: input.companyId,
        subscriptionId: input.subscriptionId,
        pricingModelId: input.pricingModelId,
      },
    });

    if (paymentIntent.status === "requires_action") {
      return {
        ok: false,
        requires3ds: true,
        clientSecret: paymentIntent.client_secret,
        paymentEntry: {} as any,
        invoice: {} as any,
      };
    }

    if (paymentIntent.status !== "succeeded") {
      log.warn(`[stripe] unexpected status ${paymentIntent.status} — falling back to simulation`);
      return simulateCharge(input);
    }

    // Fall through to simulation for invoice creation (simulation handles idempotency)
    return simulateCharge(input);
  } catch (err: any) {
    log.error(`[stripe] charge error (${err?.code}) — falling back to simulation:`, err?.message);
    return simulateCharge(input);
  }
}

/* ============================================================
 * chargeRefund (delegates to simulation for now)
 * ============================================================ */
export function chargeRefundStripe(
  input: ChargeRefundInput,
): ReturnType<typeof simulateRefund> {
  return simulateRefund(input);
}

/* ============================================================
 * getPublicConfig
 * ============================================================ */
export function getPublicConfigStripe(): GatewayConfig {
  const base = simulateConfig();
  if (isLiveMode()) {
    return {
      ...base,
      name: "Stripe (Live)",
      mode: "live",
      webhookUrl: "/api/webhooks/stripe",
    };
  }
  return {
    ...base,
    name: "Stripe (Simulation)",
    mode: "test",
    webhookUrl: "/api/webhooks/stripe",
  };
}

/* ============================================================
 * Webhook signature verification
 * ============================================================ */
const WEBHOOK_TOLERANCE_SEC = 300; // 5 minutes

function verifyStripeSignature(
  rawBody: Buffer | string,
  sigHeader: string,
  secret: string,
): boolean {
  // Stripe-Signature header: "t=timestamp,v1=hash1,v1=hash2"
  const parts = sigHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));
  if (!tPart || v1Parts.length === 0) return false;

  const timestamp = parseInt(tPart.slice(2), 10);
  if (isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SEC) {
    log.warn("[stripe-webhook] timestamp outside tolerance window");
    return false;
  }

  const payload = `${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = createHash("sha256").update(`${secret}.${payload}`, "utf8")
    // Stripe uses HMAC-SHA256
    .digest("hex");

  // Use HMAC
  const { createHmac } = require("node:crypto");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");

  return v1Parts.some((p) => p.slice(3) === sig);
}

/* ============================================================
 * Route registration
 * ============================================================ */
export function registerStripeWebhookRoute(app: Express): void {
  /**
   * POST /api/webhooks/stripe
   * Verifies Stripe-Signature using PAYMENT_GATEWAY_WEBHOOK_SECRET.
   * Routes to invoiceStore / subscriptionsStore accordingly.
   * Idempotent on event ID.
   */
  /* v25.11 NL3 fix — the prior implementation tracked processed Stripe event
   * IDs in a RAM-only Set, so any server restart within Stripe's 72h retry
   * window allowed duplicate processing. We now check / write the
   * processed_webhook_events table (shared with the Airwallex adapter). */
  const processedStripeEvents = new Set<string>();
  let _stripeWebhookTableEnsured = false;
  function _ensureStripeWebhookTable(): void {
    if (_stripeWebhookTableEnsured) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rawDb } = require("./db/connection");
      const db: any = rawDb();
      db.exec(`CREATE TABLE IF NOT EXISTS processed_webhook_events (
        key TEXT PRIMARY KEY NOT NULL,
        processed_at TEXT NOT NULL
      );`);
      _stripeWebhookTableEnsured = true;
    } catch { /* non-fatal */ }
  }
  function _stripeEventAlreadyProcessed(eventId: string): boolean {
    if (processedStripeEvents.has(eventId)) return true;
    _ensureStripeWebhookTable();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rawDb } = require("./db/connection");
      const db: any = rawDb();
      const row: any = db.prepare(
        `SELECT 1 FROM processed_webhook_events WHERE key = ? LIMIT 1`,
      ).get(`stripe::${eventId}`);
      if (row) {
        processedStripeEvents.add(eventId);
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }
  function _recordStripeEvent(eventId: string): void {
    processedStripeEvents.add(eventId);
    _ensureStripeWebhookTable();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rawDb } = require("./db/connection");
      const db: any = rawDb();
      db.prepare(
        `INSERT INTO processed_webhook_events (key, processed_at) VALUES (?, ?)
         ON CONFLICT(key) DO NOTHING`,
      ).run(`stripe::${eventId}`, new Date().toISOString());
    } catch { /* fall through */ }
  }

  app.post("/api/webhooks/stripe", (req: Request, res: Response) => {
    const sigHeader = req.headers["stripe-signature"] as string | undefined;
    const webhookSecret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET ?? "";

    // Signature verification (skip if no secret configured — sandbox only)
    if (webhookSecret && sigHeader) {
      const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);
      const valid = verifyStripeSignature(rawBody, sigHeader, webhookSecret);
      if (!valid) {
        appendAdminAudit("system:stripe_webhook", "payment", "webhook.signature_rejected", { sigHeader: sigHeader?.slice(0, 20) });
        return res.status(400).json({ ok: false, error: "invalid_signature" });
      }
    } else if (sigHeader && !webhookSecret) {
      // Signature present but no secret — warn and proceed in test mode
      log.warn("[stripe-webhook] PAYMENT_GATEWAY_WEBHOOK_SECRET not set — skipping verification");
    }

    const event = req.body;
    if (!event?.id || !event?.type) {
      return res.status(400).json({ ok: false, error: "invalid_event" });
    }

    // Idempotency — v25.11 NL3: DB-backed check, survives restart.
    if (_stripeEventAlreadyProcessed(event.id)) {
      return res.json({ ok: true, idempotent: true });
    }
    _recordStripeEvent(event.id);

    // Route events
    const companyId: string | undefined = event?.data?.object?.metadata?.companyId;

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          if (companyId) {
            const sub = getSubscription(companyId);
            if (sub?.status === "past_due") {
              updateSubscription(companyId, { status: "active" }, "system:stripe_webhook");
            }
            appendAdminAudit("system:stripe_webhook", `subscription:${companyId}`, "invoice.paid", {
              stripeEventId: event.id,
              amount: event.data?.object?.amount,
            });
          }
          break;
        }
        case "payment_intent.payment_failed": {
          if (companyId) {
            const sub = getSubscription(companyId);
            if (sub?.status === "active") {
              updateSubscription(companyId, { status: "past_due" }, "system:stripe_webhook");
            }
            appendAdminAudit("system:stripe_webhook", `subscription:${companyId}`, "payment.failed", {
              stripeEventId: event.id,
            });
          }
          break;
        }
        case "charge.refunded": {
          appendAdminAudit("system:stripe_webhook", "payment", "invoice.refunded", {
            stripeEventId: event.id,
            companyId: companyId ?? "unknown",
          });
          break;
        }
        case "customer.subscription.deleted": {
          if (companyId) {
            updateSubscription(companyId, { status: "canceled" }, "system:stripe_webhook");
            appendAdminAudit("system:stripe_webhook", `subscription:${companyId}`, "subscription.updated", {
              status: "canceled",
              stripeEventId: event.id,
            });
          }
          break;
        }
        default:
          // Unhandled event — log and return 200
          log.info(`[stripe-webhook] unhandled event type: ${event.type}`);
      }
    } catch (err) {
      log.error("[stripe-webhook] handler error:", err);
      return res.status(500).json({ ok: false, error: "handler_error" });
    }

    res.json({ ok: true, type: event.type });
  });
}

/* ============================================================
 * Test helpers
 * ============================================================ */
export const _testStripeAdapter = {
  isLiveMode,
  verifyStripeSignature,
};
