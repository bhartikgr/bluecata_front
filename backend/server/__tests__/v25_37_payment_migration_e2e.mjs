/* v25.37 Phase 3 — E2E: payment-migration completeness.
 *
 * Proves the BLOCKER B-Migrations fix: the v25.33 / v25.34 / legacy payment
 * tables, their indexes, the additive columns, and the $0 default seed rows
 * are now present in the numbered migration set (0054 / 0055 / 0056) and apply
 * cleanly to a fresh DB via the production migration runner (server/db/migrate).
 *
 * Two layers of assertion:
 *   (A) RUNTIME — run runMigrations() against a brand-new temp SQLite file the
 *       exact way production boots it (inline baseline + numbered migrations),
 *       then query sqlite_master / pragma to assert every payment table, index,
 *       additive column, and seed row exists.
 *   (B) SOURCE — assert each migration FILE physically contains the CREATE
 *       TABLE / seed statements, so the completeness is owned by the numbered
 *       migrations themselves (not only the bootstrap path in connection.ts).
 *
 * Runs under the v25.34 E2E vitest config (pool=forks, singleFork).
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runMigrations } from "../db/migrate.ts";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");

let db;
let dbPath;

const PAYMENT_TABLES = [
  // v25.33 (migration 0054)
  "partner_fee_schedules",
  "partner_tax_forms",
  "company_settings_overview",
  // v25.34 (migration 0055)
  "collective_payment_schedules",
  "collective_payment_entries",
  "collective_invoices",
  // legacy (migration 0056)
  "payment_ledger",
  "payment_webhook_events",
  "processed_webhook_events",
  "fx_rates",
  "investor_kyc",
  "billing_disputes",
  "partner_billing_entries",
];

const REQUIRED_INDEXES = [
  "idx_pfs_lookup", "idx_pfs_kind",
  "idx_ptf_partner", "idx_ptf_expires",
  "idx_cps_lookup", "idx_cps_member", "idx_cps_tier", "idx_cps_kind",
  "idx_cpe_member", "idx_cpe_kind", "idx_cpe_status", "idx_cpe_invoice", "idx_cpe_idem",
  "idx_cinv_member", "idx_cinv_status",
  "idx_payment_customer", "idx_payment_state", "idx_payment_state_ts", "idx_payment_ts",
  "idx_pwe_intent", "idx_pwe_received",
  "idx_ikyc_investor",
  "idx_bd_sub", "idx_bd_status",
  "idx_pbe_partner", "idx_pbe_status", "idx_pbe_entry_kind", "idx_pbe_spv_fund",
];

beforeAll(async () => {
  const Better = require("better-sqlite3");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2537mig-"));
  dbPath = path.join(tmpDir, "fresh.db");
  // Production boot path for SQLite: inline baseline + numbered migrations.
  await runMigrations({
    databaseUrl: "file:" + dbPath,
    migrationsDir: MIGRATIONS_DIR,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  db = new Better(dbPath);
});

afterAll(() => {
  try { db?.close(); } catch { /* noop */ }
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* noop */ }
});

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function indexExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
}
function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

describe("v25.37 payment migration completeness — runtime (fresh DB)", () => {
  it("scenario 1: all v25.33 / v25.34 / legacy payment tables exist after migration", () => {
    const missing = PAYMENT_TABLES.filter((t) => !tableExists(t));
    expect(missing).toEqual([]);
  });

  it("scenario 2: all required payment indexes exist", () => {
    const missing = REQUIRED_INDEXES.filter((i) => !indexExists(i));
    expect(missing).toEqual([]);
  });

  it("scenario 3: v25.33 $0 default partner_fee_schedules seed rows are present", () => {
    const ids = db.prepare("SELECT id FROM partner_fee_schedules ORDER BY id").all().map((r) => r.id);
    for (const want of [
      "pfs_def_sub_m", "pfs_def_sub_y", "pfs_def_spv_mgmt", "pfs_def_spv_bonus",
      "pfs_def_spv_band1", "pfs_def_spv_band2", "pfs_def_spv_band3", "pfs_def_spv_band4",
    ]) {
      expect(ids).toContain(want);
    }
    // Every seed must be $0 (no hardcoded prices).
    const nonZero = db.prepare("SELECT COUNT(*) c FROM partner_fee_schedules WHERE amount_minor <> 0").get().c;
    expect(nonZero).toBe(0);
  });

  it("scenario 4: v25.34 $0 default collective_payment_schedules seed rows are present", () => {
    const ids = db.prepare("SELECT id FROM collective_payment_schedules ORDER BY id").all().map((r) => r.id);
    for (const want of ["cps_def_dues", "cps_def_event", "cps_def_sponsor", "cps_def_chapter", "cps_def_late"]) {
      expect(ids).toContain(want);
    }
    const nonZero = db.prepare("SELECT COUNT(*) c FROM collective_payment_schedules WHERE amount_minor <> 0").get().c;
    expect(nonZero).toBe(0);
  });

  it("scenario 5: v25.33 additive columns exist on partner_billing_entries + spvs", () => {
    const pbe = columns("partner_billing_entries");
    for (const col of ["entry_kind", "spv_fund_id", "fee_schedule_id", "computed_via"]) {
      expect(pbe).toContain(col);
    }
    const spvs = columns("spvs");
    for (const col of ["deployment_fee_minor", "deployment_fee_currency", "deployment_fee_payer", "sourcing_partner_id"]) {
      expect(spvs).toContain(col);
    }
  });

  it("scenario 6: v25.34 idempotency_key column + fx_rates seeds exist", () => {
    expect(columns("collective_payment_entries")).toContain("idempotency_key");
    const fx = db.prepare("SELECT currency_code FROM fx_rates ORDER BY currency_code").all().map((r) => r.currency_code);
    for (const code of ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"]) {
      expect(fx).toContain(code);
    }
  });

  it("scenario 7: migration runner is idempotent — re-running applies 0 new migrations", async () => {
    const r = await runMigrations({
      databaseUrl: "file:" + dbPath,
      migrationsDir: MIGRATIONS_DIR,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(r.applied.length).toBe(0);
    // Tables still present and seeds not duplicated.
    expect(tableExists("partner_fee_schedules")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) c FROM partner_fee_schedules").get().c).toBe(8);
    expect(db.prepare("SELECT COUNT(*) c FROM collective_payment_schedules").get().c).toBe(5);
  });
});

describe("v25.37 payment migration completeness — source (numbered files own it)", () => {
  const f0054 = fs.readFileSync(path.join(MIGRATIONS_DIR, "0054_v25_33_partner_payment_model.sql"), "utf8");
  const f0055 = fs.readFileSync(path.join(MIGRATIONS_DIR, "0055_v25_34_collective_payment_model.sql"), "utf8");
  const f0056 = fs.readFileSync(path.join(MIGRATIONS_DIR, "0056_v25_37_legacy_payment_tables.sql"), "utf8");

  it("0054 contains the v25.33 partner payment CREATE TABLE + seeds", () => {
    expect(f0054).toMatch(/CREATE TABLE IF NOT EXISTS partner_fee_schedules/);
    expect(f0054).toMatch(/CREATE TABLE IF NOT EXISTS partner_tax_forms/);
    expect(f0054).toMatch(/CREATE TABLE IF NOT EXISTS company_settings_overview/);
    expect(f0054).toMatch(/INSERT OR IGNORE INTO partner_fee_schedules/);
  });
  it("0055 contains the v25.34 collective payment CREATE TABLE + seeds", () => {
    expect(f0055).toMatch(/CREATE TABLE IF NOT EXISTS collective_payment_schedules/);
    expect(f0055).toMatch(/CREATE TABLE IF NOT EXISTS collective_payment_entries/);
    expect(f0055).toMatch(/CREATE TABLE IF NOT EXISTS collective_invoices/);
    expect(f0055).toMatch(/INSERT OR IGNORE INTO collective_payment_schedules/);
  });
  it("0056 contains the legacy payment CREATE TABLE + fx seeds", () => {
    expect(f0056).toMatch(/CREATE TABLE IF NOT EXISTS payment_ledger/);
    expect(f0056).toMatch(/CREATE TABLE IF NOT EXISTS fx_rates/);
    expect(f0056).toMatch(/CREATE TABLE IF NOT EXISTS investor_kyc/);
    expect(f0056).toMatch(/CREATE TABLE IF NOT EXISTS billing_disputes/);
    expect(f0056).toMatch(/INSERT OR IGNORE INTO fx_rates/);
  });
});
