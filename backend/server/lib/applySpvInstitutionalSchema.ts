// server/lib/applySpvInstitutionalSchema.ts
//
// WAVE 32 · CP-SPV-30 — self-heal installer for migration
// `0178_wave32_spv_institutional.sql`.
//
// WHY THIS EXISTS (A-22)
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL INLINED IN THAT FILE,
//   not from the numbered migrations. connection.ts is SACRED, so a new
//   installer cannot be registered there. Without a heal a fresh `:memory:`
//   database — which is exactly what `NODE_ENV=test` opens — has none of the
//   Wave 32 tables, and every test touching them would either fail or, far
//   worse, PASS VACUOUSLY against a table that does not exist. That second
//   outcome is the failure mode this codebase has paid for twenty-three times.
//
//   A-22 also asks the opposite question: does connection.ts's inline baseline
//   (or any other self-heal) RE-CREATE what 0178 installs? It does not. None of
//   `spv_nav_snapshot`, `spv_side_letter`, `spv_k1_statement` appears anywhere
//   in connection.ts or in any other apply*Schema installer; verified by grep
//   before this file was written. So this installer is the only bootstrap
//   source for them and there is no competing definition to drift from.
//
// PARITY BY CONSTRUCTION
//   The DDL is not re-typed here. It is READ FROM the migration file, so this
//   installer and migration 0178 cannot drift. Same shape as
//   server/lib/applyWave9ReportingSchema.ts.
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

const MIGRATION_BASENAME = "0178_wave32_spv_institutional.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readSpvInstitutionalDdl(): string | null {
  for (const p of candidatePaths()) {
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

/**
 * Install the Wave 32 institutional-SPV schema when it is absent.
 *
 * The presence probe deliberately tests ALL THREE tables rather than one. A
 * probe on a single table would leave a database that was healed by an earlier
 * revision of this file — one that installed fewer tables — permanently missing
 * the rest, and the missing-table branch in every store returns an empty read.
 * "Silently empty" is the exact shape of a check that passes while checking
 * nothing.
 */
export function applySpvInstitutionalSchema(db: DbLike): void {
  try {
    const needed = ["spv_nav_snapshot", "spv_side_letter", "spv_k1_statement"];
    if (needed.every((t) => tableExists(db, t))) return;
    const ddl = readSpvInstitutionalDdl();
    if (!ddl) {
      // Production/bundled: the migration runner owns this schema. Inventing a
      // second copy of the DDL here is precisely the drift this installer is
      // designed to avoid.
      return;
    }
    db.exec(ddl);
    log.info("[wave32] institutional SPV schema installed from migration 0178 (bootstrap heal)");
  } catch (err) {
    log.warn(
      `[wave32] institutional SPV schema heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
