/* v25.45 Bug A — Subscribe-unlock regression E2E.
 *
 * User-reported bug (Ozan Isinak): "I created a company called BluePrint
 * Catalyst Limited and subscribed to Capavate. Although I see the transaction
 * on my credit card, the system did not unlock the platform, nor was my
 * subscription visible on my Billing & Subscription page."
 *
 * Root cause (see build_spec/v25_45_bugA_rootcause.md): activation depended
 * SOLELY on the asynchronous Airwallex payment_intent.succeeded webhook. When
 * that webhook lags or fails, the capavate_subscriptions row stays `pending`,
 * the RequireActiveSubscription gate keeps the founder on the paywall, and the
 * Billing & Subscription page shows nothing — even though the card was charged.
 *
 * Fix under test:
 *   1. POST /api/founder/subscription/reconcile verifies the AUTHORITATIVE
 *      Airwallex intent status (retrievePaymentIntent — SUCCEEDED in test/stub)
 *      and finalizes the subscription via the SAME atomic DB path the webhook
 *      uses (status='active', current_period_end, payment_ledger, invoice).
 *   2. GET /api/founder/subscription/status?companyId= now returns the company's
 *      canonical status (previously it ONLY accepted paymentIntentId).
 *
 * This suite drives the REAL Express app (registerRoutes) over a real socket
 * and the REAL subscriptionStore (DB-direct). NO webhook is fired — the unlock
 * must come entirely from the client-return reconciliation path. It also proves
 * per-company isolation and DB-only persistence (survives a store re-hydrate,
 * i.e. a simulated process restart).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import * as subStore from "../subscriptionStore.ts";

// Hermetic stub mode so retrievePaymentIntent returns a deterministic SUCCEEDED
// WITHOUT a real network call: clearing AIRWALLEX_MODE + AIRWALLEX_REAL_NETWORK
// makes getAirwallexMode() resolve to `stub`. Credentials must still be present
// (ensureConfigured() runs before the stub short-circuit and is satisfied in
// production by the real .env keys); supply dummy creds for the hermetic run.
delete process.env.AIRWALLEX_MODE;
delete process.env.AIRWALLEX_REAL_NETWORK;
process.env.AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || "test_dummy_key";
process.env.AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || "test_dummy_client";

let h;
const { results, record } = recorder();

// The paid company (BluePrint Catalyst) and a SECOND company that must stay on
// its prior plan (per-company isolation proof).
let PAID_COMPANY;
let OTHER_COMPANY;
let PAID_INTENT;
let OTHER_INTENT;

beforeAll(async () => {
  h = await setupFounder("bugA", { companyName: "BluePrint Catalyst Limited" });
  PAID_COMPANY = h.ids.COMPANY;

  // Add a second company owned by the SAME founder; it never pays.
  OTHER_COMPANY = `co_v2545_bugA_other_${h.ids.STAMP}`;
  addCompanyForFounder(h.ids.FOUNDER, {
    companyId: OTHER_COMPANY,
    companyName: "Control Co (no subscription)",
    legalName: "Control Co, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "", stage: "", hq: "",
  });

  PAID_INTENT = `int_bugA_paid_${h.ids.STAMP}`;
  OTHER_INTENT = `int_bugA_other_${h.ids.STAMP}`;

  // Mint the PENDING rows exactly as POST /api/billing/plan does — no webhook
  // is fired for EITHER company.
  subStore.recordPendingSubscription({
    companyId: PAID_COMPANY, tierId: "founder_pro", userId: h.ids.FOUNDER,
    billingCycle: "annual", paymentIntentId: PAID_INTENT,
    amountMinor: 298800, currency: "USD",
    merchantOrderId: `cap_sub_${PAID_COMPANY}_founder_pro_${Date.now()}`,
  });
  subStore.recordPendingSubscription({
    companyId: OTHER_COMPANY, tierId: "founder_pro", userId: h.ids.FOUNDER,
    billingCycle: "annual", paymentIntentId: OTHER_INTENT,
    amountMinor: 298800, currency: "USD",
    merchantOrderId: `cap_sub_${OTHER_COMPANY}_founder_pro_${Date.now()}`,
  });
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("v25.45 Bug A — subscribe unlock (webhook-independent) E2E", () => {
  it("1. precondition: paid company's subscription starts PENDING (locked)", () => {
    const rows = subStore.listForCompany(PAID_COMPANY);
    const ok = rows.length === 1 && rows[0].status === "pending";
    record("paid company starts pending (locked)", ok, `status=${rows[0]?.status}`);
    expect(ok).toBe(true);
  });

  it("2. status?companyId= reports non-active BEFORE reconcile (the bug surface)", async () => {
    const r = await h.req("GET", `/api/founder/subscription/status?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.status !== "active";
    record("status?companyId= contract exists & returns non-active pre-reconcile", ok, `http=${r.status} status=${r.body?.status}`);
    expect(ok).toBe(true);
  });

  it("3. reconcile activates the paid company WITHOUT any webhook", async () => {
    const r = await h.req("POST", "/api/founder/subscription/reconcile", { userId: h.ids.FOUNDER, body: { paymentIntentId: PAID_INTENT } });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.status === "active" && r.body?.reconciled === true;
    record("reconcile -> active (no webhook)", ok, `http=${r.status} status=${r.body?.status} reconciled=${r.body?.reconciled}`);
    expect(ok).toBe(true);
  });

  it("4. capavate_subscriptions row is active, correct company_id, current_period_end set", () => {
    const rows = subStore.listForCompany(PAID_COMPANY);
    const row = rows[0];
    const ok = !!row
      && row.status === "active"
      && row.companyId === PAID_COMPANY
      && typeof row.currentPeriodEnd === "string"
      && row.currentPeriodEnd.length > 0
      && new Date(row.currentPeriodEnd).getTime() > Date.now();
    record("DB row active + right company_id + current_period_end", ok, `status=${row?.status} cid=${row?.companyId} cpe=${row?.currentPeriodEnd}`);
    expect(ok).toBe(true);
  });

  it("5. GET /api/founder/subscription/status?companyId= now returns active", async () => {
    const r = await h.req("GET", `/api/founder/subscription/status?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.status === "active" && r.body?.companyId === PAID_COMPANY;
    record("status?companyId= returns active", ok, `http=${r.status} status=${r.body?.status}`);
    expect(ok).toBe(true);
  });

  it("6. Billing & Subscription surface (GET /api/founder/subscription) reflects the active paid plan", async () => {
    const r = await h.req("GET", `/api/founder/subscription?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const sub = r.body?.subscription;
    const ok = r.status === 200 && r.body?.ok === true && sub?.status === "active";
    record("Billing page sees active subscription", ok, `http=${r.status} status=${sub?.status}`);
    expect(ok).toBe(true);
  });

  it("7. per-company isolation: the OTHER company stays in its prior (pending) plan", async () => {
    const rows = subStore.listForCompany(OTHER_COMPANY);
    const dbOk = rows.length === 1 && rows[0].status === "pending";
    const r = await h.req("GET", `/api/founder/subscription/status?companyId=${OTHER_COMPANY}`, { userId: h.ids.FOUNDER });
    const apiOk = r.status === 200 && r.body?.status !== "active";
    const ok = dbOk && apiOk;
    record("other company unaffected (still pending)", ok, `db=${rows[0]?.status} api=${r.body?.status}`);
    expect(ok).toBe(true);
  });

  it("8. unlock survives a process restart (DB-only persistence: re-hydrate from DB)", async () => {
    // Simulate a process restart: drop the in-memory write-through cache and
    // rebuild it strictly from the durable capavate_subscriptions table.
    subStore.hydrateSubscriptionStore();
    const rows = subStore.listForCompany(PAID_COMPANY);
    const row = rows[0];
    const dbOk = !!row && row.status === "active" && row.companyId === PAID_COMPANY && !!row.currentPeriodEnd;

    // And the live endpoint still reports active after the re-hydrate.
    const r = await h.req("GET", `/api/founder/subscription/status?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const apiOk = r.status === 200 && r.body?.status === "active";
    const ok = dbOk && apiOk;
    record("unlock survives restart (DB-only)", ok, `db=${row?.status} api=${r.body?.status}`);
    expect(ok).toBe(true);
  });

  it("9. reconcile is idempotent: a second call is a safe no-op (still active)", async () => {
    const r = await h.req("POST", "/api/founder/subscription/reconcile", { userId: h.ids.FOUNDER, body: { paymentIntentId: PAID_INTENT } });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.status === "active" && r.body?.reconciled === false;
    record("reconcile idempotent (second call no-op)", ok, `http=${r.status} status=${r.body?.status} reconciled=${r.body?.reconciled}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug A subscribe-unlock E2E: ${passed}/${results.length} passed`);
    for (const r of results) console.log(`   ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
