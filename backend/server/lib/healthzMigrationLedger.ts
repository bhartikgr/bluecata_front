/**
 * server/lib/healthzMigrationLedger.ts — WAVE 342 · W300.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `GET /api/healthz` is the ONE thing checked on every install. It reported the
 * version, the build sha, the database connection and two queue backlogs — and
 * said NOTHING about whether the numbered migrations had actually been applied
 * to the database it had just connected to. An install can therefore report
 * `ok: true`, `dbConnected: true` on a database that is nineteen migration ids
 * behind the code being served, which is precisely the shape of the v26.41.0
 * install failure (a migration present on one schema path and absent from the
 * other). This module supplies the missing three facts:
 *
 *   1. THE HIGHEST APPLIED MIGRATION ID   (from the ledger table)
 *   2. THE HIGHEST MIGRATION ID ON DISK   (from the migrations directory)
 *   3. WHETHER THEY AGREE                 (one boolean, so it is readable at a glance)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 * · It does NOT touch `server/db/migrate.ts`. That file is EXTRA_FROZEN under
 *   WAIVER-3. This module only READS what that runner wrote, exactly as
 *   `server/lib/migrationIntegrity.ts` does, and it reuses that module's
 *   constants and helpers rather than re-deriving them, so the ledger table
 *   name and the file-listing rule cannot drift between the two readers.
 * · It issues ONE `SELECT name` and one `sqlite_master` existence check. No
 *   DDL, no write, no PRAGMA that changes anything. Safe at boot and safe
 *   against a production database.
 * · It returns NUMBERS AND BOOLEANS ONLY — never a migration FILENAME, never a
 *   path, never a table name. `/api/healthz` is PUBLIC (no auth); the endpoint's
 *   own standing rule at `server/routes.ts:~2136` is "Booleans and counts ONLY —
 *   never a secret, never a credentialed URL, never a hostname", and a migration
 *   filename such as `0233_wave340_angel_chapter_carry_not_recorded.sql` is
 *   internal detail that names unreleased work. The two ids and the boolean are
 *   everything the install check needs; the NAMES stay on the admin-gated
 *   `npm run db:doctor` / `formatMigrationIntegrity()` surface, which already
 *   prints them.
 * · It never THROWS at the caller. Every failure is returned as
 *   `measured: false` with a `reason`, so an unreadable ledger is reported as
 *   UNKNOWN and never as agreement. A fabricated zero, or a fabricated "yes
 *   they agree", is the failure mode this whole endpoint exists to prevent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `agree` IS `false` WHEN EITHER SIDE IS UNKNOWN
 * ─────────────────────────────────────────────────────────────────────────────
 * `agree` answers "may I trust this install", so it must never be `true` on a
 * measurement that did not happen. When the ledger is absent, empty, or the
 * directory has no numbered files, `agree` is `false` AND `measured` tells the
 * reader whether the two ids beside it mean anything at all.
 *
 * NOT SACRED. Additive: nothing in this file is imported by any pre-existing
 * code path except the two appended blocks in the `/api/healthz` handler.
 */

import fs from "node:fs";
import path from "node:path";
/* Read-only use of the SACRED-FROZEN connection module, the same way
   `server/lib/adminKpiDbReads.ts:19` does. Importing it is not editing it, and
   `rawDb()` THROWS on the Postgres backend (see that file's :272 note), which is
   why the probe below is inside a try and degrades to `no_sqlite_handle`. */
import { rawDb, getDbDriver } from "../db/connection";
import {
  LEDGER_TABLE,
  KNOWN_DEFERRED,
  listMigrationFiles,
  migrationId,
  defaultMigrationsDir,
} from "./migrationIntegrity";

export interface MigrationLedgerHealth {
  /** False when the state could not be read at all. The ids are then null. */
  measured: boolean;
  /** Present only when `measured` is false. Short, non-secret, operator-facing. */
  reason: string | null;
  /** Does `__drizzle_migrations_applied` exist? null when unmeasured. */
  ledgerPresent: boolean | null;
  /** Highest numeric migration id recorded in the ledger. */
  highestApplied: number | null;
  /** Highest numeric migration id present in the migrations directory. */
  highestOnDisk: number | null;
  /** Do the two agree? NEVER true on an unmeasured or partial read. */
  agree: boolean;
  /** Count of numbered migrations recorded as applied. */
  appliedCount: number | null;
  /** Count of numbered `NNNN_*.sql` files on disk. */
  fileCount: number | null;
  /** Files on disk not recorded as applied, EXCLUDING the known-deferred ones. */
  pendingCount: number | null;
  /** How many ids behind the disk the ledger is (0 when they agree). */
  idsBehind: number | null;
}

function unmeasured(reason: string): MigrationLedgerHealth {
  return {
    measured: false,
    reason,
    ledgerPresent: null,
    highestApplied: null,
    highestOnDisk: null,
    agree: false,
    appliedCount: null,
    fileCount: null,
    pendingCount: null,
    idsBehind: null,
  };
}

export interface ReadMigrationLedgerOptions {
  /** better-sqlite3 handle (anything exposing `prepare().all()/.get()`). */
  db?: any;
  /** Defaults to `migrationIntegrity.defaultMigrationsDir()`. */
  migrationsDir?: string;
}

/**
 * Read the migration-ledger state: highest applied, highest on disk, and
 * whether they agree. Read-only; never throws.
 *
 * `db` is required by the caller rather than resolved here so that this module
 * has no dependency on the SACRED-FROZEN `server/db/connection.ts` and so a
 * test can hand it a database it built itself.
 */
export function readMigrationLedgerHealth(
  opts: ReadMigrationLedgerOptions = {},
): MigrationLedgerHealth {
  const db = opts.db;
  if (!db || typeof db.prepare !== "function") {
    return unmeasured("no_sqlite_handle");
  }

  let files: string[];
  let dir: string;
  try {
    dir = opts.migrationsDir ?? defaultMigrationsDir();
    if (!fs.existsSync(dir)) return unmeasured("migrations_dir_not_found");
    files = listMigrationFiles(dir);
  } catch {
    return unmeasured("migrations_dir_unreadable");
  }

  const fileCount = files.length;
  const highestOnDiskFile = fileCount > 0 ? files[fileCount - 1] : null;
  const highestOnDisk = highestOnDiskFile ? migrationId(highestOnDiskFile) : null;

  let ledgerPresent: boolean;
  try {
    ledgerPresent = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(LEDGER_TABLE);
  } catch {
    return unmeasured("ledger_probe_failed");
  }

  if (!ledgerPresent) {
    return {
      measured: true,
      reason: null,
      ledgerPresent: false,
      highestApplied: null,
      highestOnDisk,
      agree: false,
      appliedCount: 0,
      fileCount,
      pendingCount: fileCount,
      idsBehind: null,
    };
  }

  let appliedIds: number[];
  let appliedNames: Set<string>;
  try {
    const rows = db.prepare(`SELECT name FROM ${LEDGER_TABLE}`).all() as { name: string }[];
    appliedNames = new Set(rows.map((r) => r.name));
    appliedIds = rows
      .map((r) => migrationId(r.name))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  } catch {
    return unmeasured("ledger_read_failed");
  }

  const appliedCount = appliedIds.length;
  const highestApplied = appliedCount > 0 ? appliedIds[appliedCount - 1] : null;
  const pendingCount = files.filter(
    (f) => !appliedNames.has(f) && !(f in KNOWN_DEFERRED),
  ).length;

  const agree =
    highestApplied !== null && highestOnDisk !== null && highestApplied === highestOnDisk;
  const idsBehind =
    highestApplied !== null && highestOnDisk !== null ? highestOnDisk - highestApplied : null;

  return {
    measured: true,
    reason: null,
    ledgerPresent: true,
    highestApplied,
    highestOnDisk,
    agree,
    appliedCount,
    fileCount,
    pendingCount,
    idsBehind,
  };
}

/**
 * The `degraded` codes this state contributes, in the same style as the codes
 * `/api/healthz` already pushes. Empty array = nothing wrong, which is a
 * measurement (every entry below comes from a field measured above), not a
 * default.
 */
export function migrationLedgerDegradedCodes(h: MigrationLedgerHealth): string[] {
  const out: string[] = [];
  if (!h.measured) {
    out.push("migration_ledger_unmeasured");
    return out;
  }
  if (h.ledgerPresent === false) {
    out.push("migration_ledger_missing");
    return out;
  }
  if (h.highestApplied === null) out.push("migration_ledger_empty");
  else if (!h.agree) out.push("migration_ledger_behind_disk");
  if ((h.pendingCount ?? 0) > 0) out.push("migrations_pending");
  return out;
}

/**
 * The `/api/healthz` entry point: resolve the SQLite handle from the connection
 * module and read the ledger state. Never throws.
 *
 * On the Postgres backend `rawDb()` throws by design, so this returns
 * `measured: false, reason: "driver_not_sqlite"` — an UNKNOWN, never an
 * agreement. The ledger table exists on Postgres too
 * (`server/db/migrate.ts:571`); reading it there needs an async query and this
 * handler is synchronous, so it is honestly reported as unmeasured rather than
 * guessed.
 */
export function readMigrationLedgerHealthFromConnection(): MigrationLedgerHealth {
  try {
    if (getDbDriver() === "postgres") return unmeasured("driver_not_sqlite");
    return readMigrationLedgerHealth({ db: rawDb() });
  } catch {
    return unmeasured("no_sqlite_handle");
  }
}

/** Absolute path of the directory the ids above were derived from. Test-only helper. */
export function migrationLedgerDirForTests(): string {
  return path.resolve(defaultMigrationsDir());
}
