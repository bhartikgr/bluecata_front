/**
 * Patch v12 — Phase C persistence test.
 *
 * Verifies the subscriptionsStore now persists every plan upgrade to both
 * `subscriptions` (current state) and `subscriptions_history` (append-only
 * hash-chained). After a "simulated restart" (Map.clear() + hydrate from DB),
 * the upgrade must still be the current state and the history chain must be
 * intact.
 *
 * WAVE 134 cause 1-of-3 (R98) — WHY THIS FILE CHANGED
 * --------------------------------------------------
 * `updateSubscription` resolves the new plan's price from the admin-authored
 * pricing store and, since v25.27 removed the source-baked seed (R95/R96: pricing
 * is admin-set and database-driven), refuses with `plan_not_configured` when the
 * tier has not been published — correct behaviour that left this persistence test
 * asserting nothing. Per R98 the fixture is what changes: the shared
 * `_fixtures/pricingCatalogueFixture.ts` publishes the tiers first.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  createSubscriptionForNewCompany,
  updateSubscription,
  getSubscription,
  getSubscriptionHistory,
  hydrateSubscriptionsStore,
  _testSubscriptions,
} from "../subscriptionsStore";
import { authorFounderCatalogue } from "./_fixtures/pricingCatalogueFixture";

beforeAll(() => {
  /* WAVE 134 cause 1-of-3 (R98) — an admin must have published the tiers before a
     plan upgrade can be priced at all. */
  authorFounderCatalogue();
});

describe("v12 — subscriptionsStore DB persistence", () => {
  it("createSubscriptionForNewCompany + upgrade persists across a simulated restart", async () => {
    const companyId = `co_v12_sub_${Date.now()}`;

    // 1. Auto-create on company creation.
    const create = createSubscriptionForNewCompany(companyId, { plan: "founder_pro", actor: "test:create" });
    expect(create.ok).toBe(true);
    expect(create.created).toBe(true);
    expect(create.subscription.version).toBe(1);
    expect(create.subscription.plan).toBe("founder_pro");

    // 2. Upgrade to founder_scale.
    const upgrade = updateSubscription(companyId, { plan: "founder_scale", status: "active" }, "test:upgrade");
    expect(upgrade.ok).toBe(true);
    if (!upgrade.ok) return;
    expect(upgrade.subscription.version).toBe(2);
    expect(upgrade.subscription.plan).toBe("founder_scale");
    expect(upgrade.subscription.prevRevisionHash).toBe(create.subscription.revisionHash);

    // History chain has both versions.
    const historyBefore = getSubscriptionHistory(companyId);
    expect(historyBefore.length).toBeGreaterThanOrEqual(2);

    // 3. Simulate restart: clear Maps, hydrate from DB.
    _testSubscriptions.store.clear();
    _testSubscriptions.history.clear();
    /* WAVE 134 cause 1-of-3 (R98) — this line used to read
     *   expect(getSubscription(companyId)).toBeNull();
     * which was only reachable once the plan upgrade above stopped being refused,
     * and which encodes a premise that is no longer true: `getSubscription` now
     * READS THROUGH TO THE DURABLE `subscriptions` TABLE (see the comment at
     * subscriptionsStore.ts:418-421 — "the read source is the durable subscriptions
     * table"; the Map is a cache). A cleared cache therefore does NOT make the row
     * disappear, and demanding that it does would be demanding the RAM-only
     * behaviour Avi reported as the bug.
     *
     * The replacement is stronger: it pins that the in-memory caches really were
     * emptied (so the hydrate below is a genuine cold read, not a cache hit) AND
     * that the record survives an emptied cache — i.e. it is in the database,
     * which is the property this whole file exists to prove. */
    expect(_testSubscriptions.store.size).toBe(0);
    expect(_testSubscriptions.history.size).toBe(0);
    const fromDbWithEmptyCache = getSubscription(companyId);
    expect(fromDbWithEmptyCache, "the row must survive an emptied cache — it is in the DB").not.toBeNull();
    expect(fromDbWithEmptyCache!.plan).toBe("founder_scale");
    expect(fromDbWithEmptyCache!.version).toBe(2);

    await hydrateSubscriptionsStore();

    // 4. Current state restored from DB.
    const restored = getSubscription(companyId);
    expect(restored).not.toBeNull();
    expect(restored!.plan).toBe("founder_scale");
    expect(restored!.version).toBe(2);
    expect(restored!.revisionHash).toBe(upgrade.subscription.revisionHash);

    // 5. History restored & chain intact.
    const historyAfter = getSubscriptionHistory(companyId);
    expect(historyAfter.length).toBeGreaterThanOrEqual(2);
    const versions = historyAfter.map((h) => h.version);
    expect(versions).toContain(1);
    expect(versions).toContain(2);

    // verifyChain's per-company view expects index-0.prevRevisionHash == 0^64,
    // which only holds for the first-seeded company in this process. The
    // canonical invariant for a non-genesis company is that record N's
    // prevRevisionHash matches record N-1's revisionHash.
    for (let i = 1; i < historyAfter.length; i++) {
      expect(historyAfter[i].prevRevisionHash).toBe(historyAfter[i - 1].revisionHash);
    }
  });

  it("createSubscriptionForNewCompany is idempotent against the DB (second call returns existing)", () => {
    const companyId = `co_v12_idem_${Date.now()}`;
    const first = createSubscriptionForNewCompany(companyId);
    expect(first.created).toBe(true);
    const second = createSubscriptionForNewCompany(companyId);
    expect(second.created).toBe(false);
    expect(second.subscription.companyId).toBe(companyId);
  });
});
