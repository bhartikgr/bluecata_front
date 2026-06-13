/**
 * server/lib/stripeCollective.ts — v18 Phase B.
 *
 * Thin wrapper around the Stripe SDK for the Collective membership product.
 * The platform Founder Pro / Founder Scale subscription is a SEPARATE Stripe
 * product (handled by server/stripeGatewayAdapter.ts off PAYMENT_GATEWAY_*).
 * This module is keyed off STRIPE_SECRET_KEY + the per-tier price ids.
 *
 * Quality contract (per V19_BUILD_BRIEF.md §11 + v18 Phase B spec):
 *   - Lazy-load the Stripe SDK ONLY when STRIPE_SECRET_KEY is set. Never
 *     crash on missing keys. When unset, `getStripeClient()` returns null
 *     and callers translate that to a 503 stripe_not_configured response.
 *   - All three per-tier env vars are independent. If only BASIC is set,
 *     STANDARD + PREMIUM tier endpoints return 503 for those tiers but
 *     BASIC purchases still work.
 *   - Test mode: `__setStripeClientForTesting(mock)` replaces the lazy
 *     singleton with a mock. Used by collectiveBilling.test.ts to avoid
 *     ever hitting the real Stripe API.
 *
 * No mock data, no TODOs, no stubs. Every code path either executes a real
 * Stripe SDK call or returns a clear error structure the caller surfaces.
 */

import { log } from "./logger";
export type CollectiveTier = "basic" | "standard" | "premium";

/** Env var names \u2014 source of truth so tests + docs can reference them. */
export const STRIPE_COLLECTIVE_ENV = {
  SECRET_KEY: "STRIPE_SECRET_KEY",
  WEBHOOK_SECRET: "STRIPE_WEBHOOK_SECRET",
  BASIC_PRICE_ID: "STRIPE_COLLECTIVE_BASIC_PRICE_ID",
  STANDARD_PRICE_ID: "STRIPE_COLLECTIVE_STANDARD_PRICE_ID",
  PREMIUM_PRICE_ID: "STRIPE_COLLECTIVE_PREMIUM_PRICE_ID",
} as const;

/** Tier metadata \u2014 what each tier costs in entitlements (NOT in dollars; */
/* Avi sets dollar amounts on the Stripe Dashboard via the price ids). */
export interface TierDescriptor {
  tier: CollectiveTier;
  label: string;
  blurb: string;
  /** Entitlements (Boolean capabilities) granted by this tier. */
  entitlements: string[];
  /** Membership-store role this tier maps to on activation. */
  membershipRole: "member" | "dsc_member" | "chapter_admin";
}

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

/** Map a tier name \u2192 the env var holding its Stripe price id. */
export function envVarForTier(tier: CollectiveTier): string {
  switch (tier) {
    case "basic":
      return STRIPE_COLLECTIVE_ENV.BASIC_PRICE_ID;
    case "standard":
      return STRIPE_COLLECTIVE_ENV.STANDARD_PRICE_ID;
    case "premium":
      return STRIPE_COLLECTIVE_ENV.PREMIUM_PRICE_ID;
  }
}

/** Read the price id for a tier from process.env, or null when unset. */
export function priceIdForTier(tier: CollectiveTier): string | null {
  const v = process.env[envVarForTier(tier)];
  return v && v.length > 0 ? v : null;
}

/** Is Stripe configured at all? (Webhook + checkout require SECRET_KEY.) */
export function stripeSecretConfigured(): boolean {
  const v = process.env[STRIPE_COLLECTIVE_ENV.SECRET_KEY];
  return typeof v === "string" && v.length > 0;
}

/** Is the webhook secret configured? */
export function stripeWebhookSecretConfigured(): boolean {
  const v = process.env[STRIPE_COLLECTIVE_ENV.WEBHOOK_SECRET];
  return typeof v === "string" && v.length > 0;
}

/**
 * Avi 22-May Issue 4 — derive the Stripe operating mode from the secret key
 * prefix. Stripe enforces this convention universally: live keys start with
 * `sk_live_`, test keys with `sk_test_`. Returning the mode in API responses
 * lets the founder UI surface a clear "Live" / "Test" badge so it's never
 * ambiguous which set of credentials are wired.
 *
 * Returns:
 *   - "live"          — SECRET_KEY is set and starts with `sk_live_`
 *   - "test"          — SECRET_KEY is set and starts with `sk_test_`
 *   - "unrecognized"  — SECRET_KEY is set but doesn't match either prefix
 *                       (e.g. a restricted key `rk_*` or a malformed value)
 *   - "unconfigured"  — SECRET_KEY is unset
 */
export type StripeMode = "live" | "test" | "unrecognized" | "unconfigured";
export function stripeMode(): StripeMode {
  const v = process.env[STRIPE_COLLECTIVE_ENV.SECRET_KEY];
  if (typeof v !== "string" || v.length === 0) return "unconfigured";
  if (v.startsWith("sk_live_")) return "live";
  if (v.startsWith("sk_test_")) return "test";
  return "unrecognized";
}

/* ============================================================
 * Lazy SDK singleton + test injection point
 * ============================================================ */

// Minimal structural type so the rest of the codebase doesn't need to
// take a hard dependency on Stripe's huge .d.ts surface. The real SDK
// satisfies this shape; tests pass a mock with the same methods used.
export interface StripeClientLike {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{
        id: string;
        url: string | null;
        customer?: string | null;
      }>;
    };
  };
  billingPortal: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{
        id: string;
        url: string;
      }>;
    };
  };
  prices: {
    retrieve: (id: string) => Promise<{
      id: string;
      unit_amount: number | null;
      currency: string;
      recurring?: { interval?: string } | null;
      nickname?: string | null;
    }>;
  };
  webhooks: {
    constructEvent: (
      payload: string | Buffer,
      sig: string,
      secret: string,
    ) => { id: string; type: string; data: { object: unknown } };
  };
}

let _client: StripeClientLike | null = null;
let _clientResolved = false; // distinguishes "never resolved" from "resolved to null".

/**
 * Resolve the Stripe SDK client. Returns null when:
 *   - STRIPE_SECRET_KEY is unset, OR
 *   - the `stripe` package fails to require (env without the dep installed).
 *
 * Memoised: subsequent calls return the same instance.
 */
export function getStripeClient(): StripeClientLike | null {
  if (_clientResolved) return _client;
  _clientResolved = true;

  if (!stripeSecretConfigured()) {
    _client = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require("stripe");
    _client = new Stripe(process.env[STRIPE_COLLECTIVE_ENV.SECRET_KEY]!, {
      apiVersion: "2024-04-10",
      // Avi's account preference; opt-out is the safe default for v18B.
      typescript: true,
    }) as StripeClientLike;
    return _client;
  } catch (err) {
    // SDK not installed in this environment \u2014 the platform Stripe
    // adapter is already declared as a dep, so this path should rarely
    // fire. Returning null causes endpoints to gracefully 503.
    log.error(
      "[stripeCollective] Stripe SDK init failed; serving 503:",
      (err as Error)?.message ?? err,
    );
    _client = null;
    return null;
  }
}

/**
 * Test-only: replace the lazy singleton with a mock so tests never hit
 * the real Stripe API. Pair with `__resetStripeClient()` in afterAll.
 */
export function __setStripeClientForTesting(
  mock: StripeClientLike | null,
): void {
  _client = mock;
  _clientResolved = true;
}

/** Test-only: drop the cached instance so the next call re-resolves. */
export function __resetStripeClient(): void {
  _client = null;
  _clientResolved = false;
}
