/**
 * w-collective Wave 2 Stage A — migrations 0116..0120.
 *
 * These tests apply the REAL migration files (read out of `migrations/`, not
 * fixtures) against throwaway on-disk SQLite databases via the real runner,
 * server/db/migrate.ts:runMigrations. Two paths are exercised for each
 * migration, because they are genuinely different code paths in this codebase:
 *
 *   FRESH DB     — connection.ts's inline baseline builds the schema, then the
 *                  migrations layer on top. Here every `ALTER TABLE … ADD
 *                  COLUMN` is expected to be a swallowed duplicate-column
 *                  no-op, and the tables must come from the CREATE literals.
 *   EXISTING DB  — a database built in the PRE-0116 shape (network_posts with
 *                  no scope columns, comms_channels in the old runtime shape,
 *                  users with no location). Here the CREATE TABLE IF NOT EXISTS
 *                  statements are the no-ops and the guarded ALTERs are what
 *                  must land. This is the deployed-production path.
 *
 * ANTI-VACUITY. Every assertion below is about a table or column that does not
 * exist before this change set, or about backfill bookkeeping introduced by
 * 0118. Run against the tree without migrations/0116..0120 present, this file
 * fails: the fresh-DB cases fail on the missing `migration_backfill_markers` /
 * `company_followers` / engagement tables, the existing-DB cases fail with
 * "no such column: scope", and the backfill cases fail because no marker or
 * journal row is ever written. That pre-change failure was executed and
 * recorded in work/_W2A_RESULT.md rather than asserted here.
 *
 * The one thing these tests deliberately do NOT assert is behaviour: Stage A is
 * schema only. There is no read path over these tables yet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate";

const REPO_ROOT = process.cwd();
const CANON = path.join(REPO_ROOT, "migrations");

/** The five files this stage adds, in ledger order. */
const STAGE_A = [
  "0116_company_followers.sql",
  "0117_comms_channel_anchors.sql",
  "0118_network_post_scope.sql",
  "0119_network_post_engagement.sql",
  "0120_user_profile_location.sql",
];

/** The cutoff literal baked into 0118. Anything after it must NOT be touched. */
const CUTOFF = "2026-07-28T00:00:00.000Z";
const MARKER = "0118_network_post_scope_legacy";

const silentLog = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
});

function columnsOf(db: any, table: string): string[] {
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as any[]).map((c) => c.name);
}
function tableExists(db: any, table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
}
function indexExists(db: any, name: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name);
}

describe("w-collective Wave 2 Stage A — migrations 0116..0120", () => {
  let tmpDir: string;
  let dbPath: string;
  /** A migrations dir containing ONLY the five Stage A files (real copies). */
  let stageDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "w2a-mig-"));
    dbPath = path.join(tmpDir, "w2a.db");
    stageDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(stageDir);
    for (const f of STAGE_A) {
      // Copy the REAL file — if a migration is missing or malformed, these
      // tests are the thing that notices.
      fs.copyFileSync(path.join(CANON, f), path.join(stageDir, f));
    }
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  /** Build a database in the PRE-0116 shape: exactly the columns that existed
   *  before this change set, so the guarded ALTERs are what has to work. */
  function seedLegacyDb(): any {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE network_posts (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT NOT NULL,
        author_user_id TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT 'all',
        body TEXT NOT NULL,
        content_json TEXT,
        likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        parent_post_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT
      );
      -- The exact shape commsStore.persistChannel created before 0117.
      CREATE TABLE comms_channels (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        participant_user_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT,
        deleted_at TEXT
      );
    `);
    return db;
  }

  async function applyStageA(): Promise<void> {
    await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      // Only the five files under test; the legacy/base tables are provided by
      // seedLegacyDb() or by the inline baseline case below.
      skipInlineBaseline: true,
      log: silentLog(),
    });
  }

  // -------------------------------------------------------------- fresh DB
  it("FRESH DB: the inline baseline alone already provides every Stage A table and column (self-heal half 1)", async () => {
    // No migrations at all — just connection.ts's inline DDL, which is the ONLY
    // thing that runs on the :memory: test path and on a brand-new database.
    const raw = new Database(dbPath);
    const conn: any = await import("../db/connection");
    conn.applyInlineMigrationsForFreshDb(raw);

    expect(tableExists(raw, "company_followers")).toBe(true);
    expect(tableExists(raw, "comms_channels")).toBe(true);
    expect(tableExists(raw, "network_post_likes")).toBe(true);
    expect(tableExists(raw, "network_post_comments")).toBe(true);
    expect(tableExists(raw, "network_post_shares")).toBe(true);
    expect(tableExists(raw, "migration_backfill_markers")).toBe(true);
    expect(tableExists(raw, "network_post_scope_backfill")).toBe(true);

    expect(columnsOf(raw, "network_posts")).toEqual(
      expect.arrayContaining(["scope", "company_id", "chapter_id"]),
    );
    expect(columnsOf(raw, "comms_channels")).toEqual(
      expect.arrayContaining(["company_id", "round_id", "chapter_id", "kind"]),
    );
    expect(columnsOf(raw, "users")).toContain("location");

    // NO SILENT DROPS — the aggregate counters 0119 sits beside must survive.
    expect(columnsOf(raw, "network_posts")).toEqual(
      expect.arrayContaining(["likes", "comments", "audience", "tenant_id"]),
    );
    raw.close();
  });

  it("FRESH DB: applying 0116..0120 on top of the inline baseline is a clean no-op re-application", async () => {
    const raw = new Database(dbPath);
    const conn: any = await import("../db/connection");
    conn.applyInlineMigrationsForFreshDb(raw);
    raw.close();

    // Every ADD COLUMN here duplicates a column the baseline already created;
    // the runner must swallow those and still record all five as applied.
    const result = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });
    expect(result.applied).toEqual(STAGE_A);

    const db = new Database(dbPath, { readonly: true });
    expect(columnsOf(db, "network_posts")).toEqual(
      expect.arrayContaining(["scope", "company_id", "chapter_id"]),
    );
    expect(tableExists(db, "company_followers")).toBe(true);
    db.close();
  });

  // ----------------------------------------------------------- existing DB
  it("EXISTING DB: guarded ALTERs land the new columns on a pre-0116 database (self-heal half 2)", async () => {
    const seeded = seedLegacyDb();
    expect(columnsOf(seeded, "network_posts")).not.toContain("scope");
    expect(columnsOf(seeded, "comms_channels")).not.toContain("company_id");
    expect(columnsOf(seeded, "users")).not.toContain("location");
    seeded.close();

    await applyStageA();

    const db = new Database(dbPath, { readonly: true });
    expect(columnsOf(db, "network_posts")).toEqual(
      expect.arrayContaining(["scope", "company_id", "chapter_id"]),
    );
    expect(columnsOf(db, "comms_channels")).toEqual(
      expect.arrayContaining(["company_id", "round_id", "chapter_id"]),
    );
    expect(columnsOf(db, "users")).toContain("location");

    // 0116 / 0119 tables are created, with their lookup indexes in both
    // directions (0116) and on post_id (0119).
    expect(tableExists(db, "company_followers")).toBe(true);
    expect(indexExists(db, "uq_company_followers_user_company")).toBe(true);
    expect(indexExists(db, "idx_company_followers_user")).toBe(true);
    expect(indexExists(db, "idx_company_followers_company")).toBe(true);
    expect(indexExists(db, "idx_network_post_likes_post")).toBe(true);
    expect(indexExists(db, "idx_network_post_comments_post")).toBe(true);
    expect(indexExists(db, "idx_network_post_shares_post")).toBe(true);

    // Nothing was dropped from the legacy shape.
    expect(columnsOf(db, "network_posts")).toEqual(
      expect.arrayContaining(["likes", "comments", "audience", "tenant_id", "content_json"]),
    );
    db.close();
  });

  it("EXISTING DB: 0117 creates comms_channels when the table is ABSENT (a bare ALTER would abort the runner)", async () => {
    // The pre-0117 reality: comms_channels only ever existed if a channel had
    // been persisted. On a database where none had, the table is missing — and
    // migrate.ts does NOT swallow "no such table" for ALTER statements.
    const db0 = new Database(dbPath);
    db0.exec(`CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, email TEXT, name TEXT, role TEXT);`);
    db0.exec(`CREATE TABLE network_posts (
      id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, author_user_id TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'all', body TEXT NOT NULL, created_at TEXT NOT NULL);`);
    expect(tableExists(db0, "comms_channels")).toBe(false);
    db0.close();

    const result = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });
    expect(result.applied).toEqual(STAGE_A);

    const db = new Database(dbPath, { readonly: true });
    expect(tableExists(db, "comms_channels")).toBe(true);
    // Canonical shape preserved, plus the anchors.
    expect(columnsOf(db, "comms_channels").sort()).toEqual([
      "chapter_id",
      "company_id",
      "created_at",
      "deleted_at",
      "id",
      "kind",
      "metadata_json",
      "participant_user_ids_json",
      "round_id",
    ]);
    db.close();
  });

  it("re-running the whole set against the same database applies zero new migrations and changes no shape", async () => {
    seedLegacyDb().close();
    await applyStageA();

    const before = new Database(dbPath, { readonly: true });
    const shapeBefore = {
      posts: columnsOf(before, "network_posts").sort(),
      channels: columnsOf(before, "comms_channels").sort(),
      users: columnsOf(before, "users").sort(),
    };
    before.close();

    const second = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(STAGE_A);

    const after = new Database(dbPath, { readonly: true });
    expect(columnsOf(after, "network_posts").sort()).toEqual(shapeBefore.posts);
    expect(columnsOf(after, "comms_channels").sort()).toEqual(shapeBefore.channels);
    expect(columnsOf(after, "users").sort()).toEqual(shapeBefore.users);
    after.close();
  });

  // ------------------------------------------------- 0118 safe-default rule
  it("0118: `scope` has NO default — an unset scope stays NULL so the read side can fail closed", async () => {
    seedLegacyDb().close();
    await applyStageA();

    const db = new Database(dbPath);
    const scopeCol = (db.prepare("PRAGMA table_info('network_posts')").all() as any[])
      .find((c) => c.name === "scope");
    expect(scopeCol).toBeTruthy();
    // A DEFAULT here would let future rows drift into the permissive treatment.
    expect(scopeCol.dflt_value).toBeNull();

    // Prove it end to end: a post inserted without a scope reads back NULL, not
    // 'network'.
    db.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, body, created_at)
         VALUES ('p_future', 'tenant_platform', 'u_1', 'hi', '2026-12-01T00:00:00.000Z')`,
    ).run();
    const row = db.prepare("SELECT scope FROM network_posts WHERE id = 'p_future'").get() as any;
    expect(row.scope).toBeNull();
    db.close();
  });

  // ------------------------------------------- 0118 one-time legacy backfill
  it("0118 backfill: promotes ONLY pre-cutoff scope-NULL rows, journals their prior values, and writes the marker", async () => {
    const seeded = seedLegacyDb();
    const ins = seeded.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, body, created_at)
         VALUES (?, 'tenant_platform', 'u_1', 'body', ?)`,
    );
    ins.run("p_legacy_a", "2026-05-01T00:00:00.000Z");
    ins.run("p_legacy_b", "2026-07-27T23:59:59.999Z"); // just inside the cutoff
    ins.run("p_after", "2026-07-28T00:00:00.001Z");    // just outside — must NOT move
    seeded.close();

    await applyStageA();

    const db = new Database(dbPath, { readonly: true });
    const scopes = Object.fromEntries(
      (db.prepare("SELECT id, scope FROM network_posts ORDER BY id").all() as any[])
        .map((r) => [r.id, r.scope]),
    );
    expect(scopes).toEqual({
      p_after: null,          // BOUNDED BY TIME — future rows are untouched
      p_legacy_a: "network",
      p_legacy_b: "network",
    });

    // Journalled for undo, with prior values captured (all NULL, because the
    // columns were added by this same migration — recorded honestly rather than
    // assumed).
    const journal = db
      .prepare("SELECT * FROM network_post_scope_backfill ORDER BY post_id")
      .all() as any[];
    expect(journal.map((r) => r.post_id)).toEqual(["p_legacy_a", "p_legacy_b"]);
    for (const r of journal) {
      expect(r.migration_id).toBe("0118");
      expect(r.prior_scope).toBeNull();
      expect(r.prior_company_id).toBeNull();
      expect(r.prior_chapter_id).toBeNull();
      expect(r.new_scope).toBe("network");
      expect(r.backfilled_at).toBe(CUTOFF);
    }

    const marker = db
      .prepare("SELECT * FROM migration_backfill_markers WHERE marker = ?")
      .get(MARKER) as any;
    expect(marker).toBeTruthy();
    expect(marker.rows_affected).toBe(2);
    db.close();
  });

  it("0118 backfill: the marker makes a re-run a no-op EVEN AFTER AN UNDO (the guard value-checks alone cannot give)", async () => {
    const seeded = seedLegacyDb();
    seeded
      .prepare(
        `INSERT INTO network_posts (id, tenant_id, author_user_id, body, created_at)
           VALUES ('p_legacy_a', 'tenant_platform', 'u_1', 'body', '2026-05-01T00:00:00.000Z')`,
      )
      .run();
    seeded.close();

    await applyStageA();

    const db = new Database(dbPath);
    expect((db.prepare("SELECT scope FROM network_posts WHERE id='p_legacy_a'").get() as any).scope)
      .toBe("network");

    // --- UNDO, exactly the recipe documented in the migration header. Note it
    // leaves the marker row in place.
    db.prepare(
      `UPDATE network_posts
          SET scope      = (SELECT b.prior_scope      FROM network_post_scope_backfill b
                             WHERE b.post_id = network_posts.id AND b.migration_id = '0118'),
              company_id = (SELECT b.prior_company_id FROM network_post_scope_backfill b
                             WHERE b.post_id = network_posts.id AND b.migration_id = '0118'),
              chapter_id = (SELECT b.prior_chapter_id FROM network_post_scope_backfill b
                             WHERE b.post_id = network_posts.id AND b.migration_id = '0118')
        WHERE id IN (SELECT post_id FROM network_post_scope_backfill WHERE migration_id = '0118')`,
    ).run();
    expect((db.prepare("SELECT scope FROM network_posts WHERE id='p_legacy_a'").get() as any).scope)
      .toBeNull();

    // Force the file to be considered unapplied, so the SQL genuinely re-runs.
    db.prepare("DELETE FROM __drizzle_migrations_applied WHERE name = ?")
      .run("0118_network_post_scope.sql");
    db.close();

    const rerun = await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });
    expect(rerun.applied).toEqual(["0118_network_post_scope.sql"]);

    // The undo held: the value-based guards (scope IS NULL, created_at <= cutoff)
    // both match again, so ONLY the marker can be what stopped the re-apply.
    const after = new Database(dbPath, { readonly: true });
    expect((after.prepare("SELECT scope FROM network_posts WHERE id='p_legacy_a'").get() as any).scope)
      .toBeNull();
    expect(
      (after.prepare("SELECT COUNT(*) AS n FROM migration_backfill_markers WHERE marker = ?").get(MARKER) as any).n,
    ).toBe(1);
    after.close();
  });

  it("0118 backfill: a row created AFTER the migration ran can never be caught by a later re-run", async () => {
    seedLegacyDb().close();
    await applyStageA();

    const db = new Database(dbPath);
    // A brand-new post, no scope set — the safe-default case.
    db.prepare(
      `INSERT INTO network_posts (id, tenant_id, author_user_id, body, created_at)
         VALUES ('p_new', 'tenant_platform', 'u_2', 'new post', '2026-08-15T00:00:00.000Z')`,
    ).run();
    db.prepare("DELETE FROM __drizzle_migrations_applied WHERE name = ?")
      .run("0118_network_post_scope.sql");
    db.close();

    await runMigrations({
      databaseUrl: `file:${dbPath}`,
      migrationsDir: stageDir,
      skipInlineBaseline: true,
      log: silentLog(),
    });

    const after = new Database(dbPath, { readonly: true });
    expect((after.prepare("SELECT scope FROM network_posts WHERE id='p_new'").get() as any).scope)
      .toBeNull();
    expect(
      (after.prepare("SELECT COUNT(*) AS n FROM network_post_scope_backfill").get() as any).n,
    ).toBe(0);
    after.close();
  });

  // ------------------------------------------------------- drift protection
  it("the comms_channels shape is identical in the migration, the boot self-heal and the runtime DDL", () => {
    const anchors = ["company_id", "round_id", "chapter_id"];
    const mig = fs.readFileSync(path.join(CANON, "0117_comms_channel_anchors.sql"), "utf8");
    const conn = fs.readFileSync(path.join(REPO_ROOT, "server", "db", "connection.ts"), "utf8");
    const store = fs.readFileSync(path.join(REPO_ROOT, "server", "commsStore.ts"), "utf8");

    // Each source must contain a CREATE TABLE IF NOT EXISTS comms_channels
    // block carrying all three anchors. commsStore.ts's runtime DDL is the one
    // that actually built this table on every existing database, so if it drifts
    // from the migration the anchors depend on which path ran first.
    for (const [label, src] of [["migration 0117", mig], ["connection.ts", conn], ["commsStore.ts", store]] as const) {
      const block = src.match(/CREATE TABLE IF NOT EXISTS comms_channels \(([\s\S]*?)\)/);
      expect(block, `${label} has no comms_channels CREATE block`).toBeTruthy();
      for (const col of anchors) {
        expect(block![1], `${label} comms_channels block is missing ${col}`).toContain(col);
      }
    }
  });
});
