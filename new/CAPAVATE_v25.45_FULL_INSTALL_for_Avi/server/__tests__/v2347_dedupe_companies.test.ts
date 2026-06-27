/**
 * v23.4.7 Phase 15 / B-101 — unit tests for the pure `planDedupe` helper.
 *
 * The route itself is gated by platform-admin auth and writes to SQLite; we
 * only test the planning logic here. The DB side is exercised by integration
 * runs in QA.
 */
import { describe, it, expect } from "vitest";
import { planDedupe } from "../lib/adminCleanupRoutes";

describe("v23.4.7 / B-101 — planDedupe", () => {
  it("keeps the lexicographically earliest id and soft-deletes the rest", () => {
    const rows = [
      { id: "c_zzz", tenant_id: "t1", name: "Acme Inc.", deleted_at: null },
      { id: "c_aaa", tenant_id: "t1", name: "Acme Inc.", deleted_at: null },
      { id: "c_mmm", tenant_id: "t1", name: " acme inc. ", deleted_at: null },
    ];
    const plan = planDedupe(rows);
    expect(plan.groupsFound).toBe(1);
    expect(plan.kept).toEqual([
      { id: "c_aaa", name: "Acme Inc.", tenantId: "t1" },
    ]);
    expect(plan.toSoftDelete.map((r) => r.id).sort()).toEqual([
      "c_mmm",
      "c_zzz",
    ]);
    for (const r of plan.toSoftDelete) {
      expect(r.keptId).toBe("c_aaa");
    }
  });

  it("ignores rows that are already soft-deleted", () => {
    const rows = [
      {
        id: "c_one",
        tenant_id: "t1",
        name: "Beta Co",
        deleted_at: "2025-01-01T00:00:00Z",
      },
      { id: "c_two", tenant_id: "t1", name: "Beta Co", deleted_at: null },
    ];
    const plan = planDedupe(rows);
    expect(plan.groupsFound).toBe(0);
    expect(plan.toSoftDelete).toHaveLength(0);
    expect(plan.kept).toHaveLength(0);
  });

  it("treats different tenants as separate groups (no cross-tenant merging)", () => {
    const rows = [
      { id: "c_a", tenant_id: "t1", name: "Same Name", deleted_at: null },
      { id: "c_b", tenant_id: "t2", name: "Same Name", deleted_at: null },
    ];
    const plan = planDedupe(rows);
    expect(plan.groupsFound).toBe(0);
    expect(plan.toSoftDelete).toHaveLength(0);
  });

  it("handles multiple independent duplicate clusters in one pass", () => {
    const rows = [
      { id: "c_a1", tenant_id: "t1", name: "Foo", deleted_at: null },
      { id: "c_a2", tenant_id: "t1", name: "Foo", deleted_at: null },
      { id: "c_b1", tenant_id: "t2", name: "Bar", deleted_at: null },
      { id: "c_b2", tenant_id: "t2", name: "Bar", deleted_at: null },
      { id: "c_b3", tenant_id: "t2", name: "Bar", deleted_at: null },
    ];
    const plan = planDedupe(rows);
    expect(plan.groupsFound).toBe(2);
    expect(plan.kept.map((k) => k.id).sort()).toEqual(["c_a1", "c_b1"]);
    expect(plan.toSoftDelete.map((r) => r.id).sort()).toEqual([
      "c_a2",
      "c_b2",
      "c_b3",
    ]);
  });
});
