/**
 * v19 Wave A / Change 3 — AirWallex gateway tests.
 *
 * Coverage:
 *   • Resolver picks AirWallex by default (PAYMENT_GATEWAY_DEFAULT unset)
 *   • Resolver respects explicit PAYMENT_GATEWAY_DEFAULT=stripe override
 *   • createPaymentIntent / refundPayment return well-formed stubs in test mode
 *   • Input validation (amount, currency, idempotency key) rejects bad input
 *   • Webhook signature verification accepts valid HMAC and rejects tampered payload
 *   • Per-gateway webhook routes (/api/webhooks/payment-gateway/airwallex|stripe)
 *     are wired and idempotent on (intentId, type)
 *   • getPublicConfig() preserves the legacy `webhookUrl` shape AND exposes the
 *     new `defaultGateway` + `defaultWebhookUrl` fields
 *   • listPublicGatewayConfig() returns both gateways with `isDefault` correctly set
 *
 * Math-sacred zones are untouched — this test does NOT exercise
 * captableCommitStore or cap-table-engine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
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

  it("returns 'stripe' when PAYMENT_GATEWAY_DEFAULT=stripe", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "stripe";
    expect(getDefaultGatewayId()).toBe("stripe");
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

  it("resolveActiveGateway falls back to the configured gateway when default is unconfigured", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_CLIENT_ID;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(resolveActiveGateway()).toBe("stripe");
    delete process.env.STRIPE_SECRET_KEY;
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
    expect(intent.amount).toBe(84_000);
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
    expect(ref.amount).toBe(1_000);
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

  it("getPublicConfig flips to stripe when PAYMENT_GATEWAY_DEFAULT=stripe", () => {
    process.env.PAYMENT_GATEWAY_DEFAULT = "stripe";
    const cfg = getPublicConfig();
    expect(cfg.defaultGateway).toBe("stripe");
    expect(cfg.defaultWebhookUrl).toBe("/api/webhooks/payment-gateway/stripe");
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
  });

  it("listPublicGatewayConfig returns both gateways with isDefault flag", () => {
    delete process.env.PAYMENT_GATEWAY_DEFAULT;
    const list = listPublicGatewayConfig();
    expect(list.length).toBe(2);
    const aw = list.find((g) => g.id === "airwallex")!;
    const stripe = list.find((g) => g.id === "stripe")!;
    expect(aw.isDefault).toBe(true);
    expect(stripe.isDefault).toBe(false);
    expect(aw.webhookPath).toBe("/api/webhooks/payment-gateway/airwallex");
    expect(stripe.webhookPath).toBe("/api/webhooks/payment-gateway/stripe");
  });

  it("getPublicGatewayList from the adapter mirrors listPublicGatewayConfig", () => {
    expect(getPublicGatewayList().length).toBe(2);
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

describe("Stripe webhook route — /api/webhooks/payment-gateway/stripe", () => {
  it("accepts a well-formed Stripe-shape payload", async () => {
    const payload = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_wh_1", status: "succeeded", metadata: { companyId: "co_test" } } },
    };
    const res = await request(app)
      .post("/api/webhooks/payment-gateway/stripe")
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gateway).toBe("stripe");
  });

  it("is idempotent on (intentId, type)", async () => {
    const payload = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_wh_idem", status: "succeeded", metadata: { companyId: "co_test" } } },
    };
    await request(app).post("/api/webhooks/payment-gateway/stripe").send(payload);
    const second = await request(app).post("/api/webhooks/payment-gateway/stripe").send(payload);
    expect(second.body.idempotent).toBe(true);
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
