/**
 * Database connection layer — Patch v6.
 *
 * Resolves to one of two backends at runtime, lazily:
 *   1. DATABASE_URL=postgres://…   → drizzle(postgres-js)  (Avi's production target)
 *   2. unset / file: / :memory:    → drizzle(better-sqlite3) with inline migrations
 *                                    (sandbox & dev — preserves Patch v4 behavior)
 *
 * Both paths expose the SAME exported surface so the rest of the codebase
 * doesn't care which is active:
 *   - getDb()         → drizzle instance (typed against shared/schema)
 *   - rawDb()         → raw better-sqlite3 handle (SQLite only; throws on PG)
 *   - closeDb()       → async cleanup
 *   - resetDbForTests() → tears down so tests can re-init
 *
 * Why lazy? `import postgres from "postgres"` at module top-level would
 * crash the dev sandbox if the package isn't installed. We require()
 * inside the branch so SQLite-only dev never touches it.
 */
import * as schema from "../../shared/schema";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);

// --- shared module state -------------------------------------------------

let _drizzleDb: any = null;
let _rawSqlite: any = null;
let _pgClient: any = null;
let _driver: "postgres" | "sqlite" | null = null;

function _isPostgresUrl(u: string | undefined): u is string {
  return !!u && /^postgres(ql)?:\/\//i.test(u);
}

// --- public API ----------------------------------------------------------

export function getDb(): any {
  if (_drizzleDb) return _drizzleDb;

  const url = process.env.DATABASE_URL;

  if (_isPostgresUrl(url)) {
    // Postgres production path. Lazy-load to avoid crashing dev when the
    // package isn't installed.
    let postgres: any;
    let pgDrizzle: any;
    try {
      postgres = _require("postgres");
      pgDrizzle = _require("drizzle-orm/postgres-js").drizzle;
    } catch (err) {
      throw new Error(
        "DATABASE_URL is set to a Postgres URL but the 'postgres' package " +
        "is not installed. Run `npm install postgres @types/pg` or unset DATABASE_URL " +
        "to fall back to in-process SQLite. Underlying error: " + (err as Error).message
      );
    }
    console.log("[db] Connecting to PostgreSQL...");
    _pgClient = postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 10 });
    _drizzleDb = pgDrizzle(_pgClient, { schema });
    _driver = "postgres";
    console.log("[db] ✅ PostgreSQL connected");
    return _drizzleDb;
  }

  // SQLite path (sandbox + dev + test). Reuses the inline-migrations
  // logic from the reference Patch v4 build so the 24 sync_* tables +
  // auth tables exist immediately.
  const Database = _require("better-sqlite3");
  const sqliteDrizzle = _require("drizzle-orm/better-sqlite3").drizzle;

  const path = url && url.startsWith("file:") ? url.slice(5) : ":memory:";
  _rawSqlite = new Database(path);
  _rawSqlite.pragma("journal_mode = WAL");
  _drizzleDb = sqliteDrizzle(_rawSqlite, { schema });
  applyInlineMigrations(_rawSqlite);
  _driver = "sqlite";
  return _drizzleDb;
}

export function rawDb(): any {
  if (_driver === "postgres") {
    throw new Error("rawDb() is not supported on the Postgres backend. Use getDb() with Drizzle queries.");
  }
  if (!_rawSqlite) getDb();
  return _rawSqlite;
}

export async function closeDb(): Promise<void> {
  if (_pgClient) {
    try { await _pgClient.end(); } catch { /* noop */ }
    _pgClient = null;
  }
  if (_rawSqlite) {
    try { _rawSqlite.close(); } catch { /* noop */ }
    _rawSqlite = null;
  }
  _drizzleDb = null;
  _driver = null;
}

export function resetDbForTests(): void {
  if (_rawSqlite) {
    try { _rawSqlite.close(); } catch { /* noop */ }
  }
  _rawSqlite = null;
  _drizzleDb = null;
  _pgClient = null;
  _driver = null;
}

// --- inline SQLite migrations (Patch v4 parity) --------------------------

function applyInlineMigrations(db: any) {
  const stmts = buildCreateTableStatements();
  const tx = db.transaction(() => {
    for (const sql of stmts) db.exec(sql);
  });
  tx();
}

function buildCreateTableStatements(): string[] {
  const baseCols = `
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    payload TEXT NOT NULL`.trim();

  const syncTable = (name: string, extra = "") => `
    CREATE TABLE IF NOT EXISTS ${name} (
      ${baseCols}${extra ? ",\n      " + extra : ""}
    );
  `.trim();

  return [
    syncTable("sync_company", "name TEXT, sector TEXT, stage TEXT"),
    syncTable("sync_investor", "email TEXT, type TEXT"),
    syncTable("sync_cap_table_position", "company_id TEXT, holder_id TEXT"),
    syncTable("sync_soft_circle", "round_id TEXT, investor_id TEXT"),
    syncTable("sync_round", "company_id TEXT, state TEXT"),
    syncTable("sync_ma_intelligence", "company_id TEXT"),
    syncTable("sync_eligibility_snapshot", "investor_id TEXT"),
    syncTable("sync_lifecycle_policy", "scope TEXT"),
    syncTable("sync_audit_entry", "hash_chain TEXT, actor_id TEXT, action TEXT"),
    syncTable("sync_kyc_record", "subject_id TEXT, status TEXT"),
    syncTable("sync_accreditation", "investor_id TEXT, status TEXT"),
    syncTable("sync_member_tier", "user_id TEXT, tier TEXT"),
    syncTable("sync_consortium_partner", "region TEXT"),
    syncTable("sync_term_sheet", "round_id TEXT, state TEXT"),
    syncTable("sync_dataroom_permission", "file_id TEXT, grantee_id TEXT"),
    syncTable("sync_dataroom_file_meta", "company_id TEXT, filename TEXT"),
    syncTable("sync_notification_prefs", "user_id TEXT"),
    syncTable("sync_pricing_tier", "tier TEXT"),
    syncTable("sync_comms_thread", "channel_id TEXT"),
    syncTable("sync_pcrm_contact", "owner_id TEXT, email TEXT"),
    syncTable("sync_post", "author_id TEXT, channel_id TEXT"),
    syncTable("sync_report", "company_id TEXT, period TEXT"),
    syncTable("sync_spv_score", "investor_id TEXT"),
    syncTable("sync_social_signal", "subject_id TEXT"),

    `CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_algo TEXT NOT NULL DEFAULT 'argon2id',
      role TEXT NOT NULL DEFAULT 'founder',
      status TEXT NOT NULL DEFAULT 'active',
      totp_secret TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login TEXT,
      created_at TEXT NOT NULL,
      welcome_ack INTEGER NOT NULL DEFAULT 0
    );`,

    `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS auth_redeem_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      intent TEXT NOT NULL,
      consumed_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,

    `CREATE INDEX IF NOT EXISTS idx_sync_company_tenant ON sync_company(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_investor_email ON sync_investor(email);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_round_company ON sync_round(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_audit_actor ON sync_audit_entry(actor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_post_channel ON sync_post(channel_id);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_redeem_email ON auth_redeem_tokens(email);`,
  ];
}

export { schema };
