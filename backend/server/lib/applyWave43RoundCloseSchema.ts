// server/lib/applyWave43RoundCloseSchema.ts
//
// WAVE 43 · R7 — self-heal installer for
// migration 0184_wave43_round_late_acceptances.sql.
//
// WHY THIS EXISTS
//   `applyInlineMigrations` in server/db/connection.ts builds a database from
//   DDL inlined in that file rather than from the numbered migrations, and
//   connection.ts is SACRED — this wave may not edit it. `NODE_ENV=test` opens
//   exactly that bootstrap path, so without this installer the
//   `round_late_acceptances` table would simply not exist under test and every
//   late-acceptance write would fail with "no such table". Same gap
//   server/lib/applyWave38EventLedgerSchema.ts closes for 0183.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM migration 0184 and executed
//   statement for statement through the real runner's `splitStatements`, so the
//   installer and the migration cannot drift. 0184 is entirely composed of
//   `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`, so no
//   statement needs partitioning by table (0183's installer needed that only
//   because it rebuilds six tables) and re-running is a no-op.
//
// FAILURE POSTURE
//   log.warn and continue, never rethrow: boot must not die because a heal
//   could not run. But the result is RETURNED, not swallowed — the store that
//   calls this checks `tableReady` and refuses the write with an honest error
//   rather than pretending an acceptance was recorded.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { splitStatements } from "../db/migrate";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0184_wave43_round_late_acceptances.sql";

export const WAVE43_LATE_ACCEPTANCE_TABLE = "round_late_acceptances";

/** Both trees may hold a copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "migrations", MIGRATION_BASENAME),
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
  ];
}

function readMigrationSql(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Comment-only chunks come back from `splitStatements`; they are not DDL. */
function isExecutable(stmt: string): boolean {
  const code = stmt.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim();
  return code.length > 0;
}

function tableExists(db: DbLike, table: string): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) as { name?: string } | undefined;
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

export interface Wave43RoundCloseHealResult {
  /** Number of statements executed on this call (0 once the table is present). */
  executed: number;
  /** True when `round_late_acceptances` exists after this call. */
  tableReady: boolean;
  /** Non-fatal problems, reported rather than swallowed. */
  failures: string[];
}

/**
 * Install migration 0184's table and indexes on a database built by the
 * bootstrap path. Idempotent: once the table exists this returns immediately.
 */
export function applyWave43RoundCloseSchema(db: DbLike): Wave43RoundCloseHealResult {
  const result: Wave43RoundCloseHealResult = { executed: 0, tableReady: false, failures: [] };

  if (tableExists(db, WAVE43_LATE_ACCEPTANCE_TABLE)) {
    result.tableReady = true;
    return result;
  }

  const sql = readMigrationSql();
  if (sql === null) {
    const msg =
      `[wave43RoundCloseSchema] ${MIGRATION_BASENAME} not found in ${candidatePaths().join(" or ")}; ` +
      `${WAVE43_LATE_ACCEPTANCE_TABLE} will be absent and late acceptances will be refused, not silently dropped`;
    log.warn(msg);
    result.failures.push(msg);
    return result;
  }

  for (const stmt of splitStatements(sql)) {
    if (!isExecutable(stmt)) continue;
    try {
      db.exec(stmt);
      result.executed += 1;
    } catch (err) {
      const msg = `[wave43RoundCloseSchema] statement failed: ${(err as Error).message}`;
      log.warn(msg);
      result.failures.push(msg);
    }
  }

  result.tableReady = tableExists(db, WAVE43_LATE_ACCEPTANCE_TABLE);
  return result;
}

let healed = false;

/**
 * Once-per-process wrapper for the hot path, matching
 * `applyWave38EventLedgerSchemaOnce`'s usage at
 * server/lib/partnerBillingStore.ts:104.
 *
 * The latch is only set on SUCCESS. A failed heal is retried on the next call
 * rather than being remembered as done — the exact "a check that passed while
 * checking nothing" shape this build's history is full of.
 */
export function applyWave43RoundCloseSchemaOnce(db: DbLike): Wave43RoundCloseHealResult {
  if (healed) return { executed: 0, tableReady: true, failures: [] };
  const r = applyWave43RoundCloseSchema(db);
  if (r.tableReady) healed = true;
  return r;
}

/** Test-only: forget the latch so a fresh in-memory database can be healed. */
export function _resetWave43RoundCloseHealLatch(): void {
  healed = false;
}
