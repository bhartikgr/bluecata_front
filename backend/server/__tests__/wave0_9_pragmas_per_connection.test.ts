/**
 * Wave 0-9a acceptance gate: PRAGMA-per-connection proof.
 *
 * V7 \u00a75.0.0 finding: `PRAGMA recursive_triggers` defaults OFF in SQLite.
 * With the default OFF, `INSERT OR REPLACE` on a table with a BEFORE DELETE
 * trigger silently skips the trigger \u2014 the exact mode that reached 11
 * live money tables in v7 and silently deleted one approved receipt.
 *
 * The fix is set at every connection open in server/db/connection.ts
 * (line 124-125):
 *
 *     _rawSqlite.pragma(\"recursive_triggers = ON\");\n *     _rawSqlite.pragma(\"foreign_keys = ON\");\n *
 * This test proves both pragmas are ON on the connection the server
 * actually uses (getDb() / rawDb()), not merely default-ON in some future\n * hypothetical driver upgrade.\n *\n * v7 also proves `recursive_triggers = ON` STAYS on across a burst of new\n * prepared statements \u2014 SQLite's connection pragmas are per-connection, so\n * as long as every code path uses the shared connection factory we are\n * safe. This is asserted mechanically by comparing pragma reads before/after\n * a batch of representative statements.\n */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, rawDb } from "../db/connection";

describe("Wave 0-9a: recursive_triggers=1 + foreign_keys=1 per connection", () => {
  beforeEach(() => {
    getDb();
  });

  it("recursive_triggers is ON at connection open", () => {
    const db = rawDb();
    const row = db.pragma("recursive_triggers", { simple: true });
    expect(Number(row)).toBe(1);
  });

  it("foreign_keys is ON at connection open", () => {
    const db = rawDb();
    const row = db.pragma("foreign_keys", { simple: true });
    expect(Number(row)).toBe(1);
  });

  it("recursive_triggers stays ON after preparing arbitrary statements (pragma isn't reset by DML)", () => {
    const db = rawDb();
    // Baseline
    expect(Number(db.pragma("recursive_triggers", { simple: true }))).toBe(1);
    // Execute a burst of representative statements against Wave 0 tables.
    // If any of these silently reset the pragma (they should not, but the
    // test asserts it), the final read below would return 0.
    db.prepare("SELECT COUNT(*) FROM currency_ref").get();
    db.prepare("SELECT COUNT(*) FROM platform_config").get();
    db.prepare("SELECT COUNT(*) FROM platform_config_history").get();
    // Read again
    expect(Number(db.pragma("recursive_triggers", { simple: true }))).toBe(1);
    expect(Number(db.pragma("foreign_keys", { simple: true }))).toBe(1);
  });

  it("recursive_triggers stays ON inside a transaction", () => {
    const db = rawDb();
    const tx = db.transaction(() => {
      expect(Number(db.pragma("recursive_triggers", { simple: true }))).toBe(1);
      expect(Number(db.pragma("foreign_keys", { simple: true }))).toBe(1);
    });
    tx();
  });
});
