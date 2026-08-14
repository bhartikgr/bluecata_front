// server/lib/applyWave45PricingSchema.ts
//
// WAVE 45 — self-heal installer for migration 0185_wave45_pricing_model_v3.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap (`applyInlineMigrations` in server/db/connection.ts)
//   builds a database from DDL inlined in THAT file, not from the numbered
//   migrations, and connection.ts is SACRED — this wave may not edit it. A
//   fresh `:memory:` database, which is exactly what NODE_ENV=test opens, would
//   therefore have none of the Wave 45 pricing tables and every test touching
//   them would either fail outright or — far worse — PASS VACUOUSLY against a
//   table that does not exist. This build's history contains 25+ instances of
//   "a check that passed while checking nothing"; an installer is how that is
//   avoided here. Same shape as applyWave5MoneySchema.ts.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed in this file. It is READ FROM the migration itself,
//   so installer and migration cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do.
//
// ORDERING — WAVE 5 FIRST, ALWAYS
//   0185 INSERTs into `partner_tier_price` and UPDATEs `percent_policy_record`,
//   both created by 0153. So Wave 5's installer runs first, unconditionally.
//   Without that the INSERTs would raise "no such table" and a naive installer
//   would report success having created only the tables it owns.
//
// TRIGGERS AND THE STATEMENT SPLITTER
//   0185 creates triggers whose bodies contain semicolons. The file is executed
//   as ONE script via db.exec(), never split on `;`, which would corrupt every
//   trigger body. Those triggers are the whole enforcement mechanism for
//   "freeze genuinely prevents a price edit" and "delete is refused", so
//   silently losing them would turn a real control into a decorative flag.

import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { getDb, getDbDriver, rawDb } from "../db/connection";
import { ensureWave5MoneySchema } from "./applyWave5MoneySchema";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0185_wave45_pricing_model_v3.sql";

export const WAVE45_STORE_UNAVAILABLE = "PARTNER_PRICING_STORE_UNAVAILABLE";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave45PricingDdl(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

/**
 * The tables 0185 creates. Used as the "already installed?" probe and by the
 * Wave 45 tests to assert the install actually happened rather than assuming it.
 */
export const WAVE45_TABLES = [
  "partner_tier_lifecycle",
  "partner_tier_capability",
  "partner_pricing_model_config",
  "partner_grandfather_grant",
] as const;

/**
 * The triggers 0185 attaches. These ARE the enforcement for freeze-blocks-edit
 * and delete-is-refused, so their presence is asserted rather than assumed.
 */
export const WAVE45_TRIGGERS = [
  "trg_ptp_frozen_no_price_update",
  "trg_ptp_frozen_no_price_insert",
  "trg_ptl_no_delete",
] as const;

export interface Wave45InstallResult {
  ran: boolean;
  reason: string;
  tablesPresent: string[];
  tablesMissing: string[];
  triggersPresent: string[];
  triggersMissing: string[];
  warnings: string[];
}

function objectExists(db: DbLike, name: string, type: "table" | "trigger"): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name = ?`)
      .get(type, name) as { name?: string } | undefined;
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

export function applyWave45PricingSchema(db: DbLike): Wave45InstallResult {
  const warnings: string[] = [];

  // Wave 5 owns partner_tier_price and percent_policy_record, which 0185
  // writes into. Never reordered.
  try {
    ensureWave5MoneySchema(db);
  } catch (err) {
    warnings.push(`wave5 prerequisite install failed: ${(err as Error).message}`);
  }

  const probe = () => ({
    tablesPresent: WAVE45_TABLES.filter((t) => objectExists(db, t, "table")),
    tablesMissing: WAVE45_TABLES.filter((t) => !objectExists(db, t, "table")),
    triggersPresent: WAVE45_TRIGGERS.filter((t) => objectExists(db, t, "trigger")),
    triggersMissing: WAVE45_TRIGGERS.filter((t) => !objectExists(db, t, "trigger")),
  });

  let state = probe();
  if (state.tablesMissing.length === 0 && state.triggersMissing.length === 0) {
    return { ran: false, reason: "already installed", warnings, ...state };
  }

  const ddl = readWave45PricingDdl();
  if (!ddl) {
    // Loud, not silent. A missing installer DDL means every Wave 45 assertion
    // downstream would be measuring nothing.
    warnings.push(
      `could not read ${MIGRATION_BASENAME} from any of: ${candidatePaths().join(", ")}`,
    );
    log.error?.({ warnings }, "wave45 pricing schema install could not read its migration");
    return { ran: false, reason: "ddl not found", warnings, ...state };
  }

  try {
    // ONE script. Not split on ';' — see the header note on trigger bodies.
    db.exec(ddl);
  } catch (err) {
    warnings.push(`exec failed: ${(err as Error).message}`);
    log.error?.({ err }, "wave45 pricing schema install failed");
  }

  state = probe();
  if (state.tablesMissing.length > 0 || state.triggersMissing.length > 0) {
    log.warn?.(
      { tablesMissing: state.tablesMissing, triggersMissing: state.triggersMissing },
      "wave45 pricing schema install incomplete",
    );
  }
  return { ran: true, reason: "installed", warnings, ...state };
}

/* ------------------------------------------------------------------ */
/* Memoised lazy bootstrap                                             */
/* ------------------------------------------------------------------ */
//
// Keyed by the driver object via WeakSet, NOT a module-level boolean, so a test
// that opens a SECOND in-memory database gets a real install instead of a stale
// "already done" short-circuit. Memoising on a module boolean is precisely why
// earlier waves had tests passing vacuously against absent tables.
const _installed = new WeakSet<object>();

export function ensureWave45PricingSchema(db: DbLike): void {
  if (_installed.has(db as unknown as object)) return;
  applyWave45PricingSchema(db);
  _installed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave45SchemaMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}

/** Every Wave 45 store function starts with `const db = wave45Db();`. */
export function wave45Db(): DbLike {
  if (getDbDriver() === "postgres") {
    throw new Error(WAVE45_STORE_UNAVAILABLE);
  }
  getDb(); // guarantee a connection exists before reaching for the raw handle
  const db = rawDb() as unknown as DbLike;
  ensureWave45PricingSchema(db);
  return db;
}
