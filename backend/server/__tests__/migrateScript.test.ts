/**
 * Wave A / Change 1 — migrate script test.
 *
 * Asserts:
 *   1. The runMigrations() function applies a synthetic migration set against
 *      a fresh :memory: SQLite DB and reports all files applied.
 *   2. Re-running is a no-op (idempotent — applied set unchanged).
 *   3. A genuinely-invalid SQL statement fails the runner cleanly with a
 *      descriptive error.
 *   4. The runner correctly tracks the applied ledger in
 *      `__drizzle_migrations_applied`.
 *
 * The test isolates the runner from connection.ts inline-DDL by using
 * `skipInlineBaseline: true`, so it can validate the SQL-file applier
 * surface area independently.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { runMigrations, splitStatements } from "../db/migrate";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
}

function writeMigration(dir: string, name: string, sql: string): void {
  fs.writeFileSync(path.join(dir, name), sql, "utf8");
}

function silentLog() {
  const out: string[] = [];
  return {
    info: (m: string) => out.push("info: " + m),
    warn: (m: string) => out.push("warn: " + m),
    error: (m: string) => out.push("error: " + m),
    lines: out,
  };
}

describe("server/db/migrate.ts — runMigrations()", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    dbPath = path.join(tmpDir, "test.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* noop */ }
  });

  it("applies a fresh migration set in numeric order", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    writeMigration(migDir, "0001_init.sql", `
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    `);
    writeMigration(migDir, "0002_add_email.sql", `
      ALTER TABLE users ADD COLUMN email TEXT;
    `);
    writeMigration(migDir, "0003_seed.sql", `
      INSERT INTO users (id, name, email) VALUES ('u1', 'Alice', 'alice@example.com');
    `);

    const log = silentLog();
    const result = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log,
    });

    expect(result.driver).toBe("sqlite");
    expect(result.total).toBe(3);
    expect(result.applied).toEqual([
      "0001_init.sql",
      "0002_add_email.sql",
      "0003_seed.sql",
    ]);
    expect(result.skipped).toEqual([]);

    // Verify DB state.
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare("PRAGMA table_info('users')").all() as any[];
    expect(cols.map((c) => c.name).sort()).toEqual(["email", "id", "name"]);
    const rows = db.prepare("SELECT id, name, email FROM users").all() as any[];
    expect(rows).toEqual([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
    const ledger = db
      .prepare("SELECT name FROM __drizzle_migrations_applied ORDER BY name")
      .all() as any[];
    expect(ledger.map((r) => r.name)).toEqual([
      "0001_init.sql",
      "0002_add_email.sql",
      "0003_seed.sql",
    ]);
    db.close();
  });

  it("is idempotent — re-running applies zero new migrations", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    writeMigration(migDir, "0001_init.sql", `
      CREATE TABLE counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
    `);

    const log1 = silentLog();
    const r1 = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log: log1,
    });
    expect(r1.applied.length).toBe(1);
    expect(r1.skipped.length).toBe(0);

    const log2 = silentLog();
    const r2 = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log: log2,
    });
    expect(r2.applied.length).toBe(0);
    expect(r2.skipped.length).toBe(1);
    expect(r2.skipped).toEqual(["0001_init.sql"]);
  });

  it("fails cleanly on a genuinely-broken migration with descriptive error", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    writeMigration(migDir, "0001_broken.sql", `
      CREATE TABLE WITH BAD SYNTAX HERE (foo
    `);

    const log = silentLog();
    await expect(
      runMigrations({
        databaseUrl: `file:${dbPath}`,
        migrationsDir: migDir,
        skipInlineBaseline: true,
        log,
      }),
    ).rejects.toThrow(/0001_broken\.sql failed/);

    // After failure, the ledger should NOT contain the broken file.
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations_applied'")
      .all();
    if (tables.length > 0) {
      const ledger = db
        .prepare("SELECT name FROM __drizzle_migrations_applied")
        .all() as any[];
      expect(ledger.map((r) => r.name)).not.toContain("0001_broken.sql");
    }
    db.close();
  });

  it("tolerates idempotent re-application (duplicate column / table-already-exists)", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    // 0001 creates a table, 0002 tries to re-create the same table + add a
    // column whose name already exists. Both must be treated as idempotent.
    writeMigration(migDir, "0001_init.sql", `
      CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, val INTEGER);
    `);
    writeMigration(migDir, "0002_duplicate_create.sql", `
      CREATE TABLE t (id TEXT PRIMARY KEY, val INTEGER);
      ALTER TABLE t ADD COLUMN val INTEGER;
      CREATE TABLE IF NOT EXISTS t2 (id TEXT PRIMARY KEY);
    `);

    const log = silentLog();
    const result = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log,
    });
    expect(result.applied.length).toBe(2);

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('t', 't2') ORDER BY name")
      .all() as any[];
    expect(tables.map((r) => r.name)).toEqual(["t", "t2"]);
    db.close();
  });

  it("applies migrations in numeric order when filenames are out-of-shuffle", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    // Create in reverse order on disk; runner must still apply 0001 → 0002 → 0003.
    writeMigration(migDir, "0003_third.sql", `
      INSERT INTO ordering_test (step) VALUES ('three');
    `);
    writeMigration(migDir, "0001_first.sql", `
      CREATE TABLE ordering_test (step TEXT NOT NULL);
      INSERT INTO ordering_test (step) VALUES ('one');
    `);
    writeMigration(migDir, "0002_second.sql", `
      INSERT INTO ordering_test (step) VALUES ('two');
    `);

    const log = silentLog();
    const result = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log,
    });
    expect(result.applied).toEqual([
      "0001_first.sql",
      "0002_second.sql",
      "0003_third.sql",
    ]);

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT step FROM ordering_test ORDER BY rowid").all() as any[];
    expect(rows.map((r) => r.step)).toEqual(["one", "two", "three"]);
    db.close();
  });

  it("detects sqlite driver when DATABASE_URL is file:// or unset", async () => {
    const migDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migDir);
    writeMigration(migDir, "0001_noop.sql", `CREATE TABLE k (id TEXT);`);

    const r = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: migDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });
    expect(r.driver).toBe("sqlite");
  });
});

describe("server/db/migrate.ts — splitStatements()", () => {
  it("splits on `;` outside string literals", () => {
    const sql = "CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);";
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toMatch(/CREATE TABLE a/);
    expect(stmts[1]).toMatch(/CREATE TABLE b/);
  });

  it("does not split inside single-quoted strings", () => {
    const sql = "INSERT INTO t VALUES ('a;b;c'); SELECT 1;";
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain("'a;b;c'");
  });

  it("ignores `;` in line comments", () => {
    const sql = "CREATE TABLE x (id TEXT); -- and; more; semicolons\nSELECT 1;";
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("   \n  ")).toEqual([]);
  });

  it("handles trailing statement without semicolon", () => {
    const sql = "CREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT)";
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
  });
});
