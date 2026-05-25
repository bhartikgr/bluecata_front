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

export type GatewayId = "airwallex" | "stripe";

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
      apiBase: process.env.AIRWALLEX_API_BASE ?? "https://api.airwallex.com",
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
  return [
    {
      id: "airwallex",
      label: "AirWallex",
      isDefault: def === "airwallex",
      ready: isGatewayReady("airwallex"),
      mode,
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
