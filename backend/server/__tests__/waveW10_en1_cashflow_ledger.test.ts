/**
 * WAVE 10 — EN-1 proving test: the ILPA cash-flow ledger.
 *
 * WHAT EN-1 ACTUALLY WAS. Not a build. `vehicle_cashflow` was created by
 * migration 0159 (lines 48-86) with `recordCashflow` (wave9ReportingStore:144)
 * and `listCashflows` (:185) written against it — and ZERO non-test callers for
 * either. A table, an API, immutability intentions, and no path from any money
 * event in the product to a single row. The eleventh instance in this build of
 * something believed missing already existing and only needing wiring.
 *
 * SO WHAT THIS FILE HAS TO PROVE IS NOT "the functions work". It is:
 *   1. the chain actually enforces append-only — falsified, not assumed;
 *   2. the producers fire at the real sinks, so real money events land;
 *   3. the projection is idempotent, so a replay cannot double an LP's PIC;
 *   4. `verifyVehicleChain` CAN RETURN FALSE. A verifier that has never been
 *      seen to fail is not evidence of anything. WAVE 7B found DA-3's scope
 *      fence vacuously green because `collectFencedPaths()` skipped missing
 *      files; the same class of bug in a hash-chain verifier would be worse,
 *      because it would be printing "AUDIT OK" over a tampered ledger.
 *
 * THE ONE THING THIS FILE MUST NOT DO is prove the chain by calling only the
 * ledger's own writer. `appendFlow` computes the hashes, so testing it against
 * itself is circular. Every immutability assertion below therefore goes around
 * the module and writes RAW SQL directly at the table, which is exactly what an
 * attacker or a buggy future migration would do.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  appendFlow,
  listFlows,
  verifyVehicleChain,
  cashflowChainInstalled,
  computeFlowHash,
  canonicalFlowPayload,
  projectCapitalCall,
  projectDistribution,
  mapDistributionType,
  findBySource,
  tryProject,
  CashflowLedgerError,
  _resetWave10SchemaGuardForTests,
} from "../lib/ilpaCashflowLedger";
import { rawDb } from "../db/connection";
import { ensureWave9Schema } from "../wave9ReportingStore";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const uid = () => randomBytes(5).toString("hex");

beforeAll(() => {
  ensureWave9Schema();
  _resetWave10SchemaGuardForTests();
  // Touch the ledger once so the A-22 self-heal installs 0165 on this
  // :memory: database before any raw-SQL assertion runs against the table.
  cashflowChainInstalled();
});

/* ==========================================================================
 * 0. The heal ran. If it did not, EVERY assertion below is vacuous.
 * ======================================================================== */
describe("W10/EN-1 — the chain is installed on a fresh database (A-22)", () => {
  it("has chain columns on :memory:, where the sacred bootstrap never runs 0165", () => {
    expect(cashflowChainInstalled()).toBe(true);
    const cols = (rawDb().prepare(`PRAGMA table_info(vehicle_cashflow)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain("chain_seq");
    expect(cols).toContain("prev_hash");
    expect(cols).toContain("curr_hash");
  });

  it("installed the three append-only triggers, not just the columns", () => {
    const names = (rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='vehicle_cashflow'`)
      .all() as Array<{ name: string }>).map((r) => r.name);
    // A column set with no triggers would look migrated and enforce nothing.
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it("the migration and its mirror are byte-identical (W9 drift class)", () => {
    const a = path.join(REPO_ROOT, "migrations", "0165_wave10_en1_cashflow_hash_chain.sql");
    const b = path.join(REPO_ROOT, "server", "db", "migrations", "0165_wave10_en1_cashflow_hash_chain.sql");
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.readFileSync(b)).toEqual(fs.readFileSync(a));
  });
});

/* ==========================================================================
 * 1. Append and chain.
 * ======================================================================== */
describe("W10/EN-1 — appendFlow builds a real chain", () => {
  const vehicleId = `spv_${uid()}`;

  it("starts the chain at seq 1 with a null prev_hash", () => {
    const r = appendFlow({
      tenantId: "t1",
      vehicleKind: "spv",
      vehicleId,
      lpId: "lp_a",
      txnType: "capital_call_investment",
      valueDate: "2025-01-15",
      amountMinor: -500_000_00,
      currency: "USD",
      sourceKind: "manual",
      createdBy: "test",
    });
    expect(r.chainSeq).toBe(1);
    expect(r.prevHash).toBeNull();
    expect(r.currHash).toHaveLength(64);
  });

  it("links each subsequent row to the one before it", () => {
    const second = appendFlow({
      tenantId: "t1",
      vehicleKind: "spv",
      vehicleId,
      lpId: "lp_a",
      txnType: "distribution_income",
      valueDate: "2025-06-30",
      amountMinor: 120_000_00,
      currency: "USD",
      sourceKind: "manual",
      createdBy: "test",
    });
    const rows = listFlows({ vehicleKind: "spv", vehicleId });
    expect(rows).toHaveLength(2);
    expect(second.chainSeq).toBe(2);
    expect(second.prevHash).toBe(rows[0].currHash);
  });

  it("keeps a SEPARATE chain per vehicle — a second SPV restarts at 1", () => {
    const other = `spv_${uid()}`;
    const r = appendFlow({
      tenantId: "t1",
      vehicleKind: "spv",
      vehicleId: other,
      lpId: null,
      txnType: "capital_call_investment",
      valueDate: "2025-02-01",
      amountMinor: -1_000_00,
      currency: "USD",
      sourceKind: "manual",
      createdBy: "test",
    });
    expect(r.chainSeq).toBe(1);
    expect(r.prevHash).toBeNull();
  });

  it("verifies clean", () => {
    const v = verifyVehicleChain("spv", vehicleId);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(2);
    expect(v.breaks).toHaveLength(0); expect(v.unchained).toBe(0);
  });
});

/* ==========================================================================
 * 2. Sign convention. Getting this wrong inverts every IRR on the platform.
 * ======================================================================== */
describe("W10/EN-1 — sign convention is enforced, not merely documented", () => {
  const vehicleId = `spv_${uid()}`;

  it("REJECTS a positive capital call", () => {
    expect(() =>
      appendFlow({
        tenantId: "t1",
        vehicleKind: "spv",
        vehicleId,
        lpId: "lp_x",
        txnType: "capital_call_investment",
        valueDate: "2025-03-01",
        amountMinor: 100_00, // wrong sign: a call is money IN to the vehicle
        currency: "USD",
        sourceKind: "manual",
        createdBy: "test",
      }),
    ).toThrow();
  });

  it("REJECTS a negative distribution", () => {
    expect(() =>
      appendFlow({
        tenantId: "t1",
        vehicleKind: "spv",
        vehicleId,
        lpId: "lp_x",
        txnType: "distribution_income",
        valueDate: "2025-03-01",
        amountMinor: -100_00,
        currency: "USD",
        sourceKind: "manual",
        createdBy: "test",
      }),
    ).toThrow();
  });

  it("REJECTS a zero-amount flow — an XIRR term that cannot mean anything", () => {
    expect(() =>
      appendFlow({
        tenantId: "t1",
        vehicleKind: "spv",
        vehicleId,
        lpId: "lp_x",
        txnType: "distribution_income",
        valueDate: "2025-03-01",
        amountMinor: 0,
        currency: "USD",
        sourceKind: "manual",
        createdBy: "test",
      }),
    ).toThrow();
  });

  it("REJECTS a non-integer amount — money is integer minor units", () => {
    expect(() =>
      appendFlow({
        tenantId: "t1",
        vehicleKind: "spv",
        vehicleId,
        lpId: "lp_x",
        txnType: "distribution_income",
        valueDate: "2025-03-01",
        amountMinor: 100.5,
        currency: "USD",
        sourceKind: "manual",
        createdBy: "test",
      }),
    ).toThrow(CashflowLedgerError);
  });
});

/* ==========================================================================
 * 3. FALSIFICATION. The verifier must be able to fail.
 *
 * Every write below is RAW SQL, deliberately going around `appendFlow`, because
 * a chain checked only against its own writer proves nothing.
 * ======================================================================== */
describe("W10/EN-1 — immutability, proven by attacking the table directly", () => {
  function seed(vehicleId: string, n: number): void {
    for (let i = 0; i < n; i++) {
      appendFlow({
        tenantId: "t1",
        vehicleKind: "spv",
        vehicleId,
        lpId: "lp_a",
        txnType: "capital_call_investment",
        valueDate: `2025-0${i + 1}-01`,
        amountMinor: -(i + 1) * 1000_00,
        currency: "USD",
        sourceKind: "manual",
        createdBy: "test",
      });
    }
  }

  it("the DB REFUSES an UPDATE to a settled row", () => {
    const v = `spv_${uid()}`;
    seed(v, 1);
    const row = listFlows({ vehicleKind: "spv", vehicleId: v })[0];
    expect(() =>
      rawDb().prepare(`UPDATE vehicle_cashflow SET amount_minor = ? WHERE id = ?`).run(-999_00, row.id),
    ).toThrow();
    // and the value really did not move
    expect(listFlows({ vehicleKind: "spv", vehicleId: v })[0].amountMinor).toBe(row.amountMinor);
  });

  it("the DB REFUSES a DELETE", () => {
    const v = `spv_${uid()}`;
    seed(v, 1);
    const row = listFlows({ vehicleKind: "spv", vehicleId: v })[0];
    expect(() => rawDb().prepare(`DELETE FROM vehicle_cashflow WHERE id = ?`).run(row.id)).toThrow();
    expect(listFlows({ vehicleKind: "spv", vehicleId: v })).toHaveLength(1);
  });

  it("the DB REFUSES a FORK — two rows claiming the same chain_seq", () => {
    const v = `spv_${uid()}`;
    seed(v, 2);
    const rows = listFlows({ vehicleKind: "spv", vehicleId: v });
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO vehicle_cashflow
             (id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
              amount_minor, currency, is_recallable, source_kind, source_ref,
              created_at, created_by, chain_seq, prev_hash, curr_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          `vcf_fork_${uid()}`, "t1", "spv", v, "lp_a", "capital_call_investment", "2025-04-01",
          -7_000_00, "USD", 0, "manual", null, new Date().toISOString(), "attacker",
          rows[1].chainSeq, rows[1].prevHash, `f${"0".repeat(63)}`,
        ),
    ).toThrow();
  });

  it("the DB REFUSES a row whose prev_hash does not match the current tip", () => {
    const v = `spv_${uid()}`;
    seed(v, 2);
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO vehicle_cashflow
             (id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
              amount_minor, currency, is_recallable, source_kind, source_ref,
              created_at, created_by, chain_seq, prev_hash, curr_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          `vcf_bad_${uid()}`, "t1", "spv", v, "lp_a", "capital_call_investment", "2025-05-01",
          -8_000_00, "USD", 0, "manual", null, new Date().toISOString(), "attacker",
          3, `d${"e".repeat(63)}`, `c${"0".repeat(63)}`,
        ),
    ).toThrow();
  });

  it("verifyVehicleChain RETURNS ok:false on a recomputed-hash mismatch", () => {
    // The strongest available falsification that the triggers permit: build a
    // chain whose stored curr_hash is NOT the hash of its own payload. We
    // cannot UPDATE a settled row (proven above), so the tamper is introduced
    // at insert time on a fresh vehicle, with a prev_hash of NULL so the
    // fork/tip triggers are satisfied and only the RECOMPUTE check can catch
    // it. If the verifier still says ok:true here, it is checking nothing.
    const v = `spv_${uid()}`;
    rawDb()
      .prepare(
        `INSERT INTO vehicle_cashflow
           (id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
            amount_minor, currency, is_recallable, source_kind, source_ref,
            created_at, created_by, chain_seq, prev_hash, curr_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `vcf_tamper_${uid()}`, "t1", "spv", v, "lp_a", "capital_call_investment", "2025-01-01",
        -1_000_00, "USD", 0, "manual", null, new Date().toISOString(), "attacker",
        1, null, `a${"b".repeat(63)}`, // a hash of nothing at all
      );
    const result = verifyVehicleChain("spv", v);
    expect(result.ok).toBe(false);
    expect(result.breaks.length).toBeGreaterThan(0);
  });

  it("computeFlowHash is deterministic and prev-hash sensitive", () => {
    const payload = canonicalFlowPayload({
      id: "x", tenantId: "t", vehicleKind: "spv", vehicleId: "v", lpId: null,
      txnType: "capital_call_investment", valueDate: "2025-01-01", amountMinor: -1,
      currency: "USD", isRecallable: false, sourceKind: "manual", sourceRef: null,
      chainSeq: 1,
    });
    expect(computeFlowHash(null, payload)).toBe(computeFlowHash(null, payload));
    expect(computeFlowHash("aa", payload)).not.toBe(computeFlowHash("bb", payload));
  });
});

/* ==========================================================================
 * 4. The producers. This is what makes EN-1 shipped rather than present.
 * ======================================================================== */
describe("W10/EN-1 — projections are idempotent at the sink", () => {
  it("projectCapitalCall writes one NEGATIVE flow and replays as a no-op", () => {
    const v = `spv_${uid()}`;
    const callId = `scc_${uid()}`;
    const args = {
      tenantId: "t1", vehicleKind: "spv" as const, vehicleId: v, capitalCallId: callId,
      calledAmountMinor: 250_000_00, currency: "USD", valueDate: "2025-04-01",
      purpose: "investment", createdBy: "test",
    };
    projectCapitalCall(args);
    projectCapitalCall(args); // the replay a retry or a re-deploy would cause
    const rows = listFlows({ vehicleKind: "spv", vehicleId: v });
    expect(rows).toHaveLength(1);
    // A doubled PIC would halve the reported DPI. This is the assertion that
    // catches it.
    expect(rows[0].amountMinor).toBe(-250_000_00);
    expect(findBySource("spv_capital_call", callId)?.id).toBe(rows[0].id);
  });

  it("projectDistribution writes one POSITIVE flow and replays as a no-op", () => {
    const v = `spv_${uid()}`;
    const distId = `dist_${uid()}`;
    const args = {
      tenantId: "t1", vehicleKind: "spv" as const, vehicleId: v, distributionId: distId,
      grossAmountMinor: 90_000_00, currency: "USD", valueDate: "2025-09-01",
      distributionType: null, createdBy: "test",
    };
    projectDistribution(args);
    projectDistribution(args);
    const rows = listFlows({ vehicleKind: "spv", vehicleId: v });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountMinor).toBe(90_000_00);
  });

  it("maps platform distribution types onto ILPA types without inventing one", () => {
    // An unknown platform type must map to null and fall back to the generic
    // `distribution`, never to a guessed ILPA category — the category drives
    // recallability and therefore the metrics.
    expect(mapDistributionType("wildly_unknown_type")).toBeNull();
    expect(mapDistributionType(null)).toBeNull();
  });

  it("tryProject never lets a reporting failure break the money operation", () => {
    // The producer sites are post-commit: the capital call is already recorded
    // and denormalised. A throwing projection must not propagate.
    expect(() =>
      tryProject(() => {
        throw new Error("ledger unavailable");
      }, "unit-test"),
    ).not.toThrow();
  });
});

/* ==========================================================================
 * 5. SECOND-PATH CHECK, asserted rather than asserted-in-a-comment.
 *
 * The trap: "fix where data doesn't flow". EN-1's producers sit on
 * spvFundStore.recordCapitalCall and spvEngineStore.recordDistribution. If a
 * SECOND writer to the same money exists, half the flows never reach the
 * ledger and every IRR is quietly wrong. The legacy plural table
 * `spv_distributions` was closed in WAVE 3D; these tests fail if it reopens.
 * ======================================================================== */
describe("W10/EN-1 — second-path check on the producers", () => {
  const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  it("both producer sites call the projector", () => {
    expect(read("server/spvFundStore.ts")).toContain("projectCapitalCall(");
    expect(read("server/spvEngineStore.ts")).toContain("projectDistribution(");
  });

  it("the legacy plural distribution ledger is still CLOSED to writes", () => {
    // If this ever fails, a second unprojected write path to distributions has
    // been reopened and server/spvFundStore.ts needs its own projectDistribution.
    const legacy = read("server/lib/legacyDistributionLedger.ts");
    expect(/throw|LEGACY_DISTRIBUTION|closed|CLOSED/i.test(legacy)).toBe(true);
  });

  it("the routes are registered — an engine with no route is not shipped", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain("registerReportingEngineRoutes");
    // imported AND called, not merely imported
    expect(routes.match(/registerReportingEngineRoutes/g)!.length).toBeGreaterThanOrEqual(2);
  });
});
