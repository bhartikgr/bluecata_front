// server/lib/applyCommsDelegatedContextSchema.ts
//
// WAVE 33 · CP-MSG-01 — self-heal installer for migration
// `0181_wave33_msg01_delegated_context.sql`.
//
// WHY (A-22, both directions)
//   `applyInlineMigrations` in server/db/connection.ts builds a database from
//   DDL inlined in that SACRED file, and `NODE_ENV=test` never runs the
//   numbered migrations at all. Without a heal, every audience lookup would hit
//   a missing `comms_audience_rules` table — and the fail-closed read would then
//   return NO rules, which is indistinguishable from "the owner disabled
//   everything". Those two states must never be confused, so the rule reader
//   asks this installer first and the harness asserts the schema exists as its
//   first case.
//
//   The other direction: grep before writing confirmed that neither
//   `comms_audience_rules` nor `comms_delegated_context` is created anywhere
//   else in the tree, so no inline creator can disagree with 0181.
//
// PARITY BY CONSTRUCTION — the DDL is READ FROM the migration file, never
// re-typed here, so installer and migration cannot drift. Same shape as
// server/lib/applyLockTextSchema.ts (item 4) and applySpvDiscoverabilitySchema.
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

const MIGRATION_BASENAME = "0181_wave33_msg01_delegated_context.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readCommsDelegatedContextDdl(): string | null {
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

function ruleCount(db: DbLike): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM comms_audience_rules`).get() as
      | { n?: number }
      | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Install the audience-rule registry and the delegated-context stamp when
 * either is absent — or when the rules table exists but is EMPTY.
 *
 * The empty-table probe is deliberate. A database healed by a build that
 * created the table before the seed rows existed would otherwise stay
 * permanently ruleless, and a ruleless audience is an empty picker for every
 * user on the platform: exactly the silent, total functionality drop this item
 * exists to remove. The DDL's seeds are `INSERT OR IGNORE`, so re-running it
 * over a partially-seeded or owner-edited table changes nothing that is
 * already there.
 */
export function applyCommsDelegatedContextSchema(db: DbLike): void {
  try {
    const haveRules = tableExists(db, "comms_audience_rules");
    const haveStamp = tableExists(db, "comms_delegated_context");
    if (haveRules && haveStamp && ruleCount(db) > 0) return;
    const ddl = readCommsDelegatedContextDdl();
    if (!ddl) {
      // Bundled/production: the migration runner owns this schema. A second
      // copy of the DDL here is precisely the drift this installer avoids.
      return;
    }
    db.exec(ddl);
    log.info("[wave33] comms audience rules + delegated context installed from migration 0181 (bootstrap heal)");
  } catch (err) {
    log.warn(
      `[wave33] comms delegated-context heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
