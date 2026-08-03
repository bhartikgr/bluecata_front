/**
 * Wave 0 acceptance gate 0-N — REPLACE-triple pairing lint.
 *
 * V7 §5.0.0 finding "0.9-mut8" (the largest single defect the report found):
 *   `INSERT OR REPLACE` in SQLite silently deletes the existing row without
 *   firing `BEFORE DELETE` triggers when `recursive_triggers = OFF`. Even with
 *   the pragma ON (Wave 0 0-9), REPLACE is a footgun on any table with
 *   immutability, hash-chain, or audit triggers.
 *
 * Wave 0's protection is two-layer:
 *   1. Bootstrap pragma `recursive_triggers = ON` (asserted by 0-A).
 *   2. This lint bans `INSERT OR REPLACE` in every Wave 0 migration and in
 *      every server/lib file added or edited during Wave 0. `REPLACE`
 *      keyword-form (without `INSERT OR`) is also banned.
 *
 * The lint does NOT scan pre-Wave-0 code — that would surface hundreds of
 * legacy call sites already accepted as debt. The purpose is to prevent NEW
 * REPLACE usage in the Wave 0 change set.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const WAVE0_MIGRATION_RANGE = { start: 121, end: 128 };
const WAVE0_LIB_FILES = [
  "server/lib/money.ts",
];
const ROOT = path.resolve(__dirname, "../..");

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*\n/g, "\n") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

function collectMigrations(subdir: string): Array<{ file: string; sql: string }> {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const out: Array<{ file: string; sql: string }> = [];
  for (const f of files) {
    const m = /^(\d{4})_/.exec(f);
    if (!m) continue;
    const id = Number(m[1]);
    if (id >= WAVE0_MIGRATION_RANGE.start && id <= WAVE0_MIGRATION_RANGE.end) {
      out.push({ file: `${subdir}/${f}`, sql: fs.readFileSync(path.join(dir, f), "utf8") });
    }
  }
  return out;
}

// Wave 0 Increment 1 review item 11: scan connection.ts inline SQL too,
// not just migrations/. The inline path is the file most likely to grow a
// stray INSERT OR REPLACE because it's TS, not SQL.
function collectInlineWave0Sql(): Array<{ file: string; sql: string }> {
  const src = fs.readFileSync(path.join(ROOT, "server/db/connection.ts"), "utf8");
  const out: Array<{ file: string; sql: string }> = [];
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
    out.push({ file: `server/db/connection.ts::${fnName}`, sql: body });
  }
  return out;
}

function collectWave0Sql(): Array<{ file: string; sql: string }> {
  return [
    ...collectMigrations("migrations"),
    ...collectMigrations("server/db/migrations"),
    ...collectInlineWave0Sql(),
  ];
}

function collectWave0Lib(): Array<{ file: string; source: string }> {
  const root = path.resolve(__dirname, "../..");
  return WAVE0_LIB_FILES.map((rel) => ({
    file: rel,
    source: fs.readFileSync(path.join(root, rel), "utf8"),
  }));
}

/**
 * Detect `INSERT OR REPLACE ...` or bare `REPLACE INTO ...` in SQL / string
 * literals. Case-insensitive, allows arbitrary whitespace.
 */
function findReplaceUsage(text: string): string[] {
  const stripped = stripComments(text);
  const patterns = [
    /\bINSERT\s+OR\s+REPLACE\b/gi,
    /\bREPLACE\s+INTO\b/gi,
  ];
  const hits: string[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      // Emit the surrounding line for the failure message.
      const lineStart = stripped.lastIndexOf("\n", m.index) + 1;
      const lineEnd = stripped.indexOf("\n", m.index);
      const line = stripped.slice(lineStart, lineEnd < 0 ? stripped.length : lineEnd).trim();
      hits.push(line);
    }
  }
  return hits;
}

describe("Wave 0 acceptance 0-N: REPLACE-triple pairing lint", () => {
  it("scans all three places for REPLACE (v3 review Opus M6: self-verifying)", () => {
    const sources = collectWave0Sql();
    const place1 = sources.filter(s => s.file.startsWith("migrations/"));
    const place2 = sources.filter(s => s.file.startsWith("server/db/migrations/"));
    const place3 = sources.filter(s => s.file.startsWith("server/db/connection.ts::"));
    expect(place1.length, "place 1 (migrations/) not scanned").toBeGreaterThanOrEqual(3);
    expect(place2.length, "place 2 (server/db/migrations/) not scanned").toBeGreaterThanOrEqual(3);
    // Place 3 collects one entry per applyWave0*Schema function (3 total).
    expect(place3.length, "place 3 (inline connection.ts) not scanned").toBe(3);
  });

  it("no Wave 0 migration uses INSERT OR REPLACE or REPLACE INTO", () => {
    const files = collectWave0Sql();
    expect(files.length).toBeGreaterThan(0);
    const offenders: Array<{ file: string; line: string }> = [];
    for (const f of files) {
      for (const line of findReplaceUsage(f.sql)) offenders.push({ file: f.file, line });
    }
    expect(offenders, `REPLACE used in Wave 0 migrations: ${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  it("no Wave 0 lib file emits INSERT OR REPLACE or REPLACE INTO", () => {
    const files = collectWave0Lib();
    expect(files.length).toBeGreaterThan(0);
    const offenders: Array<{ file: string; line: string }> = [];
    for (const f of files) {
      for (const line of findReplaceUsage(f.source)) offenders.push({ file: f.file, line });
    }
    expect(offenders, `REPLACE emitted from Wave 0 lib code: ${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  it("Wave 0 migrations use INSERT OR IGNORE for idempotent seeds (positive assertion)", () => {
    // Confirms the ban isn't just banning everything — the safe alternative
    // (INSERT OR IGNORE) IS present in at least one migration.
    const files = collectWave0Sql();
    const hasIgnore = files.some((f) => /\bINSERT\s+OR\s+IGNORE\b/i.test(stripComments(f.sql)));
    expect(hasIgnore).toBe(true);
  });
});
