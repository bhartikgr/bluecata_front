/**
 * server/lib/wave190PaymentGatewayDisclosure.ts
 *
 * WAVE 190 · ITEM D · R157.2 — "LIVE" WAS A LABEL, NOT A FACT.
 *
 * THE DEFECT THIS MODULE EXISTS TO CLOSE. `/admin/fees` → Payment Gateway shows
 * Name **AirWallex** and Mode **LIVE**, and there are real succeeded charges. But
 * that "LIVE" is a static string on a screen: nothing anywhere in the platform
 * checked whether the gateway's variables were actually present, and the same
 * panel simultaneously said "No webhook events yet" — an ambiguous sentence that
 * could equally mean "none have arrived", "we never listened" or "we did not
 * look". The owner reported the gateway unset FOUR TIMES, each time reading
 * `bridgeEnvOk` from `/api/healthz`, which contains no Airwallex field at all.
 * Four wrong reports is not carelessness; it is a platform with no truth surface
 * for one of its own integrations.
 *
 * WHAT THIS IS. A PRESENCE-ONLY disclosure, modelled directly on
 * `server/lib/wave15BridgeMode.ts` — the pattern R157.4 names as the one to copy,
 * shipped at `/admin/platform-surfaces` → Bridge mode. Variable NAMES and
 * present/absent booleans, the real mode from the resolver rather than a literal,
 * and the webhook-receipt history read from actual rows with timestamps.
 *
 * ══ NO CREDENTIAL VALUE LEAVES THIS MODULE. EVER. ══
 * `present` is computed as a boolean from `process.env[name]` and the value is
 * discarded in the same expression. No value is returned, logged, echoed into an
 * error, included in a length, hinted at by a prefix or suffix, or reflected in
 * any field of the returned object. Nothing here reads a value into a variable
 * that outlives the boolean. That is asserted by test, including an assertion
 * that no credential value appears anywhere in the serialized response body.
 *
 * ══ READ-ONLY. NOTHING ABOUT PAYMENTS CHANGES. ══
 * This module SETS no environment variable, writes no row, makes no network call
 * and creates no charge. `getAirwallexMode()` lives in
 * `server/lib/paymentGatewayResolver.ts`, which is SACRED — it is CALLED, never
 * edited, and it is the authority on the mode precisely so this surface cannot
 * invent a second answer. `server/paymentGatewayAdapter.ts` is likewise untouched.
 * A truth surface that changed the truth would be worse than no surface.
 *
 * MONEY. This module reports no amount, no fee, no price and no currency. It
 * performs no arithmetic and calls no numeric coercion. The one number it
 * produces is a COUNT OF ROWS, which is not money.
 */
import { rawDb } from "../db/connection";
import { getAirwallexMode, resolveActiveGateway } from "./paymentGatewayResolver";
import { log } from "./logger";

/**
 * THE VARIABLES THAT CONFIGURE THE GATEWAY, by name.
 *
 * Taken from the two modules that actually consume them —
 * `server/lib/paymentGatewayResolver.ts` (documented env block) and
 * `server/lib/airwallexCollective.ts` — so this list cannot drift from what the
 * code reads. Names only; a name is not a secret, and an operator who cannot see
 * which variables exist cannot tell a deliberate stub from a broken deployment.
 *
 * `required` distinguishes "the gateway cannot work without this" from "this has
 * a documented default", so an absent optional variable is not reported as a
 * fault. It does NOT gate anything: this module refuses nothing and enables
 * nothing.
 */
export const PAYMENT_GATEWAY_INPUTS: readonly { name: string; required: boolean }[] =
  Object.freeze([
    Object.freeze({ name: "AIRWALLEX_API_KEY", required: true }),
    Object.freeze({ name: "AIRWALLEX_CLIENT_ID", required: true }),
    Object.freeze({ name: "AIRWALLEX_WEBHOOK_SECRET", required: true }),
    Object.freeze({ name: "AIRWALLEX_MODE", required: false }),
    Object.freeze({ name: "AIRWALLEX_API_BASE", required: false }),
    Object.freeze({ name: "PAYMENT_GATEWAY_DEFAULT", required: false }),
  ]);

/** Presence only — see the header. `value` is not a field of this type, and must
 *  never become one. */
export interface PaymentGatewayInputPresence {
  name: string;
  present: boolean;
  required: boolean;
}

/**
 * THE WEBHOOK-RECEIPT FACT, WITH TIMESTAMPS.
 *
 * R157.2 item 3: "No webhook events yet" must become a fact rather than an
 * ambiguous string. `everReceived` answers whether ANY event has ever arrived,
 * and `firstAt` / `lastAt` say when — so an operator can tell "the listener has
 * never once been reached" from "it worked until three weeks ago", which is the
 * distinction that sentence was hiding.
 *
 * `readable` is false when the table could not be read at all. That is a THIRD
 * state and it is kept distinct on purpose: reporting an unreadable table as
 * "no events" would be exactly the false reassurance this item exists to remove.
 */
export interface PaymentGatewayWebhookHistory {
  readable: boolean;
  everReceived: boolean;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface PaymentGatewayDisclosure {
  /** The gateway id the platform routes through, from the sacred resolver. */
  gateway: string;
  /** The REAL mode from `getAirwallexMode()` — never a hardcoded label. */
  mode: string;
  /** Per-variable presence. Values are NEVER returned, only presence. */
  inputs: PaymentGatewayInputPresence[];
  /** Required variables that are absent. Empty when all required are present. */
  missingRequired: string[];
  /** True when every REQUIRED variable is present. */
  allRequiredPresent: boolean;
  /** Webhook receipt history, from rows. */
  webhooks: PaymentGatewayWebhookHistory;
}

/**
 * Presence of one variable. The value is read and reduced to a boolean inside
 * this expression and is never bound to anything that survives it.
 *
 * A variable set to whitespace counts as ABSENT: an operator who exported an
 * empty string has not configured a gateway, and reporting it present would be
 * the same false reassurance in a smaller costume.
 */
function envPresent(name: string): boolean {
  return !!(process.env[name] && String(process.env[name]).trim().length > 0);
}

function readWebhookHistory(): PaymentGatewayWebhookHistory {
  try {
    const row = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n, MIN(received_at) AS first_at, MAX(received_at) AS last_at
           FROM payment_webhook_events`,
      )
      .get() as { n?: number; first_at?: string | null; last_at?: string | null } | undefined;
    /* `COUNT(*)` from SQLite is already an integer and is used only as a count of
       rows — never as money — so there is no boundary here for a float to enter
       through and nothing for `server/lib/money.ts` to own. */
    const count = typeof row?.n === "number" ? row.n : 0;
    return {
      readable: true,
      everReceived: count > 0,
      count,
      firstAt: count > 0 ? (row?.first_at ?? null) : null,
      lastAt: count > 0 ? (row?.last_at ?? null) : null,
    };
  } catch (err) {
    /* The error is logged as a WARNING with the error text only. The query
       contains no credential and the table holds no environment variable, so
       there is nothing here that could carry a secret into a log line. */
    log.warn(`[w190-gateway-disclosure] webhook history read failed: ${String(err)}`);
    return { readable: false, everReceived: false, count: 0, firstAt: null, lastAt: null };
  }
}

/**
 * THE WHOLE DISCLOSURE. Reads environment presence and one aggregate row; writes
 * nothing, sets nothing, calls no gateway.
 */
export function paymentGatewayDisclosure(): PaymentGatewayDisclosure {
  const inputs: PaymentGatewayInputPresence[] = PAYMENT_GATEWAY_INPUTS.map((spec) => ({
    name: spec.name,
    /* Presence only. A credential must not leave the process because an admin
       screen wanted to explain a configuration. */
    present: envPresent(spec.name),
    required: spec.required,
  }));
  const missingRequired = inputs.filter((i) => i.required && !i.present).map((i) => i.name);

  /* THE MODE COMES FROM THE SACRED RESOLVER, NOT FROM THIS FILE. That is the
     entire point of the item: the screen said "LIVE" because a component printed
     the word, not because anything asked. Both calls are wrapped because a truth
     surface that throws tells an operator less than one that reports "unknown". */
  let mode = "unknown";
  try {
    mode = String(getAirwallexMode());
  } catch (err) {
    log.warn(`[w190-gateway-disclosure] mode read failed: ${String(err)}`);
  }

  let gateway = "unknown";
  try {
    gateway = String(resolveActiveGateway());
  } catch (err) {
    log.warn(`[w190-gateway-disclosure] gateway read failed: ${String(err)}`);
  }

  return {
    gateway,
    mode,
    inputs,
    missingRequired,
    allRequiredPresent: missingRequired.length === 0,
    webhooks: readWebhookHistory(),
  };
}
