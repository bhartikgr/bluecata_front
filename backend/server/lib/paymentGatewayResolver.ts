/**
 * v19 Wave A / Change 3 — Payment gateway resolver.
 *
 * Selects the active payment gateway based on `PAYMENT_GATEWAY_DEFAULT` env
 * var. Default is "airwallex" per founder directive (Ozan, 24-May-2026 — see
 * V19_BUILD_BRIEF Change 3).
 *
 * WAVE 97B (2026-08-21) — R86 · STRIPE REMOVED, THE SEAM KEPT.
 *   Owner, verbatim: "remove stripe. I can add this at a later date. We are
 *   using Airwallex today." Both halves are binding. This file is the SEAM the
 *   second half depends on, so nothing structural was collapsed: the resolver,
 *   the readiness probe, the webhook-source mapper, the credentials record and
 *   the public config list are all still parameterised BY GATEWAY ID. Only the
 *   `"stripe"` id, its credential block, its readiness branch, its webhook
 *   mapping and its public-config entry are gone — because Stripe is no longer
 *   reachable anywhere in the tree (its three modules were deleted in the same
 *   wave), and a union naming a gateway that does not exist is a dead variable,
 *   which the owner's standing rule forbids.
 *
 *   ADDING A GATEWAY BACK IS A PLUG-IN, NOT A REWRITE. Every plug point in this
 *   file is marked `EXTENSION POINT`. See build_log/wave97b/W97B_REMOVAL.md §5
 *   for the file-and-line recipe. No gateway-agnostic call site changes.
 *
 * Design constraints (per brief):
 *   • Math-sacred zones are untouched.
 *   • Existing `server/paymentGatewayAdapter.ts` flows continue to work — the
 *     resolver is an additive layer that future call sites can opt into.
 *   • `server/collectiveBillingStore.ts` routes through Airwallex end to end
 *     since v25.4 (11-Jun-2026, Ozan's directive).
 *
 * Env vars consumed:
 *   PAYMENT_GATEWAY_DEFAULT  default gateway id (airwallex). Default: "airwallex"
 *   AIRWALLEX_API_KEY        api key for AirWallex
 *   AIRWALLEX_CLIENT_ID      client id for AirWallex
 *   AIRWALLEX_WEBHOOK_SECRET HMAC secret for webhook signature verification
 *   AIRWALLEX_API_BASE       optional API base URL (default https://api.airwallex.com)
 */

import { log } from "./logger";

/**
 * The set of payment gateways this platform can route money through.
 *
 * WAVE 97B · R86 — narrowed from `"airwallex" | "stripe"` to `"airwallex"`
 * alone. Airwallex is the only gateway in use.
 *
 * EXTENSION POINT 1 of 6 — a second gateway plugs in HERE, and only here, as a
 * union member:
 *     export type GatewayId = "airwallex" | "newgateway";
 * Widening this one line re-activates every per-gateway branch downstream
 * (credentials, readiness, webhook mapping, public config) plus the already
 * parameterised `handleGatewayWebhook(gateway)` in
 * `server/paymentGatewayAdapter.ts`. Nothing gateway-agnostic changes.
 */
export type GatewayId = "airwallex";

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
  /* EXTENSION POINT 2 of 6 — a second gateway's credential block plugs in HERE,
   * e.g.  newgateway: { secretKey: string | null; webhookSecret: string | null };
   * WAVE 97B · R86 removed the `stripe: { secretKey, webhookSecret }` block. */
}

/**
 * Reads the default gateway id from env. Returns "airwallex" when unset or
 * unrecognised — this is the v19 default per founder directive.
 */
export function getDefaultGatewayId(): GatewayId {
  const raw = (process.env.PAYMENT_GATEWAY_DEFAULT ?? "").trim().toLowerCase();
  /* EXTENSION POINT 3 of 6 — a second gateway is selectable from HERE:
   *     if (raw === "newgateway") return "newgateway";
   * WAVE 97B · R86 removed `if (raw === "stripe") return "stripe";`. A stale
   * PAYMENT_GATEWAY_DEFAULT=stripe therefore now resolves to airwallex rather
   * than selecting a gateway that no longer exists — which is the fail-safe
   * direction: the founder directive of 24-May-2026 already makes Airwallex the
   * answer for unset and unrecognised values. */
  void raw;
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
    /* EXTENSION POINT 2b — read a second gateway's env vars HERE, mirroring the
     * airwallex block. WAVE 97B · R86 removed the `stripe:` reader
     * (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are no longer consumed). */
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
  /* EXTENSION POINT 4 of 6 — a second gateway's readiness probe plugs in HERE:
   *     if (id === "newgateway") return Boolean(creds.newgateway.secretKey);
   * WAVE 97B · R86 removed the `// stripe` fallthrough. Unknown ids are NOT
   * ready — fail closed, never fail open on a money path. */
  return false;
}

/**
 * Returns the gateway that should serve the next charge.
 *
 * If the default is unconfigured we still return it — call sites that need a
 * real charge then surface a "not_configured" error rather than silently
 * dropping payments. That behaviour is UNCHANGED.
 *
 * EXTENSION POINT 5 of 6 — when a second gateway exists, restore the
 * fall-back-to-the-other-gateway search HERE:
 *     for (const id of ALL_GATEWAY_IDS) if (isGatewayReady(id)) return id;
 * WAVE 97B · R86 removed the two-gateway `other` fallback because there is no
 * other gateway to fall back to; keeping it would have been a branch that can
 * never be taken.
 */
export function resolveActiveGateway(): GatewayId {
  const def = getDefaultGatewayId();
  if (isGatewayReady(def)) return def;
  return def;
}

/**
 * Maps an inbound webhook source (URL path or header) to a GatewayId.
 */
export function webhookSourceToGateway(source: string): GatewayId | null {
  const s = source.toLowerCase();
  if (s.includes("airwallex")) return "airwallex";
  /* EXTENSION POINT 6a — map a second gateway's inbound webhook path HERE:
   *     if (s.includes("newgateway")) return "newgateway";
   * WAVE 97B · R86 removed `if (s.includes("stripe")) return "stripe";`. An
   * inbound path containing "stripe" now maps to `null`, i.e. "unknown
   * gateway", which is the truthful answer now that no Stripe route is
   * mounted. */
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
  const entries: PublicGatewayConfigEntry[] = [
    {
      id: "airwallex",
      label: "AirWallex",
      isDefault: def === "airwallex",
      ready: isGatewayReady("airwallex"),
      mode: awPublicMode,
      webhookPath: "/api/webhooks/payment-gateway/airwallex",
      supportedMethods: ["card", "wechat_pay", "alipay", "bank_transfer"],
    },
    /* EXTENSION POINT 6 of 6 — a second gateway becomes visible to the admin
     * Payment Gateway tab by adding ONE entry HERE:
     *   {
     *     id: "newgateway", label: "New Gateway",
     *     isDefault: def === "newgateway",
     *     ready: isGatewayReady("newgateway"),
     *     mode,
     *     webhookPath: "/api/webhooks/payment-gateway/newgateway",
     *     supportedMethods: ["card"],
     *   }
     *
     * WAVE 97B · R86 removed the Stripe entry from this list. This is the
     * removal the owner's instruction names directly — it is what
     * `GET /api/admin/payment-gateway/config` (via
     * `server/paymentGatewayAdapter.ts` → `getPublicGatewayList()`) serves to
     * an administrator, and it offered Stripe as a selectable gateway for a
     * provider the platform does not use. Owner, 2026-08-21: "remove stripe.
     * I can add this at a later date. We are using Airwallex today."
     * It is allowlisted as a paired removal in
     * scripts/silent-drop-guard/allowlist.json (WAVE 97B entries). */
  ];
  void mode;
  return entries;
}
