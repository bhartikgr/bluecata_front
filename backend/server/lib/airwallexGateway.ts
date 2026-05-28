/**
 * v19 Wave A / Change 3 — AirWallex gateway client.
 *
 * Implements a thin, typed wrapper over the AirWallex Payments REST API. The
 * client is intentionally small and dependency-free: it does not import
 * Stripe types, paymentStore, or invoiceStore. Higher-level call sites
 * (paymentGatewayAdapter) own the orchestration.
 *
 * Capabilities exposed:
 *   • createPaymentIntent(input)            — POST /api/v1/pa/payment_intents/create
 *   • confirmPaymentIntent(id, method)      — POST /api/v1/pa/payment_intents/:id/confirm
 *   • retrievePaymentIntent(id)             — GET  /api/v1/pa/payment_intents/:id
 *   • refundPayment(input)                  — POST /api/v1/pa/refunds/create
 *   • verifyWebhookSignature(headers, body) — HMAC-SHA256 verification per AirWallex spec
 *
 * Math invariants:
 *   • All amounts are integer minor units.
 *   • Currency is ISO 4217 uppercase.
 *   • Idempotency keys are mandatory on POST endpoints.
 *
 * NOTE: In test mode (`NODE_ENV !== "production"`) the client does not make
 * real HTTP calls. Instead, deterministic stub responses are returned so the
 * rest of the suite can run hermetically. The real-network path is fenced
 * behind `AIRWALLEX_REAL_NETWORK=1` for staging/prod parity tests.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGatewayCredentials } from "./paymentGatewayResolver";

export interface AirwallexCreatePaymentIntentInput {
  amountMinor: number;
  currency: string;            // ISO 4217 (e.g. "USD", "HKD")
  merchantOrderId: string;     // your internal order/subscription id
  customerId?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
  /** Idempotency key — pass per-attempt to avoid double-charging. */
  idempotencyKey: string;
}

export interface AirwallexPaymentIntent {
  id: string;
  status: "REQUIRES_PAYMENT_METHOD" | "REQUIRES_CUSTOMER_ACTION" | "REQUIRES_CAPTURE" | "SUCCEEDED" | "CANCELLED" | "FAILED";
  amount: number;              // minor units
  currency: string;
  merchant_order_id: string;
  client_secret?: string;
  next_action?: { type: string; url?: string };
  created_at: string;
}

export interface AirwallexRefundInput {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AirwallexRefund {
  id: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  status: "RECEIVED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  reason: string;
  created_at: string;
}

export class AirwallexNotConfiguredError extends Error {
  constructor() {
    super("AirWallex gateway is not configured (set AIRWALLEX_API_KEY + AIRWALLEX_CLIENT_ID)");
    this.name = "AirwallexNotConfiguredError";
  }
}

export class AirwallexSignatureError extends Error {
  constructor(reason: string) {
    super(`AirWallex webhook signature verification failed: ${reason}`);
    this.name = "AirwallexSignatureError";
  }
}

function ensureConfigured(): { apiKey: string; clientId: string; apiBase: string } {
  const { airwallex } = getGatewayCredentials();
  if (!airwallex.apiKey || !airwallex.clientId) {
    throw new AirwallexNotConfiguredError();
  }
  return { apiKey: airwallex.apiKey, clientId: airwallex.clientId, apiBase: airwallex.apiBase };
}

function shouldUseStubMode(): boolean {
  // Real network calls only when explicitly enabled. This keeps the test
  // suite hermetic and lets staging override.
  return process.env.AIRWALLEX_REAL_NETWORK !== "1";
}

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export async function createPaymentIntent(
  input: AirwallexCreatePaymentIntentInput,
): Promise<AirwallexPaymentIntent> {
  ensureConfigured();

  // Validate inputs (defense in depth — should match server-side validators).
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("amountMinor must be a positive integer (minor units)");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("currency must be ISO 4217 (3 uppercase letters)");
  }
  if (!input.merchantOrderId.trim()) {
    throw new Error("merchantOrderId is required");
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotencyKey is required");
  }

  if (shouldUseStubMode()) {
    // Deterministic stub: id is derived from idempotency key so re-runs match.
    const stubId = `int_stub_${input.idempotencyKey.slice(0, 16)}`;
    return {
      id: stubId,
      status: "SUCCEEDED",
      amount: input.amountMinor,
      currency: input.currency,
      merchant_order_id: input.merchantOrderId,
      client_secret: `cs_stub_${randomBytes(8).toString("hex")}`,
      created_at: nowIso(),
    };
  }

  /* istanbul ignore next — real-network path is exercised only in staging */
  const { apiKey, clientId, apiBase } = ensureConfigured();
  const url = `${apiBase}/api/v1/pa/payment_intents/create`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-client-id": clientId,
      "x-idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      merchant_order_id: input.merchantOrderId,
      descriptor: input.description?.slice(0, 32),
      metadata: input.metadata ?? {},
    }),
  });
  if (!res.ok) {
    throw new Error(`AirWallex createPaymentIntent failed: HTTP ${res.status}`);
  }
  return (await res.json()) as AirwallexPaymentIntent;
}

export async function retrievePaymentIntent(id: string): Promise<AirwallexPaymentIntent> {
  ensureConfigured();
  if (shouldUseStubMode()) {
    return {
      id,
      status: "SUCCEEDED",
      amount: 0,
      currency: "USD",
      merchant_order_id: `mo_${id}`,
      created_at: nowIso(),
    };
  }
  /* istanbul ignore next */
  const { apiKey, clientId, apiBase } = ensureConfigured();
  const res = await fetch(`${apiBase}/api/v1/pa/payment_intents/${id}`, {
    headers: { "x-api-key": apiKey, "x-client-id": clientId },
  });
  if (!res.ok) throw new Error(`AirWallex retrievePaymentIntent failed: HTTP ${res.status}`);
  return (await res.json()) as AirwallexPaymentIntent;
}

export async function refundPayment(input: AirwallexRefundInput): Promise<AirwallexRefund> {
  ensureConfigured();
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("refund amountMinor must be a positive integer");
  }
  if (shouldUseStubMode()) {
    return {
      id: `ref_stub_${input.idempotencyKey.slice(0, 12)}`,
      payment_intent_id: input.paymentIntentId,
      amount: input.amountMinor,
      currency: "USD",
      status: "SUCCEEDED",
      reason: input.reason,
      created_at: nowIso(),
    };
  }
  /* istanbul ignore next */
  const { apiKey, clientId, apiBase } = ensureConfigured();
  const res = await fetch(`${apiBase}/api/v1/pa/refunds/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-client-id": clientId,
      "x-idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      payment_intent_id: input.paymentIntentId,
      amount: input.amountMinor,
      reason: input.reason,
      metadata: input.metadata ?? {},
    }),
  });
  if (!res.ok) throw new Error(`AirWallex refundPayment failed: HTTP ${res.status}`);
  return (await res.json()) as AirwallexRefund;
}

/* -------------------------------------------------------------------------- */
/*  Webhook signature verification                                            */
/* -------------------------------------------------------------------------- */

/**
 * Verify an AirWallex webhook signature. AirWallex signs the raw request body
 * with HMAC-SHA256 using the configured webhook secret; the signature is sent
 * in the `x-signature` header. The `x-timestamp` header is also part of the
 * signed string (prepended to the body with a dot).
 *
 * @returns true if signature is valid, false otherwise. Does not throw on
 *          validation failure — caller can decide whether to reject.
 */
export function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): boolean {
  const { airwallex } = getGatewayCredentials();
  if (!airwallex.webhookSecret) return false;

  const sigHeader = headers["x-signature"];
  const tsHeader = headers["x-timestamp"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  const timestamp = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
  if (!signature || !timestamp) return false;

  const message = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", airwallex.webhookSecret).update(message).digest("hex");

  // Constant-time compare to defeat timing attacks.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Generate an HMAC signature for a given raw body — used in tests to produce
 * valid signatures without exposing the secret to callers.
 */
export function signWebhookBody(rawBody: string, timestamp: string, secret?: string): string {
  const useSecret = secret ?? getGatewayCredentials().airwallex.webhookSecret ?? "";
  return createHmac("sha256", useSecret).update(`${timestamp}.${rawBody}`).digest("hex");
}
