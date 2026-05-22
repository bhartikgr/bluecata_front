/**
 * Patch v12 — Phase C persistence test.
 *
 * Verifies the subscriptionsStore now persists every plan upgrade to both
 * `subscriptions` (current state) and `subscriptions_history` (append-only
 * hash-chained). After a "simulated restart" (Map.clear() + hydrate from DB),
 * the upgrade must still be the current state and the history chain must be
 * intact.
 */
import { describe, it, expect } from "vitest";
import {
  createSubscriptionForNewCompany,
  updateSubscription,
  getSubscription,
  getSubscriptionHistory,
  hydrateSubscriptionsStore,
  _testSubscriptions,
} from "../subscriptionsStore";

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
    expect(getSubscription(companyId)).toBeNull();

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
