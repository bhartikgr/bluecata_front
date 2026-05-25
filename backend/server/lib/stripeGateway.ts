/**
 * v19 Wave A / Change 3 — Stripe gateway client (parity shim).
 *
 * Stripe remains a supported gateway alongside AirWallex (the new default).
 * This module mirrors the AirWallex client surface so call sites can be
 * gateway-agnostic. We keep it intentionally thin: the existing
 * `paymentGatewayAdapter.ts` flow already handles the heavy lifting via
 * `paymentStore.chargeOrIdempotent` and we do NOT touch that path.
 *
 * Real Stripe API calls require `STRIPE_SECRET_KEY`. In test mode we return
 * deterministic stubs to keep the suite hermetic.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGatewayCredentials } from "./paymentGatewayResolver";

export interface StripeCreatePaymentIntentInput {
  amountMinor: number;
  currency: string;          // ISO 4217 lowercase per Stripe convention
  customerId?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
  idempotencyKey: string;
}

export interface StripePaymentIntent {
  id: string;
  status: "requires_payment_method" | "requires_action" | "requires_capture" | "succeeded" | "canceled";
  amount: number;
  currency: string;
  client_secret?: string;
  created: number;
}

export interface StripeRefundInput {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
}

export interface StripeRefund {
  id: string;
  payment_intent: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "canceled";
  reason: string;
  created: number;
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe gateway is not configured (set STRIPE_SECRET_KEY)");
    this.name = "StripeNotConfiguredError";
  }
}

function ensureConfigured(): { secretKey: string } {
  const { stripe } = getGatewayCredentials();
  if (!stripe.secretKey) throw new StripeNotConfiguredError();
  return { secretKey: stripe.secretKey };
}

function shouldUseStubMode(): boolean {
  return process.env.STRIPE_REAL_NETWORK !== "1";
}

export async function createPaymentIntent(
  input: StripeCreatePaymentIntentInput,
): Promise<StripePaymentIntent> {
  ensureConfigured();
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("amountMinor must be a positive integer (minor units)");
  }
  if (!/^[a-z]{3}$/.test(input.currency)) {
    throw new Error("currency must be ISO 4217 (3 lowercase letters for Stripe)");
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotencyKey is required");
  }

  if (shouldUseStubMode()) {
    return {
      id: `pi_stub_${input.idempotencyKey.slice(0, 16)}`,
      status: "succeeded",
      amount: input.amountMinor,
      currency: input.currency,
      client_secret: `pi_stub_${randomBytes(8).toString("hex")}_secret_${randomBytes(6).toString("hex")}`,
      created: Math.floor(Date.now() / 1000),
    };
  }

  /* istanbul ignore next — exercised only when STRIPE_REAL_NETWORK=1 */
  const { secretKey } = ensureConfigured();
  const params = new URLSearchParams({
    amount: String(input.amountMinor),
    currency: input.currency,
  });
  if (input.customerId) params.append("customer", input.customerId);
  if (input.description) params.append("description", input.description);
  for (const [k, v] of Object.entries(input.metadata ?? {})) {
    params.append(`metadata[${k}]`, String(v));
  }
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Stripe createPaymentIntent failed: HTTP ${res.status}`);
  return (await res.json()) as StripePaymentIntent;
}

export async function refundPayment(input: StripeRefundInput): Promise<StripeRefund> {
  ensureConfigured();
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("refund amountMinor must be a positive integer");
  }
  if (shouldUseStubMode()) {
    return {
      id: `re_stub_${input.idempotencyKey.slice(0, 12)}`,
      payment_intent: input.paymentIntentId,
      amount: input.amountMinor,
      currency: "usd",
      status: "succeeded",
      reason: input.reason,
      created: Math.floor(Date.now() / 1000),
    };
  }
  /* istanbul ignore next */
  const { secretKey } = ensureConfigured();
  const params = new URLSearchParams({
    payment_intent: input.paymentIntentId,
    amount: String(input.amountMinor),
    reason: "requested_by_customer",
  });
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Stripe refundPayment failed: HTTP ${res.status}`);
  return (await res.json()) as StripeRefund;
}

/**
 * Verify a Stripe webhook signature. Stripe sends a `stripe-signature` header
 * containing `t=<timestamp>,v1=<signature>` segments. We verify v1 using
 * HMAC-SHA256 over `<timestamp>.<raw_body>` per Stripe docs.
 */
export function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): boolean {
  const { stripe } = getGatewayCredentials();
  if (!stripe.webhookSecret) return false;
  const header = headers["stripe-signature"];
  const sigHeader = Array.isArray(header) ? header[0] : header;
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const idx = p.indexOf("=");
      return idx === -1 ? [p, ""] : [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    }),
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;
  const expected = createHmac("sha256", stripe.webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signWebhookBody(rawBody: string, timestamp: string, secret?: string): string {
  const useSecret = secret ?? getGatewayCredentials().stripe.webhookSecret ?? "";
  return createHmac("sha256", useSecret).update(`${timestamp}.${rawBody}`).digest("hex");
}
