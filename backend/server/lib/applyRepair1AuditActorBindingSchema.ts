// server/lib/applyRepair1AuditActorBindingSchema.ts
//
// REPAIR WAVE 1 · ITEM 1 — self-heal installer for
// migrations/0188_repair1_audit_actor_binding.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap (`applyInlineMigrations` in server/db/connection.ts)
//   builds a database from DDL inlined in THAT file, not from the numbered
//   migrations — and connection.ts is SACRED, so this wave may not add the
//   column there. A fresh `:memory:` database, which is exactly what
//   NODE_ENV=test opens, would therefore have no `audit_log.hash_version`
//   column at all, and the versioned chain writer/verifier would either throw
//   "no such column" or — far worse — fall back to the legacy formula and PASS
//   VACUOUSLY while claiming the actor is bound. Same shape as
//   applyWave50MoneyDefectSchema.ts and applyWave45PricingSchema.ts,
//   deliberately, so there is one pattern to audit.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM the migration file, so the
//   installer and the migration cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do. If
//   neither file can be read we fall back to the single literal statement,
//   because an audit chain that cannot record its own hash version is worse
//   than a hard-coded ALTER — and the statement is asserted against the
//   migration file by test, so drift is caught.
//
// IDEMPOTENT
//   SQLite offers no `ADD COLUMN IF NOT EXISTS`, so presence is checked with
//   PRAGMA table_info before the ALTER runs. Memoised per driver handle so the
//   common per-request path costs one WeakSet lookup.

import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { rawDb } from "../db/connection";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0188_repair1_audit_actor_binding.sql";

/** The single column migration 0188 adds. */
export const REPAIR1_AUDIT_LOG_COLUMNS = ["hash_version"] as const;

/** Last-resort literal, asserted equal to the migration's own statement by test. */
export const REPAIR1_AUDIT_LOG_ALTER =
  "ALTER TABLE audit_log ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
export function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readRepair1Ddl(): string | null {
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
 * Pull the executable statements out of the migration, dropping `--` comment
 * lines. 0188 is one ALTER behind a long comment header, so this is a
 * line filter plus a split on `;`.
 */
export function executableStatements(ddl: string): string[] {
  const stripped = ddl
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function columnNames(db: DbLike, table: string): string[] {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => String(r.name));
  } catch {
    return [];
  }
}

/* Memoised on the DB HANDLE OBJECT, not on the driver label — the test suite
   opens a fresh `:memory:` handle per worker and a label-keyed cache would
   report "already installed" against a database that has never seen the ALTER.
   Matches applyWave45PricingSchema.ts:178-180. */
const installed = new WeakSet<object>();

/**
 * Idempotently install everything migration 0188 creates onto `handle`.
 * Returns true when the column is present afterwards.
 */
export function ensureRepair1AuditActorBindingSchema(handle?: DbLike): boolean {
  /* NEVER THROW OUT OF THIS FUNCTION.
   *
   * `adminPlatformStore.ts:931` calls `seedAudit()` at MODULE-EVALUATION time
   * when `DEMO_SEED_ENABLED`, which reaches `appendAudit()` → here → `rawDb()`
   * during the import of the module graph. Several test files replace
   * `../db/connection` with a `vi.mock` factory that closes over module-level
   * `let` bindings (e.g. `wave2b_major1_platform_admin_fail_closed.test.ts:31-32,
   * review_round5_backfill_failure.test.ts`), so a `rawDb()` call raised from
   * inside a hoisted import evaluates the mock BEFORE those `let`s initialise and
   * throws a TDZ `ReferenceError` — or, in the round-5 harness, a deliberately
   * injected failure. An unprotected throw there aborts the whole test FILE at
   * collection, which reports as ZERO assertions rather than as failing names —
   * i.e. it would silently delete 12 passing security assertions from the suite
   * instead of showing up in a name diff. `bridgeStore.ts::ensureHistoryTable`
   * already swallows exactly this condition, which is why it was invisible.
   *
   * Returning `false` is the honest answer: the caller then writes a LEGACY (v1)
   * chain row and logs loudly, rather than crashing or silently claiming the
   * actor is bound. */
  let db: DbLike;
  try {
    db = (handle ?? (rawDb() as unknown as DbLike)) as DbLike;
  } catch {
    return false;
  }
  if (!db || typeof (db as { prepare?: unknown }).prepare !== "function") return false;
  const key = db as unknown as object;
  if (key && typeof key === "object" && installed.has(key)) return true;

  let cols: string[];
  try {
    cols = columnNames(db, "audit_log");
  } catch {
    return false;
  }
  if (cols.length === 0) {
    // audit_log itself does not exist on this handle yet. Nothing to alter,
    // and nothing to memoise — a later call must retry.
    return false;
  }
  if (cols.includes("hash_version")) {
    if (key && typeof key === "object") installed.add(key);
    return true;
  }

  const ddl = readRepair1Ddl();
  const stmts = ddl ? executableStatements(ddl) : [REPAIR1_AUDIT_LOG_ALTER];
  for (const s of stmts) {
    try {
      db.exec(s);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (/duplicate column name/i.test(msg)) continue;
      log.error({
        route: "applyRepair1AuditActorBindingSchema",
        errorType: "REPAIR1_AUDIT_SCHEMA_INSTALL_FAILED",
        message: msg,
        statement: s.slice(0, 120),
      });
      return false;
    }
  }

  let after: string[];
  try {
    after = columnNames(db, "audit_log");
  } catch {
    return false;
  }
  const ok = after.includes("hash_version");
  if (ok && key && typeof key === "object") installed.add(key);
  return ok;
}
