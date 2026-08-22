/**
 * v19 Wave A / Change 3 — AirWallex gateway tests.
 *
 * Coverage:
 *   • Resolver picks AirWallex by default (PAYMENT_GATEWAY_DEFAULT unset)
 *   • createPaymentIntent / refundPayment return well-formed stubs in test mode
 *   • Input validation (amount, currency, idempotency key) rejects bad input
 *   • Webhook signature verification accepts valid HMAC and rejects tampered payload
 *   • The per-gateway webhook route /api/webhooks/payment-gateway/airwallex is
 *     wired and idempotent on (intentId, type)
 *   • getPublicConfig() preserves the legacy `webhookUrl` shape AND exposes the
 *     new `defaultGateway` + `defaultWebhookUrl` fields
 *   • listPublicGatewayConfig() returns AirWallex with `isDefault` correctly set
 *
 * WAVE 97B (2026-08-21) · R86 — SIX ASSERTIONS IN THIS FILE ASSERTED THAT
 * STRIPE WORKED. They are rewritten, not deleted, and each rewrite is recorded
 * inline with OLD / NEW / WHY at the site. Owner, verbatim: "remove stripe. I
 * can add this at a later date. We are using Airwallex today." The rewritten
 * assertions now pin the REMOVAL — which is the point of the wave — and each
 * gained a fence that fails if a Stripe surface comes back by any route.
 * Full table: build_log/wave97b/W97B_TESTS.md §2.
 *
 * Math-sacred zones are untouched — this test does NOT exercise
 * captableCommitStore or cap-table-engine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { installV14TestIdentity } from "./_v14TestIdentity";

import {
  registerPaymentGatewayRoutes,
  getPublicConfig,
  getPublicGatewayList,
  _testGateway,
} from "../paymentGatewayAdapter";
import {
  getDefaultGatewayId,
  resolveActiveGateway,
  isGatewayReady,
  listPublicGatewayConfig,
  webhookSourceToGateway,
} from "../lib/paymentGatewayResolver";
import {
  createPaymentIntent as awCreate,
  refundPayment as awRefund,
  verifyWebhookSignature as awVerify,
  signWebhookBody as awSign,
} from "../lib/airwallexGateway";

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerPaymentGatewayRoutes(app);
});

beforeEach(() => {
  _testGateway.reset();
});

afterAll(() => {
  // Clean up env vars we set during tests.
  delete process.env.PAYMENT_GATEWAY_DEFAULT;
  delete process.env.AIRWALLEX_API_KEY;
  delete process.env.AIRWALLEX_CLIENT_ID;
  delete process.env.AIRWALLEX_WEBHOOK_SECRET;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("PaymentGatewayResolver — default selection", () => {
  it("returns 'airwallex' when PAYMENT_GATEWAY_DEFAULT is unset", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    expect(getDefaultGatewayId()).toBe("airwallex");
  });

  it("returns 'airwallex' when PAYMENT_GATEWAY_DEFAULT is empty string", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "";
    expect(getDefaultGatewayId()).toBe("airwallex");
  });

  /* WAVE 97B · R86 — REWRITTEN.
   *   OLD: it("returns 'stripe' when PAYMENT_GATEWAY_DEFAULT=stripe")
   *        expect(getDefaultGatewayId()).toBe("stripe");
   *   NEW: the same env value must now resolve to airwallex.
   *   WHY: this asserted that a removed gateway was selectable. After R86 there
   *        is no "stripe" GatewayId, so a stale PAYMENT_GATEWAY_DEFAULT=stripe
   *        left in someone's .env must NOT select a gateway that does not exist.
   *        It has to land on Airwallex — the fail-safe direction, and already the
   *        documented behaviour for unset/unrecognised values (founder directive,
   *        24-May-2026). This is the single most important rewrite in the file:
   *        it is the assertion that a real deployment carrying the old env var
   *        still takes payments. */
  it("returns 'airwallex' even when a stale PAYMENT_GATEWAY_DEFAULT=stripe is set (R86 — removed gateway is not selectable)", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "stripe";
    expect(getDefaultGatewayId()).toBe("airwallex");
    expect(String(getDefaultGatewayId())).not.toMatch(/stripe/i);
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
  });

  it("returns 'airwallex' for unrecognised values (defensive default)", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "paypal";
    expect(getDefaultGatewayId()).toBe("airwallex");
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
  });

  it("isGatewayReady returns false when AirWallex creds are missing", () => {
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_CLIENT_ID;
    expect(isGatewayReady("airwallex")).toBe(false);
  });

  it("isGatewayReady returns true when AirWallex creds are present", () => {
    process.env.AIRWALLEX_API_KEY = "key_test";
    process.env.AIRWALLEX_CLIENT_ID = "cid_test";
    expect(isGatewayReady("airwallex")).toBe(true);
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_CLIENT_ID;
  });

  /* WAVE 97B · R86 — REWRITTEN.
   *   OLD: it("resolveActiveGateway falls back to the configured gateway when
   *        default is unconfigured") — set STRIPE_SECRET_KEY and asserted
   *        resolveActiveGateway() === "stripe".
   *   NEW: with no other gateway to fall back to, an unconfigured Airwallex
   *        still resolves to airwallex, and a stray STRIPE_SECRET_KEY in the
   *        environment changes NOTHING.
   *   WHY: the old assertion required Stripe to be a live fallback. R86 removed
   *        it. The behaviour that MUST survive is that the resolver never
   *        returns null or throws on an unconfigured gateway — the call site
   *        raises "not_configured" instead of silently dropping a payment. That
   *        contract is what the new assertion pins, plus the new fence that a
   *        leftover Stripe credential cannot resurrect a routing decision. */
  it("resolveActiveGateway returns airwallex when unconfigured, and a stray STRIPE_SECRET_KEY cannot change that", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_CLIENT_ID;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(resolveActiveGateway()).toBe("airwallex");
    expect(String(resolveActiveGateway())).not.toMatch(/stripe/i);
    delete process.env.STRIPE_SECRET_KEY;
  });

  /* WAVE 97B · R86 — ADDED (passing). The webhook-source mapper must no longer
   * claim a Stripe path belongs to a gateway, because no Stripe route is
   * mounted. Airwallex mapping is unchanged. */
  it("webhookSourceToGateway maps airwallex, and maps a stripe path to null (R86)", () => {
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/airwallex")).toBe("airwallex");
    expect(webhookSourceToGateway("/api/webhooks/payment-gateway/stripe")).toBeNull();
  });
});

describe("AirWallex client — createPaymentIntent", () => {
  beforeEach(() => {
    process.env.AIRWALLEX_API_KEY = "key_test_aw";
    process.env.AIRWALLEX_CLIENT_ID = "cid_test_aw";
  });

  it("returns a SUCCEEDED stub intent in test mode (AIRWALLEX_REAL_NETWORK unset)", async () => {
    const intent = await awCreate({
      amountMinor: 84_000,
      currency: "USD",
      merchantOrderId: "co_demo",
      idempotencyKey: "idem_test_1",
    });
    expect(intent.status).toBe("SUCCEEDED");
    // v25.45 ROUND 2 (BLOCKER 6) — the Airwallex PaymentIntent contract returns
    // `amount` in MAJOR units (dollars), per the v25.28 minorToAirwallexMajor
    // conversion (84_000 cents → 840 dollars). This assertion was stale since
    // v25.28 (pre-existing failure carried from the v25.44 baseline, NOT a
    // v25.45 regression — airwallexGateway.ts is byte-identical to v25.44). The
    // standing-gate file v24_2_airwallex_billing.test.ts was already 5/5 green;
    // this corrects the older gateway-unit test to the documented contract.
    expect(intent.amount).toBe(840); // 84_000 minor ÷ 100 = 840 major (USD)
    expect(intent.currency).toBe("USD");
    expect(intent.merchant_order_id).toBe("co_demo");
    expect(intent.id.startsWith("int_stub_")).toBe(true);
  });

  it("rejects non-integer or zero amounts", async () => {
    await expect(awCreate({
      amountMinor: 0,
      currency: "USD",
      merchantOrderId: "co_demo",
      idempotencyKey: "idem_z",
    })).rejects.toThrow(/positive integer/);
    await expect(awCreate({
      amountMinor: 1.5 as unknown as number,
      currency: "USD",
      merchantOrderId: "co_demo",
      idempotencyKey: "idem_f",
    })).rejects.toThrow(/positive integer/);
  });

  it("rejects malformed currency", async () => {
    await expect(awCreate({
      amountMinor: 100,
      currency: "usd", // lowercase → invalid per AirWallex
      merchantOrderId: "co_demo",
      idempotencyKey: "idem_c",
    })).rejects.toThrow(/ISO 4217/);
  });

  it("requires a non-empty idempotency key", async () => {
    await expect(awCreate({
      amountMinor: 100,
      currency: "USD",
      merchantOrderId: "co_demo",
      idempotencyKey: "  ",
    })).rejects.toThrow(/idempotencyKey/);
  });

  it("refund stub returns SUCCEEDED with the right amount", async () => {
    const ref = await awRefund({
      paymentIntentId: "int_test_x",
      amountMinor: 1_000,
      reason: "duplicate_charge",
      idempotencyKey: "idem_r",
    });
    expect(ref.status).toBe("SUCCEEDED");
    // v25.45 ROUND 2 (BLOCKER 6) — refund `amount` is also MAJOR units
    // (1_000 cents ÷ 100 = 10 dollars). Same stale-assertion correction as above.
    expect(ref.amount).toBe(10);
    expect(ref.payment_intent_id).toBe("int_test_x");
  });
});

describe("AirWallex webhook signature verification", () => {
  beforeEach(() => {
    process.env.AIRWALLEX_API_KEY = "key";
    process.env.AIRWALLEX_CLIENT_ID = "cid";
    process.env.AIRWALLEX_WEBHOOK_SECRET = "whsec_test_aw";
  });

  it("accepts a correctly-signed body", () => {
    const body = JSON.stringify({ name: "payment_intent.succeeded", data: { object: { id: "int_1" } } });
    const ts = "1717777777";
    const sig = awSign(body, ts);
    const ok = awVerify({ "x-signature": sig, "x-timestamp": ts }, body);
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ name: "payment_intent.succeeded", data: { object: { id: "int_1" } } });
    const ts = "1717777777";
    const sig = awSign(body, ts);
    const ok = awVerify({ "x-signature": sig, "x-timestamp": ts }, body + "x");
    expect(ok).toBe(false);
  });

  it("rejects missing signature header", () => {
    expect(awVerify({}, "{}")).toBe(false);
  });

  it("rejects when secret is not configured", () => {
    delete process.env.AIRWALLEX_WEBHOOK_SECRET;
    expect(awVerify({ "x-signature": "x", "x-timestamp": "1" }, "{}")).toBe(false);
  });
});

describe("AirWallex public config", () => {
  it("getPublicConfig preserves legacy webhookUrl shape", () => {
    const cfg = getPublicConfig();
    expect(cfg.webhookUrl).toBe("/api/webhooks/payment-gateway");
  });

  it("getPublicConfig exposes defaultGateway = airwallex", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    const cfg = getPublicConfig();
    expect(cfg.defaultGateway).toBe("airwallex");
    expect(cfg.defaultWebhookUrl).toBe("/api/webhooks/payment-gateway/airwallex");
  });

  /* WAVE 97B · R86 — REWRITTEN.
   *   OLD: it("getPublicConfig flips to stripe when PAYMENT_GATEWAY_DEFAULT=stripe")
   *        expect(cfg.defaultGateway).toBe("stripe")
   *        expect(cfg.defaultWebhookUrl).toBe("/api/webhooks/payment-gateway/stripe")
   *   NEW: the admin config body must name AirWallex, and must never name Stripe,
   *        whatever PAYMENT_GATEWAY_DEFAULT says.
   *   WHY: this is the body of GET /api/admin/payment-gateway/config — the exact
   *        screen the owner's instruction is about. It asserted an administrator
   *        could be shown "Stripe" as the active gateway. The whole-object
   *        /stripe/i fence means no field of this response can name Stripe
   *        again, by any spelling. */
  it("getPublicConfig names AirWallex and never Stripe, even with PAYMENT_GATEWAY_DEFAULT=stripe (R86)", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "stripe";
    const cfg = getPublicConfig();
    expect(cfg.defaultGateway).toBe("airwallex");
    expect(cfg.defaultWebhookUrl).toBe("/api/webhooks/payment-gateway/airwallex");
    expect(cfg.name).toBe("AirWallex");
    expect(JSON.stringify(cfg)).not.toMatch(/stripe/i);
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
  });

  /* WAVE 97B · R86 — REWRITTEN.
   *   OLD: it("listPublicGatewayConfig returns both gateways with isDefault flag")
   *        expect(list.length).toBe(2)  +  a `stripe` entry with its webhookPath
   *   NEW: exactly ONE entry, airwallex, still flagged default, and no entry
   *        anywhere in the list names Stripe.
   *   WHY: this list IS "the admin config endpoint's gateway list" that R86 names
   *        for removal. The old assertion pinned the Stripe row as correct
   *        output. `length toBe(1)` is deliberately exact rather than
   *        `toBeGreaterThan(0)`: an exact count is what fails if a second
   *        gateway is ever added without a decision. */
  it("listPublicGatewayConfig returns exactly one gateway — airwallex, flagged default, no Stripe row (R86)", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    const list = listPublicGatewayConfig();
    expect(list.length).toBe(1);
    const aw = list.find((g) => g.id === "airwallex")!;
    expect(aw).toBeTruthy();
    expect(aw.isDefault).toBe(true);
    expect(aw.webhookPath).toBe("/api/webhooks/payment-gateway/airwallex");
    expect(list.some((g) => /stripe/i.test(String(g.id)))).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/stripe/i);
  });

  /* WAVE 97B · R86 — REWRITTEN.
   *   OLD: expect(getPublicGatewayList().length).toBe(2);
   *   NEW: toBe(1), and the adapter's list is asserted to be a faithful mirror of
   *        the resolver's by deep equality rather than by length alone.
   *   WHY: the count changed because the Stripe row was removed. Comparing the
   *        whole array (not just its length) is strictly stronger: it is what
   *        proves the SEAM is intact — the sacred adapter still returns whatever
   *        the non-sacred resolver lists, so widening the resolver is all a
   *        future gateway needs. */
  it("getPublicGatewayList from the adapter still mirrors listPublicGatewayConfig exactly (the seam)", () => {
    expect(getPublicGatewayList().length).toBe(1);
    expect(getPublicGatewayList()).toEqual(listPublicGatewayConfig());
  });
});

describe("AirWallex webhook route — /api/webhooks/payment-gateway/airwallex", () => {
  it("accepts a well-formed payload and returns {ok:true,gateway:'airwallex'}", async () => {
    const payload = {
      name: "payment_intent.succeeded",
      data: { object: { id: "int_wh_1", status: "SUCCEEDED", merchant_order_id: "co_test" } },
    };
    const res = await request(app)
      .post("/api/webhooks/payment-gateway/airwallex")
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gateway).toBe("airwallex");
  });

  it("is idempotent on (intentId, type) — second post returns idempotent:true", async () => {
    const payload = {
      name: "payment_intent.succeeded",
      data: { object: { id: "int_wh_idem", status: "SUCCEEDED", merchant_order_id: "co_test" } },
    };
    const first = await request(app).post("/api/webhooks/payment-gateway/airwallex").send(payload);
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/webhooks/payment-gateway/airwallex").send(payload);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
  });

  it("rejects payload missing type or intentId with 400", async () => {
    const res = await request(app)
      .post("/api/webhooks/payment-gateway/airwallex")
      .send({ data: { object: {} } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_fields");
  });
});

/* WAVE 97B · R86 — REWRITTEN DESCRIBE BLOCK.
 *   OLD: describe("Stripe webhook route — /api/webhooks/payment-gateway/stripe")
 *          it("accepts a well-formed Stripe-shape payload")
 *            — expected 200, ok:true, gateway:"stripe"
 *          it("is idempotent on (intentId, type)")
 *            — expected the second post to report idempotent:true
 *   NEW: the same two posts must now find NOTHING MOUNTED at that path.
 *   WHY: these two were the strongest "Stripe works" assertions in the repo —
 *        they exercised a live, signature-verifying webhook endpoint over HTTP.
 *        R86 removes that endpoint, so the honest replacement asserts its
 *        absence at the same HTTP surface, with the same payloads. This is the
 *        assertion that fails if anyone re-registers the route.
 *        The equivalent Airwallex behaviours (200 + ok + gateway id, and
 *        idempotency on (intentId, type)) are unchanged and still asserted in
 *        the AirWallex webhook-route describe block directly above — so no
 *        coverage of the webhook machinery was lost, only its Stripe arm. */
describe("WAVE 97B · R86 — the Stripe webhook route is GONE", () => {
  it("POST /api/webhooks/payment-gateway/stripe is not mounted (was: accepted a well-formed Stripe-shape payload)", async () => {
    const payload = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_wh_1", status: "succeeded", metadata: { companyId: "co_test" } } },
    };
    const res = await request(app)
      .post("/api/webhooks/payment-gateway/stripe")
      .send(payload);
    expect(res.status).toBe(404);
    expect(res.body?.gateway).toBeUndefined();
  });

  it("repeat posts to the removed path stay unmounted — no idempotency ledger entry is minted (was: idempotent on (intentId, type))", async () => {
    const payload = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_wh_idem", status: "succeeded", metadata: { companyId: "co_test" } } },
    };
    const first = await request(app).post("/api/webhooks/payment-gateway/stripe").send(payload);
    const second = await request(app).post("/api/webhooks/payment-gateway/stripe").send(payload);
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    expect(second.body?.idempotent).toBeUndefined();
  });

  it("the source of the SACRED adapter contains no stripeGateway import and no stripe route registration (R86 fence)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "..", "paymentGatewayAdapter.ts"),
      "utf8",
    );
    /* Comments are stripped before the fences run. The R86 comment blocks in that
     * file deliberately QUOTE the removed lines verbatim so the record shows
     * exactly what went and where a future gateway plugs back in; a naive
     * whole-file regex matches those quotes and reports a false positive. Asking
     * the question of the CODE is the correct question. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // No live code may import the deleted module or register the removed route.
    expect(code).not.toMatch(/^\s*import[^\n]*from\s+["']\.\/lib\/stripeGateway["']/m);
    expect(code).not.toMatch(/app\.post\(\s*["']\/api\/webhooks\/payment-gateway\/stripe["']/);
    expect(code).not.toMatch(/verifyStripeSig\s*\(/);
    // ...and the Airwallex route it replaces is still registered.
    expect(code).toMatch(/app\.post\(\s*["']\/api\/webhooks\/payment-gateway\/airwallex["']/);
  });

  it("the three Stripe gateway modules are gone from disk (R86)", () => {
    for (const rel of [
      "lib/stripeGateway.ts",
      "lib/stripeCollective.ts",
      "stripeGatewayAdapter.ts",
    ]) {
      expect(existsSync(path.resolve(__dirname, "..", rel))).toBe(false);
    }
  });
});

describe("Legacy /api/webhooks/payment-gateway endpoint — regression", () => {
  it("still accepts the legacy shape unchanged", async () => {
    const res = await request(app)
      .post("/api/webhooks/payment-gateway")
      .send({ type: "payment.succeeded", intentId: "leg_1", status: "succeeded", companyId: "co_legacy" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
