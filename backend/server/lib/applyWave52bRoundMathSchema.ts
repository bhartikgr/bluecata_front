// server/lib/applyWave52bRoundMathSchema.ts
//
// WAVE 52b — self-heal installer for
// migration 0189_wave52b_round_conversion_and_residual.sql.
//
// WHY THIS EXISTS
//   `applyInlineMigrations` in server/db/connection.ts builds a database from DDL
//   inlined in that file rather than from the numbered migrations, and
//   connection.ts is SACRED — this wave may not edit it, and WAIVER-6 (owner
//   ruling R24a) was granted once for that file and must not be taken again.
//   `NODE_ENV=test` opens exactly that bootstrap path, so without this installer
//   `round_instrument_conversion` and `round_residual_disposition` would simply
//   not exist under test and every write would fail with "no such table".
//
//   Repair Wave 1 is the reason this file is written before the store rather than
//   after it: migration 0188 added a column the inline DDL did not have, a whole
//   test file could not load, and 20 assertions were reported SKIPPED rather than
//   failed. The suite-shape gate (R24b) now catches that, but not needing it
//   caught is better.
//
// WHY NO WAIVER IS NEEDED HERE
//   0189 adds NEW TABLES ONLY. A new table is absent from the inline DDL by
//   definition, so there is no shape to keep in parity — unlike 0188, which
//   ALTERed a table connection.ts creates itself. Nothing in connection.ts is
//   read, written or required by this installer beyond its ordinary public
//   `rawDb()` handle.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM migration 0189 and executed
//   statement for statement through the real runner's own `splitStatements`, so
//   the installer and the migration cannot drift. 0189 is composed entirely of
//   `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`, so
//   re-running is a no-op. Same mechanism as
//   `server/lib/applyWave43RoundCloseSchema.ts` (0184) and
//   `server/lib/applyWave38EventLedgerSchema.ts` (0183).
//
// FAILURE POSTURE
//   log.warn and continue, never rethrow: boot must not die because a heal could
//   not run. But the result is RETURNED, not swallowed — the store that calls
//   this checks `tablesReady` and REFUSES the write with an honest error rather
//   than pretending a conversion status or a residual disposition was recorded.
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

const MIGRATION_BASENAME = "0189_wave52b_round_conversion_and_residual.sql";

export const WAVE52B_CONVERSION_TABLE = "round_instrument_conversion";
export const WAVE52B_RESIDUAL_TABLE = "round_residual_disposition";
export const WAVE52B_TABLES = [WAVE52B_CONVERSION_TABLE, WAVE52B_RESIDUAL_TABLE] as const;

/** Both trees hold a byte-identical copy (0180-0188 are all mirrored); most
 *  likely location first. */
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

export interface Wave52bRoundMathHealResult {
  /** Number of statements executed on this call (0 once both tables exist). */
  executed: number;
  /** True when BOTH 0189 tables exist after this call. */
  tablesReady: boolean;
  /** Per-table readiness, so a partial install is reported rather than averaged. */
  present: Record<string, boolean>;
  /** Non-fatal problems, reported rather than swallowed. */
  failures: string[];
}

/**
 * Install migration 0189's tables and indexes on a database built by the
 * bootstrap path. Idempotent: once both tables exist this returns immediately.
 */
export function applyWave52bRoundMathSchema(db: DbLike): Wave52bRoundMathHealResult {
  const result: Wave52bRoundMathHealResult = {
    executed: 0,
    tablesReady: false,
    present: {},
    failures: [],
  };

  const check = () => {
    for (const t of WAVE52B_TABLES) result.present[t] = tableExists(db, t);
    return WAVE52B_TABLES.every((t) => result.present[t]);
  };

  if (check()) {
    result.tablesReady = true;
    return result;
  }

  const sql = readMigrationSql();
  if (sql === null) {
    const msg =
      `[wave52bRoundMathSchema] ${MIGRATION_BASENAME} not found in ${candidatePaths().join(" or ")}; ` +
      `${WAVE52B_TABLES.join(" and ")} will be absent and conversion statuses / residual ` +
      `dispositions will be REFUSED, not silently dropped`;
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
      const msg = `[wave52bRoundMathSchema] statement failed: ${(err as Error).message}`;
      log.warn(msg);
      result.failures.push(msg);
    }
  }

  result.tablesReady = check();
  return result;
}

let healed = false;

/**
 * Once-per-process wrapper for the hot path, matching
 * `applyWave43RoundCloseSchemaOnce`'s usage.
 *
 * The latch is only set on SUCCESS. A failed heal is retried on the next call
 * rather than being remembered as done — the exact "a check that passed while
 * checking nothing" shape this build's history is full of.
 */
export function applyWave52bRoundMathSchemaOnce(db: DbLike): Wave52bRoundMathHealResult {
  if (healed) {
    return {
      executed: 0,
      tablesReady: true,
      present: { [WAVE52B_CONVERSION_TABLE]: true, [WAVE52B_RESIDUAL_TABLE]: true },
      failures: [],
    };
  }
  const r = applyWave52bRoundMathSchema(db);
  if (r.tablesReady) healed = true;
  return r;
}

/** Test-only: forget the latch so a fresh in-memory database can be healed. */
export function _resetWave52bRoundMathHealLatch(): void {
  healed = false;
}
