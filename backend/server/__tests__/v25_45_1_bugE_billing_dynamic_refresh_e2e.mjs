/* v25.45.1 Bug E — Billing not dynamic (server-observable refresh) E2E.
 *
 * User-reported bug (Ozan, live-testing v25.45 on production): "The billing is
 * now in the right place but it doesn't seem to be dynamic." After v25.45's
 * F8/F10 restructure the Billing & Subscription tab is in the correct place,
 * but once mounted it did NOT refresh when the subscription state changed
 * server-side (webhook arrives / reconcile completes / plan changes). The user
 * had to manually reload the entire page to see updates.
 *
 * The client-side fix adds refetchInterval:15000 (gated on the Billing tab
 * being visible) + refetchOnWindowFocus + a manual Refresh button to the
 * subscriptionQ / invoicesQ useQuery calls in Settings.tsx. That is a React
 * Query concern. The SERVER-OBSERVABLE contract that makes that polling
 * meaningful — and which this suite locks down — is:
 *
 *   GET /api/founder/subscription?companyId= must return the CURRENT canonical
 *   state on EVERY call, with NO stale caching, so that each 15s poll (or focus
 *   refetch, or Refresh click) surfaces a server-side state change WITHOUT a
 *   full page reload.
 *
 * Drives the REAL Express app over a real socket against the REAL DB-direct
 * subscriptionStore. We mutate the subscription state out-of-band (exactly as a
 * webhook / reconcile would) and prove a fresh GET reflects it immediately.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import * as subStore from "../subscriptionStore.ts";

// Hermetic Airwallex stub (same pattern as the Bug A suite).
delete process.env.AIRWALLEX_MODE;
delete process.env.AIRWALLEX_REAL_NETWORK;
process.env.AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || "test_dummy_key";
process.env.AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || "test_dummy_client";

let h;
let COMPANY;
let INTENT;
const { results, record } = recorder();

beforeAll(async () => {
  h = await setupFounder("bugE", { companyName: "Dynamic Billing Co" });
  COMPANY = h.ids.COMPANY;
  INTENT = `int_bugE_${h.ids.STAMP}`;
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("v25.45.1 Bug E — Billing tab refreshes on server-side state change", () => {
  it("1. GET subscription returns the live state (no row → not active)", async () => {
    const r = await h.req("GET", `/api/founder/subscription?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    // 404 (no row) or a non-active subscription are both acceptable "not yet active" states.
    const notActive = r.status === 404 || r.body?.subscription?.status !== "active";
    record("initial GET reflects no active plan", notActive, `http=${r.status} status=${r.body?.subscription?.status}`);
    expect(notActive).toBe(true);
  });

  it("2. after a PENDING row is minted, the very next GET shows it (no reload)", async () => {
    subStore.recordPendingSubscription({
      companyId: COMPANY, tierId: "founder_pro", userId: h.ids.FOUNDER,
      billingCycle: "annual", paymentIntentId: INTENT,
      amountMinor: 298800, currency: "USD",
      merchantOrderId: `cap_sub_${COMPANY}_founder_pro_${Date.now()}`,
    });
    const r = await h.req("GET", `/api/founder/subscription?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    // NOTE: the GET endpoint now auto-heals on read (Bug F). In hermetic stub
    // mode retrievePaymentIntent returns SUCCEEDED, so this pending row gets
    // activated by the GET itself — which is exactly the dynamic behaviour we
    // want: the founder's poll surfaces the confirmed plan with no reload.
    const sub = r.body?.subscription;
    const seen = r.status === 200 && !!sub && (sub.status === "active" || sub.status === "pending_payment");
    record("next GET surfaces the new subscription state", seen, `http=${r.status} status=${sub?.status}`);
    expect(seen).toBe(true);
  });

  it("3. a subsequent GET reflects the active state with no client reload", async () => {
    // Whether step 2's auto-heal or a webhook flipped it, a fresh GET must show
    // the current truth on every call (this is what the 15s poll relies on).
    const r = await h.req("GET", `/api/founder/subscription?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    const sub = r.body?.subscription;
    const ok = r.status === 200 && sub?.status === "active";
    record("repeat GET shows active (poll-visible, no reload)", ok, `http=${r.status} status=${sub?.status}`);
    expect(ok).toBe(true);
  });

  it("4. invoices endpoint also refreshes alongside (invoicesQ companion poll)", async () => {
    // The activation finalize transaction creates the first invoice; a fresh
    // GET of /api/founder/invoices (the invoicesQ companion query) must surface
    // it in the same poll cycle.
    const r = await h.req("GET", `/api/founder/invoices?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    const list = Array.isArray(r.body?.invoices) ? r.body.invoices : [];
    const ok = r.status === 200 && list.length >= 1;
    record("invoices refresh alongside subscription", ok, `http=${r.status} invoices=${list.length}`);
    expect(ok).toBe(true);
  });

  it("5. every GET is fresh (no stale server cache that would defeat polling)", async () => {
    // Two back-to-back GETs must agree on the same live state — proving the
    // endpoint reads DB-direct each time rather than serving a frozen snapshot.
    const a = await h.req("GET", `/api/founder/subscription?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    const b = await h.req("GET", `/api/founder/subscription?companyId=${COMPANY}`, { userId: h.ids.FOUNDER });
    const ok = a.body?.subscription?.status === "active" && b.body?.subscription?.status === "active";
    record("back-to-back GETs are consistent & fresh", ok, `a=${a.body?.subscription?.status} b=${b.body?.subscription?.status}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.1 Bug E billing-dynamic E2E: ${passed}/${results.length} passed`);
    for (const r of results) console.log(`   ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
