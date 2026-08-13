// server/lib/applyWave10EngineSchema.ts
//
// WAVE 10 — self-heal installer for migration
// 0165_wave10_en1_cashflow_hash_chain.sql (EN-1) and
// 0166_wave10_en3_investor_identity_alias.sql (EN-3).
//
// THE A-22 STANDING CHECK, APPLIED.
//   "For every data repair, ask whether the sacred bootstrap re-seeds what you
//    just fixed. If so, ship a self-heal installer alongside the migration — a
//    migration alone looks correct in review and silently regresses every fresh
//    DB."
//   The SQLite bootstrap path (`applyInlineMigrations`, server/db/connection.ts)
//   builds a database from DDL inlined in connection.ts, NOT from the numbered
//   migrations. connection.ts is SACRED and may not be edited. So on a fresh
//   database — which is exactly what `NODE_ENV=test` opens as `:memory:`, and
//   what a brand-new production install gets — migration 0165 never runs from
//   the inline path, `vehicle_cashflow` has no chain columns and no
//   append-only triggers, and every EN-1 test would pass VACUOUSLY against a
//   table that silently accepted unchained writes. That is the exact failure
//   mode this build has already hit once (WAVE 7B, DA-3).
//
// PARITY BY CONSTRUCTION.
//   The DDL is not re-typed here. It is READ FROM the migration files, so the
//   installer and the migrations cannot drift. Same technique as
//   server/lib/applyWave9ReportingSchema.ts:53.
//
// IDEMPOTENCE.
//   `ALTER TABLE ... ADD COLUMN` is NOT `IF NOT EXISTS` in SQLite, so re-running
//   the raw file on an already-migrated DB throws "duplicate column name". The
//   installer therefore checks for the chain columns first and, if they are
//   present, applies only the trigger/index half — which IS idempotent
//   (`DROP TRIGGER IF EXISTS` / `CREATE INDEX IF NOT EXISTS`).
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const EN1_MIGRATION = "0165_wave10_en1_cashflow_hash_chain.sql";
const EN3_MIGRATION = "0166_wave10_en3_investor_identity_alias.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(basename: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", basename),
    path.join(cwd, "migrations", basename),
  ];
}

export function readWave10Ddl(basename: string): string | null {
  for (const p of candidatePaths(basename)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

function tableExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

function columnExists(db: DbLike, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

export function triggerExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

/**
 * Split the EN-1 migration into its two halves at the section marker. The
 * ADD COLUMN half is applied only when the columns are absent; the
 * trigger/index half is applied unconditionally because it is idempotent.
 */
function splitEn1(ddl: string): { columns: string; guards: string } {
  const marker = "-- 2. Append-only enforcement.";
  const at = ddl.indexOf(marker);
  if (at < 0) return { columns: ddl, guards: "" };
  return { columns: ddl.slice(0, at), guards: ddl.slice(at) };
}

export function applyWave10EngineSchema(db: DbLike): void {
  /* ---- EN-1: chain columns + append-only guards on vehicle_cashflow ---- */
  try {
    // If Wave 9's table itself is absent, there is nothing to chain yet. The
    // Wave 9 installer runs first (see wave9ReportingStore.ensureWave9Schema),
    // so this is a genuine "nothing to do", not a skipped repair.
    if (tableExists(db, "vehicle_cashflow")) {
      const ddl = readWave10Ddl(EN1_MIGRATION);
      if (ddl) {
        const { columns, guards } = splitEn1(ddl);
        if (!columnExists(db, "vehicle_cashflow", "curr_hash")) {
          db.exec(columns);
          log.info("[wave10] EN-1 cash-flow chain columns installed (bootstrap heal)");
        }
        if (guards) db.exec(guards);
      }
    }
  } catch (err) {
    log.warn(
      `[wave10] EN-1 chain heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  /* ---- EN-3: investor identity alias table ---- */
  try {
    if (!tableExists(db, "investor_identity_alias")) {
      const ddl = readWave10Ddl(EN3_MIGRATION);
      if (ddl) {
        db.exec(ddl);
        log.info("[wave10] EN-3 investor_identity_alias installed (bootstrap heal)");
      }
    }
  } catch (err) {
    log.warn(
      `[wave10] EN-3 alias heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
