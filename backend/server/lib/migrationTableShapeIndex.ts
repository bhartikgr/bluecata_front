// server/lib/migrationTableShapeIndex.ts
//
// WAVE 13 — the permanent anti-collision index for numbered migrations.
//
// WHY THIS EXISTS
//   Every `CREATE TABLE IF NOT EXISTS` in this tree is a silent no-op when the
//   table already exists. That is what hid the WAVE 13 defect for two waves:
//   migration 0153 creates `partner_subscription` with (partner_id, cadence, …)
//   and 0167 creates it again with (subject_kind, subject_id, cycle, …). 0153
//   runs first, so 0167's CREATE does nothing, its two subject-keyed indexes are
//   downgraded to "skipped perf index" warnings by the runner, the migration
//   chain exits 0, and the whole partner subscription path is left pointing at
//   columns that do not exist on a fresh database.
//
//   A migration alone cannot prevent the NEXT one of these. This module is the
//   machine-readable ground truth a test can assert against: which table names
//   are declared by more than one migration, and whether those declarations
//   agree on their column set.
//
// SCOPE: static text analysis of the .sql files only. No database is opened
// here — the empirical half (does the FINAL applied shape match the LAST
// declaration?) lives in the guard test, which applies the chain for real.
import fs from "node:fs";
import path from "node:path";

export interface TableDeclaration {
  /** Migration filename, e.g. `0167_wave11_partner_subscription_engine.sql`. */
  file: string;
  /** Table name exactly as declared. */
  table: string;
  /** Declared column names, sorted, so two declarations compare by set. */
  columns: string[];
  /** `true` when the declaration used `IF NOT EXISTS` (i.e. can silently no-op). */
  ifNotExists: boolean;
}

export interface ShapeCollision {
  table: string;
  declarations: TableDeclaration[];
  /** Distinct column-set fingerprints across the declarations. */
  fingerprints: string[];
}

/** Strip block and line comments so commented-out DDL is never indexed. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Column names declared in a `CREATE TABLE ( … )` body. Table-level constraints
 * (PRIMARY KEY / UNIQUE / CHECK / FOREIGN KEY / CONSTRAINT) are not columns and
 * are skipped, so a CHECK-only difference does not read as a shape difference.
 */
export function parseColumnNames(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  let inString = false;
  for (const ch of body) {
    if (inString) {
      buf += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) parts.push(buf);

  const cols: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (t.length === 0) continue;
    if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i.test(t)) continue;
    const m = /^["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/.exec(t);
    if (m) cols.push(m[1]);
  }
  return cols.sort();
}

/** Every `CREATE TABLE` in one SQL text, with its declared column set. */
export function extractTableDeclarations(sql: string, file: string): TableDeclaration[] {
  const src = stripSqlComments(sql);
  const out: TableDeclaration[] = [];
  const re =
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const ifNotExists = Boolean(m[1]);
    const table = m[2];
    // Walk to the paren that closes the column list.
    let i = re.lastIndex;
    let depth = 1;
    let inString = false;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (inString) {
        if (ch === "'") inString = false;
      } else if (ch === "'") inString = true;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, Math.max(re.lastIndex, i - 1));
    out.push({ file, table, columns: parseColumnNames(body), ifNotExists });
  }
  return out;
}

/** Sorted list of `NNNN_*.sql` migration filenames in `dir`. */
export function listMigrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4,}_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
}

/** All table declarations across the whole migration directory, in apply order. */
export function buildDeclarationIndex(dir: string): TableDeclaration[] {
  const out: TableDeclaration[] = [];
  for (const f of listMigrationFiles(dir)) {
    out.push(...extractTableDeclarations(fs.readFileSync(path.join(dir, f), "utf8"), f));
  }
  return out;
}

export function fingerprint(columns: string[]): string {
  return columns.join(",");
}

/**
 * Table names declared by more than one migration with DIFFERING column sets.
 * A table declared twice identically is harmless (the second CREATE really is a
 * no-op and nothing is hidden); a table declared twice with different columns
 * means one declaration is silently losing.
 */
export function findShapeCollisions(dir: string): ShapeCollision[] {
  const byTable = new Map<string, TableDeclaration[]>();
  for (const d of buildDeclarationIndex(dir)) {
    const list = byTable.get(d.table);
    if (list) list.push(d);
    else byTable.set(d.table, [d]);
  }
  const out: ShapeCollision[] = [];
  // `Array.from` rather than spread: this tree targets a downlevel iteration
  // mode where spreading a Map/Set iterator is a compile error (TS2802).
  const entries: Array<[string, TableDeclaration[]]> = Array.from(byTable.entries());
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [table, declarations] of entries) {
    if (declarations.length < 2) continue;
    const fingerprints: string[] = Array.from(
      new Set(declarations.map((d) => fingerprint(d.columns))),
    );
    if (fingerprints.length < 2) continue;
    out.push({ table, declarations, fingerprints });
  }
  return out;
}
