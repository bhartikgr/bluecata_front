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

// Patch v11 (B-V11-3): dual-mode require. In tsx (ESM) dev, we need
// `createRequire(import.meta.url)`. In the esbuild CJS production bundle,
// `import.meta.url` is empty and `createRequire(undefined)` throws
// ERR_INVALID_ARG_VALUE — but CJS already has a native `require` available,
// so prefer that when present. The ambient `require` declaration lets the
// TS compiler accept the reference in ESM source.
declare const require: NodeJS.Require | undefined;
function makeRequire(): NodeJS.Require {
  if (typeof require === "function") return require;
  try {
    const metaUrl = (import.meta as { url?: string }).url ?? "";
    if (metaUrl) return createRequire(metaUrl);
  } catch { /* fall through */ }
  // Final fallback: anchor against the running entrypoint.
  return createRequire(process.cwd() + "/_");
}
const _require = makeRequire();

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

  // Patch v12 — SQLite file resolution.
  //
  // Resolution rules (in order):
  //   1. DATABASE_URL=file:<path>           → use that file (explicit override)
  //   2. DATABASE_URL=sqlite:<path>         → use that file (alt prefix)
  //   3. NODE_ENV=test                      → ":memory:" (test isolation — prior behavior)
  //   4. process.env.SQLITE_PATH set        → use that file (explicit dev override)
  //   5. Otherwise (dev, prod, sandbox)     → "./data.db" relative to cwd (persistent)
  //
  // Pre-v12 default was ":memory:" — that meant every dev restart wiped the DB,
  // which is why Avi reported "data is not being saved". v12 makes file-backed
  // SQLite the dev/prod default; tests still get :memory: via NODE_ENV.
  let path: string;
  if (url && url.startsWith("file:")) {
    path = url.slice(5);
  } else if (url && url.startsWith("sqlite:")) {
    path = url.slice(7);
  } else if (process.env.NODE_ENV === "test") {
    path = ":memory:";
  } else if (process.env.SQLITE_PATH) {
    path = process.env.SQLITE_PATH;
  } else {
    path = "./data.db";
  }
  console.log(`[db] Opening SQLite at: ${path}`);
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

// --- inline SQLite migrations (Patch v4 parity, v12 extended) ------------
//
// v12 extends applyInlineMigrations to also create the production
// schema tables (companies, users, user_credentials, tenants, etc.) that
// the v12-migrated stores hydrate from on boot. Without this, the
// `:memory:` SQLite path used by tests would fail to hydrate.
//
// Then it applies the v12 additive ALTERs (tenant_id, deleted_at, is_demo,
// shares_str, amount_minor) wrapped in try/catch so re-runs are no-ops.
//
// Finally it runs the 0003 backfill (tenants table + tenant_id columns)
// using `INSERT OR IGNORE` + `WHERE tenant_id IS NULL` guards — also
// idempotent.

function applyInlineMigrations(db: any) {
  const baseStmts = buildCreateTableStatements();
  const productionStmts = buildProductionTableStatements();
  const tx = db.transaction(() => {
    for (const sql of baseStmts) db.exec(sql);
    for (const sql of productionStmts) db.exec(sql);
  });
  tx();

  // v12 additive ALTERs — outside the txn because SQLite cannot rollback
  // schema changes that already succeeded on a prior boot; each one is
  // wrapped in its own try/catch that swallows the duplicate-column error.
  applyV12AdditiveAlters(db);

  // v12 backfill (idempotent INSERT OR IGNORE + guarded UPDATE).
  applyV12Backfill(db);
}

/**
 * Apply additive ALTER TABLE ADD COLUMN statements that v12 introduces.
 * SQLite throws "duplicate column name: X" if the column already exists;
 * we swallow that specific error so the function is idempotent.
 */
function applyV12AdditiveAlters(db: any) {
  const alters: Array<[string, string]> = [
    // company_members tenant-scoping + lifecycle
    ["company_members", "ALTER TABLE company_members ADD COLUMN tenant_id TEXT"],
    ["company_members", "ALTER TABLE company_members ADD COLUMN consortium_partner_id TEXT"],
    ["company_members", "ALTER TABLE company_members ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"],
    ["company_members", "ALTER TABLE company_members ADD COLUMN joined_at TEXT"],
    ["company_members", "ALTER TABLE company_members ADD COLUMN last_active_at TEXT"],
    ["company_members", "ALTER TABLE company_members ADD COLUMN deleted_at TEXT"],
    // tenants — extended columns beyond the legacy (id,name,kind) shape
    ["tenants", "ALTER TABLE tenants ADD COLUMN billing_email TEXT"],
    ["tenants", "ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
    ["tenants", "ALTER TABLE tenants ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0"],
    ["tenants", "ALTER TABLE tenants ADD COLUMN created_at TEXT"],
    ["tenants", "ALTER TABLE tenants ADD COLUMN updated_at TEXT"],
    ["tenants", "ALTER TABLE tenants ADD COLUMN deleted_at TEXT"],
    // soft-delete + is_demo on the 8 compliance tables
    ["companies", "ALTER TABLE companies ADD COLUMN deleted_at TEXT"],
    ["companies", "ALTER TABLE companies ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0"],
    ["users", "ALTER TABLE users ADD COLUMN deleted_at TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0"],
    ["user_credentials", "ALTER TABLE user_credentials ADD COLUMN deleted_at TEXT"],
    ["audit_log", "ALTER TABLE audit_log ADD COLUMN deleted_at TEXT"],
    ["securities", "ALTER TABLE securities ADD COLUMN deleted_at TEXT"],
    ["securities", "ALTER TABLE securities ADD COLUMN shares_str TEXT NOT NULL DEFAULT '0'"],
    ["securities", "ALTER TABLE securities ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0"],
    ["subscriptions", "ALTER TABLE subscriptions ADD COLUMN deleted_at TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN deleted_at TEXT"],
    // ---- Patch v12 Day 2 Wave 2: dataroom_files extensions ----
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_unknown'"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN uploaded_by_id TEXT"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN watermark INTEGER NOT NULL DEFAULT 0"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN deleted_at TEXT"],
    // ---- Patch v12 Day 2 Wave 2: contacts.tenant_id ----
    ["contacts", "ALTER TABLE contacts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_platform'"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN deleted_at TEXT"],
    // ---- Patch v12 Day 2 Wave 2: invoices extensions for hybrid migration ----
    ["invoices", "ALTER TABLE invoices ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_unknown'"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN subscription_id TEXT NOT NULL DEFAULT ''"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN payment_entry_id TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN related_invoice_id TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN refunded_at TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN voided_at TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN card_last_4 TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN line_items_json TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN updated_at TEXT"],
    ["invoices", "ALTER TABLE invoices ADD COLUMN updated_by TEXT"],
  ];
  for (const [table, sql] of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      const msg = (err as Error).message || "";
      // SQLite: "duplicate column name: foo"
      // Postgres: "column ... of relation ... already exists"
      if (/duplicate column|already exists/i.test(msg)) continue;
      console.warn(`[db] v12 ALTER on ${table} failed (continuing):`, msg);
    }
  }

  // Indices (CREATE INDEX IF NOT EXISTS is supported in SQLite 3.3+).
  const indices = [
    "CREATE INDEX IF NOT EXISTS idx_company_members_tenant_user ON company_members(tenant_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_user_credentials_email ON user_credentials(email)",
    "CREATE INDEX IF NOT EXISTS idx_user_credentials_deleted ON user_credentials(deleted_at)",
    // Day 2 Wave 1 — hot indices for audit_log hash-chain tip read + recon/profile scans.
    "CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log(tenant_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_company_profile_extended_tenant ON company_profile_extended(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_recon_runs_company ON recon_runs(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_recon_runs_tenant ON recon_runs(tenant_id)",
    // Patch v12 Day 2 Wave 2 indices.
    "CREATE INDEX IF NOT EXISTS idx_legal_consents_tenant ON legal_consents(tenant_id, accepted_at)",
    "CREATE INDEX IF NOT EXISTS idx_legal_consents_user ON legal_consents(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_dataroom_folders_company ON dataroom_folders(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_dataroom_files_company ON dataroom_files(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_dataroom_files_folder ON dataroom_files(folder_id)",
    "CREATE INDEX IF NOT EXISTS idx_dataroom_permissions_folder ON dataroom_permissions(folder_id, investor_id)",
    "CREATE INDEX IF NOT EXISTS idx_dataroom_events_company ON dataroom_events(company_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_captable_commits_tenant ON captable_commits(tenant_id, seq)",
    "CREATE INDEX IF NOT EXISTS idx_captable_commits_company ON captable_commits(company_id, state)",
    "CREATE INDEX IF NOT EXISTS idx_term_sheet_revisions_round ON term_sheet_revisions(round_id, revision)",
    "CREATE INDEX IF NOT EXISTS idx_contact_revisions_contact ON contact_revisions(contact_id, version)",
    // Patch v12 Day 3 — CRM stores indices.
    "CREATE INDEX IF NOT EXISTS idx_founder_crm_contacts_company ON founder_crm_contacts(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_founder_crm_contacts_tenant ON founder_crm_contacts(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_investor_crm_contacts_investor ON investor_crm_contacts(investor_id)",
    "CREATE INDEX IF NOT EXISTS idx_investor_crm_contacts_tenant ON investor_crm_contacts(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_pcrm_contacts_owner ON pcrm_contacts(owner_id)",
    "CREATE INDEX IF NOT EXISTS idx_pcrm_contacts_tenant ON pcrm_contacts(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_pcrm_notes_contact ON pcrm_notes(contact_id)",
    "CREATE INDEX IF NOT EXISTS idx_pcrm_tasks_contact ON pcrm_tasks(contact_id)",
  ];
  for (const sql of indices) {
    try { db.exec(sql); } catch { /* tolerated */ }
  }
}

/**
 * Idempotent data backfill: tenants table + company_members.tenant_id.
 */
function applyV12Backfill(db: any) {
  try {
    db.exec(`
      INSERT OR IGNORE INTO tenants (id, kind, name, billing_email, status, is_demo, created_at, updated_at, deleted_at)
      SELECT
        'tenant_co_' || c.id,
        'company',
        c.name,
        NULL,
        'active',
        COALESCE(c.is_demo, 0),
        datetime('now'),
        NULL,
        c.deleted_at
      FROM companies c
      WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = 'tenant_co_' || c.id)
    `);
    db.exec(`
      UPDATE companies
      SET tenant_id = 'tenant_co_' || id
      WHERE tenant_id IS NULL OR tenant_id = ''
    `);
    db.exec(`
      UPDATE company_members
      SET tenant_id = (
        SELECT companies.tenant_id FROM companies WHERE companies.id = company_members.company_id
      )
      WHERE tenant_id IS NULL AND company_id IS NOT NULL
    `);
    db.exec(`UPDATE company_members SET joined_at = COALESCE(joined_at, datetime('now')) WHERE joined_at IS NULL`);
  } catch (err) {
    console.warn("[db] v12 backfill encountered an issue (continuing):", (err as Error).message);
  }
}

/**
 * v12: CREATE TABLE IF NOT EXISTS for the production schema tables used
 * by the migrated stores. Mirrors the table shapes in shared/schema.ts.
 * Idempotent. Used so `:memory:` SQLite test runs have the tables ready
 * for hydration immediately on boot.
 */
function buildProductionTableStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      billing_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      avatar_url TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY NOT NULL,
      active_tenant_id TEXT,
      updated_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      legal_name TEXT,
      sector TEXT,
      stage TEXT,
      hq TEXT,
      website_url TEXT,
      description TEXT,
      logo_url TEXT,
      founded TEXT,
      employees INTEGER,
      is_demo INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS company_members (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      title TEXT,
      tenant_id TEXT,
      consortium_partner_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT,
      last_active_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      company_id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      plan TEXT NOT NULL,
      annual_amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      renews_on TEXT NOT NULL,
      card_last4 TEXT,
      invoices_count INTEGER NOT NULL DEFAULT 0,
      past_due_minor INTEGER,
      trial_ends_on TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS subscriptions_history (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      revision_hash TEXT NOT NULL,
      prev_revision_hash TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      recorded_by TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      target_id TEXT,
      payload_json TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    // Patch v12 Day 2 Wave 1 — companyProfileStore + adminPlatformStore migration.
    `CREATE TABLE IF NOT EXISTS company_profile_extended (
      company_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS recon_runs (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      engine_main_json TEXT NOT NULL,
      engine_ref_json TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      actor TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS founder_tiers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      usd_monthly INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'system',
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS securities (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      holder_type TEXT NOT NULL,
      instrument TEXT NOT NULL,
      series TEXT,
      shares INTEGER NOT NULL DEFAULT 0,
      price_per_share REAL,
      investment_amount REAL,
      cap REAL,
      discount REAL,
      issued_at TEXT,
      shares_str TEXT NOT NULL DEFAULT '0',
      amount_minor INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_number TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_unknown',
      company_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL DEFAULT '',
      plan_label TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      tax_minor INTEGER NOT NULL DEFAULT 0,
      total_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      payment_entry_id TEXT,
      related_invoice_id TEXT,
      issued_at TEXT NOT NULL,
      paid_at TEXT,
      refunded_at TEXT,
      voided_at TEXT,
      card_last_4 TEXT,
      line_items_json TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      updated_at TEXT,
      updated_by TEXT,
      deleted_at TEXT
    );`,
    // ---------- Patch v12 Day 2 Wave 2 ----------
    `CREATE TABLE IF NOT EXISTS legal_consents (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_version TEXT NOT NULL,
      context TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS dataroom_folders (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_round_folder INTEGER NOT NULL DEFAULT 0,
      round_id TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS dataroom_files (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_unknown',
      folder_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'misc',
      name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mime TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_by_id TEXT,
      sha256 TEXT NOT NULL DEFAULT '',
      watermark INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS dataroom_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      view INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS dataroom_events (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      meta_json TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS captable_commits (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      invitation_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      shares TEXT NOT NULL,
      state TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      reconcile_primary TEXT,
      reconcile_ref TEXT,
      reconcile_match INTEGER NOT NULL DEFAULT 1,
      compliance_hold INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS funded_queue (
      invitation_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      shares TEXT NOT NULL,
      enqueued_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS term_sheet_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      saved_by TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS invoice_year_counter (
      year INTEGER PRIMARY KEY NOT NULL,
      count INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      legal_name TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      phone TEXT,
      region TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      verification TEXT NOT NULL DEFAULT 'unverified',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_platform',
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS contact_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      contact_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      action TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );`,
    // ---------- Patch v12 Day 3 — CRM stores ----------
    `CREATE TABLE IF NOT EXISTS founder_crm_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      investor_id TEXT,
      name TEXT NOT NULL,
      firm_name TEXT,
      role TEXT,
      email TEXT,
      region TEXT,
      stage TEXT NOT NULL,
      ownership TEXT,
      soft_circle_history TEXT,
      tasks TEXT,
      thread_ids TEXT,
      ma_signals INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      notes_updated_at TEXT,
      series TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS investor_crm_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      platform_user_id TEXT,
      name TEXT NOT NULL,
      role TEXT,
      email TEXT,
      affiliation TEXT,
      stage TEXT NOT NULL,
      tags TEXT,
      notes TEXT,
      note_log TEXT,
      tasks TEXT,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      company_id TEXT,
      company_name TEXT,
      founder_name TEXT,
      founder_email TEXT,
      sector TEXT,
      region TEXT,
      check_size_usd INTEGER,
      notes_updated_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS pcrm_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      firm TEXT,
      email TEXT,
      linkedin TEXT,
      pipeline_stage TEXT NOT NULL,
      tags TEXT,
      lanes TEXT,
      company_id TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS pcrm_notes (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      body TEXT NOT NULL,
      note_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS pcrm_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
  ];
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
