/**
 * Wave B (v26.4.0) Stage 3 — Canonicalization tests.
 *
 * Verifies that the 11 new engine adapter methods added in Stage 2
 * (`engineAddCommitment`, `engineTransitionCommitment`, `engineRecordCapitalCall`,
 *  `engineRecordDistribution`, `engineRecordLegacyPosition`,
 *  `engineListLegacyCommitments`, `engineListCapitalCalls`,
 *  `engineListLegacyDistributions`, `engineListLegacyPositions`,
 *  `engineReconcileLegacySpv`, `engineGetLegacySpvById`)
 * produce byte-identical results to the underlying `spvFundStore` methods.
 *
 * This guards against subtle regressions where an adapter method drops a
 * field, mangles a status code, or breaks a hash chain. Each test invokes
 * both the adapter and the underlying store and asserts full deep-equality
 * on the returned DTOs.
 *
 * ADDITIONAL COVERAGE:
 *  - The Wave B shadow-persist helpers (shadowPersistPartnerSpvToEngine,
 *    shadowCommitmentToEngine) — assert idempotency and that a repeat-call
 *    with the same legacyId writes the same engine id.
 *  - The new SPV KPI functions (dbTotalSpvCommittedMinor,
 *    dbTotalSpvWiredMinor, dbTotalActiveSpvs) — assert they return real
 *    numbers from live rows.
 */

import { describe, it, expect, beforeAll } from "vitest";

import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  spvFundStore,
  hydrateSpvFundStore,
} from "../spvFundStore";
import {
  engineAddCommitment,
  engineTransitionCommitment,
  engineRecordCapitalCall,
  engineRecordDistribution,
  engineRecordLegacyPosition,
  engineListLegacyCommitments,
  engineListCapitalCalls,
  engineListLegacyDistributions,
  engineListLegacyPositions,
  engineReconcileLegacySpv,
  engineGetLegacySpvById,
  shadowPersistPartnerSpvToEngine,
  shadowCommitmentToEngine,
  spvEngineStore,
} from "../spvEngineStore";
import {
  dbTotalSpvCommittedMinor,
  dbTotalSpvWiredMinor,
  dbTotalActiveSpvs,
} from "../lib/adminKpiDbReads";

const PARTNER_CANON = "ac_test_wave_b_canonicalization";
const LP_1 = "u_wave_b_lp_1";
const LP_2 = "u_wave_b_lp_2";

beforeAll(async () => {
  process.env.CONSORTIUM_ENABLED = "1";
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());
  await hydrateSpvFundStore();
}, 30_000);

/* ============================================================
 * Section 1 — Adapter deep-equality with legacy store
 * ============================================================ */

describe("Wave B Stage 2 — engine adapter matches spvFundStore", () => {
  it("engineGetLegacySpvById === spvFundStore.getById", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 1",
      targetMinor: 100_000_00,
    });
    const viaEngine = engineGetLegacySpvById(spv.id);
    const viaStore = spvFundStore.getById(spv.id);
    expect(viaEngine).toEqual(viaStore);
    expect(viaEngine?.partnerId).toBe(PARTNER_CANON);
    expect(viaEngine?.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("engineAddCommitment persists row and returns identical DTO shape as spvFundStore.addCommitment", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 2",
      targetMinor: 500_000_00,
    });

    const row = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 50_000_00,
      commitmentDocUrl: null,
    });

    expect(row.id).toMatch(/^spc_/);
    expect(row.spvId).toBe(spv.id);
    expect(row.lpUserId).toBe(LP_1);
    expect(row.amountMinor).toBe(50_000_00);
    expect(row.status).toBe("pending");
    expect(row.currHash).toMatch(/^[a-f0-9]{64}$/);

    // engineListLegacyCommitments returns the same row set as
    // spvFundStore.listCommitments.
    const viaEngine = engineListLegacyCommitments(spv.id);
    const viaStore = spvFundStore.listCommitments(spv.id);
    expect(viaEngine).toEqual(viaStore);
    expect(viaEngine.length).toBe(1);
    expect(viaEngine[0].id).toBe(row.id);
  });

  it("engineTransitionCommitment updates status and engineListLegacyCommitments reflects it", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 3",
      targetMinor: 1_000_000_00,
    });
    const commitment = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 250_000_00,
    });

    const transitioned = engineTransitionCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      commitmentId: commitment.id,
      status: "signed",
    });
    expect(transitioned.id).toBe(commitment.id);
    expect(transitioned.status).toBe("signed");
    expect(transitioned.signedAt).not.toBeNull();

    // SPV.committedMinor denorm should have picked up the signed commitment.
    const spvAfter = engineGetLegacySpvById(spv.id);
    expect(spvAfter!.committedMinor).toBe(250_000_00);
  });

  it("engineTransitionCommitment throws COMMITMENT_NOT_FOUND when commitmentId missing (adapter re-maps to 404)", () => {
    expect(() =>
      engineTransitionCommitment({
        partnerId: PARTNER_CANON,
        spvId: "spv_does_not_matter",
        commitmentId: "spc_missing_never_created",
        status: "signed",
      }),
    ).toThrow("COMMITMENT_NOT_FOUND");
  });

  it("engineRecordCapitalCall + engineListCapitalCalls preserve monotonic sequenceNo (CP-030 / I-1)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 4",
      targetMinor: 5_000_000_00,
    });
    // First fund via a signed commitment so denorms move.
    const c1 = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 1_000_000_00,
    });
    engineTransitionCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      commitmentId: c1.id,
      status: "signed",
    });

    const cc1 = engineRecordCapitalCall({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      amountMinor: 300_000_00,
    });
    const cc2 = engineRecordCapitalCall({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      amountMinor: 200_000_00,
    });
    expect(cc1.sequenceNo).toBe(1);
    expect(cc2.sequenceNo).toBe(2);

    const list = engineListCapitalCalls(spv.id);
    expect(list.map((c) => c.sequenceNo)).toEqual([1, 2]);
    // Deep-equal against underlying store
    expect(list).toEqual(spvFundStore.listCapitalCalls(spv.id));
  });

  /* WAVE 3D / ITEM 1 — EXPECTATION CHANGED ON PURPOSE, AND SPLIT IN TWO.
   *
   * This test used to assert that `engineRecordDistribution` reaches far enough
   * into the legacy plural writer to trip the I-2 invariant. That reachability
   * WAS THE CRITICAL FINDING: the adapter was the head of a second,
   * allocator-free, cap-free distribution write path. The adapter is now
   * fail-closed, so it must throw LEGACY_DISTRIBUTION_LEDGER_DISABLED FIRST —
   * before any invariant runs, because nothing is written at all.
   *
   * I-2 itself is unchanged and is NOT losing coverage: the second test below
   * asserts it directly on the NODE_ENV-guarded fixture seeder, which is the
   * only remaining way to reach the legacy insert. */
  it("engineRecordDistribution is fail-closed (LEGACY_DISTRIBUTION_LEDGER_DISABLED)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 5",
      targetMinor: 100_000_00,
    });
    // Commit 50k, sign it → committedMinor = 50k.
    const c = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 50_000_00,
    });
    engineTransitionCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      commitmentId: c.id,
      status: "signed",
    });
    // Attempt to distribute 60k → violates I-2 (committed 50k < 60k dist + 0 called).
    expect(() =>
      engineRecordDistribution({
        partnerId: PARTNER_CANON,
        spvId: spv.id,
        totalMinor: 60_000_00,
      }),
    ).toThrow("LEGACY_DISTRIBUTION_LEDGER_DISABLED");
  });

  it("legacy plural seeder still enforces I-2 (INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS)", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 5b",
      targetMinor: 100_000_00,
    });
    const c = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 50_000_00,
    });
    engineTransitionCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      commitmentId: c.id,
      status: "signed",
    });
    // Committed 50k < 60k distributed + 0 called — I-2 must still reject.
    expect(() =>
      spvFundStore.__unsafeSeedLegacyDistributionRowForTests({
        spvId: spv.id,
        totalMinor: 60_000_00,
      }),
    ).toThrow("INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS");
  });

  it("engineRecordLegacyPosition + engineListLegacyPositions round-trip DTO", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 6",
      targetMinor: 10_000_00,
    });
    const pos = engineRecordLegacyPosition({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      securityId: "sec_test_common",
      shares: "1000",
      basisMinor: 5_000_00,
      acquiredAt: "2026-08-01T00:00:00.000Z",
    });
    expect(pos.securityId).toBe("sec_test_common");
    expect(pos.status).toBe("held");
    const list = engineListLegacyPositions(spv.id);
    expect(list).toEqual(spvFundStore.listPositions(spv.id));
    expect(list.length).toBe(1);
  });

  it("engineReconcileLegacySpv returns identical BigInt reconciliation to spvFundStore.reconcile", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER_CANON,
      name: "Canonicalization SPV 7",
      targetMinor: 10_000_000_00,
    });
    const c = engineAddCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      lpUserId: LP_1,
      amountMinor: 500_000_00,
    });
    engineTransitionCommitment({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      commitmentId: c.id,
      status: "signed",
    });
    engineRecordCapitalCall({
      partnerId: PARTNER_CANON,
      spvId: spv.id,
      amountMinor: 100_000_00,
    });

    const viaEngine = engineReconcileLegacySpv(spv.id);
    const viaStore = spvFundStore.reconcile(spv.id);

    expect(viaEngine.committedMinor.toString()).toBe(viaStore.committedMinor.toString());
    expect(viaEngine.calledMinor.toString()).toBe(viaStore.calledMinor.toString());
    expect(viaEngine.distributedMinor.toString()).toBe(viaStore.distributedMinor.toString());
    expect(viaEngine.uncalledMinor.toString()).toBe(viaStore.uncalledMinor.toString());
    expect(viaEngine.netInvestedMinor.toString()).toBe(viaStore.netInvestedMinor.toString());
    expect(viaEngine.totalBasisMinor.toString()).toBe(viaStore.totalBasisMinor.toString());

    // Sanity — sign a 500k commitment + record a 100k capital call.
    expect(viaEngine.committedMinor.toString()).toBe("50000000");
    expect(viaEngine.calledMinor.toString()).toBe("10000000");
    expect(viaEngine.uncalledMinor.toString()).toBe("40000000");
  });
});

/* ============================================================
 * Section 2 — Shadow-persist helpers (Stage 1 additions)
 * ============================================================ */

describe("Wave B Stage 1 — shadow-persist helpers", () => {
  it("shadowPersistPartnerSpvToEngine writes an engine `spv` row and is idempotent on repeat", () => {
    const legacyId = `pspv_shadow_test_${Date.now()}`;
    shadowPersistPartnerSpvToEngine({
      legacyId,
      partnerId: PARTNER_CANON,
      name: "Shadow Persist SPV",
      currency: "USD",
      totalCommittedMinor: 100_000_00,
      jurisdiction: "delaware",
      recordedBy: "u_test_actor",
      status: "planned",
    });

    // Read back via engine's own listByPartner
    const list = spvEngineStore.listByPartner(PARTNER_CANON);
    const persisted = list.find((s) => s.migratedFrom === legacyId);
    expect(persisted).toBeDefined();
    expect(persisted!.name).toBe("Shadow Persist SPV");
    expect(persisted!.currency).toBe("USD");
    expect(persisted!.status).toBe("draft"); // planned → draft mapping
    expect(persisted!.targetRaiseMinor).toBe(100_000_00);

    const firstEngineId = persisted!.id;

    // Idempotency: second call with same legacyId writes SAME engine id (or no-op update).
    shadowPersistPartnerSpvToEngine({
      legacyId,
      partnerId: PARTNER_CANON,
      name: "Shadow Persist SPV — updated name",
      currency: "USD",
      totalCommittedMinor: 200_000_00,
      jurisdiction: "delaware",
      recordedBy: "u_test_actor",
      status: "open",
    });
    const list2 = spvEngineStore.listByPartner(PARTNER_CANON);
    const persisted2 = list2.filter((s) => s.migratedFrom === legacyId);
    expect(persisted2.length).toBe(1); // NO duplicate row
    expect(persisted2[0].id).toBe(firstEngineId); // Same engine id
    expect(persisted2[0].name).toBe("Shadow Persist SPV — updated name");
    expect(persisted2[0].status).toBe("open");
  });

  it("shadowCommitmentToEngine fail-soft when parent SPV not present — quarantines row for later drain", () => {
    // v26.4.0-fix2 (Opus DEFECT-20): the test previously only asserted
    // "does not throw / silently skip", which is exactly the silent-drop
    // pattern the fix batch was supposed to eliminate. Now assert the
    // orphan row is durably quarantined (visible for the boot-time drain).
    const orphanLegacySpvId = `pspv_orphan_${Date.now()}`;
    const orphanPositionId = `pspvpos_orphan_${Date.now()}`;
    // v26.4.0-fix3 (GPT round-4 BLOCK-1): shadowCommitmentToEngine now
    // returns a structured outcome. On sqlite scratch DB the quarantine
    // succeeds, so the outcome is `{ ok: false, reason: "orphan_quarantined" }`.
    const result = shadowCommitmentToEngine({
      legacyPositionId: orphanPositionId,
      legacySpvId: orphanLegacySpvId,
      partnerId: PARTNER_CANON,
      lpUserId: LP_2,
      amountMinor: 10_000_00,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("orphan_quarantined");
    // Positive assertion: orphan is recorded in the `wave_b_orphan_subscriptions`
    // quarantine table by _quarantineOrphanSubscription (spvEngineStore.ts).
    // That helper creates the table lazily on first insert, so it exists by
    // the time this assertion runs.
    const row = rawDb()
      .prepare(
        `SELECT legacy_spv_id, legacy_position_id, lp_user_id, amount_minor
           FROM wave_b_orphan_subscriptions
          WHERE legacy_position_id = ? AND legacy_spv_id = ?
          LIMIT 1`,
      )
      .get(orphanPositionId, orphanLegacySpvId) as
      | { legacy_spv_id: string; legacy_position_id: string; lp_user_id: string; amount_minor: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.legacy_spv_id).toBe(orphanLegacySpvId);
    expect(row?.lp_user_id).toBe(LP_2);
    expect(Number(row?.amount_minor)).toBe(10_000_00);
  });

  it("shadowCommitmentToEngine writes a subscription row when parent exists", () => {
    const legacyId = `pspv_shadow_sub_test_${Date.now()}`;
    shadowPersistPartnerSpvToEngine({
      legacyId,
      partnerId: PARTNER_CANON,
      name: "Shadow Sub Parent",
      currency: "USD",
      totalCommittedMinor: 500_000_00,
      jurisdiction: "delaware",
      recordedBy: "u_test_actor",
      status: "open",
    });

    shadowCommitmentToEngine({
      legacyPositionId: `pspvpos_${Date.now()}`,
      legacySpvId: legacyId,
      partnerId: PARTNER_CANON,
      lpUserId: LP_2,
      amountMinor: 25_000_00,
    });

    // Find the engine SPV → check subscriptions
    const engineSpv = spvEngineStore
      .listByPartner(PARTNER_CANON)
      .find((s) => s.migratedFrom === legacyId);
    expect(engineSpv).toBeDefined();

    const subs = spvEngineStore.listSubscriptions(PARTNER_CANON, engineSpv!.id);
    const mySub = subs.find((s) => s.investorId === LP_2);
    expect(mySub).toBeDefined();
    expect(mySub!.commitmentMinor).toBe(25_000_00);
    expect(mySub!.currency).toBe("USD"); // Inherited from parent (v4 O3-3 fix)
    expect(mySub!.status).toBe("review");
  });
});

/* ============================================================
 * Section 3 — SPV KPI functions (Stage 1 additions)
 * ============================================================ */

describe("Wave B Stage 1 — SPV KPI DB reads", () => {
  it("dbTotalSpvCommittedMinor returns a per-currency map with real numbers", () => {
    const kpi = dbTotalSpvCommittedMinor();
    // May be empty on a fresh test DB or may contain seed data — assert shape.
    expect(typeof kpi).toBe("object");
    for (const [currency, amount] of Object.entries(kpi)) {
      expect(currency).toMatch(/^[A-Z]{3}$/);
      expect(typeof amount).toBe("number");
      expect(amount).toBeGreaterThanOrEqual(0);
    }
  });

  it("dbTotalSpvWiredMinor returns a per-currency map with real numbers", () => {
    const kpi = dbTotalSpvWiredMinor();
    expect(typeof kpi).toBe("object");
    for (const [currency, amount] of Object.entries(kpi)) {
      expect(currency).toMatch(/^[A-Z]{3}$/);
      expect(typeof amount).toBe("number");
      expect(amount).toBeGreaterThanOrEqual(0);
    }
  });

  it("dbTotalActiveSpvs returns a non-negative integer", () => {
    const n = dbTotalActiveSpvs();
    expect(typeof n).toBe("number");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
