/**
 * server/lib/airwallexCollective.ts — v25.4 Phase A.
 *
 * Airwallex-backed Collective membership billing. Mirrors the prior
 * stripeCollective.ts module shape so collectiveBillingStore.ts can swap
 * gateways with minimal route surgery. Airwallex is the primary platform
 * gateway per Ozan's directive (24-May-2026) — Stripe is being deprecated
 * from the Collective billing surface.
 *
 * Quality contract:
 *   - Lazy-call the Airwallex gateway helpers in ./airwallexGateway. Never
 *     crash on missing keys. When unset, every helper returns the
 *     "not configured" sentinel so the route layer can translate to a
 *     503 airwallex_not_configured response.
 *   - Each tier has an independent per-tier env-var price block:
 *       AIRWALLEX_COLLECTIVE_<TIER>_AMOUNT_MINOR  (integer minor units, e.g. 50000 = $500)
 *       AIRWALLEX_COLLECTIVE_<TIER>_CURRENCY      (ISO 4217, default USD)
 *       AIRWALLEX_COLLECTIVE_<TIER>_INTERVAL      (year|month, default year)
 *     If a tier has no AMOUNT_MINOR set, that tier's `available` flag is
 *     false and the purchase endpoint returns 503 tier_not_configured —
 *     never a crash, never a hardcoded amount.
 *   - The tier catalog (entitlements + membership-role mapping) is
 *     identical to the prior Stripe module so client UI + downstream
 *     `collectiveMembershipStore.activate()` flows do not change.
 *   - Airwallex does not have a hosted "Customer Portal" — self-service
 *     cancellation goes through our own `/api/collective/membership/cancel`
 *     route which flips `cancelAtPeriodEnd=true`. The renewal worker
 *     respects that flag and stops scheduling charges.
 *
 * No mock data, no TODOs, no stubs. Every code path either calls the real
 * Airwallex API (when configured) or returns a clear error structure.
 */

import { log } from "./logger";
import {
  createPaymentIntent as awCreatePaymentIntent,
  retrievePaymentIntent as awRetrievePaymentIntent,
  refundPayment as awRefundPayment,
  AirwallexNotConfiguredError,
  type AirwallexPaymentIntent,
} from "./airwallexGateway";
import {
  getAirwallexMode,
  getDefaultGatewayId,
} from "./paymentGatewayResolver";

export type CollectiveTier = "basic" | "standard" | "premium";

/** Env var names — single source of truth so tests + docs can reference them. */
export const AIRWALLEX_COLLECTIVE_ENV = {
  /* Webhook secret is shared with the platform Airwallex webhook receiver,
   * so we reuse the same env var rather than introducing a second secret. */
  WEBHOOK_SECRET: "AIRWALLEX_WEBHOOK_SECRET",
  BASIC_AMOUNT_MINOR: "AIRWALLEX_COLLECTIVE_BASIC_AMOUNT_MINOR",
  BASIC_CURRENCY: "AIRWALLEX_COLLECTIVE_BASIC_CURRENCY",
  BASIC_INTERVAL: "AIRWALLEX_COLLECTIVE_BASIC_INTERVAL",
  STANDARD_AMOUNT_MINOR: "AIRWALLEX_COLLECTIVE_STANDARD_AMOUNT_MINOR",
  STANDARD_CURRENCY: "AIRWALLEX_COLLECTIVE_STANDARD_CURRENCY",
  STANDARD_INTERVAL: "AIRWALLEX_COLLECTIVE_STANDARD_INTERVAL",
  PREMIUM_AMOUNT_MINOR: "AIRWALLEX_COLLECTIVE_PREMIUM_AMOUNT_MINOR",
  PREMIUM_CURRENCY: "AIRWALLEX_COLLECTIVE_PREMIUM_CURRENCY",
  PREMIUM_INTERVAL: "AIRWALLEX_COLLECTIVE_PREMIUM_INTERVAL",
} as const;

export interface TierDescriptor {
  tier: CollectiveTier;
  label: string;
  blurb: string;
  /** Entitlements (Boolean capabilities) granted by this tier. */
  entitlements: string[];
  /** Membership-store role this tier maps to on activation. */
  membershipRole: "member" | "dsc_member" | "chapter_admin";
}

/* Catalog is byte-identical to the prior stripeCollective COLLECTIVE_TIER_CATALOG
 * so the API response shape stays stable for the UI. */
export const COLLECTIVE_TIER_CATALOG: TierDescriptor[] = [
  {
    tier: "basic",
    label: "Basic",
    blurb: "Read access to the chapter, attend events, basic community comms.",
    entitlements: ["read", "events:attend", "comms:basic"],
    membershipRole: "member",
  },
  {
    tier: "standard",
    label: "Standard",
    blurb:
      "Everything in Basic, plus DSC voting rights and soft-circle participation.",
    entitlements: [
      "read",
      "events:attend",
      "comms:basic",
      "dsc:vote",
      "soft_circles:participate",
    ],
    membershipRole: "dsc_member",
  },
  {
    tier: "premium",
    label: "Premium",
    blurb:
      "Everything in Standard, plus propose investments and stand for chapter admin nomination.",
    entitlements: [
      "read",
      "events:attend",
      "comms:basic",
      "dsc:vote",
      "soft_circles:participate",
      "investments:propose",
      "admin:nominate",
    ],
    membershipRole: "chapter_admin",
  },
];

/* ============================================================
 * Per-tier price lookup (env-driven, no hardcoded amounts)
 * ============================================================ */

export interface TierPriceConfig {
  amountMinor: number;
  currency: string;
  interval: "year" | "month";
}

function envVarsForTier(tier: CollectiveTier): {
  amount: string;
  currency: string;
  interval: string;
} {
  switch (tier) {
    case "basic":
      return {
        amount: AIRWALLEX_COLLECTIVE_ENV.BASIC_AMOUNT_MINOR,
        currency: AIRWALLEX_COLLECTIVE_ENV.BASIC_CURRENCY,
        interval: AIRWALLEX_COLLECTIVE_ENV.BASIC_INTERVAL,
      };
    case "standard":
      return {
        amount: AIRWALLEX_COLLECTIVE_ENV.STANDARD_AMOUNT_MINOR,
        currency: AIRWALLEX_COLLECTIVE_ENV.STANDARD_CURRENCY,
        interval: AIRWALLEX_COLLECTIVE_ENV.STANDARD_INTERVAL,
      };
    case "premium":
      return {
        amount: AIRWALLEX_COLLECTIVE_ENV.PREMIUM_AMOUNT_MINOR,
        currency: AIRWALLEX_COLLECTIVE_ENV.PREMIUM_CURRENCY,
        interval: AIRWALLEX_COLLECTIVE_ENV.PREMIUM_INTERVAL,
      };
  }
}

/** Read the per-tier price config from env. Null when AMOUNT_MINOR unset. */
export function priceConfigForTier(tier: CollectiveTier): TierPriceConfig | null {
  const keys = envVarsForTier(tier);
  const amountRaw = (process.env[keys.amount] ?? "").trim();
  if (amountRaw.length === 0) return null;
  const amountMinor = Number(amountRaw);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  const currency = (process.env[keys.currency] ?? "USD").trim().toUpperCase();
  const intervalRaw = (process.env[keys.interval] ?? "year").trim().toLowerCase();
  const interval: "year" | "month" = intervalRaw === "month" ? "month" : "year";
  return { amountMinor, currency, interval };
}

/** Stable identifier for the tier's price block (used as DB price_id alias). */
export function priceIdForTier(tier: CollectiveTier): string | null {
  const cfg = priceConfigForTier(tier);
  if (!cfg) return null;
  // Airwallex doesn't ship Stripe-style price ids — synthesize a stable id
  // from the tier + amount + currency + interval so the DB column has a
  // predictable, gateway-agnostic value.
  return `awx_${tier}_${cfg.amountMinor}_${cfg.currency.toLowerCase()}_${cfg.interval}`;
}

/* ============================================================
 * Gateway readiness probes
 * ============================================================ */

/** Is Airwallex configured at all? Requires API_KEY + CLIENT_ID. */
export function airwallexSecretConfigured(): boolean {
  return (
    !!(process.env.AIRWALLEX_API_KEY ?? "").trim() &&
    !!(process.env.AIRWALLEX_CLIENT_ID ?? "").trim()
  );
}

/** Is the webhook secret configured? */
export function airwallexWebhookSecretConfigured(): boolean {
  return !!(process.env.AIRWALLEX_WEBHOOK_SECRET ?? "").trim();
}

/** Operating mode: "stub" | "test" | "live" | "unconfigured". */
export function airwallexCollectiveMode():
  | "stub"
  | "test"
  | "live"
  | "unconfigured" {
  if (!airwallexSecretConfigured()) return "unconfigured";
  return getAirwallexMode();
}

/* ============================================================
 * Payment intent helpers (gateway-agnostic surface)
 * ============================================================ */

export interface CreateCollectiveIntentInput {
  billingId: string;            // our internal billing row id (idempotency key)
  userId: string;
  chapterId: string;
  tier: CollectiveTier;
  customerEmail?: string;
  /** Optional one-time override for the per-tier env amount (e.g. proration). */
  amountMinorOverride?: number;
  /**
   * v25.21 Lane A NC-002 fix — caller-supplied deterministic idempotency anchor.
   * Renewal worker passes the billing cycle's `current_period_end` so a
   * worker restart cannot mint a second charge against the same cycle.
   * If omitted, the legacy time-based key is used (preserves prior behaviour
   * for one-off checkout flows where each intent IS supposed to be unique).
   */
  idempotencyAnchor?: string;
}

/**
 * Create an Airwallex payment intent for a Collective tier purchase.
 *
 * Returns the intent and a `hostedPaymentPageUrl` the client can redirect
 * to. The intent's `merchant_order_id` is the billing row id, so the
 * webhook handler can route the success/failure event back to the right
 * row.
 */
export async function createCollectiveIntent(
  input: CreateCollectiveIntentInput,
): Promise<{
  ok: true;
  intent: AirwallexPaymentIntent;
  hostedPaymentPageUrl: string | null;
} | { ok: false; error: string; message?: string }> {
  const cfg = priceConfigForTier(input.tier);
  if (!cfg) return { ok: false, error: "tier_not_configured" };

  const amountMinor = input.amountMinorOverride ?? cfg.amountMinor;
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: "invalid_amount" };
  }

  try {
    const intent = await awCreatePaymentIntent({
      amountMinor,
      currency: cfg.currency,
      merchantOrderId: input.billingId,
      description: `Capavate Collective — ${input.tier} (${cfg.interval})`,
      metadata: {
        product: "collective_membership",
        billingId: input.billingId,
        userId: input.userId,
        chapterId: input.chapterId,
        tier: input.tier,
        interval: cfg.interval,
      },
      // v25.21 Lane A NC-002 fix — use the caller-supplied anchor when present
      // (renewal worker passes the cycle's `current_period_end`) so Airwallex's
      // 24h duplicate-rejection window can actually fire. The legacy
      // `Date.now()` fallback only runs for one-off checkout flows that
      // genuinely need a unique key per click.
      idempotencyKey: input.idempotencyAnchor
        ? `collective_${input.billingId}_${input.idempotencyAnchor}`
        : `collective_${input.billingId}_${Date.now()}`,
    });

    // Airwallex hosted payment page URL pattern: next_action.url is set on
    // intents that require redirect; client_secret is set on intents
    // confirmed via Drop-in.
    const hostedPaymentPageUrl =
      intent.next_action?.url ??
      (intent.client_secret
        ? `/collective/membership/pay?intent=${intent.id}&secret=${intent.client_secret}`
        : null);

    return { ok: true, intent, hostedPaymentPageUrl };
  } catch (err) {
    if (err instanceof AirwallexNotConfiguredError) {
      return { ok: false, error: "airwallex_not_configured" };
    }
    log.warn(
      "[airwallexCollective.createCollectiveIntent] gateway error:",
      (err as Error).message,
    );
    return {
      ok: false,
      error: "airwallex_intent_failed",
      message: (err as Error).message,
    };
  }
}

/** Retrieve an Airwallex intent — used by the success-redirect verifier. */
export async function retrieveCollectiveIntent(
  intentId: string,
): Promise<AirwallexPaymentIntent | null> {
  try {
    return await awRetrievePaymentIntent(intentId);
  } catch (err) {
    if (err instanceof AirwallexNotConfiguredError) return null;
    log.warn(
      "[airwallexCollective.retrieveCollectiveIntent] gateway error:",
      (err as Error).message,
    );
    return null;
  }
}

/** Refund a previously charged Collective subscription cycle. */
export async function refundCollectiveCycle(
  paymentIntentId: string,
  amountMinor: number,
  reason: string,
): Promise<{ ok: true; refundId: string } | { ok: false; error: string }> {
  try {
    const refund = await awRefundPayment({
      paymentIntentId,
      amountMinor,
      reason,
    });
    return { ok: true, refundId: refund.id };
  } catch (err) {
    if (err instanceof AirwallexNotConfiguredError) {
      return { ok: false, error: "airwallex_not_configured" };
    }
    log.warn(
      "[airwallexCollective.refundCollectiveCycle] gateway error:",
      (err as Error).message,
    );
    return { ok: false, error: "airwallex_refund_failed" };
  }
}

/* ============================================================
 * Compatibility shim — preserve prior stripeCollective.ts API
 *
 * collectiveBillingStore.ts imports a handful of helpers from the old
 * module. Rather than touching every call site, re-export the equivalents
 * here under the old names so the rewrite stays surgical.
 * ============================================================ */

/** Compatibility alias — same shape as stripeSecretConfigured(). */
export const stripeSecretConfigured = airwallexSecretConfigured;
/** Compatibility alias — same shape as stripeWebhookSecretConfigured(). */
export const stripeWebhookSecretConfigured = airwallexWebhookSecretConfigured;
/** Compatibility alias — same shape as stripeMode(). */
export const stripeMode = airwallexCollectiveMode;

/** Gateway id the collective billing module is currently using. */
export function getCollectiveBillingGatewayId(): "airwallex" | "stripe" {
  // Always airwallex for the v25.4+ stack. The constant is exported so
  // tests + diagnostics can assert it.
  void getDefaultGatewayId;
  return "airwallex";
}
