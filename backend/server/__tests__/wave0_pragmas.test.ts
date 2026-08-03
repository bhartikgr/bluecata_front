/**
 * Wave 0 acceptance gate 0-A — bootstrap pragmas.
 *
 * V7 §5.0 (round-5 blocker 5 correction absorbed as ADR pragmas):
 *   Every connection MUST enable `recursive_triggers = ON` and
 *   `foreign_keys = ON`. Without recursive_triggers, immutability triggers
 *   (currency_ref, fx_rate_snapshot) fail to cascade through nested statement
 *   contexts. Without foreign_keys, currency-code FKs from fx_rate_snapshot
 *   silently accept nonsense codes.
 *
 * connection.ts:124-125 sets both pragmas at connection creation, immediately
 * before `applyInlineMigrations()` runs. This test asserts both are 1 after
 * getDb() completes, plus the two runtime consequences (fx_rate_snapshot
 * BEFORE UPDATE trigger fires; FK on currency_ref rejects bogus codes).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getDb, rawDb, resetDbForTests } from "../db/connection";

describe("Wave 0 acceptance 0-A: bootstrap pragmas enforced on every connection", () => {
  beforeEach(() => {
    resetDbForTests();
  });

  it("recursive_triggers is ON after getDb()", () => {
    getDb();
    const db = rawDb();
    const row = db.prepare("PRAGMA recursive_triggers").get() as { recursive_triggers: number };
    expect(row.recursive_triggers).toBe(1);
  });

  it("foreign_keys is ON after getDb()", () => {
    getDb();
    const db = rawDb();
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it("fx_rate_snapshot BEFORE UPDATE immutability trigger fires (recursive_triggers ON runtime check)", () => {
    getDb();
    const db = rawDb();
    db.prepare(
      `INSERT INTO fx_rate_snapshot
         (fx_id, from_currency, to_currency, rate_numerator, rate_denominator, as_of_date, source, created_at)
       VALUES ('fx-pragma-test', 'USD', 'EUR', 92, 100, '2026-01-01', 'test', '2026-01-01T00:00:00Z')`,
    ).run();
    expect(() =>
      db.prepare("UPDATE fx_rate_snapshot SET source = 'hacked' WHERE fx_id = 'fx-pragma-test'").run(),
    ).toThrow(/FX_SNAPSHOT_IMMUTABLE/);
  });

  it("FK enforcement is live (invalid currency code rejected on fx_rate_snapshot insert)", () => {
    getDb();
    const db = rawDb();
    expect(() =>
      db.prepare(
        `INSERT INTO fx_rate_snapshot
           (fx_id, from_currency, to_currency, rate_numerator, rate_denominator, as_of_date, source, created_at)
         VALUES ('fx-fk-test', 'XYZ', 'EUR', 1, 1, '2026-01-01', 'test', '2026-01-01T00:00:00Z')`,
      ).run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});
