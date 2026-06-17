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
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGatewayCredentials, getAirwallexMode } from "./paymentGatewayResolver";

/* =====================================================================
 * v25.28 — ISO-4217 amount conversion for the Airwallex boundary.
 *
 * Critical bug fix discovered 16-Jun-2026: Capavate stores money internally
 * as minor units (cents) following the Stripe convention, but the Airwallex
 * PaymentIntent v1 API expects amounts in MAJOR units (dollars). Quoting the
 * official Airwallex docs (https://www.airwallex.com/docs/payments/get-
 * started/using-payments-intent-api):
 *
 *   "amount: The amount to charge specified in major units as defined by
 *    ISO 4217. For example, $9.99 is represented as 9.99."
 *
 * Sending `amount: 84000` for a $840 USD plan made the merchant portal show
 * **$84,000.00** — a 100x inflation (confirmed by Avi's screenshot). This
 * helper converts at the Airwallex boundary only; internal storage and
 * Number.isInteger(amountMinor) validation remain unchanged.
 *
 * Critical subtlety — do NOT just divide by 100:
 *   • USD/EUR/most currencies: exponent 2 → divide by 100 (84000 cents = $840.00)
 *   • Zero-decimal currencies (JPY/KRW/etc.): exponent 0 → divide by 1
 *     (yen and won have no sub-unit; ¥1000 is stored as 1000 minor units AND
 *     sent to Airwallex as 1000 major units)
 *   • Three-decimal currencies (BHD/KWD/etc.): exponent 3 → divide by 1000
 * ===================================================================== */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "HUF", "IDR", "ISK", "JPY", "KMF", "KRW",
  "MGA", "PYG", "RWF", "TWD", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

export function minorToAirwallexMajor(amountMinor: number, currency: string): number {
  const c = (currency || "USD").toUpperCase();
  const exp = ZERO_DECIMAL_CURRENCIES.has(c)
    ? 0
    : THREE_DECIMAL_CURRENCIES.has(c)
    ? 3
    : 2;
  if (exp === 0) return amountMinor;
  // Airwallex docs explicitly allow fractional `amount` (e.g. 9.99). Don't round.
  return amountMinor / Math.pow(10, exp);
}

export interface AirwallexCreatePaymentIntentInput {
  amountMinor: number;
  currency: string;            // ISO 4217 (e.g. "USD", "HKD")
  merchantOrderId: string;     // your internal order/subscription id
  customerId?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
  /** Idempotency key — pass per-attempt to avoid double-charging. */
  idempotencyKey: string;
  /** v25.28 — URL Airwallex redirects to after hosted-payment-page completion.
   *  Required for the Airwallex.js redirectToCheckout flow. */
  returnUrl?: string;
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

// v25.1 Bug 3 fix — Airwallex API requires OAuth Bearer auth, NOT x-api-key on
// every request. The flow is:
//   1. POST /api/v1/authentication/login with x-api-key + x-client-id
//      → returns { token, expires_at }
//   2. All subsequent calls use Authorization: Bearer <token>
// The token is valid for ~30 minutes. We cache it process-wide.
//
// Without this, the previous code sent x-api-key directly on /payment_intents,
// which Airwallex (correctly) rejected with HTTP 403. That's what Avi saw in prod.
let _cachedAirwallexToken: { token: string; expiresAt: number } | null = null;

async function getAirwallexBearerToken(): Promise<string> {
  const now = Date.now();
  // Reuse cached token if it's valid for at least 60 more seconds.
  if (_cachedAirwallexToken && _cachedAirwallexToken.expiresAt - 60_000 > now) {
    return _cachedAirwallexToken.token;
  }
  const { apiKey, clientId, apiBase } = ensureConfigured();
  const loginUrl = `${apiBase}/api/v1/authentication/login`;
  const res = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-client-id": clientId,
    },
    // Airwallex login is POST with empty body.
    body: "{}",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `AirWallex authentication/login failed: HTTP ${res.status} — ` +
      `verify AIRWALLEX_API_KEY + AIRWALLEX_CLIENT_ID are valid for ${apiBase}. ` +
      `Response: ${detail.slice(0, 200)}`
    );
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token) {
    throw new Error("AirWallex authentication/login returned no token");
  }
  // expires_at is ISO; if missing or unparsable, assume 30 minutes.
  const expiresAt = body.expires_at ? Date.parse(body.expires_at) : now + 30 * 60_000;
  _cachedAirwallexToken = { token: body.token, expiresAt };
  return body.token;
}

/** Expose for unit tests / forced re-auth flows. */
export function _resetAirwallexTokenCache(): void {
  _cachedAirwallexToken = null;
}

function shouldUseStubMode(): boolean {
  // v24.4 Bug A — mode-based switching replaces the old binary REAL_NETWORK flag.
  //   stub → no network (hermetic).
  //   test → REAL network against the demo base URL.
  //   live → REAL network against production.
  // Defaults to `test` when AIRWALLEX_API_KEY is present, else `stub` (see
  // getAirwallexMode in paymentGatewayResolver). Per Avi: "make it always test
  // mode until tested fully" — i.e. real network defaults to the demo endpoint,
  // never live, unless AIRWALLEX_MODE=live + a key is explicitly set.
  return getAirwallexMode() === "stub";
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
    // v25.6 — use a SHA-256 hash of the full idempotency key (not just the
    // first 16 chars). The old slice(0, 16) caused collisions across tests
    // because keys like `idem_u_founder_<unique>_...` all share the same
    // 16-char prefix, leading two distinct users to receive the same
    // payment intent id and tripping the not_owner gate on subscription
    // status/cancel/resume.
    const idemHash = require("node:crypto")
      .createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex")
      .slice(0, 24);
    const stubId = `int_stub_${idemHash}`;
    return {
      id: stubId,
      status: "SUCCEEDED",
      // v25.28 — stub responses echo the Airwallex contract: amount in MAJOR units.
      amount: minorToAirwallexMajor(input.amountMinor, input.currency),
      currency: input.currency,
      merchant_order_id: input.merchantOrderId,
      client_secret: `cs_stub_${randomBytes(8).toString("hex")}`,
      created_at: nowIso(),
    };
  }

  /* istanbul ignore next — real-network path is exercised only in staging */
  // v25.1 Bug 3 fix — use OAuth Bearer token, not x-api-key, on the API call.
  // v25.8 Bug 1 fix — Airwallex PaymentIntent v1 API requires `request_id`
  // in the REQUEST BODY (not just the x-idempotency-key header) for
  // idempotency. Avi's prod call was failing with:
  //   {"code":"validation_error","source":"request_id",
  //    "message":"request_id must be provided"}
  // We now derive request_id from the idempotency key so re-runs of the same
  // logical request match the same intent (Airwallex de-dups by request_id).
  // We also include merchant_order_id (already present) and a SHA256 of the
  // key to keep request_id <= 64 chars per Airwallex spec.
  const { apiBase } = ensureConfigured();
  const token = await getAirwallexBearerToken();
  const url = `${apiBase}/api/v1/pa/payment_intents/create`;
  const requestId = require("node:crypto")
    .createHash("sha256")
    .update(input.idempotencyKey)
    .digest("hex")
    .slice(0, 64);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "x-idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      request_id: requestId,
      /* v25.28 — 100x bug fix. Airwallex requires MAJOR units, not minor.
       * For USD: amountMinor=84000 cents → amount=840 dollars.
       * For JPY: amountMinor=1000 yen   → amount=1000 yen (zero-decimal).
       * See: https://www.airwallex.com/docs/payments/get-started/using-payments-intent-api */
      amount: minorToAirwallexMajor(input.amountMinor, input.currency),
      currency: input.currency,
      merchant_order_id: input.merchantOrderId,
      descriptor: input.description?.slice(0, 32),
      /* v25.28 — Airwallex hosted-payment-page redirect target. */
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      metadata: input.metadata ?? {},
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // If 401/403 after a successful login, the token may have been revoked. Bust the cache.
    if (res.status === 401 || res.status === 403) _resetAirwallexTokenCache();
    throw new Error(`AirWallex createPaymentIntent failed: HTTP ${res.status}${detail ? " — " + detail.slice(0, 200) : ""}`);
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
  // v25.1 Bug 3 fix — Bearer token (was x-api-key, returned 403).
  const { apiBase } = ensureConfigured();
  const token = await getAirwallexBearerToken();
  const res = await fetch(`${apiBase}/api/v1/pa/payment_intents/${id}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) _resetAirwallexTokenCache();
    throw new Error(`AirWallex retrievePaymentIntent failed: HTTP ${res.status}`);
  }
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
      // v25.28 — stub echoes Airwallex contract: MAJOR units.
      amount: minorToAirwallexMajor(input.amountMinor, "USD"),
      currency: "USD",
      status: "SUCCEEDED",
      reason: input.reason,
      created_at: nowIso(),
    };
  }
  /* istanbul ignore next */
  // v25.1 Bug 3 fix — Bearer token (was x-api-key, returned 403).
  const { apiBase } = ensureConfigured();
  const token = await getAirwallexBearerToken();
  const res = await fetch(`${apiBase}/api/v1/pa/refunds/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "x-idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      payment_intent_id: input.paymentIntentId,
      // v25.28 — same major-unit fix for refunds. Airwallex docs:
      // "amount: in major units as defined by ISO 4217."
      amount: minorToAirwallexMajor(input.amountMinor, "USD"),
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
