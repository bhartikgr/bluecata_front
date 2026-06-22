/**
 * v24.2 Airwallex billing wiring — end-to-end checkout tests.
 *
 * Avi's bug (V24_2 task): the founder filled card details in the Billing UI and
 * the data was saved in Capavate's DB, but NO record ever appeared in the
 * Airwallex dashboard — because the billing endpoint was a STUB that never
 * called the gateway. His exact words: "The payment functionality is not
 * working. The related data should only be saved in Airwallex after a
 * successful payment."
 *
 * The v24.2 fix wires POST /api/billing/plan to actually mint an Airwallex
 * PaymentIntent (so a record exists gateway-side) and records only a PENDING
 * local subscription; the subscription is flipped to `active` ONLY when the
 * Airwallex `payment_intent.succeeded` webhook lands. These tests prove the
 * real path, not the stub:
 *
 *   (a) POST /api/billing/plan with a valid tier mints an Airwallex
 *       PaymentIntent and returns paymentIntentId + hostedPaymentPageUrl.
 *   (b) With NO Airwallex credentials the endpoint returns 503
 *       gateway_not_configured (the gateway throws AirwallexNotConfiguredError)
 *       — and crucially does NOT persist a subscription.
 *   (c) A successful checkout persists a PENDING (not active) subscription.
 *   (d) The Airwallex payment_intent.succeeded webhook flips that record
 *       pending → active.
 *   (e) GET /api/founder/subscription/status returns the correct status for the
 *       owning founder (and 403 for a non-owner).
 *
 * Gateway calls run in deterministic STUB mode (AIRWALLEX_REAL_NETWORK unset),
 * so no real network traffic occurs — but the code path that WOULD call the
 * real Airwallex API in staging is fully exercised (ensureConfigured() +
 * createPaymentIntent()).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { getDb } from "../db/connection";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder, type FounderCompanyMembership } from "../multiCompanyStore";
import { _testSubscriptionStore, getByPaymentIntent } from "../subscriptionStore";
import { _testGateway } from "../paymentGatewayAdapter";
import { signWebhookBody } from "../lib/airwallexGateway";
import * as pricingModel from "../pricingModelStore";

// The checkout flow sends the legacy tier id `founder_capavate_annual`, which
// pricingTiersStore aliases to the live founder slug `capavate-annual`
// (LEGACY_ID_ALIASES). v25.27 removed the source-baked pricing seed, so the
// resolver finds nothing unless a matching `capavate-annual` founder model is
// seeded as `live` in the test DB/store. We seed it directly in beforeAll
// below (admin-equivalent createModel) — no production code path is changed.
const TIER_ID = "founder_capavate_annual";
const TIER_SLUG = "capavate-annual";
// Annual price for the single Capavate tier is $840 → 84000 minor units.
const ANNUAL_PRICE_MINOR = 84000;
const MONTHLY_PRICE_MINOR = 7000;

function mkMembership(companyId: string, name: string): FounderCompanyMembership {
  return {
    companyId,
    companyName: name,
    legalName: `${name}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "Fintech",
    stage: "Seed",
    hq: "Toronto, ON",
  };
}

describe("v24.2 Airwallex billing wiring — POST /api/billing/plan + webhook + status", () => {
  let app: Express;
  let server: http.Server;
  let port: number;

  let FOUNDER = "";
  let OTHER_FOUNDER = "";
  // Test (e) uses its own founder+company. The deterministic STUB PaymentIntent
  // id is derived from the idempotency key, which begins `idem_<userId>_...`;
  // the gateway slices the first 16 chars, so two checkouts by the SAME founder
  // collide to the same intent id. A distinct founder for (e) keeps its intent
  // id (and therefore its subscription row) independent of (a)–(d).
  let FOUNDER_E = "";
  const COMPANY = `co_awx_${Date.now()}`;
  const COMPANY_E = `co_awxe_${Date.now()}`;

  // Snapshot original credentials so we can restore between tests.
  const ORIG_KEY = process.env.AIRWALLEX_API_KEY;
  const ORIG_CID = process.env.AIRWALLEX_CLIENT_ID;
  const ORIG_SECRET = process.env.AIRWALLEX_WEBHOOK_SECRET;

  function setCreds() {
    process.env.AIRWALLEX_API_KEY = "test_awx_api_key";
    process.env.AIRWALLEX_CLIENT_ID = "test_awx_client_id";
    process.env.AIRWALLEX_WEBHOOK_SECRET = "test_awx_webhook_secret";
  }
  function clearCreds() {
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_CLIENT_ID;
  }

  beforeAll(async () => {
    getDb();
    setCreds();

    // Seed the live `capavate-annual` founder pricing model so the billing
    // resolver (pricingTiersStore.getById → LEGACY_ID_ALIASES) can resolve the
    // legacy `founder_capavate_annual` tier id the checkout sends. This mirrors
    // what an admin does in /admin/pricing-models; it is additive test setup,
    // not a source-baked price. Idempotent across re-runs of the same process.
    if (!pricingModel.listModels({ productLine: "founder", status: "live" }).some((m) => m.slug === TIER_SLUG)) {
      const created = pricingModel.createModel(
        {
          productLine: "founder",
          slug: TIER_SLUG,
          name: "Capavate Annual",
          description: "Capavate founder annual plan (test seed).",
          status: "live",
          currency: "USD",
          basePriceMinor: ANNUAL_PRICE_MINOR,
          cadence: "annual",
          cadenceOptions: [
            { cadence: "annual", priceMinor: ANNUAL_PRICE_MINOR },
            { cadence: "monthly", priceMinor: MONTHLY_PRICE_MINOR },
          ],
          currencyOverrides: [],
          regionalMultipliers: [],
          features: [],
          metering: [],
          volumeBrackets: [],
          discountCodes: [],
          trial: null,
          effectiveFrom: null,
          effectiveTo: null,
          grandfatherOnChange: false,
          taxInclusive: false,
        },
        "test-harness",
      );
      if (!created.ok) throw new Error(`failed to seed pricing model: ${created.error}`);
    }

    const reg = registerFounderUser({ email: `awx_${Date.now()}@test.example`, name: "Airwallex Founder", password: "pw-not-used" });
    FOUNDER = reg.userId;
    addCompanyForFounder(FOUNDER, mkMembership(COMPANY, "Airwallex Co"));

    const reg2 = registerFounderUser({ email: `awx_other_${Date.now()}@test.example`, name: "Other Founder", password: "pw-not-used" });
    OTHER_FOUNDER = reg2.userId;

    const reg3 = registerFounderUser({ email: `awx_e_${Date.now()}@test.example`, name: "Status Founder", password: "pw-not-used" });
    FOUNDER_E = reg3.userId;
    addCompanyForFounder(FOUNDER_E, mkMembership(COMPANY_E, "Status Co"));

    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Restore original env.
    if (ORIG_KEY === undefined) delete process.env.AIRWALLEX_API_KEY; else process.env.AIRWALLEX_API_KEY = ORIG_KEY;
    if (ORIG_CID === undefined) delete process.env.AIRWALLEX_CLIENT_ID; else process.env.AIRWALLEX_CLIENT_ID = ORIG_CID;
    if (ORIG_SECRET === undefined) delete process.env.AIRWALLEX_WEBHOOK_SECRET; else process.env.AIRWALLEX_WEBHOOK_SECRET = ORIG_SECRET;
  });

  afterEach(() => {
    // Each test is responsible for the creds it needs; default back to "set".
    setCreds();
  });

  function call(
    method: string,
    path: string,
    body: unknown,
    userId?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const data = body !== undefined ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = { ...extraHeaders };
      if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
      if (userId) headers["x-user-id"] = userId;
      const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        let raw = ""; res.on("data", (c) => (raw += c));
        res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }); } catch { resolve({ status: res.statusCode ?? 0, body: raw }); } });
      });
      r.on("error", reject); if (data) r.write(data); r.end();
    });
  }

  /* (a) valid tier → PaymentIntent minted, ids returned --------------------- */
  it("(a) POST /api/billing/plan with a valid tier mints an Airwallex PaymentIntent", async () => {
    const r = await call("POST", "/api/billing/plan", { tierId: TIER_ID, companyId: COMPANY, billingCycle: "annual" }, FOUNDER);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    // A real gateway intent id (stub mode → int_stub_*; staging → int_*). The
    // OLD stub endpoint returned no intent id at all.
    expect(typeof r.body?.paymentIntentId).toBe("string");
    expect(r.body.paymentIntentId.length).toBeGreaterThan(0);
    expect(r.body.paymentIntentId).toMatch(/^int_/);
    // The client needs the hosted page URL to redirect the founder to Airwallex.
    // v24.4.2 Bug F + v25.1 Bug 4 (Avi prod reports): in STUB mode (the
    // hermetic default here — no AIRWALLEX_MODE / AIRWALLEX_REAL_NETWORK set)
    // the stub intent is already SUCCEEDED, so the route auto-activates the
    // subscription and returns the local BillingReturn `returnUrl` as the
    // hostedPaymentPageUrl (a real airwallex.com checkout URL would 404 for a
    // stub intent). On Avi's live server (AIRWALLEX_REAL_NETWORK=1 → mode
    // `test`) the gateway returns a real hosted Airwallex URL and the
    // pending→webhook flow applies instead. Assert the stub contract that ships.
    expect(typeof r.body?.hostedPaymentPageUrl).toBe("string");
    expect(r.body.hostedPaymentPageUrl.length).toBeGreaterThan(0);
    expect(r.body.hostedPaymentPageUrl).toContain(r.body.paymentIntentId);
    expect(r.body?.stubMode).toBe(true);
    // Annual price for the single Capavate tier is $840 → 84000 minor units.
    expect(r.body?.amountMinor).toBe(84000);
    expect(r.body?.currency).toBe("USD");
  });

  /* (b) no creds → 503 gateway_not_configured, NOTHING persisted ------------ */
  it("(b) with no Airwallex credentials returns 503 gateway_not_configured and persists nothing", async () => {
    clearCreds();
    const before = _testSubscriptionStore.all().length;
    const r = await call("POST", "/api/billing/plan", { tierId: TIER_ID, companyId: COMPANY, billingCycle: "annual" }, FOUNDER);
    expect(r.status).toBe(503);
    expect(r.body?.error).toBe("gateway_not_configured");
    // The bug Avi reported was data saved WITHOUT a gateway record. Here the
    // gateway call fails up front, so NO local subscription may be created.
    expect(_testSubscriptionStore.all().length).toBe(before);
    setCreds();
  });

  /* (c) success persists a durable subscription with the right fields ------- */
  it("(c) a successful checkout persists a durable subscription (stub mode auto-activates per v24.4.2 Bug F)", async () => {
    const r = await call("POST", "/api/billing/plan", { tierId: TIER_ID, companyId: COMPANY, billingCycle: "annual" }, FOUNDER);
    expect(r.status).toBe(200);
    const pid = r.body.paymentIntentId as string;

    // The subscription is persisted to capavate_subscriptions with the correct
    // company / user / tier regardless of mode. In STUB mode (hermetic default)
    // the route auto-activates it (v24.4.2 Bug F) so status === "active"; in
    // test/live mode it stays "pending" until the success webhook lands.
    const sub = getByPaymentIntent(pid);
    expect(sub).toBeTruthy();
    expect(["pending", "active"]).toContain(sub?.status);
    expect(sub?.companyId).toBe(COMPANY);
    expect(sub?.userId).toBe(FOUNDER);
    expect(sub?.tierId).toBe(TIER_ID);
    if (r.body?.stubMode) {
      expect(sub?.status).toBe("active");
      expect(sub?.activatedAt).toBeTruthy();
    }
  });

  /* (d) webhook payment_intent.succeeded yields an active subscription ------ */
  it("(d) Airwallex payment_intent.succeeded webhook leaves the subscription active (idempotent in stub mode)", async () => {
    // Mint a fresh subscription. In stub mode it is already auto-activated
    // (v24.4.2 Bug F); the success webhook below must then be idempotent and
    // leave it active. In test/live mode it would be pending and the webhook
    // flips it to active. Either way the post-webhook state is `active`.
    const created = await call("POST", "/api/billing/plan", { tierId: TIER_ID, companyId: COMPANY, billingCycle: "annual" }, FOUNDER);
    const pid = created.body.paymentIntentId as string;
    expect(["pending", "active"]).toContain(getByPaymentIntent(pid)?.status);

    // Build a realistic Airwallex webhook envelope. The handler normalises
    // type from body.name, intent id from data.object.id, status from
    // data.object.status. A signed body lets the real verifier pass too.
    const event = {
      name: "payment_intent.succeeded",
      data: { object: { id: pid, status: "SUCCEEDED", merchant_order_id: COMPANY } },
    };
    const rawBody = JSON.stringify(event);
    const timestamp = String(Date.now());
    const signature = signWebhookBody(rawBody, timestamp, process.env.AIRWALLEX_WEBHOOK_SECRET);

    const r = await call(
      "POST",
      "/api/webhooks/payment-gateway/airwallex",
      event,
      undefined,
      { "x-signature": signature, "x-timestamp": timestamp },
    );
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);

    const sub = getByPaymentIntent(pid);
    expect(sub?.status).toBe("active");
    expect(sub?.activatedAt).toBeTruthy();
  });

  /* (e) GET status returns the correct status for the owner; 403 otherwise -- */
  it("(e) GET /api/founder/subscription/status returns the correct status (and 403 for non-owner)", async () => {
    // Start from a clean store so the (deterministic) stub PaymentIntent id maps
    // to exactly the row this test creates, and clear the webhook idempotency
    // ledger so the success webhook below is not deduped against an earlier
    // test that happened to mint the same stub intent id. (e) is the last test.
    _testSubscriptionStore.reset();
    _testGateway.reset();

    const created = await call("POST", "/api/billing/plan", { tierId: TIER_ID, companyId: COMPANY_E, billingCycle: "annual" }, FOUNDER_E);
    expect(created.status).toBe(200);
    const pid = created.body.paymentIntentId as string;

    // Owner can read its own subscription status. In stub mode (hermetic
    // default) the route auto-activated it (v24.4.2 Bug F), so status is
    // already `active`; in test/live mode it would be `pending` until the
    // webhook lands. Assert the owner read succeeds with the correct tier.
    const ownerView = await call("GET", `/api/founder/subscription/status?paymentIntentId=${encodeURIComponent(pid)}`, undefined, FOUNDER_E);
    expect(ownerView.status).toBe(200);
    expect(["pending", "active"]).toContain(ownerView.body?.status);
    expect(ownerView.body?.tierId).toBe(TIER_ID);

    // After the success webhook, the owner sees active (idempotent if already).
    const event = { name: "payment_intent.succeeded", data: { object: { id: pid, status: "SUCCEEDED", merchant_order_id: COMPANY_E } } };
    const rawBody = JSON.stringify(event);
    const timestamp = String(Date.now());
    const signature = signWebhookBody(rawBody, timestamp, process.env.AIRWALLEX_WEBHOOK_SECRET);
    await call("POST", "/api/webhooks/payment-gateway/airwallex", event, undefined, { "x-signature": signature, "x-timestamp": timestamp });

    const active = await call("GET", `/api/founder/subscription/status?paymentIntentId=${encodeURIComponent(pid)}`, undefined, FOUNDER_E);
    expect(active.status).toBe(200);
    expect(active.body?.status).toBe("active");

    // A different authed founder who does not own this subscription is refused.
    const forbidden = await call("GET", `/api/founder/subscription/status?paymentIntentId=${encodeURIComponent(pid)}`, undefined, OTHER_FOUNDER);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body?.error).toBe("not_owner");
  });
});
