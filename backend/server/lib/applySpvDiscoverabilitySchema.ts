// server/lib/applySpvDiscoverabilitySchema.ts
//
// WAVE 33 · CP-SPV-53 — self-heal installer for migration
// `0179_wave33_spv_discoverability.sql`.
//
// WHY THIS EXISTS (A-22)
//   `applyInlineMigrations` in server/db/connection.ts builds a database from
//   DDL INLINED IN THAT FILE, not from the numbered migrations, and
//   connection.ts is SACRED so nothing may be registered there. Without a heal
//   a fresh `:memory:` database — exactly what `NODE_ENV=test` opens — has no
//   `spv_discovery_event`, and every read against it would return empty. A test
//   that passes against a table that does not exist is the single failure mode
//   this codebase has paid for twenty-four times.
//
//   A-22 in the opposite direction: does connection.ts (or another installer)
//   re-create what 0179 installs? Verified by grep before this file was
//   written — `spv_discovery_event` and `idx_spv_lp_invite_email` appear in no
//   other file. The `spv_lp_invite` TABLE is created by connection.ts:2018 and
//   by migration 0101; 0179 only adds an INDEX to it, which is additive and
//   cannot disagree with a table definition.
//
// PARITY BY CONSTRUCTION
//   No DDL is re-typed here. It is READ FROM the migration file, so this
//   installer and 0179 cannot drift. Same shape as
//   server/lib/applySpvInstitutionalSchema.ts.
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

const MIGRATION_BASENAME = "0179_wave33_spv_discoverability.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readSpvDiscoverabilityDdl(): string | null {
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
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function indexExists(db: DbLike, name: string): boolean {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(name);
  } catch {
    return false;
  }
}

/**
 * Install the Wave 33 discoverability schema when it is absent.
 *
 * The presence probe tests BOTH objects 0179 creates, not just the table. A
 * table-only probe would leave a database healed by an earlier revision
 * permanently missing the index, and the reader would silently fall back to a
 * full scan — slow rather than wrong, but the same class of defect: a probe
 * that answers a narrower question than the one it is trusted for.
 *
 * The index is created on `spv_lp_invite`, which this installer does not own.
 * If that table is absent (a database predating migration 0101) the exec would
 * throw; the catch below turns that into a logged skip rather than a boot
 * failure, because a missing invite table is a separate, older problem and this
 * installer must not be the thing that reports it.
 */
export function applySpvDiscoverabilitySchema(db: DbLike): void {
  try {
    if (tableExists(db, "spv_discovery_event") && indexExists(db, "idx_spv_lp_invite_email")) return;
    const ddl = readSpvDiscoverabilityDdl();
    if (!ddl) {
      // Production/bundled: the migration runner owns this schema. A second
      // copy of the DDL here is exactly the drift this installer avoids.
      return;
    }
    db.exec(ddl);
    log.info("[wave33] SPV discoverability schema installed from migration 0179 (bootstrap heal)");
  } catch (err) {
    log.warn(
      `[wave33] SPV discoverability schema heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
