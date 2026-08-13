// server/lib/applyWave7AliasRetirement.ts
//
// WAVE 7 — X-C3 self-heal installer for migration
// 0163_wave7_xc3_retire_partner_enterprise_alias.sql.
//
// WHY THIS EXISTS
//   The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL and seeds inlined in
//   THAT file, not from the numbered migrations. connection.ts is SACRED, so
//   the seed at connection.ts:1920 that inserts
//   `consortium.subscription.partner_enterprise` cannot be edited out. Every
//   fresh database — including the `:memory:` one `NODE_ENV=test` opens, and a
//   real first boot — therefore re-creates the stale alias row after 0163 has
//   run. Retiring it in the migration alone would fix production-on-upgrade and
//   silently regress everywhere else.
//
//   Same shape and same rationale as server/lib/applyWave5MoneySchema.ts and
//   server/lib/applyWave9ReportingSchema.ts.
//
// PARITY BY CONSTRUCTION
//   The statement is NOT re-typed here. It is READ FROM the migration file, so
//   this installer and 0163 cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do. If
//   neither is readable the installer reports `applied: false` with a reason
//   and changes nothing — it never falls back to an inlined guess, because an
//   inlined guess is precisely how the two copies drift apart.
//
// FAIL-SAFE
//   0163's own WHERE clause requires the canonical `consortium.subscription.
//   amplifier` row to exist and be live before it retires the alias. Running
//   the file (rather than a hand-written UPDATE) is what preserves that guard.
//
// IDEMPOTENT
//   0163 matches only rows whose deleted_at is NULL/''. Calling this twice
//   changes nothing the second time.
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

const MIGRATION_BASENAME = "0163_wave7_xc3_retire_partner_enterprise_alias.sql";

/** The platform_fees key X-C3 retires. */
export const RETIRED_ALIAS_KEY = "consortium.subscription.partner_enterprise";

/** The canonical tier that key aliases to (server/lib/partnerTiers.ts:47-53). */
export const ALIAS_TARGET_KEY = "consortium.subscription.amplifier";

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave7AliasRetirementSql(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

export interface AliasRetirementResult {
  applied: boolean;
  reason: string;
  /** True once the alias row is absent or soft-deleted. */
  aliasRetired: boolean;
  /** True while the canonical amplifier row is present and live. */
  canonicalLive: boolean;
}

function rowState(db: DbLike, key: string): { present: boolean; live: boolean } {
  try {
    const r = db
      .prepare("SELECT deleted_at FROM platform_fees WHERE key = ?")
      .get(key) as { deleted_at?: string | null } | undefined;
    if (!r) return { present: false, live: false };
    const d = r.deleted_at;
    return { present: true, live: d === null || d === undefined || d === "" };
  } catch {
    /* platform_fees absent (very early bootstrap) — nothing to retire yet */
    return { present: false, live: false };
  }
}

/**
 * Retire the stale `partner_enterprise` alias row by executing migration 0163.
 *
 * Never throws: a failure here must not take down boot, but it is logged at
 * WARN with the reason so it is visible rather than silent.
 */
export function ensureWave7AliasRetired(db: DbLike): AliasRetirementResult {
  const canonicalBefore = rowState(db, ALIAS_TARGET_KEY);
  const aliasBefore = rowState(db, RETIRED_ALIAS_KEY);

  if (!aliasBefore.live) {
    return {
      applied: false,
      reason: aliasBefore.present
        ? "already retired (deleted_at set)"
        : "alias row not present in this database",
      aliasRetired: true,
      canonicalLive: canonicalBefore.live,
    };
  }

  if (!canonicalBefore.live) {
    /* FAIL SAFE. Retiring the alias while the tier it points at has no live
       price would leave legacy partners resolving to nothing. Leave it alone
       and say so loudly. */
    log.warn(
      `[wave7:X-C3] refusing to retire ${RETIRED_ALIAS_KEY}: canonical ${ALIAS_TARGET_KEY} is missing or soft-deleted`,
    );
    return {
      applied: false,
      reason: `canonical ${ALIAS_TARGET_KEY} is not live — retirement withheld`,
      aliasRetired: false,
      canonicalLive: false,
    };
  }

  const sql = readWave7AliasRetirementSql();
  if (!sql) {
    log.warn(
      `[wave7:X-C3] ${MIGRATION_BASENAME} not found in migrations/ or server/db/migrations/ — alias row left in place`,
    );
    return {
      applied: false,
      reason: "migration file not found",
      aliasRetired: false,
      canonicalLive: true,
    };
  }

  try {
    db.exec(sql);
  } catch (err) {
    log.warn(`[wave7:X-C3] alias retirement failed: ${(err as Error).message}`);
    return {
      applied: false,
      reason: `exec failed: ${(err as Error).message}`,
      aliasRetired: false,
      canonicalLive: true,
    };
  }

  const aliasAfter = rowState(db, RETIRED_ALIAS_KEY);
  return {
    applied: true,
    reason: "migration 0163 applied",
    aliasRetired: !aliasAfter.live,
    canonicalLive: rowState(db, ALIAS_TARGET_KEY).live,
  };
}
