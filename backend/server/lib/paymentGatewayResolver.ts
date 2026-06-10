/**
 * v19 Wave A / Change 3 — Payment gateway resolver.
 *
 * Selects the active payment gateway based on `PAYMENT_GATEWAY_DEFAULT` env
 * var. Default is "airwallex" per founder directive (Ozan, 24-May-2026 — see
 * V19_BUILD_BRIEF Change 3). Stripe is supported alongside as a fallback /
 * dual-gateway option.
 *
 * Design constraints (per brief):
 *   • DO NOT touch `server/collectiveBillingStore.ts` — that path stays Stripe
 *     until a follow-up release.
 *   • Math-sacred zones are untouched.
 *   • Existing `server/paymentGatewayAdapter.ts` flows continue to work — the
 *     resolver is an additive layer that future call sites can opt into.
 *
 * Env vars consumed:
 *   PAYMENT_GATEWAY_DEFAULT  default gateway id (airwallex | stripe). Default: "airwallex"
 *   AIRWALLEX_API_KEY        api key for AirWallex
 *   AIRWALLEX_CLIENT_ID      client id for AirWallex
 *   AIRWALLEX_WEBHOOK_SECRET HMAC secret for webhook signature verification
 *   AIRWALLEX_API_BASE       optional API base URL (default https://api.airwallex.com)
 *   STRIPE_SECRET_KEY        api key for Stripe (optional)
 *   STRIPE_WEBHOOK_SECRET    Stripe webhook signing secret (optional)
 */

import { log } from "./logger";

export type GatewayId = "airwallex" | "stripe";

/**
 * v24.4 Bug A — Airwallex operating mode.
 *   stub → no network; deterministic stub responses (hermetic tests/dev).
 *   test → REAL network call against the Airwallex DEMO base URL
 *           (https://api-demo.airwallex.com).
 *   live → REAL network call against PRODUCTION (https://api.airwallex.com).
 */
export type AirwallexMode = "stub" | "test" | "live";

export const AIRWALLEX_DEMO_API_BASE = "https://api-demo.airwallex.com";
export const AIRWALLEX_LIVE_API_BASE = "https://api.airwallex.com";

/**
 * Resolve the Airwallex operating mode from env, per Avi's explicit directive:
 * "make it always test mode until tested fully".
 *
 * Precedence:
 *   1. AIRWALLEX_MODE (stub|test|live) — explicit wins.
 *      `live` only takes effect when AIRWALLEX_API_KEY is also present;
 *      otherwise we fall back to stub (never silently hit production without a key).
 *   2. Legacy AIRWALLEX_REAL_NETWORK=1 (deprecated) — maps to `test`
 *      (real network against demo) for backward compatibility; a warning is
 *      logged once in getAirwallexMode().
 *   3. Default: `stub` (no network). Per Avi's "test mode until tested fully",
 *      stub is the safe no-network default — a real network call is only made
 *      when explicitly opted in via AIRWALLEX_MODE=test|live or the legacy
 *      AIRWALLEX_REAL_NETWORK=1. This also preserves the hermetic-test contract
 *      (key present + no explicit mode → deterministic stub responses).
 */
let _warnedRealNetworkDeprecated = false;
export function getAirwallexMode(): AirwallexMode {
  const hasKey = Boolean((process.env.AIRWALLEX_API_KEY ?? "").trim());
  const raw = (process.env.AIRWALLEX_MODE ?? "").trim().toLowerCase();

  if (raw === "stub") return "stub";
  if (raw === "test") return "test";
  if (raw === "live") {
    // Never go live without a key.
    return hasKey ? "live" : "stub";
  }

  // Legacy / deprecated flag.
  if ((process.env.AIRWALLEX_REAL_NETWORK ?? "") === "1") {
    if (!_warnedRealNetworkDeprecated) {
      _warnedRealNetworkDeprecated = true;
      log.warn(
        "[airwallex] AIRWALLEX_REAL_NETWORK=1 is deprecated; use AIRWALLEX_MODE=test|live instead. Treating as test (demo network).",
      );
    }
    return "test";
  }

  // Default: stub (no network) — even when a key is present. A real network
  // call requires explicit opt-in (AIRWALLEX_MODE or legacy REAL_NETWORK).
  return "stub";
}

/** Resolve the Airwallex API base URL implied by the current mode. */
export function getAirwallexApiBase(): string {
  // Explicit override wins regardless of mode.
  const override = (process.env.AIRWALLEX_API_BASE ?? "").trim();
  if (override) return override;
  const mode = getAirwallexMode();
  if (mode === "live") return AIRWALLEX_LIVE_API_BASE;
  // stub + test both surface the demo base URL (stub does not call it).
  return AIRWALLEX_DEMO_API_BASE;
}

export interface GatewayCredentials {
  airwallex: {
    apiKey: string | null;
    clientId: string | null;
    webhookSecret: string | null;
    apiBase: string;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
  };
}

/**
 * Reads the default gateway id from env. Returns "airwallex" when unset or
 * unrecognised — this is the v19 default per founder directive.
 */
export function getDefaultGatewayId(): GatewayId {
  const raw = (process.env.PAYMENT_GATEWAY_DEFAULT ?? "").trim().toLowerCase();
  if (raw === "stripe") return "stripe";
  // "airwallex", "" (unset), or anything else → airwallex.
  return "airwallex";
}

/** Returns the configured credentials for both gateways (nullable if unset). */
export function getGatewayCredentials(): GatewayCredentials {
  return {
    airwallex: {
      apiKey: process.env.AIRWALLEX_API_KEY ?? null,
      clientId: process.env.AIRWALLEX_CLIENT_ID ?? null,
      webhookSecret: process.env.AIRWALLEX_WEBHOOK_SECRET ?? null,
      apiBase: getAirwallexApiBase(),
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY ?? null,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
    },
  };
}

/**
 * Per-gateway readiness probe. A gateway is "ready" if its required creds are
 * present. Used by `/api/admin/payment-gateway/config` to display setup state.
 */
export function isGatewayReady(id: GatewayId): boolean {
  const creds = getGatewayCredentials();
  if (id === "airwallex") {
    return Boolean(creds.airwallex.apiKey && creds.airwallex.clientId);
  }
  // stripe
  return Boolean(creds.stripe.secretKey);
}

/**
 * Returns the gateway that should serve the next charge. Falls back to the
 * other gateway if the default is unconfigured. If neither is configured we
 * still return the default — call sites that need a real charge will then
 * surface a "not_configured" error rather than silently dropping payments.
 */
export function resolveActiveGateway(): GatewayId {
  const def = getDefaultGatewayId();
  if (isGatewayReady(def)) return def;
  const other: GatewayId = def === "airwallex" ? "stripe" : "airwallex";
  if (isGatewayReady(other)) return other;
  return def;
}

/**
 * Maps an inbound webhook source (URL path or header) to a GatewayId.
 */
export function webhookSourceToGateway(source: string): GatewayId | null {
  const s = source.toLowerCase();
  if (s.includes("airwallex")) return "airwallex";
  if (s.includes("stripe")) return "stripe";
  return null;
}

/**
 * Public-facing gateway config for the admin Payment Gateway tab.
 * Surfaces id, mode (test/live), readiness, and webhook path.
 */
export interface PublicGatewayConfigEntry {
  id: GatewayId;
  label: string;
  isDefault: boolean;
  ready: boolean;
  mode: "test" | "live";
  webhookPath: string;
  supportedMethods: string[];
}

export function listPublicGatewayConfig(): PublicGatewayConfigEntry[] {
  const def = getDefaultGatewayId();
  const mode: "test" | "live" = process.env.NODE_ENV === "production" ? "live" : "test";
  // v24.4 Bug A — Airwallex surfaces its true operating mode (stub/test/live).
  const awMode = getAirwallexMode();
  const awPublicMode: "test" | "live" = awMode === "live" ? "live" : "test";
  return [
    {
      id: "airwallex",
      label: "AirWallex",
      isDefault: def === "airwallex",
      ready: isGatewayReady("airwallex"),
      mode: awPublicMode,
      webhookPath: "/api/webhooks/payment-gateway/airwallex",
      supportedMethods: ["card", "wechat_pay", "alipay", "bank_transfer"],
    },
    {
      id: "stripe",
      label: "Stripe",
      isDefault: def === "stripe",
      ready: isGatewayReady("stripe"),
      mode,
      webhookPath: "/api/webhooks/payment-gateway/stripe",
      supportedMethods: ["card", "sepa", "ach"],
    },
  ];
}
