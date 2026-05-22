/**
 * Sprint 13 — Drift detector tests.
 *
 * Reports per-(entity, aggregateId) drift status: clean | drifted | never_synced.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordLocalSnapshot,
  recordOutbound,
  recordAck,
  computeDrift,
  clearDriftState,
  seedSnapshot,
} from "../../lib/driftDetector";

beforeEach(() => {
  clearDriftState();
});

describe("Sprint 13 — Drift detector", () => {
  it("never_synced — local snapshot exists but no ack yet", () => {
    recordLocalSnapshot("company", "co_a", { id: "co_a", legalName: "Acme" });
    const rows = computeDrift();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityKey: "company",
      aggregateId: "co_a",
      status: "never_synced",
    });
  });

  it("clean — local matches last acked exactly", () => {
    const sample = { id: "co_a", legalName: "Acme", stage: "seed" };
    recordLocalSnapshot("company", "co_a", sample);
    recordOutbound("company", "co_a", sample);
    recordAck("company", "co_a", sample);
    const rows = computeDrift();
    expect(rows[0].status).toBe("clean");
    expect(rows[0].driftedFields).toBeUndefined();
    expect(rows[0].lastSyncedAt).toBeTruthy();
  });

  it("drifted — local diverges from last acked", () => {
    const original = { id: "co_a", legalName: "Acme", stage: "seed" };
    recordOutbound("company", "co_a", original);
    recordAck("company", "co_a", original);
    // Local mutates after ack — not yet re-synced.
    recordLocalSnapshot("company", "co_a", { id: "co_a", legalName: "Acme Inc", stage: "seed_extension" });
    const rows = computeDrift();
    expect(rows[0].status).toBe("drifted");
    expect(rows[0].driftedFields).toEqual(expect.arrayContaining(["legalName", "stage"]));
  });

  it("seedSnapshot populates one row per entity, all clean", () => {
    seedSnapshot();
    const rows = computeDrift();
    expect(rows.length).toBeGreaterThanOrEqual(20); // 24 entities seeded
    for (const r of rows) {
      expect(r.status).toBe("clean");
    }
  });

  it("partial drift on a single field", () => {
    recordOutbound("investor", "u_a", { userId: "u_a", kycStatus: "pending" });
    recordAck("investor", "u_a", { userId: "u_a", kycStatus: "pending" });
    recordLocalSnapshot("investor", "u_a", { userId: "u_a", kycStatus: "verified" });
    const rows = computeDrift();
    const inv = rows.find(r => r.entityKey === "investor");
    expect(inv?.status).toBe("drifted");
    expect(inv?.driftedFields).toEqual(["kycStatus"]);
  });

  it("multiple entities tracked independently", () => {
    recordLocalSnapshot("company", "co_a", { id: "co_a" });
    recordLocalSnapshot("investor", "u_a", { userId: "u_a" });
    recordAck("company", "co_a", { id: "co_a" });
    // investor never_synced
    const rows = computeDrift();
    expect(rows).toHaveLength(2);
    const c = rows.find(r => r.entityKey === "company");
    const i = rows.find(r => r.entityKey === "investor");
    expect(c?.status).toBe("clean");
    expect(i?.status).toBe("never_synced");
  });

  it("clearDriftState wipes all stores", () => {
    recordLocalSnapshot("company", "co_a", { id: "co_a" });
    expect(computeDrift().length).toBe(1);
    clearDriftState();
    expect(computeDrift().length).toBe(0);
  });
});
