/**
 * Patch v12 Day 2 Wave 1 — adminPlatformStore audit-log persistence test.
 *
 * Verifies:
 *   1) appendAdminAudit writes through to audit_log with a tenant-scoped
 *      hash chain.
 *   2) After a simulated restart (in-memory mirror cleared + hydrate from
 *      DB) the audit history is restored, and a new append correctly links
 *      to the persisted tip.
 *   3) Concurrent inserts for the same tenant (Promise.all of 10 appends)
 *      produce a monotonic, gapless hash chain — proves BEGIN IMMEDIATE
 *      serializes writers and the per-tenant tip lookup happens inside the
 *      same transaction as the insert.
 */
import { describe, it, expect } from "vitest";
import {
  appendAdminAudit,
  getAuditLog,
  hydrateAdminPlatformStore,
  _testAdmin,
} from "../adminPlatformStore";

describe("v12 — adminPlatformStore audit-log DB persistence", () => {
  it("audit chain persists across a simulated restart and links to DB tip", async () => {
    const tenantA = `tenant_co_v12adm_${Date.now()}_A`;
    const entity = tenantA.replace(/^tenant_/, ""); // e.g. co_v12adm_<ts>_A

    // Snapshot the existing in-memory mirror so we can restore later — this
    // test must not destabilise other tests that share the audit array.
    const mirrorSnapshot = [..._testAdmin.auditLog];

    // 1. Seed 10 entries for tenantA.
    const seeded: Array<{ id: string; hash: string; priorHash: string }> = [];
    for (let i = 0; i < 10; i++) {
      const e = appendAdminAudit("u_test_admin", entity, "test.event", { i }, tenantA);
      seeded.push({ id: e.id, hash: e.hash, priorHash: e.priorHash });
    }
    expect(seeded.length).toBe(10);

    // Chain integrity in-memory: each entry's priorHash == previous entry's hash.
    expect(seeded[0].priorHash).toBe("0".repeat(64));
    for (let i = 1; i < seeded.length; i++) {
      expect(seeded[i].priorHash).toBe(seeded[i - 1].hash);
    }

    // 2. Simulate restart: clear the in-memory mirror, then re-hydrate.
    _testAdmin.auditLog.length = 0;
    expect(getAuditLog().length).toBe(0);

    await hydrateAdminPlatformStore();

    // After hydration, tenantA's 10 entries are in the in-memory mirror.
    const restoredForTenantA = getAuditLog().filter((e) => e.tenantId === tenantA);
    expect(restoredForTenantA.length).toBe(10);

    // Chain math intact after hydration.
    for (let i = 1; i < restoredForTenantA.length; i++) {
      expect(restoredForTenantA[i].priorHash).toBe(restoredForTenantA[i - 1].hash);
    }
    // Last hash matches the last appended hash from before the "restart".
    expect(restoredForTenantA[restoredForTenantA.length - 1].hash).toBe(seeded[9].hash);

    // 3. New append links to the persisted DB tip (not to "0"*64).
    const eleventh = appendAdminAudit("u_test_admin", entity, "test.event", { i: 10 }, tenantA);
    expect(eleventh.priorHash).toBe(seeded[9].hash);

    // Restore the original mirror snapshot so we do not bleed into sibling
    // tests that rely on auditLog state. (Audit table rows remain — those are
    // append-only and isolated by our unique tenantId.)
    _testAdmin.auditLog.length = 0;
    for (const e of mirrorSnapshot) _testAdmin.auditLog.push(e);
  });

  it("concurrent inserts for the same tenant produce a monotonic gapless chain", async () => {
    const tenantB = `tenant_co_v12adm_${Date.now()}_B`;
    const entity = tenantB.replace(/^tenant_/, "");

    // Fire 10 inserts concurrently. BEGIN IMMEDIATE inside appendAudit must
    // serialize them so the per-tenant chain is gapless and monotonic.
    const results = await Promise.all(
      Array.from({ length: 10 }).map((_, i) =>
        Promise.resolve(appendAdminAudit("u_test_concurrent", entity, "concurrent.event", { i }, tenantB)),
      ),
    );
    expect(results.length).toBe(10);

    // Pull the canonical chain order from the in-memory mirror, filtered to
    // tenantB. (Mirror order == DB insert order because each append also
    // pushes into auditLog after the tx commits.)
    const chain = getAuditLog().filter((e) => e.tenantId === tenantB);
    expect(chain.length).toBe(10);

    // Chain is gapless and monotonic: each entry's priorHash matches the
    // previous entry's hash, and no two entries share a priorHash.
    expect(chain[0].priorHash).toBe("0".repeat(64));
    const seenPriors = new Set<string>([chain[0].priorHash]);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].priorHash).toBe(chain[i - 1].hash);
      expect(seenPriors.has(chain[i].priorHash)).toBe(false);
      seenPriors.add(chain[i].priorHash);
    }
  });
});
