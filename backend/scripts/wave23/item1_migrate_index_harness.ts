/**
 * WAVE 23 · ITEM 1 · WAIVER-3 — falsification harness for the migration runner.
 *
 * Falsifies BOTH poles, per the wave brief:
 *   POLE A  a failing CREATE UNIQUE INDEX must be FATAL (throw; non-zero exit
 *           from the script entry point; nothing recorded).
 *   POLE B  a genuinely optional perf index must still WARN without blocking.
 *   POLE C  a migration whose perf index was skipped must be RETRYABLE — i.e.
 *           NOT present in __drizzle_migrations_applied after the run, and
 *           re-run on the next invocation.
 *   POLE D  the happy path is unchanged: clean migrations record normally and
 *           re-running is a no-op.
 *   POLE E  CREATE UNIQUE INDEX that merely already exists is still idempotent.
 *   POLE F  a CREATE UNIQUE INDEX that fails because the table holds duplicate
 *           rows ("UNIQUE constraint failed") is FATAL, not swallowed.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave23/item1_migrate_index_harness.ts
 * Exit 0 = all asserts pass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { runMigrations } from "../../server/db/migrate.ts";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}
/** Print the verdict and exit. Called at the end, and early when a pole
 *  cannot continue — so a caught defect always surfaces as `FAIL <n>/<n>
 *  asserts failed`, never as an uncaught crash the runner would misread. */
function report(): never {
  if (failures.length > 0) {
    console.error(`FAIL item1_migrate_index_harness: ${failures.length}/${asserts} asserts failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS item1_migrate_index_harness: ${asserts} asserts, 0 failures`);
  process.exit(0);
}

const silent = { info() {}, warn() {}, error() {} };
function capturing() {
  const lines: string[] = [];
  return {
    lines,
    log: {
      info: (m: string) => lines.push(`INFO ${m}`),
      warn: (m: string) => lines.push(`WARN ${m}`),
      error: (m: string) => lines.push(`ERROR ${m}`),
    },
  };
}

function tmpCase(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `w23-item1-${name}-`));
  const migDir = path.join(dir, "migrations");
  fs.mkdirSync(migDir);
  return { dir, migDir, dbPath: path.join(dir, "test.db") };
}
function write(migDir: string, name: string, sql: string) {
  fs.writeFileSync(path.join(migDir, name), sql, "utf8");
}
function tracker(dbPath: string): string[] {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations_applied'")
      .all();
    if (t.length === 0) return [];
    return (db.prepare("SELECT name FROM __drizzle_migrations_applied ORDER BY name").all() as any[]).map(
      (r) => r.name,
    );
  } finally {
    db.close();
  }
}
function objectExists(dbPath: string, type: string, name: string): boolean {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type=? AND name=?").all(type, name) as any[]).length > 0;
  } finally {
    db.close();
  }
}

async function main() {
  /* ---------------- POLE A — failing CREATE UNIQUE INDEX is FATAL --------- */
  {
    const c = tmpCase("unique-fatal");
    write(c.migDir, "0001_base.sql", `CREATE TABLE probe (id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL);`);
    write(
      c.migDir,
      "0002_bad_unique.sql",
      `CREATE UNIQUE INDEX uq_probe_missing ON probe(column_that_does_not_exist);`,
    );
    let threw: Error | null = null;
    try {
      await runMigrations({
        databaseUrl: `file:${c.dbPath}`,
        migrationsDir: c.migDir,
        skipInlineBaseline: true,
        log: silent,
      } as any);
    } catch (e: any) {
      threw = e;
    }
    ok(threw !== null, "POLE A: failing CREATE UNIQUE INDEX must throw");
    ok(
      !!threw && /unique index is a data-integrity constraint/i.test(threw.message),
      "POLE A: error message must name the constraint reason",
    );
    eq(tracker(c.dbPath), ["0001_base.sql"], "POLE A: bad unique-index migration must NOT be recorded");
    ok(!objectExists(c.dbPath, "index", "uq_probe_missing"), "POLE A: the unique index is genuinely absent");
  }

  /* --- POLE A2 — same case through the SCRIPT entry point: non-zero exit --- */
  {
    const c = tmpCase("unique-exit");
    write(c.migDir, "0001_base.sql", `CREATE TABLE probe (id INTEGER PRIMARY KEY);`);
    write(c.migDir, "0002_bad_unique.sql", `CREATE UNIQUE INDEX uq_probe_missing ON probe(nope);`);
    let exitCode = 0;
    let out = "";
    try {
      out = execFileSync(
        "npx",
        ["tsx", path.resolve(process.cwd(), "server/db/migrate.ts")],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            DATABASE_URL: `file:${c.dbPath}`,
            MIGRATIONS_DIR: c.migDir,
          },
        },
      );
    } catch (e: any) {
      exitCode = typeof e.status === "number" ? e.status : -1;
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    ok(exitCode !== 0, `POLE A2: script exit must be non-zero (was ${exitCode})`);
    ok(/FATAL/.test(out), "POLE A2: script output must contain FATAL");
  }

  /* -------- POLE B — a plain perf index still WARNS without blocking ------ */
  {
    const c = tmpCase("perf-warn");
    write(c.migDir, "0001_base.sql", `CREATE TABLE probe (id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL);`);
    write(
      c.migDir,
      "0002_bad_index.sql",
      `CREATE INDEX idx_probe_missing ON probe(column_that_does_not_exist);`,
    );
    write(c.migDir, "0003_after.sql", `CREATE TABLE probe_after (id INTEGER PRIMARY KEY);`);
    const cap = capturing();
    let r: any = null;
    let poleBThrew: Error | null = null;
    try {
      r = await runMigrations({
        databaseUrl: `file:${c.dbPath}`,
        migrationsDir: c.migDir,
        skipInlineBaseline: true,
        log: cap.log,
      } as any);
    } catch (e: any) {
      poleBThrew = e;
    }
    ok(poleBThrew === null, `POLE B: an optional perf index must NOT block the runner (threw: ${poleBThrew?.message})`);
    if (poleBThrew !== null) {
      // Report and stop this case cleanly rather than crashing the harness:
      // a crash reads as "harness bug", an assertion reads as "defect found".
      console.error(`FAIL item1 POLE B aborted early: ${poleBThrew.message}`);
      report();
    }
    ok(
      cap.lines.some((l) => l.startsWith("WARN") && /skipped perf index/.test(l)),
      "POLE B: a warning is emitted for the optional perf index",
    );
    ok(
      objectExists(c.dbPath, "table", "probe_after"),
      "POLE B: the runner did NOT block — a later migration still applied",
    );
    eq(r!.applied, ["0001_base.sql", "0003_after.sql"], "POLE B: only clean files count as applied");

    /* ---- POLE C — the skipped migration is RETRYABLE, not silently done --- */
    eq(r!.deferred, ["0002_bad_index.sql"], "POLE C: skipped file is reported as deferred");
    eq(
      tracker(c.dbPath),
      ["0001_base.sql", "0003_after.sql"],
      "POLE C: skipped file is NOT in __drizzle_migrations_applied",
    );
    ok(
      cap.lines.some((l) => l.startsWith("WARN") && /remains PENDING/.test(l)),
      "POLE C: the operator is told the migration is pending",
    );

    // Second run must re-attempt the deferred file (this is the whole point).
    const cap2 = capturing();
    const r2 = await runMigrations({
      databaseUrl: `file:${c.dbPath}`,
      migrationsDir: c.migDir,
      skipInlineBaseline: true,
      log: cap2.log,
    } as any);
    eq(r2.deferred, ["0002_bad_index.sql"], "POLE C: second run RETRIES the deferred migration");
    eq(r2.applied, [], "POLE C: second run records nothing new");
    eq(r2.skipped, ["0001_base.sql", "0003_after.sql"], "POLE C: the clean files are not re-run");

    // And once the underlying schema defect is repaired, the retry succeeds.
    const db = new Database(c.dbPath);
    db.exec("ALTER TABLE probe ADD COLUMN column_that_does_not_exist INTEGER");
    db.close();
    const r3 = await runMigrations({
      databaseUrl: `file:${c.dbPath}`,
      migrationsDir: c.migDir,
      skipInlineBaseline: true,
      log: silent,
    } as any);
    eq(r3.deferred, [], "POLE C: after repair the retry has nothing deferred");
    eq(r3.applied, ["0002_bad_index.sql"], "POLE C: after repair the migration finally records");
    ok(objectExists(c.dbPath, "index", "idx_probe_missing"), "POLE C: the index now exists");
  }

  /* -------- POLE D — happy path unchanged; re-run is a clean no-op -------- */
  {
    const c = tmpCase("happy");
    write(
      c.migDir,
      "0001_init.sql",
      `CREATE TABLE t (id TEXT PRIMARY KEY, val INTEGER);
       CREATE INDEX idx_t_val ON t(val);
       CREATE UNIQUE INDEX uq_t_val ON t(val);`,
    );
    const r = await runMigrations({
      databaseUrl: `file:${c.dbPath}`,
      migrationsDir: c.migDir,
      skipInlineBaseline: true,
      log: silent,
    } as any);
    eq(r.applied, ["0001_init.sql"], "POLE D: clean migration applies");
    eq(r.deferred, [], "POLE D: nothing deferred on a clean run");
    eq(tracker(c.dbPath), ["0001_init.sql"], "POLE D: recorded in the tracker");
    ok(objectExists(c.dbPath, "index", "uq_t_val"), "POLE D: unique index created");
    const r2 = await runMigrations({
      databaseUrl: `file:${c.dbPath}`,
      migrationsDir: c.migDir,
      skipInlineBaseline: true,
      log: silent,
    } as any);
    eq(r2.applied, [], "POLE D: re-run applies nothing");
    eq(r2.skipped, ["0001_init.sql"], "POLE D: re-run reports the file as skipped");
  }

  /* --- POLE E — CREATE UNIQUE INDEX that already exists is idempotent ----- */
  {
    const c = tmpCase("unique-exists");
    write(c.migDir, "0001_init.sql", `CREATE TABLE t (id TEXT PRIMARY KEY, val INTEGER);`);
    write(c.migDir, "0002_uq.sql", `CREATE UNIQUE INDEX uq_t_val ON t(val);`);
    // Pre-create the index out of band, exactly like the inline baseline does.
    await runMigrations({
      databaseUrl: `file:${c.dbPath}`,
      migrationsDir: c.migDir,
      skipInlineBaseline: true,
      log: silent,
    } as any);
    const db = new Database(c.dbPath);
    db.exec("DELETE FROM __drizzle_migrations_applied WHERE name='0002_uq.sql'");
    db.close();
    let threw: Error | null = null;
    let r: any = null;
    try {
      r = await runMigrations({
        databaseUrl: `file:${c.dbPath}`,
        migrationsDir: c.migDir,
        skipInlineBaseline: true,
        log: silent,
      } as any);
    } catch (e: any) {
      threw = e;
    }
    ok(threw === null, `POLE E: an already-existing unique index must stay idempotent (threw: ${threw?.message})`);
    eq(r?.applied, ["0002_uq.sql"], "POLE E: the re-run records normally");
    eq(r?.deferred, [], "POLE E: nothing deferred");
  }

  /* --- POLE F — unique index blocked by DUPLICATE DATA is fatal ----------- */
  {
    const c = tmpCase("unique-dupes");
    write(
      c.migDir,
      "0001_init.sql",
      `CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT);
       INSERT INTO t (id, email) VALUES (1, 'a@x.com');
       INSERT INTO t (id, email) VALUES (2, 'a@x.com');`,
    );
    write(c.migDir, "0002_uq.sql", `CREATE UNIQUE INDEX uq_t_email ON t(email);`);
    let threw: Error | null = null;
    try {
      await runMigrations({
        databaseUrl: `file:${c.dbPath}`,
        migrationsDir: c.migDir,
        skipInlineBaseline: true,
        log: silent,
      } as any);
    } catch (e: any) {
      threw = e;
    }
    ok(threw !== null, "POLE F: duplicate rows must make CREATE UNIQUE INDEX fatal, not idempotent");
    eq(tracker(c.dbPath), ["0001_init.sql"], "POLE F: the failed unique-index migration is not recorded");
    ok(!objectExists(c.dbPath, "index", "uq_t_email"), "POLE F: the unique index is absent");
  }

  report();
}

main().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
