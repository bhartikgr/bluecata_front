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
import { log } from "../lib/logger";

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
    log.info("[db] Connecting to PostgreSQL...");
    _pgClient = postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 10 });
    _drizzleDb = pgDrizzle(_pgClient, { schema });
    _driver = "postgres";
    log.info("[db] ✅ PostgreSQL connected");
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
  log.info(`[db] Opening SQLite at: ${path}`);
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

// --- Wave H Track A: driver introspection --------------------------------
//
// Used by server/db/portable.ts to dispatch terminal methods (.all/.get/.run)
// to the correct underlying shape (sync on better-sqlite3, async on
// postgres-js). Calling this before getDb() returns null — callers should
// call getDb() first to ensure a connection has been established.
export function getDbDriver(): "sqlite" | "postgres" | null {
  if (_driver) return _driver;
  // Lazy infer from DATABASE_URL even if getDb() has not run yet — this lets
  // module-load-time code branch correctly before the first query.
  if (_isPostgresUrl(process.env.DATABASE_URL)) return "postgres";
  return "sqlite";
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
    // ---- v13 Avi's Issue 3 — rounds DB-backed (additive columns). ----
    ["rounds", "ALTER TABLE rounds ADD COLUMN tenant_id TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN lead_investor TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN currency TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN region TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN open_date TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN instrument TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN extras_json TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN created_at TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN updated_at TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN created_by TEXT"],
    ["rounds", "ALTER TABLE rounds ADD COLUMN deleted_at TEXT"],
    // ---- v15 P0-4..P0-8 — round_invitations extensions. ----
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN tenant_id TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN company_id TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN classification TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN token_hash TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN invited_by_user_id TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN note TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN redeemed_at TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN redeemed_by_user_id TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN created_at TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN updated_at TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN deleted_at TEXT"],
    // ---- v15 P0-9..P0-11 — soft_circles extensions. ----
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN tenant_id TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN company_id TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN investor_user_id TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN investor_email TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN collective_visible INTEGER NOT NULL DEFAULT 1"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN updated_at TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN deleted_at TEXT"],
    // ---- v17 Phase A — chapter_id additive columns on existing Collective tables. ----
    // Nullable + no default; the 0021 backfill seeds existing rows to
    // 'chap_keiretsu_canada' (the default chapter Maya/Aisha/Daniel belong to).
    ["collective_waitlist", "ALTER TABLE collective_waitlist ADD COLUMN chapter_id TEXT"],
    ["dsc_feedback",        "ALTER TABLE dsc_feedback        ADD COLUMN chapter_id TEXT"],
    ["dsc_votes",           "ALTER TABLE dsc_votes           ADD COLUMN chapter_id TEXT"],
    ["soft_circles",        "ALTER TABLE soft_circles        ADD COLUMN chapter_id TEXT"],
    // ---- v17 Phase C — chapters.dsc_quorum_pct + investor_nominations state machine columns. ----
    ["chapters",            "ALTER TABLE chapters ADD COLUMN dsc_quorum_pct INTEGER NOT NULL DEFAULT 50"],
    ["investor_nominations", "ALTER TABLE investor_nominations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"],
    ["investor_nominations", "ALTER TABLE investor_nominations ADD COLUMN decline_reason TEXT"],
    ["investor_nominations", "ALTER TABLE investor_nominations ADD COLUMN decided_at TEXT"],
    ["investor_nominations", "ALTER TABLE investor_nominations ADD COLUMN decided_by TEXT"],
    ["investor_nominations", "ALTER TABLE investor_nominations ADD COLUMN round_id TEXT"],
    // ---- CP Phase A — migration 0042 (partner_crm_contacts hash columns; CP-008). ----
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN prev_hash TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN curr_hash TEXT NOT NULL DEFAULT ''"],
    // ---- CP Phase A — migration 0043 (partner_deal_pipeline.legacy_id; CP-019). ----
    ["partner_deal_pipeline", "ALTER TABLE partner_deal_pipeline ADD COLUMN legacy_id TEXT"],
    // ---- CP Phase B — migration 0047 (partner_deal_promotions moderation columns; CP-015). ----
    ["partner_deal_promotions", "ALTER TABLE partner_deal_promotions ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'pending'"],
    ["partner_deal_promotions", "ALTER TABLE partner_deal_promotions ADD COLUMN moderated_by_user_id TEXT"],
    ["partner_deal_promotions", "ALTER TABLE partner_deal_promotions ADD COLUMN moderated_at TEXT"],
    ["partner_deal_promotions", "ALTER TABLE partner_deal_promotions ADD COLUMN moderation_notes TEXT"],
    // ---- CP Phase B — migration 0048 (users GDPR/CCPA columns; CP-013). ----
    ["users", "ALTER TABLE users ADD COLUMN deletion_requested_at TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN deletion_token TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN anonymized_at TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN anonymized_by_user_id TEXT"],
    // ---- Wave C FIX C2 — migration 0050 (users profile durability columns). ----
    ["users", "ALTER TABLE users ADD COLUMN title TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN display_name TEXT"],
  ];
  for (const [table, sql] of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      const msg = (err as Error).message || "";
      // SQLite: "duplicate column name: foo"
      // Postgres: "column ... of relation ... already exists"
      if (/duplicate column|already exists/i.test(msg)) continue;
      log.warn(`[db] v12 ALTER on ${table} failed (continuing):`, msg);
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
    // v13 indices — Avi's Issues 3/4/5.
    "CREATE INDEX IF NOT EXISTS idx_rounds_company ON rounds(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_rounds_tenant ON rounds(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_reports_company ON reports(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_reports_tenant ON reports(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_network_posts_tenant ON network_posts(tenant_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_network_posts_author ON network_posts(author_user_id)",
    // v17 Phase A — chapter scoping indices.
    "CREATE INDEX IF NOT EXISTS idx_chapters_tenant ON chapters(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status)",
    "CREATE INDEX IF NOT EXISTS idx_chapters_region ON chapters(region)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_memberships_tenant ON chapter_memberships(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_memberships_chapter ON chapter_memberships(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_memberships_user ON chapter_memberships(user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_memberships_chapter_user ON chapter_memberships(chapter_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_waitlist_chapter ON collective_waitlist(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_feedback_chapter ON dsc_feedback(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_votes_chapter ON dsc_votes(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_soft_circles_chapter ON soft_circles(chapter_id)",
    // v17 Phase B — hot indices for the 8 migrated Collective stores.
    "CREATE INDEX IF NOT EXISTS idx_collective_apps_tenant ON collective_apps(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_apps_chapter ON collective_apps(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_apps_user ON collective_apps(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_apps_status ON collective_apps(status)",
    "CREATE INDEX IF NOT EXISTS idx_collective_memberships_tenant ON collective_memberships(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_memberships_chapter ON collective_memberships(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_memberships_status ON collective_memberships(status)",
    "CREATE INDEX IF NOT EXISTS idx_fcn_tenant ON founder_collective_nominations(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_fcn_chapter ON founder_collective_nominations(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_fcn_company ON founder_collective_nominations(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_fcn_founder ON founder_collective_nominations(founder_id)",
    "CREATE INDEX IF NOT EXISTS idx_fcn_status ON founder_collective_nominations(status)",
    "CREATE INDEX IF NOT EXISTS idx_fca_tenant ON founder_collective_applications(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_fca_chapter ON founder_collective_applications(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_fca_company ON founder_collective_applications(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_fca_founder ON founder_collective_applications(founder_id)",
    "CREATE INDEX IF NOT EXISTS idx_fca_status ON founder_collective_applications(status)",
    "CREATE INDEX IF NOT EXISTS idx_invnom_tenant ON investor_nominations(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_invnom_chapter ON investor_nominations(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_invnom_investor ON investor_nominations(investor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_invnom_company ON investor_nominations(company_id)",
    /* v17 Phase C — hot indices for state-machine + cascade sweep. */
    "CREATE INDEX IF NOT EXISTS idx_invnom_status ON investor_nominations(status)",
    "CREATE INDEX IF NOT EXISTS idx_invnom_round ON investor_nominations(round_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_roles_tenant ON dsc_roles(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_roles_chapter ON dsc_roles(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_roles_user ON dsc_roles(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_roles_status ON dsc_roles(status)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_tenant ON dsc_pipeline(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_chapter ON dsc_pipeline(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_company ON dsc_pipeline(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_pipeline_status ON dsc_pipeline(status)",
    "CREATE INDEX IF NOT EXISTS idx_collective_settings_tenant ON collective_settings(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_settings_chapter ON collective_settings(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_tenant ON collective_channel_posts(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_chapter ON collective_channel_posts(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_channel ON collective_channel_posts(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_author ON collective_channel_posts(author_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_collective_channel_posts_visibility ON collective_channel_posts(visibility)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_tenant ON partner_deal_promotions(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_chapter ON partner_deal_promotions(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_partner ON partner_deal_promotions(partner_id)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_pipeline ON partner_deal_promotions(pipeline_deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_company ON partner_deal_promotions(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_promotions_status ON partner_deal_promotions(status)",
    // v18 Phase A — screening_events + screening_event_attendees indices.
    "CREATE INDEX IF NOT EXISTS idx_screening_events_tenant ON screening_events(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_chapter ON screening_events(chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_company ON screening_events(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_round ON screening_events(round_id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_status ON screening_events(status)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_scheduled ON screening_events(chapter_id, scheduled_for)",
    "CREATE INDEX IF NOT EXISTS idx_screening_event_attendees_event ON screening_event_attendees(event_id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_event_attendees_user ON screening_event_attendees(user_id)",
    /* ── v19 Phase C — perf hardening indexes (migration 0040 mirror).
     *    Run after all ALTERs so chapter_id columns exist on dsc_votes etc. ── */
    "CREATE INDEX IF NOT EXISTS idx_expert_questions_hot               ON expert_questions (tenant_id, chapter_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_expert_answers_question_upvote     ON expert_answers (question_id, upvote_count DESC)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_calendar          ON screening_events (tenant_id, chapter_id, scheduled_for)",
    "CREATE INDEX IF NOT EXISTS idx_messages_thread_hot                ON messages (tenant_id, chapter_id, thread_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_collective_billing_user_chapter    ON collective_memberships_billing (tenant_id, user_id, chapter_id)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_announcements_hot          ON chapter_announcements (tenant_id, chapter_id, pinned, priority)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_resources_hot              ON chapter_resources (tenant_id, chapter_id, resource_type, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_message_threads_hot                ON message_threads (tenant_id, chapter_id, last_activity_at)",
    "CREATE INDEX IF NOT EXISTS idx_partner_portfolio_hot              ON partner_portfolio_companies (tenant_id, partner_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_partner_deal_pipeline_hot          ON partner_deal_pipeline (tenant_id, partner_id, stage, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_partner_crm_hot                    ON partner_crm_contacts (tenant_id, partner_id, last_contact_at)",
    "CREATE INDEX IF NOT EXISTS idx_collective_billing_events_chain    ON collective_billing_events (tenant_id, billing_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_chain_walk               ON audit_log (tenant_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_dsc_votes_chain_walk               ON dsc_votes (chapter_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_announcements_chain_walk   ON chapter_announcements (chapter_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_resources_chain_walk       ON chapter_resources (chapter_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_chain_walk                ON messages (chapter_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_screening_events_chain_walk        ON screening_events (chapter_id, created_at, id)",
    "CREATE INDEX IF NOT EXISTS idx_expert_questions_chain_walk        ON expert_questions (chapter_id, created_at, id)",
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

    // v17 Phase A — default chapter + chapter_id backfill. Idempotent.
    // Creates the 'chap_keiretsu_canada' default chapter so legacy v16
    // Collective rows (collective_waitlist, dsc_feedback, dsc_votes,
    // soft_circles) can be tagged to it. Demo seeding adds the other
    // 3 chapters (Toronto / NYC / SF) via server/lib/seedDemoData.ts.
    db.exec(`
      INSERT OR IGNORE INTO tenants (id, kind, name, billing_email, status, is_demo, created_at, updated_at, deleted_at)
      VALUES (
        'tenant_chap_chap_keiretsu_canada',
        'consortium_partner',
        'Capavate Collective — Keiretsu Forum Canada',
        NULL,
        'active',
        0,
        datetime('now'),
        NULL,
        NULL
      )
    `);
    db.exec(`
      INSERT OR IGNORE INTO chapters (
        id, tenant_id, name, region, city, status,
        admin_user_id, partner_org_id, membership_fee_annual_minor,
        founded, created_at, updated_at, deleted_at
      ) VALUES (
        'chap_keiretsu_canada',
        'tenant_chap_chap_keiretsu_canada',
        'Capavate Collective — Keiretsu Forum Canada',
        'NA-East',
        'Toronto',
        'active',
        NULL,
        'tenant_cp_keiretsu_ca',
        0,
        NULL,
        datetime('now'),
        NULL,
        NULL
      )
    `);
    db.exec(`UPDATE collective_waitlist SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL`);
    db.exec(`UPDATE dsc_feedback        SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL`);
    db.exec(`UPDATE dsc_votes           SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL`);
    db.exec(`UPDATE soft_circles        SET chapter_id = 'chap_keiretsu_canada' WHERE chapter_id IS NULL`);

    /* CP Phase B — one-time backfill of existing approved-by-fiat
     * partner_deal_promotions rows (status='live'). They were created
     * by the legacy promote-to-collective path which bypassed
     * moderation; mark them moderation_status='approved' with
     * moderated_at=created_at so they remain visible in the deal room
     * post-migration. Idempotent: only flips rows with NULL/empty
     * moderation_status, and gated by a _migrations_applied marker so
     * we don't re-stamp moderated_at on every boot.
     */
    try {
      const row: any = db.prepare(
        "SELECT key FROM _migrations_applied WHERE key = 'cp_b_promotion_moderation_backfill_v1'"
      ).get();
      if (!row) {
        db.exec(
          `UPDATE partner_deal_promotions
             SET moderation_status = 'approved',
                 moderated_at      = COALESCE(approved_at, created_at)
             WHERE status = 'live' AND (moderation_status IS NULL OR moderation_status = '' OR moderation_status = 'pending')`
        );
        db.exec(
          `INSERT OR IGNORE INTO _migrations_applied (key, applied_at, details)
             VALUES ('cp_b_promotion_moderation_backfill_v1', datetime('now'), 'CP Phase B 0047 backfill')`
        );
      }
    } catch (e) {
      // Table may not exist on first boot — ignore.
      if (!/no such table/i.test(String((e as Error).message))) {
        log.warn("[db] CP-B promotion backfill failed (continuing):", (e as Error).message);
      }
    }
  } catch (err) {
    log.warn("[db] v12 backfill encountered an issue (continuing):", (err as Error).message);
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
      deleted_at TEXT,
      billing_cycle TEXT,
      annual_price_cents INTEGER
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
    // ---------- Patch v13 — Avi's Issues 3/4/5 ----------
    `CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      target_amount REAL NOT NULL,
      raised_amount REAL NOT NULL DEFAULT 0,
      pre_money REAL,
      post_money REAL,
      price_per_share REAL,
      min_ticket REAL,
      close_date TEXT,
      terms_summary TEXT,
      lead_investor TEXT,
      currency TEXT,
      region TEXT,
      open_date TEXT,
      instrument TEXT,
      extras_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      created_by TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      period TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      content_json TEXT NOT NULL,
      delivery_targets_json TEXT,
      generated_at TEXT,
      generated_by TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS network_posts (
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
    );`,
    // v15 P0-4..P0-8 — founder invitations: real persisted invitations with
    // sha256-hashed tokens, 14-day expiry, single-use redeem. The base table
    // already exists in the drizzle schema with a 6-column shape; this
    // production statement defines the FULL v15 shape so :memory: SQLite test
    // runs have every column ready. Extra columns are also added via additive
    // ALTERs in applyV15AdditiveAlters to upgrade existing dev databases.
    `CREATE TABLE IF NOT EXISTS round_invitations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT,
      round_id TEXT NOT NULL,
      company_id TEXT,
      investor_email TEXT NOT NULL,
      investor_name TEXT,
      state TEXT NOT NULL,
      classification TEXT,           -- 'in_crm' | 'new_registration'
      token_hash TEXT,               -- sha256(token), never the raw token
      invited_by_user_id TEXT,
      note TEXT,
      sent_at TEXT,
      viewed_at TEXT,
      redeemed_at TEXT,
      redeemed_by_user_id TEXT,
      expires_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // v15 P0-9..P0-11 — soft-circle persistence + SSE + Collective wiring.
    `CREATE TABLE IF NOT EXISTS soft_circles (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT,
      round_id TEXT NOT NULL,
      company_id TEXT,
      invitation_id TEXT,
      investor_user_id TEXT,
      investor_email TEXT,
      investor_name TEXT NOT NULL,
      amount REAL NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL,          -- intent | confirmed | committed | declined
      collective_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // v15 P0-12 — per-tenant compliance holds replace the single global flag.
    `CREATE TABLE IF NOT EXISTS compliance_holds (
      tenant_id TEXT PRIMARY KEY NOT NULL,
      on_flag INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      held_by TEXT,
      held_at TEXT,
      released_at TEXT,
      updated_at TEXT
    );`,
    // v16 Fix 6 — Collective waitlist persistence.
    `CREATE TABLE IF NOT EXISTS collective_waitlist (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      user_id TEXT NOT NULL,
      company_id TEXT,
      payload TEXT NOT NULL,
      chapter_hint TEXT,
      status TEXT NOT NULL DEFAULT 'waitlist',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      deleted_at TEXT
    );`,
    // v16 Addendum A — DSC feedback DB migration.
    `CREATE TABLE IF NOT EXISTS dsc_feedback (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      submitter_user_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      score_json TEXT,
      notes TEXT,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    // v16 Addendum B — DSC votes (hash-chained foundation).
    `CREATE TABLE IF NOT EXISTS dsc_votes (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      round_id TEXT,
      voter_user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      conditions TEXT,
      notes TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      cast_at TEXT NOT NULL,
      superseded_at TEXT,
      deleted_at TEXT
    );`,
    // v17 Phase A — chapters (load-bearing schema change).
    // Each chapter is its own tenant (tenant_chap_<id>). See migration
    // 0020_chapters.sql for the canonical source-of-truth.
    `CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      city TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      admin_user_id TEXT,
      partner_org_id TEXT,
      membership_fee_annual_minor INTEGER DEFAULT 0,
      dsc_quorum_pct INTEGER NOT NULL DEFAULT 50,
      founded TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // v17 Phase A — chapter_memberships.
    // Per-user join rows. role: 'member'|'admin'. status: 'active'|'pending'|'revoked'.
    `CREATE TABLE IF NOT EXISTS chapter_memberships (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // ─────────────────────────────────────────────────────────────
    // v17 Phase B — 8 Collective stores migrated to DB.
    // Each table mirrors `shared/schema.ts` and has matching SQL in
    // migrations/0022-0029. Idempotent CREATE TABLE IF NOT EXISTS so
    // :memory: SQLite test runs have these ready for hydration on boot.
    // ─────────────────────────────────────────────────────────────
    // 1) collective_apps — investor membership applications.
    `CREATE TABLE IF NOT EXISTS collective_apps (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      payload_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 2) collective_memberships — active membership rows (one per user).
    `CREATE TABLE IF NOT EXISTS collective_memberships (
      user_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      tier TEXT NOT NULL DEFAULT 'standard',
      activated_at TEXT NOT NULL,
      activated_by TEXT NOT NULL,
      deactivated_at TEXT,
      deactivated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 3a) founder_collective_nominations — Path A (investor-vouched).
    `CREATE TABLE IF NOT EXISTS founder_collective_nominations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      founder_id TEXT NOT NULL,
      vouching_investor_id TEXT NOT NULL,
      pitch_summary TEXT NOT NULL,
      deck_link TEXT,
      supplementary_notes TEXT,
      asks TEXT,
      status TEXT NOT NULL DEFAULT 'pending_vouch',
      submitted_at TEXT NOT NULL,
      vouched_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 3b) founder_collective_applications — Path B (direct).
    `CREATE TABLE IF NOT EXISTS founder_collective_applications (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      founder_id TEXT NOT NULL,
      pitch_deck_filename TEXT NOT NULL,
      traction_mrr INTEGER NOT NULL DEFAULT 0,
      traction_users INTEGER NOT NULL DEFAULT 0,
      traction_growth_pct INTEGER NOT NULL DEFAULT 0,
      asks TEXT NOT NULL,
      references_text TEXT NOT NULL DEFAULT '',
      cover_letter TEXT NOT NULL,
      fee_acknowledged INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted',
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 4) investor_nominations — sprint21Portfolio (hash-chained audit).
    //    v17 Phase C — status/decline_reason/decided_*/round_id columns for accept/decline state machine + round cascade.
    `CREATE TABLE IF NOT EXISTS investor_nominations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      investor_user_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decline_reason TEXT,
      decided_at TEXT,
      decided_by TEXT,
      round_id TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 5a) dsc_roles — adminDsc role assignments (hash-chained promote/demote).
    `CREATE TABLE IF NOT EXISTS dsc_roles (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      prev_hash TEXT,
      hash TEXT NOT NULL,
      promoted_by TEXT NOT NULL,
      promoted_at TEXT NOT NULL,
      demoted_at TEXT,
      demoted_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 5b) dsc_pipeline — adminDsc screening pipeline.
    `CREATE TABLE IF NOT EXISTS dsc_pipeline (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // 6) collective_settings — per-user settings (hash-chained).
    `CREATE TABLE IF NOT EXISTS collective_settings (
      user_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      anonymity_level TEXT NOT NULL DEFAULT 'public',
      notify_on_dsc_score INTEGER NOT NULL DEFAULT 1,
      notify_on_deal_room_update INTEGER NOT NULL DEFAULT 1,
      deal_room_visibility TEXT NOT NULL DEFAULT 'visible',
      version INTEGER NOT NULL DEFAULT 1,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    // 7) collective_channel_posts — commsStore Collective slice only.
    `CREATE TABLE IF NOT EXISTS collective_channel_posts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      author_kind TEXT NOT NULL DEFAULT 'user',
      body TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public_to_collective',
      liked_by_json TEXT NOT NULL DEFAULT '[]',
      comments_json TEXT NOT NULL DEFAULT '[]',
      comment_count INTEGER NOT NULL DEFAULT 0,
      share_count INTEGER NOT NULL DEFAULT 0,
      topics_json TEXT,
      media_urls_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      edited_at TEXT,
      deleted_at TEXT
    );`,
    // 8) partner_deal_promotions — partnerWorkspace Collective slice (hash-chained).
    `CREATE TABLE IF NOT EXISTS partner_deal_promotions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      pipeline_deal_id TEXT NOT NULL,
      promotion_type TEXT NOT NULL,
      company_id TEXT,
      target_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      promoted_by TEXT NOT NULL,
      promoted_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT,
      rejected_at TEXT,
      rejected_by TEXT,
      rejected_reason TEXT,
      withdrawn_at TEXT,
      withdrawn_by TEXT,
      notes TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      is_seed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    // ─────────────────────────────────────────────────────────────
    // v18 Phase A — screening_events + screening_event_attendees.
    // Hash-chained event lifecycle; one attendee row per (event, user).
    // ics_uid is unique so calendar dedup works across re-downloads.
    // ─────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS screening_events (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      round_id TEXT,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scheduled_for INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      location TEXT,
      event_type TEXT NOT NULL DEFAULT 'screening',
      status TEXT NOT NULL DEFAULT 'scheduled',
      organizer_user_id TEXT NOT NULL,
      ics_uid TEXT NOT NULL UNIQUE,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS screening_event_attendees (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'observer',
      rsvp TEXT NOT NULL DEFAULT 'invited',
      attended INTEGER NOT NULL DEFAULT 0,
      checked_in_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(event_id, user_id)
    );`,
    // ─────────────────────────────────────────────────────────────
    // v18 Phase B — Stripe Collective membership billing.
    // Two hash-chained tables; UNIQUE(user_id, chapter_id) on the billing
    // row, UNIQUE(stripe_event_id) on the events ledger (idempotency key).
    // ─────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS collective_memberships_billing (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_price_id TEXT,
      current_period_start INTEGER,
      current_period_end INTEGER,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(user_id, chapter_id)
    );`,
    `CREATE TABLE IF NOT EXISTS collective_billing_events (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      billing_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      stripe_event_id TEXT NOT NULL UNIQUE,
      raw_payload TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_tenant         ON collective_memberships_billing(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_chapter        ON collective_memberships_billing(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_user           ON collective_memberships_billing(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_status         ON collective_memberships_billing(status);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_stripe_sub     ON collective_memberships_billing(stripe_subscription_id);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_events_billing ON collective_billing_events(billing_id);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_events_type    ON collective_billing_events(event_type);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_billing_events_tenant  ON collective_billing_events(tenant_id);`,
    /* ── v18 Phase C — Ask-an-Expert (Q&A + reputation) ── */
    `CREATE TABLE IF NOT EXISTS expert_questions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      asker_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      best_answer_id TEXT,
      flag_reason TEXT,
      flagged_by_user_id TEXT,
      flagged_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS expert_answers (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      responder_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      upvote_count INTEGER NOT NULL DEFAULT 0,
      is_best_answer INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      flag_reason TEXT,
      flagged_by_user_id TEXT,
      flagged_at TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS expert_votes (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      answer_id TEXT NOT NULL,
      voter_user_id TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(answer_id, voter_user_id)
    );`,
    `CREATE TABLE IF NOT EXISTS expert_reputation (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      questions_asked INTEGER NOT NULL DEFAULT 0,
      answers_given INTEGER NOT NULL DEFAULT 0,
      best_answers INTEGER NOT NULL DEFAULT 0,
      upvotes_received INTEGER NOT NULL DEFAULT 0,
      last_milestone_notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(user_id, chapter_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_expert_questions_tenant   ON expert_questions(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_questions_chapter  ON expert_questions(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_questions_asker    ON expert_questions(asker_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_questions_status   ON expert_questions(status);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_questions_created  ON expert_questions(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_answers_tenant     ON expert_answers(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_answers_chapter    ON expert_answers(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_answers_question   ON expert_answers(question_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_answers_responder  ON expert_answers(responder_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_answers_status     ON expert_answers(status);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_votes_tenant       ON expert_votes(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_votes_chapter      ON expert_votes(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_votes_answer       ON expert_votes(answer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_votes_voter        ON expert_votes(voter_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_reputation_tenant  ON expert_reputation(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_reputation_chapter ON expert_reputation(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_reputation_user    ON expert_reputation(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expert_reputation_score   ON expert_reputation(score);`,
    /* ── v19 Phase A — chapter_announcements + announcement_reads ── */
    `CREATE TABLE IF NOT EXISTS chapter_announcements (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'normal',
      audience TEXT NOT NULL DEFAULT 'all',
      expires_at TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS announcement_reads (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      announcement_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      UNIQUE(announcement_id, user_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_tenant   ON chapter_announcements(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_chapter  ON chapter_announcements(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_author   ON chapter_announcements(author_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_pinned   ON chapter_announcements(pinned);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_priority ON chapter_announcements(priority);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_expires  ON chapter_announcements(expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_announcements_created  ON chapter_announcements(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement ON announcement_reads(announcement_id);`,
    `CREATE INDEX IF NOT EXISTS idx_announcement_reads_user        ON announcement_reads(user_id);`,
    /* ── v19 Phase A — chapter_resources ── */
    `CREATE TABLE IF NOT EXISTS chapter_resources (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      uploader_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      resource_type TEXT NOT NULL DEFAULT 'link',
      url TEXT NOT NULL,
      file_size_bytes INTEGER,
      mime_type TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'members',
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      flag_reason TEXT,
      flagged_by_user_id TEXT,
      flagged_at TEXT,
      download_count INTEGER NOT NULL DEFAULT 0,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_tenant     ON chapter_resources(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_chapter    ON chapter_resources(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_uploader   ON chapter_resources(uploader_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_type       ON chapter_resources(resource_type);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_visibility ON chapter_resources(visibility);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_status     ON chapter_resources(status);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_resources_created    ON chapter_resources(created_at);`,
    /* ── v19 Phase A — chapter_leaderboard_snapshots ── */
    `CREATE TABLE IF NOT EXISTS chapter_leaderboard_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      period TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL,
      UNIQUE(chapter_id, period, period_start)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_tenant    ON chapter_leaderboard_snapshots(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_chapter   ON chapter_leaderboard_snapshots(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_period    ON chapter_leaderboard_snapshots(period);`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_leaderboard_generated ON chapter_leaderboard_snapshots(generated_at);`,
    /* ── v19 Phase B — messaging tables ── */
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT,
      thread_id TEXT,
      channel_type TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      recipient_user_ids TEXT NOT NULL DEFAULT '[]',
      subject TEXT,
      body TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      read_by TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'sent',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_messages_tenant       ON messages(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_chapter      ON messages(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_thread       ON messages(thread_id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_channel_type ON messages(channel_type);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created      ON messages(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_status       ON messages(status);`,
    `CREATE TABLE IF NOT EXISTS message_threads (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      participant_user_ids TEXT NOT NULL DEFAULT '[]',
      last_message_id TEXT,
      last_activity_at TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_message_threads_tenant     ON message_threads(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_message_threads_chapter    ON message_threads(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_message_threads_created_by ON message_threads(created_by_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_message_threads_activity   ON message_threads(last_activity_at);`,
    `CREATE TABLE IF NOT EXISTS message_read_receipts (
      id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message ON message_read_receipts(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_message_read_receipts_user    ON message_read_receipts(user_id);`,
    /* ── v19 Phase B — partner workspace remaining tables ── */
    `CREATE TABLE IF NOT EXISTS partner_portfolio_companies (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'seed',
      sector TEXT NOT NULL DEFAULT '',
      lead_invested_amount_minor INTEGER NOT NULL DEFAULT 0,
      first_invested_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_tenant     ON partner_portfolio_companies(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_partner    ON partner_portfolio_companies(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_company    ON partner_portfolio_companies(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_visibility ON partner_portfolio_companies(visibility);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_stage      ON partner_portfolio_companies(stage);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_created    ON partner_portfolio_companies(created_at);`,
    `CREATE TABLE IF NOT EXISTS partner_crm_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      contact_user_id TEXT,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      last_contact_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_crm_tenant   ON partner_crm_contacts(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_crm_partner  ON partner_crm_contacts(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_crm_user     ON partner_crm_contacts(contact_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_crm_email    ON partner_crm_contacts(email);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_crm_created  ON partner_crm_contacts(created_at);`,
    `CREATE TABLE IF NOT EXISTS partner_deal_pipeline (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'sourced',
      assigned_user_ids TEXT NOT NULL DEFAULT '[]',
      target_close_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      legacy_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_deal_tenant  ON partner_deal_pipeline(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_deal_partner ON partner_deal_pipeline(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_deal_company ON partner_deal_pipeline(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_deal_stage   ON partner_deal_pipeline(stage);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_deal_created ON partner_deal_pipeline(created_at);`,

    /* ── v19 Phase C — audit_chain_verifications ── */
    `CREATE TABLE IF NOT EXISTS audit_chain_verifications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      chapter_id TEXT,
      table_name TEXT NOT NULL,
      verified_count INTEGER NOT NULL DEFAULT 0,
      broken_count INTEGER NOT NULL DEFAULT 0,
      broken_first_id TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      details_json TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_tenant  ON audit_chain_verifications(tenant_id, started_at);`,
    `CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_chapter ON audit_chain_verifications(chapter_id, table_name, started_at);`,
    `CREATE INDEX IF NOT EXISTS idx_audit_chain_verifications_table   ON audit_chain_verifications(table_name, started_at);`,

    /* ── CP Phase A — SPV / Fund DB migration (migration 0041) ── */
    `CREATE TABLE IF NOT EXISTS spvs (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      lead_company_id TEXT,
      structure_type TEXT NOT NULL DEFAULT 'spv',
      status TEXT NOT NULL DEFAULT 'forming',
      target_minor INTEGER NOT NULL DEFAULT 0,
      committed_minor INTEGER NOT NULL DEFAULT 0,
      called_minor INTEGER NOT NULL DEFAULT 0,
      distributed_minor INTEGER NOT NULL DEFAULT 0,
      gp_user_id TEXT,
      formed_at TEXT,
      closes_at TEXT,
      terms TEXT NOT NULL DEFAULT '{}',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spvs_tenant     ON spvs(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spvs_partner    ON spvs(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spvs_status     ON spvs(status);`,
    `CREATE INDEX IF NOT EXISTS idx_spvs_lead_co    ON spvs(lead_company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spvs_chain_walk ON spvs(partner_id, created_at, id);`,

    `CREATE TABLE IF NOT EXISTS spv_commitments (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      spv_id TEXT NOT NULL,
      lp_user_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      commitment_doc_url TEXT,
      signed_at TEXT,
      funded_at TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_commitments_tenant     ON spv_commitments(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_commitments_spv        ON spv_commitments(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_commitments_lp         ON spv_commitments(lp_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_commitments_status     ON spv_commitments(status);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_commitments_chain_walk ON spv_commitments(spv_id, created_at, id);`,

    `CREATE TABLE IF NOT EXISTS spv_capital_calls (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      spv_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0,
      called_at TEXT NOT NULL,
      due_at TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_tenant     ON spv_capital_calls(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_spv        ON spv_capital_calls(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_seq        ON spv_capital_calls(spv_id, sequence_no);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_chain_walk ON spv_capital_calls(spv_id, created_at, id);`,

    `CREATE TABLE IF NOT EXISTS spv_distributions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      spv_id TEXT NOT NULL,
      distribution_type TEXT NOT NULL DEFAULT 'dividend',
      total_minor INTEGER NOT NULL DEFAULT 0,
      distributed_at TEXT NOT NULL,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_distributions_tenant     ON spv_distributions(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_distributions_spv        ON spv_distributions(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_distributions_type       ON spv_distributions(distribution_type);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_distributions_chain_walk ON spv_distributions(spv_id, created_at, id);`,

    `CREATE TABLE IF NOT EXISTS spv_positions (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      spv_id TEXT NOT NULL,
      security_id TEXT NOT NULL,
      shares TEXT NOT NULL DEFAULT '0',
      basis_minor INTEGER NOT NULL DEFAULT 0,
      acquired_at TEXT,
      status TEXT NOT NULL DEFAULT 'held',
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_positions_tenant     ON spv_positions(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_positions_spv        ON spv_positions(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_positions_security   ON spv_positions(security_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_positions_status     ON spv_positions(status);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_positions_chain_walk ON spv_positions(spv_id, created_at, id);`,

    /* ── CP Phase A — One-time backfill / chain stitch tracker (migration 0042). ── */
    `CREATE TABLE IF NOT EXISTS _migrations_applied (
      key TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );`,

    /* ── CP Phase B — consortium_applications (migration 0044; CP-001..005). ── */
    `CREATE TABLE IF NOT EXISTS consortium_applications (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT,
      expected_chapter_id TEXT,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      contact_phone TEXT,
      organization_name TEXT NOT NULL,
      website TEXT,
      jurisdiction TEXT NOT NULL DEFAULT '',
      partner_type TEXT NOT NULL DEFAULT 'other',
      aum_range TEXT NOT NULL DEFAULT 'undisclosed',
      portfolio_company_count INTEGER NOT NULL DEFAULT 0,
      expected_chapter TEXT NOT NULL DEFAULT '',
      intro_message TEXT NOT NULL DEFAULT '',
      referred_by TEXT,
      source_ip TEXT,
      source_user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      reviewed_by_user_id TEXT,
      review_notes TEXT,
      provisioned_partner_id TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      updated_at TEXT NOT NULL,
      invite_payload_json TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_consortium_applications_status     ON consortium_applications(status);`,
    `CREATE INDEX IF NOT EXISTS idx_consortium_applications_chapter    ON consortium_applications(expected_chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_consortium_applications_partner    ON consortium_applications(partner_type);`,
    `CREATE INDEX IF NOT EXISTS idx_consortium_applications_email      ON consortium_applications(contact_email);`,
    `CREATE INDEX IF NOT EXISTS idx_consortium_applications_created    ON consortium_applications(created_at);`,

    /* ── CP Phase B — partner_organizations (migration 0045; CP-002). ── */
    `CREATE TABLE IF NOT EXISTS partner_organizations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT '',
      partner_type TEXT NOT NULL DEFAULT 'other',
      aum_range TEXT NOT NULL DEFAULT 'undisclosed',
      primary_chapter_id TEXT,
      website TEXT,
      logo_url TEXT,
      banner_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      onboarding_state TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_orgs_tenant   ON partner_organizations(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_orgs_chapter  ON partner_organizations(primary_chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_orgs_status   ON partner_organizations(status);`,

    /* ── CP Phase B — data_export_log / data_delete_log (migration 0048; CP-013). ── */
    `CREATE TABLE IF NOT EXISTS data_export_log (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      exported_at TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'json',
      bytes INTEGER NOT NULL DEFAULT 0,
      request_ip TEXT,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_data_export_log_user    ON data_export_log(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_data_export_log_tenant  ON data_export_log(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_data_export_log_created ON data_export_log(created_at);`,

    `CREATE TABLE IF NOT EXISTS data_delete_log (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      confirmed_at TEXT,
      initiated_by_user_id TEXT NOT NULL,
      reason TEXT,
      records_redacted INTEGER NOT NULL DEFAULT 0,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_data_delete_log_user      ON data_delete_log(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_data_delete_log_tenant    ON data_delete_log(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_data_delete_log_created   ON data_delete_log(created_at);`,

    /* v19 Phase C perf indexes moved to applyV12AdditiveAlters() so they
     * run AFTER all v17 ALTER TABLE statements (which add chapter_id
     * columns to dsc_votes / collective_waitlist / etc.). See line ~407. */
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

    // Wave C FIX C3 — bridge_outbox table baked into inline DDL so the
    // bridge envelope write-through works without depending on the per-file
    // migration runner having fired (NODE_ENV=test uses :memory: and skips
    // the migration runner). Mirrors migrations/0000.
    `CREATE TABLE IF NOT EXISTS bridge_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_kind TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      hmac TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      enqueued_at TEXT NOT NULL,
      delivered_at TEXT,
      last_error TEXT
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

/**
 * v19 Wave A / Change 1 — surface the inline-DDL applier so server/db/migrate.ts
 * can prime a fresh SQLite database with the baseline schema BEFORE applying
 * the per-file migration set on top. Pure re-export; does not change behavior
 * for any existing caller. The first arg is the raw better-sqlite3 handle.
 */
export function applyInlineMigrationsForFreshDb(rawSqliteHandle: any): void {
  applyInlineMigrations(rawSqliteHandle);
}

