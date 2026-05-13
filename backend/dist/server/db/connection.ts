/**
 * Sprint 17 D1 — DB connection layer.
 *
 * Reads `DATABASE_URL` from the environment.
 *   - If set + Postgres-style URL: TODO production cutover stub
 *     (we throw a clear error; production migration is documented in
 *     DEPLOYMENT_PLAN.md so the operator runs `drizzle-kit generate:pg`
 *     against this same schema and swaps in `postgres-js`).
 *   - Otherwise: better-sqlite3 in-memory (fast, ephemeral, sandbox-safe).
 *
 * The DB layer is additive: existing in-memory `Map`-backed stores are
 * preserved. A migration helper `seedFromMaps()` mirrors a Map into the
 * sync_* tables so the same data is queryable via SQL when tests or
 * cross-cohort verifications need ACID semantics.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _raw: Database.Database | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    // Production cutover: see DEPLOYMENT_PLAN.md. We deliberately don't
    // swallow this — the operator should switch the import to postgres-js.
    throw new Error(
      "DATABASE_URL points at Postgres but this build is the in-memory preview. " +
      "Follow DEPLOYMENT_PLAN.md to swap in postgres-js + run drizzle-kit migrations."
    );
  }
  // SQLite path: file or in-memory.
  const path = url && url.startsWith("file:") ? url.slice(5) : ":memory:";
  _raw = new Database(path);
  _raw.pragma("journal_mode = WAL");
  _db = drizzle(_raw, { schema });
  applyInlineMigrations(_raw);
  return _db;
}

export function rawDb(): Database.Database {
  if (!_raw) getDb();
  return _raw!;
}

export function resetDbForTests(): void {
  if (_raw) {
    try { _raw.close(); } catch { /* noop */ }
  }
  _db = null;
  _raw = null;
}

/**
 * Inline migration runner — generates CREATE TABLE statements from the
 * schema definitions so the in-memory DB is ready immediately. The
 * canonical SQL migrations also live under server/db/migrations/ so a
 * Postgres operator runs them in order.
 */
function applyInlineMigrations(db: Database.Database) {
  const stmts = buildCreateTableStatements();
  const tx = db.transaction(() => {
    for (const sql of stmts) db.exec(sql);
  });
  tx();
}

function buildCreateTableStatements(): string[] {
  // Hand-rolled CREATE TABLE statements that match the Drizzle schema
  // exactly. Kept hand-rolled to avoid a runtime dependency on drizzle-kit.
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
