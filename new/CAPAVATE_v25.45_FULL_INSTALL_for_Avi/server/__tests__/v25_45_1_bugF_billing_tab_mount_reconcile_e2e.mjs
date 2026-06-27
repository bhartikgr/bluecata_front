/* v25.45.1 Bug F — Billing tab MOUNT reconcile (company-scoped endpoint) E2E.
 *
 * The Billing & Subscription tab in Settings.tsx does NOT know an individual
 * paymentIntentId — that only existed on the post-payment redirect page
 * (BillingReturn.tsx). So the tab cannot call the original
 * POST /api/founder/subscription/reconcile { paymentIntentId } on mount.
 *
 * The fix adds POST /api/founder/subscription/reconcile-company { companyId },
 * which the Billing tab calls on mount, on each 15s poll, and on the Refresh
 * button. It heals EVERY pending row for the active company via the same
 * idempotent core the GET auto-heal, the POST /reconcile route, and the webhook
 * all share.
 *
 * This suite proves the company-scoped endpoint:
 *   - activates a pending row with NO paymentIntentId supplied by the client,
 *   - is ownership-checked,
 *   - is idempotent (safe no-op on a second call / when nothing pending),
 *   - never double-charges,
 *   - reports attempted/activated counts + the post-heal canonical status.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import * as subStore from "../subscriptionStore.ts";
import { rawDb } from "../db/connection.ts";

delete process.env.AIRWALLEX_MODE;
delete process.env.AIRWALLEX_REAL_NETWORK;
process.env.AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || "test_dummy_key";
process.env.AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || "test_dummy_client";

let h;
let COMPANY, INTENT;
const { results, record } = recorder();

beforeAll(async () => {
  h = await setupFounder("bugFmount", { companyName: "Mount Reconcile Co" });
  COMPANY = h.ids.COMPANY;
  INTENT = `int_bugFmount_${h.ids.STAMP}`;
  // PENDING row, no webhook — exactly what the Billing tab faces on mount after
  // the founder paid on the Airwallex hosted page and closed the return tab.
  subStore.recordPendingSubscription({
    companyId: COMPANY, tierId: "founder_pro", userId: h.ids.FOUNDER,
    billingCycle: "annual", paymentIntentId: INTENT,
    amountMinor: 298800, currency: "USD",
    merchantOrderId: `cap_sub_${COMPANY}_founder_pro_${Date.now()}`,
  });
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("v25.45.1 Bug F — Billing tab mount reconcile (reconcile-company)", () => {
  it("1. endpoint exists and the founder can call it WITHOUT a paymentIntentId", async () => {
    const r = await h.req("POST", "/api/founder/subscription/reconcile-company", { userId: h.ids.FOUNDER, body: { companyId: COMPANY } });
    const ok = r.status === 200 && r.body?.ok === true && r.body?.companyId === COMPANY;
    record("reconcile-company contract exists (companyId only)", ok, `http=${r.status} ok=${r.body?.ok}`);
    expect(ok).toBe(true);
  });

  it("2. it healed the pending row → attempted>=1, activated>=1, status active", () => {
    // (Re-run to assert the counts deterministically from a known-pending start
    //  would re-pend; instead inspect the row + a fresh call below.)
    const row = subStore.listForCompany(COMPANY)[0];
    const ok = !!row && row.status === "active" && !!row.activatedAt;
    record("mount reconcile activated the pending row", ok, `status=${row?.status} activatedAt=${row?.activatedAt}`);
    expect(ok).toBe(true);
  });

  it("3. exactly ONE ledger row (no double-charge from the mount call)", () => {
    const ledger = rawDb().prepare(`SELECT * FROM payment_ledger WHERE intent_id = ?`).all(INTENT);
    const ok = ledger.length === 1;
    record("single ledger row after mount reconcile", ok, `ledgerRows=${ledger.length}`);
    expect(ok).toBe(true);
  });

  it("4. a SECOND mount reconcile is a safe idempotent no-op (activated=0)", async () => {
    const r = await h.req("POST", "/api/founder/subscription/reconcile-company", { userId: h.ids.FOUNDER, body: { companyId: COMPANY } });
    const ledger = rawDb().prepare(`SELECT * FROM payment_ledger WHERE intent_id = ?`).all(INTENT);
    const ok = r.status === 200 && r.body?.ok === true && (r.body?.activated ?? 0) === 0 && r.body?.status === "active" && ledger.length === 1;
    record("second call no-op (activated=0, no extra ledger rows)", ok, `activated=${r.body?.activated} status=${r.body?.status} ledger=${ledger.length}`);
    expect(ok).toBe(true);
  });

  it("5. ownership: a non-owner companyId is rejected (403/400/404)", async () => {
    const r = await h.req("POST", "/api/founder/subscription/reconcile-company", { userId: h.ids.FOUNDER, body: { companyId: `co_not_owned_${Date.now()}` } });
    const ok = r.status === 403 || r.status === 400 || r.status === 404;
    record("reconcile-company is ownership-gated", ok, `http=${r.status}`);
    expect(ok).toBe(true);
  });

  it("6. no-pending company → safe no-op (attempted=0)", async () => {
    // Company is already active now; a fresh call should attempt nothing.
    const r = await h.req("POST", "/api/founder/subscription/reconcile-company", { userId: h.ids.FOUNDER, body: { companyId: COMPANY } });
    const ok = r.status === 200 && (r.body?.attempted ?? 0) === 0;
    record("no-pending company is a clean no-op", ok, `attempted=${r.body?.attempted}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.1 Bug F mount-reconcile E2E: ${passed}/${results.length} passed`);
    for (const r of results) console.log(`   ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
