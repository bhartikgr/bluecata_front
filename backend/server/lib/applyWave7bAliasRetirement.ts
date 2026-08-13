// server/lib/applyWave7bAliasRetirement.ts
//
// WAVE 7B — A-21 self-heal installer for migration
// 0164_wave7b_a21_retire_partner_basic_pro_aliases.sql.
//
// WHY THIS EXISTS — A-22, the standing checklist item, applied.
//   "For every data fix, ask: does the bootstrap re-create what I just
//    repaired? If yes, ship a self-heal installer alongside the migration."
//
//   It does. The SQLite bootstrap path (`applyInlineMigrations` in
//   server/db/connection.ts) builds a database from DDL and seeds inlined in
//   THAT file, not from the numbered migrations. connection.ts is SACRED, so
//   the seeds at connection.ts:1918-1919 that insert
//   `consortium.subscription.partner_basic` and
//   `consortium.subscription.partner_pro` cannot be edited out. Every fresh
//   database — including the `:memory:` one `NODE_ENV=test` opens, and a real
//   first boot — therefore re-creates both stale rows after 0164 has run.
//   Retiring them in the migration alone would fix production-on-upgrade and
//   silently regress everywhere else.
//
//   Same shape and same rationale as server/lib/applyWave7AliasRetirement.ts
//   (X-C3, the row this one is the sibling of), applyWave5MoneySchema.ts and
//   applyWave9ReportingSchema.ts.
//
// PARITY BY CONSTRUCTION
//   The statements are NOT re-typed here. They are READ FROM the migration
//   file, so this installer and 0164 cannot drift. Both `migrations/` and
//   `server/db/migrations/` hold a byte-identical copy and either will do. If
//   neither is readable the installer reports `applied: false` with a reason
//   and changes nothing — it never falls back to an inlined guess, because an
//   inlined guess is precisely how the two copies drift apart.
//
// FAIL-SAFE
//   0164's own WHERE clauses require each alias's canonical target row to exist
//   and be live before that alias is retired, and the two are guarded
//   independently. Running the file (rather than hand-written UPDATEs) is what
//   preserves those guards.
//
// IDEMPOTENT
//   0164 matches only rows whose deleted_at is NULL/''. Calling this twice
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

const MIGRATION_BASENAME = "0164_wave7b_a21_retire_partner_basic_pro_aliases.sql";

/** One stale alias row and the canonical row that keeps retiring it lossless. */
export interface AliasPair {
  /** The stale `platform_fees` key A-21 retires. */
  aliasKey: string;
  /** The canonical key it resolves to via LEGACY_PARTNER_SLUG_MAP. */
  canonicalKey: string;
}

/**
 * The two rows A-21 retires. `partner_enterprise` is NOT here — Wave 7's X-C3
 * already retired it via 0163/applyWave7AliasRetirement.ts, and duplicating it
 * would create the second-writer shape this project keeps getting burnt by.
 */
export const WAVE7B_ALIAS_PAIRS: readonly AliasPair[] = [
  {
    aliasKey: "consortium.subscription.partner_basic",
    canonicalKey: "consortium.subscription.catalyst",
  },
  {
    aliasKey: "consortium.subscription.partner_pro",
    canonicalKey: "consortium.subscription.builder",
  },
];

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

export function readWave7bAliasRetirementSql(): string | null {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

export interface Wave7bAliasRetirementResult {
  applied: boolean;
  reason: string;
  /** Alias keys that are absent or soft-deleted once this call returns. */
  retired: string[];
  /** Alias keys still live because their canonical target is not live. */
  withheld: string[];
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
 * Retire the stale `partner_basic` / `partner_pro` alias rows by executing
 * migration 0164.
 *
 * Never throws: a failure here must not take down boot, but it is logged at
 * WARN with the reason so it is visible rather than silent.
 */
export function ensureWave7bAliasesRetired(db: DbLike): Wave7bAliasRetirementResult {
  const liveAliases = WAVE7B_ALIAS_PAIRS.filter((p) => rowState(db, p.aliasKey).live);

  if (liveAliases.length === 0) {
    return {
      applied: false,
      reason: "already retired (or never seeded) in this database",
      retired: WAVE7B_ALIAS_PAIRS.map((p) => p.aliasKey),
      withheld: [],
    };
  }

  /* FAIL SAFE, per pair. Retiring an alias while the tier it points at has no
     live price would leave legacy partners resolving to nothing. */
  const actionable = liveAliases.filter((p) => rowState(db, p.canonicalKey).live);
  const withheldUpFront = liveAliases
    .filter((p) => !rowState(db, p.canonicalKey).live)
    .map((p) => p.aliasKey);
  for (const p of liveAliases) {
    if (!rowState(db, p.canonicalKey).live) {
      log.warn(
        `[wave7b:A-21] refusing to retire ${p.aliasKey}: canonical ${p.canonicalKey} is missing or soft-deleted`,
      );
    }
  }

  if (actionable.length === 0) {
    return {
      applied: false,
      reason: "every live alias has a missing or soft-deleted canonical target — retirement withheld",
      retired: WAVE7B_ALIAS_PAIRS.filter((p) => !rowState(db, p.aliasKey).live).map(
        (p) => p.aliasKey,
      ),
      withheld: withheldUpFront,
    };
  }

  const sql = readWave7bAliasRetirementSql();
  if (!sql) {
    log.warn(
      `[wave7b:A-21] ${MIGRATION_BASENAME} not found in migrations/ or server/db/migrations/ — alias rows left in place`,
    );
    return {
      applied: false,
      reason: "migration file not found",
      retired: [],
      withheld: liveAliases.map((p) => p.aliasKey),
    };
  }

  try {
    db.exec(sql);
  } catch (err) {
    log.warn(`[wave7b:A-21] alias retirement failed: ${(err as Error).message}`);
    return {
      applied: false,
      reason: `exec failed: ${(err as Error).message}`,
      retired: [],
      withheld: liveAliases.map((p) => p.aliasKey),
    };
  }

  const retired: string[] = [];
  const withheld: string[] = [];
  for (const p of WAVE7B_ALIAS_PAIRS) {
    if (rowState(db, p.aliasKey).live) withheld.push(p.aliasKey);
    else retired.push(p.aliasKey);
  }
  return { applied: true, reason: "migration 0164 applied", retired, withheld };
}
