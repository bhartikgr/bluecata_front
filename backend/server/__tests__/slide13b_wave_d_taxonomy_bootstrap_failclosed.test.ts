/**
 * slide13b WAVE D — bootstrap is FAIL-CLOSED and RETRYABLE.
 *
 * Own file so the store's memo (`_ready`) starts cold. Proves:
 *   1. helper: missing SQL → MIGRATION_SQL_MISSING (no silent empty list)
 *   2. helper: non-SQLite dialect → UNSUPPORTED_DB_DIALECT (PG not claimed)
 *   3. helper: broken SQL → MIGRATION_EXEC_FAILED
 *   4. helper: seed rows deleted → verifier SEED_INCOMPLETE names them; full
 *      bootstrap re-runs the idempotent seed (D-B1: always executed, atomic)
 *   4b. D-B1: SQL missing with table present; mid-script failure leaves no
 *      partial install and retries; malformed pre-existing tables (right
 *      names, wrong PK / CHECK / index / column set / default / type) are
 *      TABLE_SHAPE_MISMATCH, never ready.
 *   5. store+HTTP: first bootstrap fails → 503 TAXONOMY_UNAVAILABLE; the
 *      failure is NOT memoised; the next request succeeds with 45 terms.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import Database from "better-sqlite3";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";

import {
  applyCompanyTaxonomySchema,
  readCompanyTaxonomyMigrationSql,
  verifyCompanyTaxonomySeed,
  TaxonomyBootstrapError,
} from "../lib/applyCompanyTaxonomySchema";
import { registerCompanyTaxonomyRoutes } from "../companyTaxonomyRoutes";

const sqlite = () => true;

function fresh() {
  return new Database(":memory:");
}

describe("helper · applyCompanyTaxonomySchema fails closed", () => {
  it("missing SQL → MIGRATION_SQL_MISSING, and the table is NOT created", () => {
    const db = fresh();
    let err: unknown;
    try {
      applyCompanyTaxonomySchema(db, { readSql: () => null, dialectIsSqlite: sqlite });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TaxonomyBootstrapError);
    expect((err as TaxonomyBootstrapError).code).toBe("MIGRATION_SQL_MISSING");
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='taxonomy_terms'`).get()).toBeUndefined();
  });

  it("non-SQLite dialect → UNSUPPORTED_DB_DIALECT before touching the DB", () => {
    const db = fresh();
    expect(() => applyCompanyTaxonomySchema(db, { dialectIsSqlite: () => false }))
      .toThrowError(expect.objectContaining({ code: "UNSUPPORTED_DB_DIALECT" }));
  });

  it("broken SQL → MIGRATION_EXEC_FAILED with the driver detail attached", () => {
    const db = fresh();
    let err: TaxonomyBootstrapError | undefined;
    try {
      applyCompanyTaxonomySchema(db, { readSql: () => "CREATE TABLE taxonomy_terms (;", dialectIsSqlite: sqlite });
    } catch (e) { err = e as TaxonomyBootstrapError; }
    expect(err?.code).toBe("MIGRATION_EXEC_FAILED");
    expect(err?.detail).toMatch(/syntax error/i);
  });

  it("two seed values deleted → the verifier names both (SEED_INCOMPLETE); a full bootstrap re-runs the idempotent seed and restores them without touching admin edits", () => {
    const db = fresh();
    applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
    db.prepare(`UPDATE taxonomy_terms SET label = 'Health Tech', active = 0 WHERE value = 'Healthtech'`).run();
    db.prepare(`DELETE FROM taxonomy_terms WHERE value IN ('Fintech','Sports')`).run();
    // The verifier alone is fail-closed and names the gaps …
    let err: TaxonomyBootstrapError | undefined;
    try { verifyCompanyTaxonomySeed(db); } catch (e) { err = e as TaxonomyBootstrapError; }
    expect(err?.code).toBe("SEED_INCOMPLETE");
    expect(err?.message).toMatch(/2 of 45/);
    expect(err?.detail).toBe("Fintech | Sports");
    // … and the full bootstrap (D-B1: the migration is ALWAYS executed, atomically)
    // repairs them via ON CONFLICT DO NOTHING while the admin's relabel + retire survive.
    const r = applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
    expect(r).toEqual({ applied: false, seed: { present: 45, expected: 45 } });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM taxonomy_terms`).get()).toEqual({ n: 45 });
    expect(db.prepare(`SELECT label, active FROM taxonomy_terms WHERE value='Healthtech'`).get()).toEqual({ label: "Health Tech", active: 0 });
    expect(db.prepare(`SELECT label, active FROM taxonomy_terms WHERE value='Fintech'`).get()).toEqual({ label: "Fintech", active: 1 });
  });

  it("SQL missing while the table ALREADY exists → MIGRATION_SQL_MISSING (the artifact is required on every path)", () => {
    const db = fresh();
    applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
    let err: TaxonomyBootstrapError | undefined;
    try { applyCompanyTaxonomySchema(db, { readSql: () => null, dialectIsSqlite: sqlite }); } catch (e) { err = e as TaxonomyBootstrapError; }
    expect(err?.code).toBe("MIGRATION_SQL_MISSING");
  });

  it("failure AFTER the first successful statement leaves NO partial table; a corrected retry then succeeds", () => {
    const db = fresh();
    const good = readCompanyTaxonomyMigrationSql()!;
    // Real DDL first, then a statement that fails part-way through the script.
    const broken = good.replace(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_taxonomy_terms_ns_label_nocase",
      "INSERT INTO no_such_table_0236 VALUES (1);\nCREATE UNIQUE INDEX IF NOT EXISTS ux_taxonomy_terms_ns_label_nocase",
    );
    let err: TaxonomyBootstrapError | undefined;
    try { applyCompanyTaxonomySchema(db, { readSql: () => broken, dialectIsSqlite: sqlite }); } catch (e) { err = e as TaxonomyBootstrapError; }
    expect(err?.code).toBe("MIGRATION_EXEC_FAILED");
    expect(err?.detail).toMatch(/no_such_table_0236/);
    // The CREATE TABLE that ran before the failure was rolled back with it.
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='taxonomy_terms'`).get()).toBeUndefined();
    expect(db.inTransaction).toBe(false);
    // Prerequisite restored → the retry installs everything.
    const r = applyCompanyTaxonomySchema(db, { readSql: () => good, dialectIsSqlite: sqlite });
    expect(r).toEqual({ applied: true, seed: { present: 45, expected: 45 } });
  });

  describe("D-B1 · a pre-existing table with the right NAMES but the wrong contract is TABLE_SHAPE_MISMATCH", () => {
    const withTable = (ddl: string, indexes: string[] = [
      `CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, label COLLATE NOCASE)`,
      `CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`,
    ]) => {
      const db = fresh();
      db.exec(ddl);
      for (const ix of indexes) db.exec(ix);
      return db;
    };
    const GOOD_DDL = `CREATE TABLE taxonomy_terms (
      namespace TEXT NOT NULL, value TEXT NOT NULL, label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      PRIMARY KEY (namespace, value))`;
    const expectShape = (db: InstanceType<typeof Database>, re: RegExp) => {
      let err: TaxonomyBootstrapError | undefined;
      try { applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite }); } catch (e) { err = e as TaxonomyBootstrapError; }
      expect(err?.code, err?.message).toBe("TABLE_SHAPE_MISMATCH");
      expect(err?.message).toMatch(re);
      return err;
    };

    it("control: a hand-built table matching the contract exactly passes and gets seeded", () => {
      const db = withTable(GOOD_DDL);
      const r = applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
      expect(r).toEqual({ applied: false, seed: { present: 45, expected: 45 } });
    });
    it("seven correct names, no constraints at all", () => {
      const db = withTable(`CREATE TABLE taxonomy_terms (namespace TEXT, value TEXT, label TEXT, active INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT)`, []);
      expectShape(db, /nullable|pk position/);
    });
    it("no composite primary key", () => {
      const db = withTable(GOOD_DDL.replace(",\n      PRIMARY KEY (namespace, value)", ""));
      expectShape(db, /pk position/);
    });
    it("primary key in the wrong order (value, namespace)", () => {
      const db = withTable(GOOD_DDL.replace("PRIMARY KEY (namespace, value)", "PRIMARY KEY (value, namespace)"));
      expectShape(db, /pk position/);
    });
    it("missing active CHECK", () => {
      const db = withTable(GOOD_DDL.replace(" CHECK (active IN (0, 1))", ""));
      expectShape(db, /CHECK \(active IN \(0, 1\)\)/);
    });
    it("missing case-insensitive unique label index", () => {
      const db = withTable(GOOD_DDL, [`CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`]);
      // The always-run migration would CREATE it IF NOT EXISTS — so prove the verifier catches
      // a same-named index with the WRONG definition (which IF NOT EXISTS silently keeps).
      const db2 = withTable(GOOD_DDL, [
        `CREATE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, label)`,
        `CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`,
      ]);
      expectShape(db2, /not UNIQUE/);
      const db3 = withTable(GOOD_DDL, [
        `CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, label)`,
        `CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`,
      ]);
      expectShape(db3, /COLLATE NOCASE/);
      // And the plain "missing" case is repaired by the migration and then passes.
      expect(applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite }).seed.present).toBe(45);
      expect(db.prepare(`SELECT "unique" AS u FROM pragma_index_list('taxonomy_terms') WHERE name='ux_taxonomy_terms_ns_label_nocase'`).get()).toEqual({ u: 1 });
    });
    it("wrongly-defined (namespace, active) index", () => {
      const db = withTable(GOOD_DDL, [
        `CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, label COLLATE NOCASE)`,
        `CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(active)`,
      ]);
      expectShape(db, /must be \(namespace, active\)/);
    });
    it("extra column", () => {
      const db = withTable(GOOD_DDL.replace("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',", "updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z', extra TEXT,"));
      expectShape(db, /unexpected column\(s\): extra/);
    });
    it("missing column → TABLE_SHAPE_MISMATCH naming it, nothing installed", () => {
      const db = withTable(GOOD_DDL.replace("sort_order INTEGER NOT NULL DEFAULT 0,\n", ""), []);
      expectShape(db, /missing column\(s\): sort_order/);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM taxonomy_terms`).get()).toEqual({ n: 0 });
      expect(db.inTransaction).toBe(false);
    });
    it("the migration's OWN shape assert also aborts on a malformed table (defence in depth, no partial seed)", () => {
      const db = withTable(`CREATE TABLE taxonomy_terms (namespace TEXT, value TEXT, label TEXT, active INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT)`, []);
      expect(() => db.exec(readCompanyTaxonomyMigrationSql()!)).toThrow(/CHECK constraint failed/);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM taxonomy_terms`).get()).toEqual({ n: 0 });
    });
    it("wrong default / wrong type", () => {
      expectShape(withTable(GOOD_DDL.replace("active INTEGER NOT NULL DEFAULT 1", "active INTEGER NOT NULL DEFAULT 0")), /default 0/);
      expectShape(withTable(GOOD_DDL.replace("sort_order INTEGER", "sort_order TEXT")), /type TEXT/);
    });
  });

  describe("D-B1b (Sol core-v2 repro) · verification runs INSIDE the savepoint — a rejected table keeps NO seed rows", () => {
    const REAL = () => readCompanyTaxonomyMigrationSql();
    const GOOD_DDL = `CREATE TABLE taxonomy_terms (
      namespace TEXT NOT NULL, value TEXT NOT NULL, label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      PRIMARY KEY (namespace, value))`;
    const n = (db: InstanceType<typeof Database>) =>
      (db.prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace='company_sector'`).get() as { n: number }).n;

    it("exact reviewer repro: correct columns, WRONG unique index (on value) → TABLE_SHAPE_MISMATCH and 0 rows committed", () => {
      const db = fresh();
      db.exec(GOOD_DDL);
      db.exec(`CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, value)`);
      db.exec(`CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`);
      expect(n(db)).toBe(0);
      let err: TaxonomyBootstrapError | undefined;
      try { applyCompanyTaxonomySchema(db, { readSql: REAL, dialectIsSqlite: sqlite }); } catch (e) { err = e as TaxonomyBootstrapError; }
      expect(err?.code).toBe("TABLE_SHAPE_MISMATCH");
      expect(`${err?.message} ${err?.detail ?? ""}`).toMatch(/ux_taxonomy_terms_ns_label_nocase/);
      expect(n(db)).toBe(0);                       // ← was 45 before the fix
      expect(db.inTransaction).toBe(false);
      // Falsification of the fix: the same call is deterministic on retry (still rejected, still 0).
      try { applyCompanyTaxonomySchema(db, { readSql: REAL, dialectIsSqlite: sqlite }); } catch { /* expected */ }
      expect(n(db)).toBe(0);
    });

    it("seed verification failure inside the savepoint also rolls the script back (trigger deletes inserted seed rows → SEED_INCOMPLETE, 0 rows, no open transaction)", () => {
      const db = fresh();
      db.exec(GOOD_DDL);
      db.exec(`CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, label COLLATE NOCASE)`);
      db.exec(`CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`);
      db.exec(`CREATE TRIGGER t_eat AFTER INSERT ON taxonomy_terms WHEN NEW.value IN ('Energy','Fintech')
               BEGIN DELETE FROM taxonomy_terms WHERE rowid = NEW.rowid; END`);
      let err: TaxonomyBootstrapError | undefined;
      try { applyCompanyTaxonomySchema(db, { readSql: REAL, dialectIsSqlite: sqlite }); } catch (e) { err = e as TaxonomyBootstrapError; }
      expect(err?.code).toBe("SEED_INCOMPLETE");
      expect(`${err?.message} ${err?.detail ?? ""}`).toMatch(/Energy/);
      expect(n(db)).toBe(0);                       // the other 43 inserted rows were rolled back too
      expect(db.inTransaction).toBe(false);
      db.exec(`DROP TRIGGER t_eat`);
      const r = applyCompanyTaxonomySchema(db, { readSql: REAL, dialectIsSqlite: sqlite });
      expect(r.seed).toEqual({ present: 45, expected: 45 });
      expect(n(db)).toBe(45);
    });

    it("when the caller is already inside a transaction, only OUR savepoint is rolled back; the outer transaction stays open and intact", () => {
      const db = fresh();
      db.exec(`CREATE TABLE outer_probe (x INTEGER)`);
      db.exec(`BEGIN`);
      db.exec(`INSERT INTO outer_probe VALUES (1)`);
      db.exec(GOOD_DDL);
      db.exec(`CREATE UNIQUE INDEX ux_taxonomy_terms_ns_label_nocase ON taxonomy_terms(namespace, value)`);
      db.exec(`CREATE INDEX idx_taxonomy_terms_ns_active ON taxonomy_terms(namespace, active)`);
      expect(() => applyCompanyTaxonomySchema(db, { readSql: REAL, dialectIsSqlite: sqlite })).toThrow(TaxonomyBootstrapError);
      expect(db.inTransaction).toBe(true);         // outer BEGIN still open
      expect(n(db)).toBe(0);
      expect((db.prepare(`SELECT COUNT(*) n FROM outer_probe`).get() as { n: number }).n).toBe(1);
      db.exec(`ROLLBACK`);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("happy path from the real mirror: applied:true then applied:false, 45/45 both times", () => {
    const db = fresh();
    const first = applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
    expect(first).toEqual({ applied: true, seed: { present: 45, expected: 45 } });
    const second = applyCompanyTaxonomySchema(db, { dialectIsSqlite: sqlite });
    expect(second.applied).toBe(false);
    expect(readCompanyTaxonomyMigrationSql()).toMatch(/CREATE TABLE IF NOT EXISTS taxonomy_terms/);
  });
});

describe("store + HTTP · failure is not memoised; next request retries and succeeds", () => {
  let app: Express;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerCompanyTaxonomyRoutes(app);
  });

  it("first request 503 TAXONOMY_UNAVAILABLE (SQL hidden), second request 200 with 45 terms", async () => {
    // Hide BOTH mirrors for exactly one bootstrap attempt.
    const realExists = fs.existsSync;
    const spy = vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      String(p).endsWith("0236_company_taxonomy.sql") ? false : realExists(p),
    );
    const r1 = await request(app).get("/api/company-taxonomy/company_sector").set("x-user-id", "u_admin");
    spy.mockRestore();
    expect(r1.status).toBe(503);
    expect(r1.body).toMatchObject({ ok: false, error: "TAXONOMY_UNAVAILABLE", code: "MIGRATION_SQL_MISSING" });
    // No silent empty list on the failure path.
    expect(r1.body.terms).toBeUndefined();

    const r2 = await request(app).get("/api/company-taxonomy/company_sector").set("x-user-id", "u_admin");
    expect(r2.status).toBe(200);
    expect(r2.body.terms).toHaveLength(45);

    // And a mutation before the retry could not have been accepted either:
    // there is no taxonomy_terms row from anything the 503 path did.
    const r3 = await request(app).get("/api/admin/company-taxonomy/company_sector?includeRetired=1").set("x-user-id", "u_admin");
    expect(r3.body.terms).toHaveLength(45);
  });
});
