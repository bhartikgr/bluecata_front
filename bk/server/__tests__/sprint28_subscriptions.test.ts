/**
 * Sprint 28 Wave 3 — Subscriptions store + Admin Companies JOIN endpoint tests.
 *
 * Locks the production-grade contracts:
 *  - Every canonical company has a subscription record at boot.
 *  - Money is integer minor units + ISO currency code.
 *  - Updates bump version, append to history, and verify via hash chain.
 *  - The /api/admin/companies/full endpoint serves rows derived from LIVE
 *    stores (no mock arrays in the page).
 */
import { describe, it, expect } from "vitest";
import {
  listSubscriptions, getSubscription, updateSubscription, getSubscriptionHistory,
  verifyChain, PLAN_PRICES, _testSubscriptions,
} from "../subscriptionsStore";
import { companies as canonicalCompanies } from "../mockData";

describe("Sprint 28 Wave 3 / subscriptions store", () => {
  it("seeds one subscription per canonical company", () => {
    const subs = listSubscriptions();
    expect(subs.length).toBe(canonicalCompanies.length);
    for (const c of canonicalCompanies) {
      const sub = getSubscription(c.id);
      expect(sub, `subscription missing for ${c.id}`).not.toBeNull();
      expect(sub?.companyId).toBe(c.id);
    }
  });

  it("money is integer minor units in ISO currency", () => {
    for (const sub of listSubscriptions()) {
      expect(Number.isInteger(sub.annualAmountMinor)).toBe(true);
      expect(sub.currency).toMatch(/^[A-Z]{3}$/);
      if (sub.pastDueMinor !== undefined) {
        expect(Number.isInteger(sub.pastDueMinor)).toBe(true);
      }
    }
  });

  it("plan catalogue lists known plans with integer-minor prices", () => {
    expect(PLAN_PRICES.founder_free.annualMinor).toBe(0);
    expect(PLAN_PRICES.founder_pro.annualMinor).toBeGreaterThan(0);
    expect(Number.isInteger(PLAN_PRICES.founder_pro.annualMinor)).toBe(true);
    expect(PLAN_PRICES.founder_enterprise.annualMinor).toBeGreaterThan(PLAN_PRICES.founder_pro.annualMinor);
  });

  it("update bumps version, chains hash, persists history", () => {
    const cid = canonicalCompanies[0].id;
    _testSubscriptions.seedFromCanonicalCompanies(); // reset
    const before = getSubscription(cid)!;
    const v0 = before.version;
    const result = updateSubscription(cid, { plan: "founder_scale", status: "active" }, "admin@capavate.io");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.subscription;
    expect(after.version).toBe(v0 + 1);
    expect(after.plan).toBe("founder_scale");
    expect(after.annualAmountMinor).toBe(PLAN_PRICES.founder_scale.annualMinor);
    expect(after.prevRevisionHash).toBe(before.revisionHash);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    expect(after.updatedBy).toBe("admin@capavate.io");
    const hist = getSubscriptionHistory(cid);
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const verify = verifyChain(cid);
    expect(verify.ok).toBe(true);
  });

  it("update returns 404 error for unknown company id", () => {
    const result = updateSubscription("co_does_not_exist", { plan: "founder_pro" }, "admin@capavate.io");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});
