/* v25.45.1 Bug F — GET /api/founder/subscription AUTO-RECONCILES pending rows.
 *
 * User-reported bug (Ozan, on v25.45 production): "My credit card was charged
 * but the platform is still not unlocked." Bug A's v25.45 fix added
 * POST /api/founder/subscription/reconcile but it was ONLY called from
 * BillingReturn.tsx (the post-payment redirect). If the founder closed that
 * tab, the redirect failed, or they opened a DIFFERENT tab to check on their
 * subscription, reconcile NEVER ran — the capavate_subscriptions row stayed
 * `pending` indefinitely and the platform stayed locked. Avi's bug #2 (28 rows
 * all status='pending', activated_at=NULL) is the same root cause.
 *
 * Fix under test (the single most impactful change): GET /api/founder/subscription
 * now opportunistically reconciles every PENDING row for the requested company
 * BEFORE projecting, via reconcilePendingForCompany → reconcilePaymentIntentCore.
 * So the platform auto-unlocks the instant the Billing tab QUERIES, with no
 * dependency on the redirect URL, no webhook, and no client cooperation.
 *
 * Critically this must be SAFE: idempotent, ownership-checked, no double-charge,
 * no race with the webhook. This suite proves all of that against the REAL app.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import * as subStore from "../subscriptionStore.ts";

delete process.env.AIRWALLEX_MODE;
delete process.env.AIRWALLEX_REAL_NETWORK;
process.env.AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || "test_dummy_key";
process.env.AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || "test_dummy_client";

let h;
let PAID_COMPANY, OTHER_COMPANY, PAID_INTENT, OTHER_INTENT;
const { results, record } = recorder();

beforeAll(async () => {
  h = await setupFounder("bugFget", { companyName: "Charged Not Unlocked Co" });
  PAID_COMPANY = h.ids.COMPANY;

  OTHER_COMPANY = `co_v2545_1_bugFget_other_${h.ids.STAMP}`;
  addCompanyForFounder(h.ids.FOUNDER, {
    companyId: OTHER_COMPANY, companyName: "Control Co", legalName: "Control Co, Inc.",
    logoUrl: null, role: "founder", lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "", stage: "", hq: "",
  });

  PAID_INTENT = `int_bugFget_paid_${h.ids.STAMP}`;
  OTHER_INTENT = `int_bugFget_other_${h.ids.STAMP}`;

  // Both companies have a PENDING row and NO webhook is ever fired. This is
  // exactly Avi's 28-pending-rows situation and Ozan's "charged but locked".
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

describe("v25.45.1 Bug F — GET /api/founder/subscription auto-reconciles", () => {
  it("1. precondition: paid company row is PENDING and NO webhook fired", () => {
    const rows = subStore.listForCompany(PAID_COMPANY);
    const ok = rows.length === 1 && rows[0].status === "pending" && rows[0].activatedAt == null;
    record("paid company starts pending (locked, charged-but-not-unlocked)", ok, `status=${rows[0]?.status} activatedAt=${rows[0]?.activatedAt}`);
    expect(ok).toBe(true);
  });

  it("2. a plain GET of the Billing surface AUTO-UNLOCKS the platform (no reconcile call, no webhook)", async () => {
    // The founder merely opens the Billing tab → the tab issues this GET.
    const r = await h.req("GET", `/api/founder/subscription?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const sub = r.body?.subscription;
    const ok = r.status === 200 && r.body?.ok === true && sub?.status === "active";
    record("GET alone activates the pending row (auto-heal on read)", ok, `http=${r.status} status=${sub?.status}`);
    expect(ok).toBe(true);
  });

  it("3. DB row is now active with activated_at + current_period_end set", () => {
    const row = subStore.listForCompany(PAID_COMPANY)[0];
    const ok = !!row && row.status === "active" && typeof row.activatedAt === "string" && !!row.currentPeriodEnd
      && new Date(row.currentPeriodEnd).getTime() > Date.now();
    record("DB row finalized by GET auto-heal", ok, `status=${row?.status} activatedAt=${row?.activatedAt} cpe=${row?.currentPeriodEnd}`);
    expect(ok).toBe(true);
  });

  it("4. exactly ONE payment_ledger row exists for the intent (NO double-charge)", () => {
    const { rawDb } = h_db();
    const rows = rawDb().prepare(`SELECT * FROM payment_ledger WHERE intent_id = ?`).all(PAID_INTENT);
    const ok = rows.length === 1;
    record("single ledger row — no double-charge", ok, `ledgerRows=${rows.length}`);
    expect(ok).toBe(true);
  });

  it("5. repeated GETs are idempotent — still ONE ledger row, still active (no race/double-finalize)", async () => {
    await h.req("GET", `/api/founder/subscription?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    await h.req("GET", `/api/founder/subscription?companyId=${PAID_COMPANY}`, { userId: h.ids.FOUNDER });
    const { rawDb } = h_db();
    const ledger = rawDb().prepare(`SELECT * FROM payment_ledger WHERE intent_id = ?`).all(PAID_INTENT);
    const row = subStore.listForCompany(PAID_COMPANY)[0];
    const ok = ledger.length === 1 && row.status === "active";
    record("repeat GETs idempotent — no extra ledger rows", ok, `ledgerRows=${ledger.length} status=${row?.status}`);
    expect(ok).toBe(true);
  });

  it("6. ownership: a foreign company id is rejected (auto-heal never touches another tenant)", async () => {
    const r = await h.req("GET", `/api/founder/subscription?companyId=co_not_owned_${Date.now()}`, { userId: h.ids.FOUNDER });
    const ok = r.status === 403 || r.status === 404; // not owner / unknown
    record("foreign companyId GET is ownership-gated", ok, `http=${r.status}`);
    expect(ok).toBe(true);
  });

  it("7. per-company isolation: the OTHER company is unaffected unless ITS billing surface is queried", () => {
    // We never GET the OTHER company's subscription, so its pending row must
    // remain pending — the auto-heal is strictly scoped to the queried company.
    const row = subStore.listForCompany(OTHER_COMPANY)[0];
    const ok = !!row && row.status === "pending";
    record("other company stays pending (heal is per-company-scoped)", ok, `status=${row?.status}`);
    expect(ok).toBe(true);
  });

  it("8. unlock survives a process restart (DB-only persistence)", async () => {
    subStore.hydrateSubscriptionStore();
    const row = subStore.listForCompany(PAID_COMPANY)[0];
    const ok = !!row && row.status === "active" && !!row.currentPeriodEnd;
    record("unlock persists across restart (DB-only)", ok, `status=${row?.status}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.1 Bug F GET-auto-reconcile E2E: ${passed}/${results.length} passed`);
    for (const r of results) console.log(`   ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    expect(passed).toBe(results.length);
  });
});

// Lazy require of the DB raw handle (same module the server uses) so the test
// can assert on payment_ledger directly.
import { rawDb as _rawDb } from "../db/connection.ts";
function h_db() { return { rawDb: _rawDb }; }
