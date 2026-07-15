/**
 * W-CT — read-only cap-table snapshots (pending/projected + previous committed).
 *
 * Coverage:
 *   - PENDING: positions for an active/live round surface as pending/projected.
 *   - PREVIOUS (Option A): the last COMMITTED round that is NOT active/live is
 *     returned as the previous snapshot, with its committed positions.
 *   - PREVIOUS hidden when no prior committed round exists (only an active round).
 *   - Base (demo `securities`) rows for an active round also count as pending.
 *   - MONEY-CORE INTEGRITY: W-CT performs zero writes — the sacred
 *     captableCommitStore.ts sha16 stays `32ba97cbcdf97750`.
 *
 * The compute function is exercised directly with the real commit-store +
 * rounds-store readers (deterministic; no HTTP/auth seeding needed).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { commitFunded, clearLedger } from "../captableCommitStore";
import { createRound, _testAccessRounds } from "../roundsStore";
import { computeCaptableSnapshots } from "../captableSnapshotsStore";

const COMPANY = "co_wct_test";

/** Seed a round in a given state and return its id. */
function seedRound(name: string, state: string): string {
  const r = createRound({ companyId: COMPANY, name, state, type: "priced", instrument: "equity" } as any);
  return (r as any).id;
}

/** Seed a committed (priced) ledger position for a round. */
function seedCommit(roundId: string, investorId: string, amount: string, shares: string): void {
  const res = commitFunded({
    invitationId: `inv_${roundId}_${investorId}`,
    roundId,
    companyId: COMPANY,
    investorId,
    amount,
    currency: "USD",
    shares,
  });
  expect(res.ok).toBe(true);
}

beforeEach(() => {
  clearLedger();
  // Clear the in-memory rounds cache between tests if the store exposes it.
  try { (_testAccessRounds as any)?.reset?.(); } catch { /* best-effort */ }
});

describe("W-CT computeCaptableSnapshots", () => {
  it("surfaces an active/live round's committed positions as PENDING (projected)", () => {
    const activeRound = seedRound("Series A (open)", "open");
    seedCommit(activeRound, "inv_a1", "1000000.00", "100000");

    const snap = computeCaptableSnapshots(COMPANY, () => []);
    expect(snap.pending.hasPending).toBe(true);
    expect(snap.pending.roundIds).toContain(activeRound);
    expect(snap.pending.positions.length).toBeGreaterThanOrEqual(1);
    // No prior committed non-active round -> previous hidden.
    expect(snap.previous.hasPrevious).toBe(false);
  });

  it("returns the last COMMITTED non-active round as PREVIOUS (Option A)", () => {
    const closedRound = seedRound("Seed (closed)", "closed");
    const activeRound = seedRound("Series A (open)", "open");
    seedCommit(closedRound, "inv_seed1", "500000.00", "50000");
    seedCommit(activeRound, "inv_a1", "2000000.00", "80000");

    const snap = computeCaptableSnapshots(COMPANY, () => []);
    // Active round -> pending.
    expect(snap.pending.hasPending).toBe(true);
    expect(snap.pending.roundIds).toContain(activeRound);
    // Closed round -> previous.
    expect(snap.previous.hasPrevious).toBe(true);
    expect(snap.previous.roundId).toBe(closedRound);
    expect(snap.previous.positions.length).toBe(1);
    expect(snap.previous.positions[0].investmentAmount).toBe(500000);
  });

  it("picks the MOST RECENT committed non-active round when several exist", () => {
    const seed = seedRound("Seed (closed)", "closed");
    const bridge = seedRound("Bridge (closed)", "closed");
    seedCommit(seed, "inv_s1", "300000.00", "30000");
    seedCommit(bridge, "inv_b1", "700000.00", "35000"); // committed later -> higher seq

    const snap = computeCaptableSnapshots(COMPANY, () => []);
    expect(snap.previous.hasPrevious).toBe(true);
    // Bridge committed after Seed (higher seq) -> it is the "previous".
    expect(snap.previous.roundId).toBe(bridge);
  });

  it("hides PREVIOUS when only an active round has commits", () => {
    const activeRound = seedRound("Series A (open)", "open");
    seedCommit(activeRound, "inv_a1", "1000000.00", "100000");
    const snap = computeCaptableSnapshots(COMPANY, () => []);
    expect(snap.previous.hasPrevious).toBe(false);
  });

  it("counts base demo securities on an active round as PENDING", () => {
    const activeRound = seedRound("Series A (open)", "open");
    const baseSecurities = [
      { id: "sec_x", companyId: COMPANY, holderName: "Angel X", instrument: "equity", shares: 5000, investmentAmount: 250000, roundId: activeRound },
      { id: "sec_other", companyId: "co_other", holderName: "N/A", instrument: "equity", shares: 1, investmentAmount: 1, roundId: activeRound },
    ];
    const snap = computeCaptableSnapshots(COMPANY, () => baseSecurities);
    expect(snap.pending.hasPending).toBe(true);
    // Only the same-company row is included.
    expect(snap.pending.positions.some((p) => p.id === "sec_x")).toBe(true);
    expect(snap.pending.positions.some((p) => p.id === "sec_other")).toBe(false);
  });

  it("returns empty (both hidden) for a company with no rounds/commits", () => {
    const snap = computeCaptableSnapshots("co_nonexistent", () => []);
    expect(snap.pending.hasPending).toBe(false);
    expect(snap.previous.hasPrevious).toBe(false);
  });
});

describe("W-CT money-core integrity", () => {
  it("sacred captableCommitStore.ts sha16 is unchanged (32ba97cbcdf97750)", () => {
    const p = join(process.cwd(), "server", "captableCommitStore.ts");
    const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(sha.slice(0, 16)).toBe("32ba97cbcdf97750");
  });
});
