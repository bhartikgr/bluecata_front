/**
 * Bug A probe 2: the FAILED-WEBHOOK scenario (real production cause).
 * Airwallex webhooks can lag or never arrive (signature mismatch, network,
 * endpoint not reachable in prod). The client return-URL path (BillingReturn)
 * ONLY POLLS /api/founder/subscription/status?paymentIntentId=... — it never
 * activates. So if the webhook never lands, the capavate_subscriptions row
 * stays 'pending' forever => gate stays locked => "card charged but not unlocked".
 *
 * This probe proves:
 *  (a) without the webhook, the row stays pending and the gate endpoint
 *      reports a non-active status (locked).
 *  (b) /api/founder/subscription/status currently REQUIRES paymentIntentId and
 *      has NO companyId path (the task's required endpoint contract is missing).
 */
import express from "express";
import http from "node:http";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

async function main() {
  const subStore = await import("../server/subscriptionStore.ts");
  const companyId = "co_bp2_" + Math.random().toString(36).slice(2, 8);
  const userId = "u_ozan2";
  const tierId = "founder_pro";
  const intentId = "int_bp2_" + Math.random().toString(36).slice(2, 8);
  const merchantOrderId = `cap_sub_${companyId}_${tierId}_${Date.now()}`;

  subStore.recordPendingSubscription({
    companyId, tierId, userId, billingCycle: "annual",
    paymentIntentId: intentId, amountMinor: 298800, currency: "USD", merchantOrderId,
  });
  console.log("== Pending row written, NO webhook fired (simulating webhook lag/failure) ==");
  const rows = subStore.listForCompany(companyId);
  console.log("capavate_subscriptions:", rows.map(r => ({ status: r.status, companyId: r.companyId })));

  console.log("\n== Probe: does /api/founder/subscription/status?companyId= exist? ==");
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const { registerRoutes } = await import("../server/routes.ts");
  await registerRoutes(server, app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;

  // unauthenticated probe just to see the route's required params (will 401/400)
  const byCompany = await fetch(`http://127.0.0.1:${port}/api/founder/subscription/status?companyId=${companyId}`);
  console.log("GET status?companyId -> HTTP", byCompany.status, await byCompany.text());

  const byIntent = await fetch(`http://127.0.0.1:${port}/api/founder/subscription/status?paymentIntentId=${intentId}`);
  console.log("GET status?paymentIntentId -> HTTP", byIntent.status, await byIntent.text());

  server.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error("FATAL", e); process.exit(1); });
