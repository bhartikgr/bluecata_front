/**
 * WAVE 1 — ENH-1 durable Your-Decision store + FIX #1 restart-survival.
 *
 * Proves the ENH-1 refactor (RAM Map → durable SQLite table
 * `your_decision_records`, migration 0107) behaves correctly:
 *
 *   1. PERSISTENCE   — a mutation lands in the durable table (source of truth),
 *                      not RAM only.
 *   2. RESTART       — after a simulated restart (clear the in-memory cache but
 *                      keep the DB), hydration restores the progressed state.
 *                      This is the FIX #1 root-cause proof: the old lazy
 *                      require() silently dropped the kv write ("Unexpected
 *                      token ')'") so soft-circle did NOT survive a restart.
 *   3. NO-DOWNGRADE  — ensureRecord never rolls a progressed state back to a
 *                      seed state on re-read.
 *   4. IDEMPOTENCY   — persisting the same record twice yields one row.
 *   5. SOFT-CIRCLE   — a soft-circle on an accepted record succeeds AND the
 *                      soft_circled state survives a restart.
 *
 * These exercise the store API directly (no HTTP) against the :memory: SQLite
 * DB used in NODE_ENV=test, which persists for the process lifetime so the
 * durable table survives a Map-only clear.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearRecords,
  ensureRecord,
  getRecord,
  applyDecisionAction,
  _persistRecord,
  hydrateYourDecisionStore,
  type DecisionRecord,
} from "../yourDecisionStore";
import { rawDb } from "../db/connection";

/** Read the raw durable row for an invitation (source-of-truth assertion). */
function durableRow(invitationId: string): any {
  return rawDb()
    .prepare(`SELECT * FROM your_decision_records WHERE invitation_id = ?`)
    .get(invitationId);
}

/** Count durable rows for an invitation (idempotency assertion). */
function durableCount(invitationId: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM your_decision_records WHERE invitation_id = ?`)
    .get(invitationId);
  return Number(r?.n ?? 0);
}

/**
 * Simulate a process restart: drop the in-memory cache but KEEP the durable
 * table, then re-hydrate. We clear only the Map by touching the DB directly is
 * not possible via the public API (clearRecords wipes both), so we snapshot the
 * table, run clearRecords (which wipes both), restore the table rows, and
 * finally hydrate — reproducing "same DB, fresh process".
 */
function simulateRestart(): number {
  const rows: any[] = rawDb().prepare(`SELECT * FROM your_decision_records`).all();
  clearRecords(); // wipes Map + table (fresh process would have empty Map)
  // Restore the durable rows exactly as a real restart would find them on disk.
  const insert = rawDb().prepare(
    `INSERT INTO your_decision_records
       (invitation_id, round_id, company_id, state, amount, currency,
        soft_circle_type, viewed_at, note, history_json, mim_json, actor,
        created_at, updated_at)
     VALUES
       (@invitation_id, @round_id, @company_id, @state, @amount, @currency,
        @soft_circle_type, @viewed_at, @note, @history_json, @mim_json, @actor,
        @created_at, @updated_at)`,
  );
  const tx = rawDb().transaction((rs: any[]) => {
    for (const r of rs) insert.run(r);
  });
  tx(rows);
  return hydrateYourDecisionStore();
}

describe("WAVE 1 ENH-1 — durable Your-Decision store", () => {
  beforeEach(() => {
    clearRecords();
  });

  it("PERSISTENCE: a mutation lands in the durable table (not RAM only)", () => {
    // in_3 is seeded accepted (rnd_q_a); ensureRecord seeds + persists it.
    const rec = ensureRecord("in_3");
    expect(rec?.state).toBe("accepted");

    // The seed itself is durable.
    let row = durableRow("in_3");
    expect(row).toBeTruthy();
    expect(row.state).toBe("accepted");

    // Soft-circle it and persist (mirrors the PATCH route write-through).
    const res = applyDecisionAction(rec!, {
      action: "soft_circle",
      amount: 25_000,
      currency: "USD",
      softCircleType: "indication",
    });
    expect(res.ok).toBe(true);
    _persistRecord(rec!);

    row = durableRow("in_3");
    expect(row.state).toBe("soft_circled");
    expect(Number(row.amount)).toBe(25_000);
    expect(row.currency).toBe("USD");
    expect(row.soft_circle_type).toBe("indication");
  });

  it("RESTART (FIX #1): soft_circled survives a simulated restart", () => {
    const rec = ensureRecord("in_3");
    const res = applyDecisionAction(rec!, {
      action: "soft_circle",
      amount: 40_000,
      currency: "USD",
      softCircleType: "definite",
    });
    expect(res.ok).toBe(true);
    _persistRecord(rec!);
    expect(getRecord("in_3")?.state).toBe("soft_circled");

    // Restart: fresh process, same DB.
    simulateRestart();

    const after = getRecord("in_3");
    expect(after?.state).toBe("soft_circled"); // NOT rolled back to "accepted"
    expect(after?.amount).toBe(40_000);
    expect(after?.softCircleType).toBe("definite");
  });

  it("NO-DOWNGRADE: ensureRecord never rolls a progressed state back to seed", () => {
    const rec = ensureRecord("in_3");
    applyDecisionAction(rec!, {
      action: "soft_circle",
      amount: 10_000,
      currency: "USD",
      softCircleType: "conditional",
    });
    _persistRecord(rec!);

    // A subsequent ensureRecord (e.g. a GET after the mock still says "accepted")
    // must return the progressed durable state, never the seed "accepted".
    const reread = ensureRecord("in_3");
    expect(reread?.state).toBe("soft_circled");

    // Even after a restart the durable state wins over the mock seed.
    simulateRestart();
    expect(ensureRecord("in_3")?.state).toBe("soft_circled");
  });

  it("IDEMPOTENCY: persisting the same record twice yields exactly one row", () => {
    const rec = ensureRecord("in_3");
    _persistRecord(rec!);
    _persistRecord(rec!);
    _persistRecord(rec!);
    expect(durableCount("in_3")).toBe(1);
  });

  it("SOFT-CIRCLE succeeds on an accepted record and is durable", () => {
    const rec = ensureRecord("in_3");
    expect(rec?.state).toBe("accepted");
    const res = applyDecisionAction(rec!, {
      action: "soft_circle",
      amount: 12_345,
      currency: "CAD",
      softCircleType: "indication",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.from).toBe("accepted");
      expect(res.to).toBe("soft_circled");
    }
    _persistRecord(rec!);
    const row = durableRow("in_3");
    expect(row.state).toBe("soft_circled");
    expect(row.currency).toBe("CAD");
  });

  it("history is preserved through persist + restart", () => {
    const rec = ensureRecord("in_3");
    applyDecisionAction(rec!, {
      action: "soft_circle",
      amount: 5_000,
      currency: "USD",
      softCircleType: "indication",
    });
    _persistRecord(rec!);
    const beforeLen = getRecord("in_3")!.history.length;
    expect(beforeLen).toBeGreaterThan(0);

    simulateRestart();
    const after = getRecord("in_3") as DecisionRecord;
    expect(after.history.length).toBe(beforeLen);
    expect(after.history[after.history.length - 1].to).toBe("soft_circled");
  });
});
