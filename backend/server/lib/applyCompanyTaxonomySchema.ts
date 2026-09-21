// server/lib/applyCompanyTaxonomySchema.ts
//
// slide13b WAVE D (D1) — FAIL-CLOSED bootstrap for migration
// 0236_company_taxonomy.sql (`taxonomy_terms` + the 45-row company_sector seed).
//
// WHY THIS EXISTS
//   server/db/connection.ts (SACRED / frozen) builds a fresh SQLite database
//   from inlined DDL, not from the numbered migrations, so a `:memory:` test
//   database and a fresh dev database have no `taxonomy_terms` until something
//   applies 0236. connection.ts cannot be edited, so this reader applies the
//   migration file itself on first use.
//
// HOW IT DIFFERS FROM applyWave4bPartnerClassificationSchema.ts (the pattern)
//   That installer is fail-SOFT (warn-and-continue) because a reporting-only
//   feature must not kill boot. THIS one is fail-CLOSED, by spec:
//     "Missing SQL, failed execution, missing table, or missing seed values
//      must propagate as an API error rather than a silent empty list."
//   Every failure THROWS a TaxonomyBootstrapError. The store memoises success
//   ONLY, so the next request retries instead of pinning the failure.
//
// PARITY BY CONSTRUCTION
//   The DDL is read FROM the migration file (either mirror), never re-typed.
//   The seed oracle is COLLECTIVE_SECTORS_45 — after this wave that constant is
//   exactly and only that: the seed / verification oracle. It is not served.
//
// DIALECT
//   SQLite only, and said out loud. `isSqlite()` false → UNSUPPORTED_DB_DIALECT.
//   The PostgreSQL tree is unverified for this wave and no support is claimed.
import fs from "node:fs";
import path from "node:path";
import { COLLECTIVE_SECTORS_45 } from "../../shared/schema";
import { COMPANY_SECTOR_NAMESPACE } from "../../shared/companyTaxonomy";
import { isSqlite } from "../db/portable";

export interface TaxonomyDbLike {
  prepare(sql: string): { all(...args: any[]): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

export const COMPANY_TAXONOMY_MIGRATION_BASENAME = "0236_company_taxonomy.sql";
export const COMPANY_TAXONOMY_TABLE = "taxonomy_terms";
export const COMPANY_TAXONOMY_EXPECTED_COLUMNS = [
  "namespace", "value", "label", "active", "sort_order", "created_at", "updated_at",
] as const;

export type TaxonomyBootstrapCode =
  | "UNSUPPORTED_DB_DIALECT"
  | "MIGRATION_SQL_MISSING"
  | "MIGRATION_EXEC_FAILED"
  | "TABLE_MISSING"
  | "TABLE_SHAPE_MISMATCH"
  | "SEED_INCOMPLETE";

export class TaxonomyBootstrapError extends Error {
  readonly code: TaxonomyBootstrapCode;
  readonly detail?: string;
  constructor(code: TaxonomyBootstrapCode, message: string, detail?: string) {
    super(message);
    this.name = "TaxonomyBootstrapError";
    this.code = code;
    this.detail = detail;
  }
}

/** Candidate locations, most-likely first. Both trees hold a byte-identical copy. */
export function companyTaxonomyMigrationCandidatePaths(cwd = process.cwd()): string[] {
  return [
    path.join(cwd, "server", "db", "migrations", COMPANY_TAXONOMY_MIGRATION_BASENAME),
    path.join(cwd, "migrations", COMPANY_TAXONOMY_MIGRATION_BASENAME),
  ];
}

/** Returns the migration SQL, or null when neither mirror is readable. */
export function readCompanyTaxonomyMigrationSql(cwd = process.cwd()): string | null {
  for (const p of companyTaxonomyMigrationCandidatePaths(cwd)) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* unreadable candidate — try the next */
    }
  }
  return null;
}

function tableExists(db: TaxonomyDbLike): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(COMPANY_TAXONOMY_TABLE) as { name: string } | undefined;
  return !!row;
}

/**
 * Expected physical contract of `taxonomy_terms` (mirrors 0236 exactly).
 * `pk` is the 1-based position in the composite primary key (0 = not in PK).
 * `dflt` is the literal SQLite default expression as pragma_table_info reports it.
 */
export const COMPANY_TAXONOMY_COLUMN_CONTRACT: ReadonlyArray<{
  name: string; type: string; notnull: 1; pk: number; dflt: string | null;
}> = [
  { name: "namespace",  type: "TEXT",    notnull: 1, pk: 1, dflt: null },
  { name: "value",      type: "TEXT",    notnull: 1, pk: 2, dflt: null },
  { name: "label",      type: "TEXT",    notnull: 1, pk: 0, dflt: null },
  { name: "active",     type: "INTEGER", notnull: 1, pk: 0, dflt: "1" },
  { name: "sort_order", type: "INTEGER", notnull: 1, pk: 0, dflt: "0" },
  { name: "created_at", type: "TEXT",    notnull: 1, pk: 0, dflt: "'1970-01-01T00:00:00.000Z'" },
  { name: "updated_at", type: "TEXT",    notnull: 1, pk: 0, dflt: "'1970-01-01T00:00:00.000Z'" },
];
export const COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX = "ux_taxonomy_terms_ns_label_nocase";
export const COMPANY_TAXONOMY_ACTIVE_INDEX = "idx_taxonomy_terms_ns_active";

function shapeError(what: string): TaxonomyBootstrapError {
  return new TaxonomyBootstrapError(
    "TABLE_SHAPE_MISMATCH",
    `${COMPANY_TAXONOMY_TABLE} does not match the 0236 contract: ${what}`,
  );
}

/**
 * Throws unless the table exists AND matches the 0236 contract — not merely
 * "has seven columns with the right names" (D-B1). Verified:
 *   • exact column set (no extra, no missing), declared type, NOT NULL, default
 *   • composite PRIMARY KEY in the order (namespace, value)
 *   • the `active IN (0, 1)` CHECK (read from the stored CREATE statement)
 *   • UNIQUE index (namespace, label COLLATE NOCASE) by name AND definition
 *   • index (namespace, active) by name AND definition
 * A pre-existing table with the right names but any of these missing is a
 * TABLE_SHAPE_MISMATCH; the process never marks such a database ready.
 */
export function verifyCompanyTaxonomyTable(db: TaxonomyDbLike): void {
  verifyCompanyTaxonomyColumns(db);
  verifyCompanyTaxonomyIndexes(db);
}

/** Table-level contract (columns, types, NOT NULL, defaults, PK order, CHECK) — nothing the migration could repair. */
export function verifyCompanyTaxonomyColumns(db: TaxonomyDbLike): void {
  if (!tableExists(db)) {
    throw new TaxonomyBootstrapError(
      "TABLE_MISSING",
      `${COMPANY_TAXONOMY_TABLE} does not exist after bootstrap`,
    );
  }
  const cols = db.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`)
    .all(COMPANY_TAXONOMY_TABLE) as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;

  const have = new Set(cols.map((c) => c.name));
  const missing = COMPANY_TAXONOMY_COLUMN_CONTRACT.filter((c) => !have.has(c.name)).map((c) => c.name);
  if (missing.length) throw shapeError(`missing column(s): ${missing.join(", ")}`);
  const extra = cols.map((c) => c.name).filter((n) => !COMPANY_TAXONOMY_COLUMN_CONTRACT.some((c) => c.name === n));
  if (extra.length) throw shapeError(`unexpected column(s): ${extra.join(", ")}`);

  for (const want of COMPANY_TAXONOMY_COLUMN_CONTRACT) {
    const got = cols.find((c) => c.name === want.name)!;
    if (got.type.toUpperCase() !== want.type) throw shapeError(`column ${want.name} type ${got.type || "(none)"} ≠ ${want.type}`);
    if (got.notnull !== 1) throw shapeError(`column ${want.name} is nullable`);
    if (got.pk !== want.pk) throw shapeError(`column ${want.name} pk position ${got.pk} ≠ ${want.pk} (PRIMARY KEY must be (namespace, value))`);
    const gotDflt = got.dflt_value === null ? null : String(got.dflt_value).trim();
    if (gotDflt !== want.dflt) throw shapeError(`column ${want.name} default ${gotDflt ?? "(none)"} ≠ ${want.dflt ?? "(none)"}`);
  }

  // CHECK constraint — pragma_table_info does not expose CHECKs; read the
  // stored CREATE TABLE text and normalise whitespace/case.
  const ddlRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(COMPANY_TAXONOMY_TABLE) as { sql: string } | undefined;
  const ddl = (ddlRow?.sql ?? "").replace(/\s+/g, "").toLowerCase();
  if (!ddl.includes("check(activein(0,1))")) throw shapeError("missing CHECK (active IN (0, 1))");
}

/** Index contract — by name AND by definition (IF NOT EXISTS keeps a same-named index with the wrong shape). */
export function verifyCompanyTaxonomyIndexes(db: TaxonomyDbLike): void {
  const idx = db.prepare(`SELECT name, "unique" AS uniq FROM pragma_index_list(?)`)
    .all(COMPANY_TAXONOMY_TABLE) as Array<{ name: string; uniq: number }>;
  const ux = idx.find((i) => i.name === COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX);
  if (!ux) throw shapeError(`missing index ${COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX}`);
  if (ux.uniq !== 1) throw shapeError(`${COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX} is not UNIQUE`);
  const uxCols = db.prepare(`SELECT name, coll FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`)
    .all(COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX) as Array<{ name: string; coll: string }>;
  if (uxCols.length !== 2 || uxCols[0].name !== "namespace" || uxCols[1].name !== "label"
      || String(uxCols[1].coll).toUpperCase() !== "NOCASE") {
    throw shapeError(`${COMPANY_TAXONOMY_UNIQUE_LABEL_INDEX} must be (namespace, label COLLATE NOCASE)`);
  }
  const ax = idx.find((i) => i.name === COMPANY_TAXONOMY_ACTIVE_INDEX);
  if (!ax) throw shapeError(`missing index ${COMPANY_TAXONOMY_ACTIVE_INDEX}`);
  const axCols = db.prepare(`SELECT name FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`)
    .all(COMPANY_TAXONOMY_ACTIVE_INDEX) as Array<{ name: string }>;
  if (axCols.length !== 2 || axCols[0].name !== "namespace" || axCols[1].name !== "active") {
    throw shapeError(`${COMPANY_TAXONOMY_ACTIVE_INDEX} must be (namespace, active)`);
  }
}

/**
 * Throws unless every one of the 45 seed VALUES is present in the
 * company_sector namespace. Presence, not count, is the invariant: an admin
 * may legitimately have ADDED terms (count > 45) or RETIRED some (active = 0
 * still counts as present). A seed value that is absent means the seed did
 * not run, or someone deleted a row — both are bootstrap failures.
 */
export function verifyCompanyTaxonomySeed(db: TaxonomyDbLike): { present: number; expected: number } {
  const rows = db
    .prepare(`SELECT value FROM ${COMPANY_TAXONOMY_TABLE} WHERE namespace = ?`)
    .all(COMPANY_SECTOR_NAMESPACE) as Array<{ value: string }>;
  const have = new Set(rows.map((r) => r.value));
  const missing = COLLECTIVE_SECTORS_45.filter((v) => !have.has(v));
  if (missing.length) {
    throw new TaxonomyBootstrapError(
      "SEED_INCOMPLETE",
      `${COMPANY_SECTOR_NAMESPACE} seed incomplete: ${missing.length} of ${COLLECTIVE_SECTORS_45.length} values missing`,
      missing.join(" | "),
    );
  }
  return { present: COLLECTIVE_SECTORS_45.length, expected: COLLECTIVE_SECTORS_45.length };
}

export interface ApplyCompanyTaxonomySchemaOptions {
  /** Test seam: override how the migration SQL is located. Default reads the mirrors. */
  readSql?: () => string | null;
  /** Test seam: override the dialect probe. Default `isSqlite()` from server/db/portable. */
  dialectIsSqlite?: () => boolean;
}

/**
 * Apply-then-verify. The migration is IF NOT EXISTS / ON CONFLICT DO NOTHING
 * throughout, so it is ALWAYS executed (D-B1): a table that already exists
 * still gets its indexes (re)asserted and its seed (re)asserted, and a missing
 * deploy artifact is a failure on every path, not only on a fresh database.
 *
 * ATOMIC: the whole script runs inside one SAVEPOINT on the caller's handle.
 * A failure after the first successful statement rolls the script back — no
 * half-installed table can survive to make the next call skip the repair.
 * (SAVEPOINT rather than BEGIN so this also works if a caller is already in a
 * transaction.) The full physical contract + seed presence are VERIFIED
 * INSIDE the same savepoint, before RELEASE; any verification failure rolls
 * the script's writes back too, so a rejected table never keeps seed rows.
 * THROWS on any failure. Never swallows.
 */
export function applyCompanyTaxonomySchema(
  db: TaxonomyDbLike,
  opts: ApplyCompanyTaxonomySchemaOptions = {},
): { applied: boolean; seed: { present: number; expected: number } } {
  const dialectIsSqlite = opts.dialectIsSqlite ?? isSqlite;
  if (!dialectIsSqlite()) {
    throw new TaxonomyBootstrapError(
      "UNSUPPORTED_DB_DIALECT",
      "company taxonomy is verified for SQLite only in this wave; the PostgreSQL path is not claimed",
    );
  }

  const sql = (opts.readSql ?? readCompanyTaxonomyMigrationSql)();
  if (!sql) {
    throw new TaxonomyBootstrapError(
      "MIGRATION_SQL_MISSING",
      `${COMPANY_TAXONOMY_MIGRATION_BASENAME} not found in server/db/migrations or migrations`,
    );
  }

  const existedBefore = tableExists(db);
  // A pre-existing table is checked against the table-level contract BEFORE the
  // script runs: the migration cannot repair a wrong PK / CHECK / column set, so
  // the precise TABLE_SHAPE_MISMATCH is reported rather than the script's own
  // abort. (Indexes are verified after the run, inside the savepoint — IF NOT EXISTS may add them.)
  if (existedBefore) verifyCompanyTaxonomyColumns(db);
  const sp = "sp_slide13b_taxonomy_0236";
  // Script AND every verification (columns, CHECK, indexes, seed) run INSIDE
  // the savepoint. Any failure — execution or verification — rolls the whole
  // savepoint back, so a table that fails the contract never keeps rows the
  // script inserted (the reviewer's repro: wrong unique index, TABLE_SHAPE_MISMATCH
  // thrown, yet 45 seed rows committed). RELEASE happens only after all checks.
  db.exec(`SAVEPOINT ${sp}`);
  const rollback = () => {
    try { db.exec(`ROLLBACK TO SAVEPOINT ${sp}`); db.exec(`RELEASE SAVEPOINT ${sp}`); } catch { /* handle already unusable */ }
  };
  try {
    db.exec(sql);
  } catch (err) {
    rollback();
    throw new TaxonomyBootstrapError(
      "MIGRATION_EXEC_FAILED",
      `${COMPANY_TAXONOMY_MIGRATION_BASENAME} failed to execute; rolled back`,
      err instanceof Error ? err.message : String(err),
    );
  }
  let seed: { present: number; expected: number };
  try {
    verifyCompanyTaxonomyTable(db);
    seed = verifyCompanyTaxonomySeed(db);
  } catch (err) {
    rollback();
    throw err; // TaxonomyBootstrapError (TABLE_SHAPE_MISMATCH / SEED_INCOMPLETE), now with nothing committed
  }
  db.exec(`RELEASE SAVEPOINT ${sp}`);
  return { applied: !existedBefore, seed };
}
