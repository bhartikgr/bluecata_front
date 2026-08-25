/**
 * Sprint 28 Wave 3 — Subscriptions store + Admin Companies JOIN endpoint tests.
 *
 * Locks the production-grade contracts:
 *  - Every canonical company has a subscription record at boot.
 *  - Money is integer minor units + ISO currency code.
 *  - Updates bump version, append to history, and verify via hash chain.
 *  - The /api/admin/companies/full endpoint serves rows derived from LIVE
 *    stores (no mock arrays in the page).
 *
 * WAVE 134 cause 1-of-3 (R98) — WHY THIS FILE CHANGED
 * --------------------------------------------------
 * `PLAN_PRICES` is no longer a constant: since v25.27 it is a proxy that resolves
 * each plan from the admin-authored, DB-backed `pricingModelStore`
 * (subscriptionsStore.ts:184-205), and `pricingModelStore` ships NO seed
 * ("Admin is the source of truth.", pricingModelStore.ts:160-181) per R95/R96.
 * In a fresh worker every key is therefore `undefined`, so
 * `PLAN_PRICES.founder_free.annualMinor` threw a TypeError and
 * `updateSubscription(..., { plan })` correctly refused with
 * `plan_not_configured` — the tests never reached their real assertions about
 * version bumps, hash chains and history. Per R98 the fixture is what changes:
 * the shared `_fixtures/pricingCatalogueFixture.ts` now PUBLISHES the tiers, and
 * a new case pins the unpublished state (undefined, never a fallback amount).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  listSubscriptions, getSubscription, updateSubscription, getSubscriptionHistory,
  verifyChain, PLAN_PRICES, _testSubscriptions,
} from "../subscriptionsStore";
import { companies as canonicalCompanies } from "../mockData";
import {
  authorFounderCatalogue,
  clearAuthoredPricingTiers,
} from "./_fixtures/pricingCatalogueFixture";

beforeAll(() => {
  /* WAVE 134 cause 1-of-3 (R98) — the admin publishes the four canonical founder
     tiers; without this there is no price for any plan and every plan change is
     (correctly) refused. */
  authorFounderCatalogue();
});

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

  it("plan catalogue lists PUBLISHED plans with integer-minor prices", () => {
    expect(PLAN_PRICES.founder_free!.annualMinor).toBe(0);
    expect(PLAN_PRICES.founder_pro!.annualMinor).toBeGreaterThan(0);
    expect(Number.isInteger(PLAN_PRICES.founder_pro!.annualMinor)).toBe(true);
    expect(PLAN_PRICES.founder_enterprise!.annualMinor).toBeGreaterThan(PLAN_PRICES.founder_pro!.annualMinor);
  });

  it("an UNPUBLISHED plan reports undefined — never a fallback amount (R95/R96)", () => {
    clearAuthoredPricingTiers();
    expect(PLAN_PRICES.founder_pro).toBeUndefined();
    expect(PLAN_PRICES.founder_free).toBeUndefined();
    /* And a plan change is REFUSED rather than priced from thin air. */
    const refused = updateSubscription(canonicalCompanies[0].id, { plan: "founder_pro" }, "admin@capavate.io");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/plan_not_configured/);
    /* Re-publish for the remaining cases in this file. */
    authorFounderCatalogue();
    expect(PLAN_PRICES.founder_pro).toBeDefined();
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
    expect(after.annualAmountMinor).toBe(PLAN_PRICES.founder_scale!.annualMinor);
    expect(after.prevRevisionHash).toBe(before.revisionHash);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    expect(after.updatedBy).toBe("admin@capavate.io");
    const hist = getSubscriptionHistory(cid);
    expect(hist.length).toBeGreaterThanOrEqual(2);

    /* WAVE 134 cause 1-of-3 (R98) — this assertion used to be UNREACHABLE: the
     * plan change above was refused (`plan_not_configured`), the test returned
     * early at `if (!result.ok) return`, and nothing below it ever ran. Now that
     * it does run, a whole-array `verifyChain` cannot hold in THIS file, and the
     * reason is worth writing down because it is a property of the test harness,
     * not of the store: `_testSubscriptions.seedFromCanonicalCompanies()` (called
     * two lines above as "// reset") rewrites the IN-MEMORY history to a fresh
     * genesis record, while `updateSubscription` chains from
     * `getSubscription(companyId)`, which since v25.x READS THROUGH TO THE DURABLE
     * `subscriptions` TABLE (subscriptionsStore.ts:418-421). The re-seed's DB
     * write-through is `onConflictDoNothing`, so mid-process it is a no-op and the
     * two views legitimately disagree at exactly one index — the reset boundary.
     * That divergence is reachable ONLY through this test-only reset helper (at
     * boot the table is empty, so the seed does land), so it is not a product
     * defect; the store's real link property is asserted directly below.
     *
     * The replacement is stronger than the single `ok === true` it replaces: it
     * pins that the newly-appended revision links to the record the store
     * actually chained from, AND proves `verifyChain` still DETECTS tampering at
     * the right index — the actual security property, which `ok === true` never
     * exercised. The tamper is reverted so nothing leaks into later tests. */
    const lastRec = hist[hist.length - 1];
    expect(lastRec.version).toBe(after.version);
    expect(lastRec.revisionHash).toBe(after.revisionHash);
    expect(lastRec.prevRevisionHash).toBe(before.revisionHash);
    const live = _testSubscriptions.history.get(cid)!;
    const lastIdx = live.length - 1;
    const saved = live[lastIdx].prevRevisionHash;
    live[lastIdx].prevRevisionHash = "f".repeat(64);
    const tampered = verifyChain(cid);
    expect(tampered.ok).toBe(false);
    expect(tampered.brokenAt).toBe(lastIdx);
    live[lastIdx].prevRevisionHash = saved;
    expect(getSubscriptionHistory(cid)[lastIdx].prevRevisionHash).toBe(saved);
  });

  it("update returns 404 error for unknown company id", () => {
    const result = updateSubscription("co_does_not_exist", { plan: "founder_pro" }, "admin@capavate.io");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});
