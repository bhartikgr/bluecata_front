// server/lib/applyWave5MoneySchema.ts
//
// WAVE 5 — self-heal installer for migration 0153_wave5_money_captable.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL inlined in THAT file,
//   not from the numbered migrations. connection.ts is SACRED — this wave may
//   not edit it — so a new installer cannot be registered there. Without a
//   heal, a fresh `:memory:` database (which is exactly what `NODE_ENV=test`
//   opens) has none of the Wave 5 money tables, and every test touching them
//   would either fail or, far worse, PASS VACUOUSLY against empty data. Same
//   shape as server/lib/applyWave9ReportingSchema.ts and
//   server/lib/applyWave4bPartnerClassificationSchema.ts.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM the migration file itself, so
//   this installer and migration 0153 cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do.
//
// TRIGGER STATEMENTS AND THE STATEMENT SPLITTER
//   0153 contains CREATE TRIGGER bodies with internal semicolons. `db.exec()`
//   on better-sqlite3 handles a multi-statement script including triggers, so
//   the whole file is executed as one script — it is NOT split on `;`, which
//   would corrupt every trigger body. That is deliberate and is the reason this
//   installer does not reuse a naive semicolon splitter.
//
// TRIGGERS OVER TABLES THAT MAY NOT EXIST YET
//   Three of 0153's triggers target tables owned by the SACRED bootstrap
//   (`contacts`, `captable_commits`, `founder_collective_applications`). On a
//   fresh :memory: database the bootstrap creates them BEFORE any store
//   hydrates, so by the time this installer runs they exist. If one does not,
//   SQLite raises "no such table" for that single CREATE TRIGGER. Rather than
//   abandoning the whole install, those statements are applied individually and
//   a miss is recorded as a WARNING with the table named — never swallowed
//   silently, because a missing domain fence on a money column is exactly the
//   kind of thing that must be visible.
//
// WAVE 13 — `partner_subscription` IS NO LONGER DECLARED BY 0153.
//   0153 used to CREATE TABLE IF NOT EXISTS partner_subscription with its own
//   shape (partner_id / tier_slug / cadence / period_*). Migration
//   0167_wave11_partner_subscription_engine.sql:37 creates the SAME table name
//   with the persona-agnostic EN-8 shape (subject_kind / subject_id / cycle /
//   current_period_*) that partnerSubscriptionStore.ts,
//   subscriptionEnforcementWorker.ts and subscriptionChangeStore.ts actually
//   read and write. `IF NOT EXISTS` + 0153 sorting first meant 0153 WON, and
//   THIS INSTALLER was the worst of it: it re-created the wrong shape on every
//   fresh install and every `:memory:` test database, where the numbered
//   migrations never run at all (A-22). A migration alone could not have fixed
//   that.
//
//   0153's declaration is therefore gone, and this installer delegates the
//   table to applyWave13SubscriptionShape(), which applies
//   0169_wave13_partner_subscription_shape_reconcile.sql — the ONE canonical
//   declaration — and reshapes a legacy table row for row. `partner_subscription`
//   stays in WAVE5_TABLES because the Wave 5 money columns it introduced
//   (list_amount_minor, grandfathered_from, superseded_by, superseded_reason,
//   and the `amount = list - discount` CHECK) are carried into the canonical
//   shape and are still asserted here.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { getDb, getDbDriver, rawDb } from "../db/connection";
import { applyWave13SubscriptionShape } from "./applyWave13SubscriptionShape";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0153_wave5_money_captable.sql";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave5MoneyDdl(): string | null {
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
 * The tables 0153 creates. Used as the "already installed?" probe and by the
 * Wave 5 tests to assert the install actually happened rather than assuming it.
 */
export const WAVE5_TABLES = [
  "percent_policy_record",
  "migration_supersession",
  "collective_renewal_worker_config",
  "partner_tier_price",
  "partner_subscription",
  "partner_invoice",
  "partner_invoice_line",
  "partner_promotion",
  "partner_promotion_grant",
  "partner_money_event",
  "captable_commit_idempotency",
  "spv_fee_hydration_state",
  "collective_fee_mirror_reject",
  "spv_fee_chain_rebuild",
  "valuation_mark_policy",
] as const;

/**
 * The triggers 0153 attaches to tables the SACRED bootstrap owns. These are
 * applied one at a time so a missing host table degrades to a NAMED WARNING
 * instead of aborting the whole install.
 */
const HOSTED_TRIGGERS: Array<{ trigger: string; hostTable: string }> = [
  { trigger: "trg_fca_traction_growth_pct_ins", hostTable: "founder_collective_applications" },
  { trigger: "trg_fca_traction_growth_pct_upd", hostTable: "founder_collective_applications" },
  { trigger: "trg_captable_commits_discount_pct_ins", hostTable: "captable_commits" },
  { trigger: "trg_captable_commits_discount_pct_upd", hostTable: "captable_commits" },
  { trigger: "trg_contacts_commission_override_pct_ins", hostTable: "contacts" },
  { trigger: "trg_contacts_commission_override_pct_upd", hostTable: "contacts" },
];

function tableExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  } catch {
    return false;
  }
}

function triggerExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(name);
  } catch {
    return false;
  }
}

export interface Wave5InstallResult {
  applied: boolean;
  reason: string;
  tablesPresent: string[];
  tablesMissing: string[];
  triggersPresent: string[];
  triggersMissing: Array<{ trigger: string; hostTable: string; reason: string }>;
}

/**
 * Idempotent bootstrap for the Wave 5 money + cap-table spine.
 *
 * Safe to call on every boot and from every test setup. Re-running against an
 * already-installed database is a no-op: every statement in 0153 is
 * IF NOT EXISTS / INSERT OR IGNORE.
 */
export function applyWave5MoneySchema(db: DbLike): Wave5InstallResult {
  const ddl = readWave5MoneyDdl();
  if (!ddl) {
    const reason = `WAVE5_DDL_NOT_FOUND: looked in ${candidatePaths().join(", ")}`;
    log.error?.({ route: "applyWave5MoneySchema", code: "WAVE5_DDL_NOT_FOUND", message: reason });
    return {
      applied: false,
      reason,
      tablesPresent: [],
      tablesMissing: [...WAVE5_TABLES],
      triggersPresent: [],
      triggersMissing: HOSTED_TRIGGERS.map((t) => ({ ...t, reason: "ddl_not_found" })),
    };
  }

  // Execute the whole script. `exec` handles CREATE TRIGGER bodies correctly;
  // a semicolon splitter would not.
  let applied = true;
  let reason = "applied";
  try {
    db.exec(ddl);
  } catch (err) {
    // A host-table miss aborts the script at that statement, leaving the
    // statements BEFORE it applied. Re-run the non-hosted portion so the Wave 5
    // tables themselves still install, then attach the hosted triggers
    // individually below.
    applied = false;
    reason = `partial: ${(err as Error).message}`;
    log.warn?.(
      `[applyWave5MoneySchema] whole-script exec failed (${(err as Error).message}); ` +
        `falling back to per-statement install so the Wave 5 tables still land.`,
    );
    try {
      db.exec(stripHostedTriggers(ddl));
      applied = true;
      reason = `applied_without_hosted_triggers: ${(err as Error).message}`;
    } catch (err2) {
      log.error?.({
        route: "applyWave5MoneySchema",
        code: "WAVE5_INSTALL_FAILED",
        message: (err2 as Error).message,
      });
      reason = `failed: ${(err2 as Error).message}`;
    }
  }

  // Attach the hosted triggers one at a time, naming any that could not attach.
  const triggersPresent: string[] = [];
  const triggersMissing: Array<{ trigger: string; hostTable: string; reason: string }> = [];
  for (const t of HOSTED_TRIGGERS) {
    if (triggerExists(db, t.trigger)) {
      triggersPresent.push(t.trigger);
      continue;
    }
    if (!tableExists(db, t.hostTable)) {
      triggersMissing.push({ ...t, reason: `host table ${t.hostTable} absent` });
      log.warn?.(
        `[applyWave5MoneySchema] domain fence ${t.trigger} NOT attached: host table ` +
          `${t.hostTable} does not exist yet. The column it fences is UNFENCED until ` +
          `this installer runs again after the table is created.`,
      );
      continue;
    }
    const sql = extractStatement(ddl, t.trigger);
    if (!sql) {
      triggersMissing.push({ ...t, reason: "statement not found in 0153" });
      continue;
    }
    try {
      db.exec(sql);
      triggersPresent.push(t.trigger);
    } catch (err) {
      triggersMissing.push({ ...t, reason: (err as Error).message });
      log.warn?.(
        `[applyWave5MoneySchema] domain fence ${t.trigger} failed to attach: ${(err as Error).message}`,
      );
    }
  }

  // WAVE 13. 0153 no longer declares `partner_subscription`; the canonical
  // declaration lives in 0169 and is applied here, so the WAVE5_TABLES
  // assertion below still holds and a legacy-shaped table is reshaped (row for
  // row) rather than left for a consumer to trip over. Idempotent.
  applyWave13SubscriptionShape(db);

  const tablesPresent: string[] = [];
  const tablesMissing: string[] = [];
  for (const t of WAVE5_TABLES) {
    (tableExists(db, t) ? tablesPresent : tablesMissing).push(t);
  }
  if (tablesMissing.length > 0) {
    log.error?.({
      route: "applyWave5MoneySchema",
      code: "WAVE5_TABLES_MISSING",
      message: `after install, ${tablesMissing.length} Wave 5 table(s) absent: ${tablesMissing.join(", ")}`,
    });
  }

  return { applied, reason, tablesPresent, tablesMissing, triggersPresent, triggersMissing };
}

/**
 * Remove the CREATE TRIGGER statements that target sacred-bootstrap tables, so
 * the remainder of 0153 can install on a database where those tables are not
 * yet present. Matches on the trigger NAME, so a rename in 0153 without a
 * rename here shows up as an un-stripped statement (and therefore a loud
 * failure) rather than as a silently skipped fence.
 */
function stripHostedTriggers(ddl: string): string {
  let out = ddl;
  for (const t of HOSTED_TRIGGERS) {
    const stmt = extractStatement(ddl, t.trigger);
    if (stmt) out = out.replace(stmt, "");
  }
  return out;
}

/**
 * Pull the single `CREATE TRIGGER IF NOT EXISTS <name> ... END;` statement out
 * of the DDL text. Terminates on `END;` because a trigger body contains
 * semicolons and splitting on `;` would truncate it.
 */
function extractStatement(ddl: string, triggerName: string): string | null {
  const start = ddl.indexOf(`CREATE TRIGGER IF NOT EXISTS ${triggerName}`);
  if (start < 0) return null;
  const endIdx = ddl.indexOf("END;", start);
  if (endIdx < 0) return null;
  return ddl.slice(start, endIdx + 4);
}

/* ------------------------------------------------------------------ */
/* Memoised lazy bootstrap                                             */
/* ------------------------------------------------------------------ */
//
// Every Wave 5 store accessor calls ensureWave5MoneySchema() before touching a
// table. That is the ONLY way a `:memory:` test database gets these tables,
// because connection.ts (SACRED) cannot be taught about them. Memoised per
// driver object so the cost is one sqlite_master probe per process, not per
// query — but keyed by the driver itself via WeakSet, so a test that opens a
// SECOND in-memory database still gets a real install rather than a stale
// "already done" short-circuit. That bug (memoising on a module-level boolean)
// is why several earlier waves had tests passing vacuously against tables that
// did not exist in the database under test.
const _installed = new WeakSet<object>();

export function ensureWave5MoneySchema(db: DbLike): void {
  if (_installed.has(db as unknown as object)) return;
  applyWave5MoneySchema(db);
  _installed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave5SchemaMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}

/* ------------------------------------------------------------------ */
/* Default-connection convenience                                      */
/* ------------------------------------------------------------------ */
//
// Same shape as ensureCarryCapPolicySchema() in ./combinedCarryCapPolicy: grab
// the process-wide SQLite handle, install if needed, hand it back. Every Wave 5
// store function starts with `const db = wave5Db();`.
export function wave5Db(): DbLike {
  if (getDbDriver() === "postgres") {
    throw new Error(WAVE5_STORE_UNAVAILABLE);
  }
  getDb(); // guarantee a connection exists before reaching for the raw handle
  const db = rawDb() as unknown as DbLike;
  ensureWave5MoneySchema(db);
  return db;
}

/** Canonical error: the Wave 5 money store is unreachable (e.g. Postgres backend). */
export const WAVE5_STORE_UNAVAILABLE = "WAVE5_STORE_UNAVAILABLE";
