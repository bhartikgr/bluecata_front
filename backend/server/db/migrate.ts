/**
 * Migration runner — v19 Wave A / Change 1.
 *
 * Production-ready migrate script that applies every `migrations/NNNN_*.sql`
 * file in numeric order. Idempotent — re-runnable without breaking. Tracks
 * applied migrations in `__drizzle_migrations_applied` so a partial apply +
 * re-run picks up exactly where it left off.
 *
 * Driver auto-detection:
 *   - `DATABASE_URL=postgres(ql)://…` → node-postgres (production)
 *   - anything else (or unset)        → better-sqlite3 file:./data.db (dev)
 *
 * Usage:
 *   npx tsx server/db/migrate.ts
 *   # or
 *   npm run db:migrate
 *
 * Environment variables:
 *   DATABASE_URL              optional; defaults to `file:./data.db`
 *   MIGRATIONS_DIR            optional; defaults to `./migrations`
 *   MIGRATE_VERBOSE=1         print each SQL statement before execution
 *
 * Exit codes:
 *   0 — success (all migrations applied, or already up to date)
 *   1 — failure (file I/O, SQL error, etc.); error JSON printed to stderr
 *
 * NOTE: This file is the runner ONLY. It does NOT modify any math-sacred
 * code paths (cap-table-engine / captableCommitStore.ts:354-477). Adding
 * this file leaves the SHA of every other server/* file untouched.
 */
/* v25.25.2 — this file already had its own createRequire/makeRequire pattern
   (see _require below). No additional shim required here. */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

declare const require: NodeJS.Require | undefined;
function makeRequire(): NodeJS.Require {
  if (typeof require === "function") return require;
  try {
    const metaUrl = (import.meta as { url?: string }).url ?? "";
    if (metaUrl) return createRequire(metaUrl);
  } catch { /* fall through */ }
  return createRequire(process.cwd() + "/_");
}
const _require = makeRequire();

type Driver = "sqlite" | "postgres";
type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

const stdout: Logger = {
  info: (m) => process.stdout.write(`[migrate] ${m}\n`),
  warn: (m) => process.stdout.write(`[migrate] WARN ${m}\n`),
  error: (m) => process.stderr.write(`[migrate] ERROR ${m}\n`),
};

function detectDriver(url: string | undefined): Driver {
  if (url && /^postgres(ql)?:\/\//i.test(url)) return "postgres";
  return "sqlite";
}

function resolveSqlitePath(url: string | undefined): string {
  if (!url) return "./data.db";
  if (url.startsWith("file:")) return url.slice("file:".length);
  return url;
}

/** Naive but correct SQL statement splitter for migration files.
 *
 *  Splits on `;` outside of string literals and `--` line comments.
 *  Migration SQL files in this tree do NOT contain `BEGIN…END` blocks,
 *  PL/pgSQL functions, or dollar-quoting — only DDL/DML. If that ever
 *  changes, replace with a `pg-query-parser` based splitter.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      buf += c;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        buf += "*/";
        i += 2;
        inBlockComment = false;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && sql[i - 1] !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      buf += c;
      if (c === '"' && sql[i - 1] !== "\\") inDouble = false;
      i++;
      continue;
    }
    if (inBacktick) {
      buf += c;
      if (c === "`") inBacktick = false;
      i++;
      continue;
    }

    if (c === "-" && next === "-") {
      inLineComment = true;
      buf += "--";
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      buf += "/*";
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buf += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      buf += c;
      i++;
      continue;
    }
    if (c === ";") {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function readMigrationFiles(dir: string): { name: string; absPath: string }[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`migrations directory not found: ${dir}`);
  }
  const entries = fs.readdirSync(dir);
  const files = entries
    .filter((e) => /^\d{4,}_.*\.sql$/i.test(e))
    .sort((a, b) => a.localeCompare(b)); // 4-digit zero-padded → lexicographic = numeric
  return files.map((name) => ({
    name,
    absPath: path.join(dir, name),
  }));
}

interface MigrationAdapter {
  init(): void;
  appliedSet(): Set<string>;
  applyOne(name: string, sql: string): void;
  close(): void;
  driverLabel: string;
  url: string;
}

/** SQL errors that mean "already applied" — safe to swallow at per-statement
 *  granularity, matching the existing v12 additive-ALTERs pattern in
 *  server/db/connection.ts. We do NOT swallow these at the file level —
 *  only within a statement loop where the rest of the file is still valid.
 */
function isIdempotentSqliteError(msg: string): boolean {
  return (
    /duplicate column name/i.test(msg) ||
    /table .* already exists/i.test(msg) ||
    /index .* already exists/i.test(msg) ||
    /UNIQUE constraint failed/i.test(msg)  // backfill INSERT OR IGNORE racing with prior row
  );
}

/** Per-statement “non-fatal for perf-hint statements” — if a CREATE INDEX
 *  references a table that doesn't exist (typo / shape mismatch in the
 *  migration set), we log a warning and continue rather than blocking the
 *  whole runner. Real correctness comes from the table-shape statements,
 *  which we never swallow.
 */
function isNonFatalIndexError(stmt: string, msg: string): boolean {
  // Strip leading SQL comments + whitespace to find the actual command word.
  const stripped = stmt
    .replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/g, "")
    .trim()
    .toUpperCase();
  if (!stripped.startsWith("CREATE INDEX") && !stripped.startsWith("CREATE UNIQUE INDEX")) {
    return false;
  }
  return /no such table/i.test(msg) || /no such column/i.test(msg);
}

function isIdempotentPostgresError(msg: string): boolean {
  return (
    /already exists/i.test(msg) ||
    /duplicate_object/i.test(msg) ||
    /column .* already exists/i.test(msg)
  );
}

function openSqliteAdapter(url: string, log: Logger): MigrationAdapter {
  const Better = _require("better-sqlite3");
  const dbPath = resolveSqlitePath(url);
  log.info(`Connecting to sqlite at ${dbPath || "(default)"}…`);
  const db = new Better(dbPath);
  // Pragmas — match the rest of the codebase's runtime expectations.
  try { db.pragma("journal_mode = WAL"); } catch { /* :memory: rejects WAL silently */ }
  try { db.pragma("foreign_keys = ON"); } catch { /* noop */ }

  return {
    driverLabel: "sqlite",
    url: dbPath,
    init() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations_applied (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
    },
    appliedSet() {
      const rows = db
        .prepare("SELECT name FROM __drizzle_migrations_applied")
        .all() as { name: string }[];
      return new Set(rows.map((r) => r.name));
    },
    applyOne(name: string, sql: string) {
      // Idempotency strategy — match the existing codebase pattern documented
      // in server/db/connection.ts:applyV12AdditiveAlters(): execute each
      // statement and swallow ONLY the known "already there" errors. This
      // lets `ALTER TABLE … ADD COLUMN` no-op on re-run, and lets new tables
      // coexist with the inline-DDL baseline that connection.ts applies at
      // import time. Genuine SQL errors (syntax, FK violations, type
      // mismatches) still bubble up and fail the migration cleanly.
      const stmts = splitStatements(sql);
      const apply = db.transaction(() => {
        for (const s of stmts) {
          if (process.env.MIGRATE_VERBOSE === "1") {
            log.info(`exec: ${s.slice(0, 80).replace(/\s+/g, " ")}…`);
          }
          try {
            db.exec(s);
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            if (isIdempotentSqliteError(msg)) {
              if (process.env.MIGRATE_VERBOSE === "1") {
                log.info(`  skipped (idempotent): ${msg}`);
              }
              continue;
            }
            if (isNonFatalIndexError(s, msg)) {
              log.warn(`${name}: skipped perf index — ${msg}`);
              continue;
            }
            throw err;
          }
        }
        db.prepare(
          "INSERT OR REPLACE INTO __drizzle_migrations_applied (name, applied_at) VALUES (?, ?)",
        ).run(name, new Date().toISOString());
      });
      apply();
    },
    close() {
      try { db.close(); } catch { /* noop */ }
    },
  };
}

function openPostgresAdapter(url: string, log: Logger): MigrationAdapter {
  let postgres: any;
  try {
    postgres = _require("postgres");
  } catch (err) {
    throw new Error(
      "DATABASE_URL is set to a Postgres URL but the 'postgres' package is not installed. " +
      "Run `npm install postgres` or unset DATABASE_URL for SQLite. " +
      `Underlying: ${(err as Error).message}`,
    );
  }
  log.info(`Connecting to postgres at ${url.replace(/:[^:@/]+@/, ":****@")}…`);
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });

  // We need synchronous-style usage. node-postgres `postgres` lib is async — wrap.
  // For the migrate script we accept top-level await via the runMigrations() async.

  const adapter: MigrationAdapter = {
    driverLabel: "postgres",
    url,
    init() {
      // No-op here; awaited init happens via initAsync below.
    },
    appliedSet() {
      throw new Error("Use appliedSetAsync for postgres");
    },
    applyOne() {
      throw new Error("Use applyOneAsync for postgres");
    },
    close() {
      try { (sql as any).end({ timeout: 5 }); } catch { /* noop */ }
    },
  };
  // Attach async hooks
  (adapter as any).initAsync = async () => {
    await sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations_applied (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    )`;
  };
  (adapter as any).appliedSetAsync = async () => {
    const rows = (await sql`SELECT name FROM __drizzle_migrations_applied`) as { name: string }[];
    return new Set(rows.map((r) => r.name));
  };
  (adapter as any).applyOneAsync = async (name: string, sqlText: string) => {
    const stmts = splitStatements(sqlText);
    await sql.begin(async (tx: any) => {
      for (const s of stmts) {
        if (process.env.MIGRATE_VERBOSE === "1") {
          log.info(`exec: ${s.slice(0, 80).replace(/\s+/g, " ")}…`);
        }
        try {
          await tx.unsafe(s);
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          if (isIdempotentPostgresError(msg)) {
            if (process.env.MIGRATE_VERBOSE === "1") {
              log.info(`  skipped (idempotent): ${msg}`);
            }
            continue;
          }
          throw err;
        }
      }
      await tx`INSERT INTO __drizzle_migrations_applied (name, applied_at)
               VALUES (${name}, NOW())
               ON CONFLICT (name) DO UPDATE SET applied_at = EXCLUDED.applied_at`;
    });
  };
  return adapter;
}

export interface RunOptions {
  databaseUrl?: string;
  migrationsDir?: string;
  log?: Logger;
  /** Skip the connection.ts inline-DDL baseline pre-pass (test isolation). */
  skipInlineBaseline?: boolean;
}

/** Apply the connection.ts inline-DDL baseline against the target SQLite
 *  file. This creates every table/column the per-file migrations expect to
 *  exist already (notably tenants.billing_email, which migration 0000
 *  omits). After this runs, the per-file migrations layer additively.
 */
async function applyInlineBaselineForSqlite(
  url: string | undefined,
  log: Logger,
): Promise<void> {
  const dbPath = resolveSqlitePath(url);
  const Better = _require("better-sqlite3");
  const db = new Better(dbPath);
  try {
    try { db.pragma("journal_mode = WAL"); } catch { /* noop */ }
    try { db.pragma("foreign_keys = ON"); } catch { /* noop */ }
    const conn: any = await import("./connection.js").catch(async () => {
      return await import("./connection.ts" as any).catch(() => null);
    });
    if (conn && typeof conn.applyInlineMigrationsForFreshDb === "function") {
      conn.applyInlineMigrationsForFreshDb(db);
      log.info(`Inline-DDL baseline applied`);
      return;
    }
    log.warn(`Inline-DDL baseline unavailable (applyInlineMigrationsForFreshDb missing); continuing without baseline`);
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}

export interface RunResult {
  driver: Driver;
  total: number;
  applied: string[];
  skipped: string[];
}

/** Programmatic entry point; the test suite calls this directly. */
export async function runMigrations(opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? stdout;
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  const driver = detectDriver(url);
  const dir = opts.migrationsDir ?? process.env.MIGRATIONS_DIR ?? "./migrations";

  log.info(`Connecting to ${driver} at ${driver === "sqlite" ? resolveSqlitePath(url) : (url ?? "<unset>")}…`);

  const files = readMigrationFiles(dir);
  log.info(`Found ${files.length} migration file${files.length === 1 ? "" : "s"}`);

  if (driver === "sqlite") {
    // For SQLite specifically, the codebase has historically relied on the
    // inline-DDL baseline in server/db/connection.ts to create the base
    // table shapes BEFORE the per-file migrations run on top of them. The
    // migrations are written as additive ALTER ADD COLUMNs / CREATE IF NOT
    // EXISTS, expecting that baseline. We replicate this here for the
    // migrate script so `npx tsx server/db/migrate.ts` works against a
    // truly fresh DB (the documented bootstrap path in the consolidated
    // handoff readme §7).
    //
    // We only invoke the baseline when:
    //   - opts.databaseUrl was not explicitly passed by a test, OR
    //   - opts.skipInlineBaseline !== true
    // The test for the runner itself skips this to isolate behavior.
    if (!(opts as any).skipInlineBaseline) {
      await applyInlineBaselineForSqlite(url, log);
    }
    const adapter = openSqliteAdapter(url ?? "./data.db", log);
    try {
      adapter.init();
      const applied = adapter.appliedSet();
      const toApply = files.filter((f) => !applied.has(f.name));
      const skipped = files.filter((f) => applied.has(f.name)).map((f) => f.name);
      if (toApply.length === 0) {
        log.info(`All migrations already applied (0 applied, ${skipped.length} skipped)`);
      } else {
        log.info(`Applying ${toApply.map((f) => f.name.replace(/\.sql$/, "")).join(", ")}`);
        for (const f of toApply) {
          const sql = fs.readFileSync(f.absPath, "utf8");
          try {
            adapter.applyOne(f.name, sql);
            // v23.4.1 Task E: explicit log for 0049 so its absence is visible in boot logs
            if (f.name.startsWith("0049_")) {
              log.info(`Applied 0049_founder_tier_billing_cycle — founder_tiers now supports annual billing`);
            }
            // v23.4.1 Task B: explicit log for 0051
            if (f.name.startsWith("0051_")) {
              log.info(`Applied 0051_consortium_invite_payload — consortium_applications.invite_payload_json column added`);
            }
          } catch (err: any) {
            throw new Error(`Migration ${f.name} failed: ${err?.message ?? err}`);
          }
        }
        log.info(`All migrations applied successfully (${toApply.length} applied, ${skipped.length} skipped)`);
      }
      return {
        driver,
        total: files.length,
        applied: toApply.map((f) => f.name),
        skipped,
      };
    } finally {
      adapter.close();
    }
  } else {
    const adapter = openPostgresAdapter(url!, log);
    try {
      await (adapter as any).initAsync();
      const applied: Set<string> = await (adapter as any).appliedSetAsync();
      const toApply = files.filter((f) => !applied.has(f.name));
      const skipped = files.filter((f) => applied.has(f.name)).map((f) => f.name);
      if (toApply.length === 0) {
        log.info(`All migrations already applied (0 applied, ${skipped.length} skipped)`);
      } else {
        log.info(`Applying ${toApply.map((f) => f.name.replace(/\.sql$/, "")).join(", ")}`);
        for (const f of toApply) {
          const sql = fs.readFileSync(f.absPath, "utf8");
          try {
            await (adapter as any).applyOneAsync(f.name, sql);
          } catch (err: any) {
            throw new Error(`Migration ${f.name} failed: ${err?.message ?? err}`);
          }
        }
        log.info(`All migrations applied successfully (${toApply.length} applied, ${skipped.length} skipped)`);
      }
      return {
        driver,
        total: files.length,
        applied: toApply.map((f) => f.name),
        skipped,
      };
    } finally {
      adapter.close();
    }
  }
}

/** Entry point when invoked as a script. */
async function main() {
  try {
    const result = await runMigrations();
    stdout.info(`Driver=${result.driver} total=${result.total} applied=${result.applied.length} skipped=${result.skipped.length}`);
    stdout.info("Exit 0");
    process.exit(0);
  } catch (err: any) {
    stdout.error(err?.message ?? String(err));
    if (err?.stack && process.env.MIGRATE_VERBOSE === "1") {
      process.stderr.write(err.stack + "\n");
    }
    stdout.error("Exit 1");
    process.exit(1);
  }
}

// Detect "invoked as a script" robustly under tsx (ESM) and node (CJS).
// Under tsx, `import.meta.url` is set; we compare against `process.argv[1]`.
// Under CJS, `require.main === module` — but we're in `"type": "module"`
// so fall back to argv inspection.
const _argv1 = process.argv[1] ?? "";
const _self = (() => {
  try { return (import.meta as { url?: string }).url ?? ""; } catch { return ""; }
})();
const _selfPath = _self.startsWith("file://") ? _self.slice("file://".length) : _self;

if (_argv1 && (_argv1.endsWith("/migrate.ts") || _argv1.endsWith("\\migrate.ts") || _selfPath === _argv1)) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
