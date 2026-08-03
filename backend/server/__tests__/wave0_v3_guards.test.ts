/**
 * Wave 0 Increment 1 v3+v4+v5+v6+v7 review \u2014 acceptance tests for fail-fast +
 * chain-guard + content-linkage + key-immutability + linkage-assertion fixes.
 *
 *   Test 1: applyWave0CurrencyRefSchema on a DB with pre-existing wrong HUF
 *           exponent throws Wave0SeedDriftError.
 *   Test 2: The drift throw does NOT roll back the DDL \u2014 currency_ref survives.
 *   Test 3 (v4 fix): applyWave0PlatformConfigSchema on a DB with pre-existing
 *           bad revision_hash throws Wave0SeedDriftError.
 *   Test 4: platform_config UPDATE respecting the FULL chain contract
 *           (version+1 + prev_hash + matching history row) succeeds.
 *   Test 5 (v5): fabricated-genesis version-skip is blocked by
 *                trg_pch_chain_integrity (fires BEFORE the UPDATE runs).
 *   Test 6 (v5): fabricated-genesis wrong-prev is blocked by
 *                trg_pch_chain_integrity (fires BEFORE the UPDATE runs).
 *   Test 6b (v5): with a VALID history row, UPDATE with mismatched prev_hash
 *                 is caught by chain-guard OR atomic-audit (either is safe).
 *   Test 7: UPDATE without matching history row blocked (UNAUDITED_UPDATE).
 *   Test 7b (v3): raw history-row insert (no matching current) is rejected by
 *                 trg_pch_chain_integrity (v5 extension) or leaves an
 *                 unattached row that fails atomic_audit downstream.
 *   Test 8: DELETE on platform_config blocked (NO_DELETE).
 *   Test 9: End-to-end SQL bootstrap: 5 tables, all Wave 0 triggers, correct row counts.
 *   Test 10 (v6): all 14 Wave 0 triggers present under SQL-migration bootstrap
 *                 (13 from v5 + trg_pc_no_key_change added in v6).
 *   Test 10b: three-place trigger parity smoke.
 *   Test 11: isWave0SeedDriftError type guard survives ES5 __extends emit
 *            (regression test for the v3 blocker Opus found).
 *   Test 12 (v6, Opus v5 B1 fix): after a fully audited v1->v2 update,
 *                                 re-running applyWave0PlatformConfigSchema
 *                                 does NOT throw. Prevents boot-brick.
 *   Test 13 (v6, Opus v5 B2 fix): pre-existing divergent history row causes
 *                                 apply to throw Wave0SeedDriftError
 *                                 (fail-loud, not fail-open).
 *   Test 14 (v6, all reviewers): trg_pc_no_direct_insert rejects a current-
 *                                state INSERT whose value_json disagrees
 *                                with the valid genesis history row.
 *   Test 15 (v6, GPT-5 v5): trg_pc_no_key_change blocks UPDATE that
 *                           changes the key. Assertion widened in v7 for
 *                           SQLite trigger-order robustness.
 *   Test 15b (v7, Opus v6 N1): trg_pc_no_key_change fires even when
 *                              chain_guard is satisfied (proves not shadowed).
 *   Test 16 (v7, Opus v6 C1): legacy DB with tampered v2 current row and no
 *                             v2 history is caught by the version>1 branch
 *                             drift-linkage check (restored in v7).
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  Wave0SeedDriftError,
  isWave0SeedDriftError,
  applyWave0CurrencyRefSchema,
  applyWave0MoneyCoreSchema,
  applyWave0PlatformConfigSchema,
} from "../db/connection";

const ROOT = path.resolve(__dirname, "../..");
const GENESIS_PREV = "0".repeat(64);
const T0 = "2026-08-01T00:00:00Z";

function freshDb() {
  const db = new (Database as any)(":memory:");
  db.pragma("recursive_triggers = ON");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Apply all three migrations via SQL to a given DB. */
function applyWave0SqlOnly(db: any) {
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0121_wave0_currency_ref.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0122_wave0_money_core.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(ROOT, "migrations/0123_wave0_platform_config.sql"), "utf8"));
}

/** Apply all three migrations via the exported inline functions. */
function applyWave0Inline(db: any) {
  applyWave0CurrencyRefSchema(db);
  applyWave0MoneyCoreSchema(db);
  applyWave0PlatformConfigSchema(db);
}

/**
 * Build a history-row + advance platform_config together (mirrors what
 * Wave F's write path must do). Returns the new revision_hash so callers can
 * chain further updates.
 */
function auditedUpdate(
  db: any,
  key: string,
  newValueJson: string,
  newValueType: string,
): string {
  const cur = db.prepare(
    "SELECT version, revision_hash FROM platform_config WHERE key = ?",
  ).get(key) as { version: number; revision_hash: string };
  const newVersion = cur.version + 1;
  // Compute a deterministic new hash (canonical JSON of prior hash + new fields).
  // Real Wave F code will use the same sha256(JSON.stringify(...)) formula; here
  // we just need any 64-hex string that matches on both sides.
  const newHash = ("d" + newVersion.toString(16).padStart(3, "0")).repeat(16);

  const snapshot = JSON.stringify({ v: newVersion, key, vt: newValueType, val: newValueJson });
  // Order matters: history INSERT MUST come before platform_config UPDATE
  // because trg_pc_atomic_audit checks for the history row.
  db.prepare(`INSERT INTO platform_config_history
                (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'test:writer', 'update')`)
    .run(`pch_${key}_v${newVersion}`, key, newVersion, snapshot, cur.revision_hash, newHash, T0);
  db.prepare(`UPDATE platform_config
                SET value_json = ?, value_type = ?, version = ?,
                    prev_revision_hash = ?, revision_hash = ?, updated_at = ?
              WHERE key = ?`)
    .run(newValueJson, newValueType, newVersion, cur.revision_hash, newHash, T0, key);
  return newHash;
}

describe("Wave 0 v3+v4+v5+v6+v7 review \u2014 fail-fast drift + chain-guard + audit contract + key immutability + linkage assertion", () => {
  describe("Wave0SeedDriftError type guard (v4 regression for ES5 __extends emit)", () => {
    it("Test 11: isWave0SeedDriftError works via nominal marker even when instanceof fails (ES5 __extends regression)", () => {
      // Real class \u2014 both discriminators work.
      const real = new Wave0SeedDriftError("test");
      expect(real instanceof Wave0SeedDriftError).toBe(true);
      expect(real.kind).toBe("wave0-seed-drift");
      expect(isWave0SeedDriftError(real)).toBe(true);

      // Simulate ES5 __extends emit failure: an Error with the `kind` marker
      // but WITHOUT a proper prototype chain.
      const es5Emit: any = new Error("test");
      es5Emit.kind = "wave0-seed-drift";
      es5Emit.name = "Wave0SeedDriftError";
      // Under this scenario, bare instanceof is false but the guard passes.
      expect(es5Emit instanceof Wave0SeedDriftError).toBe(false);
      expect(isWave0SeedDriftError(es5Emit)).toBe(true);

      // Ordinary errors are rejected.
      expect(isWave0SeedDriftError(new Error("plain"))).toBe(false);
      expect(isWave0SeedDriftError({ kind: "different" })).toBe(false);
      expect(isWave0SeedDriftError(null)).toBe(false);
      expect(isWave0SeedDriftError(undefined)).toBe(false);
    });
  });

  describe("Currency drift is detected via the shipped apply function", () => {
    it("Test 1: pre-existing wrong HUF exponent triggers Wave0SeedDriftError", () => {
      const db = freshDb();
      // Simulate a v1-era DB that seeded HUF at exponent 0 (pre-ISO-correction).
      // Create the v3 shape (so all CREATE IF NOT EXISTS are no-ops) and insert bad row.
      db.exec(`
        CREATE TABLE currency_ref (
          code TEXT PRIMARY KEY NOT NULL
                CHECK (length(code) = 3 AND code = upper(code)),
          minor_unit_exponent INTEGER NOT NULL
                CHECK (minor_unit_exponent IN (0, 2, 3, 4)),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
        ) STRICT;
      `);
      db.prepare("INSERT INTO currency_ref VALUES ('HUF', 0, 1)").run();

      // Now call the SHIPPED apply function \u2014 must throw Wave0SeedDriftError.
      let caught: unknown = null;
      try {
        applyWave0CurrencyRefSchema(db);
      } catch (e) {
        caught = e;
      }
      expect(caught, "apply function should have thrown").not.toBeNull();
      expect(isWave0SeedDriftError(caught), "should be Wave0SeedDriftError").toBe(true);
      expect((caught as Error).message).toMatch(/currency_ref seed drift/);
      expect((caught as Error).message).toMatch(/HUF/);
    });

    it("Test 2: schema survives after the drift throw (drift check runs post-tx)", () => {
      const db = freshDb();
      db.exec(`
        CREATE TABLE currency_ref (
          code TEXT PRIMARY KEY NOT NULL
                CHECK (length(code) = 3 AND code = upper(code)),
          minor_unit_exponent INTEGER NOT NULL
                CHECK (minor_unit_exponent IN (0, 2, 3, 4)),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
        ) STRICT;
      `);
      db.prepare("INSERT INTO currency_ref VALUES ('HUF', 0, 1)").run();

      try { applyWave0CurrencyRefSchema(db); } catch { /* expected */ }

      // Schema tables + triggers still exist after the throw.
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='currency_ref'").all();
      expect(tables.length).toBe(1);
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='currency_ref'").all();
      expect(triggers.length).toBeGreaterThanOrEqual(2);
      // The 166 correct codes were still seeded (all except HUF, which is the bad row).
      // INSERT OR IGNORE means the good exponent-2 HUF wasn't written, so the count
      // is 167 (166 fresh + the pre-existing HUF).
      const n = db.prepare("SELECT COUNT(*) AS n FROM currency_ref").get() as { n: number };
      expect(n.n).toBe(167);
    });
  });

  describe("Platform_config drift (v4 restored Test 3)", () => {
    it("Test 3: pre-existing wrong revision_hash triggers Wave0SeedDriftError", () => {
      const db = freshDb();
      // Apply currency_ref + money_core normally, then set up a corrupt
      // platform_config BEFORE calling the platform_config apply.
      applyWave0CurrencyRefSchema(db);
      applyWave0MoneyCoreSchema(db);

      // Create platform_config manually with a BAD hash for one seed row.
      db.exec(`
        CREATE TABLE platform_config (
          key TEXT PRIMARY KEY NOT NULL,
          value_json TEXT NOT NULL CHECK (json_valid(value_json)),
          value_type TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
          description TEXT,
          is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          prev_revision_hash TEXT NOT NULL,
          revision_hash TEXT NOT NULL,
          created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
          updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
          created_by TEXT,
          updated_by TEXT,
          CHECK (
            (value_type = 'string' AND json_type(value_json) = 'text') OR
            (value_type = 'number' AND json_type(value_json) IN ('integer','real')) OR
            (value_type = 'boolean' AND json_type(value_json) IN ('true','false')) OR
            (value_type = 'json')
          )
        ) STRICT;
      `);
      // Seed one row with a WRONG hash.
      db.prepare(`INSERT INTO platform_config
                    (key, value_json, value_type, version, prev_revision_hash, revision_hash, created_at, updated_at)
                  VALUES ('kyc.capital_call.gate_mode', '"warn"', 'string', 1, ?, ?, ?, ?)`)
        .run(GENESIS_PREV, "deadbeef".repeat(8), T0, T0);

      let caught: unknown = null;
      try {
        applyWave0PlatformConfigSchema(db);
      } catch (e) {
        caught = e;
      }
      expect(caught, "apply function should have thrown").not.toBeNull();
      expect(isWave0SeedDriftError(caught), "should be Wave0SeedDriftError").toBe(true);
      expect((caught as Error).message).toMatch(/platform_config seed drift/);
      expect((caught as Error).message).toMatch(/kyc\.capital_call\.gate_mode/);
    });
  });

  describe("Chain-guard triggers enforce the FULL contract", () => {
    it("Test 4: full audited UPDATE (history-first, then advance) succeeds", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const newHash = auditedUpdate(db, "billing_cycle.default", '"monthly"', "string");
      const after = db.prepare("SELECT version, value_json, revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as {
        version: number; value_json: string; revision_hash: string;
      };
      expect(after.version).toBe(2);
      expect(after.value_json).toBe('"monthly"');
      expect(after.revision_hash).toBe(newHash);
    });

    // v7 (Opus v5 C3, v6 B1 resolution): Tests 5 and 6 were originally UPDATE-
    // path tests for trg_pc_chain_guard's version-skip and wrong-prev-hash
    // branches. In v5, trg_pch_chain_integrity was added which intercepts the
    // history-row setup those UPDATE tests needed, making chain_guard's own
    // version-skip branch STRUCTURALLY UNREACHABLE IN ISOLATION:
    //   • Any UPDATE that skips a version implies no valid history row can
    //     exist for that version, so trg_pc_atomic_audit fires first with
    //     PLATFORM_CONFIG_UNAUDITED_UPDATE (verified on scratch DB SQLite
    //     3.46.1/3.50.4).
    //   • Any attempt to fabricate the required history row is rejected by
    //     trg_pch_chain_integrity with PLATFORM_CONFIG_HISTORY_CHAIN_BREAK.
    //
    // The chain_guard version-skip branch therefore becomes defence-in-depth
    // subsumed by chain_integrity + atomic_audit. It cannot be isolated for
    // negative testing without disabling the very triggers whose presence
    // makes it defence-in-depth. Tests 5 and 6 are renamed accordingly — they
    // now assert the ACTUAL first-firing trigger's behaviour rather than
    // claiming they issue an UPDATE.

    it("Test 5: fabricated version-skip history INSERT is rejected by trg_pch_chain_integrity (v5+); the version-skip branch of trg_pc_chain_guard is now structurally unreachable and defence-in-depth", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const seed = db.prepare("SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as { revision_hash: string };
      const newHash = "cafef00d".repeat(8);
      expect(() =>
        db.prepare(`INSERT INTO platform_config_history
                      (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, change_kind)
                    VALUES ('h_skip','billing_cycle.default',3,'{}',?,?,?, 'update')`)
          .run(seed.revision_hash, newHash, T0),
      ).toThrow(/PLATFORM_CONFIG_HISTORY_CHAIN_BREAK/);
    });

    it("Test 6: fabricated wrong-prev-hash history INSERT is rejected by trg_pch_chain_integrity (v5+); the wrong-prev-hash branch of trg_pc_chain_guard is now structurally unreachable and defence-in-depth", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const newHash = "cafef00d".repeat(8);
      expect(() =>
        db.prepare(`INSERT INTO platform_config_history
                      (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, change_kind)
                    VALUES ('h_bad_prev','billing_cycle.default',2,'{}',?,?,?, 'update')`)
          .run("f".repeat(64), newHash, T0),
      ).toThrow(/PLATFORM_CONFIG_HISTORY_CHAIN_BREAK/);
    });

    it("Test 6b: even with valid history, UPDATE with mismatched prev_hash is caught by chain-guard", () => {
      // v5: prove chain-guard still fires when history is valid but the UPDATE
      // sets a mismatched prev_hash on platform_config itself.
      const db = freshDb();
      applyWave0SqlOnly(db);
      const seed = db.prepare("SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as { revision_hash: string };
      const newHash = "beef".repeat(16);
      // Build a VALID history row for v2.
      const snapshot = JSON.stringify({v:2,key:'billing_cycle.default',vt:'string',val:'"monthly"'});
      db.prepare(`INSERT INTO platform_config_history
                    (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, change_kind)
                  VALUES ('h_valid','billing_cycle.default',2,?,?,?,?, 'update')`)
        .run(snapshot, seed.revision_hash, newHash, T0);
      // Now UPDATE with a wrong prev_hash — either chain-guard (NEW.prev
      // ≠ OLD.revision_hash) or atomic-audit (v5 content check: prev_hash
      // doesn't match the recorded history row's prev_hash) fires. Both are
      // valid rejections; test accepts either error code.
      expect(() =>
        db.prepare(`UPDATE platform_config
                      SET value_json = '"monthly"', version = 2, prev_revision_hash = ?, revision_hash = ?, updated_at = ?
                    WHERE key = 'billing_cycle.default'`).run("f".repeat(64), newHash, T0),
      ).toThrow(/PLATFORM_CONFIG_CHAIN_BREAK|PLATFORM_CONFIG_UNAUDITED_UPDATE/);
    });

    it("Test 7: UPDATE without a matching history row is blocked (UNAUDITED_UPDATE) \u2014 GPT-5 v3 B1 fix", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const seed = db.prepare("SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as { revision_hash: string };
      const newHash = "b" + "eef".repeat(21);
      // Correct version+1 and prev_hash, BUT no history row \u2014 must be rejected.
      expect(() =>
        db.prepare(`UPDATE platform_config
                      SET version = 2, prev_revision_hash = ?, revision_hash = ?, updated_at = ?
                    WHERE key = 'billing_cycle.default'`).run(seed.revision_hash, newHash, T0),
      ).toThrow(/PLATFORM_CONFIG_UNAUDITED_UPDATE/);
    });

    it("Test 7b: history row with mismatched revision_hash still counts as UNAUDITED_UPDATE", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const seed = db.prepare("SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as { revision_hash: string };
      // Write a history row for version 2 but with a DIFFERENT revision_hash.
      db.prepare(`INSERT INTO platform_config_history
                    (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, change_kind)
                  VALUES ('h_mismatch','billing_cycle.default',2,'{}',?,?,?, 'update')`)
        .run(seed.revision_hash, "ffff".repeat(16), T0);
      // UPDATE claims a different revision_hash \u2014 history-existence check must reject.
      expect(() =>
        db.prepare(`UPDATE platform_config
                      SET version = 2, prev_revision_hash = ?, revision_hash = ?, updated_at = ?
                    WHERE key = 'billing_cycle.default'`).run(seed.revision_hash, "aaaa".repeat(16), T0),
      ).toThrow(/PLATFORM_CONFIG_UNAUDITED_UPDATE/);
    });

    it("Test 8: DELETE on platform_config is blocked (NO_DELETE)", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      expect(() =>
        db.prepare("DELETE FROM platform_config WHERE key='billing_cycle.default'").run(),
      ).toThrow(/PLATFORM_CONFIG_NO_DELETE/);
    });
  });

  describe("End-to-end bootstrap sanity", () => {
    it("Test 9: fresh DB via SQL migrations produces 5 tables + all rows", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN
         ('currency_ref','allocation_rule','fx_rate_snapshot','platform_config','platform_config_history')
         ORDER BY name`,
      ).all();
      expect(tables.map((t: any) => t.name)).toEqual([
        "allocation_rule", "currency_ref", "fx_rate_snapshot",
        "platform_config", "platform_config_history",
      ]);
      expect((db.prepare("SELECT COUNT(*) AS n FROM currency_ref").get() as { n: number }).n).toBe(167);
      expect((db.prepare("SELECT COUNT(*) AS n FROM platform_config").get() as { n: number }).n).toBe(6);
      expect((db.prepare("SELECT COUNT(*) AS n FROM platform_config_history").get() as { n: number }).n).toBe(6);
    });

    it("Test 10: all 14 Wave 0 triggers present under SQL-migration bootstrap (v6: +1)", () => {
      const db = freshDb();
      applyWave0SqlOnly(db);
      const triggers = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
      ).all() as Array<{ name: string }>;
      const expected = [
        "trg_allocation_rule_no_delete",
        "trg_allocation_rule_no_update",
        "trg_currency_ref_immutable",
        "trg_currency_ref_no_delete",
        "trg_fx_no_delete",
        "trg_fx_no_update",
        "trg_pc_atomic_audit",
        "trg_pc_chain_guard",
        "trg_pc_no_delete",
        "trg_pc_no_direct_insert",
        "trg_pc_no_key_change", // v6 new (GPT-5 v5)
        "trg_pch_chain_integrity",
        "trg_pch_no_delete",
        "trg_pch_no_update",
      ];
      expect(triggers.map(t => t.name).sort()).toEqual(expected);
    });

    it("Test 10b (v6): same 14 triggers present under inline bootstrap (three-place strict parity)", () => {
      const db = freshDb();
      applyWave0Inline(db);
      const triggers = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
      ).all() as Array<{ name: string }>;
      const expected = [
        "trg_allocation_rule_no_delete",
        "trg_allocation_rule_no_update",
        "trg_currency_ref_immutable",
        "trg_currency_ref_no_delete",
        "trg_fx_no_delete",
        "trg_fx_no_update",
        "trg_pc_atomic_audit",
        "trg_pc_chain_guard",
        "trg_pc_no_delete",
        "trg_pc_no_direct_insert",
        "trg_pc_no_key_change",
        "trg_pch_chain_integrity",
        "trg_pch_no_delete",
        "trg_pch_no_update",
      ];
      expect(triggers.map(t => t.name).sort()).toEqual(expected);
    });
  });

  describe("v6 new tests \u2014 boot-safety after audited updates + fail-loud on drift", () => {
    // Helper: perform a legitimate audited v1->v2 update on billing_cycle.default,
    // matching Wave F's write path (history INSERT first, then current UPDATE).
    const auditedV1toV2 = (db: any, opts: { newVal?: string, newHash?: string } = {}) => {
      const seed = db.prepare(
        "SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'",
      ).get() as { revision_hash: string };
      const newVal = opts.newVal ?? '"monthly"';
      const newHash = opts.newHash ?? "beef".repeat(16);
      const snapshot = JSON.stringify({
        v: 2, key: "billing_cycle.default", vt: "string", val: newVal,
      });
      // Audit-first (matches trg_pc_no_direct_insert / trg_pch_chain_integrity contract)
      db.prepare(
        `INSERT INTO platform_config_history
           (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
         VALUES ('h_v2', 'billing_cycle.default', 2, ?, ?, ?, ?, 'wave_f_writer', 'update')`,
      ).run(snapshot, seed.revision_hash, newHash, T0);
      db.prepare(
        `UPDATE platform_config
           SET value_json = ?, version = 2, prev_revision_hash = ?, revision_hash = ?, updated_at = ?, updated_by = 'wave_f_writer'
         WHERE key = 'billing_cycle.default'`,
      ).run(newVal, seed.revision_hash, newHash, T0);
      return { newVal, newHash };
    };

    it("Test 12: after a fully audited v1->v2 update, re-running apply does NOT throw (boot-safe)", () => {
      // This is the Opus v5 B1 regression test. Prior to v6 the drift check
      // asserted version === 1 on every seeded row and would abort boot on
      // the very first Wave F edit \u2014 with no in-schema recovery path.
      const db = freshDb();
      applyWave0PlatformConfigSchema(db);
      auditedV1toV2(db);
      // Now simulate a server restart: apply is idempotent and must NOT throw.
      expect(() => applyWave0PlatformConfigSchema(db)).not.toThrow();
      // Row is at version 2 with the new value; drift check passed.
      const row = db.prepare(
        "SELECT value_json, version FROM platform_config WHERE key='billing_cycle.default'",
      ).get() as { value_json: string, version: number };
      expect(row.version).toBe(2);
      expect(row.value_json).toBe('"monthly"');
    });

    it("Test 13: pre-existing divergent history genesis row makes apply throw Wave0SeedDriftError (fail-loud, not fail-open)", () => {
      // Opus v5 B2 regression test. Prior to v6 a pre-existing divergent
      // history genesis row caused INSERT OR IGNORE to swallow the conflict,
      // then the trigger aborted the current-state INSERT inside the DDL+seed
      // tx, rolled back the CREATE TABLEs, and downgraded to log.warn \u2014
      // leaving boot to "succeed" with no platform_config tables.
      //
      // v6 fix: convert the trigger-abort SqliteError to a Wave0SeedDriftError
      // inside applyWave0PlatformConfigSchema so runWave0Apply re-throws.
      const db = freshDb();
      // Build ONLY the DDL + triggers by hand (no seed) so we can insert a
      // divergent history row before apply runs.
      db.exec(`
        CREATE TABLE platform_config (
          key TEXT PRIMARY KEY NOT NULL,
          value_json TEXT NOT NULL CHECK (json_valid(value_json)),
          value_type TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
          description TEXT,
          is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          prev_revision_hash TEXT NOT NULL,
          revision_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          updated_by TEXT
        ) STRICT;
        CREATE TABLE platform_config_history (
          history_id TEXT PRIMARY KEY NOT NULL,
          config_key TEXT NOT NULL,
          version INTEGER NOT NULL,
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          prev_revision_hash TEXT NOT NULL,
          revision_hash TEXT NOT NULL,
          changed_at TEXT NOT NULL,
          changed_by TEXT,
          change_kind TEXT NOT NULL,
          UNIQUE (config_key, version)
        ) STRICT;
      `);
      // Insert a divergent history genesis for one of the seeded keys BEFORE
      // running apply. This is what a corrupted / partially-migrated DB
      // looks like. Use the CANONICAL history_id and (config_key, version=1)
      // so the UNIQUE constraint will make apply's OR IGNORE swallow the
      // conflict \u2014 exactly the fail-open scenario.
      db.prepare(
        `INSERT INTO platform_config_history
           (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
         VALUES ('pch_gen_billing_cycle_default', 'billing_cycle.default', 1, ?, ?, ?, ?, 'tampered', 'genesis')`,
      ).run(
        JSON.stringify({v:1,key:'billing_cycle.default',vt:'string',val:'"tampered"'}),
        GENESIS_PREV,
        "badhash".padEnd(64, "0"),
        T0,
      );
      // Now run apply. v6 must throw Wave0SeedDriftError (fail-loud).
      // Under v5 this would have thrown a plain SqliteError which
      // runWave0Apply would downgrade to log.warn.
      expect(() => applyWave0PlatformConfigSchema(db)).toThrow(Wave0SeedDriftError);
      // Schema is still intact (tables exist for diagnosis).
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'platform_config%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      expect(tables.map(t => t.name)).toEqual(["platform_config", "platform_config_history"]);
    });

    it("Test 14: trg_pc_no_direct_insert rejects an INSERT whose value_json disagrees with the genesis history row", () => {
      // v6 fix: no_direct_insert now enforces the SAME content-linkage as
      // atomic_audit. Even with a valid genesis history row present, a
      // current-state INSERT with a divergent value_json is rejected.
      const db = freshDb();
      applyWave0SqlOnly(db);
      // Seeds already ran. Try to insert a NEW key with a valid genesis
      // history row, and a mismatched current-state row.
      const goodHash = "cafe".repeat(16);
      const goodSnapshot = JSON.stringify({v:1, key:'new.test.key', vt:'string', val:'"good"'});
      db.prepare(
        `INSERT INTO platform_config_history
           (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, change_kind)
         VALUES ('h_new', 'new.test.key', 1, ?, ?, ?, ?, 'genesis')`,
      ).run(goodSnapshot, GENESIS_PREV, goodHash, T0);
      // Now attempt a divergent current-state INSERT with same (key, version, hash)
      // but wrong value_json. Under v5 this would have been accepted.
      expect(() =>
        db.prepare(
          `INSERT INTO platform_config
             (key, value_json, value_type, version, prev_revision_hash, revision_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run("new.test.key", '"DIVERGENT"', "string", 1, GENESIS_PREV, goodHash, T0, T0),
      ).toThrow(/PLATFORM_CONFIG_UNAUDITED_INSERT/);
      // But a matching current-state INSERT succeeds.
      db.prepare(
        `INSERT INTO platform_config
           (key, value_json, value_type, version, prev_revision_hash, revision_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("new.test.key", '"good"', "string", 1, GENESIS_PREV, goodHash, T0, T0);
      const row = db.prepare("SELECT value_json FROM platform_config WHERE key='new.test.key'").get() as { value_json: string };
      expect(row.value_json).toBe('"good"');
    });

    it("Test 15: trg_pc_no_key_change blocks UPDATE that renames the key (cross-key hijack closed)", () => {
      // v6 fix (GPT-5 v5): platform_config.key is part of audit identity.
      // Without this trigger, a fabricated equal-hash construction across
      // two key namespaces could rename an existing row into a different chain.
      // v7 note (Opus v6 N1): the bare rename also satisfies
      // trg_pc_chain_guard (no version bump) and trg_pc_atomic_audit (no
      // matching history row). Any of the three triggers rejecting the
      // rename is a safe outcome; the assertion is widened to accept any
      // of them. In practice SQLite fires newest-first, so
      // PLATFORM_CONFIG_KEY_IMMUTABLE fires, but the test does not depend on
      // undocumented trigger ordering.
      const db = freshDb();
      applyWave0SqlOnly(db);
      expect(() =>
        db.prepare(
          `UPDATE platform_config SET key = 'billing_cycle.hijacked' WHERE key = 'billing_cycle.default'`,
        ).run(),
      ).toThrow(/PLATFORM_CONFIG_KEY_IMMUTABLE|PLATFORM_CONFIG_CHAIN_BREAK|PLATFORM_CONFIG_UNAUDITED_UPDATE/);
      // Row unchanged.
      const row = db.prepare("SELECT key FROM platform_config WHERE key='billing_cycle.default'").get() as { key: string };
      expect(row.key).toBe("billing_cycle.default");
    });

    it("Test 15b: trg_pc_no_key_change fires even when chain_guard is satisfied (proves guard not shadowed)", () => {
      // v7 fix (Opus v6 N1): prove trg_pc_no_key_change is genuinely reachable
      // even when the UPDATE would otherwise satisfy chain_guard — i.e. a
      // rename that DOES bump version+1 with the correct prev_hash.
      // trg_pc_no_key_change must still fire.
      const db = freshDb();
      applyWave0SqlOnly(db);
      const seed = db.prepare("SELECT revision_hash FROM platform_config WHERE key='billing_cycle.default'").get() as { revision_hash: string };
      const newHash = "cafe".repeat(16);
      expect(() =>
        db.prepare(
          `UPDATE platform_config
             SET key = 'billing_cycle.hijacked',
                 version = 2,
                 prev_revision_hash = ?,
                 revision_hash = ?,
                 updated_at = ?
           WHERE key = 'billing_cycle.default'`,
        ).run(seed.revision_hash, newHash, T0),
      ).toThrow(/PLATFORM_CONFIG_KEY_IMMUTABLE/);
    });

    it("Test 16 (v7, Opus v6 C1): legacy DB with tampered v2 current row and no v2 history is caught by the drift-linkage check", () => {
      // Opus reproduced this on a scratch DB: a pre-existing legacy DB whose
      // current row was written BEFORE the audit triggers existed can carry
      // a v2 row with an arbitrary revision_hash and no corresponding v2
      // history row. The triggers cannot catch this (the row already exists),
      // and v6's drift check version>1 branch dropped the linkage assertion.
      // v7 restores it: if cur.version > 1, we require an actual history row
      // for (config_key, version, revision_hash, prev_revision_hash).
      const db = freshDb();
      // Build ONLY the DDL by hand (no triggers) so we can insert a tampered
      // legacy row that would abort under live triggers.
      db.exec(`
        CREATE TABLE platform_config (
          key TEXT PRIMARY KEY NOT NULL,
          value_json TEXT NOT NULL CHECK (json_valid(value_json)),
          value_type TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
          description TEXT,
          is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          prev_revision_hash TEXT NOT NULL,
          revision_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          updated_by TEXT
        ) STRICT;
        CREATE TABLE platform_config_history (
          history_id TEXT PRIMARY KEY NOT NULL,
          config_key TEXT NOT NULL,
          version INTEGER NOT NULL,
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          prev_revision_hash TEXT NOT NULL,
          revision_hash TEXT NOT NULL,
          changed_at TEXT NOT NULL,
          changed_by TEXT,
          change_kind TEXT NOT NULL,
          UNIQUE (config_key, version)
        ) STRICT;
      `);
      const PINNED_HASH = "a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66"; // billing_cycle.default pinned
      const TAMPERED_HASH = "f".repeat(64);
      // Correct pinned genesis history row — this row would pass any genesis-
      // integrity check on its own.
      db.prepare(
        `INSERT INTO platform_config_history
           (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
         VALUES ('pch_gen_billing_cycle_default', 'billing_cycle.default', 1, ?, ?, ?, ?, 'system:wave0_seed', 'genesis')`,
      ).run(
        JSON.stringify({v:1,key:'billing_cycle.default',vt:'string',val:'"annual"'}),
        GENESIS_PREV,
        PINNED_HASH,
        T0,
      );
      // Tampered current row: version=2, bogus revision_hash, NO v2 history.
      db.prepare(
        `INSERT INTO platform_config
           (key, value_json, value_type, description, is_secret, version, prev_revision_hash, revision_hash, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, 0, 2, ?, ?, ?, ?, 'system:wave0_seed', 'attacker')`,
      ).run("billing_cycle.default", '"attacker_value"', "string", "Default billing cycle for new partners. Owner decision 5.", PINNED_HASH, TAMPERED_HASH, T0, T0);
      // Now run apply. v7 must detect this and throw Wave0SeedDriftError.
      // Without v7-A, v6 boots this clean (the version>1 branch of the drift
      // check asserts only created_at/created_by).
      expect(() => applyWave0PlatformConfigSchema(db)).toThrow(Wave0SeedDriftError);
    });
  });
});
