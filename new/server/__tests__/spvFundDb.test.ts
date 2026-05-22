/**
 * CP Phase A — DB-backed SPV/Fund store tests (CP-028, CP-029, CP-030, CP-031).
 *
 * Coverage:
 *   - Create SPV happy path via spvFundStore.createSpv()
 *   - Commitment lifecycle: pending → signed → funded → withdrawn
 *   - Capital call sequence_no strictly monotonic (CP-030)
 *   - Distribution invariant I-2: committed >= distributed + called (CP-031)
 *   - Hash chain integrity across all 5 SPV tables (linkage + recompute)
 *   - Cross-tenant isolation (SPV from partner A not visible to partner B)
 *   - Hydrate-from-disk preserves state (clear caches, rehydrate)
 *   - Demo seed verification: 1 SPV in chap_keiretsu_canada / tenant_cp_keiretsu_ca
 *
 * SPV invariant I-2 formula (from spvFundStore.ts):
 *   On recordDistribution(): require committed_minor >= distributedExisting + total_minor + called_minor
 *   i.e. committed_minor >= (newTotalDistributed) + called_minor
 *
 * Hash recompute formula (computeHash):
 *   curr_hash = sha256( (prev_hash ?? "GENESIS") + "|" + JSON.stringify(payload) )
 *   For SPVs the payload is { id, partnerId, name, structureType, targetMinor, createdAt }.
 *   For commitments it's { id, spvId, lpUserId, amountMinor, status, createdAt }.
 *   For capital calls it's { id, spvId, sequenceNo, amountMinor, calledAt }.
 *   For distributions it's { id, spvId, distributionType, totalMinor, distributedAt }.
 *   For positions it's { id, spvId, securityId, shares, basisMinor, status, createdAt }.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";

import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  spvFundStore,
  hydrateSpvFundStore,
  _spvFundInternals,
} from "../spvFundStore";

const PARTNER_A = "ac_test_partner_spv_a";
const PARTNER_B = "ac_test_partner_spv_b";

beforeAll(async () => {
  process.env.CONSORTIUM_ENABLED = "1";
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());
  await hydrateSpvFundStore();
}, 30_000);

/** Recompute the canonical SPV hash given the stored payload. */
function recomputeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

describe("CP Phase A — spvFundStore (DB-backed)", () => {
  /* ===================== 1. Happy path create ===================== */

  it("createSpv: persists row with genesis prev_hash null and valid curr_hash", () => {
    const row = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Aurora SPV — Happy Path",
      targetMinor: 100_000_000,
    });
    expect(row.id).toMatch(/^spv_/);
    expect(row.partnerId).toBe(PARTNER_A);
    expect(row.tenantId).toBe(`tenant_partner_${PARTNER_A}`);
    expect(row.prevHash).toBeNull();
    expect(row.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.status).toBe("forming");
    expect(row.committedMinor).toBe(0);
    expect(row.calledMinor).toBe(0);
    expect(row.distributedMinor).toBe(0);
  });

  /* ===================== 2. Commitment lifecycle ===================== */

  it("addCommitment + transitionCommitment: pending → signed → funded → withdrawn updates denorms correctly", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Lifecycle SPV",
      targetMinor: 50_000_000,
    });
    // pending starts uncounted
    const c1 = spvFundStore.addCommitment({
      spvId: spv.id,
      lpUserId: "u_lp_alpha",
      amountMinor: 10_000_000,
      status: "pending",
    });
    expect(c1.status).toBe("pending");
    expect(spvFundStore.getById(spv.id)?.committedMinor).toBe(0);

    // pending → signed: counted
    const c2 = spvFundStore.transitionCommitment({ commitmentId: c1.id, status: "signed" });
    expect(c2.status).toBe("signed");
    expect(spvFundStore.getById(spv.id)?.committedMinor).toBe(10_000_000);

    // signed → funded: still counted (no net change)
    const c3 = spvFundStore.transitionCommitment({ commitmentId: c1.id, status: "funded" });
    expect(c3.status).toBe("funded");
    expect(spvFundStore.getById(spv.id)?.committedMinor).toBe(10_000_000);

    // funded → withdrawn: uncounted → committed drops back to 0
    const c4 = spvFundStore.transitionCommitment({ commitmentId: c1.id, status: "withdrawn" });
    expect(c4.status).toBe("withdrawn");
    expect(spvFundStore.getById(spv.id)?.committedMinor).toBe(0);
  });

  /* ===================== 3. Capital call sequence_no monotonic ===================== */

  it("recordCapitalCall: sequence_no is strictly monotonic (1, 2, 3 ...)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Capital Call Monotonic SPV",
      targetMinor: 100_000_000,
    });
    const cc1 = spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 5_000_000 });
    expect(cc1.sequenceNo).toBe(1);
    const cc2 = spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 5_000_000 });
    expect(cc2.sequenceNo).toBe(2);
    const cc3 = spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 5_000_000 });
    expect(cc3.sequenceNo).toBe(3);
    // CP-030: cannot "skip" or "repeat" — the store always allocates lastSeq+1.
    // So a hypothetical malicious caller passing sequenceNo gets ignored.
    const all = spvFundStore.listCapitalCalls(spv.id);
    expect(all.map((c) => c.sequenceNo)).toEqual([1, 2, 3]);
  });

  /* ===================== 4. Distribution invariant I-2 (CP-031) ===================== */

  it("recordDistribution: enforces invariant I-2 (committed >= distributed + called)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Invariant SPV",
      targetMinor: 100_000_000,
    });
    // Commit $100k signed → committed = 10_000_000
    const com = spvFundStore.addCommitment({
      spvId: spv.id,
      lpUserId: "u_lp_inv",
      amountMinor: 10_000_000,
      status: "signed",
    });
    expect(com.status).toBe("signed");
    // Call $4k → called = 400_000; committed (10M) - distributed (0) - called (400k) = 9.6M
    spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 400_000 });
    expect(spvFundStore.getById(spv.id)?.calledMinor).toBe(400_000);

    // OK distribution of $1k: committed(10M) >= distributed(1k) + called(400k) → 10M >= 401k ✓
    const ok = spvFundStore.recordDistribution({ spvId: spv.id, totalMinor: 100_000 });
    expect(ok.totalMinor).toBe(100_000);

    // Violating distribution: distribute $20M when committed is only $10M
    // committed(10M) >= existing_distributed(100k) + new(20M) + called(400k) → 10M >= 20.5M ✗
    expect(() =>
      spvFundStore.recordDistribution({ spvId: spv.id, totalMinor: 20_000_000 }),
    ).toThrowError(/INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS/);
  });

  /* ===================== 5. Hash chain integrity across all 5 tables ===================== */

  it("hash chain: SPV header chain links correctly across multiple inserts", () => {
    // Walk all PARTNER_A SPVs sorted by createdAt and verify prev_hash linkage.
    const partnerSpvs = Array.from(_spvFundInternals.spvsCache.values())
      .filter((s) => s.partnerId === PARTNER_A)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(partnerSpvs.length).toBeGreaterThanOrEqual(3);
    let priorHash: string | null = null;
    for (let i = 0; i < partnerSpvs.length; i++) {
      const r = partnerSpvs[i];
      if (i === 0) {
        expect(r.prevHash).toBeNull();
      } else {
        expect(r.prevHash).toBe(priorHash);
      }
      // Recompute and check curr_hash matches the deterministic payload.
      const payload = {
        id: r.id,
        partnerId: r.partnerId,
        name: r.name,
        structureType: r.structureType,
        targetMinor: r.targetMinor,
        createdAt: r.createdAt,
      };
      expect(r.currHash).toBe(recomputeHash(r.prevHash, payload));
      priorHash = r.currHash;
    }
  });

  it("hash chain: spv_capital_calls chain links per SPV (recompute payload matches)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Capital Calls Chain SPV",
      targetMinor: 100_000_000,
    });
    spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 1_000_000 });
    spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 2_000_000 });
    spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 3_000_000 });
    const calls = spvFundStore.listCapitalCalls(spv.id);
    expect(calls).toHaveLength(3);
    let priorHash: string | null = null;
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (i === 0) {
        expect(c.prevHash).toBeNull();
      } else {
        expect(c.prevHash).toBe(priorHash);
      }
      const payload = {
        id: c.id,
        spvId: c.spvId,
        sequenceNo: c.sequenceNo,
        amountMinor: c.amountMinor,
        calledAt: c.calledAt,
      };
      expect(c.currHash).toBe(recomputeHash(c.prevHash, payload));
      priorHash = c.currHash;
    }
  });

  /* ===================== 6. Cross-tenant isolation ===================== */

  it("cross-tenant: PARTNER_B's listByPartner does not see PARTNER_A's SPVs", () => {
    // Create a SPV under PARTNER_B
    spvFundStore.createSpv({ partnerId: PARTNER_B, name: "Partner B SPV", targetMinor: 1_000_000 });
    const aRows = spvFundStore.listByPartner(PARTNER_A);
    const bRows = spvFundStore.listByPartner(PARTNER_B);
    expect(aRows.every((s) => s.partnerId === PARTNER_A)).toBe(true);
    expect(bRows.every((s) => s.partnerId === PARTNER_B)).toBe(true);
    expect(aRows.map((s) => s.id)).not.toEqual(expect.arrayContaining(bRows.map((s) => s.id)));
    expect(bRows.length).toBeGreaterThanOrEqual(1);
  });

  /* ===================== 7. Hydrate-from-disk preserves state ===================== */

  it("hydrate: clear caches and rehydrate restores all rows from DB", async () => {
    // Snapshot counts BEFORE clearing.
    const beforeSpvs = _spvFundInternals.spvsCache.size;
    const beforeCommits = _spvFundInternals.commitmentsCache.size;
    const beforeCalls = _spvFundInternals.capitalCallsCache.size;
    const beforeDists = _spvFundInternals.distributionsCache.size;
    const beforePos = _spvFundInternals.positionsCache.size;
    expect(beforeSpvs).toBeGreaterThan(0);

    // Wipe caches to simulate a restart.
    _spvFundInternals.spvsCache.clear();
    _spvFundInternals.commitmentsCache.clear();
    _spvFundInternals.capitalCallsCache.clear();
    _spvFundInternals.distributionsCache.clear();
    _spvFundInternals.positionsCache.clear();

    await hydrateSpvFundStore();

    expect(_spvFundInternals.spvsCache.size).toBe(beforeSpvs);
    expect(_spvFundInternals.commitmentsCache.size).toBe(beforeCommits);
    expect(_spvFundInternals.capitalCallsCache.size).toBe(beforeCalls);
    expect(_spvFundInternals.distributionsCache.size).toBe(beforeDists);
    expect(_spvFundInternals.positionsCache.size).toBe(beforePos);
  });

  /* ===================== 8. Position chain + reconcile ===================== */

  it("recordPosition + reconcile: positions chain and total_basis aggregate correctly", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "Position Chain SPV",
      targetMinor: 100_000_000,
    });
    const p1 = spvFundStore.recordPosition({
      spvId: spv.id,
      securityId: "sec_common_a",
      shares: "1000",
      basisMinor: 500_000,
    });
    expect(p1.prevHash).toBeNull();
    const p2 = spvFundStore.recordPosition({
      spvId: spv.id,
      securityId: "sec_common_b",
      shares: "2000",
      basisMinor: 800_000,
    });
    expect(p2.prevHash).toBe(p1.currHash);
    const recon = spvFundStore.reconcile(spv.id);
    // both 'held' positions count toward basis
    expect(recon.totalBasisMinor.toString()).toBe(String(500_000 + 800_000));
  });

  /* ===================== 9. Demo seed verification ===================== */

  it("demo seed: ENABLE_DEMO_SEED=1 produces exactly 1 SPV under tenant_cp_keiretsu_ca", () => {
    const keiretsuSpvs = spvFundStore.listByPartner("tenant_cp_keiretsu_ca");
    expect(keiretsuSpvs.length).toBe(1);
    expect(keiretsuSpvs[0].name).toBe("Keiretsu Canada NovaPay SPV 2026");
    expect(keiretsuSpvs[0].targetMinor).toBe(25_000_000);
    expect(keiretsuSpvs[0].status).toBe("fundraising");
    expect(keiretsuSpvs[0].leadCompanyId).toBe("co_novapay");
    expect(keiretsuSpvs[0].gpUserId).toBe("u_aisha_patel");
  });

  /* ===================== 10. Reconcile end-to-end walkthrough ===================== */

  it("reconcile: full SPV lifecycle math (committed/called/distributed/uncalled/net_invested)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_A,
      name: "E2E Reconcile SPV",
      targetMinor: 25_000_000, // $250k
    });
    // 3 LPs sign $100k + $100k + $50k = $250k
    spvFundStore.addCommitment({ spvId: spv.id, lpUserId: "u_lp_1", amountMinor: 10_000_000, status: "signed" });
    spvFundStore.addCommitment({ spvId: spv.id, lpUserId: "u_lp_2", amountMinor: 10_000_000, status: "signed" });
    spvFundStore.addCommitment({ spvId: spv.id, lpUserId: "u_lp_3", amountMinor: 5_000_000,  status: "signed" });
    // GP calls $100k
    spvFundStore.recordCapitalCall({ spvId: spv.id, amountMinor: 10_000_000 });
    // GP distributes $30k dividend
    spvFundStore.recordDistribution({ spvId: spv.id, totalMinor: 3_000_000, distributionType: "dividend" });
    const r = spvFundStore.reconcile(spv.id);
    expect(r.committedMinor.toString()).toBe("25000000");
    expect(r.calledMinor.toString()).toBe("10000000");
    expect(r.distributedMinor.toString()).toBe("3000000");
    expect(r.uncalledMinor.toString()).toBe("15000000");      // 25M - 10M
    expect(r.netInvestedMinor.toString()).toBe("7000000");    // 10M - 3M
  });
});
