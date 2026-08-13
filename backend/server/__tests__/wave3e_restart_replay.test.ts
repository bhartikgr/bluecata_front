/**
 * WAVE 3E — REPLAY PROTECTION SURVIVES A PROCESS RESTART.
 *
 * This is the test WAVE 1A could not have written. Under the shipped design the
 * replay counter was a module-private `WeakMap`: restart the process and the
 * counter was gone. Whether that was exploitable depended entirely on whether an
 * attacker could also reproduce a branded handle — but "the control is only as
 * durable as the process" is exactly what the owner's ruling forbids.
 *
 * HOW A RESTART IS SIMULATED
 * --------------------------
 * `vi.resetModules()` throws away the module registry, so a re-import of
 * `../lib/feeSettlementAuthority` produces a genuinely fresh instance: a NEW
 * private `Symbol` brand and an EMPTY `WeakSet` — precisely the process-local
 * state a restart destroys. To keep the DURABLE half alive across that reset we
 * mock `../db/connection` so every instance is handed the SAME `better-sqlite3`
 * handle on the SAME file. New process, same database.
 *
 * Run: npx vitest run server/__tests__/wave3e_restart_replay.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";

type AuthorityModule = typeof import("../lib/feeSettlementAuthority");

let dir: string;
let file: string;
let db: Database.Database;

const SPV = "spv_restart";
const OB = "ob_restart";

/** Boot a "process": a fresh module instance over the SAME durable database. */
async function bootProcess(): Promise<AuthorityModule> {
  vi.resetModules();
  vi.doMock("../db/connection", () => ({
    rawDb: () => db,
    getDbDriver: () => "sqlite",
    getDb: () => db,
  }));
  const mod = (await import("../lib/feeSettlementAuthority")) as AuthorityModule;
  mod.__resetSchemaLatchForTest();
  return mod;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3e_restart_"));
  file = path.join(dir, "authority.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
});

afterAll(() => {
  try { db.close(); } catch { /* best effort */ }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.doUnmock("../db/connection");
});

describe("W3E-RESTART — the authority outlives the process", () => {
  it("W3E-RESTART-0 — a fresh instance bootstraps the durable table it needs", async () => {
    const p1 = await bootProcess();
    // Nothing existed before; the first mint must create the schema and the row.
    const auth = p1.__authorizeForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: OB, outcome: "succeeded" });
    const row = db.prepare(`SELECT * FROM fee_settlement_authorization WHERE id = ?`).get(auth.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.spv_id).toBe(SPV);
    expect(row.obligation_id).toBe(OB);
    expect(Number(row.uses_consumed)).toBe(0);
  });

  it("W3E-RESTART-1 — an authorization consumed in process 1 is REPLAYED in process 2", async () => {
    const p1 = await bootProcess();
    const auth = p1.__authorizeForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r1", outcome: "succeeded" });
    p1.withSettlementTransaction(() =>
      p1.consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r1" }),
    );
    expect(Number((db.prepare(`SELECT uses_consumed AS u FROM fee_settlement_authorization WHERE id=?`).get(auth.id) as any).u)).toBe(1);

    // ── process restart ──────────────────────────────────────────────────────
    const p2 = await bootProcess();
    expect(p2).not.toBe(p1); // genuinely a different module instance

    // The rebuilt process cannot even recognise the OLD handle: its brand
    // Symbol died with process 1. That is the defence-in-depth layer.
    expect(p2.isFeeSettlementAuthorization(auth)).toBe(false);

    // And the DURABLE layer refuses independently: rehydrating the same id from
    // the surviving database reports the replay. This is the property the
    // WeakMap could not provide.
    expect(() => p2.rehydrateSettlementAuthorization(auth.id)).toThrow(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
  });

  it("W3E-RESTART-2 — an UNCONSUMED authorization still works after a restart, exactly once", async () => {
    const p1 = await bootProcess();
    const auth = p1.__authorizeForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r2", outcome: "succeeded" });
    // Process 1 dies before spending it.
    const p2 = await bootProcess();
    const revived = p2.rehydrateSettlementAuthorization(auth.id);
    expect(p2.isFeeSettlementAuthorization(revived)).toBe(true);
    expect(revived.spvId).toBe(SPV);
    expect(revived.obligationId).toBe("ob_r2");
    expect(revived.outcome).toBe("succeeded");
    p2.withSettlementTransaction(() =>
      p2.consumeSettlementAuthorization(revived, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r2" }),
    );
    // Same process: exhausted.
    expect(() =>
      p2.withSettlementTransaction(() =>
        p2.consumeSettlementAuthorization(revived, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r2" }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
    // Third process: still exhausted.
    const p3 = await bootProcess();
    expect(() => p3.rehydrateSettlementAuthorization(auth.id)).toThrow(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
  });

  it("W3E-RESTART-3 — TWO LIVE PROCESSES cannot both spend one authorization", async () => {
    const pA = await bootProcess();
    const auth = pA.__authorizeForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r3", outcome: "succeeded" });
    // pB is a second live instance with its own brand and its own empty WeakSet.
    const pB = await bootProcess();
    const bHandle = pB.rehydrateSettlementAuthorization(auth.id);

    const results = [
      (() => { try { pA.withSettlementTransaction(() => pA.consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r3" })); return "won"; } catch (e) { return (e as Error).message; } })(),
      (() => { try { pB.withSettlementTransaction(() => pB.consumeSettlementAuthorization(bHandle, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r3" })); return "won"; } catch (e) { return (e as Error).message; } })(),
    ];
    expect(results.filter((r) => r === "won").length).toBe(1);
    expect(results.filter((r) => r !== "won")[0]).toMatch(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
    expect(Number((db.prepare(`SELECT uses_consumed AS u FROM fee_settlement_authorization WHERE id=?`).get(auth.id) as any).u)).toBe(1);
    expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM fee_settlement_authorization_use WHERE authorization_id=?`).get(auth.id) as any).n)).toBe(1);
  });

  it("W3E-RESTART-4 — a restart does NOT resurrect an expired authorization", async () => {
    const p1 = await bootProcess();
    const auth = p1.__authorizeExpiredForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r4", outcome: "succeeded" });
    const p2 = await bootProcess();
    expect(() => p2.rehydrateSettlementAuthorization(auth.id)).toThrow(/SETTLEMENT_AUTHORIZATION_EXPIRED/);
    expect(Number((db.prepare(`SELECT uses_consumed AS u FROM fee_settlement_authorization WHERE id=?`).get(auth.id) as any).u)).toBe(0);
  });

  it("W3E-RESTART-5 — an id that was never issued is refused after a restart, in every process", async () => {
    for (let i = 0; i < 3; i += 1) {
      const p = await bootProcess();
      expect(() => p.rehydrateSettlementAuthorization("fsa_never_issued")).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
      expect(() => p.rehydrateSettlementAuthorization("")).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
      expect(() => p.rehydrateSettlementAuthorization(null)).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
    }
  });

  it("W3E-RESTART-6 — a crash mid-transaction leaves nothing behind for the next process", async () => {
    const p1 = await bootProcess();
    const auth = p1.__authorizeForTest({ purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r6", outcome: "succeeded" });
    expect(() =>
      p1.withSettlementTransaction(() => {
        p1.consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId: SPV, obligationId: "ob_r6" });
        throw new Error("PROCESS_KILLED");
      }),
    ).toThrow(/PROCESS_KILLED/);
    // The successor process sees an untouched, still-valid authorization —
    // the consume was rolled back with the money write, not half-applied.
    const p2 = await bootProcess();
    const revived = p2.rehydrateSettlementAuthorization(auth.id);
    expect(revived.id).toBe(auth.id);
    expect(Number((db.prepare(`SELECT uses_consumed AS u FROM fee_settlement_authorization WHERE id=?`).get(auth.id) as any).u)).toBe(0);
    expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM fee_settlement_authorization_use WHERE authorization_id=?`).get(auth.id) as any).n)).toBe(0);
  });
});
