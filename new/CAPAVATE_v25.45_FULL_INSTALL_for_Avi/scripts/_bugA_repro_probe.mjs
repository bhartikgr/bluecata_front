/**
 * Bug A reproduction probe.
 * Simulates: create new company (BluePrint Catalyst) -> pending capavate_subscriptions row
 * -> Airwallex payment_intent.succeeded webhook -> read gate endpoint /api/founder/subscription.
 *
 * Runs in-process against the real subscriptionStore + paymentGatewayAdapter modules.
 */
import express from "express";
import http from "node:http";

process.env.NODE_ENV = process.env.NODE_ENV || "test";

async function main() {
  const subStore = await import("../server/subscriptionStore.ts");
  const subsStoreLegacy = await import("../server/subscriptionsStore.ts");

  const companyId = "co_blueprint_" + Math.random().toString(36).slice(2, 8);
  const otherCompanyId = "co_other_" + Math.random().toString(36).slice(2, 8);
  const userId = "u_ozan_probe";
  const tierId = "founder_pro";
  const intentId = "int_probe_" + Math.random().toString(36).slice(2, 8);
  const merchantOrderId = `cap_sub_${companyId}_${tierId}_${Date.now()}`;

  console.log("== Step 1: simulate legacy createSubscriptionForNewCompany (paid default) ==");
  try {
    const r = subsStoreLegacy.createSubscriptionForNewCompany(companyId, { plan: "founder_pro", actor: "probe", trial: true });
    console.log("legacy create ok:", r.ok, "status:", r.subscription.status);
  } catch (e) { console.log("legacy create ERR:", e.message); }

  console.log("== Step 2: recordPendingSubscription (capavate_subscriptions) ==");
  try {
    const pend = subStore.recordPendingSubscription({
      companyId, tierId, userId, billingCycle: "annual",
      paymentIntentId: intentId, amountMinor: 298800, currency: "USD", merchantOrderId,
    });
    console.log("pending row:", { id: pend.id, companyId: pend.companyId, status: pend.status, pi: pend.paymentIntentId });
  } catch (e) { console.log("recordPending ERR:", e.message); }

  console.log("== Step 3: read capavate_subscriptions BEFORE webhook ==");
  try {
    const rows = subStore.listForCompany(companyId);
    console.log("listForCompany:", rows.map(r => ({ status: r.status, companyId: r.companyId })));
  } catch (e) { console.log("list ERR:", e.message); }

  console.log("== Step 4: fire Airwallex webhook (payment_intent.succeeded) ==");
  // Build an app with just the payment gateway routes.
  const app = express();
  app.use(express.json());
  // Minimal userContext shim
  const { registerPaymentGatewayRoutes } = await import("../server/paymentGatewayAdapter.ts").catch(() => ({}));
  // The webhook is registered inside registerRoutes; simplest: call the real route via full app.
  const server = http.createServer(app);
  const { registerRoutes } = await import("../server/routes.ts");
  await registerRoutes(server, app);

  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;

  // Airwallex shape: { name: "payment_intent.succeeded", data: { object: { id, status, merchant_order_id } } }
  const webhookBody = {
    name: "payment_intent.succeeded",
    data: { object: { id: intentId, status: "SUCCEEDED", merchant_order_id: merchantOrderId } },
  };
  const resp = await fetch(`http://127.0.0.1:${port}/api/webhooks/payment-gateway/airwallex`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhookBody),
  });
  console.log("webhook status:", resp.status, "body:", await resp.text());

  console.log("== Step 5: read capavate_subscriptions AFTER webhook ==");
  try {
    const rows = subStore.listForCompany(companyId);
    console.log("listForCompany AFTER:", rows.map(r => ({ status: r.status, companyId: r.companyId, activatedAt: r.activatedAt, cpe: r.currentPeriodEnd })));
  } catch (e) { console.log("list ERR:", e.message); }

  server.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL", e); process.exit(1); });
