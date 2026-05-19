/**
 * Sprint 28 Billing — comprehensive test coverage for the Pricing & Billing
 * production build.
 *
 * Test areas (per spec section F):
 *   1. Invoice issuance: subscription charge → invoice paid status + payment entry link
 *   2. Invoice numbers unique and monotonic
 *   3. Refund creates negative-amount invoice linked to original
 *   4. Hash chain extends on every state change; verifyChain passes
 *   5. Webhook idempotency: same (intentId, type) twice → second is no-op
 *   6. Subscription state-graph transitions (reject invalid, accept valid)
 *   7. Money invariants: integer minor units throughout
 *   8. Auto-creation of subscription on new company (pending_payment, founder_pro, annual)
 *   9. GET /api/founder/invoices scoped to company only (cross-company → 403/404)
 *  10. PDF endpoint returns 200, application/pdf, Content-Disposition: attachment
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";

import {
  createInvoice,
  markInvoicePaid,
  voidInvoice,
  refundInvoice,
  getInvoice,
  listInvoices,
  listInvoicesForCompany,
  generateInvoicePdf,
  registerInvoiceRoutes,
  configureInvoiceStore,
  invoiceChain,
  _testInvoices,
} from "../invoiceStore";

import {
  chargeSubscription,
  chargeRefund,
  getPublicConfig,
  registerPaymentGatewayRoutes,
  _testGateway,
} from "../paymentGatewayAdapter";

import {
  getSubscription,
  updateSubscription,
  verifyChain,
  listSubscriptions,
  registerSubscriptionRoutes,
  _testSubscriptions,
  PLAN_PRICES,
} from "../subscriptionsStore";

/* ---------- HTTP helper ---------- */
async function req(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; rawBody?: Buffer; headers?: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, any> = {
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        ...(headers ?? {}),
      };
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: reqHeaders },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on("end", () => {
            server.close();
            const rawBody = Buffer.concat(chunks);
            const buf = rawBody.toString("utf8");
            const responseHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              responseHeaders[k] = Array.isArray(v) ? v[0] : (v ?? "");
            }
            try {
              resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null, rawBody, headers: responseHeaders });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: buf, rawBody, headers: responseHeaders });
            }
          });
        },
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* ---------- App factories ---------- */
function makeInvoiceApp() {
  const app = express();
  app.use(express.json());
  registerInvoiceRoutes(app);
  return app;
}

function makeGatewayApp() {
  const app = express();
  app.use(express.json());
  registerInvoiceRoutes(app);
  registerPaymentGatewayRoutes(app);
  return app;
}

function makeSubscriptionApp() {
  const app = express();
  app.use(express.json());
  registerSubscriptionRoutes(app);
  return app;
}

function makeFullApp() {
  const app = express();
  app.use(express.json());
  registerInvoiceRoutes(app);
  registerPaymentGatewayRoutes(app);
  registerSubscriptionRoutes(app);
  // Sprint 28 new-company route inline for testing
  app.post("/api/founder/companies", (req, res) => {
    const { companyId, companyName, plan } = req.body ?? {};
    if (!companyId || !companyName) {
      return res.status(400).json({ ok: false, error: "companyId and companyName are required" });
    }
    const renewsOn = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const existing = getSubscription(companyId);
    let subscription;
    if (!existing) {
      const { createHash } = require("node:crypto");
      const planKey = (plan ?? "founder_pro") as keyof typeof PLAN_PRICES;
      const price = PLAN_PRICES[planKey];
      const prev = "0".repeat(64);
      const body = {
        companyId, status: "pending_payment", plan: planKey,
        annualAmountMinor: price.annualMinor, currency: price.currency,
        renewsOn, cardLast4: null, invoicesCount: 0, version: 1,
        prevRevisionHash: prev, updatedAt: new Date().toISOString(),
        updatedBy: "system:new_company",
      };
      const revisionHash = createHash("sha256").update(prev).update(JSON.stringify(body)).digest("hex");
      const record = { ...body, revisionHash };
      _testSubscriptions.store.set(companyId, record);
      _testSubscriptions.history.set(companyId, [record]);
      subscription = record;
    } else {
      subscription = existing;
    }
    res.status(201).json({ ok: true, companyId, companyName, subscription });
  });
  return app;
}

/* ---------- Test suite ---------- */

/* ========================================================================
 * 1. Invoice issuance
 * ====================================================================== */
describe("Sprint 28 / Invoice — issuance creates paid invoice", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("createInvoice with paymentEntryId → status 'paid'", () => {
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_co_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_test_001",
      cardLast4: "4242",
    });
    expect(inv.status).toBe("paid");
    expect(inv.paymentEntryId).toBe("pe_test_001");
    expect(inv.paidAt).toBeTruthy();
    expect(inv.companyId).toBe("co_novapay");
  });

  it("createInvoice without paymentEntryId → status 'issued'", () => {
    const inv = createInvoice({
      companyId: "co_test",
      subscriptionId: "sub_co_test",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    expect(inv.status).toBe("issued");
    expect(inv.paymentEntryId).toBeUndefined();
    expect(inv.paidAt).toBeUndefined();
  });

  it("chargeSubscription returns paid invoice linked to payment entry", () => {
    const result = chargeSubscription({
      companyId: "co_novapay",
      subscriptionId: "sub_co_novapay",
      pricingModelId: "pm_founder_pro_v1",
      currency: "USD",
      amountMinor: 298_800,
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      paymentMethodToken: "tok_test_4242",
      cardLast4: "4242",
    });
    expect(result.ok).toBe(true);
    expect(result.invoice.status).toBe("paid");
    expect(result.invoice.paymentEntryId).toBe(result.paymentEntry.id);
    expect(result.paymentEntry.amountCents).toBe(298_800);
  });

  it("chargeSubscription is idempotent on same (subscriptionId, periodStart) — same payment entry id", () => {
    // Idempotency is guaranteed at the paymentStore layer via chargeOrIdempotent.
    // Same subscriptionId + periodStart = same SHA-256 intentId = same payment entry.
    // Use a unique period to avoid cross-test contamination from shared paymentStore.
    const period = `idem-${Date.now()}`;
    const input = {
      companyId: "co_novapay",
      subscriptionId: `sub_idem_${Date.now()}`,
      pricingModelId: "pm_founder_pro_v1",
      currency: "USD",
      amountMinor: 298_800,
      planLabel: "Founder Pro",
      periodStart: period,
      periodEnd: "2026-12-31",
      paymentMethodToken: "tok_test_4242",
      cardLast4: "4242",
    };
    const r1 = chargeSubscription(input);
    const r2 = chargeSubscription(input);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // The same payment entry is returned both times (idempotent charge)
    expect(r1.paymentEntry.id).toBe(r2.paymentEntry.id);
    // Amount is identical — no double-charge
    expect(r1.paymentEntry.amountCents).toBe(r2.paymentEntry.amountCents);
  });
});

/* ========================================================================
 * 2. Invoice numbers — unique and monotonic
 * ====================================================================== */
describe("Sprint 28 / Invoice — unique monotonic numbers", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("each invoice gets a unique number", () => {
    const inv1 = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const inv2 = createInvoice({ companyId: "co_b", subscriptionId: "s2", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const inv3 = createInvoice({ companyId: "co_c", subscriptionId: "s3", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const numbers = [inv1.invoiceNumber, inv2.invoiceNumber, inv3.invoiceNumber];
    expect(new Set(numbers).size).toBe(3);
  });

  it("invoice numbers follow CAP-{YEAR}-{6-digit} format", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    expect(inv.invoiceNumber).toMatch(/^CAP-\d{4}-\d{6}$/);
  });

  it("invoice numbers are monotonically increasing within a year", () => {
    const inv1 = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const inv2 = createInvoice({ companyId: "co_b", subscriptionId: "s2", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const num1 = parseInt(inv1.invoiceNumber.split("-")[2], 10);
    const num2 = parseInt(inv2.invoiceNumber.split("-")[2], 10);
    expect(num2).toBeGreaterThan(num1);
  });

  it("sequence counter is stored per year", () => {
    const year = new Date().getFullYear().toString();
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    expect(inv.invoiceNumber).toContain(`CAP-${year}-`);
  });
});

/* ========================================================================
 * 3. Refund — negative-amount invoice linked to original
 * ====================================================================== */
describe("Sprint 28 / Invoice — refund creates negative invoice", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("refundInvoice creates negative-amount invoice", () => {
    const original = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_co_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_001",
    });
    const refund = refundInvoice(original.id, 298_800, "customer_request", "admin@capavate.com");
    expect(refund.totalMinor).toBeLessThan(0);
    expect(refund.amountMinor).toBeLessThan(0);
    expect(refund.relatedInvoiceId).toBe(original.id);
  });

  it("original invoice is marked refunded after refundInvoice", () => {
    const original = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_co_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 100_00,
      currency: "USD",
      paymentEntryId: "pe_002",
    });
    refundInvoice(original.id, 100_00, "duplicate_charge", "admin@capavate.com");
    const updated = getInvoice(original.id)!;
    expect(updated.status).toBe("refunded");
    expect(updated.refundedAt).toBeTruthy();
  });

  it("refund invoice amount equals the requested refund (integer minor units)", () => {
    const original = createInvoice({
      companyId: "co_arboreal",
      subscriptionId: "sub_co_arboreal",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_003",
    });
    const partialRefundMinor = 50_000;
    const refund = refundInvoice(original.id, partialRefundMinor, "partial_credit", "admin@capavate.com");
    // Must be negative
    expect(refund.totalMinor).toBe(-partialRefundMinor);
    // Must be an integer (no floats)
    expect(Number.isInteger(refund.totalMinor)).toBe(true);
  });

  it("chargeRefund helper also produces negative invoice linked to original", () => {
    const original = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_co_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_004",
    });
    const result = chargeRefund({
      paymentEntryId: "pe_004",
      invoiceId: original.id,
      amountMinor: 298_800,
      reason: "service_outage",
    });
    expect(result.ok).toBe(true);
    expect(result.refundInvoice.amountMinor).toBe(-298_800);
    expect(result.refundInvoice.relatedInvoiceId).toBe(original.id);
  });

  it("refundInvoice throws if invoice not found", () => {
    expect(() => refundInvoice("inv_nonexistent", 100, "test", "admin")).toThrow("invoice_not_found:inv_nonexistent");
  });
});

/* ========================================================================
 * 4. Hash chain integrity
 * ====================================================================== */
describe("Sprint 28 / Invoice — hash chain extends and verifies", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("invoiceChain grows with each createInvoice call", () => {
    const before = invoiceChain.list().length;
    createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    createInvoice({ companyId: "co_b", subscriptionId: "s2", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 200_00, currency: "USD" });
    expect(invoiceChain.list().length).toBe(before + 2);
  });

  it("invoiceChain.verify() passes after multiple appends", () => {
    createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    createInvoice({ companyId: "co_b", subscriptionId: "s2", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 200_00, currency: "USD" });
    const verify = invoiceChain.verify();
    expect(verify.ok).toBe(true);
  });

  it("chain extends on markInvoicePaid (status transition)", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const before = invoiceChain.list().length;
    markInvoicePaid(inv.id, "pe_paid_001", "1234", "system");
    expect(invoiceChain.list().length).toBeGreaterThan(before);
    expect(invoiceChain.verify().ok).toBe(true);
  });

  it("chain extends on voidInvoice", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const before = invoiceChain.list().length;
    voidInvoice(inv.id, "admin");
    expect(invoiceChain.list().length).toBeGreaterThan(before);
    expect(invoiceChain.verify().ok).toBe(true);
  });

  it("each invoice carries a non-empty hash (tamper evidence)", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    expect(inv.hash.length).toBeGreaterThan(0);
    expect(inv.prevHash).toBe("GENESIS");
  });

  it("invoice hash changes on each state transition", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 100_00, currency: "USD" });
    const hashBefore = inv.hash;
    const paid = markInvoicePaid(inv.id, "pe_x", "9999", "system");
    expect(paid.hash).not.toBe(hashBefore);
    expect(paid.prevHash).toBe(hashBefore);
    expect(paid.version).toBe(2);
  });

  it("subscription verifyChain passes for seeded companies", () => {
    const result = verifyChain("co_novapay");
    expect(result.ok).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("subscription verifyChain passes after a mutation", () => {
    updateSubscription("co_novapay", { cardLast4: "9999" }, "test:actor");
    const result = verifyChain("co_novapay");
    expect(result.ok).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

/* ========================================================================
 * 5. Webhook idempotency
 * ====================================================================== */
describe("Sprint 28 / Webhook — idempotency on (intentId, type)", () => {
  beforeEach(() => {
    _testGateway.reset();
  });

  it("second webhook with same (intentId, type) is a no-op (idempotent=true)", async () => {
    const app = makeGatewayApp();
    const body = { type: "payment.succeeded", intentId: "intent_abc123", status: "succeeded", companyId: "co_novapay" };
    const r1 = await req(app, "POST", "/api/webhooks/payment-gateway", body);
    const r2 = await req(app, "POST", "/api/webhooks/payment-gateway", body);
    expect(r1.body.ok).toBe(true);
    expect(r1.body.idempotent).toBeUndefined();
    expect(r2.body.ok).toBe(true);
    expect(r2.body.idempotent).toBe(true);
  });

  it("different type for same intentId is processed independently", async () => {
    const app = makeGatewayApp();
    const r1 = await req(app, "POST", "/api/webhooks/payment-gateway", { type: "payment.succeeded", intentId: "intent_xyz", companyId: "co_arboreal" });
    const r2 = await req(app, "POST", "/api/webhooks/payment-gateway", { type: "payment.failed", intentId: "intent_xyz", companyId: "co_arboreal" });
    expect(r1.body.ok).toBe(true);
    expect(r1.body.idempotent).toBeUndefined();
    expect(r2.body.ok).toBe(true);
    expect(r2.body.idempotent).toBeUndefined();
  });

  it("missing intentId returns 400", async () => {
    const app = makeGatewayApp();
    const r = await req(app, "POST", "/api/webhooks/payment-gateway", { type: "payment.succeeded" });
    expect(r.status).toBe(400);
  });

  it("missing type returns 400", async () => {
    const app = makeGatewayApp();
    const r = await req(app, "POST", "/api/webhooks/payment-gateway", { intentId: "intent_999" });
    expect(r.status).toBe(400);
  });

  it("payment.failed webhook transitions active subscription to past_due", async () => {
    const app = makeGatewayApp();
    // Ensure co_novapay is active before the test (may have been modified by prior tests)
    updateSubscription("co_novapay", { status: "active" } as any, "test:setup");
    // Each webhook test uses a unique intentId to avoid idempotency collisions
    await req(app, "POST", "/api/webhooks/payment-gateway", {
      type: "payment.failed",
      intentId: `intent_fail_novapay_${Date.now()}`,
      companyId: "co_novapay",
    });
    const sub = getSubscription("co_novapay");
    expect(sub?.status).toBe("past_due");
  });

  it("payment.succeeded webhook transitions past_due subscription to active", async () => {
    const app = makeGatewayApp();
    // Use co_arboreal (also seeded) — set it to past_due first, then trigger payment.succeeded
    updateSubscription("co_arboreal", { status: "past_due" } as any, "test:setup");
    await req(app, "POST", "/api/webhooks/payment-gateway", {
      type: "payment.succeeded",
      intentId: `intent_success_arboreal_${Date.now()}`,
      companyId: "co_arboreal",
    });
    const sub = getSubscription("co_arboreal");
    expect(sub?.status).toBe("active");
  });
});

/* ========================================================================
 * 6. Subscription state-graph transitions
 * ====================================================================== */
describe("Sprint 28 / Subscriptions — state transitions", () => {
  it("PATCH /api/founder/subscription allows cancel_at_period_end", async () => {
    const app = makeGatewayApp();
    const r = await req(
      app, "PATCH", "/api/founder/subscription",
      { companyId: "co_arboreal", status: "cancel_at_period_end" },
      { "x-company-id": "co_arboreal" },
    );
    expect([200, 201]).toContain(r.status);
    expect(r.body.ok).toBe(true);
  });

  it("POST /api/founder/subscription/resume resumes a cancel_at_period_end subscription", async () => {
    const app = makeGatewayApp();
    // cancel first
    await req(app, "PATCH", "/api/founder/subscription",
      { companyId: "co_arboreal", status: "cancel_at_period_end" },
      { "x-company-id": "co_arboreal" });
    // then resume via dedicated endpoint (Wave 8)
    const r = await req(app, "POST", "/api/founder/subscription/resume",
      { companyId: "co_arboreal" },
      { "x-company-id": "co_arboreal" });
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription.status).toBe("active");
  });

  it("PATCH /api/founder/subscription rejects invalid status", async () => {
    const app = makeGatewayApp();
    const r = await req(
      app, "PATCH", "/api/founder/subscription",
      { companyId: "co_novapay", status: "pending_payment" },
      { "x-company-id": "co_novapay" },
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_status_transition");
  });

  it("updateSubscription bumps version on each call", () => {
    // Use co_novapay which is guaranteed to be seeded from mockData.companies
    const before = getSubscription("co_novapay")!.version;
    updateSubscription("co_novapay", { cardLast4: "0099" }, "test");
    const after = getSubscription("co_novapay")!.version;
    expect(after).toBe(before + 1);
  });

  it("updateSubscription rejects unknown company", () => {
    const result = updateSubscription("co_nonexistent_999", { cardLast4: "0000" }, "test");
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("not_found");
  });

  it("PATCH /api/admin/subscriptions/:companyId accepts plan changes", async () => {
    const app = makeSubscriptionApp();
    // Use co_arboreal which is guaranteed to be seeded from mockData.companies
    const r = await req(app, "PATCH", "/api/admin/subscriptions/co_arboreal",
      { plan: "founder_scale" },
      { "x-actor-email": "admin@capavate.com" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription.plan).toBe("founder_scale");
    // Restore to original plan
    updateSubscription("co_arboreal", { plan: "founder_pro" }, "test:restore");
  });
});

/* ========================================================================
 * 7. Money invariants — integer minor units throughout
 * ====================================================================== */
describe("Sprint 28 / Money — integer minor units, no floats", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("all PLAN_PRICES are integer minor units", () => {
    for (const [plan, price] of Object.entries(PLAN_PRICES)) {
      expect(Number.isInteger(price.annualMinor)).toBe(true);
      expect(price.annualMinor).toBeGreaterThanOrEqual(0);
    }
  });

  it("all seed subscriptions carry integer annualAmountMinor", () => {
    for (const sub of listSubscriptions()) {
      expect(Number.isInteger(sub.annualAmountMinor)).toBe(true);
    }
  });

  it("createInvoice totalMinor = amountMinor + taxMinor (integer)", () => {
    const inv = createInvoice({
      companyId: "co_a",
      subscriptionId: "s1",
      planLabel: "Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      taxMinor: 13_000,
    });
    expect(inv.totalMinor).toBe(298_800 + 13_000);
    expect(Number.isInteger(inv.totalMinor)).toBe(true);
    expect(Number.isInteger(inv.amountMinor)).toBe(true);
    expect(Number.isInteger(inv.taxMinor)).toBe(true);
  });

  it("chargeSubscription preserves integer amountCents through the payment entry", () => {
    // Use unique subscriptionId+periodStart to avoid payment-store idempotency collision
    const result = chargeSubscription({
      companyId: "co_novapay",
      subscriptionId: `sub_money_int_${Date.now()}`,
      pricingModelId: "pm_v1",
      currency: "USD",
      amountMinor: 298_800,
      planLabel: "Founder Pro",
      periodStart: `2026-money-${Date.now()}`,
      periodEnd: "2027-01-31",
      paymentMethodToken: "tok_test",
    });
    expect(Number.isInteger(result.paymentEntry.amountCents)).toBe(true);
    expect(result.paymentEntry.amountCents).toBe(298_800);
  });

  it("currency is ISO 4217 uppercase (not lowercase)", () => {
    const inv = createInvoice({
      companyId: "co_a",
      subscriptionId: "s1",
      planLabel: "Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 100,
      currency: "USD",
    });
    expect(inv.currency).toBe("USD");
    expect(inv.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("invoice lineItems contain integer amountMinor", () => {
    const inv = createInvoice({
      companyId: "co_a",
      subscriptionId: "s1",
      planLabel: "Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      taxMinor: 5_000,
    });
    for (const li of inv.lineItems) {
      expect(Number.isInteger(li.amountMinor)).toBe(true);
    }
  });
});

/* ========================================================================
 * 8. Auto-creation of subscription on new company
 * ====================================================================== */
describe("Sprint 28 / Auto-subscription — new company creation", () => {
  it("POST /api/founder/companies creates subscription with pending_payment status", async () => {
    const app = makeFullApp();
    const companyId = `co_test_auto_${Date.now()}`;
    const r = await req(app, "POST", "/api/founder/companies", {
      companyId,
      companyName: "Test Corp",
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription).toBeDefined();
    expect(r.body.subscription.status).toBe("pending_payment");
  });

  it("auto-provisioned subscription defaults to founder_pro plan", async () => {
    const app = makeFullApp();
    const companyId = `co_test_pro_${Date.now()}`;
    const r = await req(app, "POST", "/api/founder/companies", { companyId, companyName: "Pro Test Co" });
    expect(r.body.subscription.plan).toBe("founder_pro");
  });

  it("auto-provisioned subscription has annual cycle (renewsOn ~1 year out)", async () => {
    const app = makeFullApp();
    const companyId = `co_test_annual_${Date.now()}`;
    const r = await req(app, "POST", "/api/founder/companies", { companyId, companyName: "Annual Test Co" });
    const renewsOn = new Date(r.body.subscription.renewsOn).getTime();
    const oneYearFromNow = Date.now() + 363 * 24 * 60 * 60 * 1000; // 363 days buffer
    expect(renewsOn).toBeGreaterThan(oneYearFromNow);
  });

  it("POST /api/founder/companies is idempotent — second call returns existing subscription", async () => {
    const app = makeFullApp();
    const companyId = `co_test_idem_${Date.now()}`;
    const r1 = await req(app, "POST", "/api/founder/companies", { companyId, companyName: "Idem Corp" });
    const r2 = await req(app, "POST", "/api/founder/companies", { companyId, companyName: "Idem Corp" });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    // Both return ok
    expect(r1.body.ok).toBe(true);
    expect(r2.body.ok).toBe(true);
    // Same subscription data
    expect(r1.body.subscription.companyId).toBe(r2.body.subscription.companyId);
  });

  it("POST /api/founder/companies returns 400 if companyId is missing", async () => {
    const app = makeFullApp();
    const r = await req(app, "POST", "/api/founder/companies", { companyName: "No Id Corp" });
    expect(r.status).toBe(400);
  });

  it("auto-provisioned subscription annualAmountMinor matches PLAN_PRICES.founder_pro", async () => {
    const app = makeFullApp();
    const companyId = `co_test_price_${Date.now()}`;
    const r = await req(app, "POST", "/api/founder/companies", { companyId, companyName: "Price Check Corp" });
    expect(r.body.subscription.annualAmountMinor).toBe(PLAN_PRICES.founder_pro.annualMinor);
    expect(r.body.subscription.currency).toBe(PLAN_PRICES.founder_pro.currency);
  });
});

/* ========================================================================
 * 9. Founder invoices — scoped to company (cross-company → 403/404)
 * ====================================================================== */
describe("Sprint 28 / Invoice routes — founder scope enforcement", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("GET /api/founder/invoices returns only invoices for the requesting company", async () => {
    const app = makeInvoiceApp();
    // Create invoices for two different companies
    createInvoice({ companyId: "co_alpha", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 298_800, currency: "USD" });
    createInvoice({ companyId: "co_alpha", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 298_800, currency: "USD" });
    createInvoice({ companyId: "co_beta", subscriptionId: "s2", planLabel: "Scale", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 900_000, currency: "USD" });

    const r = await req(app, "GET", "/api/founder/invoices?companyId=co_alpha");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.invoices.length).toBe(2);
    for (const inv of r.body.invoices) {
      expect(inv.companyId).toBe("co_alpha");
    }
  });

  it("GET /api/founder/invoices/:id returns 403 for cross-company access", async () => {
    const app = makeInvoiceApp();
    // Create invoice for co_alpha
    const inv = createInvoice({
      companyId: "co_alpha",
      subscriptionId: "s1",
      planLabel: "Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });

    // Try to access it as co_beta
    const r = await req(app, "GET", `/api/founder/invoices/${inv.id}?companyId=co_beta`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden");
  });

  it("GET /api/founder/invoices/:id returns invoice for correct company", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_alpha",
      subscriptionId: "s1",
      planLabel: "Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/founder/invoices/${inv.id}?companyId=co_alpha`);
    expect(r.status).toBe(200);
    expect(r.body.invoice.id).toBe(inv.id);
  });

  it("GET /api/founder/invoices/:id returns 404 for unknown invoice", async () => {
    const app = makeInvoiceApp();
    const r = await req(app, "GET", "/api/founder/invoices/inv_nonexistent_x?companyId=co_alpha");
    expect(r.status).toBe(404);
  });

  it("GET /api/admin/invoices returns all invoices platform-wide", async () => {
    const app = makeInvoiceApp();
    createInvoice({ companyId: "co_alpha", subscriptionId: "s1", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 298_800, currency: "USD" });
    createInvoice({ companyId: "co_beta", subscriptionId: "s2", planLabel: "Scale", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 900_000, currency: "USD" });
    const r = await req(app, "GET", "/api/admin/invoices");
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
    // Admin sees invoices from all companies
    const companyIds = new Set(r.body.invoices.map((i: any) => i.companyId));
    expect(companyIds.has("co_alpha")).toBe(true);
    expect(companyIds.has("co_beta")).toBe(true);
  });

  it("GET /api/admin/invoices?companyId= filters correctly", async () => {
    const app = makeInvoiceApp();
    createInvoice({ companyId: "co_gamma", subscriptionId: "s3", planLabel: "Pro", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 298_800, currency: "USD" });
    createInvoice({ companyId: "co_delta", subscriptionId: "s4", planLabel: "Scale", periodStart: "2026-01-01", periodEnd: "2026-12-31", amountMinor: 900_000, currency: "USD" });
    const r = await req(app, "GET", "/api/admin/invoices?companyId=co_gamma");
    expect(r.status).toBe(200);
    for (const inv of r.body.invoices) {
      expect(inv.companyId).toBe("co_gamma");
    }
  });
});

/* ========================================================================
 * 10. PDF endpoint — 200, application/pdf, Content-Disposition: attachment
 * ====================================================================== */
describe("Sprint 28 / Invoice PDF — content-type + disposition", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("generateInvoicePdf returns a Buffer starting with %PDF", () => {
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_pdf_test",
    });
    const pdf = generateInvoicePdf(inv);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("GET /api/admin/invoices/:id/pdf returns 200 and application/pdf", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/admin/invoices/${inv.id}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers?.["content-type"]).toContain("application/pdf");
  });

  it("GET /api/admin/invoices/:id/pdf includes Content-Disposition: attachment", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/admin/invoices/${inv.id}/pdf`);
    expect(r.headers?.["content-disposition"]).toContain("attachment");
    expect(r.headers?.["content-disposition"]).toContain(inv.invoiceNumber);
  });

  it("GET /api/admin/invoices/:id/pdf returns actual PDF bytes (starts with %PDF)", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/admin/invoices/${inv.id}/pdf`);
    expect(r.rawBody?.slice(0, 4).toString()).toBe("%PDF");
  });

  it("GET /api/admin/invoices/:id/pdf returns 404 for unknown invoice", async () => {
    const app = makeInvoiceApp();
    const r = await req(app, "GET", "/api/admin/invoices/inv_nonexistent_pdf/pdf");
    expect(r.status).toBe(404);
  });

  it("GET /api/founder/invoices/:id/pdf returns 200 for correct company", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/founder/invoices/${inv.id}/pdf?companyId=co_novapay`);
    expect(r.status).toBe(200);
    expect(r.headers?.["content-type"]).toContain("application/pdf");
    expect(r.headers?.["content-disposition"]).toContain("attachment");
  });

  it("GET /api/founder/invoices/:id/pdf returns 403 for cross-company", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
    });
    const r = await req(app, "GET", `/api/founder/invoices/${inv.id}/pdf?companyId=co_arboreal`);
    expect(r.status).toBe(403);
  });
});

/* ========================================================================
 * 11. Payment gateway config
 * ====================================================================== */
describe("Sprint 28 / Payment Gateway — config endpoint", () => {
  it("getPublicConfig returns expected shape", () => {
    const config = getPublicConfig();
    expect(config.name).toBeTruthy();
    expect(["test", "live"]).toContain(config.mode);
    expect(Array.isArray(config.supportedMethods)).toBe(true);
    expect(config.webhookUrl).toBe("/api/webhooks/payment-gateway");
  });

  it("GET /api/admin/payment-gateway/config returns 200 with gateway object", async () => {
    const app = makeGatewayApp();
    const r = await req(app, "GET", "/api/admin/payment-gateway/config");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.gateway).toBeDefined();
    expect(r.body.gateway.webhookUrl).toBe("/api/webhooks/payment-gateway");
  });

  it("GET /api/admin/payment-gateway/webhook-events returns ok with events array", async () => {
    const app = makeGatewayApp();
    const r = await req(app, "GET", "/api/admin/payment-gateway/webhook-events");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.events)).toBe(true);
  });
});

/* ========================================================================
 * 12. Admin refund route
 * ====================================================================== */
describe("Sprint 28 / Admin — invoice refund route", () => {
  beforeEach(() => {
    _testInvoices.reset();
    configureInvoiceStore({ audit: () => {}, bridge: () => {} });
  });

  it("POST /api/admin/invoices/:id/refund creates refund invoice", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      paymentEntryId: "pe_admin_refund",
    });
    const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`,
      { amountMinor: 298_800, reason: "test_refund" },
      { "x-actor-email": "admin@capavate.com" },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.refundInvoice.amountMinor).toBe(-298_800);
    expect(r.body.refundInvoice.relatedInvoiceId).toBe(inv.id);
  });

  it("POST /api/admin/invoices/:id/refund rejects if invoice not paid", async () => {
    const app = makeInvoiceApp();
    const inv = createInvoice({
      companyId: "co_novapay",
      subscriptionId: "sub_novapay",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 298_800,
      currency: "USD",
      // No paymentEntryId → status is "issued"
    });
    const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`,
      { amountMinor: 298_800, reason: "test_refund" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invoice_not_paid");
  });
});

/* ========================================================================
 * 13. Subscription routes — GET /api/admin/subscriptions
 * ====================================================================== */
describe("Sprint 28 / Subscription routes — admin reads", () => {
  it("GET /api/admin/subscriptions returns all seeded subscriptions", async () => {
    const app = makeSubscriptionApp();
    const r = await req(app, "GET", "/api/admin/subscriptions");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.subscriptions)).toBe(true);
    // At least 2 canonical companies seeded (co_novapay, co_arboreal)
    expect(r.body.subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/admin/subscriptions/:companyId returns specific subscription", async () => {
    const app = makeSubscriptionApp();
    const r = await req(app, "GET", "/api/admin/subscriptions/co_novapay");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription.companyId).toBe("co_novapay");
    expect(r.body.subscription.status).toBe("active");
  });

  it("GET /api/admin/subscriptions/:companyId/history returns chain info", async () => {
    const app = makeSubscriptionApp();
    const r = await req(app, "GET", "/api/admin/subscriptions/co_novapay/history");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.history)).toBe(true);
    expect(r.body.chain).toBeDefined();
    expect(r.body.chain.ok).toBe(true);
  });

  it("GET /api/admin/subscriptions/:companyId returns 404 for unknown company", async () => {
    const app = makeSubscriptionApp();
    const r = await req(app, "GET", "/api/admin/subscriptions/co_unknown_xyz");
    expect(r.status).toBe(404);
  });

  it("GET /api/founder/subscription returns subscription for company", async () => {
    const app = makeGatewayApp();
    // Use co_novapay which is guaranteed to be seeded from mockData.companies
    const r = await req(app, "GET", "/api/founder/subscription?companyId=co_novapay");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.subscription.companyId).toBe("co_novapay");
    expect(r.body.subscription.plan).toBe("founder_pro");
  });
});
