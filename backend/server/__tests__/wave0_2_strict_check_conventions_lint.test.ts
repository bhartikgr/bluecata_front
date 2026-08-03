/**
 * Wave 0-2 v3 (Path A): STRICT/CHECK conventions lint on grammar-parsed SQL.
 *
 * SQL is parsed by node-sql-parser (SQLite dialect); TypeScript embedded SQL
 * is extracted through the TypeScript AST from db.prepare / exec / raw call
 * sites. STRICT + WITHOUT ROWID (either order), non-STRICT typeless columns,
 * REAL types inside CHECK string literals, and DEFAULT ')' all resolve
 * correctly via the grammar.
 *
 * Rules on program-era migrations (0121+) and inline apply functions:
 *   R1  Money-carrying tables use STRICT
 *   R2  Money columns paired with currency column or allowlisted
 *   R3  No REAL column type
 *   R4  Money columns typed INTEGER
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  collectSqlStatementsFromSqlFile,
  collectSqlStatementsFromTsFile,
  extractCreateTable,
  isUnparsed,
} from "./_wave0_ast_lint";

const ROOT = path.resolve(__dirname, "../..");
const PROGRAM_MIGRATION_MIN = 121;

const CURRENCYLESS_ALLOWLIST: Array<{ table: string; column: string; reason: string }> = [
  {
    table: "fx_rate_snapshot",
    column: "rate_numerator",
    reason:
      "fx_rate_snapshot carries from_currency + to_currency explicitly. Its rate is a ratio between two currencies, not an amount in one.",
  },
  {
    table: "fx_rate_snapshot",
    column: "rate_denominator",
    reason: "Companion to rate_numerator on fx_rate_snapshot.",
  },
];

const MONEY_COL_RE = /_cents$|_amount$|_bps$|^rate_|_numerator$|_denominator$|_minor_units$|_capacity_cents$/i;
const CURRENCY_COL_RE = /^currency$|_currency$/i;
const MONEY_COL_NAME_EXCLUDES = new Set<string>(["rule_version"]);

function isMoneyColumn(name: string): boolean {
  if (MONEY_COL_NAME_EXCLUDES.has(name)) return false;
  return MONEY_COL_RE.test(name);
}

function collectProgramMigrationFiles(): string[] {
  const out: string[] = [];
  for (const subdir of ["migrations", "server/db/migrations"]) {
    const dir = path.join(ROOT, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const idM = /^(\d{4})_/.exec(f);
      if (!idM || !f.endsWith(".sql")) continue;
      if (Number(idM[1]) < PROGRAM_MIGRATION_MIN) continue;
      out.push(path.join(dir, f));
    }
  }
  return out;
}

describe("Wave 0-2 v3: STRICT/CHECK conventions lint (AST-based)", () => {
  const migrationFiles = collectProgramMigrationFiles();
  const inlineFile = path.join(ROOT, "server/db/connection.ts");

  const allCreateTables = [
    ...migrationFiles.flatMap((f) =>
      collectSqlStatementsFromSqlFile(f)
        .map((s) => extractCreateTable(s))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    ),
    ...collectSqlStatementsFromTsFile(inlineFile)
      .map((s) => extractCreateTable(s))
      .filter((c): c is NonNullable<typeof c> => c !== null),
  ];

  it("anti-vacuity: parses a nontrivial number of tables", () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(3);
    expect(allCreateTables.length).toBeGreaterThan(5);
  });

  it("Opus V4-M4: canonical Wave 0 money-carrying tables are present in the parsed corpus", () => {
    // Explicit expected-table-name set. If any of these vanish from
    // allCreateTables (via a parser drop, a rename without update, etc.)
    // the increment's rules apply to nothing and this test surfaces the
    // absence loudly — replacing v3's count-based anti-vacuity that
    // allowed silent drops.
    const REQUIRED_TABLES = [
      "currency_ref",
      "allocation_rule",
      "fx_rate_snapshot",
      "platform_config",
      "platform_config_history",
    ];
    const parsedNames = new Set(allCreateTables.map((c) => c.table.toLowerCase()));
    const missing = REQUIRED_TABLES.filter((t) => !parsedNames.has(t));
    expect(
      missing,
      `Required Wave 0 money-carrying tables missing from parsed corpus: ${JSON.stringify(missing)}. Either the parser silently dropped them (silent-drop regression), or a rename happened without updating this test.`,
    ).toEqual([]);
  });

  it("Opus V4-M4: no unparseable statement in program-era migrations (0121+) or connection.ts inline SQL", () => {
    // Zero-tolerance parse-failure check scoped to Wave 0's own turf.
    // Wave 0 SQL migrations 0121+ are OURS; we control their shape. Any
    // parse failure is a lint or migration bug, not a parser limitation.
    // The inline apply function in connection.ts is the same territory.
    const stripLeading = (s: string): string =>
      s.replace(/^(?:\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
    const isKnownLimitation = (head: string): boolean =>
      /^(?:CREATE\s+(?:TRIGGER|VIEW|VIRTUAL\s+TABLE)|BEGIN|COMMIT|ROLLBACK|PRAGMA|END|ATTACH|DETACH|ANALYZE|EXPLAIN|SAVEPOINT|RELEASE|VACUUM|REINDEX)\b/i.test(head);
    const offenders: Array<{ file: string; error: string; snippet: string }> = [];
    for (const f of migrationFiles) {
      for (const s of collectSqlStatementsFromSqlFile(f)) {
        if (!isUnparsed(s)) continue;
        const u = s as any;
        const stripped = stripLeading(String(s.raw ?? ""));
        if (isKnownLimitation(stripped)) continue;
        offenders.push({
          file: path.relative(ROOT, f),
          error: u.parseError,
          snippet: stripped.slice(0, 80),
        });
      }
    }
    for (const s of collectSqlStatementsFromTsFile(inlineFile)) {
      if (!isUnparsed(s)) continue;
      const u = s as any;
      const stripped = stripLeading(String(s.raw ?? ""));
      if (isKnownLimitation(stripped)) continue;
      offenders.push({
        file: "server/db/connection.ts",
        error: u.parseError,
        snippet: stripped.slice(0, 80),
      });
    }
    expect(
      offenders,
      `Unparseable statement in Wave 0's own program-era corpus. Fix the migration or the parser transform.\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("R1: every money-carrying table uses STRICT", () => {
    const offenders: Array<{ file: string; table: string; moneyColumns: string[] }> = [];
    for (const t of allCreateTables) {
      const moneyCols = t.columns.filter((c) => isMoneyColumn(c.name));
      if (moneyCols.length > 0 && !t.isStrict) {
        offenders.push({ file: t.file, table: t.table, moneyColumns: moneyCols.map((c) => c.name) });
      }
    }
    expect(
      offenders,
      `Money-carrying table without STRICT.\n\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("R2: every money column has a currency column or is allowlisted", () => {
    const allowed = (t: string, c: string) =>
      CURRENCYLESS_ALLOWLIST.some((a) => a.table === t && a.column === c);
    const offenders: Array<{ file: string; table: string; column: string }> = [];
    for (const t of allCreateTables) {
      const hasCurrency = t.columns.some((c) => CURRENCY_COL_RE.test(c.name));
      if (hasCurrency) continue;
      for (const col of t.columns) {
        if (!isMoneyColumn(col.name)) continue;
        if (allowed(t.table, col.name)) continue;
        offenders.push({ file: t.file, table: t.table, column: col.name });
      }
    }
    expect(
      offenders,
      `Money column with no currency column and no allowlist entry.\n\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("R3: no REAL column type in program-era tables", () => {
    const offenders: Array<{ file: string; table: string; column: string }> = [];
    for (const t of allCreateTables) {
      for (const col of t.columns) {
        if (col.dataType === "REAL") {
          offenders.push({ file: t.file, table: t.table, column: col.name });
        }
      }
    }
    expect(
      offenders,
      `REAL column type in a program-era migration.\n\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("R4: every money column is typed INTEGER", () => {
    const offenders: Array<{ file: string; table: string; column: string; type: string }> = [];
    for (const t of allCreateTables) {
      for (const col of t.columns) {
        if (!isMoneyColumn(col.name)) continue;
        if (col.dataType !== "INTEGER") {
          offenders.push({
            file: t.file,
            table: t.table,
            column: col.name,
            type: col.dataType || "(no type)",
          });
        }
      }
    }
    expect(
      offenders,
      `Money column with non-INTEGER type.\n\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("CURRENCYLESS_ALLOWLIST is well-formed", () => {
    for (const e of CURRENCYLESS_ALLOWLIST) {
      expect(e.table).toBeTruthy();
      expect(e.column).toBeTruthy();
      expect(e.reason.length).toBeGreaterThan(20);
    }
  });

  // ── Positive anti-vacuity fixtures ────────────────────────────────────

  describe("positive anti-vacuity: rules fire on adversarial input", () => {
    function tmpFile(name: string, content: string): string {
      const dir = fs.mkdtempSync("/tmp/w02_");
      const f = path.join(dir, name);
      fs.writeFileSync(f, content);
      return f;
    }

    it("R1 fires: money table without STRICT", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad (id TEXT, amount_cents INTEGER, currency TEXT NOT NULL);`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.isStrict).toBe(false);
      expect(t.columns.some((c) => isMoneyColumn(c.name))).toBe(true);
    });
    it("R1 accepts STRICT + WITHOUT ROWID in either order", () => {
      const f1 = tmpFile("a.sql", `CREATE TABLE ok1 (id TEXT PRIMARY KEY, amount_cents INTEGER, currency TEXT NOT NULL) STRICT, WITHOUT ROWID;`);
      const f2 = tmpFile("b.sql", `CREATE TABLE ok2 (id TEXT PRIMARY KEY, amount_cents INTEGER, currency TEXT NOT NULL) WITHOUT ROWID, STRICT;`);
      const t1 = extractCreateTable(collectSqlStatementsFromSqlFile(f1)[0])!;
      const t2 = extractCreateTable(collectSqlStatementsFromSqlFile(f2)[0])!;
      expect(t1.isStrict).toBe(true);
      expect(t2.isStrict).toBe(true);
      expect(t1.withoutRowid).toBe(true);
      expect(t2.withoutRowid).toBe(true);
    });
    it("R2 fires: money column without currency and not allowlisted", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad (id TEXT PRIMARY KEY, gross_amount INTEGER) STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.columns.some((c) => isMoneyColumn(c.name))).toBe(true);
      expect(t.columns.some((c) => CURRENCY_COL_RE.test(c.name))).toBe(false);
    });
    it("R3 fires: REAL column type", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad (id TEXT PRIMARY KEY, price REAL) STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.columns.find((c) => c.name === "price")?.dataType).toBe("REAL");
    });
    it("R3 does NOT fire on REAL inside a string literal in a CHECK", () => {
      const f = tmpFile("t.sql", `CREATE TABLE ok (id TEXT PRIMARY KEY, value TEXT CHECK (value IN ('integer','real'))) STRICT;`);
      const stmts = collectSqlStatementsFromSqlFile(f);
      const t = extractCreateTable(stmts[0])!;
      // No column has dataType='REAL' — the string literal is not a type.
      expect(t.columns.every((c) => c.dataType !== "REAL")).toBe(true);
    });
    it("R4 fires: money column typed TEXT", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad (id TEXT PRIMARY KEY, amount_cents TEXT, currency TEXT NOT NULL) STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.columns.find((c) => c.name === "amount_cents")?.dataType).toBe("TEXT");
    });
    it("parseTables handles DEFAULT with parenthesis in a string literal", () => {
      const f = tmpFile("t.sql", `CREATE TABLE mid (id TEXT PRIMARY KEY, val TEXT DEFAULT ')') STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.columns.length).toBe(2);
    });
    it("parseTables separates two tables with STRICT+WITHOUT ROWID options", () => {
      const f = tmpFile("t.sql", `CREATE TABLE a (id TEXT) STRICT, WITHOUT ROWID;\nCREATE TABLE b (id TEXT) STRICT;`);
      const stmts = collectSqlStatementsFromSqlFile(f);
      const creates = stmts.map((s) => extractCreateTable(s)).filter((x) => x !== null);
      expect(creates.length).toBe(2);
      expect(creates.map((c) => c!.table)).toEqual(["a", "b"]);
    });
  });
});
