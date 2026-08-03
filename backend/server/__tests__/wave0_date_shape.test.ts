/**
 * Wave 0 acceptance gate 0-E — date-shape lint.
 *
 * V7 §5.0 pins that every TEXT column whose name ends `_at` or `_date` MUST
 * carry a CHECK constraint that validates its shape. Rationale: SQLite has no
 * native DATE/DATETIME type; without a CHECK, a stray "not a date" TEXT sneaks
 * in and silently corrupts ordering.
 *
 * Allowed shapes:
 *   `_at` columns  →  ISO-8601 datetime, `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'`
 *   `_date` cols   →  ISO-8601 date only, `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
 *                     PLUS `date(col) = col` round-trip
 *
 * Known weakness (Wave J hardening candidate WAVE0-DEF-DATETIME-ROUNDTRIP):
 *   The `_at` GLOB accepts `2026-01-01Tnonsense` — anything after the `T`
 *   passes. A tighter check would require `datetime(col) IS NOT NULL` or a
 *   full 14-part GLOB. Deferring because it does not affect the Wave 0
 *   invariants (immutability + shape sanity for money math) and would
 *   ripple through every `_at` column added in Waves A-K. Named delivery ID:
 *   WAVE0-DEF-DATETIME-ROUNDTRIP.
 *
 * Wave 0 Increment 1 review item 11: scans all three places, not just migrations/.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Wave 0 Increment 1 review item 11: scan all three places, not just migrations/.
const WAVE0_RANGE_START = 121;
const WAVE0_RANGE_END = 128;
const ROOT = path.resolve(__dirname, "../..");

type SqlSource = { source: string; sql: string };

function collectMigrations(subdir: string): SqlSource[] {
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

function collectInlineWave0Sql(): SqlSource[] {
  const src = fs.readFileSync(path.join(ROOT, "server/db/connection.ts"), "utf8");
  const out: SqlSource[] = [];
  const fnRe = /function\s+(applyWave0[A-Za-z]+Schema)\s*\([^)]*\)\s*\{/g;
  let fm: RegExpExecArray | null;
  while ((fm = fnRe.exec(src)) !== null) {
    const fnName = fm[1];
    let depth = 1;
    let i = fm.index + fm[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(fm.index + fm[0].length, i - 1);
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

function collectWave0Migrations(): SqlSource[] {
  return [
    ...collectMigrations("migrations"),
    ...collectMigrations("server/db/migrations"),
    ...collectInlineWave0Sql(),
  ];
}

/** Extract each CREATE TABLE body block (columns + trailing constraints). */
function extractCreateTableBodies(sql: string): Array<{ name: string; body: string }> {
  const stripped = sql.replace(/--[^\n]*\n/g, "\n");
  const results: Array<{ name: string; body: string }> = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    const openIdx = stripped.indexOf("(", m.index + m[0].length - 1);
    let depth = 1;
    let i = openIdx + 1;
    while (i < stripped.length && depth > 0) {
      const c = stripped[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    if (depth !== 0) throw new Error(`unbalanced parens in CREATE TABLE ${name}`);
    // Body is between openIdx+1 and i-1 (i-1 is the matching close paren).
    const body = stripped.slice(openIdx + 1, i - 1);
    results.push({ name, body });
  }
  return results;
}

/**
 * Return the list of column names in a table body that are TEXT and match the
 * date-shape naming pattern (_at or _date suffix). Rough parser: split on
 * top-level commas, take the first identifier of each line, keep those whose
 * name ends `_at` or `_date` AND whose declaration contains TEXT.
 */
function findDateShapedColumns(body: string): Array<{ name: string; decl: string; suffix: "_at" | "_date" }> {
  // Split on top-level commas (respecting parens).
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));

  const cols: Array<{ name: string; decl: string; suffix: "_at" | "_date" }> = [];
  for (const rawPart of parts) {
    const trimmed = rawPart.trim();
    if (!trimmed) continue;
    // First token must be a bare identifier (not UNIQUE/CHECK/CONSTRAINT/PRIMARY/FOREIGN).
    const idMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s+/.exec(trimmed);
    if (!idMatch) continue;
    const colName = idMatch[1];
    const upper = colName.toUpperCase();
    if (["UNIQUE", "CHECK", "CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE"].includes(upper)) continue;
    // Must be a TEXT column.
    if (!/\bTEXT\b/i.test(trimmed)) continue;
    if (colName.endsWith("_at")) cols.push({ name: colName, decl: trimmed, suffix: "_at" });
    else if (colName.endsWith("_date")) cols.push({ name: colName, decl: trimmed, suffix: "_date" });
  }
  return cols;
}

describe("Wave 0 acceptance 0-E: every _at / _date TEXT column has a shape CHECK", () => {
  const migrations = collectWave0Migrations();

  it("scans all three places (v3 review Opus M6: self-verifying)", () => {
    const place1 = migrations.filter(s => s.source.startsWith("migrations/"));
    const place2 = migrations.filter(s => s.source.startsWith("server/db/migrations/"));
    const place3 = migrations.filter(s => s.source.startsWith("server/db/connection.ts::"));
    expect(place1.length, "place 1 (migrations/) not scanned").toBeGreaterThanOrEqual(3);
    expect(place2.length, "place 2 (server/db/migrations/) not scanned").toBeGreaterThanOrEqual(3);
    expect(place3.length, "place 3 (inline connection.ts) not scanned or found no CREATE TABLE").toBe(5);
    expect(migrations.length).toBeGreaterThanOrEqual(11);
  });

  for (const { source, sql } of migrations) {
    it(`${source}: every _at / _date TEXT column carries a GLOB shape CHECK`, () => {
      const tables = extractCreateTableBodies(sql);
      for (const t of tables) {
        const cols = findDateShapedColumns(t.body);
        for (const c of cols) {
          const decl = c.decl;
          // Every match must have a GLOB check. For _at we accept the datetime
          // shape; for _date we require the date-only shape.
          if (c.suffix === "_at") {
            const okAt =
              /GLOB\s+'\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]T\*'/.test(decl);
            expect(okAt, `${t.name}.${c.name}: missing datetime GLOB CHECK`).toBe(true);
          } else {
            const okDate =
              /GLOB\s+'\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'/.test(decl);
            expect(okDate, `${t.name}.${c.name}: missing date GLOB CHECK`).toBe(true);
            // For _date columns, also require the round-trip `date(col) = col`
            // check per V7 §5.0 (rejects things like '2026-02-30' that pass GLOB
            // but aren't real dates).
            const okRoundTrip = new RegExp(`date\\(${c.name}\\)\\s*=\\s*${c.name}`, "i").test(decl);
            expect(okRoundTrip, `${t.name}.${c.name}: missing date() round-trip CHECK`).toBe(true);
          }
        }
      }
    });
  }
});
