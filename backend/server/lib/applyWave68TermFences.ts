// server/lib/applyWave68TermFences.ts
//
// WAVE 68 · SELF-HEAL INSTALLER for migration
// `0192_wave68_term_domain_fences.sql`.
//
// WHY THIS FILE EXISTS
//   The numbered migrations DO NOT RUN in dev or test. `server/index.ts:246`
//   exits rather than auto-migrating in production, and the SQLite bootstrap
//   (`applyInlineMigrations` in `server/db/connection.ts`) builds a database from
//   DDL inlined in THAT file. `connection.ts` is SACRED — this wave may not edit
//   it — so a new installer cannot be registered there.
//
//   Without this file, migration 0192 would be a fence that exists in a .sql
//   file and in production-after-`npm run db:migrate`, and NOWHERE ELSE. The
//   whole value the owner authorised (R49) is defence in depth — "it holds when
//   a future writer forgets" — and a fence that is absent from every dev and
//   test database holds nothing. Wave 58f reached the same conclusion for 0190
//   and `server/lib/applyWave58fDiscountDomain.ts` is the pattern copied here,
//   deliberately, so there is one pattern to audit rather than a new one.
//
// ORDERING, AND IT IS LOAD-BEARING
//   `applyWave58fDiscountDomain` REMOVES-IF-PRESENT and re-creates the two
//   `captable_commits.discount_pct` triggers from 0190, i.e. the WEAKER pair
//   this wave replaces. So this installer MUST run AFTER it. In
//   `server/routes.ts` it is invoked in the block immediately following the 58f
//   block, for that reason and no other. Measured, not assumed: with the order
//   reversed, `'abc'` is accepted again.
//   `applyWave5MoneySchema` (0153) is NOT a hazard: every one of its trigger
//   statements is `CREATE TRIGGER IF NOT EXISTS` with no removal, so it cannot
//   overwrite a trigger that already exists.
//
// PARITY BY CONSTRUCTION
//   The DDL is NOT re-typed here. It is READ FROM the migration file itself, so
//   this installer and 0192 cannot drift.
//
// TRIGGER BODIES AND THE STATEMENT SPLITTER
//   0192's `CREATE TRIGGER` bodies contain internal semicolons. The whole file
//   is handed to `db.exec()` as ONE script — better-sqlite3 parses trigger
//   bodies correctly, and a naive split on `;` would corrupt every one of them.
//
// WHAT IT DOES NOT DO
//   It does not read, rewrite or re-hash a single row of `rounds` or
//   `captable_commits`. 0192 contains no UPDATE, no DELETE and no backfill;
//   `discount_pct` enters the commit hash body, so rewriting a committed value
//   would alter immutable history (R17).
//
// FAILURE IS NAMED, NEVER SILENT
//   0192 ends with a postcondition block that ABORTS if a fence failed to
//   attach. If the whole-file exec fails for any reason (most likely a host
//   table that a given harness never created), the fences are reported as
//   UNFIXED by name in the log and boot continues — an unfenced money column
//   must be visible, and a blocked boot is worse than a visible warning.

import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

const MIGRATION_BASENAME = "0192_wave68_term_domain_fences.sql";

/** The four triggers 0192 owns: two pairs, on two different columns. */
export const WAVE68_TRIGGERS = [
  "trg_captable_commits_discount_pct_ins",
  "trg_captable_commits_discount_pct_upd",
  "trg_rounds_extras_terms_ins",
  "trg_rounds_extras_terms_upd",
] as const;

/** The tables 0192's triggers hang on. Both belong to the bootstrap. */
const HOST_TABLES = ["captable_commits", "rounds"] as const;

/** The abort codes 0192 raises, asserted by the Wave 68 tests. */
export const WAVE68_ABORT_CODES = [
  "DISCOUNT_PCT_OUT_OF_DOMAIN",
  "ROUND_TERM_DISCOUNT_REFUSED",
  "ROUND_TERM_INTEREST_RATE_REFUSED",
  "ROUND_TERM_VALUATION_CAP_REFUSED",
  "ROUND_TERM_STRIKE_PRICE_REFUSED",
  "ROUND_TERM_MATURITY_MONTHS_REFUSED",
  "ROUND_TERM_EXPIRY_YEARS_REFUSED",
] as const;

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
export function readWave68TermFenceDdl(): string | null {
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

/**
 * True when this trigger's stored SQL carries WAVE 68's NUMERIC-TEXT test.
 *
 * Checked on the TEST ITSELF, not on a comment. `stray` is the derived column
 * that holds the value with every character a number may contain removed; it is
 * `''` for a number and non-empty for anything else, and it is the clause that
 * closes C-3 (`CAST('abc' AS REAL)` is `0.0` in SQLite, so 0190's range test
 * alone accepted `'abc'`). Reading the clause makes this a fact about the
 * database rather than a fact about a string someone wrote.
 *
 * WHY NOT THE `GLOB` CHARACTER CLASS THE SPEC USES: 0192 contains no `GLOB`.
 * The Wave 0 AST lint's parser cannot parse `GLOB` inside a trigger-body SELECT
 * and went RED on the first draft, so both GLOB clauses were restated with
 * `replace`/`length`/`instr`/`substr`. The 23-case numeric table was re-executed
 * to prove the verdicts are unchanged — build_log/wave68/W68_TESTS.md.
 */
export function hasNumericTextTest(sql: string | null): boolean {
  if (!sql) return false;
  return sql.includes("AS stray");
}

export interface Wave68FenceResult {
  applied: boolean;
  reason: string;
  /** Triggers present AND carrying the numeric-text test. */
  triggersFenced: string[];
  /** Triggers absent, or present without the numeric-text test. */
  triggersUnfixed: Array<{ trigger: string; reason: string }>;
}

/**
 * Idempotent. Safe to call on every boot, from every test setup, and twice in a
 * row: 0192 removes each trigger if present before creating it, and its scratch
 * tables are removed on the way out.
 */
export function applyWave68TermFences(db: DbLike): Wave68FenceResult {
  const ddl = readWave68TermFenceDdl();
  if (!ddl) {
    const reason = `WAVE68_DDL_NOT_FOUND: looked in ${candidatePaths().join(", ")}`;
    log.error?.({ route: "applyWave68TermFences", code: "WAVE68_DDL_NOT_FOUND", message: reason });
    return {
      applied: false,
      reason,
      triggersFenced: [],
      triggersUnfixed: WAVE68_TRIGGERS.map((t) => ({ trigger: t, reason: "ddl_not_found" })),
    };
  }

  const missingHost = HOST_TABLES.filter((t) => !tableExists(db, t));
  if (missingHost.length > 0) {
    const reason = `WAVE68_HOST_TABLE_MISSING: ${missingHost.join(", ")}`;
    log.warn?.({ route: "applyWave68TermFences", code: "WAVE68_HOST_TABLE_MISSING", message: reason });
    return {
      applied: false,
      reason,
      triggersFenced: [],
      triggersUnfixed: WAVE68_TRIGGERS.map((t) => ({ trigger: t, reason: "host_table_missing" })),
    };
  }

  let applied = true;
  let reason = "applied";
  try {
    db.exec(ddl);
  } catch (err) {
    applied = false;
    reason = `WAVE68_EXEC_FAILED: ${(err as Error).message}`;
    log.error?.({ route: "applyWave68TermFences", code: "WAVE68_EXEC_FAILED", message: reason });
  }

  const triggersFenced: string[] = [];
  const triggersUnfixed: Array<{ trigger: string; reason: string }> = [];
  for (const t of WAVE68_TRIGGERS) {
    const sql = triggerSql(db, t);
    if (sql === null) triggersUnfixed.push({ trigger: t, reason: "absent_after_install" });
    else if (!hasNumericTextTest(sql)) triggersUnfixed.push({ trigger: t, reason: "numeric_text_test_missing" });
    else triggersFenced.push(t);
  }
  if (triggersUnfixed.length > 0) {
    log.warn?.({
      route: "applyWave68TermFences",
      code: "WAVE68_TRIGGERS_UNFIXED",
      message: `term domain fences NOT installed: ${triggersUnfixed
        .map((t) => `${t.trigger}(${t.reason})`)
        .join(", ")}`,
    });
  }

  return { applied, reason, triggersFenced, triggersUnfixed };
}

/* ------------------------------------------------------------------ */
/* Memoised convenience — same shape as ensureWave58fDiscountDomain.   */
/* ------------------------------------------------------------------ */

const _installed = new WeakSet<object>();

export function ensureWave68TermFences(db: DbLike): void {
  if (_installed.has(db as unknown as object)) return;
  applyWave68TermFences(db);
  _installed.add(db as unknown as object);
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave68FenceMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}
