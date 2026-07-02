/**
 * v25.48 NEW-1 — Collective-apply eligibility gates (server-enforced, DB-driven).
 *
 *  A) Company JOIN gate (both founder apply routes) — fail-closed
 *     not_active_subscriber unless the company is an ACTIVE PAID Capavate
 *     subscriber (canonical subscriptionStore, read-only).
 *  B) Investor JOIN gate (POST /api/collective/waitlist/investor-membership) —
 *     requires >=1 active cap-table position anywhere (fail-closed
 *     no_cap_table_position).
 *  C) Promote gate (POST /api/investor/collective/promote) — per-company
 *     isOnCapTable — UNCHANGED (not exercised destructively here).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, closeApp, call } from "./v25_48_helpers.mjs";
import { _testSubscriptionStore, recordPendingSubscription, activateByPaymentIntent } from "../subscriptionStore.ts";

// Schema-valid founder apply payloads (validation runs before the NEW-1 gate,
// so these must satisfy applicationSchema / nominationSchema to reach the gate).
const VALID_APPLICATION = {
  companyId: "co_novapay",
  founderId: "u_maya_chen",
  pitchDeckFilename: "deck.pdf",
  tractionMrr: 1000,
  tractionUsers: 50,
  tractionGrowthPct: 12,
  asks: "We are raising a seed round and seeking Collective introductions.",
  references: "",
  coverLetter: "x".repeat(120),
  feeAcknowledged: true,
};
const VALID_NOMINATION = {
  companyId: "co_novapay",
  founderId: "u_maya_chen",
  vouchingInvestorId: "u_aisha_patel",
  pitchSummary: "A strong fintech company seeking Collective review and support.",
};

let ctx;
beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1"; // enable the founder apply routes (invite-only beta flag)
  ctx = await buildApp();
}, 30_000);
afterAll(async () => { await closeApp(ctx.server); });

describe("v25.48 NEW-1 investor JOIN gate (cap-table required)", () => {
  it("investor WITH a cap-table position may join (not blocked by cap-table gate)", async () => {
    // u_aisha_patel is seeded on 2 cap tables.
    const res = await call(ctx.port, "POST", "/api/collective/waitlist/investor-membership", {
      userId: "u_aisha_patel",
      body: { chapterHint: "chap_default", fullApplicationPayload: {} },
    });
    // Must NOT be blocked with the cap-table 403. (201 created, or 409 already
    // on waitlist — both prove the cap-table gate passed.)
    expect(res.status).not.toBe(403);
    expect([201, 409]).toContain(res.status);
  });

  it("investor WITHOUT any cap-table position is blocked (403 no_cap_table_position)", async () => {
    const res = await call(ctx.port, "POST", "/api/collective/waitlist/investor-membership", {
      userId: "u_no_position",
      body: { chapterHint: "chap_default", fullApplicationPayload: {} },
    });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("no_cap_table_position");
  });

});

describe("v25.48 NEW-1 company JOIN gate (active paid subscriber required)", () => {
  it("company that is NOT an active subscriber → 403 not_active_subscriber on applications route", async () => {
    // u_maya_chen founds companies but has no active Capavate subscription row
    // seeded → the subscriber gate must fail closed BEFORE the round gate.
    const res = await call(ctx.port, "POST", "/api/founder/collective/applications", {
      userId: "u_maya_chen",
      body: VALID_APPLICATION,
    });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("not_active_subscriber");
  });

  it("company that is NOT an active subscriber → 403 not_active_subscriber on nominations route", async () => {
    const res = await call(ctx.port, "POST", "/api/founder/collective/nominations", {
      userId: "u_maya_chen",
      body: VALID_NOMINATION,
    });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("not_active_subscriber");
  });

  it("company WITH an active paid subscription passes the subscriber gate (advances past 403 not_active_subscriber)", async () => {
    // Seed an ACTIVE paid Capavate subscription for co_novapay.
    const pi = `pi_new1_${Date.now()}`;
    recordPendingSubscription({
      companyId: "co_novapay",
      tierId: "growth",
      userId: "u_maya_chen",
      billingCycle: "monthly",
      paymentIntentId: pi,
      amountMinor: 9900,
      currency: "USD",
    });
    activateByPaymentIntent(pi, { expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });

    const res = await call(ctx.port, "POST", "/api/founder/collective/applications", {
      userId: "u_maya_chen",
      body: VALID_APPLICATION,
    });
    // The subscriber gate now passes → the response must NOT be the
    // not_active_subscriber 403. (It may be 409 NO_ACTIVE_ROUND or 200 —
    // either proves NEW-1's company gate let it through.)
    expect(res.body?.error).not.toBe("not_active_subscriber");
  });
});
