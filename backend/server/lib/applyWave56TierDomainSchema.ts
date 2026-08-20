// server/lib/applyWave56TierDomainSchema.ts
//
// WAVE 56 — self-heal installer for migration 0191_wave56_tier_domain_dynamic.sql.
//
// WHY THIS EXISTS
//   Migrations do NOT auto-run (server/index.ts exits in production rather than
//   migrating), and the dev/test SQLite database is built from DDL inlined in
//   server/db/connection.ts, which is SACRED and predates every tier table. The
//   Wave 45 installer therefore creates partner_tier_lifecycle /
//   partner_tier_capability from migration 0185 — INCLUDING 0185's five-slug
//   CHECK constraint. Without this installer, `npm test` would run against a
//   database where a new tier still cannot be inserted, and Wave 56's tests
//   would be measuring the OLD schema while claiming to prove the new one. This
//   build's history has 25+ "checks that passed while checking nothing"; this is
//   how that is avoided here.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed. It is READ FROM migration 0191 itself, exactly as
//   applyWave45PricingSchema.ts reads 0185, so installer and migration cannot
//   drift. Both migrations/ and server/db/migrations/ hold a byte-identical copy.
//
// ONE SCRIPT, ONE TRANSACTION
//   0191 creates triggers whose bodies contain semicolons, so the file is
//   executed as ONE script and never split on ';'. It is executed inside a
//   transaction because a HALF-APPLIED REBUILD IS WORSE THAN A REFUSAL: the
//   migration drops the money-freeze triggers before rebuilding, and a failure
//   between those two points would leave "a frozen tier's price is immutable"
//   silently switched off. On any error this installer rolls back and reports.
//
// IDEMPOTENT BY INSPECTION, NOT BY A BOOLEAN
//   The probe reads the CHECK text out of sqlite_master. A boolean memo would
//   answer "already done" for a second in-memory database that has none of it.

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

const MIGRATION_BASENAME = "0191_wave56_tier_domain_dynamic.sql";

/** The tables 0191 rebuilds, and the CHECK fragment it must remove from each. */
export const WAVE56_REBUILT_TABLES: ReadonlyArray<{ table: string; removedCheck: string }> = [
  { table: "partner_tier_lifecycle", removedCheck: "tier_slug IN (" },
  { table: "partner_tier_capability", removedCheck: "tier_slug IN (" },
  { table: "partner_tier_current", removedCheck: "tier IN (" },
];

/** The referential controls 0191 installs in place of the removed CHECKs. */
export const WAVE56_TRIGGERS = [
  "trg_ptc_tier_must_exist_insert",
  "trg_ptc_tier_must_exist_update",
  "trg_ptcur_tier_must_exist_insert",
  "trg_ptcur_tier_must_exist_update",
  "trg_ptr_tier_must_exist_insert",
] as const;

/** The triggers 0191 DISPLACES and must put back byte-identically (0185). */
export const WAVE56_DISPLACED_TRIGGERS = [
  "trg_ptp_frozen_no_price_update",
  "trg_ptp_frozen_no_price_insert",
  "trg_ptl_no_delete",
] as const;

export const WAVE56_RANK_TABLE = "partner_tier_rank";

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave56TierDomainDdl(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

function objectSql(db: DbLike, type: "table" | "trigger", name: string): string | null {
  try {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = ? AND name = ?`)
      .get(type, name) as { sql?: string } | undefined;
    return typeof row?.sql === "string" ? row.sql : null;
  } catch {
    return null;
  }
}

export interface Wave56InstallResult {
  ran: boolean;
  reason: string;
  /** Tables that still carry the five-slug CHECK. Empty = domain is data. */
  tablesStillPinned: string[];
  triggersMissing: string[];
  rankTablePresent: boolean;
  warnings: string[];
}

function probe(db: DbLike): Omit<Wave56InstallResult, "ran" | "reason" | "warnings"> {
  const tablesStillPinned: string[] = [];
  for (const { table, removedCheck } of WAVE56_REBUILT_TABLES) {
    const sql = objectSql(db, "table", table);
    if (sql !== null && sql.includes(removedCheck)) tablesStillPinned.push(table);
  }
  const triggersMissing = WAVE56_TRIGGERS.filter((t) => objectSql(db, "trigger", t) === null);
  const rankTablePresent = objectSql(db, "table", WAVE56_RANK_TABLE) !== null;
  return { tablesStillPinned, triggersMissing, rankTablePresent };
}

/**
 * 0191 counts and copies partner_tier_current, which in dev/test is created
 * lazily by partnerTierResolver.ts rather than by any migration. If it is absent
 * when 0191 runs, STEP 0 raises "no such table" and the whole rebuild rolls
 * back — so the empty table is created first, in its post-0191 shape. It is
 * created EMPTY and seeds NOTHING: a bootstrap can never manufacture a tier or
 * an assignment.
 */
function ensureTierCurrentExists(db: DbLike): void {
  if (objectSql(db, "table", "partner_tier_current") !== null) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS partner_tier_current (
  partner_id      TEXT PRIMARY KEY NOT NULL,
  tier            TEXT NOT NULL,
  source          TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_partner_tier_current_tier ON partner_tier_current (tier);
`);
}

export function applyWave56TierDomainSchema(db: DbLike): Wave56InstallResult {
  const warnings: string[] = [];

  // Nothing to rebuild if the Wave 45 tables are not there at all. Reported, not
  // silently treated as success.
  if (objectSql(db, "table", "partner_tier_lifecycle") === null) {
    return {
      ran: false,
      reason: "partner_tier_lifecycle absent — Wave 45 install has not run",
      warnings: ["wave56 tier-domain install skipped: partner_tier_lifecycle absent"],
      ...probe(db),
    };
  }

  let state = probe(db);
  if (state.tablesStillPinned.length === 0 && state.triggersMissing.length === 0 && state.rankTablePresent) {
    return { ran: false, reason: "already installed", warnings, ...state };
  }

  const ddl = readWave56TierDomainDdl();
  if (!ddl) {
    warnings.push(`could not read ${MIGRATION_BASENAME} from any of: ${candidatePaths().join(", ")}`);
    log.error?.({ warnings }, "wave56 tier-domain install could not read its migration");
    return { ran: false, reason: "ddl not found", warnings, ...state };
  }

  try {
    ensureTierCurrentExists(db);
  } catch (err) {
    warnings.push(`partner_tier_current pre-create failed: ${(err as Error).message}`);
  }

  // ONE script, ONE transaction. See the header: a half-applied rebuild would
  // leave the money-freeze triggers off.
  const anyDb = db as unknown as { transaction?: (fn: () => void) => () => void };
  try {
    if (typeof anyDb.transaction === "function") {
      anyDb.transaction(() => { db.exec(ddl); })();
    } else {
      try {
        db.exec("BEGIN");
        db.exec(ddl);
        db.exec("COMMIT");
      } catch (inner) {
        try { db.exec("ROLLBACK"); } catch { /* nothing to roll back */ }
        throw inner;
      }
    }
  } catch (err) {
    warnings.push(`exec failed (rolled back): ${(err as Error).message}`);
    log.error?.({ err }, "wave56 tier-domain install failed and was rolled back");
    return { ran: true, reason: "failed and rolled back", warnings, ...probe(db) };
  }

  state = probe(db);
  if (state.tablesStillPinned.length > 0 || state.triggersMissing.length > 0 || !state.rankTablePresent) {
    log.warn?.(
      { tablesStillPinned: state.tablesStillPinned, triggersMissing: state.triggersMissing, rankTablePresent: state.rankTablePresent },
      "wave56 tier-domain install incomplete",
    );
  }
  // The displaced money-freeze triggers are the thing a botched rebuild loses
  // silently, so their absence is reported loudly even when everything else
  // looks installed.
  const displacedMissing = WAVE56_DISPLACED_TRIGGERS.filter((t) => objectSql(db, "trigger", t) === null);
  if (displacedMissing.length > 0) {
    warnings.push(`DISPLACED MONEY-FREEZE TRIGGERS NOT RESTORED: ${displacedMissing.join(", ")}`);
    log.error?.({ displacedMissing }, "wave56 tier-domain install did not restore money-freeze triggers");
  }
  return { ran: true, reason: "installed", warnings, ...state };
}

/* ------------------------------------------------------------------ */
/* Memoised lazy bootstrap — keyed by the driver object, not a boolean */
/* ------------------------------------------------------------------ */
const _installed = new WeakSet<object>();

export function ensureWave56TierDomainSchema(db: DbLike): void {
  if (_installed.has(db as unknown as object)) return;
  applyWave56TierDomainSchema(db);
  _installed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave56SchemaMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}
