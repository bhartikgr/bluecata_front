// server/lib/applyWave4bPartnerClassificationSchema.ts
//
// WAVE 4B (PT-1) — self-heal installer for migration
// 0149_wave4b_partner_classifications.sql (partner_sectors,
// partner_subsectors, partner_classifications + the 11/87 seed).
//
// WHY THIS EXISTS
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL inlined in that file,
//   not from the numbered migrations. connection.ts is SACRED this wave, so a
//   new installer cannot be registered there. Without a heal, a fresh
//   `:memory:` database — which is exactly what `NODE_ENV=test` opens — has no
//   classification tables, and every test touching them would either fail or,
//   far worse, pass vacuously against empty data.
//
// PARITY BY CONSTRUCTION
//   The DDL is not re-typed here. It is READ FROM the migration file itself,
//   so this installer and migration 0149 cannot drift: there is one body of
//   SQL and both paths execute it. If the file is absent (a bundled production
//   build, where the migration runner has already applied it), this is a no-op.
//
// SAFETY
//   * SQLite only. Callers gate on the dialect; Postgres has its own tree.
//   * No-ops the moment `partner_sectors` exists — the migration's own guards
//     make it idempotent anyway, but skipping early keeps boot cheap.
//   * log.warn-and-continue on any error. A reporting-only feature must never
//     be able to kill boot.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0149_wave4b_partner_classifications.sql";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave4bClassificationDdl(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

export function applyWave4bPartnerClassificationSchema(db: DbLike): void {
  try {
    const already = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partner_sectors'`)
      .get() as { name: string } | undefined;
    if (already) return;

    const ddl = readWave4bClassificationDdl();
    if (!ddl) {
      // Production/bundled: the migration runner owns this schema. Nothing to
      // heal, and inventing a second copy of the DDL here is precisely the
      // drift this installer is designed to avoid.
      return;
    }
    db.exec(ddl);
    log.info(
      "[wave4b] partner classification schema installed from migration 0149 (bootstrap heal)",
    );
  } catch (err) {
    log.warn(
      `[wave4b] partner classification schema heal skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
