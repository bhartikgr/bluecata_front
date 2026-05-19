import { describe, it, expect } from "vitest";
import {
  computeCapTableMembers,
  ensureCapTableChannel,
  diffCapTableMembership,
} from "../channels";

const NOW = "2026-05-08T12:00:00Z";

describe("Sprint 9 — cap-table channel membership recompute", () => {
  it("seeds founder + every linked share-holding investor", () => {
    const members = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_founder",
      holders: [
        { userId: "u_inv1", shares: 1_500_000 },
        { userId: "u_inv2", shares: 0, investmentAmount: 500_000 }, // SAFE
      ],
    });
    expect(members.sort()).toEqual(["u_founder", "u_inv1", "u_inv2"].sort());
  });

  it("excludes holders with no userId (off-platform pool, e.g. ESOP)", () => {
    const members = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_founder",
      holders: [
        { shares: 2_000_000 }, // ESOP pool, no userId
        { userId: "u_inv1", shares: 1_000_000 },
      ],
    });
    expect(members.sort()).toEqual(["u_founder", "u_inv1"].sort());
  });

  it("excludes holders with zero shares + zero investment (transferred-out)", () => {
    const members = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_founder",
      holders: [
        { userId: "u_inv1", shares: 0, investmentAmount: 0 },
        { userId: "u_inv2", shares: 1_000_000 },
      ],
    });
    expect(members).toContain("u_founder");
    expect(members).toContain("u_inv2");
    expect(members).not.toContain("u_inv1");
  });

  it("dedupes when a user appears multiple times (multiple instruments)", () => {
    const members = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_founder",
      holders: [
        { userId: "u_inv1", shares: 1_000_000 },
        { userId: "u_inv1", investmentAmount: 250_000 },
      ],
    });
    expect(members.filter((m) => m === "u_inv1")).toHaveLength(1);
  });

  it("ensureCapTableChannel creates a fresh channel with deterministic id", () => {
    const ch = ensureCapTableChannel(undefined, {
      companyId: "co_novapay", founderUserId: "u_maya",
      holders: [{ userId: "u_hydra", shares: 1_500_000 }],
    }, NOW);
    expect(ch.id).toBe("captable__co_novapay");
    expect(ch.kind).toBe("cap_table");
    expect(ch.companyId).toBe("co_novapay");
    expect(ch.participantUserIds.sort()).toEqual(["u_hydra", "u_maya"].sort());
    expect(ch.metadata.founderUserId).toBe("u_maya");
    expect(ch.createdAt).toBe(NOW);
  });

  it("ensureCapTableChannel updates members on existing channel without changing createdAt", () => {
    const initial = ensureCapTableChannel(undefined, {
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_a", shares: 100 }],
    }, NOW);
    const later = ensureCapTableChannel(initial, {
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_a", shares: 100 }, { userId: "u_b", shares: 200 }],
    }, "2026-06-01T00:00:00Z");
    expect(later.createdAt).toBe(NOW);
    expect(later.participantUserIds.sort()).toEqual(["u_a", "u_b", "u_f"].sort());
  });

  it("diffCapTableMembership finds added + removed user IDs", () => {
    const d = diffCapTableMembership(["u_a", "u_b", "u_c"], ["u_b", "u_c", "u_d"]);
    expect(d.added).toEqual(["u_d"]);
    expect(d.removed).toEqual(["u_a"]);
  });

  it("transfer-out scenario removes the seller from membership", () => {
    const before = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_seller", shares: 1_000_000 }, { userId: "u_buyer", shares: 0 }],
    });
    const after = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_seller", shares: 0 }, { userId: "u_buyer", shares: 1_000_000 }],
    });
    const diff = diffCapTableMembership(before, after);
    expect(diff.added).toContain("u_buyer");
    expect(diff.removed).toContain("u_seller");
  });

  it("issuance to existing holder does not duplicate their membership", () => {
    const before = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_inv", shares: 500_000 }],
    });
    const after = computeCapTableMembers({
      companyId: "co_x", founderUserId: "u_f",
      holders: [{ userId: "u_inv", shares: 1_000_000 }], // additional shares
    });
    const diff = diffCapTableMembership(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
