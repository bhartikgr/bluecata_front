// server/lib/applyWave58fDiscountDomain.ts
//
// WAVE 58f · F0 — SELF-HEAL INSTALLER for migration
// `0190_wave58f_discount_pct_domain.sql`.
//
// WHY THIS FILE EXISTS
//   The numbered migrations DO NOT RUN in dev or test. `server/index.ts:246`
//   exits rather than auto-migrating in production, and the SQLite bootstrap
//   (`applyInlineMigrations` in `server/db/connection.ts`) builds a database
//   from DDL inlined in THAT file. `connection.ts` is SACRED — this wave may
//   not edit it — so a new installer cannot be registered there.
//
//   Meanwhile the BROKEN fence this migration corrects DOES reach dev and test
//   databases, because `server/lib/applyWave5MoneySchema.ts` self-heals
//   migration 0153 (including its two `discount_pct` triggers) and is invoked
//   lazily by six modules. So without this installer, a dev or test database
//   can hold the OLD fraction-domain trigger while the corrected migration sits
//   unapplied — and a test asserting "a SAFE with a 20% discount commits" would
//   PASS VACUOUSLY on a database that simply never got either trigger. That
//   failure mode is not hypothetical in this project: a schema mismatch once
//   made a test file error in setup so 20 assertions were silently reported as
//   SKIPPED while the failing-name diff read clean.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM the migration file itself, so
//   this installer and migration 0190 cannot drift. Same shape and same
//   rationale as `applyWave5MoneySchema.ts`, `applyWave50MoneyDefectSchema.ts`
//   and `applyWave45PricingSchema.ts`, deliberately, so there is one pattern to
//   audit rather than a new one to learn.
//
// TRIGGER BODIES AND THE STATEMENT SPLITTER
//   0190 contains `CREATE TRIGGER` bodies with internal semicolons. The whole
//   file is handed to `db.exec()` as ONE script — better-sqlite3 parses trigger
//   bodies correctly, and a naive split on `;` would corrupt every one of them.
//
// ONE DIFFERENCE FROM THE OLDER INSTALLERS, ON PURPOSE
//   `applyWave5MoneySchema.candidatePaths()` resolves the migration from
//   `process.cwd()`. Wave 58b's independent review recorded ten checks failing
//   in a rerun purely because sources resolved from the launch directory. This
//   file therefore resolves from `__dirname` FIRST and keeps `process.cwd()`
//   only as a fallback.
//
// WHAT IT DOES NOT DO
//   It does not read, rewrite or re-hash a single `captable_commits` row.
//   `discount_pct` enters the commit hash body, so touching a committed value
//   would alter immutable history. It only replaces a trigger whose domain
//   contradicted owner ruling R30. See the migration header for the full
//   four-authority argument and the read-only live census that must precede it.

import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

const MIGRATION_BASENAME = "0190_wave58f_discount_pct_domain.sql";

/** The two triggers 0190 owns. Both live on a SACRED-bootstrap table. */
export const WAVE58F_TRIGGERS = [
  "trg_captable_commits_discount_pct_ins",
  "trg_captable_commits_discount_pct_upd",
] as const;

const HOST_TABLE = "captable_commits";

/** The refusal text 0190's triggers raise. Asserted by the Wave 58f tests. */
export const WAVE58F_DISCOUNT_ABORT_CODE = "DISCOUNT_PCT_OUT_OF_DOMAIN";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): any[];
    get(...args: unknown[]): any;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): void;
}

export function candidatePaths(): string[] {
  const here = __dirname; // server/lib
  const repoFromHere = path.resolve(here, "..", ".."); // repo root
  const cwd = process.cwd();
  return [
    path.join(repoFromHere, "migrations", MIGRATION_BASENAME),
    path.join(repoFromHere, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
  ];
}

/** The migration text, or null when no copy is readable. */
export function readWave58fDiscountDomainDdl(): string | null {
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
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  } catch {
    return false;
  }
}

/** The stored SQL of a trigger, or null when it is absent. */
export function triggerSql(db: DbLike, name: string): string | null {
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(name) as { sql?: string } | undefined;
    return row?.sql ?? null;
  } catch {
    return null;
  }
}

export interface Wave58fDomainResult {
  applied: boolean;
  reason: string;
  /** Triggers present AND carrying the corrected percent-as-written domain. */
  triggersCorrected: string[];
  /** Triggers still absent or still carrying the old fraction domain. */
  triggersUnfixed: Array<{ trigger: string; reason: string }>;
}

/**
 * True when this trigger's stored SQL carries the corrected domain.
 *
 * Checked on the BOUND, not on the comment: `>= 100` is the corrected fence and
 * `> 1` is 0153's. Reading the bound is what makes this a fact about the
 * database rather than a fact about a string someone wrote.
 */
export function isCorrectedDomain(sql: string | null): boolean {
  if (!sql) return false;
  const flat = sql.replace(/\s+/g, " ");
  return flat.includes("AS REAL) >= 100") && !flat.includes("AS REAL) > 1");
}

/**
 * Idempotent. Safe to call on every boot, from every test setup, and twice in a
 * row. Every statement is `DROP ... IF EXISTS` / `CREATE ... IF NOT EXISTS`.
 */
export function applyWave58fDiscountDomain(db: DbLike): Wave58fDomainResult {
  const ddl = readWave58fDiscountDomainDdl();
  if (!ddl) {
    const reason = `WAVE58F_DDL_NOT_FOUND: looked in ${candidatePaths().join(", ")}`;
    log.error?.({ route: "applyWave58fDiscountDomain", code: "WAVE58F_DDL_NOT_FOUND", message: reason });
    return {
      applied: false,
      reason,
      triggersCorrected: [],
      triggersUnfixed: WAVE58F_TRIGGERS.map((t) => ({ trigger: t, reason: "ddl_not_found" })),
    };
  }

  /* The host table belongs to the SACRED bootstrap. On a fresh database it is
     created before any store hydrates, so it exists by the time this runs. If
     it does not, SQLite raises "no such table" for the CREATE TRIGGER; that is
     reported as a NAMED reason rather than swallowed, because a missing domain
     fence on a money column is exactly the thing that must be visible. */
  if (!tableExists(db, HOST_TABLE)) {
    const reason = `WAVE58F_HOST_TABLE_MISSING: ${HOST_TABLE}`;
    log.warn?.({ route: "applyWave58fDiscountDomain", code: "WAVE58F_HOST_TABLE_MISSING", message: reason });
    return {
      applied: false,
      reason,
      triggersCorrected: [],
      triggersUnfixed: WAVE58F_TRIGGERS.map((t) => ({ trigger: t, reason: "host_table_missing" })),
    };
  }

  let applied = true;
  let reason = "applied";
  try {
    db.exec(ddl);
  } catch (err) {
    applied = false;
    reason = `WAVE58F_EXEC_FAILED: ${(err as Error).message}`;
    log.error?.({ route: "applyWave58fDiscountDomain", code: "WAVE58F_EXEC_FAILED", message: reason });
  }

  const triggersCorrected: string[] = [];
  const triggersUnfixed: Array<{ trigger: string; reason: string }> = [];
  for (const t of WAVE58F_TRIGGERS) {
    const sql = triggerSql(db, t);
    if (sql === null) triggersUnfixed.push({ trigger: t, reason: "absent_after_install" });
    else if (!isCorrectedDomain(sql)) triggersUnfixed.push({ trigger: t, reason: "old_fraction_domain_still_present" });
    else triggersCorrected.push(t);
  }
  if (triggersUnfixed.length > 0) {
    log.warn?.({
      route: "applyWave58fDiscountDomain",
      code: "WAVE58F_TRIGGERS_UNFIXED",
      message: `discount_pct domain NOT corrected: ${triggersUnfixed.map((t) => `${t.trigger}(${t.reason})`).join(", ")}`,
    });
  }

  return { applied, reason, triggersCorrected, triggersUnfixed };
}

/* ------------------------------------------------------------------ */
/* Memoised convenience — same shape as ensureWave5MoneySchema.        */
/* ------------------------------------------------------------------ */

const _installed = new WeakSet<object>();

export function ensureWave58fDiscountDomain(db: DbLike): void {
  if (_installed.has(db as unknown as object)) return;
  applyWave58fDiscountDomain(db);
  _installed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave58fDomainMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}
