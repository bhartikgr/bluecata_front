/**
 * Wave 0-3 v3 (Path A): append-only ledger primitives lint (AST-based).
 *
 * Every table matching the event-name convention must carry the canonical
 * 8-column shape from wave0/EVENT_COLUMNS_CANONICAL.sql. All parsing is
 * grammar-based (node-sql-parser); no regex-derived column extraction.
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

const EVENT_TABLES_BY_NAME = new Set([
  "journal_entry",
  "journal_posting",
  "record_supersession",
  "carry_ledger_entry",
  "allocation_run",
  "commitment_capacity_event",
  "chain_events",
  "audit_log",
]);
const EVENT_TABLE_SUFFIX_RE = /(^event_|_event$|_receipt$)/i;

function isEventTable(name: string): boolean {
  const lower = name.toLowerCase();
  return EVENT_TABLES_BY_NAME.has(lower) || EVENT_TABLE_SUFFIX_RE.test(lower);
}

const NO_DELETED_AT_TABLES = new Set([
  "capital_call_receipt",
  "journal_posting",
  "commitment_capacity_event",
  "record_supersession",
]);
const NO_SOURCE_EVENT_TABLES = new Set(["journal_entry", "commitment_capacity_event"]);

const CANONICAL_COLS_WITH_SOURCE_EVENT = [
  "actor_id",
  "request_id",
  "idempotency_key",
  "source_event_type",
  "source_event_id",
  "reverses_id",
  "seq",
  "created_at",
] as const;

const CANONICAL_COLS_NO_SOURCE_EVENT = [
  "actor_id",
  "request_id",
  "idempotency_key",
  "reverses_id",
  "seq",
  "created_at",
] as const;

function requiredCols(table: string): readonly string[] {
  if (NO_SOURCE_EVENT_TABLES.has(table)) return CANONICAL_COLS_NO_SOURCE_EVENT;
  return CANONICAL_COLS_WITH_SOURCE_EVENT;
}

const NOT_NULL_COLS = ["actor_id", "seq", "created_at"] as const;

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

describe("Wave 0-3 v3: append-only ledger primitives lint (AST-based)", () => {
  const migrationFiles = collectProgramMigrationFiles();
  const inlineFile = path.join(ROOT, "server/db/connection.ts");
  const migrationStmts = migrationFiles.flatMap((f) => collectSqlStatementsFromSqlFile(f));
  const inlineStmts = collectSqlStatementsFromTsFile(inlineFile);
  const allStmts = [...migrationStmts, ...inlineStmts];
  const allTables = allStmts
    .map((s) => extractCreateTable(s))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const eventTables = allTables.filter((t) => isEventTable(t.table));

  it("anti-vacuity: parses tables", () => {
    expect(allTables.length).toBeGreaterThan(5);
  });

  it("Opus V4-M4: canonical Wave 0 event tables are present in the parsed corpus", () => {
    // Explicit expected-table-name set. If any of these vanish from
    // allTables the increment applies to nothing. This replaces the
    // count-based anti-vacuity above with a name-based one so a silent
    // parser drop fails loud.
    const REQUIRED_EVENT_TABLES = ["platform_config_history"];
    const parsedNames = new Set(allTables.map((c) => c.table.toLowerCase()));
    const missing = REQUIRED_EVENT_TABLES.filter((t) => !parsedNames.has(t));
    expect(
      missing,
      `Required Wave 0 event tables missing from parsed corpus: ${JSON.stringify(missing)}. Either the parser silently dropped them, or a rename happened without updating this test.`,
    ).toEqual([]);
  });

  it("Opus V4-M4: no unparseable statement in program-era migrations (0121+) or connection.ts inline SQL", () => {
    const stripLeading = (s: string): string =>
      s.replace(/^(?:\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
    const isKnownLimitation = (head: string): boolean =>
      /^(?:CREATE\s+(?:TRIGGER|VIEW|VIRTUAL\s+TABLE)|BEGIN|COMMIT|ROLLBACK|PRAGMA|END|ATTACH|DETACH|ANALYZE|EXPLAIN|SAVEPOINT|RELEASE|VACUUM|REINDEX)\b/i.test(head);
    const offenders: Array<{ file: string; error: string; snippet: string }> = [];
    for (const s of allStmts) {
      if (!isUnparsed(s)) continue;
      const u = s as any;
      const stripped = stripLeading(String(s.raw ?? ""));
      if (isKnownLimitation(stripped)) continue;
      offenders.push({
        file: s.file,
        error: u.parseError,
        snippet: stripped.slice(0, 80),
      });
    }
    expect(
      offenders,
      `Unparseable statement in Wave 0's own program-era corpus. Fix the migration or the parser transform.\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("every event table carries the canonical presence columns", () => {
    const offenders: Array<{ file: string; table: string; missing: string[] }> = [];
    for (const t of eventTables) {
      const cols = new Set(t.columns.map((c) => c.name));
      const missing = requiredCols(t.table).filter((n) => !cols.has(n));
      if (missing.length > 0) offenders.push({ file: t.file, table: t.table, missing });
    }
    expect(
      offenders,
      `Event table missing canonical columns.\n\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("actor_id / seq / created_at are declared NOT NULL", () => {
    const offenders: Array<{ file: string; table: string; column: string }> = [];
    for (const t of eventTables) {
      for (const req of NOT_NULL_COLS) {
        const col = t.columns.find((c) => c.name === req);
        if (col && !col.notNull) offenders.push({ file: t.file, table: t.table, column: req });
      }
    }
    expect(offenders, `Column missing NOT NULL.\n\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  it("deleted_at presence rule (mandatory except for 4 fixture exceptions)", () => {
    const offenders: Array<{ file: string; table: string; issue: string }> = [];
    for (const t of eventTables) {
      const hasDeletedAt = t.columns.some((c) => c.name === "deleted_at");
      const shouldHave = !NO_DELETED_AT_TABLES.has(t.table);
      if (shouldHave && !hasDeletedAt) {
        offenders.push({ file: t.file, table: t.table, issue: "missing deleted_at" });
      }
      if (!shouldHave && hasDeletedAt) {
        offenders.push({ file: t.file, table: t.table, issue: "has deleted_at but is a fixture exception" });
      }
    }
    expect(offenders, `deleted_at mismatch.\n\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  it("event tables use STRICT", () => {
    const offenders = eventTables.filter((t) => !t.isStrict).map((t) => ({ file: t.file, table: t.table }));
    expect(offenders, `Non-STRICT event table.\n\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  // ── Positive anti-vacuity fixtures ────────────────────────────────────

  describe("positive anti-vacuity: rules fire on adversarial input", () => {
    function tmpFile(name: string, content: string): string {
      const dir = fs.mkdtempSync("/tmp/w03_");
      const f = path.join(dir, name);
      fs.writeFileSync(f, content);
      return f;
    }

    it("classifies journal_entry, journal_posting, record_supersession as event tables", () => {
      expect(isEventTable("journal_entry")).toBe(true);
      expect(isEventTable("journal_posting")).toBe(true);
      expect(isEventTable("record_supersession")).toBe(true);
      expect(isEventTable("capital_call_receipt")).toBe(true);
      expect(isEventTable("capital_call_event")).toBe(true);
      expect(isEventTable("commitment_capacity_event")).toBe(true);
      expect(isEventTable("carry_ledger_entry")).toBe(true);
      expect(isEventTable("chain_events")).toBe(true);
      expect(isEventTable("audit_log")).toBe(true);
      expect(isEventTable("currency_ref")).toBe(false);
      expect(isEventTable("platform_config")).toBe(false);
    });
    it("presence rule fires on event table missing request_id", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad_event (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT,
        source_event_type TEXT,
        source_event_id TEXT,
        reverses_id TEXT,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      const cols = new Set(t.columns.map((c) => c.name));
      const missing = requiredCols(t.table).filter((n) => !cols.has(n));
      expect(missing).toEqual(["request_id"]);
    });
    it("NOT-NULL rule fires on actor_id without NOT NULL", () => {
      const f = tmpFile("t.sql", `CREATE TABLE bad_event (
        actor_id TEXT,
        request_id TEXT,
        idempotency_key TEXT,
        source_event_type TEXT,
        source_event_id TEXT,
        reverses_id TEXT,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.columns.find((c) => c.name === "actor_id")?.notNull).toBe(false);
    });
    it("STRICT check fires on non-STRICT event table", () => {
      const f = tmpFile("t.sql", `CREATE TABLE non_strict_event (
        actor_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );`);
      const t = extractCreateTable(collectSqlStatementsFromSqlFile(f)[0])!;
      expect(t.isStrict).toBe(false);
    });
    it("deleted_at exception: capital_call_receipt must NOT have deleted_at (from fixture)", () => {
      expect(NO_DELETED_AT_TABLES.has("capital_call_receipt")).toBe(true);
    });
  });
});
