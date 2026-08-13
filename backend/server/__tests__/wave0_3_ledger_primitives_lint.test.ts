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
  extractTableLifecycle,
  isUnparsed,
  type CreateTable,
  type ParsedStatement,
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

/**
 * WAVE 38 ROW 4 — files come back in MIGRATION ORDER, not directory order.
 *
 * The previous version pushed all of `migrations/` and then all of
 * `server/db/migrations/` in raw `readdirSync` order. That was harmless while
 * the lint only ever looked at `CREATE TABLE` statements as an unordered set,
 * and is wrong the moment the corpus is folded into an effective schema: a
 * 0153 declaration read after a 0183 rebuild would resurrect the shape 0183
 * replaced. Sort by numeric id first, then by directory, which is the order
 * `db/migrate.ts` applies them in.
 */
function collectProgramMigrationFiles(): string[] {
  const out: Array<{ id: number; dirRank: number; file: string }> = [];
  const subdirs = ["migrations", "server/db/migrations"];
  for (let dirRank = 0; dirRank < subdirs.length; dirRank++) {
    const dir = path.join(ROOT, subdirs[dirRank]);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const idM = /^(\d{4})_/.exec(f);
      if (!idM || !f.endsWith(".sql")) continue;
      if (Number(idM[1]) < PROGRAM_MIGRATION_MIN) continue;
      out.push({ id: Number(idM[1]), dirRank, file: path.join(dir, f) });
    }
  }
  out.sort((a, b) => (a.id - b.id) || (a.dirRank - b.dirRank) || a.file.localeCompare(b.file));
  return out.map((e) => e.file);
}

/**
 * WAVE 38 ROW 4 — fold an ORDERED statement stream into the EFFECTIVE schema.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A LOOSENING.
 *
 * This lint used to iterate every `CREATE TABLE` statement ever written and
 * demand that each one, individually, declared the canonical event shape. That
 * is an assertion about the HISTORY OF DECLARATIONS, not about the schema a
 * database ends up with — and history is append-only. Five event tables
 * (partner_money_event 0153, valuation_event 0159, partner_subscription_event
 * 0167, esign_event 0168, spv_discovery_event 0179) shipped without the shape.
 * Under the old rule the ONLY way to green was to edit those already-applied
 * files, i.e. to backdate history beneath every deployed database's high-water
 * mark. The rule was therefore unsatisfiable by correct means, which is exactly
 * how a check ends up being "fixed" by weakening it.
 *
 * The rule enforced here is STRICTLY STRONGER on the thing that matters: the
 * shape a database actually has after every migration has run. `DROP TABLE`
 * removes an entry, `ALTER TABLE ... RENAME TO` moves one, and
 * `CREATE TABLE IF NOT EXISTS` does not overwrite a live entry — precisely
 * SQLite's own semantics. A table that is created wrong and never repaired is
 * still an offender; a table created wrong and rebuilt correctly by a forward
 * migration is not, because the database is not wrong.
 *
 * The `positive anti-vacuity` block below proves the rules still fire, and
 * `effective-schema fold` proves the fold itself is not a rubber stamp: it must
 * report an offender when the LAST word on a table is a bad shape.
 */
export function foldEffectiveSchema(stmts: ParsedStatement[]): Map<string, CreateTable> {
  const live = new Map<string, CreateTable>();
  for (const s of stmts) {
    const created = extractCreateTable(s);
    if (created) {
      // `IF NOT EXISTS` against a table that already exists is a no-op in
      // SQLite. Honour that, or a self-heal re-declaration in connection.ts
      // would appear to overwrite a migration's repaired shape.
      if (created.ifNotExists && live.has(created.table)) continue;
      live.set(created.table, created);
      continue;
    }
    const lifecycle = extractTableLifecycle(s);
    if (!lifecycle) continue;
    if (lifecycle.kind === "drop") {
      live.delete(lifecycle.table);
      continue;
    }
    const moving = live.get(lifecycle.table);
    if (!moving || !lifecycle.renameTo) continue;
    live.delete(lifecycle.table);
    live.set(lifecycle.renameTo, { ...moving, table: lifecycle.renameTo });
  }
  return live;
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
  // The canonical-shape rules below run against the EFFECTIVE schema (see
  // `foldEffectiveSchema`), not against every historical declaration.
  const effective = foldEffectiveSchema(allStmts);
  const eventTables = [...effective.values()].filter((t) => isEventTable(t.table));

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

  /**
   * WAVE 38 ROW 4 — falsification harness for the fold itself.
   *
   * The fold is the only thing standing between "the schema is canonical" and
   * "we stopped looking". Every case below asserts BOTH POLES: the shape the
   * fold must accept AND the shape it must still reject. If the fold ever
   * degenerates into "the newest CREATE always wins" or "anything with a repair
   * migration is fine", these go red.
   */
  describe("WAVE 38 ROW 4 — effective-schema fold asserts BOTH poles", () => {
    function stmtsOf(sql: string): ParsedStatement[] {
      const dir = fs.mkdtempSync("/tmp/w38_fold_");
      const f = path.join(dir, "x.sql");
      fs.writeFileSync(f, sql);
      return collectSqlStatementsFromSqlFile(f);
    }
    const BAD = `CREATE TABLE demo_event (id TEXT PRIMARY KEY, amount_minor INTEGER);`;
    const GOOD_SCRATCH = `CREATE TABLE demo__scratch (
        id TEXT PRIMARY KEY NOT NULL,
        amount_minor INTEGER,
        actor_id TEXT NOT NULL,
        request_id TEXT,
        idempotency_key TEXT,
        source_event_type TEXT,
        source_event_id TEXT,
        reverses_id TEXT,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;`;

    function verdict(sql: string): { present: boolean; strict: boolean; missing: string[] } {
      const live = foldEffectiveSchema(stmtsOf(sql));
      const t = live.get("demo_event");
      if (!t) return { present: false, strict: false, missing: ["<table absent>"] };
      const cols = new Set(t.columns.map((c) => c.name));
      return {
        present: true,
        strict: t.isStrict,
        missing: requiredCols(t.table).filter((n) => !cols.has(n)),
      };
    }

    it("NEGATIVE POLE: a bad table with no repair is still an offender", () => {
      const v = verdict(BAD);
      expect(v.present).toBe(true);
      expect(v.strict).toBe(false);
      expect(v.missing).toEqual([...CANONICAL_COLS_WITH_SOURCE_EVENT]);
    });

    it("POSITIVE POLE: rebuild-then-rename retires the bad shape", () => {
      const v = verdict(`${BAD}\n${GOOD_SCRATCH}\nDROP TABLE demo_event;\nALTER TABLE demo__scratch RENAME TO demo_event;`);
      expect(v.present).toBe(true);
      expect(v.strict).toBe(true);
      expect(v.missing).toEqual([]);
    });

    it("NEGATIVE POLE: a rename that lands a STILL-BAD shape is an offender", () => {
      const v = verdict(`${BAD}\nCREATE TABLE demo__scratch (id TEXT PRIMARY KEY);\nDROP TABLE demo_event;\nALTER TABLE demo__scratch RENAME TO demo_event;`);
      expect(v.present).toBe(true);
      expect(v.strict).toBe(false);
      expect(v.missing).toEqual([...CANONICAL_COLS_WITH_SOURCE_EVENT]);
    });

    it("NEGATIVE POLE: a LATER bad declaration overrides an EARLIER good one", () => {
      const v = verdict(`${GOOD_SCRATCH}\nALTER TABLE demo__scratch RENAME TO demo_event;\nDROP TABLE demo_event;\n${BAD}`);
      expect(v.strict).toBe(false);
      expect(v.missing).toEqual([...CANONICAL_COLS_WITH_SOURCE_EVENT]);
    });

    it("CREATE TABLE IF NOT EXISTS does NOT overwrite a live good shape", () => {
      const v = verdict(`${GOOD_SCRATCH}\nALTER TABLE demo__scratch RENAME TO demo_event;\nCREATE TABLE IF NOT EXISTS demo_event (id TEXT PRIMARY KEY);`);
      expect(v.strict).toBe(true);
      expect(v.missing).toEqual([]);
    });

    it("an unguarded DROP with no replacement removes the table entirely", () => {
      expect(verdict(`${BAD}\nDROP TABLE demo_event;`).present).toBe(false);
    });

    it("RENAME COLUMN is not mistaken for RENAME TABLE", () => {
      const live = foldEffectiveSchema(stmtsOf(`${BAD}\nALTER TABLE demo_event RENAME COLUMN id TO id2;`));
      expect([...live.keys()]).toEqual(["demo_event"]);
    });

    it("anti-vacuity: the five WAVE 38 tables really are in the folded corpus and really are canonical", () => {
      const repaired = [
        "partner_money_event",
        "valuation_event",
        "partner_subscription_event",
        "esign_event",
        "spv_discovery_event",
      ];
      const verdicts = repaired.map((name) => {
        const t = effective.get(name);
        if (!t) return { name, verdict: "ABSENT FROM FOLDED CORPUS" };
        const cols = new Set(t.columns.map((c) => c.name));
        const missing = requiredCols(name).filter((n) => !cols.has(n));
        if (!t.isStrict) return { name, verdict: "NOT STRICT" };
        if (missing.length) return { name, verdict: `MISSING ${missing.join(",")}` };
        if (!cols.has("deleted_at")) return { name, verdict: "MISSING deleted_at" };
        return { name, verdict: "canonical" };
      });
      expect(verdicts).toEqual(repaired.map((name) => ({ name, verdict: "canonical" })));
      // And the scratch tables migration 0183 builds must NOT survive the fold.
      const scratch = [...effective.keys()].filter((k) => k.endsWith("__w38"));
      expect(scratch).toEqual([]);
    });
  });
});
