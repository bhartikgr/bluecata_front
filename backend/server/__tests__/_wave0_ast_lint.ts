/**
 * Wave 0 AST-based lint helpers.
 *
 * v3 (Path A): replace regex-based SQL parsing with node-sql-parser, and use
 * the TypeScript Compiler API to walk template-literal SQL inside .ts files.
 * v1/v2 regex approaches failed triple-review with three rounds of new
 * bypasses; grammar-based parsing eliminates the class of defect.
 *
 * Approach:
 *   1. For .sql files → node-sql-parser directly.
 *   2. For .ts files → walk the AST, find every template-literal string that
 *      begins with a SQL keyword we care about (CREATE TABLE / INSERT /
 *      REPLACE), and hand its text to node-sql-parser. Interpolated
 *      ${...} regions are replaced with a sentinel identifier
 *      `__WAVE0_DYN_<n>__` before parsing so the AST records the position
 *      but the parser sees a valid identifier. The lint then checks whether
 *      any statement uses a sentinel as its target table (=> dynamic).
 *   3. Pre-normalize SQLite bracket identifiers `[foo]` → `` `foo` `` because
 *      node-sql-parser follows standard SQL and doesn't accept them.
 *
 * All returned data is grammar-derived, so string-literal contents, comment
 * positions, comment content, escaped quotes, and identifier quoting can no
 * longer defeat the lint.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";
import { Parser } from "node-sql-parser";

const parser = new Parser();
const OPTS = { database: "SQLite" as const };

const DYN_SENTINEL_PREFIX = "__wave0_dyn_";

// ── Text normalization ────────────────────────────────────────────────

/** Convert SQLite bracket identifiers `[foo]` → `` `foo` ``. Leaves other
 * brackets alone (only after CREATE TABLE / INSERT INTO / UPDATE / REPLACE
 * INTO / FROM / JOIN / REFERENCES to avoid rewriting genuine array indexing
 * inside expressions). Safe because bracket identifiers only make sense in
 * these positions in SQLite DDL/DML. */
function normalizeBrackets(sql: string): string {
  return sql.replace(
    /(\b(?:INTO|FROM|JOIN|TABLE|REFERENCES|UPDATE)\s+)\[([^\]]+)\]/gi,
    (_m, prefix, ident) => `${prefix}\`${ident}\``,
  );
}

/** Replace ${...} interpolations with unique sentinel identifiers.
 *  Returns the resulting SQL text and a list of sentinel names in the order
 *  they appeared. */
function substituteInterpolations(sql: string): {
  sql: string;
  sentinels: string[];
} {
  const sentinels: string[] = [];
  const out = sql.replace(/\$\{[^}]+\}/g, () => {
    const name = `${DYN_SENTINEL_PREFIX}${sentinels.length}__`;
    sentinels.push(name);
    return name;
  });
  return { sql: out, sentinels };
}

/** Substitute SQLite bind parameters (`?`, `?N`, `:name`, `@name`, `$name`)
 *  with numeric literals so node-sql-parser can accept them in positions
 *  where it only expects numbers (LIMIT, OFFSET). Preserves string literals
 *  and comments unchanged. */
function substituteBindParameters(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    // `?` positional (?, ?1, ?N)
    if (ch === "?") {
      let j = i + 1;
      while (j < n && /\d/.test(sql[j])) j++;
      out += "0";
      i = j;
      continue;
    }
    // `:name` / `@name` / `$name`
    if ((ch === ":" || ch === "@" || ch === "$") && /[A-Za-z_]/.test(next ?? "")) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      out += "0";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ── SQL parsing ───────────────────────────────────────────────────────

export interface ParsedStatement {
  file: string;
  raw: string;
  ast: any;
}

/** Parse a SQL blob into an array of top-level statements.
 *  Uses node-sql-parser's `astify`, which handles multi-statement input.
 *  Returns [] on parse failure and does not throw. */
/** ParsedStatement now carries an `unparsed` marker when node-sql-parser
 *  could not parse a statement. Consumers MUST treat unparsed statements as
 *  offenders (silent drop was v3's blocker). A regex fallback attempts to
 *  extract at least the REPLACE target so denylist checks still catch
 *  money-table hits even when the parser gives up. */
export interface UnparsedStatement extends ParsedStatement {
  unparsed: true;
  parseError: string;
  fallbackReplaceTarget: string | null;
  fallbackReplaceIsDynamic: boolean;
}

/** Pre-transform SQLite constructs that node-sql-parser rejects but should
 *  still be seen as their underlying statement kind:
 *    • `INSERT ... ON CONFLICT (...) DO UPDATE ...`  → strip the ON CONFLICT tail.
 *    • `INSERT ... ON CONFLICT DO NOTHING`  → strip.
 *    • `... RETURNING ...`  → strip the RETURNING tail.
 *  This is a semantic-preserving transformation for the lint's purpose
 *  (we only care about the target table + INSERT-vs-REPLACE keyword, not
 *  the conflict resolution semantics). Comment-safe: skip transformations
 *  inside string literals and comments. */
/** Opus v4 B1: cheap invariant that pre-transform never deletes a top-level
 *  `;`-delimited statement. Counts `;` chars outside string/comment context
 *  and asserts the two counts are equal. Runs O(n) on the pre-transformed
 *  and original text. Throws a Wave0PreTransformError with the diff — loud
 *  by construction, unlike the v4 silent-drop channel this replaces. */
export class Wave0PreTransformError extends Error {
  constructor(before: number, after: number, sample: string) {
    super(`preTransformSqliteForParser lost statements: ${before} before, ${after} after. First 200 chars of input: ${JSON.stringify(sample.slice(0, 200))}`);
    this.name = "Wave0PreTransformError";
  }
}

function countTopLevelSemicolons(sql: string): number {
  let n = 0;
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? len : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      i++;
      while (i < len) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === ";") n++;
    i++;
  }
  return n;
}

function assertPreTransformPreservesStatementCount(before: string, after: string): void {
  const nb = countTopLevelSemicolons(before);
  const na = countTopLevelSemicolons(after);
  if (nb !== na) throw new Wave0PreTransformError(nb, na, before);
}

export function preTransformSqliteForParser(sql: string): string {
  // Fast path.
  if (!/\bON\s+CONFLICT\b|\bRETURNING\b/i.test(sql)) return sql;
  // Tokenize enough to skip string/comment content and track paren depth
  // so we never strip ON CONFLICT / RETURNING that appears INSIDE a paren
  // pair (Gemini v4 file-truncation defect).
  let out = "";
  let i = 0;
  let parenDepth = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // Line comment.
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Block comment.
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // String literals.
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === quote) {
          // SQL doubled-quote escape.
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    // ON CONFLICT tail vs. in-paren column constraint.
    // Opus v4 B1: if we're inside a paren pair (parenDepth > 0), this is a
    // COLUMN CONSTRAINT `ON CONFLICT <action>` where <action> is one of
    // ROLLBACK/ABORT/FAIL/IGNORE/REPLACE. Strip in place (replace those
    // three tokens with spaces of the same length) so the parser sees
    // `col INTEGER UNIQUE` instead of `col INTEGER UNIQUE ON CONFLICT REPLACE`.
    // Length-preserving so downstream line/column accounting is unaffected.
    // Opus V4-M1: use a wider window so `ON\n   CONFLICT` (line break
    // between keywords) is still detected.
    if ((ch === "O" || ch === "o") && /^ON\s+CONFLICT\b/i.test(sql.slice(i, i + 200))) {
      if (parenDepth > 0) {
        // Match ON CONFLICT <action> where action is a single keyword.
        const m = /^ON\s+CONFLICT\s+(ROLLBACK|ABORT|FAIL|IGNORE|REPLACE)\b/i.exec(sql.slice(i));
        if (m) {
          out += " ".repeat(m[0].length);
          i += m[0].length;
          continue;
        }
        // If the shape is unexpected, don't touch it — the parser will
        // surface it as an unparsed statement and R6 will classify.
        out += ch;
        i++;
        continue;
      }
      let depth = 0;
      let j = i;
      while (j < n) {
        const c = sql[j];
        const nx = sql[j + 1];
        if (c === "'" || c === '"' || c === "`") {
          // Skip through string literal.
          const q = c;
          j++;
          while (j < n) {
            if (sql[j] === q) {
              if (sql[j + 1] === q) { j += 2; continue; }
              j++;
              break;
            }
            j++;
          }
          continue;
        }
        if (c === "-" && nx === "-") {
          const end = sql.indexOf("\n", j);
          j = end === -1 ? n : end;
          continue;
        }
        if (c === "/" && nx === "*") {
          const end = sql.indexOf("*/", j + 2);
          j = end === -1 ? n : end + 2;
          continue;
        }
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === ";" && depth === 0) break;
        j++;
      }
      // Replace the tail with a semicolon-preserving no-op so structure holds.
      // (We inject a single space; the semicolon or EOF that terminates the
      // statement is preserved as the outer loop.)
      out += " ";
      i = j;
      continue;
    }
    // RETURNING tail.
    if ((ch === "R" || ch === "r") && /^RETURNING\b/i.test(sql.slice(i, i + 10))) {
      if (parenDepth > 0) {
        out += ch;
        i++;
        continue;
      }
      let depth = 0;
      let j = i;
      while (j < n) {
        const c = sql[j];
        if (c === "'" || c === '"' || c === "`") {
          const q = c; j++;
          while (j < n) {
            if (sql[j] === q) {
              if (sql[j + 1] === q) { j += 2; continue; }
              j++; break;
            }
            j++;
          }
          continue;
        }
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === ";" && depth === 0) break;
        j++;
      }
      out += " ";
      i = j;
      continue;
    }
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ";") parenDepth = 0; // statement boundary resets depth
    out += ch;
    i++;
  }
  return out;
}

function parseSql(sql: string, file: string): ParsedStatement[] {
  // Opus v4 B1: preserve statement count under pre-transform. Compare the
  // number of top-level `;`s outside strings/comments before and after.
  const normalized = preTransformSqliteForParser(normalizeBrackets(sql));
  assertPreTransformPreservesStatementCount(sql, normalized);
  // Substitute template interpolations FIRST (they use ${...}), then bind
  // parameters. Reversing this order would let `substituteBindParameters`
  // consume the `${` prefix as a `$name` bind parameter.
  const substituted = substituteInterpolations(normalized);
  substituted.sql = substituteBindParameters(substituted.sql);
  let ast: any;
  try {
    ast = parser.astify(substituted.sql, OPTS);
  } catch (e: any) {
    // Fail loud: return per-statement results, marking each unparseable
    // statement as `unparsed: true` with its error string. Consumers can
    // decide whether to treat parse failure as an offender.
    return parseSqlPerStatement(substituted.sql, file);
  }
  const list = Array.isArray(ast) ? ast : [ast];
  return list.map((a) => ({ file, raw: substituted.sql, ast: a }));
}

/** Conservative regex fallback for REPLACE detection when the parser fails.
 *  Matches `INSERT OR REPLACE INTO <ident>` and `REPLACE INTO <ident>` on
 *  the trimmed statement head, respecting bracket / double-quote / backtick
 *  identifier quoting and dotted schema. Returns `{table, isDynamic}` or
 *  null if no REPLACE is found. */
export function fallbackDetectReplace(sql: string): { table: string | null; isDynamic: boolean } | null {
  // Normalize bracket idents (already done upstream in parseSql, but do it
  // again in case the caller passes raw text).
  const s = normalizeBrackets(sql);
  // Head starter: INSERT OR REPLACE INTO ... | REPLACE INTO ...
  const starter = /\b(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+(?:([A-Za-z_][\w]*|"[^"]+"|`[^`]+`)\s*\.\s*)?([A-Za-z_][\w]*|"[^"]+"|`[^`]+`|\$\{[^}]+\}|__wave0_dyn_\d+__)/i;
  const m = starter.exec(s);
  if (!m) return null;
  const raw = m[2];
  if (!raw) return { table: null, isDynamic: true };
  if (/^\$\{/.test(raw) || /^__wave0_dyn_\d+__$/.test(raw)) {
    return { table: null, isDynamic: true };
  }
  // Strip quoting.
  const unquoted = raw.replace(/^["`]|["`]$/g, "");
  return { table: unquoted.toLowerCase(), isDynamic: false };
}

function parseSqlPerStatement(sql: string, file: string): ParsedStatement[] {
  const out: ParsedStatement[] = [];
  // Split at semicolons not inside string literals or comments.
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBlockComment = false;
  let inLineComment = false;
  const flush = () => {
    const trimmed = buf.trim();
    buf = "";
    if (!trimmed) return;
    try {
      // Same ordering as parseSql: interpolations first, binds second.
      const step1 = preTransformSqliteForParser(trimmed);
      assertPreTransformPreservesStatementCount(trimmed, step1);
      const step2 = substituteInterpolations(step1).sql;
      const preprocessed = substituteBindParameters(step2);
      const stmts = parser.astify(preprocessed + ";", OPTS);
      for (const a of Array.isArray(stmts) ? stmts : [stmts]) {
        out.push({ file, raw: trimmed, ast: a });
      }
    } catch (e: any) {
      // v4 fix (all v3 reviewers): parse failure MUST fail loud. Emit an
      // unparsed marker with the error text and a regex-fallback REPLACE
      // target so denylist checks still fire on money tables even when the
      // parser rejects the surrounding statement (e.g. WITH ... INSERT OR
      // REPLACE INTO payment_ledger, or INSERT ... ON CONFLICT DO UPDATE
      // which node-sql-parser doesn't parse in SQLite mode).
      const fb = fallbackDetectReplace(trimmed);
      const marker: UnparsedStatement = {
        file,
        raw: trimmed,
        ast: null,
        unparsed: true,
        parseError: String(e?.message ?? e).slice(0, 200),
        fallbackReplaceTarget: fb?.table ?? null,
        fallbackReplaceIsDynamic: fb?.isDynamic ?? false,
      };
      out.push(marker);
    }
  };
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && next === "/") {
        buf += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === "-" && next === "-") {
      inLineComment = true;
      buf += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === "/" && next === "*") {
      inBlockComment = true;
      buf += ch;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle;
    else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`") inBacktick = !inBacktick;
    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

export function isUnparsed(s: ParsedStatement): s is UnparsedStatement {
  return (s as UnparsedStatement).unparsed === true;
}

/** GPT-5 v4 B1 fix: exported facade for the R1 test's TS-embedded loop.
 *  Guarantees the same parse-failure-as-signal path as SQL/TS collectors.
 *  Callers pass the extracted SQL text and a synthetic file id for error
 *  attribution; returns ParsedStatement[] which may include UnparsedStatement
 *  markers (with fallbackReplaceTarget populated for money-table denylist
 *  checks). */
export function parseSqlForEmbedded(sql: string, syntheticFileId: string): ParsedStatement[] {
  // Use parseSqlPerStatement so each statement fails independently AND
  // emits an UnparsedStatement carrying fallbackReplaceTarget when the
  // parser rejects it. Do NOT call parser.astify directly — that path
  // silently discards the entire input on any statement's failure.
  const normalized = normalizeBrackets(sql);
  return parseSqlPerStatement(normalized, syntheticFileId);
}

/** GPT-5 v4 B2 fix: descend into CREATE TRIGGER bodies so an INSERT OR
 *  REPLACE targeting a money table INSIDE a trigger body is still detected.
 *  node-sql-parser exposes trigger action statements at `ast.action` or
 *  similar variant paths; we walk defensively and re-run
 *  extractInsertOrReplace on each inner statement wrapped as a synthetic
 *  ParsedStatement. Returns an array so a trigger with multiple inner
 *  writes reports each one. */
export function extractInsertOrReplaceIncludingTriggerBodies(stmt: ParsedStatement): ReplaceInsert[] {
  const out: ReplaceInsert[] = [];
  const top = extractInsertOrReplace(stmt);
  if (top) out.push(top);
  // Only walk parsed statements. UnparsedStatement's fallback already runs
  // in extractInsertOrReplace().
  if (isUnparsed(stmt) || !stmt.ast) return out;
  const a = stmt.ast;
  const type = String(a.type ?? "").toLowerCase();
  if (type !== "create") return out;
  const kw = String(a.keyword ?? "").toLowerCase();
  // Only descend for TRIGGER and VIEW (VIEW can carry INSTEAD OF triggers).
  if (kw !== "trigger" && kw !== "view") return out;
  // Walk any AST subtree looking for insert/replace nodes.
  const visit = (node: any) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    const t = String(node.type ?? "").toLowerCase();
    if (t === "insert" || t === "replace") {
      const synthetic: ParsedStatement = { file: stmt.file, raw: stmt.raw, ast: node };
      const r = extractInsertOrReplace(synthetic);
      if (r) out.push(r);
    }
    for (const key of Object.keys(node)) {
      // Avoid revisiting the top-level node's raw type keys.
      if (key === "parentheses" || key === "loc" || key === "comments") continue;
      visit(node[key]);
    }
  };
  // Common trigger AST shapes across node-sql-parser SQLite dialect:
  visit(a.action);
  visit(a.stmt);
  visit(a.stmts);
  visit(a.body);
  // Fallback: walk the entire AST but skip the top-level (which we've
  // already extracted). This catches any variant shape.
  const seen = new Set<any>();
  const deepVisit = (node: any) => {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    const t = String(node.type ?? "").toLowerCase();
    if ((t === "insert" || t === "replace") && node !== a) {
      const synthetic: ParsedStatement = { file: stmt.file, raw: stmt.raw, ast: node };
      const r = extractInsertOrReplace(synthetic);
      if (r && !out.some((x) => x.table === r.table && x.keyword === r.keyword)) {
        out.push(r);
      }
    }
    if (Array.isArray(node)) {
      for (const child of node) deepVisit(child);
    } else {
      for (const key of Object.keys(node)) {
        if (key === "loc" || key === "comments") continue;
        deepVisit(node[key]);
      }
    }
  };
  deepVisit(a);
  return out;
}

// ── SQL statement classification ──────────────────────────────────────

export interface CreateTable {
  file: string;
  table: string;
  isStrict: boolean;
  withoutRowid: boolean;
  columns: Array<{
    name: string;
    dataType: string;
    notNull: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    referencesTable: string | null;
    referencesColumn: string | null;
    raw: string;
  }>;
  tableUniqueConstraintsOn: string[][]; // list of column-name-lists in table-level UNIQUE(...)
}

export interface ReplaceInsert {
  file: string;
  keyword: "insert-replace" | "replace";
  table: string | null;
  isDynamicTarget: boolean;
  db: string | null;
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return String(name).toLowerCase();
}

function isSentinel(name: string | null): boolean {
  // Opus V4-B6: `startsWith` misses `payment_${shard}` → `payment___wave0_dyn_0__`.
  // `includes` catches any occurrence of the sentinel token inside a
  // constructed identifier. ledger_${tenant}, journal_${x}, and all sharded
  // money-table shapes now classify as dynamic.
  return name !== null && name.includes(DYN_SENTINEL_PREFIX);
}

export function extractCreateTable(stmt: ParsedStatement): CreateTable | null {
  const a = stmt.ast;
  if (!a || a.type !== "create" || a.keyword !== "table") return null;
  const tblEntry = Array.isArray(a.table) ? a.table[0] : a.table;
  const tblName = normalizeName(tblEntry?.table);
  if (!tblName) return null;
  const tableOptions = a.table_options ?? [];
  const opt = new Set(
    tableOptions.map((o: any) => String(o.keyword ?? o.name ?? "").toLowerCase()),
  );
  const isStrict = opt.has("strict");
  const withoutRowid = opt.has("without rowid") || opt.has("without_rowid");

  const defs = a.create_definitions ?? [];
  const columns: CreateTable["columns"] = [];
  const tableUniqueConstraintsOn: string[][] = [];
  for (const def of defs) {
    // Column definition
    if (def && (def.resource === "column" || def.column)) {
      const colName = normalizeName(def.column?.column ?? def.column?.value);
      if (!colName) continue;
      const dataType = String(def.definition?.dataType ?? "").toUpperCase();
      const notNull =
        def.nullable?.type === "not null" ||
        def.nullable?.value === "not null" ||
        def.definition?.notNull === true;
      const isPrimaryKey =
        def.primary_key === "primary key" || def.definition?.primary_key === "primary key";
      const isUnique = def.unique === "unique" || def.unique_or_primary === "unique";
      const ref = def.reference_definition;
      const refTable = ref
        ? normalizeName(
            (Array.isArray(ref.table) ? ref.table[0]?.table : ref.table?.table) ?? null,
          )
        : null;
      const refCol = ref
        ? normalizeName(
            (Array.isArray(ref.definition) ? ref.definition[0]?.column : ref.definition?.column) ??
              null,
          )
        : null;
      columns.push({
        name: colName,
        dataType,
        notNull,
        isPrimaryKey,
        isUnique,
        referencesTable: refTable,
        referencesColumn: refCol,
        raw: JSON.stringify(def), // opaque but useful for debugging
      });
      continue;
    }
    // Table-level constraints
    if (def && def.resource === "constraint" && (def.constraint_type === "unique" || def.constraint_type === "unique key")) {
      const cols = Array.isArray(def.definition) ? def.definition : [def.definition];
      const names = cols
        .map((c: any) => normalizeName(c?.column ?? c?.value))
        .filter((n: string | null): n is string => !!n);
      if (names.length > 0) tableUniqueConstraintsOn.push(names);
    }
  }

  return {
    file: stmt.file,
    table: tblName,
    isStrict,
    withoutRowid,
    columns,
    tableUniqueConstraintsOn,
  };
}

/** Determine whether an insert AST node carries an OR REPLACE conflict clause.
 *  node-sql-parser encodes this differently across dialect / version:
 *    - a.or_action = 'replace'
 *    - a.or = 'replace'
 *    - a.or = [{type:'origin',value:'or'}, {type:'origin',value:'REPLACE'}]
 *    - a.conflict_action = 'replace'
 *    - a.keyword = 'replace'
 *  We check all shapes and match case-insensitively. */
function hasOrReplace(a: any): boolean {
  const asStr = (v: any) => String(v ?? "").toLowerCase();
  if (asStr(a.or_action) === "replace") return true;
  if (asStr(a.on_action) === "replace") return true;
  if (asStr(a.conflict_action) === "replace") return true;
  if (asStr(a.keyword) === "replace") return true;
  const or = a.or;
  if (typeof or === "string" && or.toLowerCase() === "replace") return true;
  if (Array.isArray(or)) {
    for (const el of or) {
      const v = asStr(el?.value ?? el);
      if (v === "replace") return true;
    }
  }
  return false;
}

export function extractInsertOrReplace(stmt: ParsedStatement): ReplaceInsert | null {
  // v4: also honor the regex fallback attached to unparsed statements so
  // WITH ... INSERT OR REPLACE INTO money_table and other parser-defeating
  // shapes still fire the denylist check.
  if (isUnparsed(stmt)) {
    const u = stmt as UnparsedStatement;
    if (u.fallbackReplaceTarget === null && !u.fallbackReplaceIsDynamic) return null;
    return {
      file: stmt.file,
      keyword: "insert-replace",
      table: u.fallbackReplaceIsDynamic ? null : u.fallbackReplaceTarget,
      isDynamicTarget: u.fallbackReplaceIsDynamic,
      db: null,
    };
  }
  const a = stmt.ast;
  if (!a) return null;
  const t = String(a.type ?? "").toLowerCase();
  const isReplace = t === "replace";
  const isInsertOrReplace = t === "insert" && hasOrReplace(a);
  if (!isReplace && !isInsertOrReplace) return null;
  const tblEntry = Array.isArray(a.table) ? a.table[0] : a.table;
  const rawName = tblEntry?.table;
  const table = normalizeName(rawName);
  const isDynamicTarget = table !== null && isSentinel(table);
  return {
    file: stmt.file,
    keyword: isReplace ? "replace" : "insert-replace",
    table: isDynamicTarget ? null : table,
    isDynamicTarget,
    db: normalizeName(tblEntry?.db ?? null),
  };
}

// ── TypeScript AST → embedded SQL ─────────────────────────────────────

/** Walk a .ts file and extract every template-literal string that looks like
 *  SQL (starts with a recognized keyword). Each returned entry has the raw
 *  text with ${...} regions substituted with sentinels, plus its start line
 *  in the original source. */
export interface EmbeddedSql {
  file: string;
  line: number;
  sql: string;
  sentinelCount: number;
}

const SQL_KEYWORDS_HEAD = /^(?:\s|--|\/\*[\s\S]*?\*\/)*(?:CREATE|INSERT|REPLACE|UPDATE|DELETE|SELECT|WITH)\b/i;

/** Method names that indicate a call executes SQL. R3 tightening (Opus v3 J):
 *  we DO NOT rely on the method name alone — that flags Promise.all(), map.get(),
 *  params.get(), etc. Instead we require that the receiver expression involves
 *  a known SQL surface: db, rawDb, sqlite, connection, or a `Statement`-shape
 *  chain like `stmt.run(...)` where `stmt` was returned from `.prepare(...)`.
 *  For simplicity we heuristic-match on the receiver identifier text. */
const SQL_EXECUTOR_METHODS = new Set([
  "prepare",
  "exec",
  "run",
  "raw",
  "query",
  "all",
  "get",
  "execute",
  "pragma",
]);

const DB_RECEIVER_NAMES = new Set([
  "db",
  "rawdb",
  "raw_db",
  "sqlite",
  "conn",
  "connection",
  "database",
]);

/** SQL tag names on tagged template literals: sql\`...\`, Sql\`...\`, etc. */
function isSqlTagName(name: string): boolean {
  return /^sql$|^sql[A-Z_]/i.test(name);
}

function isDbReceiver(expr: ts.Expression): boolean {
  // Legacy narrow receiver check kept for callers that specifically want
  // the strict DB set. Not used by isSqlExecutorCall in v5 — see
  // isDbShapedReceiver above for the widened set.
  if (ts.isIdentifier(expr)) return DB_RECEIVER_NAMES.has(expr.text.toLowerCase());
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return DB_RECEIVER_NAMES.has(expr.expression.text.toLowerCase());
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return DB_RECEIVER_NAMES.has(expr.name.text.toLowerCase());
  }
  return false;
}

/** Opus V4-B4: identify calls that carry executable SQL. The v3 approach
 *  (method name only) had 12 false positives on `Promise.all`, `map.get`,
 *  etc. The v4 tightening (require DB-shaped receiver) removed 56 real
 *  production sites (driver.prepare, adb.prepare, rawTx.prepare, ...).
 *
 *  This v5 shape uses TWO signals:
 *    (a) method name is a SQL executor  (prepare/exec/run/raw/query/all/get/execute/pragma)
 *    (b) the argument shape indicates SQL:
 *         • an argument is a string/template literal whose head passes SQL_KEYWORDS_HEAD, OR
 *         • the receiver is a DB-shaped identifier (`db`, `rawDb`, `driver`, ...)
 *
 *  Rule (b) preserves the R3 false-positive fix (Promise.all(promises) has
 *  no SQL-head arg AND no DB receiver, so it's still ignored) AND restores
 *  the 56 sites (`driver.prepare(\`INSERT ...\`)` has a SQL-head arg). */
// Opus V4-B4 restore + R3 tightening: DB-connection-shaped receivers only.
// stmt/statement/prepared are NOT here — those calls take bind VALUES, not
// SQL text, and including them would cause R3 false positives on every
// `stmt.run(value, value, ...)` call. `tx`/`transaction` are similarly
// excluded since they wrap callback-based transactions.
const RECEIVER_ALLOW_KEYWORDS = /^(?:db|rawdb|raw_db|sqlite|conn|connection|database|driver|adb|rdb|gdb|pdb|raw|rawtx|rawhandle)$/i;

function isDbShapedReceiver(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return RECEIVER_ALLOW_KEYWORDS.test(expr.text.toLowerCase());
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return RECEIVER_ALLOW_KEYWORDS.test(expr.expression.text.toLowerCase());
  }
  if (ts.isPropertyAccessExpression(expr)) {
    // this.db.<method>, thing.database.<method>, chain.driver.<method>
    return RECEIVER_ALLOW_KEYWORDS.test(expr.name.text.toLowerCase()) || isDbShapedReceiver(expr.expression);
  }
  return false;
}

function argumentLooksLikeSql(node: ts.Node): boolean {
  const unwrapped = unwrapExpression(node);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped) || ts.isTemplateExpression(unwrapped)) {
    const text = getTemplateText(unwrapped);
    if (!text) return false;
    const stripped = text.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "");
    return SQL_KEYWORDS_HEAD.test(stripped) || SQL_KEYWORDS_HEAD.test(text);
  }
  return false;
}

function isSqlExecutorCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (!SQL_EXECUTOR_METHODS.has(expr.name.text)) return false;
  // Signal (a): any argument looks like SQL by content.
  // Signal (b): the receiver is DB-shaped.
  // Either signal is sufficient. Both false = ordinary non-SQL call (e.g.
  // Promise.all(promises), map.get(k), stmt.run(cb) where stmt is a bare
  // identifier and cb is a function reference).
  const hasSqlArg = node.arguments.some((a) => argumentLooksLikeSql(a));
  if (hasSqlArg) return true;
  return isDbShapedReceiver(expr.expression);
}

/** Unwrap common expression wrappers to find an underlying template literal.
 *  Opus v3 H: parenthesized, `as string` cast, non-null assertion `!`,
 *  await expression. */
function unwrapExpression(node: ts.Expression | ts.Node): ts.Node {
  let n: ts.Node = node;
  const anyTs: any = ts as any;
  while (true) {
    if (ts.isParenthesizedExpression(n)) n = n.expression;
    else if (ts.isAsExpression(n)) n = n.expression;
    else if (ts.isTypeAssertionExpression(n)) n = n.expression;
    else if (ts.isNonNullExpression(n)) n = n.expression;
    else if (ts.isAwaitExpression(n)) n = n.expression;
    // Gemini v4: SatisfiesExpression (TS 4.9+). Not available on older
    // versions of the TS API; use a duck-typed check.
    else if (typeof anyTs.isSatisfiesExpression === "function" && anyTs.isSatisfiesExpression(n)) {
      n = (n as any).expression;
    }
    else break;
  }
  return n;
}

export interface DynamicSqlSite {
  file: string;
  line: number;
  reason: string;
}

export interface ExtractedFromTs {
  embedded: EmbeddedSql[];
  // Call sites where a SQL executor is invoked with an argument that is NOT
  // a template literal or string literal — e.g. `db.prepare(sql)` where sql
  // is an identifier bound to a string that could have been built with `+`.
  // These are dynamic SQL sites the AST cannot inspect grammatically.
  dynamicSites: DynamicSqlSite[];
}

export function extractSqlFromTs(source: string, file: string): EmbeddedSql[] {
  return extractFromTs(source, file).embedded;
}

export function extractFromTs(source: string, file: string): ExtractedFromTs {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const embedded: EmbeddedSql[] = [];
  const dynamicSites: DynamicSqlSite[] = [];

  const pushEmbedded = (arg: ts.Node, sourceHint: string) => {
    const text = getTemplateText(arg);
    if (!text) return;
    // Trim leading comments/whitespace before matching keywords — e.g.
    // a template that starts with `-- comment\nCREATE ...`.
    const stripped = text.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "");
    if (!SQL_KEYWORDS_HEAD.test(stripped) && !SQL_KEYWORDS_HEAD.test(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(arg.getStart(sf));
    const subst = substituteInterpolations(text);
    embedded.push({
      file,
      line: line + 1,
      sql: subst.sql,
      sentinelCount: subst.sentinels.length,
    });
  };

  const walk = (node: ts.Node) => {
    // Tagged template literal: sql`...`, Sql`...`, and — conservatively —
    // ANY tagged template whose template content starts with a SQL keyword.
    // (Gemini v4: bare `db.query(sql\`...\`)` extracted fine, but
    // `db.tagme\`INSERT ... payment_ledger\`` was invisible because
    // isSqlTagName didn't match.) The keyword-head check keeps false-
    // positives low without depending on tag identifier text.
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      const tagName = ts.isIdentifier(tag)
        ? tag.text
        : ts.isPropertyAccessExpression(tag)
          ? tag.name.text
          : "";
      const templateText = getTemplateText(node.template);
      const hasSqlHead = templateText
        ? SQL_KEYWORDS_HEAD.test(templateText.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, ""))
        : false;
      if (isSqlTagName(tagName) || hasSqlHead) {
        pushEmbedded(node.template, "tagged-template");
      }
    }

    if (isSqlExecutorCall(node)) {
      const call = node as ts.CallExpression;
      // Opus V4-B5: scan ALL arguments, not just [0]. Some overloads accept
      // SQL as the 2nd arg: `db.exec(opts, `INSERT...`)`.
      for (let ai = 0; ai < call.arguments.length; ai++) {
        const rawArg = call.arguments[ai];
        const arg = unwrapExpression(rawArg);
        if (ts.isTemplateExpression(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isStringLiteral(arg)) {
          pushEmbedded(arg, "executor-arg");
        } else if (
          ts.isBinaryExpression(arg) ||
          ts.isIdentifier(arg) ||
          ts.isConditionalExpression(arg) ||
          ts.isElementAccessExpression(arg) ||
          ts.isPropertyAccessExpression(arg) ||
          ts.isCallExpression(arg)
        ) {
          // R3: non-literal argument. Refactor required.
          const { line } = sf.getLineAndCharacterOfPosition(rawArg.getStart(sf));
          dynamicSites.push({
            file,
            line: line + 1,
            reason: `SQL executor call with non-literal argument (${ts.SyntaxKind[arg.kind]}). Refactor to pass a template literal so the lint can inspect the SQL.`,
          });
        } else {
          // Opus V4-B5: explicit fallthrough branch. Any argument shape
          // NOT covered above is reported as a dynamic site so an
          // unhandled TypeScript node kind cannot become invisible
          // (that was v3's `catch {}` mistake, relocated to the walker).
          // Only report for arguments that are neither known-safe
          // (numeric/boolean literal, identifier for options object) nor
          // covered above. We use position 0 as a heuristic: arg[0] must
          // be SQL-shaped for a SQL executor call to make sense.
          if (ai === 0) {
            const { line } = sf.getLineAndCharacterOfPosition(rawArg.getStart(sf));
            dynamicSites.push({
              file,
              line: line + 1,
              reason: `SQL executor call with UNHANDLED argument kind ${ts.SyntaxKind[arg.kind]}. Add support in extractFromTs or refactor call.`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return { embedded, dynamicSites };
}

function getTemplateText(node: ts.Node): string | null {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      s += "${expr}"; // literal marker; substituteInterpolations replaces it
      s += span.literal.text;
    }
    return s;
  }
  return null;
}

// ── Public entry points used by lints ─────────────────────────────────

export function collectSqlStatementsFromSqlFile(file: string): ParsedStatement[] {
  const sql = fs.readFileSync(file, "utf8");
  return parseSql(sql, file);
}

export function collectSqlStatementsFromTsFile(file: string): ParsedStatement[] {
  const source = fs.readFileSync(file, "utf8");
  const { embedded } = extractFromTs(source, file);
  const out: ParsedStatement[] = [];
  for (const e of embedded) {
    const stmts = parseSql(e.sql, `${file}::L${e.line}`);
    for (const s of stmts) out.push(s);
  }
  return out;
}

export function collectDynamicSqlSitesFromTsFile(file: string): DynamicSqlSite[] {
  const source = fs.readFileSync(file, "utf8");
  return extractFromTs(source, file).dynamicSites;
}

export function walkFiles(
  dir: string,
  filterExt: (name: string) => boolean,
  out: string[] = [],
): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "dist", "coverage", ".git", "_presnapshot"].includes(e.name)) continue;
      walkFiles(full, filterExt, out);
    } else if (e.isFile() && filterExt(e.name)) {
      out.push(full);
    }
  }
  return out;
}
