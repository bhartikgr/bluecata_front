// server/lib/applyWave30SpvTemplateSchema.ts
//
// WAVE 30 · ENGINE 3 — self-heal installer for migration
// 0177_wave30_spv_template.sql (`spv_template`, `spv_template_application`).
//
// WHY THIS EXISTS  (rule A-22, discharged in the direction that actually bites)
//   A-22 asks whether `connection.ts`'s inline baseline re-creates what a wave
//   fixed. For ENGINE 3 the answer runs the other way and is worse: the
//   baseline does not create these tables AT ALL, because they did not exist
//   until this wave. The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL inlined in that file
//   rather than from the numbered migrations — so a fresh `:memory:` database,
//   which is exactly what `NODE_ENV=test` opens, would have no `spv_template`.
//
//   connection.ts is SACRED, so a new installer cannot be registered there.
//   This follows the precedent already set by
//   `applyWave4bPartnerClassificationSchema` and the ten other
//   `applyWave*Schema` installers: the owning store calls its own memoised
//   `ensureSchema()` before touching the tables.
//
//   The failure mode being prevented is not "tests error out". It is that they
//   would PASS VACUOUSLY against a table that is not there — the single most
//   common defect class in this build.
//
// PARITY BY CONSTRUCTION
//   The DDL is not re-typed here. It is READ FROM the migration file, so this
//   installer and migration 0177 cannot drift: there is one body of SQL and
//   both paths execute it. Re-typing the DDL is the mistake this design exists
//   to make impossible — a hand-copied second definition is a schema fork that
//   nothing checks.
//
// SAFETY
//   * SQLite only. Callers gate on the dialect; Postgres is owned by
//     migrations-pg/ and `rawDb()` throws there by design.
//   * No-ops the moment `spv_template` exists. The migration's own
//     `IF NOT EXISTS` guards make it idempotent regardless.
//   * log.warn-and-continue on error, so a template feature can never prevent
//     the server from booting.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0177_wave30_spv_template.sql";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave30SpvTemplateDdl(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

export function applyWave30SpvTemplateSchema(db: DbLike): void {
  try {
    const already = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spv_template'`)
      .get() as { name: string } | undefined;
    if (already) return;

    const ddl = readWave30SpvTemplateDdl();
    if (!ddl) {
      // Production/bundled: the migration runner owns this schema. Nothing to
      // heal, and inventing a second copy of the DDL here is precisely the
      // drift this installer is designed to avoid.
      return;
    }
    db.exec(ddl);
    log.info("[wave30] spv_template schema installed from migration 0177 (bootstrap heal)");
  } catch (err) {
    log.warn(
      `[wave30] spv_template schema heal skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
