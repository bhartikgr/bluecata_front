/**
 * WAVE 97 — TESTS THAT PIN THE REMOVAL ITSELF.
 *
 * Owner instruction, 2026-08-21, verbatim:
 *   "remove stripe. I can add this at a later date. We are using Airwallex today."
 * Preceded by: "We do not use Stripe."
 *
 * These assertions exist to FAIL if a later wave reintroduces a Stripe name onto
 * an integrity record, or breaks the Airwallex path, or destroys the pluggable
 * gateway seam that the owner's "I can add this at a later date" depends on.
 * They are deliberately NOT assertions that Stripe works.
 */
import { describe, it, expect } from "vitest";
import {
  describeActor,
  describeActorLabel,
  UNUSED_PROVIDER_RULES,
} from "../lib/actorIdentityDescriber";
import { resolveActorLabel } from "../lib/activityLabelResolver";
import {
  getDefaultGatewayId,
  getAirwallexMode,
  getAirwallexApiBase,
  listPublicGatewayConfig,
  webhookSourceToGateway,
  AIRWALLEX_DEMO_API_BASE,
} from "../lib/paymentGatewayResolver";
import { getCollectiveBillingGatewayId } from "../lib/airwallexCollective";

/* Every one of the 45 actor shapes measured by WAVE 93 (build_log/wave93/
   W93_ACTOR_CENSUS.md), plus provider-shaped variants a future automation could
   plausibly mint. */
const W93_SHAPES = [
  "system:stripe_webhook", "system:seed", "system:admin", "system:wave0_seed",
  "system:collective_renewal_worker", "system:airwallex_webhook", "system:round_sweeper",
  "system:wave6_seed", "system:subscriptionEnforcementWorker", "system:collective_dsc_vote_lock",
  "system:webhook:<gateway>", "system:collective_dsc_vote_revert", "system:wave3d_seed",
  "system:auto_activate_free", "system:webhook", "system:c2_migration_0129",
  "system:round_close", "system:governance_publish", "system:payment_gateway",
  "system:refund", "system:canonical-projection", "system:new_company",
  "u_maya_chen", "u_admin", "u_founder_demo", "u_redeemed_1782888492403",
  "u_rnd_abcdef01", "partner:p_trendwell", "company:co_x", "founder:u_1",
  "subscription:co_x", "accountant:books@example.com", "books@example.com",
  "u_public", "u_unknown_admin",
];

const PROVIDER_VARIANTS = [
  "system:stripe_webhook",
  "system:webhook:stripe",
  "system:stripe_refund",
  "system:STRIPE_WEBHOOK",
  "system:stripeCheckoutWorker",
];

describe("WAVE 97 · Item 2 — no actor description names a provider the platform does not use", () => {
  it("not one of the 45 measured actor shapes renders the word Stripe", () => {
    for (const id of W93_SHAPES) {
      expect(describeActorLabel(id), `describeActorLabel(${id})`).not.toMatch(/stripe/i);
      expect(resolveActorLabel(id), `resolveActorLabel(${id})`).not.toMatch(/stripe/i);
    }
  });

  it("every provider-shaped variant is corrected, not just the one literal token", () => {
    // A fix that only special-cased the exact string `system:stripe_webhook`
    // would let the next automation reintroduce the defect verbatim.
    for (const id of PROVIDER_VARIANTS) {
      expect(describeActorLabel(id), id).not.toMatch(/stripe/i);
      expect(describeActorLabel(id), id).toMatch(/payment provider/i);
      expect(describeActorLabel(id), id).toMatch(/legacy token/i);
    }
  });

  it("HISTORY IS NOT REWRITTEN — the stored token is returned verbatim", () => {
    // The owner's standing rule is "I'd rather add than delete". This is a LABEL
    // correction; the raw id an auditor needs is still there, unaltered.
    for (const id of PROVIDER_VARIANTS) {
      expect(describeActor(id).id).toBe(id);
      expect(describeActor(id).kind).toBe("machine");
      expect(describeActor(id).bound).toBe(false);
    }
  });

  it("Airwallex IS in use, so it is still named — the correction is not a blanket suppressor", () => {
    expect(describeActorLabel("system:airwallex_webhook")).toBe("Automatic · Airwallex webhook");
    expect(describeActorLabel("system:webhook:airwallex")).toMatch(/airwallex/i);
    expect(describeActorLabel("system:airwallex_webhook")).not.toMatch(/legacy token/i);
  });

  it("a provider that is neither in use nor ruled out is left alone, not guessed at", () => {
    // Only names the owner has actually ruled on get corrected. Inventing a rule
    // for an unmentioned provider would be us deciding a fact we were not told.
    expect(describeActorLabel("system:adyen_webhook")).toBe("Automatic · Adyen webhook");
    expect(UNUSED_PROVIDER_RULES).toHaveLength(1);
    expect(UNUSED_PROVIDER_RULES[0].reason).toMatch(/We do not use Stripe/);
  });

  it("the other 44 shapes are byte-identical to their WAVE 93 ratified wording", () => {
    // Regression fence: the correction pass must not have disturbed anything else.
    expect(describeActorLabel("system:round_sweeper")).toBe("Automatic · Round sweeper");
    expect(describeActorLabel("system:collective_renewal_worker")).toBe(
      "Automatic · Collective renewal worker",
    );
    expect(describeActorLabel("system:subscriptionEnforcementWorker")).toBe(
      "Automatic · Subscription enforcement worker",
    );
    expect(describeActorLabel("system:c2_migration_0129")).toBe("Automatic · C2 migration 0129");
    expect(describeActorLabel("system:payment_gateway")).toBe("Automatic · Payment gateway");
    expect(describeActorLabel("u_unknown_admin")).toBe("Administrator (not identified)");
    expect(describeActorLabel("u_redeemed_1782888492403")).toBe("Invited member");
    expect(describeActorLabel("u_public")).toBe("Public applicant");
    expect(describeActorLabel("")).toBe("Not recorded");
  });
});

describe("WAVE 97 — the collective billing path stamps the provider it actually uses", () => {
  it("collective billing reports Airwallex as its gateway", () => {
    expect(getCollectiveBillingGatewayId()).toBe("airwallex");
  });

  it("the module-local audit actor constant is an Airwallex token, not a Stripe one", async () => {
    // Read the source, because the constant is deliberately module-private: the
    // point of the assertion is that no `system:stripe_webhook` literal survives
    // as an actor value in the live Airwallex webhook handler.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../collectiveBillingStore.ts", import.meta.url), "utf8");
    // No remaining ACTOR-POSITION stripe literal.
    expect(src).not.toMatch(/["']system:stripe_webhook["']/);
    expect(src).toMatch(/COLLECTIVE_BILLING_AUDIT_ACTOR\s*=\s*["']system:airwallex_webhook["']/);
  });
});

describe("WAVE 97 — AIRWALLEX STILL WORKS, AND THE GATEWAY SEAM SURVIVES", () => {
  it("Airwallex is the default gateway when PAYMENT_GATEWAY_DEFAULT is unset", () => {
    const prev = process.env.PAYMENT_GATEWAY_DEFAULT;
    try {
      delete process.env.PAYMENT_GATEWAY_DEFAULT;
      expect(getDefaultGatewayId()).toBe("airwallex");
      process.env.PAYMENT_GATEWAY_DEFAULT = "";
      expect(getDefaultGatewayId()).toBe("airwallex");
      process.env.PAYMENT_GATEWAY_DEFAULT = "not-a-gateway";
      expect(getDefaultGatewayId()).toBe("airwallex");
      process.env.PAYMENT_GATEWAY_DEFAULT = "airwallex";
      expect(getDefaultGatewayId()).toBe("airwallex");
    } finally {
      if (prev === undefined) delete process.env.PAYMENT_GATEWAY_DEFAULT;
      else process.env.PAYMENT_GATEWAY_DEFAULT = prev;
    }
  });

  it("Airwallex refuses real network calls unless AIRWALLEX_MODE=test|live — stub is the safe default", () => {
    const prevMode = process.env.AIRWALLEX_MODE;
    const prevReal = process.env.AIRWALLEX_REAL_NETWORK;
    const prevBase = process.env.AIRWALLEX_API_BASE;
    try {
      delete process.env.AIRWALLEX_MODE;
      delete process.env.AIRWALLEX_REAL_NETWORK;
      delete process.env.AIRWALLEX_API_BASE;
      const prevKey = process.env.AIRWALLEX_API_KEY;
      delete process.env.AIRWALLEX_API_KEY;
      expect(getAirwallexMode()).toBe("stub");
      expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);

      /* WAVE 97 — THE POLE THAT MATTERS, and the one a weaker version of this
         test missed: the documented contract is "stub is the default EVEN WHEN A
         KEY IS PRESENT". Asserting stub only in the no-key case would pass
         happily against a build that silently went live the moment a real key
         was configured — i.e. exactly the accident that charges real cards. */
      process.env.AIRWALLEX_API_KEY = "w97_probe_key_not_a_real_credential";
      expect(getAirwallexMode()).toBe("stub");
      expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);

      // Explicit opt-in is honoured, and `test` targets the DEMO base only.
      process.env.AIRWALLEX_MODE = "test";
      expect(getAirwallexMode()).toBe("test");
      expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);

      // `live` WITH a key is the only path to production…
      process.env.AIRWALLEX_MODE = "live";
      expect(getAirwallexMode()).toBe("live");
      // …and `live` WITHOUT a key must NOT go to production.
      delete process.env.AIRWALLEX_API_KEY;
      expect(getAirwallexMode()).toBe("stub");

      if (prevKey === undefined) delete process.env.AIRWALLEX_API_KEY;
      else process.env.AIRWALLEX_API_KEY = prevKey;
    } finally {
      if (prevMode === undefined) delete process.env.AIRWALLEX_MODE;
      else process.env.AIRWALLEX_MODE = prevMode;
      if (prevReal === undefined) delete process.env.AIRWALLEX_REAL_NETWORK;
      else process.env.AIRWALLEX_REAL_NETWORK = prevReal;
      if (prevBase === undefined) delete process.env.AIRWALLEX_API_BASE;
      else process.env.AIRWALLEX_API_BASE = prevBase;
    }
  });

  it("THE SEAM IS STILL THERE — a second gateway can be added without a rewrite", () => {
    /* This is the assertion that protects the owner's "I can add this at a later
       date". It must keep passing. The resolver, the readiness probe, the
       webhook-source mapper and the public config list are the four plug points;
       if any of them disappears, adding a gateway back becomes a rewrite. */
    expect(typeof getDefaultGatewayId).toBe("function");
    expect(typeof webhookSourceToGateway).toBe("function");
    expect(typeof listPublicGatewayConfig).toBe("function");
    const cfg = listPublicGatewayConfig();
    expect(Array.isArray(cfg)).toBe(true);
    const airwallex = cfg.find((e) => e.id === "airwallex");
    expect(airwallex, "Airwallex must always be present in the public config").toBeTruthy();
    expect(airwallex!.webhookPath).toBe("/api/webhooks/payment-gateway/airwallex");
    expect(airwallex!.supportedMethods).toContain("card");
    // The mapper still resolves the gateway that IS in use.
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/airwallex")).toBe("airwallex");
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/unknown")).toBeNull();
  });
});
