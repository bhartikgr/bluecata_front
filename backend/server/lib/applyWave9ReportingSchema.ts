// server/lib/applyWave9ReportingSchema.ts
//
// WAVE 9 — self-heal installer for migration 0159_wave9_reporting_audit.sql,
// plus the two DML steps that could not live in the .sql file.
//
// WHY THIS EXISTS
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL inlined in that file,
//   not from the numbered migrations. connection.ts is SACRED — this wave may
//   not edit it — so a new installer cannot be registered there. Without a
//   heal, a fresh `:memory:` database (which is exactly what `NODE_ENV=test`
//   opens) has none of the Wave 9 reporting tables, and every test touching
//   them would either fail or, far worse, pass vacuously against empty data.
//   This is the same shape as server/lib/applyWave4bPartnerClassificationSchema.ts.
//
// PARITY BY CONSTRUCTION
//   The DDL is not re-typed here. It is READ FROM the migration file itself,
//   so this installer and migration 0159 cannot drift.
//
// THE TWO DML STEPS THAT ARE HERE AND NOT IN THE .sql
//   1. applyOq5ScopeCollapse()          (SM-1)
//   2. backfillContactSubscriptionLinks() lives in ./contactSubscriptionLink (DA-5)
//   Both target tables (`spv`, `capavate_subscriptions`) that are created by
//   BOOT-TIME BOOTSTRAP or LAZILY BY A STORE, not by a numbered migration. A
//   DML statement against them inside 0152 would fail outright on a fresh
//   database, because migrations run before those tables exist. Running them
//   here, table-existence guarded, against a live driver, is the only correct
//   place.
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

const MIGRATION_BASENAME = "0159_wave9_reporting_audit.sql";

/* WAVE 24 · ITEM 1 (found by scripts/wave24/item1_mark_review_harness.ts).

   THE DEFECT. Wave 23 flipped `marks.override_admin_approval_mode` from
   "able_to" to "required" in migration 0174 — but the heal above installs
   0159's DDL AND ONLY 0159's DDL. So every database created through the
   bootstrap path rather than the migration runner (which is exactly what
   `NODE_ENV=test` and any fresh `:memory:` boot use) came up seeded "able_to":
   the unsafe default Wave 23 removed, silently reinstated, on the one path
   where nobody looks. The ITEM 1 harness caught this on its first run — its
   PART 0 sanity assertion, the one that exists so the rest of the harness is
   not testing a world it invented, went red.

   WHY IT IS APPLIED ONLY ON FRESH INSTALL, and not on every boot. 0174's
   GRANDFATHER CLASS B statement sets `grandfathered_effective = 1` for every
   row currently `pending`. That is correct exactly ONCE, at flip time, for
   rows that were effective under the old default. Re-running it at every boot
   would grandfather overrides created AFTER the flip — i.e. a pending,
   unapproved GP override would become effective the next time the process
   restarted, which is the precise failure ITEM 1 exists to prevent. So this
   runs inside the install branch only, where `valuation_mark_override` is
   guaranteed empty and class B is a no-op by construction.

   PARITY BY CONSTRUCTION, as with the DDL: the SQL is READ FROM 0174, never
   re-typed here, so the heal and the migration cannot drift. */
const MIGRATION_0174_BASENAME = "0174_wave23_mark_override_approval_default.sql";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

function candidatePaths0174(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_0174_BASENAME),
    path.join(cwd, "migrations", MIGRATION_0174_BASENAME),
  ];
}

export function readWave23ApprovalDefaultSql(): string | null {
  for (const p of candidatePaths0174()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

/**
 * Apply 0174 to a JUST-CREATED Wave 9 schema. Statement-at-a-time, because the
 * `ALTER TABLE ... ADD COLUMN` is already satisfied when 0159's DDL is newer
 * than this heal; a duplicate-column error there is expected and is swallowed
 * exactly the way the migration runner's idempotency clause swallows it.
 * Anything else is logged rather than silently dropped.
 */
export function applyWave23ApprovalDefault(db: DbLike): void {
  const sql = readWave23ApprovalDefaultSql();
  if (!sql) {
    log.warn("[wave9] 0174 approval-default heal skipped: migration file not readable");
    return;
  }
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const t = stmt.trim();
    if (t === "") continue;
    try {
      db.exec(t);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) {
        log.warn(`[wave9] 0174 approval-default heal statement failed: ${msg}`);
      }
    }
  }
  log.info("[wave9] mark-override approval default healed to `required` from migration 0174");
}

export function readWave9ReportingDdl(): string | null {
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
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

export function applyWave9ReportingSchema(db: DbLike): void {
  try {
    if (!tableExists(db, "vehicle_cashflow")) {
      const ddl = readWave9ReportingDdl();
      if (!ddl) {
        // Production/bundled: the migration runner owns this schema. Inventing
        // a second copy of the DDL here is precisely the drift this installer
        // is designed to avoid.
        return;
      }
      db.exec(ddl);
      log.info("[wave9] reporting/audit schema installed from migration 0159 (bootstrap heal)");
      /* WAVE 24 · ITEM 1 — 0159 seeds the approval mode "able_to"; 0174 flipped
         it to "required". A bootstrap-installed database must land on the SAME
         governance default as a migrated one, or the safe default exists only
         in production and not in the tree everything is tested against.
         Applied here, inside the install branch, where the override table is
         empty — see the note on MIGRATION_0174_BASENAME for why it must NOT
         run on every boot. */
      applyWave23ApprovalDefault(db);
    }
    // SM-1 runs on every boot, not only on install: a vehicle created before
    // the collapse landed must still be collapsed. It is a no-op once no
    // `collective_only` row remains.
    applyOq5ScopeCollapse(db);
  } catch (err) {
    log.warn(
      `[wave9] reporting/audit schema heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* ==========================================================================
 * SM-1 / OQ-5 — collective_only collapses into network.
 *
 * OWNER RULING (OWNER_RULINGS_2026_08_09.md, OQ-5, DECIDED):
 *   "Private deals are meant for invitation only views/soft-circles and
 *    collective deals are all network."   Two audiences, not three.
 *
 * THE GATE the ruling attaches (⚠️ Implementation gate) demands: a mapping
 * table of the three current values to the two ruled values, every affected
 * vehicle listed by name and current scope, before migrating. That is exactly
 * what this function produces — it JOURNALS FIRST (name + prior scope, one row
 * per vehicle, into `spv_scope_migration`) and only then updates. The journal
 * is the mapping table, it is queryable, and it makes the collapse reversible.
 *
 * THE MAPPING, in full:
 *   'private'         -> 'private'          (unchanged; invitation-only)
 *   'invite_only'     -> 'private'          (an invite-only view IS the ruled
 *                                            "invitation only views" audience)
 *   'collective_only' -> 'network'          (the ruling, verbatim)
 *   'network'         -> 'network'          (unchanged)
 *
 * Only the collective_only -> network leg mutates data. `invite_only` is left
 * ALONE at the storage layer and is mapped at the presentation layer by
 * rulednScopeFor() below, because collapsing it would widen nothing but WOULD
 * destroy the distinction a GP typed, and OR-J forbids destroying data without
 * a signed dossier.
 * ======================================================================== */

/** The two ruled audiences. */
export type RuledScope = "private" | "network";

/** The three live UI scopes plus the storage enum member they are stored as. */
export const OQ5_SCOPE_MAP: Readonly<Record<string, RuledScope>> = Object.freeze({
  private: "private",
  invite_only: "private",
  collective_only: "network",
  network: "network",
});

/** Map any stored scope onto the two ruled audiences. Unknown -> 'private' (fail closed). */
export function ruledScopeFor(storedScope: string | null | undefined): RuledScope {
  if (!storedScope) return "private";
  return OQ5_SCOPE_MAP[storedScope] ?? "private";
}

export interface Oq5CollapseResult {
  journalled: number;
  updated: number;
  skipped: boolean;
  reason?: string;
}

export function applyOq5ScopeCollapse(db: DbLike): Oq5CollapseResult {
  if (!tableExists(db, "spv") || !tableExists(db, "spv_scope_migration")) {
    return { journalled: 0, updated: 0, skipped: true, reason: "tables_absent" };
  }
  const affected = db
    .prepare(`SELECT id, name FROM spv WHERE distribution_scope = 'collective_only'`)
    .all() as Array<{ id: string; name: string | null }>;
  if (affected.length === 0) return { journalled: 0, updated: 0, skipped: false };

  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO spv_scope_migration
       (id, spv_id, spv_name, prior_scope, new_scope, ruling, migrated_at)
     VALUES (?, ?, ?, 'collective_only', 'network', ?, ?)`,
  );
  const RULING =
    "OQ-5 (OWNER_RULINGS_2026_08_09.md) — collective_only collapses into network.";
  for (const s of affected) ins.run(`ssm_${s.id}`, s.id, s.name ?? null, RULING, now);

  db.prepare(
    `UPDATE spv SET distribution_scope = 'network' WHERE distribution_scope = 'collective_only'`,
  ).run();

  log.info(`[wave9][SM-1] OQ-5 scope collapse: ${affected.length} vehicle(s) collective_only -> network`);
  return { journalled: affected.length, updated: affected.length, skipped: false };
}

/** Read the journal — the mapping table the OQ-5 gate requires, by name. */
export function listOq5ScopeMigrations(
  db: DbLike,
): Array<{ spvId: string; spvName: string | null; priorScope: string; newScope: string; migratedAt: string }> {
  if (!tableExists(db, "spv_scope_migration")) return [];
  return (
    db
      .prepare(
        `SELECT spv_id AS spvId, spv_name AS spvName, prior_scope AS priorScope,
                new_scope AS newScope, migrated_at AS migratedAt
         FROM spv_scope_migration ORDER BY migrated_at DESC, spv_id`,
      )
      .all() as Array<{ spvId: string; spvName: string | null; priorScope: string; newScope: string; migratedAt: string }>
  );
}
