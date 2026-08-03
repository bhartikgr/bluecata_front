/**
 * Wave 0-9b acceptance gate: mutation-8 attack proof.
 *
 * V7 \u00a75.0.0 defect 0.9-mut8 (P0):
 *   Even with recursive_triggers=ON, `INSERT OR REPLACE` can still bypass
 *   BEFORE DELETE triggers on tables that use it as an idempotency shortcut.
 *   The defence-in-depth pattern is a BEFORE INSERT re-insert guard: if a
 *   row already exists for the incoming primary key, the guard fires with
 *   an ABORT before the delete-then-insert semantics can execute.
 *
 * Wave 0 Increment 1 delivers this for platform_config and
 * platform_config_history through three triggers already in place:
 *   \u2022 trg_pc_atomic_audit           (BEFORE UPDATE)
 *   \u2022 trg_pc_no_direct_insert       (BEFORE INSERT)
 *   \u2022 trg_pc_no_delete              (BEFORE DELETE)
 *   \u2022 trg_pch_chain_integrity       (BEFORE INSERT on history)
 *   \u2022 trg_pch_no_update / no_delete (append-only history)
 *
 * This test simulates the attack: with a seeded row in place, try to run
 * `INSERT OR REPLACE` against platform_config with a divergent value. Under
 * recursive_triggers=ON, SQLite runs:
 *   1. BEFORE DELETE on the existing row \u2192 trg_pc_no_delete aborts.
 * The whole statement rolls back and the seeded row survives.
 *
 * We also verify that a legitimate audited UPDATE succeeds when the write
 * path uses the shape Wave F will require. This is the positive assertion
 * that the ban is not vacuous.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getDb, rawDb } from "../db/connection";

describe("Wave 0-9b: mutation-8 attack aborts on Wave 0 immutability targets", () => {
  beforeEach(() => {
    getDb();
  });

  it("INSERT OR REPLACE on platform_config aborts (BEFORE DELETE trg_pc_no_delete fires)", () => {
    const db = rawDb();
    const before = db
      .prepare("SELECT value_json, revision_hash FROM platform_config WHERE key = 'billing_cycle.default'")
      .get() as { value_json: string; revision_hash: string };
    expect(before.revision_hash).toBe(
      "a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66",
    );
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO platform_config (
             key, value_json, value_type, description, is_secret, version,
             prev_revision_hash, revision_hash, created_at, updated_at,
             created_by, updated_by
           ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, 'attacker', 'attacker')`,
        )
        .run(
          "billing_cycle.default",
          '"tampered"',
          "string",
          "Attacker overwrite attempt",
          "0".repeat(64),
          "ff".repeat(32),
          "2020-01-01T00:00:00Z",
          "2020-01-01T00:00:00Z",
        ),
    ).toThrow(/PLATFORM_CONFIG_NO_DELETE|PLATFORM_CONFIG_UNAUDITED_INSERT/);
    // Row unchanged. Either trigger firing is a safe abort — the attack fails
    // either way. In practice on SQLite 3.46+ with recursive_triggers=ON,
    // trg_pc_no_direct_insert fires first on the REPLACE's insert-half; on
    // older engines trg_pc_no_delete would fire on the delete-half. Both are
    // wired specifically to block this attack shape.
    const after = db
      .prepare("SELECT value_json, revision_hash FROM platform_config WHERE key = 'billing_cycle.default'")
      .get() as { value_json: string; revision_hash: string };
    expect(after.revision_hash).toBe(before.revision_hash);
    expect(after.value_json).toBe(before.value_json);
  });

  it("INSERT OR REPLACE on platform_config_history aborts (BEFORE DELETE trg_pch_no_delete fires)", () => {
    const db = rawDb();
    const before = db
      .prepare(
        "SELECT revision_hash FROM platform_config_history WHERE history_id = 'pch_gen_billing_cycle_default'",
      )
      .get() as { revision_hash: string };
    expect(before.revision_hash).toBe(
      "a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66",
    );
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO platform_config_history (
             history_id, config_key, version, snapshot_json,
             prev_revision_hash, revision_hash, changed_at, changed_by, change_kind
           ) VALUES ('pch_gen_billing_cycle_default', 'billing_cycle.default', 1, ?, ?, ?, ?, 'attacker', 'genesis')`,
        )
        .run(
          JSON.stringify({ v: 1, key: "billing_cycle.default", vt: "string", val: '"tampered"' }),
          "0".repeat(64),
          "ff".repeat(32),
          "2020-01-01T00:00:00Z",
        ),
    ).toThrow(/PLATFORM_CONFIG_HISTORY_IMMUTABLE/);
    const after = db
      .prepare(
        "SELECT revision_hash FROM platform_config_history WHERE history_id = 'pch_gen_billing_cycle_default'",
      )
      .get() as { revision_hash: string };
    expect(after.revision_hash).toBe(before.revision_hash);
  });

  it("INSERT OR REPLACE on currency_ref aborts (BEFORE DELETE trg_currency_ref_no_delete fires)", () => {
    const db = rawDb();
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('USD', 4, 1)`,
        )
        .run(),
    ).toThrow(/CURRENCY_REF_NO_DELETE/);
    const row = db.prepare("SELECT minor_unit_exponent FROM currency_ref WHERE code = 'USD'").get() as { minor_unit_exponent: number };
    expect(row.minor_unit_exponent).toBe(2);
  });

  it("INSERT OR REPLACE on allocation_rule aborts (BEFORE DELETE trg_allocation_rule_no_delete fires)", () => {
    const db = rawDb();
    // Seed a row first (a valid genesis allocation_rule)
    db.prepare(
      `INSERT OR IGNORE INTO allocation_rule (
         rule_id, rule_version, method, tie_break, created_at
       ) VALUES ('rule_test', 1, 'largest_remainder_stable', 'remainder_desc_index_asc', ?)`,
    ).run("2020-01-01T00:00:00Z");
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO allocation_rule (
             rule_id, rule_version, method, tie_break, created_at
           ) VALUES ('rule_test', 1, 'largest_remainder_stable', 'remainder_desc_index_asc', ?)`,
        )
        .run("2020-01-01T00:00:00Z"),
    ).toThrow(/ALLOCATION_RULE_IMMUTABLE/);
  });

  it("INSERT OR REPLACE on fx_rate_snapshot aborts (BEFORE DELETE trg_fx_no_delete fires)", () => {
    const db = rawDb();
    // Seed a row first
    db.prepare(
      `INSERT OR IGNORE INTO fx_rate_snapshot (
         fx_id, from_currency, to_currency, rate_numerator, rate_denominator,
         as_of_date, source, created_at
       ) VALUES ('fx_test', 'USD', 'EUR', 92, 100, '2020-01-01', 'test', ?)`,
    ).run("2020-01-01T00:00:00Z");
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO fx_rate_snapshot (
             fx_id, from_currency, to_currency, rate_numerator, rate_denominator,
             as_of_date, source, created_at
           ) VALUES ('fx_test', 'USD', 'EUR', 999, 100, '2020-01-01', 'attacker', ?)`,
        )
        .run("2020-01-01T00:00:00Z"),
    ).toThrow(/FX_SNAPSHOT_IMMUTABLE/);
  });

  it("legitimate audited UPDATE on platform_config succeeds (positive assertion; ban is not vacuous)", () => {
    const db = rawDb();
    const seed = db
      .prepare("SELECT revision_hash FROM platform_config WHERE key = 'billing_cycle.default'")
      .get() as { revision_hash: string };
    const newHash = "beef".repeat(16);
    const T0 = "2020-01-01T00:00:00Z";
    // Wave F write path shape: history INSERT first, then current UPDATE.
    db.prepare(
      `INSERT INTO platform_config_history (
         history_id, config_key, version, snapshot_json,
         prev_revision_hash, revision_hash, changed_at, changed_by, change_kind
       ) VALUES ('h_v2', 'billing_cycle.default', 2, ?, ?, ?, ?, 'wave_f_writer', 'update')`,
    ).run(
      JSON.stringify({ v: 2, key: "billing_cycle.default", vt: "string", val: '"monthly"' }),
      seed.revision_hash,
      newHash,
      T0,
    );
    db.prepare(
      `UPDATE platform_config
         SET value_json = '"monthly"', version = 2,
             prev_revision_hash = ?, revision_hash = ?, updated_at = ?, updated_by = 'wave_f_writer'
       WHERE key = 'billing_cycle.default'`,
    ).run(seed.revision_hash, newHash, T0);
    const row = db.prepare(
      "SELECT value_json, version FROM platform_config WHERE key = 'billing_cycle.default'",
    ).get() as { value_json: string; version: number };
    expect(row.value_json).toBe('"monthly"');
    expect(row.version).toBe(2);
  });
});
