// server/lib/applyWave38EventLedgerSchema.ts
//
// WAVE 38 ROW 4 — self-heal installer for
// migration 0183_wave38_event_table_ledger_primitives.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL inlined in that file,
//   NOT from the numbered migrations, and connection.ts is SACRED — this wave
//   may not edit it. So on every database that comes up through the bootstrap
//   (which is exactly what `NODE_ENV=test` opens, and what a fresh `:memory:`
//   boot uses) the six event tables would keep their pre-0183 shape: no
//   `actor_id`, no `seq`, no idempotency index, and — the defect Row 4 is
//   actually about — `amount_minor` still able to swallow the string '12.5'.
//   The writers updated in this wave would then fail outright against that
//   shape. This installer closes that gap the same way
//   server/lib/applyWave9ReportingSchema.ts closes 0159's.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM migration 0183 itself and
//   executed statement for statement, so this installer and the migration
//   cannot drift. `wave38_row4_event_ledger_primitives_schema.test.ts` asserts
//   the resulting shape against a database built from the canonical migrations
//   ALONE, so the migration remains the authority and this file is only its
//   delivery mechanism on the bootstrap path.
//
// WHAT IT WILL NOT DO
//   - It will not rebuild a table that does not exist yet. Several of these
//     tables are themselves created lazily by their own store's installer; if
//     the table is absent, its block is skipped and the next call — after that
//     store has run — performs it.
//   - It will not rebuild a table that is ALREADY canonical. A rebuild moves
//     rows; doing it on every boot would be pointless work and a needless risk
//     to live data. Presence of both `actor_id` and `seq` is the marker, read
//     from the live schema rather than from any in-memory flag.
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

const MIGRATION_BASENAME = "0183_wave38_event_table_ledger_primitives.sql";

/**
 * The six tables migration 0183 rebuilds, in the order the migration performs
 * them. Kept here only to partition the statement stream — the DDL for each is
 * read from the migration, never restated.
 */
export const WAVE38_LEDGER_TABLES = [
  "partner_money_event",
  "valuation_event",
  "partner_subscription_event",
  "esign_event",
  "spv_discovery_event",
  "mf_engagement_event",
] as const;

export type Wave38LedgerTable = (typeof WAVE38_LEDGER_TABLES)[number];

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

function readMigrationSql(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* fall through to the next candidate */
    }
  }
  return null;
}

/**
 * Partition 0183's statements by the table each one acts on.
 *
 * Every DDL/DML statement in 0183 names exactly one of the six tables, either
 * directly or through its `<table>__w38` scratch name, and the six names are
 * mutually non-substring. Bare `PRAGMA legacy_alter_table` statements name no
 * table; they belong to the rename they bracket, so they inherit whichever
 * table the stream was last inside. That is a positional rule, and it is the
 * same rule a reader of the file applies.
 */
/**
 * Comments are stripped BEFORE a statement is attributed to a table, and only
 * for attribution — the statement executed is always the original text.
 *
 * This matters: `splitStatements` hands back the migration's banner comment
 * blocks as chunks of their own, and 0183's header prose names several of the
 * six tables in one breath. Attributing on raw text made that header look like
 * a statement straddling three tables. Prose is not DDL.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function partitionByTable(sql: string): Map<Wave38LedgerTable, string[]> {
  const out = new Map<Wave38LedgerTable, string[]>();
  for (const t of WAVE38_LEDGER_TABLES) out.set(t, []);
  let current: Wave38LedgerTable | null = null;
  for (const stmt of splitStatements(sql)) {
    const code = stripSqlComments(stmt).trim();
    if (code === "") continue; // comment-only chunk: carries no schema change
    // `\b` is the wrong boundary here: `_` is a word character, so `\bt\b`
    // does NOT match `t__w38`, and every scratch-table statement in the
    // rebuild would fall through unattributed. Explicit identifier boundaries,
    // with the scratch suffix as part of the name.
    const named = WAVE38_LEDGER_TABLES.filter((t) =>
      new RegExp(`(?<![A-Za-z0-9_])${t}(?:__w38)?(?![A-Za-z0-9_])`).test(code),
    );
    if (named.length === 1) current = named[0];
    else if (named.length > 1) {
      // Not reachable in 0183 today, but if a future edit makes a statement
      // straddle two of these tables, guessing would be the wrong answer.
      throw new Error(
        `[wave38EventLedgerSchema] statement names more than one ledger table (${named.join(", ")}); ` +
          `partitioning it would be a guess: ${code.slice(0, 120)}`,
      );
    }
    if (current) out.get(current)!.push(stmt);
  }
  return out;
}

function tableExists(db: DbLike, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function columnsOf(db: DbLike, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** A table is canonical once it carries BOTH ledger primitives. */
function isAlreadyCanonical(db: DbLike, table: string): boolean {
  const cols = columnsOf(db, table);
  return cols.has("actor_id") && cols.has("seq");
}

export interface Wave38LedgerHealResult {
  /** Tables rebuilt on this call. */
  applied: Wave38LedgerTable[];
  /** Tables skipped because they already carry the canonical columns. */
  alreadyCanonical: Wave38LedgerTable[];
  /** Tables skipped because they do not exist on this database yet. */
  absent: Wave38LedgerTable[];
  /** Per-table failures. Non-fatal: reported, never swallowed silently. */
  failures: Array<{ table: Wave38LedgerTable; message: string }>;
}

/**
 * Bring the six WAVE 38 event tables to migration 0183's shape on a database
 * that was built by the bootstrap path instead of the migration runner.
 *
 * Idempotent, additive in effect, and safe to call from several stores: the
 * second and later calls find every table canonical and do nothing.
 */
export function applyWave38EventLedgerSchema(db: DbLike): Wave38LedgerHealResult {
  const result: Wave38LedgerHealResult = {
    applied: [],
    alreadyCanonical: [],
    absent: [],
    failures: [],
  };
  const sql = readMigrationSql();
  if (sql === null) {
    log.warn(
      `[wave38EventLedgerSchema] ${MIGRATION_BASENAME} not found in ${candidatePaths().join(" or ")}; ` +
        `the six event tables keep their pre-0183 shape on this database`,
    );
    return result;
  }

  const blocks = partitionByTable(sql);

  for (const table of WAVE38_LEDGER_TABLES) {
    const stmts = blocks.get(table) ?? [];
    if (stmts.length === 0) continue;

    // `mf_engagement_event` is the one table 0183 creates when absent (it is
    // born in application code, not in any migration), so it is allowed to
    // proceed on a database that has never seen it.
    const exists = tableExists(db, table);
    if (!exists && table !== "mf_engagement_event") {
      result.absent.push(table);
      continue;
    }
    if (exists && isAlreadyCanonical(db, table)) {
      result.alreadyCanonical.push(table);
      continue;
    }

    try {
      for (const stmt of stmts) db.exec(stmt);
      result.applied.push(table);
    } catch (err) {
      const message = (err as Error).message;
      result.failures.push({ table, message });
      log.warn(`[wave38EventLedgerSchema] ${table} rebuild failed (non-fatal): ${message}`);
    }
  }

  return result;
}

/**
 * Once-per-database wrapper, for hot call sites (`db()` accessors that run on
 * every store operation).
 *
 * The cache is keyed on the database HANDLE, not on a module-level boolean, so
 * a suite that opens a fresh `:memory:` database is healed again rather than
 * inheriting another database's verdict.
 *
 * A run that left any table ABSENT is deliberately NOT cached: that table is
 * created lazily by its own store's installer, and the next call — after that
 * installer has run — must get a real second chance. Caching there is exactly
 * how a heal silently becomes a no-op.
 */
const healedHandles = new WeakSet<object>();

export function applyWave38EventLedgerSchemaOnce(db: DbLike): Wave38LedgerHealResult | null {
  if (healedHandles.has(db as unknown as object)) return null;
  const result = applyWave38EventLedgerSchema(db);
  if (result.absent.length === 0 && result.failures.length === 0) {
    healedHandles.add(db as unknown as object);
  }
  return result;
}
