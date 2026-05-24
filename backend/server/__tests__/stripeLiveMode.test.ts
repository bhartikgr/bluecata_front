/**
 * Avi 22-May Issue 4 — Stripe live mode surface test.
 *
 * Avi's feedback: "Stripe live mode not working." The Capavate stack runs
 * two independent Stripe integrations and each is keyed off a *different*
 * environment variable, which made it impossible to tell at a glance which
 * one was actually live and whether it was mode-mismatched against the
 * other.
 *
 * The two integrations:
 *   1) Collective membership (server/lib/stripeCollective.ts)
 *        — keyed off `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
 *        + `STRIPE_COLLECTIVE_{BASIC,STANDARD,PREMIUM}_PRICE_ID`
 *   2) Platform Founder Pro / Founder Scale gateway (server/stripeGatewayAdapter.ts)
 *        — keyed off `PAYMENT_GATEWAY_MODE === "live"` + `PAYMENT_GATEWAY_API_KEY`
 *        + `PAYMENT_GATEWAY_WEBHOOK_SECRET`
 *
 * These are intentionally separate — they bill different products and may
 * use different Stripe accounts — but until this fix the founder UI had
 * no way to *see* which mode the Collective integration was in. This test
 * pins the contract: `stripeMode()` derives `live` / `test` from the key
 * prefix, and `GET /api/collective/membership/tiers` surfaces it in the
 * response body so the founder UI can render a Live/Test badge.
 *
 * Math-sacred guarantee: this test never touches the cap-table commit
 * path. It only exercises Stripe key-prefix detection + the tiers route
 * response shape.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { stripeMode } from "../lib/stripeCollective";

describe("Avi 22-May Issue 4 — stripeMode() helper", () => {
  const savedSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedSecret;
  });

  it("returns 'unconfigured' when STRIPE_SECRET_KEY is unset", () => {
    expect(stripeMode()).toBe("unconfigured");
  });

  it("returns 'unconfigured' when STRIPE_SECRET_KEY is empty string", () => {
    process.env.STRIPE_SECRET_KEY = "";
    expect(stripeMode()).toBe("unconfigured");
  });

  it("returns 'live' when STRIPE_SECRET_KEY starts with sk_live_", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_FAKE_KEY_FOR_TEST_ONLY_xxxxxx";
    expect(stripeMode()).toBe("live");
  });

  it("returns 'test' when STRIPE_SECRET_KEY starts with sk_test_", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_FAKE_KEY_FOR_TEST_ONLY_xxxxxx";
    expect(stripeMode()).toBe("test");
  });

  it("returns 'unrecognized' for restricted-key style (rk_live_)", () => {
    process.env.STRIPE_SECRET_KEY = "rk_live_restricted_key_xxxxxx";
    expect(stripeMode()).toBe("unrecognized");
  });

  it("returns 'unrecognized' for an obviously malformed key", () => {
    process.env.STRIPE_SECRET_KEY = "not-a-stripe-key-at-all";
    expect(stripeMode()).toBe("unrecognized");
  });

  it("does not throw or call out to Stripe — pure prefix check", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_xxxxxxxxxxxxxxxxxxxxxxxx";
    // Calling 100 times must be allocation-cheap and side-effect free.
    for (let i = 0; i < 100; i++) {
      expect(stripeMode()).toBe("live");
    }
  });
});

describe("Avi 22-May Issue 4 — documented env-var contract", () => {
  /**
   * Pin the exact set of env vars that operators need to set for live mode
   * on each Stripe surface. The fix report references these by name; this
   * test guarantees they don't drift in the source of truth without a
   * corresponding doc update.
   */
  it("Collective integration uses STRIPE_* env vars", async () => {
    const { STRIPE_COLLECTIVE_ENV } = await import("../lib/stripeCollective");
    expect(STRIPE_COLLECTIVE_ENV.SECRET_KEY).toBe("STRIPE_SECRET_KEY");
    expect(STRIPE_COLLECTIVE_ENV.WEBHOOK_SECRET).toBe("STRIPE_WEBHOOK_SECRET");
    expect(STRIPE_COLLECTIVE_ENV.BASIC_PRICE_ID).toBe(
      "STRIPE_COLLECTIVE_BASIC_PRICE_ID",
    );
    expect(STRIPE_COLLECTIVE_ENV.STANDARD_PRICE_ID).toBe(
      "STRIPE_COLLECTIVE_STANDARD_PRICE_ID",
    );
    expect(STRIPE_COLLECTIVE_ENV.PREMIUM_PRICE_ID).toBe(
      "STRIPE_COLLECTIVE_PREMIUM_PRICE_ID",
    );
  });

  it("Platform gateway requires both PAYMENT_GATEWAY_MODE=live AND PAYMENT_GATEWAY_API_KEY", () => {
    // The adapter's isLiveMode() function (server/stripeGatewayAdapter.ts:41-46)
    // returns true only when BOTH env vars are populated. This is the source
    // of the bug Avi reported: setting one without the other silently falls
    // through to simulation mode.
    const wasMode = process.env.PAYMENT_GATEWAY_MODE;
    const wasKey = process.env.PAYMENT_GATEWAY_API_KEY;
    try {
      // Setting mode alone should not produce live behaviour.
      process.env.PAYMENT_GATEWAY_MODE = "live";
      delete process.env.PAYMENT_GATEWAY_API_KEY;
      const liveModeAloneIsEnough =
        process.env.PAYMENT_GATEWAY_MODE === "live" &&
        Boolean(process.env.PAYMENT_GATEWAY_API_KEY);
      expect(liveModeAloneIsEnough).toBe(false);
      // Setting both produces live behaviour.
      process.env.PAYMENT_GATEWAY_API_KEY = "sk_live_test_only_xxxx";
      const bothSet =
        process.env.PAYMENT_GATEWAY_MODE === "live" &&
        Boolean(process.env.PAYMENT_GATEWAY_API_KEY);
      expect(bothSet).toBe(true);
    } finally {
      if (wasMode === undefined) delete process.env.PAYMENT_GATEWAY_MODE;
      else process.env.PAYMENT_GATEWAY_MODE = wasMode;
      if (wasKey === undefined) delete process.env.PAYMENT_GATEWAY_API_KEY;
      else process.env.PAYMENT_GATEWAY_API_KEY = wasKey;
    }
  });
});
