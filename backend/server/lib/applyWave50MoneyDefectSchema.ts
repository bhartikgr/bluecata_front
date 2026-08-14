// server/lib/applyWave50MoneyDefectSchema.ts
//
// WAVE 50 — self-heal installer for migration 0187_wave50_money_defects.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap (`applyInlineMigrations` in server/db/connection.ts)
//   builds a database from DDL inlined in THAT file, not from the numbered
//   migrations, and connection.ts is SACRED — this wave may not edit it. A fresh
//   `:memory:` database, which is exactly what NODE_ENV=test opens, would
//   therefore have none of Wave 50's columns or tables, and every test touching
//   them would either fail outright or — far worse — PASS VACUOUSLY against a
//   column that does not exist. Same shape as applyWave45PricingSchema.ts and
//   applyWave5MoneySchema.ts, deliberately, so there is one pattern to audit.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM the migration file, so the
//   installer and the migration cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do.
//
// WHY THIS ONE IS SECTIONED AND 0185's IS NOT
//   0187 §1 uses `ALTER TABLE … ADD COLUMN`, which is the one DDL form SQLite
//   offers no `IF NOT EXISTS` for: re-running it raises "duplicate column name".
//   A numbered migration runs once so that is fine there, but an installer is
//   called on every fresh handle and must be idempotent. So the file is split on
//   its own `-- §N ·` section banners and §1 is skipped when the column is
//   already present, while §2 (CREATE TABLE/INDEX IF NOT EXISTS + INSERT OR
//   IGNORE) and §3 (INSERT OR IGNORE) are naturally idempotent and are exec'd
//   whole. The split is on line-anchored `-- §` markers, which occur only as
//   section headers; prose references such as "0185 §3" are indented behind
//   bullets and cannot match.
//
// ORDERING — WAVE 5 FIRST, ALWAYS
//   §1 alters `partner_tier_price`, created by 0153 and installed by Wave 5's
//   installer. §2's backfill reads `spv_deployment_fee_billing`, created by 0162
//   and inlined in spvEngineDeploymentFeeHook.ts. Both dependencies are ensured
//   before the sections run; otherwise the statements would raise "no such
//   table" and a naive installer would report success having created nothing.

import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { getDb, getDbDriver, rawDb } from "../db/connection";
import { ensureWave5MoneySchema } from "./applyWave5MoneySchema";
import { ensureBillingTable } from "./spvEngineDeploymentFeeHook";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

const MIGRATION_BASENAME = "0187_wave50_money_defects.sql";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave50Ddl(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

/** The two columns §1 adds to `partner_tier_price`. */
export const WAVE50_TIER_PRICE_COLUMNS = ["free_attested", "free_reason"] as const;

/** The table §2 creates. */
export const WAVE50_TABLES = ["spv_deployment_fee_exemption"] as const;

/** The `platform_fees` keys §3 seeds. */
export const WAVE50_FEE_KEYS = ["founder.capavate_annual", "founder.academy_one_time"] as const;

/**
 * Split the migration into its `-- §N ·` sections, in file order. Returns the
 * leading preamble too (index 0), which is comment-only and harmless to exec.
 */
export function splitWave50Sections(ddl: string): string[] {
  const lines = ddl.split("\n");
  const cuts: number[] = [];
  lines.forEach((l, i) => {
    if (/^-- §\d+[a-z]? ·/.test(l)) cuts.push(i);
  });
  if (cuts.length === 0) return [ddl];
  const out: string[] = [];
  // Each section starts at the `-- ═══` banner line directly above its `-- §N ·`
  // header when there is one; including or excluding a comment line changes
  // nothing that executes, so the simpler boundary is used.
  const bounds = [0, ...cuts, lines.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const chunk = lines.slice(bounds[i]!, bounds[i + 1]!).join("\n");
    if (chunk.trim()) out.push(chunk);
  }
  return out;
}

function columnNames(db: DbLike, table: string): string[] {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => String(r.name));
  } catch {
    return [];
  }
}

const installed = new WeakSet<object>();

/**
 * Idempotently install everything migration 0187 creates onto `handle`.
 * Memoised per driver object, matching the Wave 45 installer, so the common
 * per-request path costs one WeakSet lookup.
 */
export function ensureWave50MoneyDefectSchema(handle?: DbLike): void {
  const db = (handle ?? (rawDb() as unknown as DbLike)) as DbLike;
  const key = getDbDriver() as unknown as object;
  if (!handle && key && installed.has(key)) return;

  // Dependencies first — see ORDERING above.
  try {
    ensureWave5MoneySchema(db as any);
  } catch (err) {
    log.warn(`[wave50] Wave 5 schema ensure failed before 0187: ${String(err)}`);
  }
  try {
    ensureBillingTable();
  } catch (err) {
    log.warn(`[wave50] spv_deployment_fee_billing ensure failed before 0187: ${String(err)}`);
  }

  const ddl = readWave50Ddl();
  if (!ddl) {
    // Loud, not silent. A missing migration file means the sections below never
    // ran, and a caller that assumes otherwise would read a column that is not
    // there. Nothing is faked in its place.
    log.warn(`[wave50] ${MIGRATION_BASENAME} not found in ${candidatePaths().join(" or ")}; schema NOT installed`);
    return;
  }

  const sections = splitWave50Sections(ddl);
  const existing = columnNames(db, "partner_tier_price");
  const hasFreeAttested = existing.includes("free_attested");

  // §2b reads `spv.deployment_fee_minor` (migration 0160) and
  // `spv_deployment_fee_billing` (0162). On a `:memory:` database built from the
  // inline bootstrap the column is absent, and running §2b would raise "no such
  // column" — so it is skipped, which is a true no-op there: a database without
  // 0160 has never stamped an engine deployment fee and holds no migrated legacy
  // rows to exempt. §2's CREATE TABLE is in its own section and still runs, so
  // the charge path's exemption lookup never reads a missing table.
  const spvColumns = columnNames(db, "spv");
  const canBackfill = spvColumns.includes("deployment_fee_minor") && spvColumns.includes("migrated_from");

  sections.forEach((section, idx) => {
    const isItem3Section = /^-- §1 ·/m.test(section);
    if (isItem3Section && hasFreeAttested) return; // already added; ALTER is not re-runnable
    if (/^-- §2b ·/m.test(section) && !canBackfill) return;
    try {
      db.exec(section);
    } catch (err) {
      const msg = String(err);
      // "duplicate column name" is the benign race/re-entry case and only that.
      if (/duplicate column name/i.test(msg)) return;
      log.warn(`[wave50] section ${idx} of ${MIGRATION_BASENAME} failed: ${msg}`);
    }
  });

  if (!handle && key) installed.add(key);
}

/** Convenience accessor mirroring `wave45Db()`. */
export function wave50Db(): DbLike {
  getDb();
  const raw = rawDb() as unknown as DbLike;
  ensureWave50MoneyDefectSchema(raw);
  return raw;
}
