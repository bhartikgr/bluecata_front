// server/lib/applyWave13SubscriptionShape.ts
//
// WAVE 13 — self-heal installer for migration
// 0169_wave13_partner_subscription_shape_reconcile.sql.
//
// WHAT WENT WRONG, AND WHY A MIGRATION ALONE WOULD NOT HAVE FIXED IT
//   `partner_subscription` was declared TWICE with incompatible shapes:
//   0153_wave5_money_captable.sql (partner_id / cadence / period_*) and
//   0167_wave11_partner_subscription_engine.sql:37 (subject_kind / subject_id /
//   cycle / current_period_*, the EN-8 persona-agnostic shape every consumer
//   actually reads). Both used `CREATE TABLE IF NOT EXISTS`, 0153 sorts first,
//   so 0153 won and 0167's CREATE was a silent no-op.
//
//   THE A-22 TRAP. Neither of those tables is created by a migration on the two
//   paths that matter most here. `NODE_ENV=test` opens `:memory:` and a brand
//   new install boots from DDL inlined in server/db/connection.ts (SACRED), and
//   the numbered migrations never run there at all — the tables arrive through
//   the self-heal installers applyWave5MoneySchema.ts and
//   applyWave11SubscriptionSchema.ts, which `db.exec()` the migration FILE. So
//   0153's installer was re-creating the WRONG shape on every fresh database and
//   every test database, forever, no matter what a migration said. A migration
//   alone would have looked correct in review and silently regressed everywhere.
//
//   This module is the fix for that half. It applies 0169 — the one file that
//   holds the canonical declaration — and it is called from BOTH installers.
//
// PARITY BY CONSTRUCTION
//   The canonical DDL is NOT re-typed here. It is READ FROM
//   0169_wave13_partner_subscription_shape_reconcile.sql, so this installer and
//   the migration cannot drift, and the statement splitter is the RUNNER'S OWN
//   (`splitStatements` from server/db/migrate.ts) so the installer and
//   `npm run db:migrate` cut the file into statements identically.
//
// WHY PER-STATEMENT AND NOT ONE `db.exec()`
//   0169 is deliberately shape-agnostic: it ADDs every canonical column and
//   every legacy shim column, so that its one carry statement compiles whatever
//   shape the database started with. On a database that already has a column,
//   SQLite raises "duplicate column name" — the runner swallows exactly that
//   (server/db/migrate.ts:isIdempotentSqliteError) and so does this installer,
//   statement by statement, with the SAME error set and nothing wider. A whole
//   script `exec` would abort at the first such no-op and leave the rebuild
//   half-done.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";
import { splitStatements } from "../db/migrate";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

export const W13_SHAPE_MIGRATION = "0169_wave13_partner_subscription_shape_reconcile.sql";

/** Both trees hold a byte-identical copy; most-likely location first. */
function candidatePaths(basename: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", basename),
    path.join(cwd, "migrations", basename),
  ];
}

export function readWave13ShapeDdl(): string | null {
  for (const p of candidatePaths(W13_SHAPE_MIGRATION)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

/**
 * The canonical column set, as asserted (not assumed) after a heal. Kept as a
 * list rather than a count so a missing column is named in the log.
 */
export const W13_CANONICAL_COLUMNS = [
  "id",
  "subject_kind",
  "subject_id",
  "tier_slug",
  "cycle",
  "status",
  "amount_minor",
  "currency",
  "list_amount_minor",
  "discount_minor",
  "discount_code",
  "price_derivation",
  "payment_intent_id",
  "merchant_order_id",
  "created_at",
  "activated_at",
  "current_period_start",
  "current_period_end",
  "grace_until",
  "suspended_at",
  "cancelled_at",
  "grandfathered_from",
  "superseded_by",
  "superseded_reason",
  "updated_at",
  "created_by",
] as const;

/** Columns that only ever existed in the superseded Wave 5 declaration. */
export const W13_LEGACY_ONLY_COLUMNS = ["partner_id", "cadence", "period_start", "period_end"] as const;

export type PartnerSubscriptionShape = "absent" | "legacy" | "canonical" | "mixed";

export function partnerSubscriptionColumns(db: DbLike): string[] {
  try {
    return db
      .prepare("SELECT name FROM pragma_table_info('partner_subscription')")
      .all()
      .map((r: any) => String(r.name));
  } catch {
    return [];
  }
}

/**
 * What shape does THIS database actually have? Reported rather than guessed,
 * because the answer differed per environment before Wave 13: a migrated server
 * had 0153's shape, a `:memory:` test database had whichever installer ran
 * first, and no environment had the shape partnerSubscriptionStore.ts writes.
 *
 *   absent    — no table at all
 *   legacy    — has partner_id / cadence, not the canonical identity
 *   canonical — has subject_kind + subject_id and no legacy-only column
 *   mixed     — both families present (mid-reconcile, or a shimmed table)
 */
export function partnerSubscriptionShape(db: DbLike): PartnerSubscriptionShape {
  const cols = new Set(partnerSubscriptionColumns(db));
  if (cols.size === 0) return "absent";
  const canonical = cols.has("subject_kind") && cols.has("subject_id") && cols.has("cycle");
  const legacy = cols.has("partner_id") || cols.has("cadence");
  if (canonical && legacy) return "mixed";
  if (canonical) return "canonical";
  return "legacy";
}

/**
 * The runner's idempotency contract, mirrored EXACTLY
 * (server/db/migrate.ts:isIdempotentSqliteError). Deliberately narrow: it does
 * NOT swallow "no such column" or "no such table", which is how a real breakage
 * still surfaces.
 */
function isIdempotentSqliteError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate column name") ||
    m.includes("already exists") ||
    m.includes("unique constraint failed")
  );
}

export interface Wave13ShapeResult {
  /** Shape observed BEFORE the heal — the ground truth for this database. */
  shapeBefore: PartnerSubscriptionShape;
  /** Shape observed AFTER it. Anything but "canonical" is a logged error. */
  shapeAfter: PartnerSubscriptionShape;
  applied: boolean;
  reason: string;
  /** Rows counted before and after: a rebuild that loses a row is a defect. */
  rowsBefore: number | null;
  rowsAfter: number | null;
  statementsRun: number;
  statementsSkippedIdempotent: number;
  missingColumns: string[];
}

function rowCount(db: DbLike): number | null {
  try {
    const r = db.prepare("SELECT COUNT(*) AS n FROM partner_subscription").get() as any;
    return typeof r?.n === "number" ? r.n : Number(r?.n ?? 0);
  } catch {
    return null;
  }
}

/**
 * Bring `partner_subscription` to the canonical Wave 13 shape, preserving every
 * row. Safe to call on every boot and from every test setup; 0169 is idempotent
 * and shape-agnostic by construction (see its header).
 */
export function applyWave13SubscriptionShape(db: DbLike): Wave13ShapeResult {
  const shapeBefore = partnerSubscriptionShape(db);
  const rowsBefore = rowCount(db);

  const ddl = readWave13ShapeDdl();
  if (!ddl) {
    const reason = `W13_SHAPE_DDL_NOT_FOUND: looked in ${candidatePaths(W13_SHAPE_MIGRATION).join(", ")}`;
    log.error?.({ route: "applyWave13SubscriptionShape", code: "W13_SHAPE_DDL_NOT_FOUND", message: reason });
    return {
      shapeBefore,
      shapeAfter: shapeBefore,
      applied: false,
      reason,
      rowsBefore,
      rowsAfter: rowsBefore,
      statementsRun: 0,
      statementsSkippedIdempotent: 0,
      missingColumns: [...W13_CANONICAL_COLUMNS].filter(
        (c) => !partnerSubscriptionColumns(db).includes(c),
      ),
    };
  }

  let statementsRun = 0;
  let statementsSkippedIdempotent = 0;
  let applied = true;
  let reason = "applied";
  for (const stmt of splitStatements(ddl)) {
    try {
      db.exec(stmt);
      statementsRun++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isIdempotentSqliteError(msg)) {
        statementsSkippedIdempotent++;
        continue;
      }
      applied = false;
      reason = `failed: ${msg}`;
      log.error?.({
        route: "applyWave13SubscriptionShape",
        code: "W13_SHAPE_INSTALL_FAILED",
        message: `${msg} — while applying ${W13_SHAPE_MIGRATION}`,
      });
      break;
    }
  }

  const shapeAfter = partnerSubscriptionShape(db);
  const rowsAfter = rowCount(db);
  const have = new Set(partnerSubscriptionColumns(db));
  const missingColumns = [...W13_CANONICAL_COLUMNS].filter((c) => !have.has(c));

  if (shapeAfter !== "canonical" || missingColumns.length > 0) {
    log.error?.({
      route: "applyWave13SubscriptionShape",
      code: "W13_SHAPE_NOT_CANONICAL",
      message:
        `partner_subscription is "${shapeAfter}" after heal` +
        (missingColumns.length ? `; missing: ${missingColumns.join(", ")}` : ""),
    });
  }
  // A rebuild that drops rows is the one failure mode that cannot be allowed to
  // pass quietly, so it is compared and named rather than trusted.
  if (rowsBefore !== null && rowsAfter !== null && rowsAfter < rowsBefore) {
    log.error?.({
      route: "applyWave13SubscriptionShape",
      code: "W13_SHAPE_ROW_LOSS",
      message: `partner_subscription row count fell from ${rowsBefore} to ${rowsAfter} during reshape`,
    });
  }
  if (shapeBefore === "legacy" && shapeAfter === "canonical") {
    log.info?.(
      `[wave13] partner_subscription reshaped legacy → canonical (subject_kind/subject_id), ` +
        `${rowsAfter ?? 0} row(s) carried`,
    );
  }

  return {
    shapeBefore,
    shapeAfter,
    applied,
    reason,
    rowsBefore,
    rowsAfter,
    statementsRun,
    statementsSkippedIdempotent,
    missingColumns,
  };
}

/* ------------------------------------------------------------------ */
/* Memoised lazy heal                                                  */
/* ------------------------------------------------------------------ */
//
// Keyed by the driver OBJECT (WeakSet), never a module-level boolean: a suite
// that opens a second in-memory database must get a real install rather than a
// stale "already done" short-circuit. Same reasoning as
// applyWave5MoneySchema.ts:_installed.
const _healed = new WeakSet<object>();

export function ensureCanonicalPartnerSubscriptionShape(db: DbLike): void {
  if (_healed.has(db as unknown as object)) return;
  applyWave13SubscriptionShape(db);
  _healed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-heal and assert on it. */
export function __resetWave13ShapeMemoForTests(db: DbLike): void {
  _healed.delete(db as unknown as object);
}
