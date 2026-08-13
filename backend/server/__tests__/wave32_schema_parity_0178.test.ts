/**
 * WAVE 32 · CP-SPV-30 — SCHEMA PARITY: migration 0178 vs. the self-heal installer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Expressing a schema in two places is how this build produced its worst
 * infrastructure defect: `partner_subscription` had a migration AND a separate
 * inline creator, the two disagreed, `CREATE TABLE IF NOT EXISTS` silently
 * discarded the incompatible definition, and every fresh database came up
 * broken while the migration runner exited 0. It was invisible for weeks.
 *
 * Wave 32 has the same two paths — migration `0178_wave32_spv_institutional.sql`
 * and `server/lib/applySpvInstitutionalSchema.ts` — so divergence has to be
 * IMPOSSIBLE TO SHIP, not merely unlikely. Two independent defences:
 *
 *   DEFENCE 1 · ONE SOURCE OF TRUTH BY CONSTRUCTION. The installer does not
 *     contain DDL. It READS the migration file off disk and executes it. Case
 *     (A) asserts that property directly, so a future edit that re-types the
 *     DDL into the installer — reintroducing the two-definitions shape — fails
 *     here rather than in production.
 *
 *   DEFENCE 2 · PROVEN EQUAL BY EXECUTION. Case (B) applies each path to its
 *     own empty database and compares the RESULTING SCHEMAS: every table, every
 *     column name, declared type, nullability, default and primary-key flag,
 *     and every index with its uniqueness and its partial-WHERE clause.
 *
 * BOTH POLES. A comparator that always reports "identical" would pass (B) while
 * checking nothing — that is precisely the twenty-three-instance defect class.
 * Case (C) therefore DELIBERATELY PERTURBS one definition, one perturbation at
 * a time, and requires the comparator to go red for each. A perturbation that
 * the comparator failed to notice would mean (B) is decorative.
 *
 * A-22, IN BOTH DIRECTIONS. Case (D) asserts that connection.ts's inline
 * baseline neither creates nor re-creates any table 0178 defines, and that no
 * other self-heal installer does either — so there is no third definition and
 * nothing that could re-create a table after this installer fixed it.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  applySpvInstitutionalSchema,
  readSpvInstitutionalDdl,
} from "../lib/applySpvInstitutionalSchema";

const ROOT = path.resolve(__dirname, "../..");
const BASENAME = "0178_wave32_spv_institutional.sql";
const MIGRATION_PATH = path.join(ROOT, "migrations", BASENAME);
const MIRROR_PATH = path.join(ROOT, "server", "db", "migrations", BASENAME);
const INSTALLER_PATH = path.join(ROOT, "server", "lib", "applySpvInstitutionalSchema.ts");
const TABLES = ["spv_nav_snapshot", "spv_side_letter", "spv_k1_statement"];

/* ── the comparator ──────────────────────────────────────────────────────── */

interface ColumnShape {
  name: string; type: string; notnull: number; dflt: string | null; pk: number;
}
interface IndexShape {
  name: string; unique: number; columns: string[]; partialWhere: string | null;
}
interface SchemaShape {
  tables: Record<string, { columns: ColumnShape[]; indexes: IndexShape[]; checks: string[] }>;
}

/**
 * A full structural fingerprint. Deliberately reads PRAGMA output rather than
 * the CREATE statement text: two DDL strings can differ in whitespace and be
 * identical schemas, and — far more dangerous — can look similar and produce
 * different nullability. The CHECK constraints are the one thing PRAGMA does
 * not expose, so those are extracted from the stored SQL and normalised.
 */
function fingerprint(db: any): SchemaShape {
  const out: SchemaShape = { tables: {} };
  for (const t of TABLES) {
    const columns = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => ({
      name: String(c.name), type: String(c.type),
      notnull: Number(c.notnull), dflt: c.dflt_value === null || c.dflt_value === undefined ? null : String(c.dflt_value),
      pk: Number(c.pk),
    }));
    const indexes = (db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? ORDER BY name`,
    ).all(t) as any[]).map((i) => {
      const info = db.prepare(`PRAGMA index_info(${JSON.stringify(i.name)})`).all() as any[];
      const list = (db.prepare(`PRAGMA index_list(${t})`).all() as any[]).find((x) => x.name === i.name);
      const m = /\bWHERE\b(.+)$/is.exec(String(i.sql ?? ""));
      return {
        name: String(i.name),
        unique: Number(list?.unique ?? 0),
        columns: info.map((c) => String(c.name)),
        partialWhere: m ? m[1].replace(/\s+/g, " ").trim() : null,
      };
    });
    const sql = String((db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(t) as any)?.sql ?? "");
    const checks = Array.from(sql.matchAll(/CHECK\s*\(/gi)).map((_, idx) => idx).length
      ? sql.replace(/\s+/g, " ").match(/CHECK\s*\([^)]*(?:\([^)]*\)[^)]*)*\)/gi)?.map((c) => c.trim()) ?? []
      : [];
    out.tables[t] = { columns, indexes, checks };
  }
  return out;
}

function freshDbFromSql(sql: string): any {
  const db = new Database(":memory:");
  db.exec(sql);
  return db;
}

/* ==========================================================================
 * (A) ONE SOURCE OF TRUTH BY CONSTRUCTION.
 * ======================================================================== */
describe("W32 parity (A) the installer holds no DDL of its own", () => {
  it("A1 applySpvInstitutionalSchema.ts contains no CREATE TABLE / CREATE INDEX literal", () => {
    const src = fs.readFileSync(INSTALLER_PATH, "utf8");
    // Comments in that file legitimately NAME the tables; what must not appear
    // is a second DEFINITION of them. Strip block and line comments first, so
    // this asserts on code rather than on prose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/CREATE\s+TABLE/i);
    expect(code).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    // …and it positively DOES read the migration file, so it is not simply
    // installing nothing. A1 must not be satisfiable by an empty installer.
    expect(code).toContain("0178_wave32_spv_institutional.sql");
    expect(code).toMatch(/readFileSync/);
  });

  it("A2 the two migration copies are byte-identical", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(fs.existsSync(MIRROR_PATH)).toBe(true);
    expect(fs.readFileSync(MIGRATION_PATH, "utf8")).toBe(fs.readFileSync(MIRROR_PATH, "utf8"));
  });

  it("A3 the installer's reader returns exactly that file's bytes", () => {
    expect(readSpvInstitutionalDdl()).toBe(fs.readFileSync(MIRROR_PATH, "utf8"));
  });
});

/* ==========================================================================
 * (B) PROVEN EQUAL BY EXECUTION.
 * ======================================================================== */
describe("W32 parity (B) migration and installer produce the SAME schema", () => {
  it("B1 identical tables, columns, types, nullability, defaults, PKs, indexes and CHECKs", () => {
    const viaMigration = freshDbFromSql(fs.readFileSync(MIGRATION_PATH, "utf8"));
    const viaInstaller = new Database(":memory:");
    applySpvInstitutionalSchema(viaInstaller as any);

    const a = fingerprint(viaMigration);
    const b = fingerprint(viaInstaller);
    // Precondition, asserted rather than assumed: BOTH databases must actually
    // have the tables. Comparing two empty fingerprints would pass trivially —
    // the exact vacuous-pass shape this suite exists to prevent.
    for (const t of TABLES) {
      expect(a.tables[t].columns.length).toBeGreaterThan(5);
      expect(b.tables[t].columns.length).toBeGreaterThan(5);
    }
    expect(b).toEqual(a);

    viaMigration.close(); viaInstaller.close();
  });

  it("B2 the installer is idempotent — running it twice changes nothing", () => {
    const db = new Database(":memory:");
    applySpvInstitutionalSchema(db as any);
    const once = fingerprint(db);
    applySpvInstitutionalSchema(db as any);
    expect(fingerprint(db)).toEqual(once);
    db.close();
  });

  it("B3 the installer heals a PARTIALLY-present schema, not just an empty one", () => {
    // The presence probe tests all three tables. A single-table probe would
    // leave a database healed by an older revision permanently missing the
    // rest, and every read against the missing table returns empty — silently.
    const db = new Database(":memory:");
    const full = fs.readFileSync(MIGRATION_PATH, "utf8");
    const navOnly = full.slice(0, full.indexOf("CREATE TABLE IF NOT EXISTS spv_side_letter"));
    db.exec(navOnly);
    expect(
      db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='spv_side_letter'`).get() as any,
    ).toEqual({ n: 0 });
    applySpvInstitutionalSchema(db as any);
    const healed = freshDbFromSql(full);
    expect(fingerprint(db)).toEqual(fingerprint(healed));
    db.close(); healed.close();
  });
});

/* ==========================================================================
 * (C) THE OTHER POLE — the comparator must GO RED on a real divergence.
 * ======================================================================== */
describe("W32 parity (C) perturbation: the comparator actually detects drift", () => {
  const base = fs.readFileSync(MIGRATION_PATH, "utf8");

  /** Each entry is a divergence of the kind that shipped broken before. */
  const PERTURBATIONS: Array<[string, string, string]> = [
    ["nullability flipped — 'unknown NAV' becomes unstorable",
      "  total_nav_minor       INTEGER CHECK (total_nav_minor IS NULL OR total_nav_minor >= 0),",
      "  total_nav_minor       INTEGER NOT NULL,"],
    ["a column dropped",
      "  worst_mark_badge      TEXT CHECK (worst_mark_badge IS NULL OR worst_mark_badge IN\n                          ('fresh','stale','expired','gp_override')),",
      ""],
    ["a declared type changed",
      "  marked_holdings       INTEGER NOT NULL DEFAULT 0,",
      "  marked_holdings       TEXT NOT NULL DEFAULT '0',"],
    ["a default changed",
      "  co_investor_visibility    TEXT NOT NULL DEFAULT 'inherit'",
      "  co_investor_visibility    TEXT NOT NULL DEFAULT 'co_investors'"],
    ["a UNIQUE index demoted to a plain index — two active side letters become possible",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_w32_sl_active\n  ON spv_side_letter(spv_id, investor_id) WHERE status = 'active';",
      "CREATE INDEX IF NOT EXISTS uq_w32_sl_active\n  ON spv_side_letter(spv_id, investor_id) WHERE status = 'active';"],
    ["a partial index's WHERE clause widened",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_w32_k1_draft\n  ON spv_k1_statement(spv_id, investor_id, tax_year) WHERE status = 'draft';",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_w32_k1_draft\n  ON spv_k1_statement(spv_id, investor_id, tax_year);"],
    ["a CHECK constraint removed — an out-of-domain carry rate becomes persistable",
      "  carry_fraction_scaled     INTEGER CHECK (carry_fraction_scaled IS NULL\n                              OR (carry_fraction_scaled >= 0 AND carry_fraction_scaled <= 1000000000)),",
      "  carry_fraction_scaled     INTEGER,"],
  ];

  it.each(PERTURBATIONS)("C:%s is DETECTED", (_label, from, to) => {
    // The anchor must exist, or the perturbation silently does nothing and the
    // case would "pass" by comparing a file to itself.
    expect(base.includes(from)).toBe(true);
    const perturbed = base.replace(from, to);
    expect(perturbed).not.toBe(base);

    const good = freshDbFromSql(base);
    const bad = freshDbFromSql(perturbed);
    expect(fingerprint(bad)).not.toEqual(fingerprint(good));
    good.close(); bad.close();
  });

  it("C-control: an IRRELEVANT edit (whitespace and comments) is NOT reported as drift", () => {
    // The opposite failure: a comparator so brittle that every harmless edit is
    // a false positive would be routed around within a week. Structural
    // equality must be structural.
    const cosmetic = base
      .replace(/^--.*$/gm, "-- comment")
      .replace(/\n\n+/g, "\n\n");
    const a = freshDbFromSql(base);
    const b = freshDbFromSql(cosmetic);
    expect(fingerprint(b)).toEqual(fingerprint(a));
    a.close(); b.close();
  });
});

/* ==========================================================================
 * (D) A-22 IN BOTH DIRECTIONS.
 * ======================================================================== */
describe("W32 parity (D) no third definition exists anywhere", () => {
  it("D1 connection.ts's inline baseline neither creates nor re-creates any 0178 table", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "db", "connection.ts"), "utf8");
    for (const t of TABLES) {
      expect(src).not.toContain(t);
    }
    // The sanity pole: this grep IS capable of finding a table that is there.
    // Without it, a typo'd path or an empty read would make D1 pass vacuously.
    expect(src).toContain("spv_deployment");
  });

  it("D2 no OTHER self-heal installer defines them either", () => {
    const dir = path.join(ROOT, "server", "lib");
    const installers = fs.readdirSync(dir).filter((f) => /^apply.*\.ts$/.test(f));
    // The sweep must actually be sweeping something.
    expect(installers.length).toBeGreaterThan(1);
    expect(installers).toContain("applySpvInstitutionalSchema.ts");
    for (const f of installers) {
      if (f === "applySpvInstitutionalSchema.ts") continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const t of TABLES) {
        expect(`${f}:${src.includes(t)}`).toBe(`${f}:false`);
      }
    }
  });

  it("D3 0178 is additive — it contains no DROP, no DELETE and no UPDATE", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf8").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    // …and it really did have content to check.
    expect(sql).toMatch(/CREATE\s+TABLE/i);
  });
});
