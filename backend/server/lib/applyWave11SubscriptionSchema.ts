// server/lib/applyWave11SubscriptionSchema.ts
//
// WAVE 11 — self-heal installer for migration
// 0167_wave11_partner_subscription_engine.sql (EN-6 / EN-7 / EN-8) and
// 0168_wave11_esignature_envelope.sql (EN-9).
//
// THE A-22 STANDING CHECK, APPLIED.
//   The SQLite bootstrap (`applyInlineMigrations`, server/db/connection.ts —
//   SACRED, not editable) builds a database from DDL inlined in connection.ts,
//   NOT from the numbered migrations. `NODE_ENV=test` opens `:memory:` through
//   exactly that path, and so does a brand-new production install. Without this
//   installer migration 0167 never runs there, `partner_subscription` does not
//   exist, and every EN-6/7/8 assertion would pass VACUOUSLY against a missing
//   table — the WAVE 7B / DA-3 failure mode, where a scope fence passed against
//   files that had never existed on disk.
//
// PARITY BY CONSTRUCTION. The DDL is not re-typed here; it is READ FROM the
// migration file, so the installer and the migration cannot drift. Same
// technique as applyWave10EngineSchema.ts:57.
//
// IDEMPOTENCE. Every statement in 0167 and 0168 is `CREATE TABLE IF NOT
// EXISTS`, `CREATE INDEX IF NOT EXISTS` or `DROP TRIGGER IF EXISTS` +
// `CREATE TRIGGER`, so the whole file is safely re-runnable and there is no
// `ADD COLUMN` half to split off (0167 adds no column to an existing table —
// deliberately: `capavate_subscriptions` belongs to the sacred store).
//
// WAVE 13 — SHAPE RECONCILIATION.
//   0167's `CREATE TABLE IF NOT EXISTS partner_subscription` was a NO-OP on
//   every database where 0153_wave5_money_captable.sql had already created a
//   table of that name with its own incompatible shape (partner_id / cadence /
//   period_*). `IF NOT EXISTS` hid the collision, and this installer inherited
//   it: `db.exec(0167)` silently left the wrong shape in place and then failed
//   to create 0167's own subject-keyed indexes. 0153 no longer declares the
//   table, and this installer now finishes by applying
//   0169_wave13_partner_subscription_shape_reconcile.sql, which is the ONE
//   canonical declaration and which reshapes an already-legacy table row for
//   row. Wiring it here (and not only into the migration chain) is the A-22
//   half: `:memory:` and fresh-install databases never run migrations.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { applyWave13SubscriptionShape } from "./applyWave13SubscriptionShape";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

export const W11_SUBSCRIPTION_MIGRATION = "0167_wave11_partner_subscription_engine.sql";
export const W11_ESIGN_MIGRATION = "0168_wave11_esignature_envelope.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(basename: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", basename),
    path.join(cwd, "migrations", basename),
  ];
}

export function readWave11Ddl(basename: string): string | null {
  for (const p of candidatePaths(basename)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

export function w11TableExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

export function w11TriggerExists(db: DbLike, name: string): boolean {
  try {
    return !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`)
      .get(name);
  } catch {
    return false;
  }
}

function applyOne(db: DbLike, basename: string, sentinelTable: string, label: string): void {
  try {
    const ddl = readWave11Ddl(basename);
    if (!ddl) {
      log.warn(`[wave11] ${label}: migration ${basename} not found on disk; heal skipped`);
      return;
    }
    const had = w11TableExists(db, sentinelTable);
    db.exec(ddl);
    if (!had) log.info(`[wave11] ${label} schema installed (bootstrap heal)`);
  } catch (err) {
    log.warn(
      `[wave11] ${label} heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function applyWave11SubscriptionSchema(db: DbLike): void {
  applyOne(db, W11_SUBSCRIPTION_MIGRATION, "partner_subscription", "EN-6/7/8 subscription");
  applyOne(db, W11_ESIGN_MIGRATION, "esign_envelope", "EN-9 e-signature");
  // MUST be last: it reconciles whatever shape `partner_subscription` ended up
  // with — including the legacy shape a pre-Wave-13 database still has — to the
  // canonical one, preserving every row. Idempotent, so calling it on an
  // already-canonical database is a no-op copy.
  applyWave13SubscriptionShape(db);
}
