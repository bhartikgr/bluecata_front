/**
 * Sprint 17 D1 — DB connection layer.
 *
 * Reads `DATABASE_URL` from the environment.
 *   - If set + Postgres-style URL: Production mode with PostgreSQL
 *   - Otherwise: SQLite in-memory (sandbox mode)
 *
 * The DB layer is additive: existing in-memory `Map`-backed stores are
 * preserved. A migration helper `seedFromMaps()` mirrors a Map into the
 * sync_* tables so the same data is queryable via SQL when tests or
 * cross-cohort verifications need ACID semantics.
 */
import * as schema from "./schema";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3"

// Type declarations for both database drivers
let _db: any = null;
let _raw: any = null;
let _initialized = false;

// PostgreSQL imports (only when needed)
let postgres: any;
let drizzlePg: any;

/**
 * Initialize SQLite synchronously (for immediate use in stores)
 */
function initSqliteSync(): any {
  if (_raw) return _raw;
  
  const url = process.env.DATABASE_URL;
  
  // Dynamic import for better-sqlite3 (CommonJS)
  
  const path = url && url.startsWith("file:") ? url.slice(5) : ":memory:";
  _raw = new Database(path);
  _raw.pragma("journal_mode = WAL");
  
  // Apply migrations synchronously
  applyInlineMigrationsSync(_raw);
  
  console.log("[db] ✅ SQLite connected (sync)");
  return _raw;
}

/**
 * Initialize Drizzle ORM over SQLite (async, for getDb)
 */
async function initSqliteAsync(): Promise<any> {
  if (_db) return _db;
  
  const url = process.env.DATABASE_URL;
  
  // Ensure raw connection exists
  if (!_raw) {
    initSqliteSync();
  }
  
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  _db = drizzle(_raw, { schema });
  
  return _db;
}

/**
 * Get database connection — automatically detects Postgres vs SQLite
 */
export async function getDb(): Promise<any> {
  if (_db) return _db;
  
  const url = process.env.DATABASE_URL;
  
  // PRODUCTION MODE: PostgreSQL
  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    console.log("[db] Initializing PostgreSQL connection...");
    
    // Dynamically import Postgres drivers (only when needed)
    if (!postgres) {
      postgres = await import('postgres');
      drizzlePg = await import('drizzle-orm/postgres-js');
    }
    
    const client = postgres.default(url);
    _db = drizzlePg.drizzle(client, { schema });
    console.log("[db] ✅ PostgreSQL connected");
    return _db;
  }
  
  // SANDBOX MODE: SQLite
  console.log("[db] Initializing SQLite connection (sandbox mode)...");
  return await initSqliteAsync();
}

/**
 * Raw database connection (synchronous — for SQLite-specific operations)
 * This is the FIX: returns the raw SQLite database synchronously
 */
export function rawDb(): any {
  const url = process.env.DATABASE_URL;
  
  // If PostgreSQL mode, return null (stores should handle this)
  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    console.warn("[db] rawDb() called in PostgreSQL mode — returning null");
    return null;
  }
  
  // Initialize SQLite synchronously if not already
  if (!_raw) {
    initSqliteSync();
  }
  
  return _raw;
}

/**
 * Check if database is ready (synchronous check)
 */
export function isDbReady(): boolean {
  return _raw !== null;
}

/**
 * Reset database connection (for testing)
 */
export async function resetDbForTests(): Promise<void> {
  if (_raw) {
    try { _raw.close(); } catch { /* noop */ }
  }
  _db = null;
  _raw = null;
  _initialized = false;
}

/**
 * Inline migration runner — synchronous version (for SQLite)
 */
function applyInlineMigrationsSync(db: any): void {
  const stmts = buildCreateTableStatements();
  const tx = db.transaction(() => {
    for (const sql of stmts) {
      try {
        db.exec(sql);
      } catch (e: any) {
        // Table might already exist — ignore error
        if (!e.message?.includes('already exists')) {
          console.warn("[db] Migration warning:", e.message);
        }
      }
    }
  });
  tx();
  console.log("[db] ✅ SQLite migrations applied");
}

/**
 * Async migration runner (for PostgreSQL compatibility)
 */
async function applyInlineMigrations(db: any) {
  // For PostgreSQL, we don't run inline migrations
  // They should be run via drizzle-kit migrate
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    console.log("[db] PostgreSQL mode — migrations must be run via drizzle-kit");
    return;
  }
  
  // For SQLite, use sync version
  applyInlineMigrationsSync(db);
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