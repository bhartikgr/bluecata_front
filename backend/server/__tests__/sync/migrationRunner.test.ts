/**
 * Sprint 13 — Migration runner tests.
 *
 * Verifies:
 *  - dryRun returns one row per entity (24 entities) and reports wouldAdd > 0
 *    on a clean cursor
 *  - commit emits bridge events through BridgeOutbound
 *  - re-running commit is idempotent (cursor causes skip)
 *  - reset-cursor allows re-import
 */
import { describe, it, expect, beforeEach } from "vitest";
import { dryRun, commit, clearMigrationCursor } from "../../lib/migrationRunner";
import { BridgeOutbound } from "../../lib/bridgeOutbound";
import { ALL_ENTITY_KEYS } from "@shared/schemas/sync";
import { _testBridge } from "../../bridgeStore";

beforeEach(() => {
  clearMigrationCursor();
  _testBridge.resetChain();
  BridgeOutbound.__clearSpy();
});

describe("Sprint 13 — Migration runner", () => {
  it("dryRun returns one row per of 24 entities", () => {
    const rows = dryRun();
    expect(rows).toHaveLength(ALL_ENTITY_KEYS.length);
    for (const r of rows) {
      expect(ALL_ENTITY_KEYS).toContain(r.entityKey);
      expect(r.wouldAdd + r.wouldSkip).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(r.fieldsMapped)).toBe(true);
      expect(r.fieldsMapped.length).toBeGreaterThan(0);
    }
  });

  it("dryRun is non-destructive — does not advance cursor", () => {
    dryRun();
    dryRun();
    // Second dry-run still shows wouldAdd, not all skips
    const rows = dryRun();
    const totalAdd = rows.reduce((s, r) => s + r.wouldAdd, 0);
    expect(totalAdd).toBeGreaterThan(0);
  });

  it("commit emits bridge events for entities with mapped outbound types", () => {
    const before = BridgeOutbound.__getSpy().length;
    const results = commit();
    const after = BridgeOutbound.__getSpy().length;
    expect(after).toBeGreaterThan(before);
    const totalEmitted = results.reduce((s, r) => s + r.bridgeEventsEmitted, 0);
    expect(totalEmitted).toBeGreaterThanOrEqual(5); // company, investor, capTablePosition, auditEntry, lifecyclePolicy, maIntelligence
  });

  it("commit is idempotent — second commit skips everything", () => {
    const r1 = commit();
    const totalAdded1 = r1.reduce((s, r) => s + r.added, 0);
    expect(totalAdded1).toBeGreaterThan(0);

    BridgeOutbound.__clearSpy();
    const r2 = commit();
    const totalAdded2 = r2.reduce((s, r) => s + r.added, 0);
    const totalSkipped2 = r2.reduce((s, r) => s + r.skipped, 0);
    expect(totalAdded2).toBe(0);
    expect(totalSkipped2).toBeGreaterThan(0);
    // No new bridge events on re-run
    expect(BridgeOutbound.__getSpy().length).toBe(0);
  });

  it("reset-cursor clears the seen set so next commit re-imports", () => {
    commit();
    clearMigrationCursor();
    BridgeOutbound.__clearSpy();
    const r3 = commit();
    const totalAdded3 = r3.reduce((s, r) => s + r.added, 0);
    expect(totalAdded3).toBeGreaterThan(0);
  });

  it("commit covers 24 entity types (returns one MigrationCommitResult per)", () => {
    const r = commit();
    expect(r).toHaveLength(ALL_ENTITY_KEYS.length);
    const keysSeen = new Set(r.map(x => x.entityKey));
    for (const k of ALL_ENTITY_KEYS) {
      expect(keysSeen.has(k)).toBe(true);
    }
  });

  it("companyProfileUpdated fires for company migration row", () => {
    commit();
    const spy = BridgeOutbound.__getSpy();
    const companyEvents = spy.filter(s => s.eventType === "company.profile.updated");
    expect(companyEvents.length).toBeGreaterThanOrEqual(1);
    expect(companyEvents[0].aggregateId).toBe("co_novapay");
  });
});
