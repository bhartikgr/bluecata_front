/* v25.45 Bug C ROUND-2 (GPT-5.5 blocker 3) — freezeRoundChainHead() is
 * fail-closed and transactionally ordered with closeRound().
 *
 * GPT-5.5 found that closeRound() committed the terminal round state FIRST,
 * then called freezeRoundChainHead() OUTSIDE that transaction in best-effort
 * mode (it caught the DB failure, logged "kept in-memory", and returned
 * success). A production write failure could therefore produce a closed round
 * with no durable frozen audit baseline — lost on restart.
 *
 * The fix: closeRound() now persists the freeze STRICTLY *before* committing
 * the round-state UPDATE. If the freeze insert fails, closeRound() refuses to
 * close and the round stays OPEN. A closed-but-not-frozen round can never be
 * reported as successfully closed.
 *
 * Injection: we wrap the raw better-sqlite3 driver's `prepare` so any INSERT
 * into `round_chain_head_freezes` throws (simulating a production write
 * failure). The wrapper is removed in a finally block. We then assert:
 *   - closeRound() returns { ok: false } (NOT a successful close),
 *   - the round's DB state is still OPEN (not terminal),
 *   - no freeze row exists,
 *   - after removing the failure, a retry closes cleanly (happy path intact),
 *   - the cap-table commit ledger was never touched by the aborted close.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, rawDb } from "../db/connection.ts";
import { rounds as roundsTable } from "../../shared/schema.ts";
import { eq } from "drizzle-orm";
import {
  createRound,
  closeRound,
  getRoundById,
  _testAccessRounds,
} from "../roundsStore.ts";
import {
  getFrozenRoundChainHead,
  clearCarryForwardAuditLog,
} from "../roundCarryForwardRoutes.ts";

const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
const COMPANY_ID = `co_bugCr2_freeze_${STAMP}`;

const { record, results } = (() => {
  const results = [];
  const record = (name, pass, extra = "") => {
    results.push({ name, pass });
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
  };
  return { record, results };
})();

let roundId = null;
let ledgerCountBefore = 0;

function countLedger() {
  try {
    const r = rawDb().prepare(`SELECT COUNT(*) AS n FROM captable_commits`).get();
    return Number(r?.n ?? 0);
  } catch {
    return 0; // ledger table may not exist in this test DB
  }
}

beforeAll(() => {
  clearCarryForwardAuditLog();
  _testAccessRounds.reset();
  const db = getDb();
  try { db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run(); } catch { /* first boot */ }
  const round = createRound({ companyId: COMPANY_ID, name: "Series Seed", type: "seed", state: "open", targetAmount: 1_000_000 });
  roundId = round.id;
  ledgerCountBefore = countLedger();
});

afterAll(() => {
  const db = getDb();
  try { db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run(); } catch { /* noop */ }
});

describe("v25.45 Bug C R2 — freeze failure aborts close (fail-closed) — E2E", () => {
  it("1. round is OPEN before close", () => {
    const r = getRoundById(roundId);
    const ok = !!r && r.state === "open";
    record("round starts open", ok, `state ${r?.state}`);
    expect(ok).toBe(true);
  });

  it("2. with the freeze insert forced to fail, closeRound() returns NOT-ok", () => {
    const driver = rawDb();
    const origPrepare = driver.prepare.bind(driver);
    // Inject: any INSERT into round_chain_head_freezes throws.
    driver.prepare = function patched(sql) {
      if (typeof sql === "string" && /INSERT\s+INTO\s+round_chain_head_freezes/i.test(sql)) {
        throw new Error("injected freeze write failure (disk I/O error)");
      }
      return origPrepare(sql);
    };
    let result;
    try {
      result = closeRound(roundId, { actor: "u_test", reason: "manual_close" });
    } finally {
      driver.prepare = origPrepare;
    }
    const ok = result && result.ok === false;
    record("closeRound does NOT report success on freeze failure", ok, JSON.stringify(result));
    expect(ok).toBe(true);
  });

  it("3. the round DB state is still OPEN (terminal state never committed)", () => {
    // Read straight from the DB, bypassing the cache.
    const row = rawDb().prepare(`SELECT state FROM rounds WHERE id = ?`).get(roundId);
    const ok = !!row && (row.state === "open" || row.state === "draft");
    record("round still open in DB after aborted close", ok, `db state ${row?.state}`);
    expect(ok).toBe(true);
  });

  it("4. no durable freeze row exists for the round (fail-closed, nothing leaked to memory)", () => {
    const frozen = getFrozenRoundChainHead(roundId);
    const row = rawDb().prepare(`SELECT round_id FROM round_chain_head_freezes WHERE round_id = ?`).get(roundId);
    const ok = frozen === null && !row;
    record("no freeze persisted and no in-memory snapshot", ok, `frozen ${frozen} row ${JSON.stringify(row)}`);
    expect(ok).toBe(true);
  });

  it("5. the captable_commits ledger was NOT touched by the aborted close", () => {
    const after = countLedger();
    const ok = after === ledgerCountBefore;
    record("cap-table ledger row count unchanged", ok, `before ${ledgerCountBefore} after ${after}`);
    expect(ok).toBe(true);
  });

  it("6. control: with the failure removed, the round closes cleanly AND is frozen (happy path)", () => {
    const result = closeRound(roundId, { actor: "u_test", reason: "manual_close" });
    const row = rawDb().prepare(`SELECT state FROM rounds WHERE id = ?`).get(roundId);
    const frozen = getFrozenRoundChainHead(roundId);
    const terminal = row && /^closed/.test(row.state);
    const ok = result?.ok === true && terminal && typeof frozen === "string" && frozen.length > 0;
    record("happy-path close succeeds and freezes durably", ok, `ok ${result?.ok} state ${row?.state} frozen ${frozen}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug C R2 freeze-failure-aborts-close E2E: ${passed}/${results.length} passed`);
    for (const r of results) if (!r.pass) console.log(`    FAIL: ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
