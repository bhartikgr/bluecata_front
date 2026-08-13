// server/lib/applyLockTextSchema.ts
//
// WAVE 33 · CP-PIPE-10 — self-heal installer for migration
// `0180_wave33_lock_text_registry.sql`.
//
// WHY THIS EXISTS (A-22)
//   `applyInlineMigrations` in server/db/connection.ts builds a database from
//   DDL INLINED IN THAT FILE, not from the numbered migrations, and
//   connection.ts is SACRED so nothing may be registered there. `NODE_ENV=test`
//   never runs migrations at all, so without a heal every test would query a
//   `platform_lock_text` table that does not exist — and a lock-wording surface
//   backed by a missing table reads exactly like one whose wording is merely
//   unsupplied. Those two states must never be confused, which is why the
//   harness asserts the schema exists as its FIRST case.
//
//   A-22 in the opposite direction: does connection.ts or another installer
//   re-create what 0180 installs? Verified by grep before this file was
//   written — `platform_lock_text` and `platform_lock_text_revision` appear in
//   no other file in the tree. There is therefore no inline creator that could
//   disagree with the migration.
//
// PARITY BY CONSTRUCTION
//   No DDL is re-typed here. It is READ FROM the migration file, so this
//   installer and 0180 cannot drift — the migration/inline-creator disagreement
//   A-22 warns about is structurally impossible rather than merely tested for.
//   Same shape as server/lib/applySpvDiscoverabilitySchema.ts.
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

const MIGRATION_BASENAME = "0180_wave33_lock_text_registry.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readLockTextDdl(): string | null {
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

/**
 * Install the lock-text registry when it is absent.
 *
 * The probe tests BOTH tables. A probe on `platform_lock_text` alone would
 * leave a database healed by an earlier revision permanently missing the
 * revision table, and every wording change would then be recorded nowhere —
 * silently, since the write path fails soft. That is the same class of defect
 * this build keeps finding: a check that answers a narrower question than the
 * one it is trusted for.
 */
export function applyLockTextSchema(db: DbLike): void {
  try {
    if (tableExists(db, "platform_lock_text") && tableExists(db, "platform_lock_text_revision")) {
      return;
    }
    const ddl = readLockTextDdl();
    if (!ddl) {
      // Production/bundled: the migration runner owns this schema. A second
      // copy of the DDL here is exactly the drift this installer avoids.
      return;
    }
    db.exec(ddl);
    log.info("[wave33] lock-text registry installed from migration 0180 (bootstrap heal)");
  } catch (err) {
    log.warn(
      `[wave33] lock-text registry heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
