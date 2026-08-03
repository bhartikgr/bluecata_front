/**
 * Wave 0 lint helpers — robust SQL parsing and REPLACE detection.
 *
 * Every helper here is exercised by positive (should-fire) and negative
 * (should-not-fire) fixtures at the bottom of each consuming lint file.
 * Any regression in these helpers has to break a positive fixture that a
 * subsequent reviewer will catch.
 */

import fs from "fs";
import path from "path";

// ── SQL comment stripping ──────────────────────────────────────────────
// Different rules for .ts vs .sql:
//   .sql: `--` starts a line comment; `/* ... */` block comment.
//   .ts:  `//` starts a line comment; `/* ... */` block comment. NEVER `--`
//         (that's decrement).
// The stripper must NOT convert a `--` that appears mid-line in .ts or a `//`
// that appears inside a SQL string literal in .sql. Simpler is safer: strip
// per-language only what unambiguously starts at column 0 or after whitespace.

export function stripCommentsByLang(text: string, lang: "ts" | "sql"): string {
  // Strip block comments first (same in both languages).
  let s = text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (lang === "sql") {
    // SQL: -- line comment. Must be preceded by whitespace or start-of-line;
    // this avoids mangling identifiers like `col-- inside string` (though
    // that is unusual). Consumes to end of line.
    s = s.replace(/(^|[\s])--[^\n]*/g, "$1");
  } else {
    // TS: // line comment. Must be preceded by whitespace or start-of-line;
    // avoids mangling `x.split("//")` etc. If `//` appears inside a string
    // literal on the same line as SQL, this rule leaves it alone.
    s = s.replace(/(^|[\s])\/\/[^\n]*/g, "$1");
  }
  return s;
}

// ── REPLACE detection ──────────────────────────────────────────────────
// Match all forms the reviewers named:
//   INSERT OR REPLACE INTO <t>        (canonical)
//   INSERT OR REPLACE <t>             (INTO omitted — SQLite allows in some paths)
//   REPLACE INTO <t>                  (bare REPLACE)
//   REPLACE <t>                       (bare REPLACE, INTO omitted)
// Target can be:
//   ident         → \w+
//   "ident"       → double-quoted
//   `ident`       → backtick-quoted
//   [ident]       → bracket-quoted (SQL Server compat, but SQLite accepts it)
//   schema.table  → dotted (unqualified last segment wins for classification)
//   ${expr}       → dynamic → target === null (HARD FAIL under the new rules)
//
// Newlines between tokens are permitted (\s covers \n).
// A REPLACE statement starter is one of:
//   INSERT OR REPLACE   (canonical statement prefix)
//   REPLACE INTO        (bare form; INTO always present here)
// This deliberately excludes `REPLACE(str, from, to)` (the SQL scalar
// function) and `str.replace(...)` (the JavaScript String method) because
// those are followed by `(`, not an identifier.
//
// A previous attempt allowed bare `REPLACE <ident>` to catch INTO-less forms,
// but SQLite requires INTO for the bare-REPLACE statement form; the earlier
// broadness produced dozens of false positives on `.replace(...)` calls. If
// SQLite ever accepts bare `REPLACE <ident>` in a future version, add a new
// starter clause here and cover it with a positive fixture.
const REPLACE_STARTERS_RE = /\b(?:INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/gi;

// After a starter, we look for the target. INTO is already consumed by the
// starter regex in the REPLACE-INTO case; the INSERT-OR-REPLACE case may or
// may not have INTO next (SQLite accepts INSERT OR REPLACE with INTO required
// per the grammar, but be defensive).
const TARGET_RE = /^(?:\s+INTO)?\s+(?:(?:(\w+)\s*\.\s*)?(?:(\w+)|"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|\$\{[^}]+\}))/i;

export interface ReplaceHit {
  file: string;
  line: number;
  keyword: string;
  targetTable: string | null; // null if dynamic (${...}) or unresolved
  snippet: string;
}

export function findReplaceHits(text: string, file: string, lang: "ts" | "sql"): ReplaceHit[] {
  const stripped = stripCommentsByLang(text, lang);
  const hits: ReplaceHit[] = [];
  let m: RegExpExecArray | null;
  REPLACE_STARTERS_RE.lastIndex = 0;
  while ((m = REPLACE_STARTERS_RE.exec(stripped)) !== null) {
    const start = m.index;
    const kwLen = m[0].length;
    const tail = stripped.slice(start + kwLen);
    const tm = TARGET_RE.exec(tail);
    let target: string | null = null;
    if (tm) {
      // schema.table: prefer the unqualified table (last segment).
      target = tm[2] ?? tm[3] ?? tm[4] ?? tm[5] ?? null;
      // If schema-qualified with a dotted second identifier that was captured
      // as tm[1] followed by tm[2]/tm[3]/tm[4]/tm[5], the last-segment target
      // is already correct.
    }
    // If the target regex didn't match at all, or matched but returned no
    // resolvable identifier (the ${...} branch), target is null.
    const lineStart = stripped.lastIndexOf("\n", start) + 1;
    const lineEnd = stripped.indexOf("\n", start);
    const snippet = stripped
      .slice(lineStart, lineEnd < 0 ? stripped.length : lineEnd)
      .trim();
    const lineNo = stripped.slice(0, start).split("\n").length;
    hits.push({
      file,
      line: lineNo,
      keyword: m[0].toUpperCase().replace(/\s+/g, " "),
      targetTable: target ? target.toLowerCase() : null,
      snippet,
    });
  }
  return hits;
}

// ── SQL table parsing ──────────────────────────────────────────────────
// Robust enough to handle:
//   ) STRICT;                         (canonical)
//   ) STRICT WITHOUT ROWID;           (v3.37+ combination, either order)
//   ) WITHOUT ROWID, STRICT;
//   ) STRICT, WITHOUT ROWID;
//   );                                (non-STRICT)
//   ) WITHOUT ROWID;                  (non-STRICT + WITHOUT ROWID)
// Also columns without a declared type (rare but legal, e.g. rowid alias).

export interface ParsedColumn {
  name: string;
  typeText: string; // "" if no type declared
  raw: string;
}

export interface ParsedTable {
  file: string;
  table: string;
  isStrict: boolean;
  withoutRowid: boolean;
  columns: ParsedColumn[];
  rawBody: string;
  rawTail: string; // everything from `)` to `;` — for extra assertions
}

const TABLE_START_RE = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:["`]?)(\w+)(?:["`]?)\s*\(/gi;

export function parseTables(sql: string, file: string, lang: "ts" | "sql"): ParsedTable[] {
  const stripped = stripCommentsByLang(sql, lang);
  const tables: ParsedTable[] = [];
  let m: RegExpExecArray | null;
  TABLE_START_RE.lastIndex = 0;
  while ((m = TABLE_START_RE.exec(stripped)) !== null) {
    const table = m[1];
    const bodyStart = m.index + m[0].length; // position just after `(`
    // Walk to the matching `)` respecting parentheses.
    let depth = 1;
    let i = bodyStart;
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (depth !== 0) continue; // unbalanced; skip
    const body = stripped.slice(bodyStart, i - 1); // content between ( )
    // Now read the trailing table options up to `;` or the next `CREATE`
    // or backtick (inline TS array).
    const tailEnd = (() => {
      const semi = stripped.indexOf(";", i);
      const nextTick = stripped.indexOf("`", i);
      const nextCreate = stripped.slice(i).search(/\bCREATE\b/i);
      const nextCreatePos = nextCreate < 0 ? -1 : i + nextCreate;
      const candidates = [semi, nextTick, nextCreatePos].filter((v) => v >= 0);
      return candidates.length > 0 ? Math.min(...candidates) : stripped.length;
    })();
    const tail = stripped.slice(i, tailEnd);
    const upperTail = tail.toUpperCase();
    const isStrict = /\bSTRICT\b/.test(upperTail);
    const withoutRowid = /\bWITHOUT\s+ROWID\b/.test(upperTail);
    // Split body on top-level commas.
    const parts: string[] = [];
    {
      let d = 0;
      let buf = "";
      for (const ch of body) {
        if (ch === "(") d++;
        else if (ch === ")") d--;
        if (ch === "," && d === 0) {
          parts.push(buf);
          buf = "";
        } else {
          buf += ch;
        }
      }
      if (buf.trim()) parts.push(buf);
    }
    const columns: ParsedColumn[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i.test(trimmed)) continue;
      // Column declaration: <name> [<type>] [<constraints...>]
      // NOTE: `trimmed` may contain newlines when a column's CHECK clause
      // spans multiple lines. Use [\s\S] instead of the `s` flag so we
      // remain compatible with es2017 targets (the /s flag needs es2018).
      const nameM = /^(?:["`]?)(\w+)(?:["`]?)\s*([\s\S]*)$/.exec(trimmed);
      if (!nameM) continue;
      const rest = nameM[2].trim();
      const typeM = /^([A-Z][A-Z0-9]*)/i.exec(rest);
      columns.push({
        name: nameM[1],
        typeText: typeM ? typeM[1].toUpperCase() : "",
        raw: trimmed,
      });
    }
    tables.push({
      file,
      table,
      isStrict,
      withoutRowid,
      columns,
      rawBody: body,
      rawTail: tail,
    });
    // Advance past the `);` so we can find the next CREATE TABLE.
    TABLE_START_RE.lastIndex = tailEnd;
  }
  return tables;
}

// ── File walking ───────────────────────────────────────────────────────

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

// ── Inline apply-function SQL extraction ───────────────────────────────

export function collectInlineApplyFunctions(
  connectionTsPath: string,
): Array<{ file: string; sql: string }> {
  const src = fs.readFileSync(connectionTsPath, "utf8");
  const out: Array<{ file: string; sql: string }> = [];
  const fnRe = /function\s+(applyWave0[A-Za-z]+Schema)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src)) !== null) {
    const fnName = m[1];
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push({
      file: `server/db/connection.ts::${fnName}`,
      sql: src.slice(m.index + m[0].length, i - 1),
    });
  }
  return out;
}
