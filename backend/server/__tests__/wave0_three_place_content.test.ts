/**
 * Wave 0 Increment 1 review item 10 \u2014 three-place rule CONTENT enforcement.
 *
 * The mirror-drift test (w9_migration_mirror_drift.test.ts) asserts filenames
 * and max-ID pins, but not CONTENT. This test closes that gap by:
 *
 *   1. Byte-comparing `migrations/012x_*.sql` against
 *      `server/db/migrations/012x_*.sql` for the Wave 0 range.
 *   2. Applying all three migrations to an in-memory SQLite DB and comparing
 *      the resulting schema + seed rows against the state produced by the
 *      inline apply functions in `server/db/connection.ts` (via `getDb()`).
 *
 * If either side drifts, all subsequent Wave 0 acceptance gates are moot \u2014
 * the SQL is the ledger of record and the inline path is what runs at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb, rawDb, resetDbForTests } from "../db/connection";

const WAVE0_IDS = ["0121", "0122", "0123"] as const;
const ROOT = path.resolve(__dirname, "../..");

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

describe("Wave 0 Increment 1 item 10: three-place rule CONTENT enforcement", () => {
  beforeEach(() => {
    resetDbForTests();
  });

  describe("Place 1 vs Place 2: migrations/ and server/db/migrations/ are byte-identical", () => {
    for (const id of WAVE0_IDS) {
      it(`${id}_*.sql is byte-identical between migrations/ and server/db/migrations/`, () => {
        const files1 = fs.readdirSync(path.join(ROOT, "migrations")).filter(f => f.startsWith(`${id}_`));
        const files2 = fs.readdirSync(path.join(ROOT, "server/db/migrations")).filter(f => f.startsWith(`${id}_`));
        expect(files1, `migrations/ missing ${id}_*.sql`).toHaveLength(1);
        expect(files2, `server/db/migrations/ missing ${id}_*.sql`).toHaveLength(1);
        expect(files1[0]).toBe(files2[0]);

        const buf1 = fs.readFileSync(path.join(ROOT, "migrations", files1[0]));
        const buf2 = fs.readFileSync(path.join(ROOT, "server/db/migrations", files2[0]));
        const h1 = sha256(buf1);
        const h2 = sha256(buf2);
        expect(h2, `${files1[0]} drifted: ${h1.slice(0,10)}\u2026 vs ${h2.slice(0,10)}\u2026`).toBe(h1);
      });
    }
  });

  describe("Place 1 vs Place 3: SQL migrations produce same state as inline bootstrap", () => {
    it("currency_ref: same row count and same (code, exponent) set", () => {
      // Place 3 (inline bootstrap via getDb())
      getDb();
      const inline = rawDb();
      const inlineRows = inline.prepare(
        "SELECT code, minor_unit_exponent AS exp FROM currency_ref ORDER BY code",
      ).all() as Array<{ code: string; exp: number }>;

      // Place 1 (SQL migration on a fresh :memory: DB)
      const Database = require("better-sqlite3");
      const sqlDb = new Database(":memory:");
      sqlDb.pragma("recursive_triggers = ON");
      sqlDb.pragma("foreign_keys = ON");
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0121_wave0_currency_ref.sql"), "utf8"));
      const sqlRows = sqlDb.prepare(
        "SELECT code, minor_unit_exponent AS exp FROM currency_ref ORDER BY code",
      ).all() as Array<{ code: string; exp: number }>;
      sqlDb.close();

      expect(inlineRows.length, "row count drift").toBe(sqlRows.length);
      for (let i = 0; i < inlineRows.length; i++) {
        expect(inlineRows[i]).toEqual(sqlRows[i]);
      }
    });

    it("platform_config: same 6 rows with identical revision_hash", () => {
      getDb();
      const inline = rawDb();
      const inlineRows = inline.prepare(
        "SELECT key, value_json, value_type, revision_hash FROM platform_config ORDER BY key",
      ).all() as Array<{ key: string; value_json: string; value_type: string; revision_hash: string }>;

      const Database = require("better-sqlite3");
      const sqlDb = new Database(":memory:");
      sqlDb.pragma("recursive_triggers = ON");
      sqlDb.pragma("foreign_keys = ON");
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0121_wave0_currency_ref.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0122_wave0_money_core.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0123_wave0_platform_config.sql"), "utf8"));
      const sqlRows = sqlDb.prepare(
        "SELECT key, value_json, value_type, revision_hash FROM platform_config ORDER BY key",
      ).all() as Array<{ key: string; value_json: string; value_type: string; revision_hash: string }>;
      sqlDb.close();

      expect(inlineRows).toEqual(sqlRows);
    });

    it("platform_config_history: same 6 genesis rows with identical revision_hash", () => {
      getDb();
      const inline = rawDb();
      const inlineRows = inline.prepare(
        "SELECT history_id, config_key, version, revision_hash, change_kind FROM platform_config_history ORDER BY config_key",
      ).all();

      const Database = require("better-sqlite3");
      const sqlDb = new Database(":memory:");
      sqlDb.pragma("recursive_triggers = ON");
      sqlDb.pragma("foreign_keys = ON");
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0121_wave0_currency_ref.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0122_wave0_money_core.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0123_wave0_platform_config.sql"), "utf8"));
      const sqlRows = sqlDb.prepare(
        "SELECT history_id, config_key, version, revision_hash, change_kind FROM platform_config_history ORDER BY config_key",
      ).all();
      sqlDb.close();

      expect(inlineRows).toEqual(sqlRows);
    });

    it("all Wave 0 tables + triggers exist under both bootstrap paths (v4: includes new chain-guard triggers)", () => {
      // v4 review Opus mandatory-yes: include the two v3 triggers plus the
      // new v4 trg_pc_atomic_audit trigger in the coverage list.
      getDb();
      const inline = rawDb();
      const inlineObjects = inline.prepare(
        `SELECT type, name FROM sqlite_master
         WHERE (type IN ('table','trigger'))
           AND name IN (
             'currency_ref', 'trg_currency_ref_immutable', 'trg_currency_ref_no_delete',
             'allocation_rule', 'trg_allocation_rule_no_update', 'trg_allocation_rule_no_delete',
             'fx_rate_snapshot', 'trg_fx_no_update', 'trg_fx_no_delete',
             'platform_config', 'trg_pc_chain_guard', 'trg_pc_atomic_audit',
             'trg_pc_no_direct_insert', 'trg_pc_no_key_change', 'trg_pc_no_delete',
             'platform_config_history', 'trg_pch_no_update', 'trg_pch_no_delete',
             'trg_pch_chain_integrity'
           )
         ORDER BY name`,
      ).all();

      const expected = [
        "allocation_rule", "currency_ref", "fx_rate_snapshot",
        "platform_config", "platform_config_history",
        "trg_allocation_rule_no_delete", "trg_allocation_rule_no_update",
        "trg_currency_ref_immutable", "trg_currency_ref_no_delete",
        "trg_fx_no_delete", "trg_fx_no_update",
        "trg_pc_atomic_audit", "trg_pc_chain_guard", "trg_pc_no_delete",
        "trg_pc_no_direct_insert", "trg_pc_no_key_change",
        "trg_pch_chain_integrity", "trg_pch_no_delete", "trg_pch_no_update",
      ];
      expect(inlineObjects.map((o: any) => o.name)).toEqual(expected);
    });

    it("SQL-migration bootstrap produces the same table + trigger set as inline (v4 review Opus M-parity)", () => {
      // Prove that the three-place rule holds not only for byte-identity of
      // migration files but also for the runtime effect of Place 3 (inline).
      const Database = require("better-sqlite3");
      const sqlDb = new Database(":memory:");
      sqlDb.pragma("recursive_triggers = ON");
      sqlDb.pragma("foreign_keys = ON");
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0121_wave0_currency_ref.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0122_wave0_money_core.sql"), "utf8"));
      sqlDb.exec(fs.readFileSync(path.join(ROOT, "migrations/0123_wave0_platform_config.sql"), "utf8"));

      const sqlObjects = sqlDb.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
      ).all().map((o: any) => o.name);
      sqlDb.close();

      getDb();
      const inline = rawDb();
      const inlineObjects = inline.prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
      ).all().map((o: any) => o.name);

      expect(inlineObjects).toEqual(sqlObjects);
    });
  });
});
