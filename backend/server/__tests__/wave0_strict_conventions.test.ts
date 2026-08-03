/**
 * Wave 0 acceptance gate 0-D — STRICT table conventions.
 *
 * V7 §5.0 pins that every table Wave 0 (and later waves) creates MUST use the
 * SQLite `STRICT` mode. Without STRICT, TEXT columns silently accept integers
 * and vice-versa — a silent-drop hazard for money math.
 *
 * Wave 0 Increment 1 review item 11: the lint scans ALL THREE PLACES the
 * three-place rule governs, not just `migrations/`:
 *   1. `migrations/*.sql`
 *   2. `server/db/migrations/*.sql`
 *   3. SQL string literals in `server/db/connection.ts` (inline apply funcs)
 *
 * Failure names the source (file or inline) and the offending table.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// V7 §5.0 pins Wave 0 migration range as 0121..0128.
const WAVE0_RANGE_START = 121;
const WAVE0_RANGE_END = 128;
const ROOT = path.resolve(__dirname, "../..");

type SqlSource = { source: string; sql: string };

function collectWave0Migrations(subdir: string): SqlSource[] {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const out: SqlSource[] = [];
  for (const f of files) {
    const m = /^(\d{4})_/.exec(f);
    if (!m) continue;
    const id = Number(m[1]);
    if (id >= WAVE0_RANGE_START && id <= WAVE0_RANGE_END) {
      out.push({ source: `${subdir}/${f}`, sql: fs.readFileSync(path.join(dir, f), "utf8") });
    }
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Extract SQL string literals from a TS file that appear inside Wave 0 apply
 * functions. We match template-literal string contents that contain a
 * `CREATE TABLE`. Coarse but sufficient for the three Wave 0 inline schemas.
 */
function collectInlineWave0Sql(): SqlSource[] {
  const src = fs.readFileSync(path.join(ROOT, "server/db/connection.ts"), "utf8");
  const out: SqlSource[] = [];
  // Find each applyWave0<Name>Schema function body.
  const fnRe = /function\s+(applyWave0[A-Za-z]+Schema)\s*\([^)]*\)\s*\{/g;
  let fm: RegExpExecArray | null;
  while ((fm = fnRe.exec(src)) !== null) {
    const fnName = fm[1];
    // Find matching close brace.
    let depth = 1;
    let i = fm.index + fm[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(fm.index + fm[0].length, i - 1);
    // Extract all backtick-quoted template literals containing CREATE TABLE.
    const litRe = /`([^`]*?)`/g;
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(body)) !== null) {
      const sql = lm[1];
      if (/CREATE\s+TABLE/i.test(sql)) {
        out.push({ source: `server/db/connection.ts::${fnName}`, sql });
      }
    }
  }
  return out;
}

function collectAllPlaces(): SqlSource[] {
  return [
    ...collectWave0Migrations("migrations"),
    ...collectWave0Migrations("server/db/migrations"),
    ...collectInlineWave0Sql(),
  ];
}

/**
 * Extract every CREATE TABLE statement body from a SQL blob. Handles multi-line
 * definitions. Returns { name, body } pairs where body is the parenthesised
 * column-list + trailing modifiers (STRICT, WITHOUT ROWID, etc.).
 */
function extractCreateTables(sql: string): Array<{ name: string; trailingModifiers: string }> {
  // Strip line comments so `-- CREATE TABLE ...` in commentary doesn't match.
  const stripped = sql.replace(/--[^\n]*\n/g, "\n");
  const results: Array<{ name: string; trailingModifiers: string }> = [];
  // Match: CREATE TABLE [IF NOT EXISTS] <name> ( ... ) <modifiers>;
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    const openIdx = stripped.indexOf("(", m.index + m[0].length - 1);
    // Find matching close paren respecting nesting.
    let depth = 1;
    let i = openIdx + 1;
    while (i < stripped.length && depth > 0) {
      const c = stripped[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    if (depth !== 0) throw new Error(`unbalanced parens in CREATE TABLE ${name}`);
    // From position i, read until ';' — the trailing modifier region.
    const semi = stripped.indexOf(";", i);
    const trailing = stripped.slice(i, semi < 0 ? stripped.length : semi).trim();
    results.push({ name, trailingModifiers: trailing });
  }
  return results;
}

describe("Wave 0 acceptance 0-D: every Wave 0 CREATE TABLE uses STRICT (three-place scan)", () => {
  const sources = collectAllPlaces();

  it("scans all three places (v3 review Opus M6: self-verifying)", () => {
    // Place 1: migrations/
    const place1 = sources.filter(s => s.source.startsWith("migrations/"));
    expect(place1.length, "place 1 (migrations/) not scanned").toBeGreaterThanOrEqual(3);

    // Place 2: server/db/migrations/
    const place2 = sources.filter(s => s.source.startsWith("server/db/migrations/"));
    expect(place2.length, "place 2 (server/db/migrations/) not scanned").toBeGreaterThanOrEqual(3);

    // Place 3: inline SQL literals in connection.ts — must contain 5 CREATE TABLE
    // literals (1 currency_ref + 2 money core + 2 platform config).
    const place3 = sources.filter(s => s.source.startsWith("server/db/connection.ts::"));
    expect(place3.length, "place 3 (inline connection.ts) not scanned or found no CREATE TABLE").toBe(5);

    // Total: 3 place-1 + 3 place-2 + 5 place-3 = 11 CREATE TABLE sources
    expect(sources.length).toBeGreaterThanOrEqual(11);
  });

  for (const { source, sql } of sources) {
    it(`${source}: every CREATE TABLE ends with STRICT`, () => {
      const tables = extractCreateTables(sql);
      // A Wave 0 migration may legitimately contain no CREATE TABLE if it is
      // a data-repair / seed-update migration (e.g., 0124 flips a seed row and
      // deletes a malformed row — no schema change). Skip those; a schema
      // migration is caught by the >=11 sources aggregate assertion above.
      if (tables.length === 0) return;
      for (const t of tables) {
        expect(t.trailingModifiers.toUpperCase()).toMatch(/\bSTRICT\b/);
      }
    });
  }
});
