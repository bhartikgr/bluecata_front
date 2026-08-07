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

/* ---------------------------------------------------------------------------
 * Wave C-2 v26.6.0 (D1 integration) — the nine self-heal schema installers for
 * migrations 0128-0137. Each lives at server/lib/<name>.ts and imports `log`
 * from "./logger" (sibling); from server/db/ the path is "../lib/<name>".
 *
 * NOTE on the 0132 symbol: the delivered file is
 *   server/lib/applyWaveC2SoftCircleProvenanceSchema.ts
 * but its PRIMARY export is `applyWaveC2PipelineSchema` (spec §2.2's 0132 row);
 * `applyWaveC2SoftCircleProvenanceSchema` exists only as a re-export alias at
 * that file's :195. D1 imports the primary name.
 *
 * NOTE on the 0128 symbol: the delivered c2_a_0128 file declares
 * `function applyWaveC2MfcStagesSchema(db: any)` WITHOUT `export` and imports
 * `log` from "../lib/logger" (it was drafted to be inlined into THIS file).
 * D1 relocates it to server/lib/applyWaveC2MfcStagesSchema.ts, adds `export`,
 * and rewrites its own log import to "./logger" — see ASSUMPTIONS_D1.md D1-02.
 * ------------------------------------------------------------------------- */
import { applyWaveC2MfcStagesSchema } from "../lib/applyWaveC2MfcStagesSchema";
import { applyD25Slice3CollectiveEnvFallbackSchema } from "../lib/applyD25Slice3CollectiveEnvFallbackSchema";
import { applyWaveC2PartnerAttributionsScopeSchema } from "../lib/applyWaveC2PartnerAttributionsScopeSchema";
import { applyWaveC2AuthorityArtifactsSchema } from "../lib/applyWaveC2AuthorityArtifactsSchema";
import { applyWaveC2MfEngagementSchema } from "../lib/applyWaveC2MfEngagementSchema";
import { applyWaveC2PipelineSchema } from "../lib/applyWaveC2SoftCircleProvenanceSchema";
import { applyWaveC2ProvenanceColumnsSchema } from "../lib/applyWaveC2ProvenanceColumnsSchema";
import { applyWaveC2ClientScopeSchema } from "../lib/applyWaveC2ClientScopeSchema";
import { applyWaveC2PcrSpineSchema } from "../lib/applyWaveC2PcrSpineSchema";
import { applyWaveC2ClassificationRequestsSchema } from "../lib/applyWaveC2ClassificationRequestsSchema";

/* Wave C-2.e / D3 — the KV-to-SQL partner-pipeline data backfill (spec §2.2's
 * 0132 row). Lives at server/db/backfills/ per ASSUMPTIONS_D3.md:4. This is a
 * SAFE static import cycle (that module imports `rawDb` back from this file);
 * see the long rationale at the deferred call site at the tail of
 * applyInlineMigrations before changing it to a lazy require. */
import { runWaveC2PipelineKvBackfill } from "./backfills/runWaveC2PipelineKvBackfill";

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
  // Wave 0 deliverable 0-9 parts 1 & 2 — statement-form defence.
  // recursive_triggers = ON: with the SQLite default OFF, `INSERT OR REPLACE`
  // fires no `BEFORE DELETE` trigger, silently bypassing every immutability
  // guard in V7 §5. V7 §5.0.0 finding "0.9-mut8" — largest single defect this
  // report has found. Per-connection setting; resets on every new connection,
  // so belongs in the factory (not in a migration).
  // foreign_keys = ON: driver default happens to be ON, but that is not a
  // guarantee — V7 §5.0 explicitly requires this be asserted, not assumed.
  _rawSqlite.pragma("recursive_triggers = ON");
  _rawSqlite.pragma("foreign_keys = ON");
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

  /* v25.33 -- Consortium Partner Payment Model schema. Additive over Avi's
   * writes; reads DB-direct. Idempotent so safe on every boot. */
  applyV2533PartnerPaymentSchema(db);

  /* v25.34 -- Collective Mega-Wave. Re-asserts the 7 Collective store tables
   * idempotently (for first-boot / live-server safety on the GoDaddy VPS) and
   * creates the NEW parallel Collective Payment Model tables (schedules,
   * entries, invoices). Additive over Avi's writes; all reads DB-direct. */
  applyV2534CollectiveSchema(db);

  /* v25.38 -- Admin DB-driven pricing config (additive, idempotent). Mirrors
   * migrations 0057 (collective_application_fee_config) and 0058
   * (partner_commission_rate_config) so the dual bootstrap+migration path keeps
   * a config row present on a fresh live-server boot. Avi's COMMISSION_RATE
   * literal in partnerConsortiumRoutes.ts is UNTOUCHED — these tables back the
   * new resolvers only. CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE. */
  applyV2538PricingConfigSchema(db);

  /* v25.42h -- Housekeeping wave. Replaces the in-memory telemetry envelope
   * buffer in sprint10Telemetry.ts with a DB-backed `telemetry_events` table
   * (the high-volume KPI firehose alongside audit_log). Additive only:
   * CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. No columns are
   * altered on existing tables and there are NO foreign keys to Avi-owned
   * tables, so this cannot constrain Avi data. Idempotent + boot-safe. */
  applyV2542HTelemetryEventsSchema(db);

  /* v25.45.4 -- Ozan live-QA wave. Mirrors migrations 0064-0066 idempotently so
   * the dual bootstrap+migration path keeps these tables present on a fresh
   * boot / fresh test DB:
   *   - profile_wizard_state    (M-4 wizard persistence)
   *   - collective_pitch_decks  (M-7 pitch-deck upload metadata)
   *   - platform_fees           (L-2 DB-backed platform fees; v25.46 foundation)
   * Additive only: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE. The dataroom
   * storage pointer columns (migration 0067) are handled by applyV12AdditiveAlters. */
  applyV2545_4Schema(db);

  /* v25.47 — Tier-6 release. Additive only (CREATE TABLE IF NOT EXISTS +
   * INSERT OR IGNORE + PRAGMA-guarded ADD COLUMN). Mirrors migrations
   * 0069-0077 so the dual bootstrap+migration path keeps these present on a
   * fresh boot / fresh test DB. SEPARATE/PARALLEL to the Capavate founder/
   * investor subscription flow (Sacred Rule 76) — new subscription structures
   * live only in platform_fees rows. */
  applyV2547Schema(db);

  /* v25.48 — Investment-flow backlog (B3/B4/B5) + DATA-1 email templates.
   * Additive only (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE). Mirrors
   * migrations 0078-0081 so the dual bootstrap+migration path keeps these
   * present on a fresh boot / fresh test DB. PARALLEL to the Sacred cap-table
   * ledger (captableCommitStore) and Sacred emailStore in-memory template
   * list — new canonical state lives ONLY in these DB tables. */
  applyV2548Schema(db);

  /* v25.53 REVISE B3 (6a) — race-safe duplicate-invite guard. Mirrors migration
   * 0099 idempotently so the DB-authoritative partial+expression UNIQUE index on
   * ACTIVE round invitations is present on a fresh boot / fresh test DB, not only
   * after the migrate runner has run. Additive only (CREATE UNIQUE INDEX IF NOT
   * EXISTS). Best-effort: on a legacy DB that already holds an active duplicate,
   * index creation fails and is logged (the app-level preflight still blocks new
   * dupes); the migrate runner's 0099 fail-hard probe surfaces that loudly. */
  applyV2553RoundInviteUniqueIndex(db);

  /* v26.1.x ENH-1 — durable Your-Decision store. Mirrors migration 0107
   * idempotently so the DB-authoritative `your_decision_records` table (the new
   * source of truth for the Your-Decision 10-state machine) is present on a fresh
   * boot / fresh :memory: test DB, not only after the migrate runner has run.
   * Additive only (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS). No
   * FKs to Avi-owned / money-core tables and NEVER touches Airwallex/payments or
   * the cap-table ledger. The legacy kv_yourDecisionStore mirror is kept this
   * release as a secondary, non-authoritative belt-and-suspenders mirror. */
  applyEnh1YourDecisionDurableSchema(db);

  /* v26.1.x 1c — durable SPV launch sign-off. Mirrors migration 0108
   * idempotently so the `spv_launch_signoffs` table (the verifiable attestation
   * record captured before an SPV launch) is present on a fresh boot / fresh
   * :memory: test DB, not only after the migrate runner has run. Additive only
   * (CREATE TABLE / INDEX IF NOT EXISTS). No FKs to Avi-owned / money-core
   * tables and NEVER touches Airwallex/payments or the cap-table ledger. */
  applyC1cSpvLaunchSignoffSchema(db);

  /* v26.2.0 W1 H6 — fail-closed membership deactivation queue. Boot-safe +
   * idempotent so the gate can deny access while a deactivation is pending on a
   * fresh boot / :memory: test DB, before the migrate runner runs. Additive only.
   * State-table only; NEVER touches Airwallex/payments or the cap-table ledger. */
  applyH6MembershipDeactivationQueueSchema(db);

  /* v26.2.0 W2 A3/A4 (0110) — durable cap_table_exempt column on
   * collective_memberships for admin-bootstrapped members who bypass the
   * cap-table sub-check. Boot-safe + idempotent (ADD COLUMN wrapped; duplicate
   * column tolerated). Additive only; NEVER touches Airwallex/payments or the
   * cap-table ledger. */
  applyW2CapTableExemptSchema(db);

  /* Wave C v26.5.0 (0127) — add fd_pre_money_shares INTEGER column to `rounds`.
   * Shadie Finding 1a: PPS denominator MUST be fully-diluted pre-money shares
   * (existing common + preferred as-converted + granted options + reserved pool
   * + SAFE/note conversions), NOT sharesAuthorized (which is new-shares-issued).
   * Boot-safe + idempotent (ADD COLUMN wrapped; duplicate column tolerated).
   * Additive only; NEVER touches Airwallex/payments or the cap-table ledger. */
  applyWaveCFdPreMoneySharesSchema(db);

  /* ═══════════════════════════════════════════════════════════════════════
   * Wave C-2 v26.6.0 (D1) — nine self-heal installers, migrations 0128-0137.
   *
   * ORDERING CONTRACT. Every table these installers ALTER, and every FK target
   * they reference at CREATE time, is already present when the first line below
   * runs, because buildProductionTableStatements() executes at :193/:196 —
   * inside the tx() at :198, strictly BEFORE any statement in this function
   * body. The dependency order below is therefore *declarative documentation*
   * of the spec's dependency graph, not a load-bearing runtime guarantee; the
   * structural guarantee lives in the array (see the D1 additions there).
   *
   * The one ordering fact that IS load-bearing: 0131 and 0132 each add
   * `current_stage_id TEXT REFERENCES mfc_stages(id)` ONLY when a
   * sqlite_master probe finds `mfc_stages` (0131's :104-119, 0132's :81-111).
   * D1 satisfies that probe from the array (mfc_stages is now a
   * buildProductionTableStatements entry), which is why 0128 can safely run
   * LAST here without amputating those two columns for a boot. Do NOT remove
   * the mfc_stages array entry without also moving 0128 back to first.
   * ═══════════════════════════════════════════════════════════════════════ */

  /* 0129 (C-2.b) — LOCK 2: folds client_engagements into partner_attributions.
   * 5 additive columns (authority_artifact_id kept BARE, no REFERENCES, per
   * V32-M8 — authority_artifacts does not exist until 0130) plus the
   * uq_partner_attributions_active partial unique index, behind a duplicate-
   * grain pre-flight. No dependencies: partner_attributions is pre-existing
   * (migration 0114; array entry at :2129). */
  applyWaveC2PartnerAttributionsScopeSchema(db);

  /* 0130 (C-2.c) — authority_artifacts (engagement letters, client authority
   * scope grants, DPAs, referral consents) + 2 additive mf_engagement columns
   * (consent_scope NOT NULL DEFAULT 'public_data_only', authority_artifact_id).
   * Depends on partner_attributions' 0129 columns; the mf_engagement ALTERs
   * depend on the D1 full-shape mf_engagement array entry. */
  applyWaveC2AuthorityArtifactsSchema(db);

  /* 0131 (C-2.d) — LOCK 3-A. 6 additive mf_engagement columns
   * (founder_revoked_at, founder_revoked_by, archived_at, owner_user_id,
   * current_stage_id, current_stage_machine_type), 5 additive
   * mf_engagement_event columns, and one narrow 12-step rebuild of
   * mf_engagement_event. Depends on mf_engagement (D1 array entry) and, for
   * current_stage_id's REFERENCES clause, on mfc_stages (D1 array entry). */
  applyWaveC2MfEngagementSchema(db);

  /* 0132 (C-2.e) — pipeline unification. 16 additive partner_deal_pipeline
   * columns + uq_partner_deal_pipeline_legacy_id behind a duplicate pre-flight.
   * Touches NEITHER mf_engagement NOR soft_circles despite its filename; the
   * primary export is applyWaveC2PipelineSchema. Depends on mfc_stages (D1
   * array entry) for current_stage_id's REFERENCES clause. */
  applyWaveC2PipelineSchema(db);

  /* 0133 (C-2.f) — provenance columns (LOCK 1, LOCK 2, V32-M6). 5 additive
   * round_invitations columns (engagement_id kept BARE TEXT per V32-M8 — see
   * 0133's own :70-78 rationale) and 5 additive soft_circles columns. Must
   * cover BOTH tables in one call (V33-4-N2). Depends on partner_attributions
   * (0129) and, for read coherence, on mf_engagement existing (D1 array
   * entry) — but NOT at DDL time, since engagement_id carries no REFERENCES. */
  applyWaveC2ProvenanceColumnsSchema(db);

  /* 0134 (C-2.g) — partner_crm_contact_client_scope join table (§13.2 D2's
   * client-scoped sub-CRM). Greenfield table; created from the D1 array entry,
   * so this call's own CREATE TABLE IF NOT EXISTS is a genuine no-op. Depends
   * on partner_attributions (0129) + pre-C-2 partner_crm_contacts / users. */
  applyWaveC2ClientScopeSchema(db);

  /* 0136 (C-2.h) — partner_company_relationship spine + pcr_surface_presence
   * + pcr_id on the four real PCR surfaces (mf_engagement,
   * partner_deal_pipeline, partner_attributions, partner_portfolio_company).
   * soft_circles is explicitly NOT a PCR surface (§14.1). The two new tables
   * come from the D1 array entries; the four pcr_id ALTERs run here. */
  applyWaveC2PcrSpineSchema(db);

  /* 0137 (C-2.i) — mfc_classification_requests (live-blocker fix §8.2(b)).
   * Greenfield table from the D1 array entry; the partial UNIQUE index
   * uq_mfc_classification_requests_pending is the sole anti-spam mechanism
   * (V32-B6). Spec §2.2's 0137 row: "Depends on: none". */
  applyWaveC2ClassificationRequestsSchema(db);

  /* 0128 (C-2.a) — MFC stage engine (mfc_stages + mfc_stage_transitions).
   * Schema-only self-heal; seeds live exclusively in
   * migrations/0128_wave_c2_mfc_stages.sql. Registered LAST per the D1 brief:
   * its own guard probes partner_organizations (array entry :4159), which is
   * unconditionally present by :198, and both of its tables are already
   * created by the D1 array entries — so nothing downstream of it can be
   * starved. See the ORDERING CONTRACT note above before reordering. */
  applyWaveC2MfcStagesSchema(db);

  /* D2.5 Slice 3, Fix 3 — adds collective_subscription_configs.use_env_fallback
   * (INTEGER NOT NULL DEFAULT 1). Registered after applyWaveC2MfcStagesSchema
   * and BEFORE the collective_subscription_configs CREATE TABLE array entry
   * below has any bearing here: this self-heal itself guards on the table
   * already existing (sqlite_master check) and no-ops on a fresh DB where the
   * table has not been created yet this boot — the array entry creates the
   * base table unconditionally on every boot, and on the NEXT boot (or later
   * in the same boot, once the productionStmts chain has run) this self-heal
   * adds the column. Safe under all orderings; matches the ORDERING CONTRACT
   * pattern documented above applyWaveC2MfcStagesSchema. */
  applyD25Slice3CollectiveEnvFallbackSchema(db);

  /* Wave 0 deliverables 0-1 + 0-14 — mirror migrations/0121, 0122, 0123.
   *
   * Call-site pattern (Wave 0 Increment 1 v3 review fix, Opus blocker):
   *   - DDL failures for genuine environment reasons (permission denied,
   *     locked DB, disk full) are caught and logged. That matches the
   *     applyEnh1YourDecisionDurableSchema precedent and lets the bootstrap
   *     continue past a bad environment.
   *   - Wave0SeedDriftError is a special marker thrown by the inline apply
   *     functions when read-back verification detects that stored seed data
   *     disagrees with the pinned canonical values. This is NEVER recoverable
   *     and MUST fail boot: the currency_ref / platform_config tables carry
   *     immutability triggers, so a drift row is un-updatable and Wave D's
   *     money math would silently use wrong exponents or wrong policy values.
   *     Re-throw so ops sees the failure at boot rather than at first FX call.
   */
  const runWave0Apply = (name: string, fn: (db: any) => void) => {
    try {
      fn(db);
    } catch (e) {
      // v4 fix Opus B1 / GPT-5 M5: use the robust type guard (handles both
      // ES5-downlevel and modern emit) instead of bare `instanceof`.
      if (isWave0SeedDriftError(e)) {
        // Fail-fast: never continue past a drift. See class comment.
        log.error(`[db][wave0] ${name} DRIFT — aborting bootstrap:`, (e as Error).message);
        throw e;
      }
      log.warn(`[db][wave0] ${name} failed, continuing:`, e);
    }
  };

  runWave0Apply("applyWave0CurrencyRefSchema", applyWave0CurrencyRefSchema);
  runWave0Apply("applyWave0MoneyCoreSchema", applyWave0MoneyCoreSchema);
  runWave0Apply("applyWave0PlatformConfigSchema", applyWave0PlatformConfigSchema);

  /* ═══════════════════════════════════════════════════════════════════════
   * Wave C-2.e / D3 — KV-to-SQL partner-pipeline backfill.
   *
   * Spec §2.2's 0132 row calls for a "KV-to-SQL backfill (guarded TypeScript
   * boot step, `runWaveC2PipelineKvBackfill`, mirrors the 0114 precedent for
   * lazy-KV backfills — not raw SQL)". Unlike the nine `applyWaveC2*Schema`
   * installers above, this is a DATA migration, not DDL, so it is deliberately
   * NOT a synchronous statement in this function. Three reasons, all
   * load-bearing:
   *
   *  1. IMPORT-CYCLE SAFETY. The module imports `rawDb` from "../connection"
   *     (i.e. THIS file), so the static import at the top of this file is a
   *     cycle. It is a SAFE cycle, and deliberately a static import rather
   *     than a lazy `_require()`: the backfill's only `rawDb` reference is at
   *     its `:406` (`db = dbArg ?? rawDb()`), INSIDE the function body — its
   *     module-init phase touches nothing from this file (grep-verified: 2
   *     `rawDb` hits total, the import and :406). Under tsx/ESM the binding is
   *     live and hoisted; under the esbuild CJS bundle it is a getter resolved
   *     at call time. Either way the partially-initialised namespace is never
   *     read during evaluation. A lazy `_require("./backfills/…")` was
   *     REJECTED because `_require` is not statically analysable, so esbuild
   *     would leave it as a runtime resolution that cannot find a relative
   *     path inside the single-file `dist/index.cjs` bundle — note every
   *     existing `_require()` call in this file (:93, :94, :113, :114) names an
   *     external package, never a relative module. `server/lib/eventBus_helpers_LOCK4.ts`
   *     is the same-shaped precedent: it statically imports `rawDb` from
   *     "../db/connection" and calls it only inside function bodies.
   *
   *  2. RE-ENTRANCY. `applyInlineMigrations` is called from `getDb()` at :127,
   *     BEFORE `_driver` is assigned at :128. Anything the backfill does that
   *     reaches `rawDb()` while we are still inside this call would re-enter a
   *     half-initialised `getDb()`. `setImmediate` defers past `getDb()`'s
   *     return, so `_driver`/`_drizzleDb` are fully assigned before the
   *     backfill runs, and it reads the KV source it needs (`kv_partnerPipeline`,
   *     hydrated by storePersistenceShim) rather than a cold table.
   *
   *  3. IT READS STORES, NOT JUST TABLES. It consumes `hydrateEntries` from
   *     lib/storePersistenceShim, so it must not run inside the DDL phase.
   *
   * SAFETY. The module's entire body is wrapped in one try/catch that
   * `log.warn()`s and returns a structured result — it NEVER throws to boot
   * (V33-1-B1) — and it self-guards every schema prerequisite via
   * `sqlite_master` + `PRAGMA table_info` before any write, so a fresh,
   * zero-migrations-run database is a clean no-op. It is additionally
   * idempotent via the `BACKFILL_LOCK_ID = "backfill_0132"` advisory lock, so a
   * second boot reports `skipped='already_completed', inserted=0`. The extra
   * try/catch below is belt-and-braces against a require()-time resolution
   * failure only.
   *
   * OPT-OUT. Set WAVE_C2_SKIP_PIPELINE_KV_BACKFILL=1 to suppress the boot
   * invocation entirely (e.g. to run it manually, or `{verifyOnly:true}`, from
   * a script during a maintenance window). Skipped under NODE_ENV=test so the
   * suite's :memory: databases are not charged for it.
   * ═══════════════════════════════════════════════════════════════════════ */
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.WAVE_C2_SKIP_PIPELINE_KV_BACKFILL !== "1"
  ) {
    setImmediate(() => {
      try {
        const res = runWaveC2PipelineKvBackfill(db);
        if (res && res.skipped) {
          log.info(
            `[db] runWaveC2PipelineKvBackfill skipped: ${res.skipped}`,
          );
        } else if (res) {
          log.info(
            `[db] runWaveC2PipelineKvBackfill ok=${res.ok} kvRowsRead=${res.kvRowsRead} ` +
              `tenantsCommitted=${res.tenantsCommitted} inserted=${res.inserted} ` +
              `transitionsInserted=${res.transitionsInserted} ` +
              `skippedNullCompany=${res.skippedNullCompany} ` +
              `skippedLegacyIdConflict=${res.skippedLegacyIdConflict} ` +
              `stagesUnresolved=${res.stagesUnresolved}`,
          );
          for (const cv of res.chainVerify ?? []) {
            if (cv && cv.status !== "clean") {
              log.warn(
                `[db] runWaveC2PipelineKvBackfill chain ${cv.status} for tenant ${cv.partnerId ?? "?"}`,
              );
            }
          }
          for (const e of res.errors ?? []) {
            log.warn(`[db] runWaveC2PipelineKvBackfill error: ${String(e)}`);
          }
        }
      } catch (err) {
        // Non-fatal by contract. Boot continues regardless.
        log.warn(
          "[db] runWaveC2PipelineKvBackfill boot step failed (non-fatal):",
          err,
        );
      }
    });
  }
}

/**
 * Wave 0 Increment 1 v3+v4 review — fail-fast fix.
 *
 * Thrown by applyWave0*Schema functions when read-back drift detection finds
 * that stored seed data disagrees with the pinned canonical values (a
 * currency_ref row with a wrong exponent, or a platform_config row with a
 * hash that doesn't match the pinned literal). Recognized at the call site
 * and re-thrown to abort the entire bootstrap.
 *
 * Wave D and later depend on these tables holding exact values. Silently
 * continuing past drift would surface later as FK errors, wrong money math,
 * or a broken hash chain — far from the actual point of failure.
 *
 * v4 review Opus B1 + GPT-5 M5 fix: prototype repair + nominal marker.
 *
 * TypeScript ES5 downlevel emit (which the project's no-target tsconfig may
 * produce depending on toolchain) breaks `instanceof` for classes extending
 * built-ins like Error: `super(msg)` returns a new Error and the derived
 * prototype is lost. Two defenses, both cheap:
 *   1. `Object.setPrototypeOf(this, ...)` restores the prototype chain so
 *      `instanceof Wave0SeedDriftError` works even under ES5 emit.
 *   2. `readonly kind = 'wave0-seed-drift'` is a nominal string marker the
 *      call site can check independently of `instanceof`. Belt and braces.
 *
 * Exported so tests can (a) construct and assert against it, and (b) verify
 * the shipped apply functions raise it. Prior to v4 both were internal, which
 * defeated the tests that were meant to guard the fail-fast path.
 */
export class Wave0SeedDriftError extends Error {
  public readonly kind = "wave0-seed-drift" as const;
  constructor(message: string) {
    super(message);
    this.name = "Wave0SeedDriftError";
    // v4 fix: ES5 __extends emit breaks the prototype chain. Restore it.
    Object.setPrototypeOf(this, Wave0SeedDriftError.prototype);
  }
}

/** Type guard for Wave0SeedDriftError that works even under ES5 downlevel.
 *  Uses the nominal `kind` marker as the primary discriminator and falls back
 *  to `instanceof` for the modern-emit path. */
export function isWave0SeedDriftError(e: unknown): e is Wave0SeedDriftError {
  if (e instanceof Wave0SeedDriftError) return true;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "wave0-seed-drift"
  );
}

/* Wave 0 0-1 part 1 — mirrors migrations/0121_wave0_currency_ref.sql byte-for-byte in
 * intent. Ships the currency_ref immutable reference table + ISO 4217 fiat seed
 * (167 codes; metals + fund codes excluded per Wave 0 Increment 1 review).
 * Exponents match server/lib/currency.ts CURRENCY_EXPONENT_OVERRIDES exactly and
 * follow ISO 4217 canonical values (HUF=2, TWD=2, CLF=4, UYW=4).
 * No admin surface for exponents; is_active is reserved for Wave J governance.
 * NEVER touches Airwallex/payments or the cap-table ledger. */
export function applyWave0CurrencyRefSchema(db: any) {
  // Zero-decimal (17) currencies per ISO 4217 (HUF and TWD are 2-decimal per ISO;
  // Wave 0 Increment 1 review corrected the pre-existing divergence).
  const ZERO_DECIMAL = new Set([
    'BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF',
    'UGX','UYI','VND','VUV','XAF','XOF','XPF',
  ]);
  // Three-decimal (7) currencies per ISO 4217. CLF moved to 4-decimal set below.
  const THREE_DECIMAL = new Set([
    'BHD','IQD','JOD','KWD','LYD','OMR','TND',
  ]);
  // Four-decimal (2) currencies per ISO 4217.
  const FOUR_DECIMAL = new Set([
    'CLF','UYW',
  ]);
  // ISO 4217 active alphabetic fiat codes as of 2026-08-01. 167 codes total.
  // Metals (XAG, XAU, XPD, XPT), bond-market units (XBA-XBD), IMF SDR (XDR),
  // African accounting unit (XUA), SUCRE (XSU), test code (XTS), and no-currency
  // marker (XXX) are excluded: ISO 4217 defines no minor unit for them, and
  // none are settlement currencies for this platform. Named exclusion, not a
  // silent drop — documented in the mirror migration's header.
  const ISO_4217: string[] = [
    'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
    'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BOV',
    'BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF',
    'CHW','CLF','CLP','CNY','COP','COU','CRC','CUC','CUP','CVE',
    'CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD',
    'FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD',
    'HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD',
    'JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD',
    'KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA',
    'MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV',
    'MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB',
    'PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB',
    'RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS',
    'SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND',
    'TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','USN','UYI',
    'UYU','UYW','UZS','VED','VES','VND','VUV','WST',
    'XAF','XCD','XCG','XOF','XPF',
    'YER','ZAR','ZMW','ZWG',
  ];

  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS currency_ref (
       code                TEXT PRIMARY KEY NOT NULL
                             CHECK (length(code) = 3 AND code = upper(code)),
       minor_unit_exponent INTEGER NOT NULL CHECK (minor_unit_exponent IN (0, 2, 3, 4)),
       is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
     ) STRICT`,
    // V7 §5.0: code + exponent are immutable facts; is_active is the only mutable column.
    // A redenomination is a NEW code + fx_rate_snapshot, never an edited exponent.
    `CREATE TRIGGER IF NOT EXISTS trg_currency_ref_immutable BEFORE UPDATE ON currency_ref
     WHEN NEW.minor_unit_exponent <> OLD.minor_unit_exponent OR NEW.code <> OLD.code
     BEGIN SELECT RAISE(ABORT, 'CURRENCY_REF_IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_currency_ref_no_delete BEFORE DELETE ON currency_ref
     BEGIN SELECT RAISE(ABORT, 'CURRENCY_REF_NO_DELETE'); END`,
  ];

  // Wave 0 Increment 1 v3 review — Opus fail-fast fix.
  //
  // The DDL + seed transaction MUST NOT throw for drift, because DDL is
  // transactional in SQLite: a throw here would roll back the CREATE TABLEs
  // and the caller could then see "drift error" downgraded to a warning while
  // the schema disappears. We commit DDL first, then read back OUTSIDE the tx
  // and raise a distinguished Wave0SeedDriftError that the call site re-throws.
  const expOf = (code: string): number =>
    ZERO_DECIMAL.has(code) ? 0
    : FOUR_DECIMAL.has(code) ? 4
    : THREE_DECIMAL.has(code) ? 3
    : 2;

  const tx = db.transaction(() => {
    for (const sql of ddl) db.exec(sql);
    const seed = db.prepare(
      `INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active)
         VALUES (?, ?, 1)`,
    );
    for (const code of ISO_4217) seed.run(code, expOf(code));
  });
  tx();

  // Read-back drift detection (post-tx). If a pre-existing row disagrees with
  // the pinned canonical exponent, throw so the call site can fail boot.
  // Runs after the DDL transaction has committed, so a drift error preserves
  // the schema for post-mortem inspection rather than rolling it away.
  const check = db.prepare(
    `SELECT minor_unit_exponent AS e FROM currency_ref WHERE code = ?`,
  );
  const drift: string[] = [];
  for (const code of ISO_4217) {
    const expected = expOf(code);
    const row = check.get(code) as { e: number } | undefined;
    if (!row) { drift.push(`${code}: missing after seed`); continue; }
    if (row.e !== expected) drift.push(`${code}: exponent ${row.e} ≠ expected ${expected}`);
  }
  if (drift.length > 0) {
    throw new Wave0SeedDriftError(
      `currency_ref seed drift detected: ${drift.join('; ')}`,
    );
  }
}

/* Wave 0 0-1 part 2 — mirrors migrations/0122_wave0_money_core.sql. Ships
 * allocation_rule (ADR-5 rule 5 versioned allocator config) and fx_rate_snapshot
 * (ADR-5 rule 4 exact-rational rate) with no-update / no-delete triggers per V7
 * §5.0 round-5 blocker 5. Depends on currency_ref (0121). NEVER touches
 * Airwallex/payments or the cap-table ledger. */
export function applyWave0MoneyCoreSchema(db: any) {
  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS allocation_rule (
       rule_id             TEXT NOT NULL,
       rule_version        INTEGER NOT NULL CHECK (rule_version > 0),
       method              TEXT NOT NULL CHECK (method IN ('largest_remainder_stable')),
       tie_break           TEXT NOT NULL
                             CHECK (tie_break = 'remainder_desc_index_asc'),
       created_at          TEXT NOT NULL
                             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       PRIMARY KEY (rule_id, rule_version)
     ) STRICT`,
    // Wave 0 Increment 1 review item 1: allocation_rule is immutable. A rule
    // "change" is a new (rule_id, rule_version+1) row, never an edit.
    `CREATE TRIGGER IF NOT EXISTS trg_allocation_rule_no_update
       BEFORE UPDATE ON allocation_rule
       BEGIN SELECT RAISE(ABORT, 'ALLOCATION_RULE_IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_allocation_rule_no_delete
       BEFORE DELETE ON allocation_rule
       BEGIN SELECT RAISE(ABORT, 'ALLOCATION_RULE_IMMUTABLE'); END`,
    `CREATE TABLE IF NOT EXISTS fx_rate_snapshot (
       fx_id               TEXT PRIMARY KEY NOT NULL,
       from_currency       TEXT NOT NULL REFERENCES currency_ref(code),
       to_currency         TEXT NOT NULL REFERENCES currency_ref(code),
       rate_numerator      INTEGER NOT NULL CHECK (rate_numerator > 0),
       rate_denominator    INTEGER NOT NULL CHECK (rate_denominator > 0),
       as_of_date          TEXT NOT NULL
           CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                  AND date(as_of_date) = as_of_date),
       source              TEXT NOT NULL,
       created_at          TEXT NOT NULL
                             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       UNIQUE (from_currency, to_currency, as_of_date, source)
     ) STRICT`,
    `CREATE TRIGGER IF NOT EXISTS trg_fx_no_update BEFORE UPDATE ON fx_rate_snapshot
     BEGIN SELECT RAISE(ABORT, 'FX_SNAPSHOT_IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_fx_no_delete BEFORE DELETE ON fx_rate_snapshot
     BEGIN SELECT RAISE(ABORT, 'FX_SNAPSHOT_IMMUTABLE'); END`,
  ];
  const tx = db.transaction(() => {
    for (const sql of ddl) db.exec(sql);
  });
  tx();
}

/* Wave 0 0-14 — mirrors migrations/0123_wave0_platform_config.sql. Ships
 * platform_config + platform_config_history (append-only, hash-chained) with 6
 * genesis rows in BOTH tables (Gemini v2 blocker 3 correction). Hash values are
 * deterministic literals matching the SQL. Preimage formula (Increment 1 v2
 * review item 8, canonical JSON):
 *   sha256hex(JSON.stringify({v: version, key, vt: value_type, val: value_json,
 *                             prev: prev_revision_hash}))
 * See wave0/regen_0123.mjs for the derivation. Tests in wave0_new_guards.test.ts
 * recompute and assert.
 * NEVER touches Airwallex/payments or the cap-table ledger. */
export function applyWave0PlatformConfigSchema(db: any) {
  const GENESIS_PREV =
    '0000000000000000000000000000000000000000000000000000000000000000';
  // Genesis hashes match migrations/0123_wave0_platform_config.sql exactly.
  // Formula (Wave 0 Increment 1 review item 8):
  //   sha256hex(JSON.stringify({v: 1, key, vt: value_type, val: value_json,
  //                             prev: '0'*64}))
  // See wave0/regen_0123.mjs for the derivation. Test
  // wave0_new_guards.test.ts recomputes every literal from the formula and
  // asserts equality against both the DB and the shipped .sql text.
  const seedRows = [
    { key: 'quota.default_period', value_json: '"monthly"', value_type: 'string',
      description: 'Default quota period for partner tier plans. Editable in Wave F (F-QP1).',
      hash: 'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
      history_id: 'pch_gen_quota_default_period' },
    { key: 'billing_cycle.default', value_json: '"annual"', value_type: 'string',
      description: 'Default billing cycle for new partners. Owner decision 5.',
      hash: 'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
      history_id: 'pch_gen_billing_cycle_default' },
    { key: 'feeds.provider.default', value_json: '"none"', value_type: 'string',
      description: 'Default market-data feeds provider. Wave F admin surface configures per-tenant.',
      hash: '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
      history_id: 'pch_gen_feeds_provider_default' },
    { key: 'collective.partner_membership.review_window_days', value_json: '30', value_type: 'number',
      description: 'Days admin has to review annual Collective-membership renewal. Owner decision 7.',
      hash: 'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
      history_id: 'pch_gen_review_window' },
    { key: 'collective.partner_membership.grace_days_after_expiry', value_json: '0', value_type: 'number',
      description: 'Grace days after Collective membership expiry before access is revoked. Owner decision 7.',
      hash: 'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
      history_id: 'pch_gen_grace_days' },
    { key: 'kyc.capital_call.gate_mode', value_json: '"warn"', value_type: 'string',
      description: 'KYC gate behavior on capital calls: warn|block. Owner decision 9 (soft warn everywhere).',
      hash: '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
      history_id: 'pch_gen_kyc_gate_mode' },
  ];
  const T0 = '2026-08-01T00:00:00Z';
  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS platform_config (
       key                 TEXT PRIMARY KEY NOT NULL,
       value_json          TEXT NOT NULL
                             CHECK (json_valid(value_json)),
       value_type          TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
       description         TEXT,
       is_secret           INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
       version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
       prev_revision_hash  TEXT NOT NULL,
       revision_hash       TEXT NOT NULL,
       created_at          TEXT NOT NULL
                             CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       updated_at          TEXT NOT NULL
                             CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       created_by          TEXT,
       updated_by          TEXT,
       CHECK (
         (value_type = 'string'  AND json_type(value_json) = 'text')    OR
         (value_type = 'number'  AND json_type(value_json) IN ('integer','real')) OR
         (value_type = 'boolean' AND json_type(value_json) IN ('true','false'))   OR
         (value_type = 'json')
       )
     ) STRICT`,
    `CREATE INDEX IF NOT EXISTS idx_platform_config_updated_at ON platform_config(updated_at)`,
    `CREATE TABLE IF NOT EXISTS platform_config_history (
       history_id          TEXT PRIMARY KEY NOT NULL,
       config_key          TEXT NOT NULL,
       version             INTEGER NOT NULL CHECK (version > 0),
       snapshot_json       TEXT NOT NULL
                             CHECK (json_valid(snapshot_json)),
       prev_revision_hash  TEXT NOT NULL,
       revision_hash       TEXT NOT NULL,
       changed_at          TEXT NOT NULL
                             CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       changed_by          TEXT,
       change_kind         TEXT NOT NULL CHECK (change_kind IN ('genesis','update','revert')),
       UNIQUE (config_key, version)
     ) STRICT`,
    `CREATE INDEX IF NOT EXISTS idx_pch_key_version ON platform_config_history(config_key, version)`,
    `CREATE INDEX IF NOT EXISTS idx_pch_changed_at ON platform_config_history(changed_at)`,
    // Wave 0 Increment 1 review item 4: history is DB-enforced append-only.
    `CREATE TRIGGER IF NOT EXISTS trg_pch_no_update
       BEFORE UPDATE ON platform_config_history
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_pch_no_delete
       BEFORE DELETE ON platform_config_history
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_IMMUTABLE'); END`,
    // Wave 0 Increment 1 v3+v4+v5 review — chain-guard triggers on current state
    // + audit-content integrity + history-side integrity. See 0123 header.
    `CREATE TRIGGER IF NOT EXISTS trg_pc_chain_guard
       BEFORE UPDATE ON platform_config
       WHEN NEW.version <> OLD.version + 1
         OR NEW.prev_revision_hash <> OLD.revision_hash
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_CHAIN_BREAK'); END`,
    // v5 fix (GPT-5 v4 B1 + Opus v4 C2): match history CONTENT not just existence.
    // v7 note (Opus v5 C6): snapshot_json.val is DOUBLY-encoded JSON of value_json
    //   (e.g. value_json='30' → snapshot.val="30"). json_extract returns TEXT;
    //   this predicate compares TEXT to NEW.value_json (also TEXT). Wave F
    //   writers MUST JSON.stringify the inner value_json when constructing the
    //   snapshot. See 0123 header for full convention.
    `CREATE TRIGGER IF NOT EXISTS trg_pc_atomic_audit
       BEFORE UPDATE ON platform_config
       WHEN NOT EXISTS (
         SELECT 1 FROM platform_config_history
         WHERE config_key = NEW.key
           AND version = NEW.version
           AND revision_hash = NEW.revision_hash
           AND prev_revision_hash = NEW.prev_revision_hash
           AND json_extract(snapshot_json, '$.val') = NEW.value_json
           AND json_extract(snapshot_json, '$.vt')  = NEW.value_type
           AND json_extract(snapshot_json, '$.key') = NEW.key
           AND json_extract(snapshot_json, '$.v')   = NEW.version
       )
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_UNAUDITED_UPDATE'); END`,
    // v5 fix (GPT-5 v4 B2) + v6 fix (all 3 v5 reviewers): no direct INSERT
    // without matching genesis history — AND the history row's content must
    // match the inserted current row (prev_hash + snapshot val/vt/key/v).
    // Predicate is now symmetric with trg_pc_atomic_audit's UPDATE contract.
    // v7 note (Opus v6 N3): the prev_hash property is transitive — the WHEN
    //   clause requires NEW.prev_revision_hash to equal the matched genesis
    //   history row's prev, and trg_pch_chain_integrity forces genesis rows'
    //   prev to be 64 zeros, so on any tables where the triggers were live at
    //   history-write time NEW.prev_revision_hash MUST be 64 zeros. On legacy
    //   tables predating the triggers this holds only via the matched row.
    // v7 note (Opus v5 C6): same doubly-encoded snapshot_json.val convention
    //   as trg_pc_atomic_audit — see 0123 header.
    `CREATE TRIGGER IF NOT EXISTS trg_pc_no_direct_insert
       BEFORE INSERT ON platform_config
       WHEN NOT EXISTS (
         SELECT 1 FROM platform_config_history
         WHERE config_key = NEW.key
           AND version = NEW.version
           AND revision_hash = NEW.revision_hash
           AND prev_revision_hash = NEW.prev_revision_hash
           AND change_kind = 'genesis'
           AND json_extract(snapshot_json, '$.val') = NEW.value_json
           AND json_extract(snapshot_json, '$.vt')  = NEW.value_type
           AND json_extract(snapshot_json, '$.key') = NEW.key
           AND json_extract(snapshot_json, '$.v')   = NEW.version
       )
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_UNAUDITED_INSERT'); END`,
    // v6 fix (GPT-5 v5): platform_config.key immutable on UPDATE.
    // Chain-guard checks version + prev_hash link on UPDATE, but did not
    // require NEW.key = OLD.key. Combined with fabricated equal hashes
    // across chains, a caller could rename the row into a different chain.
    // Key is part of the audit identity; renaming is a new key (which must
    // go through the genesis path) not an update to an existing key.
    `CREATE TRIGGER IF NOT EXISTS trg_pc_no_key_change
       BEFORE UPDATE ON platform_config
       WHEN NEW.key <> OLD.key
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_KEY_IMMUTABLE'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_pc_no_delete
       BEFORE DELETE ON platform_config
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_NO_DELETE'); END`,
    // v5 fix (GPT-5 v4 B3): history-side integrity.
    `CREATE TRIGGER IF NOT EXISTS trg_pch_chain_integrity
       BEFORE INSERT ON platform_config_history
       WHEN
         (NEW.change_kind = 'genesis' AND (
            NEW.version <> 1
            OR NEW.prev_revision_hash <> '0000000000000000000000000000000000000000000000000000000000000000'
         ))
         OR
         (NEW.change_kind <> 'genesis' AND NOT EXISTS (
            SELECT 1 FROM platform_config_history h
            WHERE h.config_key = NEW.config_key
              AND h.version = NEW.version - 1
              AND h.revision_hash = NEW.prev_revision_hash
         ))
       BEGIN SELECT RAISE(ABORT, 'PLATFORM_CONFIG_HISTORY_CHAIN_BREAK'); END`,
  ];
  // Wave 0 Increment 1 v3 review — Opus fail-fast fix.
  // DDL + seed inside the transaction; drift verification OUTSIDE so a drift
  // error does not roll away the schema it was meant to protect.
  const tx = db.transaction(() => {
    for (const sql of ddl) db.exec(sql);
    // v5 order change (GPT-5 v4 B2 fix): history rows FIRST, then current-state.
    // trg_pc_no_direct_insert requires a matching genesis history row before
    // the current INSERT is allowed. This mirrors what Wave F's write path
    // must do (audit-first).
    const seedHistory = db.prepare(
      `INSERT OR IGNORE INTO platform_config_history
         (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'system:wave0_seed', 'genesis')`,
    );
    const seedCurrent = db.prepare(
      `INSERT OR IGNORE INTO platform_config
         (key, value_json, value_type, description, is_secret, version, prev_revision_hash, revision_hash, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, 'system:wave0_seed', 'system:wave0_seed')`,
    );
    for (const r of seedRows) {
      // Snapshot_json uses canonical JSON of {v, key, vt, val}. MUST match
      // migrations/0123_wave0_platform_config.sql exactly — the hash chain
      // depends on this being byte-identical.
      const snapshot = JSON.stringify({ v: 1, key: r.key, vt: r.value_type, val: r.value_json });
      seedHistory.run(r.history_id, r.key, snapshot, GENESIS_PREV, r.hash, T0);
    }
    for (const r of seedRows) {
      seedCurrent.run(r.key, r.value_json, r.value_type, r.description, GENESIS_PREV, r.hash, T0, T0);
    }
  });
  // v6 fix (Opus v5 B2): a pre-existing divergent history genesis row causes
  // INSERT OR IGNORE to swallow the conflict, then trg_pc_no_direct_insert or
  // trg_pch_chain_integrity aborts the subsequent INSERT with SQLITE_CONSTRAINT_TRIGGER.
  // That is NOT a stray DDL error — it is genuine seed drift and must abort boot,
  // not warn-and-continue. Convert the trigger-abort SqliteError into a
  // Wave0SeedDriftError so runWave0Apply re-throws it (fail-loud) instead of
  // downgrading to log.warn.
  try {
    tx();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const code = String(e?.code ?? '');
    const isTriggerAbort =
      code === 'SQLITE_CONSTRAINT_TRIGGER' ||
      /PLATFORM_CONFIG_UNAUDITED_INSERT|PLATFORM_CONFIG_HISTORY_CHAIN_BREAK|PLATFORM_CONFIG_UNAUDITED_UPDATE|PLATFORM_CONFIG_CHAIN_BREAK|PLATFORM_CONFIG_HISTORY_IMMUTABLE|PLATFORM_CONFIG_NO_DELETE|PLATFORM_CONFIG_KEY_IMMUTABLE/.test(msg);
    if (isTriggerAbort) {
      throw new Wave0SeedDriftError(
        `platform_config seed aborted by integrity trigger (likely a pre-existing divergent row): ${msg}`,
      );
    }
    throw e;
  }

  // v6 fix (Opus v5 B1): read-back drift detection is a hybrid check.
  //
  // The GENESIS history row is deterministic forever — it is append-only,
  // trigger-immutable, and never rewritten. We assert all 8 of its fields
  // unconditionally.
  //
  // The CURRENT-state row is deterministic ONLY while version = 1. Wave F's
  // whole purpose is to legitimately advance seeded config values via audited
  // updates, which move version to 2, 3, ... . The prior v5 check treated
  // version > 1 as drift and aborted boot, which would brick the platform on
  // the first Wave F edit and had no in-schema recovery path (chain-guard
  // makes version strictly monotone; no_delete blocks removal). So for the
  // current row we split assertions into two groups:
  //   - always-invariant fields: created_at, created_by (never change after seed)
  //   - version=1 only fields:   value_json, value_type, description,
  //                              is_secret, prev_revision_hash, revision_hash,
  //                              updated_at, updated_by (all replaced on audited
  //                              update). We still verify the pinned genesis
  //                              hash by requiring a genesis history row with
  //                              (config_key, version=1, prev=zeros, hash=pin).
  const readCur = db.prepare(
    `SELECT value_json, value_type, description, is_secret, version,
            prev_revision_hash, revision_hash, created_at, updated_at,
            created_by, updated_by
     FROM platform_config WHERE key = ?`,
  );
  const readHist = db.prepare(
    `SELECT config_key, version, snapshot_json, prev_revision_hash, revision_hash,
            changed_at, changed_by, change_kind
     FROM platform_config_history WHERE history_id = ?`,
  );
  const drift: string[] = [];
  for (const r of seedRows) {
    const expectedSnapshot = JSON.stringify({ v: 1, key: r.key, vt: r.value_type, val: r.value_json });
    const cur = readCur.get(r.key) as any;
    if (!cur) { drift.push(`platform_config: ${r.key} missing after seed`); continue; }
    // Always-invariant fields (survive any legitimate audited update):
    if (cur.created_at !== T0) drift.push(`platform_config[${r.key}]: created_at drift`);
    if (cur.created_by !== 'system:wave0_seed') drift.push(`platform_config[${r.key}]: created_by drift`);
    // Version=1-only fields (Wave F updates legitimately change these):
    if (cur.version === 1) {
      if (cur.value_json !== r.value_json) drift.push(`platform_config[${r.key}]: value_json drift`);
      if (cur.value_type !== r.value_type) drift.push(`platform_config[${r.key}]: value_type drift`);
      if (cur.description !== r.description) drift.push(`platform_config[${r.key}]: description drift`);
      if (cur.is_secret !== 0) drift.push(`platform_config[${r.key}]: is_secret drift`);
      if (cur.prev_revision_hash !== GENESIS_PREV) drift.push(`platform_config[${r.key}]: prev_revision_hash drift`);
      if (cur.revision_hash !== r.hash) drift.push(`platform_config[${r.key}]: revision_hash drift`);
      if (cur.updated_at !== T0) drift.push(`platform_config[${r.key}]: updated_at drift`);
      if (cur.updated_by !== 'system:wave0_seed') drift.push(`platform_config[${r.key}]: updated_by drift`);
    } else {
      // v7 fix (Opus v6 C1): when the current row is at version > 1 we can no
      // longer assert seed values, but we CAN assert that the current row's
      // (version, revision_hash, prev_revision_hash) tuple corresponds to an
      // actual history row for this key. Without this check, a legacy DB whose
      // current row was written before the audit triggers existed (e.g. a
      // tampered v2 row with a bogus revision_hash and no v2 history) would
      // boot cleanly on this branch. The triggers cannot catch this because the
      // row already exists; the drift check is the only place that can.
      const linked = db.prepare(
        `SELECT 1 FROM platform_config_history
         WHERE config_key = ? AND version = ? AND revision_hash = ?
           AND prev_revision_hash = ?`,
      ).get(r.key, cur.version, cur.revision_hash, cur.prev_revision_hash);
      if (!linked) {
        drift.push(`platform_config[${r.key}]: version ${cur.version} row not linked to any history row (tampered or partially-migrated)`);
      }
    }

    // GENESIS history row is invariant forever (append-only + trigger-immutable):
    const hist = readHist.get(r.history_id) as any;
    if (!hist) { drift.push(`platform_config_history: ${r.history_id} missing after seed`); continue; }
    if (hist.config_key !== r.key) drift.push(`history[${r.history_id}]: config_key drift`);
    if (hist.version !== 1) drift.push(`history[${r.history_id}]: version drift`);
    if (hist.snapshot_json !== expectedSnapshot) drift.push(`history[${r.history_id}]: snapshot_json drift`);
    if (hist.prev_revision_hash !== GENESIS_PREV) drift.push(`history[${r.history_id}]: prev_revision_hash drift`);
    if (hist.revision_hash !== r.hash) drift.push(`history[${r.history_id}]: revision_hash drift`);
    if (hist.changed_at !== T0) drift.push(`history[${r.history_id}]: changed_at drift`);
    if (hist.changed_by !== 'system:wave0_seed') drift.push(`history[${r.history_id}]: changed_by drift`);
    if (hist.change_kind !== 'genesis') drift.push(`history[${r.history_id}]: change_kind drift`);
  }
  if (drift.length > 0) {
    throw new Wave0SeedDriftError(
      `platform_config seed drift detected: ${drift.join('; ')}`,
    );
  }
}

/* Wave C v26.5.0 (0127) — mirrors migrations/0127_wave_c_fd_pre_money_shares.sql.
 * SQLite ADD COLUMN has no IF NOT EXISTS, so we swallow the duplicate-column error.
 * Any non-idempotent error is rethrown (matches house pattern). Nullable column,
 * safe on existing rows — they'll read as NULL until re-saved with an FD count. */
function applyWaveCFdPreMoneySharesSchema(db: any) {
  try {
    // PRAGMA guard first — cheaper than an ALTER attempt and lets us skip if
    // the column already exists.
    const cols = db.prepare("PRAGMA table_info(rounds)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "fd_pre_money_shares")) return;
    db.exec("ALTER TABLE rounds ADD COLUMN fd_pre_money_shares INTEGER");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Idempotent: duplicate column tolerated (race with runner); missing table
    // is a fresh-DB corner case, also tolerated.
    if (!/duplicate column name|no such table/i.test(msg)) {
      throw e;
    }
  }
}

/* v26.2.0 W2 A3/A4 — mirrors migrations/0110_collective_membership_captable_exempt.sql.
 * SQLite ADD COLUMN has no IF NOT EXISTS, so we swallow the duplicate-column error. */
function applyW2CapTableExemptSchema(db: any) {
  try {
    db.exec(
      "ALTER TABLE collective_memberships ADD COLUMN cap_table_exempt INTEGER NOT NULL DEFAULT 0",
    );
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Idempotent: already present (self-heal re-run / fresh CREATE already has it).
    if (!/duplicate column name|no such table/i.test(msg)) {
      throw e;
    }
  }
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_collective_memberships_cap_table_exempt ON collective_memberships(cap_table_exempt)",
    );
  } catch { /* index create is best-effort; table may not exist yet on a bare DB */ }
}

/* v26.2.0 W1 H6 — see call-site comment above. Boot-safe + idempotent.
 * Mirrors migrations/0109_collective_membership_deactivation_queue.sql in shape. */
function applyH6MembershipDeactivationQueueSchema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS collective_membership_deactivation_queue (
       id TEXT PRIMARY KEY,
       billing_id TEXT,
       user_id TEXT NOT NULL,
       target_status TEXT NOT NULL CHECK (target_status IN ('cancelled', 'past_due')),
       source TEXT NOT NULL,
       reason TEXT,
       attempts INTEGER NOT NULL DEFAULT 0,
       next_attempt_at TEXT NOT NULL,
       last_error TEXT,
       resolved_at TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_collective_deactivation_open_user_status
       ON collective_membership_deactivation_queue(user_id, target_status)
       WHERE resolved_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_collective_deactivation_next
       ON collective_membership_deactivation_queue(resolved_at, next_attempt_at);`,
    `CREATE INDEX IF NOT EXISTS idx_collective_deactivation_user
       ON collective_membership_deactivation_queue(user_id, resolved_at);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of stmts) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v26.2.0 W1 H6 membership deactivation queue bootstrap failed (continuing):", (err as Error).message);
  }
}

/* v26.1.x ENH-1 — see call-site comment above. Boot-safe + idempotent.
 * Mirrors migrations/0107_enh1_your_decision_durable.sql VERBATIM in shape. */
function applyEnh1YourDecisionDurableSchema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS your_decision_records (
       invitation_id    TEXT PRIMARY KEY NOT NULL,
       round_id         TEXT NOT NULL,
       company_id       TEXT NOT NULL DEFAULT '',
       state            TEXT NOT NULL,
       amount           REAL,
       currency         TEXT,
       soft_circle_type TEXT,
       viewed_at        TEXT,
       note             TEXT,
       history_json     TEXT NOT NULL DEFAULT '[]',
       mim_json         TEXT NOT NULL DEFAULT '[]',
       actor            TEXT,
       created_at       TEXT NOT NULL,
       updated_at       TEXT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS idx_your_decision_records_round
       ON your_decision_records (round_id);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of stmts) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v26.1.x ENH-1 your_decision_records bootstrap failed (continuing):", (err as Error).message);
  }
}

/* v26.1.x 1c — see call-site comment above. Boot-safe + idempotent.
 * Mirrors migrations/0108_1c_spv_launch_signoffs.sql VERBATIM in shape. */
function applyC1cSpvLaunchSignoffSchema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS spv_launch_signoffs (
       id                  TEXT PRIMARY KEY NOT NULL,
       partner_id          TEXT NOT NULL,
       spv_id              TEXT NOT NULL DEFAULT '',
       user_id             TEXT NOT NULL,
       signer_legal_name   TEXT NOT NULL,
       signer_sub_role     TEXT,
       attestation_text    TEXT NOT NULL,
       attestation_version TEXT NOT NULL DEFAULT 'v1',
       signed_at           TEXT NOT NULL,
       ip                  TEXT,
       user_agent          TEXT,
       created_at          TEXT NOT NULL
     );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_launch_signoffs_partner
       ON spv_launch_signoffs (partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_launch_signoffs_spv
       ON spv_launch_signoffs (spv_id);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of stmts) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v26.1.x 1c spv_launch_signoffs bootstrap failed (continuing):", (err as Error).message);
  }
}

/* v25.53 REVISE B3 — see call-site comment above. Boot-safe + idempotent. */
function applyV2553RoundInviteUniqueIndex(db: any) {
  const sql =
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_round_invite_active_email " +
    "ON round_invitations (round_id, lower(trim(investor_email))) " +
    "WHERE state IN ('pending','sent','viewed','accepted') " +
    "AND deleted_at IS NULL " +
    "AND investor_email IS NOT NULL " +
    "AND trim(investor_email) <> ''";
  try {
    db.exec(sql);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (!/already exists/i.test(msg)) {
      log.warn("[db] v25.53 round-invite unique index not created (continuing):", msg);
    }
  }
}

/* v25.48 — see call-site comment above. Idempotent + boot-safe.
 *
 * Tables (additive, all NEW):
 *   - subscription_docs_sent   (B3: per-round/per-investor "sub-docs sent" flag)
 *   - investor_wired_signals   (B4: optional investor "I wired" advisory signal)
 *   - commit_attestations      (B5: founder attestation at commit — parallel to
 *                               the Sacred captable ledger, fail-closed)
 *   - email_templates          (DATA-1: DB-backed, admin-editable email templates)
 * Seeds: email_templates seeded from the canonical starter set on first boot
 * (INSERT OR IGNORE by slug — existing rows are never clobbered). No cap-table
 * math or ledger rows are touched. */
function applyV2548Schema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS subscription_docs_sent (
       id            TEXT PRIMARY KEY NOT NULL,
       round_id      TEXT NOT NULL,
       investor_id   TEXT NOT NULL,
       company_id    TEXT,
       sent_at       TEXT NOT NULL,
       sent_by_user_id TEXT,
       note          TEXT,
       UNIQUE (round_id, investor_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_sub_docs_sent_round ON subscription_docs_sent (round_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sub_docs_sent_investor ON subscription_docs_sent (investor_id)`,
    `CREATE TABLE IF NOT EXISTS investor_wired_signals (
       id            TEXT PRIMARY KEY NOT NULL,
       round_id      TEXT NOT NULL,
       investor_id   TEXT NOT NULL,
       company_id    TEXT,
       wired_at      TEXT NOT NULL,
       amount_hint   TEXT,
       currency      TEXT,
       note          TEXT,
       UNIQUE (round_id, investor_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_investor_wired_round ON investor_wired_signals (round_id)`,
    `CREATE INDEX IF NOT EXISTS idx_investor_wired_investor ON investor_wired_signals (investor_id)`,
    `CREATE TABLE IF NOT EXISTS commit_attestations (
       id              TEXT PRIMARY KEY NOT NULL,
       invitation_id   TEXT NOT NULL,
       round_id        TEXT,
       company_id      TEXT,
       investor_id     TEXT,
       attestor_user_id TEXT NOT NULL,
       attested_at     TEXT NOT NULL,
       amount          TEXT,
       currency        TEXT,
       statement       TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_commit_attest_invitation ON commit_attestations (invitation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_commit_attest_company ON commit_attestations (company_id)`,
    `CREATE TABLE IF NOT EXISTS email_templates (
       slug            TEXT PRIMARY KEY NOT NULL,
       id              TEXT,
       subject         TEXT NOT NULL,
       body_html       TEXT NOT NULL,
       body_text       TEXT NOT NULL,
       variables_json  TEXT,
       category        TEXT,
       updated_at      TEXT NOT NULL,
       updated_by      TEXT
     )`,
  ];
  const tx = db.transaction(() => {
    for (const sql of stmts) db.exec(sql);
    // DATA-1 — seed the canonical email templates on first boot. INSERT OR
    // IGNORE by slug so admin edits (persisted rows) are never clobbered.
    try {
      // Lazy static import avoided (ESM/tsx): read the canonical starter set
      // from the seed helper exported by emailStore. Kept import-free here by
      // seeding the minimal known slugs is NOT sufficient — instead the
      // emailStore hydrate performs the authoritative DB-first seed. We only
      // ensure the table exists here; row seeding happens in hydrateEmailStore
      // (DB-first, restart-safe). No-op if already seeded.
    } catch { /* seed handled by hydrateEmailStore */ }
  });
  tx();
}

/* v25.47 — see call-site comment above. Idempotent + boot-safe.
 *
 * Tables (additive): audit_chain_health, collective_admin_settings,
 * spv_deployments, pulse_index_symbols, moderation_log. Additive columns:
 * network_posts.attachments, founder_crm_contacts.{invite_status,
 * invited_round_id,invited_at}. Seeds: collective member single tier
 * (standard=24900) + consortium 5-tier (catalyst/builder/amplifier/nexus/
 * founding_member), 10 pulse index symbols, one audit-chain incident row, and
 * the APD-028 canonical collective_application_fee ($300 = 30000 TRUE minor
 * units). Legacy collective.member_subscription.{basic,pro,enterprise} and
 * consortium.subscription.partner_{basic,pro,enterprise} rows are PRESERVED
 * (seeded above) — deprecated in code only, never destructively removed. */
function applyV2547Schema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS audit_chain_health (
       key         TEXT PRIMARY KEY NOT NULL,
       status      TEXT NOT NULL,
       detail      TEXT,
       updated_at  TEXT NOT NULL
     )`,
    // Wave A-1 v2.1 (ADR-3 action 3): chain_genesis re-base table. Mirrors
    // migrations/0124_wave_a1_audit_seed_repair.sql. Additive-idempotent.
    // STRICT + date shape CHECKs per Wave 0 0-D/0-E.
    // Columns: anchor_row_id = the LAST pre-genesis row; anchor_hash =
    // that row's hash. Walker starts at the row AFTER anchor_row_id
    // seeding `prior` with anchor_hash.
    `CREATE TABLE IF NOT EXISTS audit_chain_genesis (
       tenant_id      TEXT PRIMARY KEY NOT NULL,
       anchor_row_id  TEXT NOT NULL,
       anchor_hash    TEXT NOT NULL,
       effective_at   TEXT NOT NULL
                        CHECK (effective_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
       reason         TEXT NOT NULL,
       created_at     TEXT NOT NULL
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
     ) STRICT`,
    `CREATE TABLE IF NOT EXISTS collective_admin_settings (
       key         TEXT PRIMARY KEY NOT NULL,
       value_json  TEXT,
       updated_at  TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS spv_deployments (
       id                   TEXT PRIMARY KEY NOT NULL,
       spv_id               TEXT NOT NULL UNIQUE,
       fee_minor            INTEGER NOT NULL,
       currency             TEXT NOT NULL DEFAULT 'USD',
       recorded_at          TEXT NOT NULL,
       recorded_by_user_id  TEXT,
       note                 TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS pulse_index_symbols (
       symbol          TEXT PRIMARY KEY NOT NULL,
       label           TEXT,
       category        TEXT,
       enabled         INTEGER NOT NULL DEFAULT 1,
       refresh_seconds INTEGER NOT NULL DEFAULT 3600,
       sort_order      INTEGER NOT NULL DEFAULT 0,
       updated_at      TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS moderation_log (
       id          TEXT PRIMARY KEY NOT NULL,
       post_id     TEXT NOT NULL,
       action      TEXT NOT NULL,
       actor       TEXT,
       reason      TEXT,
       created_at  TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_moderation_log_post ON moderation_log (post_id)`,
  ];
  const tx = db.transaction(() => {
    for (const sql of stmts) db.exec(sql);

    // v25.47 canonical subscription rows (SEPARATE/PARALLEL — platform_fees only).
    const subSeed = db.prepare(
      `INSERT OR IGNORE INTO platform_fees
         (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES (?, ?, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed', 'monthly', NULL)`,
    );
    // Collective — single canonical member tier.
    subSeed.run('collective.member_subscription.standard', 24900);
    // Consortium Partners — canonical 5-tier taxonomy.
    subSeed.run('consortium.subscription.catalyst', 49900);
    subSeed.run('consortium.subscription.builder', 99900);
    subSeed.run('consortium.subscription.amplifier', 149900);
    subSeed.run('consortium.subscription.nexus', 499900);
    subSeed.run('consortium.subscription.founding_member', 0);

    // APD-028 — canonical collective application fee: $300 = 30000 TRUE minor
    // units. New rows seed at 30000; existing rows are never clobbered (IGNORE).
    db.prepare(
      `INSERT OR IGNORE INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
         VALUES ('collective_application_fee', 30000, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed')`,
    ).run();

    // 10 Pulse index symbols (DB-driven watchlist; no hardcoded list in code).
    const pulseSeed = db.prepare(
      `INSERT OR IGNORE INTO pulse_index_symbols
         (symbol, label, category, enabled, refresh_seconds, sort_order, updated_at)
         VALUES (?, ?, ?, 1, 3600, ?, '2026-06-30T00:00:00.000Z')`,
    );
    const pulse: Array<[string, string, string]> = [
      ['SPY', 'S&P 500 ETF', 'equity_index'],
      ['QQQ', 'Nasdaq 100 ETF', 'equity_index'],
      ['DIA', 'Dow Jones ETF', 'equity_index'],
      ['IWM', 'Russell 2000 ETF', 'equity_index'],
      ['XLK', 'Technology Sector', 'sector'],
      ['XLF', 'Financials Sector', 'sector'],
      ['BTC-USD', 'Bitcoin', 'crypto'],
      ['ETH-USD', 'Ethereum', 'crypto'],
      ['VIX', 'Volatility Index', 'volatility'],
      ['USD/EUR', 'US Dollar / Euro', 'fx'],
    ];
    pulse.forEach(([symbol, label, category], i) => pulseSeed.run(symbol, label, category, i));

    // Wave A-1 v2 (ADR-3 action 4): audit-chain health seed changed from
    // 'incident' to 'ok'. v25.47 seeded 'incident' unconditionally so every
    // fresh install and every :memory: boot came up P0 already-red. The
    // real incident is detected at boot by
    // `runAuditChainBootVerifier()` (server/lib/hydrateStores.ts:539);
    // that tick writes 'incident' back if any tenant's chain fails to
    // verify. Companion write: migration 0124_wave_a1_audit_seed_repair.sql
    // handles upgrade installs where 0070 already wrote 'incident'.
    db.prepare(
      `INSERT OR IGNORE INTO audit_chain_health (key, status, detail, updated_at)
         VALUES ('tenant_admin_capavate', 'ok',
                 'seeded ok; boot verifier tick will re-check (Wave A-1 v2 ADR-3 action 4)',
                 '2026-08-02T00:00:00.000Z')`,
    ).run();
  });
  tx();

  /* Wave B v26.4.0-fix2 — mirror of migrations/0125_wave_b_backups.sql.
   * Boot-time self-heal: idempotent full-row snapshot of the 9 legacy SPV
   * source tables into wave_b_backup_* tables. Only executes on the FIRST
   * boot after Wave B ships — subsequent boots see the `wave_b_backup_ddl_v1`
   * marker in `_migrations_applied` and skip the whole block.
   *
   * v26.4.0-fix2 (round-2 fixes):
   *   Opus DEFECT-9 / GPT-5.6 DEFECT-1 — SQLite requires `WHERE` before
   *     `ON CONFLICT` on `INSERT ... SELECT`. Fixed with `WHERE 1=1`.
   *   Opus DEFECT-11 — 6 spvs columns dropped by v26.4.0-fix1's explicit
   *     column list (deployment_fee_*, sourcing_partner_id). Restored
   *     here in the wave_b_backup_spvs DDL and column list.
   *   No BEGIN/COMMIT in the .sql file (Opus DEFECT-10) — the runner
   *     wraps every migration in db.transaction() already. This inline
   *     mirror already uses `db.transaction()`; no change needed here.
   *
   * v26.4.0-fix (prior BLOCKs, preserved):
   *   BLOCK-A — explicit PRIMARY KEY(id) on every backup table.
   *   BLOCK-F — pre-create the 4 kv_partner* sources with IF NOT EXISTS.
   *   BLOCK-G — portable SQL only (no `INSERT OR IGNORE`, no
   *     `datetime('now')`); the marker gate prevents re-execution.
   */
  const waveBAlreadyApplied = db
    .prepare("SELECT 1 AS one FROM _migrations_applied WHERE key = 'wave_b_backup_ddl_v1'")
    .get();
  if (!waveBAlreadyApplied) {
    const waveBBackupTx = db.transaction(() => {
      // 0. Ensure the 4 kv_partner* source tables exist (BLOCK-F).
      // Shape matches storePersistenceShim.ensureTable exactly.
      db.exec(`CREATE TABLE IF NOT EXISTS kv_partnerSpvs (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );`);
      db.exec(`CREATE TABLE IF NOT EXISTS kv_partnerFunds (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );`);
      db.exec(`CREATE TABLE IF NOT EXISTS kv_partnerSpvPositions (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );`);
      db.exec(`CREATE TABLE IF NOT EXISTS kv_partnerFundCommitments (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );`);

      // 1. Backup tables — explicit PRIMARY KEY(id) so ON CONFLICT works.
      // v26.4.0-fix2 (Opus DEFECT-11) — wave_b_backup_spvs carries all 26
      // canonical columns (20 from migration 0041 + 6 from 0054 fee/attribution).
      const backupDdl: Array<[string, string]> = [
        ["wave_b_backup_spvs", `CREATE TABLE IF NOT EXISTS wave_b_backup_spvs (
          id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, partner_id TEXT, name TEXT,
          lead_company_id TEXT, structure_type TEXT, status TEXT, target_minor INTEGER,
          committed_minor INTEGER, called_minor INTEGER, distributed_minor INTEGER,
          gp_user_id TEXT, formed_at TEXT, closes_at TEXT, terms TEXT,
          prev_hash TEXT, curr_hash TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
          deployment_fee_minor INTEGER, deployment_fee_currency TEXT, deployment_fee_payer TEXT,
          deployment_fee_paid_at TEXT, deployment_fee_schedule_id TEXT, sourcing_partner_id TEXT
        );`],
        ["wave_b_backup_spv_commitments", `CREATE TABLE IF NOT EXISTS wave_b_backup_spv_commitments (
          id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, spv_id TEXT, lp_user_id TEXT,
          amount_minor INTEGER, status TEXT, commitment_doc_url TEXT, signed_at TEXT,
          funded_at TEXT, prev_hash TEXT, curr_hash TEXT, created_at TEXT, updated_at TEXT
        );`],
        ["wave_b_backup_spv_capital_calls", `CREATE TABLE IF NOT EXISTS wave_b_backup_spv_capital_calls (
          id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, spv_id TEXT, sequence_no INTEGER,
          amount_minor INTEGER, called_at TEXT, due_at TEXT,
          prev_hash TEXT, curr_hash TEXT, created_at TEXT
        );`],
        ["wave_b_backup_spv_distributions", `CREATE TABLE IF NOT EXISTS wave_b_backup_spv_distributions (
          id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, spv_id TEXT, distribution_type TEXT,
          total_minor INTEGER, distributed_at TEXT,
          prev_hash TEXT, curr_hash TEXT, created_at TEXT
        );`],
        ["wave_b_backup_spv_positions", `CREATE TABLE IF NOT EXISTS wave_b_backup_spv_positions (
          id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT, spv_id TEXT, security_id TEXT,
          shares TEXT, basis_minor INTEGER, acquired_at TEXT, status TEXT,
          prev_hash TEXT, curr_hash TEXT, created_at TEXT, updated_at TEXT
        );`],
        ["wave_b_backup_kv_partnerSpvs", `CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerSpvs (
          id TEXT PRIMARY KEY NOT NULL, payload_json TEXT, updated_at TEXT, deleted_at TEXT
        );`],
        ["wave_b_backup_kv_partnerFunds", `CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerFunds (
          id TEXT PRIMARY KEY NOT NULL, payload_json TEXT, updated_at TEXT, deleted_at TEXT
        );`],
        ["wave_b_backup_kv_partnerSpvPositions", `CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerSpvPositions (
          id TEXT PRIMARY KEY NOT NULL, payload_json TEXT, updated_at TEXT, deleted_at TEXT
        );`],
        ["wave_b_backup_kv_partnerFundCommitments", `CREATE TABLE IF NOT EXISTS wave_b_backup_kv_partnerFundCommitments (
          id TEXT PRIMARY KEY NOT NULL, payload_json TEXT, updated_at TEXT, deleted_at TEXT
        );`],
      ];
      for (const [, ddl] of backupDdl) db.exec(ddl);

      // 2. Full-row snapshot with explicit column lists (column-drift-safe)
      // and portable ON CONFLICT DO NOTHING.
      // v26.4.0-fix2 (Opus DEFECT-9 / GPT-5.6 DEFECT-1): SQLite requires
      // `WHERE` before `ON CONFLICT` on `INSERT ... SELECT`. Using `WHERE 1=1`
      // (also portable to Postgres) unambiguously disambiguates.
      const copies: Array<[string, string]> = [
        ["wave_b_backup_spvs", `INSERT INTO wave_b_backup_spvs
          (id, tenant_id, partner_id, name, lead_company_id, structure_type, status,
           target_minor, committed_minor, called_minor, distributed_minor, gp_user_id,
           formed_at, closes_at, terms, prev_hash, curr_hash, created_at, updated_at, deleted_at,
           deployment_fee_minor, deployment_fee_currency, deployment_fee_payer,
           deployment_fee_paid_at, deployment_fee_schedule_id, sourcing_partner_id)
          SELECT id, tenant_id, partner_id, name, lead_company_id, structure_type, status,
                 target_minor, committed_minor, called_minor, distributed_minor, gp_user_id,
                 formed_at, closes_at, terms, prev_hash, curr_hash, created_at, updated_at, deleted_at,
                 deployment_fee_minor, deployment_fee_currency, deployment_fee_payer,
                 deployment_fee_paid_at, deployment_fee_schedule_id, sourcing_partner_id
          FROM spvs
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_spv_commitments", `INSERT INTO wave_b_backup_spv_commitments
          (id, tenant_id, spv_id, lp_user_id, amount_minor, status, commitment_doc_url,
           signed_at, funded_at, prev_hash, curr_hash, created_at, updated_at)
          SELECT id, tenant_id, spv_id, lp_user_id, amount_minor, status, commitment_doc_url,
                 signed_at, funded_at, prev_hash, curr_hash, created_at, updated_at
          FROM spv_commitments
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_spv_capital_calls", `INSERT INTO wave_b_backup_spv_capital_calls
          (id, tenant_id, spv_id, sequence_no, amount_minor, called_at, due_at,
           prev_hash, curr_hash, created_at)
          SELECT id, tenant_id, spv_id, sequence_no, amount_minor, called_at, due_at,
                 prev_hash, curr_hash, created_at
          FROM spv_capital_calls
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_spv_distributions", `INSERT INTO wave_b_backup_spv_distributions
          (id, tenant_id, spv_id, distribution_type, total_minor, distributed_at,
           prev_hash, curr_hash, created_at)
          SELECT id, tenant_id, spv_id, distribution_type, total_minor, distributed_at,
                 prev_hash, curr_hash, created_at
          FROM spv_distributions
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_spv_positions", `INSERT INTO wave_b_backup_spv_positions
          (id, tenant_id, spv_id, security_id, shares, basis_minor, acquired_at, status,
           prev_hash, curr_hash, created_at, updated_at)
          SELECT id, tenant_id, spv_id, security_id, shares, basis_minor, acquired_at, status,
                 prev_hash, curr_hash, created_at, updated_at
          FROM spv_positions
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_kv_partnerSpvs", `INSERT INTO wave_b_backup_kv_partnerSpvs
          (id, payload_json, updated_at, deleted_at)
          SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerSpvs
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_kv_partnerFunds", `INSERT INTO wave_b_backup_kv_partnerFunds
          (id, payload_json, updated_at, deleted_at)
          SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerFunds
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_kv_partnerSpvPositions", `INSERT INTO wave_b_backup_kv_partnerSpvPositions
          (id, payload_json, updated_at, deleted_at)
          SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerSpvPositions
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
        ["wave_b_backup_kv_partnerFundCommitments", `INSERT INTO wave_b_backup_kv_partnerFundCommitments
          (id, payload_json, updated_at, deleted_at)
          SELECT id, payload_json, updated_at, deleted_at FROM kv_partnerFundCommitments
          WHERE 1=1
          ON CONFLICT (id) DO NOTHING`],
      ];
      for (const [, sql] of copies) db.prepare(sql).run();

      // 3. Marker — subsequent boots see this key and skip the whole block.
      // Portable CURRENT_TIMESTAMP works on both SQLite and Postgres.
      db.prepare(
        `INSERT INTO _migrations_applied (key, applied_at, details)
           VALUES ('wave_b_backup_ddl_v1', CURRENT_TIMESTAMP,
                   'Wave B v26.4.0-fix backup DDL applied at boot. 9 backup tables materialized with PRIMARY KEY(id).')
           ON CONFLICT (key) DO NOTHING`,
      ).run();
    });
    try {
      waveBBackupTx();
    } catch (err) {
      // Fail-soft: if a legacy source table is missing on a fresh install
      // that pre-dates 0121, we log and continue. Wave B's own SQL migration
      // 0125 handles this by creating the kv_* sources first; this boot
      // mirror covers the :memory: / test path where migrations may not have
      // run yet.
      log.warn?.(`[wave_b] backup snapshot failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // Additive ADD COLUMNs — outside the txn; each guarded against the
  // duplicate-column error so re-boots no-op (mirrors applyV12AdditiveAlters).
  const addColumns: string[] = [
    `ALTER TABLE network_posts ADD COLUMN attachments TEXT`,
    `ALTER TABLE founder_crm_contacts ADD COLUMN invite_status TEXT`,
    `ALTER TABLE founder_crm_contacts ADD COLUMN invited_round_id TEXT`,
    `ALTER TABLE founder_crm_contacts ADD COLUMN invited_at TEXT`,
    // v25.51 6a — discrete identity fields (mirrors migration 0092). Additive,
    // nullable; legacy name/firm_name still populated for backward-compat.
    `ALTER TABLE founder_crm_contacts ADD COLUMN first_name TEXT`,
    `ALTER TABLE founder_crm_contacts ADD COLUMN last_name TEXT`,
    `ALTER TABLE founder_crm_contacts ADD COLUMN company_name TEXT`,
  ];
  for (const sql of addColumns) {
    try { db.exec(sql); } catch (err: any) {
      if (!/duplicate column name/i.test(err?.message ?? String(err))) {
        // Tolerate a missing base table on very early boot; real shape comes
        // from the base CREATE statements applied earlier in this pass.
        if (!/no such table/i.test(err?.message ?? String(err))) throw err;
      }
    }
  }
}

/* v25.45.4 — see call-site comment above. Idempotent + boot-safe. */
function applyV2545_4Schema(db: any) {
  // v25.47 live-DB alignment fix — on the production data.db the platform_fees
  // table predates the billing_period/deleted_at columns (it was created by an
  // earlier migration WITHOUT them), so the CREATE TABLE IF NOT EXISTS below is
  // a no-op and the seed INSERTs that reference those columns would crash with
  // "table platform_fees has no column named billing_period". These guarded,
  // additive ALTERs run BEFORE the seed transaction so the column shape is
  // present on BOTH a fresh DB and the live DB. Mirrors migration 0068's ALTERs
  // and the applyV12AdditiveAlters() duplicate-column tolerance pattern. Tier 3
  // #29 additive-only; no destructive change.
  const platformFeesAddColumns: string[] = [
    `ALTER TABLE platform_fees ADD COLUMN billing_period TEXT`,
    `ALTER TABLE platform_fees ADD COLUMN deleted_at TEXT`,
  ];
  for (const sql of platformFeesAddColumns) {
    try { db.exec(sql); } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Tolerate "duplicate column name" (already added on fresh DB / re-run) and
      // "no such table" (base CREATE below will create it on a truly fresh DB).
      if (!/duplicate column name/i.test(msg) && !/no such table/i.test(msg)) throw err;
    }
  }
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS profile_wizard_state (
       company_id  TEXT NOT NULL,
       user_id     TEXT NOT NULL,
       state_json  TEXT NOT NULL DEFAULT '{}',
       updated_at  TEXT NOT NULL,
       PRIMARY KEY (company_id, user_id)
     )`,
    `CREATE TABLE IF NOT EXISTS collective_pitch_decks (
       id                  TEXT PRIMARY KEY NOT NULL,
       company_id          TEXT NOT NULL,
       application_id      TEXT,
       s3_key              TEXT NOT NULL,
       kms_key_id          TEXT,
       storage_backend     TEXT NOT NULL DEFAULT 'fs',
       mime_type           TEXT NOT NULL,
       size_bytes          INTEGER NOT NULL,
       original_name       TEXT NOT NULL,
       uploaded_by_user_id TEXT NOT NULL,
       uploaded_at         TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_collective_pitch_decks_company ON collective_pitch_decks (company_id)`,
    `CREATE TABLE IF NOT EXISTS platform_fees (
       key                 TEXT PRIMARY KEY NOT NULL,
       amount_minor        INTEGER NOT NULL,
       currency            TEXT NOT NULL DEFAULT 'USD',
       updated_at          TEXT NOT NULL,
       updated_by_user_id  TEXT,
       billing_period      TEXT,
       deleted_at          TEXT
     )`,
    // v25.46 Track 5 — editorial press feed. Additive table (CREATE IF NOT
    // EXISTS); read-only for non-admin, admin-CRUD at /admin/press. Soft-delete
    // via deleted_at (never destructive). Tier 3 #29 additive-only migrations.
    `CREATE TABLE IF NOT EXISTS press_items (
       id                  TEXT PRIMARY KEY NOT NULL,
       title               TEXT NOT NULL,
       source              TEXT NOT NULL,
       url                 TEXT NOT NULL,
       published_at        TEXT,
       editorial_note      TEXT,
       created_at          TEXT NOT NULL,
       updated_at          TEXT,
       created_by_user_id  TEXT,
       deleted_at          TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_press_items_published ON press_items (published_at)`,
  ];
  const tx = db.transaction(() => {
    for (const sql of stmts) db.exec(sql);
    // APD-028 — canonical collective application fee: $300 = 30000 TRUE minor
    // units. Unified with the applyV2547Schema seed so the dual bootstrap path
    // never disagrees (this block runs first; INSERT OR IGNORE makes it the
    // authoritative seed on a fresh DB).
    db.prepare(
      `INSERT OR IGNORE INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
         VALUES ('collective_application_fee', 30000, 'USD', '2026-06-30T00:00:00.000Z', 'system:seed')`,
    ).run();
    // v25.46.1 — Multi-section fee admin seeds (APD-018). Additive only; mirrors
    // migration 0068_v25_46_1_consortium_fees.sql so the dual bootstrap+migration
    // path keeps these rows present on a fresh boot / test DB. INSERT OR IGNORE so
    // admin edits are never clobbered on restart (DB remains canonical). These are
    // SEPARATE/PARALLEL to the Capavate founder/investor subscription flow
    // (Sacred Rule 76) — they live only in platform_fees and never touch
    // capavate_subscriptions / pricing tiers / paymentGatewayAdapter.
    //
    //   Section: Collective → Cap Table Investor Membership Subscription (recurring)
    //     collective.member_subscription.basic       $99/mo
    //     collective.member_subscription.pro         $249/mo
    //     collective.member_subscription.enterprise  $999/mo
    //   Section: Consortium Partners → Partner Subscription Tiers (recurring)
    //     consortium.subscription.partner_basic       $499/mo
    //     consortium.subscription.partner_pro         $999/mo
    //     consortium.subscription.partner_enterprise  $2,499/mo
    //   Section: Consortium Partners → SPV Deployment flat fee (one-time)
    //     consortium.spv_deployment_fee               $5,000
    //
    // billing_period: 'monthly' for the recurring subscription tiers; NULL for the
    // one-time SPV flat fee (treated as one-time at the resolver/UI layer).
    const v25461SubTierSeed = db.prepare(
      `INSERT OR IGNORE INTO platform_fees
         (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES (?, ?, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL)`,
    );
    v25461SubTierSeed.run('collective.member_subscription.basic', 9900);
    v25461SubTierSeed.run('collective.member_subscription.pro', 24900);
    v25461SubTierSeed.run('collective.member_subscription.enterprise', 99900);
    v25461SubTierSeed.run('consortium.subscription.partner_basic', 49900);
    v25461SubTierSeed.run('consortium.subscription.partner_pro', 99900);
    v25461SubTierSeed.run('consortium.subscription.partner_enterprise', 249900);
    db.prepare(
      `INSERT OR IGNORE INTO platform_fees
         (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES ('consortium.spv_deployment_fee', 500000, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', NULL, NULL)`,
    ).run();
  });
  tx();
}


/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * Creates the two new fee/tax tables, adds additive columns to the REAL
 * partner-entity table (`contacts`, kind='consortium_partner'), to `spvs`
 * (the actual SPV/fund table — the brief's aspirational name `spv_funds`
 * maps here), and to `partner_billing_entries`. Seeds $0 default fee rows so
 * the resolver never throws `no_fee_schedule_configured` on a fresh deploy.
 *
 * DEVIATION NOTE (documented for verifiers): the LOCKED brief references
 * tables `consortium_partners` and `spv_funds` which DO NOT EXIST in Avi's
 * deployed v25.32.1 tree. The canonical partner entity is a `contacts` row
 * with kind='consortium_partner' (resolved via getContactById in
 * requirePartnerAuth.ts); the canonical SPV/fund table is `spvs`
 * (server/spvFundStore.ts). All columns the brief specifies for
 * `consortium_partners` are therefore added to `contacts`, and all columns
 * specified for `spv_funds` are added to `spvs`. No behavior of Avi's
 * existing columns is altered. */
function applyV2533PartnerPaymentSchema(db: any) {
  // ---- New tables (idempotent) ----
  const tables: string[] = [
    /* partner_fee_schedules — admin-configurable fee catalogue.
     * fee_kind enum semantics:
     *   'subscription_monthly'          — recurring monthly partner seat fee
     *   'subscription_annual'           — recurring annual partner seat fee
     *   'spv_deployment'                — one-time fee charged when an SPV is
     *                                     deployed (status -> 'active'); uses
     *                                     stepped size bands (size_band_min/max
     *                                     on committed_minor) to pick the rate
     *   'spv_management_per_lp_quarter' — recurring per-LP per-quarter mgmt fee
     *   'spv_closing_bonus'             — one-time bonus on SPV close
     * tier = NULL means PLATFORM default (applies to ALL partners); a non-NULL
     * tier scopes the row to one partner tier. Per-partner overrides live in
     * contacts.fee_override_json, not here. effective_from/effective_to give
     * time-windowing; effective_to IS NULL means currently active. */
    `CREATE TABLE IF NOT EXISTS partner_fee_schedules (
      id              TEXT PRIMARY KEY NOT NULL,
      tier            TEXT,
      fee_kind        TEXT NOT NULL,
      amount_minor    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      size_band_min   INTEGER,
      size_band_max   INTEGER,
      effective_from  TEXT NOT NULL,
      effective_to    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      created_by      TEXT,
      UNIQUE(tier, fee_kind, size_band_min, size_band_max, effective_from)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pfs_lookup ON partner_fee_schedules(tier, fee_kind, effective_to);`,
    `CREATE INDEX IF NOT EXISTS idx_pfs_kind ON partner_fee_schedules(fee_kind);`,

    /* partner_tax_forms — W-9 / W-8BEN / T4A compliance tracking. tax_id_hash
     * stores a one-way hash of the tax id (never the raw id). */
    `CREATE TABLE IF NOT EXISTS partner_tax_forms (
      id              TEXT PRIMARY KEY NOT NULL,
      partner_id      TEXT NOT NULL,
      form_type       TEXT NOT NULL,
      jurisdiction    TEXT NOT NULL,
      tax_id_hash     TEXT NOT NULL,
      collected_at    TEXT NOT NULL,
      expires_at      TEXT,
      document_url    TEXT,
      created_at      TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ptf_partner ON partner_tax_forms(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ptf_expires ON partner_tax_forms(expires_at);`,

    /* v25.33 P0a -- durable side table for the Settings -> Company
     * region / tagline / description fields. The client PATCH body carried
     * these three fields but server/routes.ts patchCompanyHandler discarded
     * them (they were never passed to updateCompanyDetails). We cannot add
     * columns to the sacred `companies` table, so — mirroring the existing
     * `company_default_currency` side table (v24.2 Bug 6) — we persist them
     * here keyed by company_id and overlay them on the active-company read. */
    `CREATE TABLE IF NOT EXISTS company_settings_overview (
      company_id   TEXT PRIMARY KEY NOT NULL,
      tenant_id    TEXT NOT NULL,
      region       TEXT,
      tagline      TEXT,
      description  TEXT,
      updated_at   TEXT,
      deleted_at   TEXT
    );`,

    /* W2-H — Consortium Partner SPV LP invites. Additive/idempotent; mirrors
     * migration 0101. last_name is NOT NULL (rule #13 mandatory name capture).
     * Hash-chained per (partner, spv) via prev_hash/curr_hash. */
    `CREATE TABLE IF NOT EXISTS spv_lp_invite (
      id          TEXT PRIMARY KEY NOT NULL,
      tenant_id   TEXT,
      partner_id  TEXT NOT NULL,
      spv_id      TEXT NOT NULL,
      email       TEXT NOT NULL,
      first_name  TEXT,
      last_name   TEXT NOT NULL,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'invited',
      prev_hash   TEXT,
      curr_hash   TEXT,
      created_at  TEXT NOT NULL,
      created_by  TEXT,
      deleted_at  TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_lp_invite_lookup ON spv_lp_invite(partner_id, spv_id, deleted_at);`,

    /* W3-B / C-5 — Investor accredited-investor self-declaration capture.
     * Append-only, hash-chained per investor. signature_name NOT NULL (rule #13).
     * Additive/idempotent; mirrors migration 0103 (both dirs). */
    `CREATE TABLE IF NOT EXISTS investor_accreditation_declaration (
      id              TEXT PRIMARY KEY NOT NULL,
      investor_id     TEXT NOT NULL,
      clause_version  TEXT NOT NULL,
      criteria_json   TEXT NOT NULL,
      signature_name  TEXT NOT NULL,
      signed_at       TEXT NOT NULL,
      jurisdiction    TEXT,
      created_at      TEXT NOT NULL,
      prev_hash       TEXT,
      curr_hash       TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_iad_investor ON investor_accreditation_declaration (investor_id, signed_at);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of tables) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v25.33 table creation failed (continuing):", (err as Error).message);
  }

  // ---- Additive ALTER TABLE ADD COLUMN (idempotent; swallow duplicate) ----
  const alters: Array<[string, string]> = [
    // v25.48.3 Q-I1 — founder "open to Collective refinement" opt-in on the
    // direct-application table (idempotent for existing live DBs).
    ["founder_collective_applications", "ALTER TABLE founder_collective_applications ADD COLUMN open_to_refinement INTEGER NOT NULL DEFAULT 0"],
    // contacts == the canonical partner entity (kind='consortium_partner').
    // These are the brief's `consortium_partners` columns, retargeted.
    ["contacts", "ALTER TABLE contacts ADD COLUMN fee_override_json TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN commission_override_pct REAL"],
    // GROUP C (migration 0105) — per-partner arrangement (subscription model,
    // report-only quota, fixed rev-share config). Mirrors fee_override_json in
    // placement; the per-partner PRICE stays in fee_override_json (no dup).
    ["contacts", "ALTER TABLE contacts ADD COLUMN arrangement_json TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN subscription_id TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN tax_form_collected_at TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN partner_agreement_version TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN partner_agreement_signed_at TEXT"],
    ["contacts", "ALTER TABLE contacts ADD COLUMN partner_agreement_signature_hash TEXT"],

    // partner_billing_entries — new entry kinds beyond referral commission.
    // entry_kind values: 'referral_commission' (legacy default, preserves
    // Avi's existing rows), 'subscription', 'spv_deployment_fee',
    // 'spv_management_fee', 'spv_closing_bonus'. computed_via records the
    // resolution path ('partner_override' | 'tier_default' | 'platform_default').
    ["partner_billing_entries", "ALTER TABLE partner_billing_entries ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'referral_commission'"],
    ["partner_billing_entries", "ALTER TABLE partner_billing_entries ADD COLUMN spv_fund_id TEXT"],
    ["partner_billing_entries", "ALTER TABLE partner_billing_entries ADD COLUMN fee_schedule_id TEXT"],
    ["partner_billing_entries", "ALTER TABLE partner_billing_entries ADD COLUMN computed_via TEXT"],

    // spvs == the canonical SPV/fund table (brief's `spv_funds`, retargeted).
    // deployment_fee_payer: 'partner' | 'platform' (who bears the fee).
    ["spvs", "ALTER TABLE spvs ADD COLUMN deployment_fee_minor INTEGER"],
    ["spvs", "ALTER TABLE spvs ADD COLUMN deployment_fee_currency TEXT"],
    ["spvs", "ALTER TABLE spvs ADD COLUMN deployment_fee_payer TEXT"],
    ["spvs", "ALTER TABLE spvs ADD COLUMN deployment_fee_paid_at TEXT"],
    ["spvs", "ALTER TABLE spvs ADD COLUMN deployment_fee_schedule_id TEXT"],
    ["spvs", "ALTER TABLE spvs ADD COLUMN sourcing_partner_id TEXT"],

    // v25.44 — M&A Intelligence privacy gate. ONE additive jsonb (TEXT in
    // SQLite) column on companies. Default is opt-OUT of Collective-wide
    // aggregation (shareWithCollective:false) but chapter/advisor visible by
    // default. Additive + reversible (DROP COLUMN to roll back).
    ["companies", `ALTER TABLE companies ADD COLUMN ma_privacy_json TEXT DEFAULT '{"shareWithCollective":false,"shareWithChapter":true,"shareWithAdvisors":true,"redactNarrativeFromAggregates":true}'`],

    // v25.44 — Surface 11 decline-with-reason. ONE additive NULLABLE column on
    // the collective applications table. (canonical table is `collective_apps`.)
    ["collective_apps", "ALTER TABLE collective_apps ADD COLUMN declined_reason TEXT"],

    // v25.45 F20 — Workspace archive + 8-year retention + revival. Four additive
    // NULLABLE columns on companies (migration 0062). archive_status defaults to
    // 'active'. last_active_plan is captured on archive for revival pre-select.
    // All additive + reversible (DROP COLUMN to roll back).
    ["companies", "ALTER TABLE companies ADD COLUMN archived_at TEXT"],
    ["companies", "ALTER TABLE companies ADD COLUMN archive_retention_until TEXT"],
    ["companies", "ALTER TABLE companies ADD COLUMN archive_status TEXT DEFAULT 'active'"],
    ["companies", "ALTER TABLE companies ADD COLUMN last_active_plan TEXT"],

    // v25.54 G0-2 — founder round-archive. Additive NULLABLE column; archived
    // rounds stay VISIBLE (unlike deleted_at) but are rendered inert. Mirrors
    // migration 0100. Idempotent (duplicate-column swallowed below).
    ["rounds", "ALTER TABLE rounds ADD COLUMN archived_at TEXT"],

    // W2-I — Consortium Partner Agreement sign-off captured AT APPLICATION.
    // Additive NULLABLE columns on the application table; mirrors migration
    // 0102. Carried to contacts.partner_agreement_* on approval.
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN agreement_version TEXT"],
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN agreement_signed_name TEXT"],
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN agreement_signed_at TEXT"],
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN agreement_signature_hash TEXT"],

    // GROUP F1 (migration 0106) — expand the EXISTING person-level partner CRM
    // to full parity, ON THE SAME TABLE the CP-008 hash chain already covers
    // (no second table → chain is not forked). Seven additive columns mirroring
    // investor_crm_contacts (stage/note_log/tasks/starred) plus company_id cross-
    // link and source_kind/source_ref provenance for from-source imports.
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN stage TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN company_id TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN note_log TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN tasks TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN starred INTEGER NOT NULL DEFAULT 0"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN source_kind TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN source_ref TEXT"],
  ];
  for (const [table, sql] of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/duplicate column|already exists/i.test(msg)) continue;
      log.warn(`[db] v25.33 ALTER on ${table} failed (continuing):`, msg);
    }
  }

  // ---- Indices for the new columns (idempotent) ----
  const v2533Indices = [
    "CREATE INDEX IF NOT EXISTS idx_pbe_entry_kind ON partner_billing_entries(entry_kind)",
    "CREATE INDEX IF NOT EXISTS idx_pbe_spv_fund ON partner_billing_entries(spv_fund_id)",
    "CREATE INDEX IF NOT EXISTS idx_spv_sourcing_partner ON spvs(sourcing_partner_id)",
    // GROUP F1 (migration 0106) — parity partial UNIQUE email index (self-
    // sufficient; does NOT reference dedup_exempt, unlike 0098) + company_id
    // cross-link lookup index. Both mirrored VERBATIM in the 0106 SQL file.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity ON partner_crm_contacts (partner_id, lower(trim(email))) WHERE email IS NOT NULL AND trim(email) <> '' AND deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_partner_crm_company ON partner_crm_contacts (partner_id, company_id)",
  ];
  for (const sql of v2533Indices) {
    try { db.exec(sql); } catch { /* tolerated */ }
  }

  // ---- Seed $0 default fee rows (idempotent INSERT OR IGNORE) ----
  // Default to $0 so the platform never accidentally charges real money until
  // an admin explicitly configures a fee via the admin UI. These rows also
  // guarantee partnerFeeResolver never throws no_fee_schedule_configured on a
  // fresh deploy. SPV deployment bands carry size_band_min/max in minor units
  // (cents): band1 0-250K, band2 250K-1M, band3 1M-5M, band4 5M+.
  const T0 = "2026-06-22T00:00:00Z";
  try {
    db.prepare(
      `INSERT OR IGNORE INTO partner_fee_schedules
         (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, created_at, updated_at)
       VALUES
         ('pfs_def_sub_m',    NULL, 'subscription_monthly',          0, 'USD', NULL,       NULL,       ?, ?, ?),
         ('pfs_def_sub_y',    NULL, 'subscription_annual',           0, 'USD', NULL,       NULL,       ?, ?, ?),
         ('pfs_def_spv_mgmt', NULL, 'spv_management_per_lp_quarter', 0, 'USD', NULL,       NULL,       ?, ?, ?),
         ('pfs_def_spv_bonus',NULL, 'spv_closing_bonus',             0, 'USD', NULL,       NULL,       ?, ?, ?),
         ('pfs_def_spv_band1',NULL, 'spv_deployment',                0, 'USD', 0,          25000000,   ?, ?, ?),
         ('pfs_def_spv_band2',NULL, 'spv_deployment',                0, 'USD', 25000000,   100000000,  ?, ?, ?),
         ('pfs_def_spv_band3',NULL, 'spv_deployment',                0, 'USD', 100000000,  500000000,  ?, ?, ?),
         ('pfs_def_spv_band4',NULL, 'spv_deployment',                0, 'USD', 500000000,  NULL,       ?, ?, ?)`,
    ).run(
      T0, T0, T0,  T0, T0, T0,  T0, T0, T0,  T0, T0, T0,
      T0, T0, T0,  T0, T0, T0,  T0, T0, T0,  T0, T0, T0,
    );
  } catch (err) {
    log.warn("[db] v25.33 fee seed failed (continuing):", (err as Error).message);
  }
}

/* ============================================================================
 * v25.34 Collective Mega-Wave — schema.
 *
 * (A) Idempotently re-assert read-path indexes for the 7 Collective store
 *     tables (the tables themselves come from the drizzle base schema; the
 *     stores are being converted to DB-DIRECT reads so we guarantee the
 *     hot-path indexes exist on a fresh live-server boot).
 * (B) Create the NEW parallel Collective Payment Model tables
 *     (collective_payment_schedules, collective_payment_entries,
 *     collective_invoices) + seed $0 platform defaults so the resolver never
 *     throws on a fresh deploy. Parallel/additive to v25.33; does NOT touch
 *     collectiveBillingStore.ts (SACRED) or Avi's payment writes.
 *
 * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, INSERT OR IGNORE. Boot-safe.
 * ========================================================================== */
function applyV2534CollectiveSchema(db: any) {
  const collectiveIndices: string[] = [
    "CREATE INDEX IF NOT EXISTS idx_v2534_se_chapter ON screening_events(chapter_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_se_company ON screening_events(company_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_se_round ON screening_events(round_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_se_sched ON screening_events(scheduled_for)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_sea_event ON screening_event_attendees(event_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_sc_round ON soft_circles(round_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_sc_company ON soft_circles(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_sc_investor ON soft_circles(investor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_msg_chapter ON messages(chapter_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_msg_thread ON messages(thread_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_msg_channel ON messages(channel_type)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_mt_chapter ON message_threads(chapter_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_mrr_msg ON message_read_receipts(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_ca_chapter ON chapter_announcements(chapter_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_ar_ann ON announcement_reads(announcement_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_rep_company ON reports(company_id, deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_rep_tenant ON reports(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_v2534_cls_lookup ON chapter_leaderboard_snapshots(chapter_id, period, period_start)",
  ];
  for (const sql of collectiveIndices) {
    try { db.exec(sql); } catch (err) {
      const msg = (err as Error).message || "";
      if (!/no such table|no such column/i.test(msg)) {
        log.warn("[db] v25.34 collective index failed (continuing):", msg);
      }
    }
  }

  const tables: string[] = [
    `CREATE TABLE IF NOT EXISTS collective_payment_schedules (
      id              TEXT PRIMARY KEY NOT NULL,
      scope_kind      TEXT NOT NULL DEFAULT 'platform',
      member_id       TEXT,
      tier            TEXT,
      chapter_id      TEXT,
      fee_kind        TEXT NOT NULL,
      amount_minor    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      cadence         TEXT NOT NULL DEFAULT 'one_time',
      effective_from  TEXT NOT NULL,
      effective_to    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      created_by      TEXT,
      UNIQUE(scope_kind, member_id, tier, chapter_id, fee_kind, effective_from)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cps_lookup ON collective_payment_schedules(scope_kind, fee_kind, effective_to);`,
    `CREATE INDEX IF NOT EXISTS idx_cps_member ON collective_payment_schedules(member_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cps_tier ON collective_payment_schedules(tier);`,
    `CREATE INDEX IF NOT EXISTS idx_cps_kind ON collective_payment_schedules(fee_kind);`,
    `CREATE TABLE IF NOT EXISTS collective_payment_entries (
      id              TEXT PRIMARY KEY NOT NULL,
      tenant_id       TEXT NOT NULL DEFAULT 'tenant_platform',
      member_id       TEXT NOT NULL,
      chapter_id      TEXT,
      entry_kind      TEXT NOT NULL DEFAULT 'membership_dues',
      amount_minor    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      status          TEXT NOT NULL DEFAULT 'pending',
      schedule_id     TEXT,
      invoice_id      TEXT,
      computed_via    TEXT,
      description     TEXT,
      period          TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      paid_at         TEXT,
      deleted_at      TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cpe_member ON collective_payment_entries(member_id, deleted_at);`,
    `CREATE INDEX IF NOT EXISTS idx_cpe_kind ON collective_payment_entries(entry_kind);`,
    `CREATE INDEX IF NOT EXISTS idx_cpe_status ON collective_payment_entries(status);`,
    `CREATE INDEX IF NOT EXISTS idx_cpe_invoice ON collective_payment_entries(invoice_id);`,
    `CREATE TABLE IF NOT EXISTS collective_invoices (
      id              TEXT PRIMARY KEY NOT NULL,
      tenant_id       TEXT NOT NULL DEFAULT 'tenant_platform',
      member_id       TEXT NOT NULL,
      chapter_id      TEXT,
      number          TEXT,
      status          TEXT NOT NULL DEFAULT 'draft',
      total_minor     INTEGER NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'USD',
      issued_at       TEXT,
      due_at          TEXT,
      paid_at         TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      deleted_at      TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cinv_member ON collective_invoices(member_id, deleted_at);`,
    `CREATE INDEX IF NOT EXISTS idx_cinv_status ON collective_invoices(status);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of tables) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v25.34 collective payment table creation failed (continuing):", (err as Error).message);
  }

  // v25.34 (CONCERN 4): idempotency support for the Collective payment ledger.
  // A guarded additive ALTER adds the column, and a PARTIAL UNIQUE index (only
  // WHERE idempotency_key IS NOT NULL) prevents duplicate cpe_* rows on retry /
  // double-click while still allowing many NULL-key (non-idempotent) entries.
  try {
    db.exec("ALTER TABLE collective_payment_entries ADD COLUMN idempotency_key TEXT");
  } catch (err) {
    const msg = (err as Error).message || "";
    if (!/duplicate column|already exists/i.test(msg)) {
      log.warn("[db] v25.34 idempotency_key ALTER failed (continuing):", msg);
    }
  }
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cpe_idem ON collective_payment_entries(idempotency_key) WHERE idempotency_key IS NOT NULL",
    );
  } catch (err) {
    log.warn("[db] v25.34 idempotency_key index failed (continuing):", (err as Error).message);
  }

  const T0 = "2026-06-22T00:00:00Z";
  try {
    db.prepare(
      `INSERT OR IGNORE INTO collective_payment_schedules
         (id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor, currency, cadence, effective_from, created_at, updated_at)
       VALUES
         ('cps_def_dues',    'platform', NULL, NULL, NULL, 'membership_dues', 0, 'USD', 'annual',   ?, ?, ?),
         ('cps_def_event',   'platform', NULL, NULL, NULL, 'event_fee',       0, 'USD', 'one_time', ?, ?, ?),
         ('cps_def_sponsor', 'platform', NULL, NULL, NULL, 'sponsorship_fee', 0, 'USD', 'one_time', ?, ?, ?),
         ('cps_def_chapter', 'platform', NULL, NULL, NULL, 'chapter_dues',    0, 'USD', 'annual',   ?, ?, ?),
         ('cps_def_late',    'platform', NULL, NULL, NULL, 'late_fee',        0, 'USD', 'one_time', ?, ?, ?)`,
    ).run(T0, T0, T0,  T0, T0, T0,  T0, T0, T0,  T0, T0, T0,  T0, T0, T0);
  } catch (err) {
    log.warn("[db] v25.34 collective fee seed failed (continuing):", (err as Error).message);
  }
}

/* ==========================================================================
 * v25.38 Admin DB-driven pricing config bootstrap.
 *
 * Mirrors migrations 0057 + 0058 EXACTLY (CREATE TABLE IF NOT EXISTS +
 * INSERT OR IGNORE), so a fresh live-server boot always has a config row even
 * before the numbered migrations run. Avi's COMMISSION_RATE literal in
 * partnerConsortiumRoutes.ts is NOT touched — these tables back the new
 * resolvers (collectiveApplicationFeeResolver.ts / partnerCommissionRateResolver.ts)
 * only. Fully idempotent + boot-safe.
 * ========================================================================== */
function applyV2538PricingConfigSchema(db: any) {
  const stmts: string[] = [
    // --- Phase 1: collective application-fee config (single-row) ---
    `CREATE TABLE IF NOT EXISTS collective_application_fee_config (
      id           TEXT PRIMARY KEY DEFAULT 'default',
      amount_minor INTEGER NOT NULL,
      currency     TEXT NOT NULL DEFAULT 'USD',
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by   TEXT
    );`,
    `INSERT OR IGNORE INTO collective_application_fee_config (id, amount_minor, currency, updated_at)
       VALUES ('default', 30000, 'USD', datetime('now'));`,
    // --- Phase 2: partner commission-rate config (per-tier) ---
    `CREATE TABLE IF NOT EXISTS partner_commission_rate_config (
      tier       TEXT PRIMARY KEY,
      rate       REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );`,
    `INSERT OR IGNORE INTO partner_commission_rate_config (tier, rate) VALUES
       ('catalyst', 0.02),
       ('builder', 0.03),
       ('amplifier', 0.04),
       ('nexus', 0.05),
       ('founding_member', 0.06);`,
    // --- W4 (migration 0111): Collective dynamic subscription-package CRUD ---
    // Additive + idempotent; NO live packages seeded (empty -> env/static fallback).
    // Independent of Capavate pricing + Consortium fee tables; touches no payment code.
    `CREATE TABLE IF NOT EXISTS collective_subscription_configs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      entitlements_json TEXT NOT NULL DEFAULT '[]',
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      interval TEXT NOT NULL DEFAULT 'annual',
      airwallex_tier TEXT NOT NULL,
      airwallex_price_id TEXT NOT NULL,
      membership_role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      effective_from TEXT,
      effective_to TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prev_revision_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      revision_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_csc_status_sort ON collective_subscription_configs(status, sort_order, label);`,
    `CREATE INDEX IF NOT EXISTS idx_csc_slug ON collective_subscription_configs(slug);`,
    `CREATE INDEX IF NOT EXISTS idx_csc_airwallex_tier ON collective_subscription_configs(airwallex_tier);`,
    `CREATE INDEX IF NOT EXISTS idx_csc_price_id ON collective_subscription_configs(airwallex_price_id);`,
    `CREATE INDEX IF NOT EXISTS idx_csc_effective_window ON collective_subscription_configs(status, effective_from, effective_to);`,
    `CREATE TABLE IF NOT EXISTS collective_subscription_config_history (
      history_id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      prev_revision_hash TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT,
      change_kind TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_csch_config_version ON collective_subscription_config_history(config_id, version);`,
    `CREATE INDEX IF NOT EXISTS idx_csch_changed_at ON collective_subscription_config_history(changed_at);`,
    // --- W6 (migration 0113): Ask-an-Expert partner-responder / connect backend ---
    // Additive + idempotent; independent of the expert_questions/answers hash chain.
    `CREATE TABLE IF NOT EXISTS partner_responder_registry (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      partner_id TEXT NOT NULL,
      chapter_id TEXT,
      display_name TEXT NOT NULL,
      topics_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      deleted_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_prr_partner ON partner_responder_registry(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_prr_chapter_status ON partner_responder_registry(chapter_id, status);`,
    `CREATE TABLE IF NOT EXISTS partner_connect_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      chapter_id TEXT,
      question_id TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      responder_user_id TEXT,
      answer_id TEXT,
      decline_reason TEXT,
      responded_at TEXT,
      prev_hash TEXT,
      curr_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_question ON partner_connect_requests(question_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_partner_status ON partner_connect_requests(partner_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_requester ON partner_connect_requests(requester_user_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pcr_question_partner ON partner_connect_requests(question_id, partner_id);`,
    // --- w-partner F1 (migration 0114): typed partner attributions + revision chain ---
    // Promotes attributions out of the schemaless kv_partnerAttributions blob.
    // Additive + idempotent. The kv->typed backfill is a guarded TypeScript boot
    // step (backfillPartnerAttributionsFromKv), never SQL — see 0114's header.
    `CREATE TABLE IF NOT EXISTS partner_attributions (
      id TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      attributed_at TEXT NOT NULL,
      attributed_by TEXT,
      attribution_source TEXT NOT NULL
        CHECK (attribution_source IN ('admin_manual', 'referral_code', 'partner_claim', 'partner_portfolio')),
      revoked_at TEXT,
      revoked_by TEXT,
      notes TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prev_revision_hash TEXT,
      revision_hash TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      is_seed INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pattr_partner ON partner_attributions(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pattr_partner_company ON partner_attributions(partner_id, company_id);`,
    `CREATE TABLE IF NOT EXISTS partner_attribution_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      attribution_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      prev_revision_hash TEXT,
      revision_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      recorded_by TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pattr_rev_attribution ON partner_attribution_revisions(attribution_id, version);`,
    `CREATE INDEX IF NOT EXISTS idx_pattr_rev_partner ON partner_attribution_revisions(partner_id);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of stmts) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v25.38 pricing-config bootstrap failed (continuing):", (err as Error).message);
  }
}

/* ==========================================================================
 * v25.42h Housekeeping — telemetry_events firehose table.
 *
 * sprint10Telemetry.ts previously buffered SyncEnvelope<T> rows in a
 * module-level `const events: SyncEnvelope<unknown>[] = []`. Its header
 * documented this as a preview-only in-memory store ("In production this is
 * replaced by the outbox table -> webhook relay"). This wave makes it durable.
 *
 * Schema (per the v25.42h brief):
 *   id PK, tenant_id, event_type, aggregate_id, aggregate_kind, occurred_at,
 *   actor_user_id, actor_ip, payload_json, schema_version, created_at
 * Plus a trace_json column to persist the Sprint 14 D7 trace[] array that the
 * envelope carries (so downstream replay/regression tooling still sees it).
 *
 * Index on (tenant_id, occurred_at DESC) backs getRecentEvents()'s
 * ORDER BY occurred_at DESC LIMIT ? read path.
 *
 * Additive only; no FKs to existing tables. Idempotent. Boot-safe.
 * ========================================================================== */
function applyV2542HTelemetryEventsSchema(db: any) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS telemetry_events (
      id             TEXT PRIMARY KEY NOT NULL,
      tenant_id      TEXT NOT NULL,
      event_type     TEXT NOT NULL,
      aggregate_id   TEXT NOT NULL,
      aggregate_kind TEXT NOT NULL,
      occurred_at    TEXT NOT NULL,
      actor_user_id  TEXT,
      actor_ip       TEXT,
      payload_json   TEXT,
      trace_json     TEXT,
      schema_version TEXT NOT NULL DEFAULT '1.0',
      created_at     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_telemetry_events_tenant_occurred
       ON telemetry_events(tenant_id, occurred_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_telemetry_events_type
       ON telemetry_events(event_type);`,
    `CREATE INDEX IF NOT EXISTS idx_telemetry_events_occurred
       ON telemetry_events(occurred_at DESC);`,
  ];
  try {
    const tx = db.transaction(() => { for (const sql of stmts) db.exec(sql); });
    tx();
  } catch (err) {
    log.warn("[db] v25.42h telemetry_events bootstrap failed (continuing):", (err as Error).message);
  }
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
    // ---- v25.45.4 M-5/M-6: durable dataroom storage pointers (migration 0067) ----
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN storage_key TEXT"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN storage_kms_key_id TEXT"],
    ["dataroom_files", "ALTER TABLE dataroom_files ADD COLUMN storage_backend TEXT"],
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
    // ---- v25.0 Track 1 A7 — soft_circles reject columns. ----
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN rejected_at TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN rejected_reason TEXT"],
    // ---- v25.0 Track 3 C1 — soft_circles partner-sourcing columns. ----
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN source_type TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN source_id TEXT"],
    // ---- v25.0 Track 3 C5 — partners active_fund_id for multi-fund switching. ----
    // Applied via ALTER TABLE IF NOT EXISTS; error silently swallowed for duplicate column.
    ["contacts", "ALTER TABLE contacts ADD COLUMN active_fund_id TEXT"],
    // ---- v25.32 P2c — admin-user directory fields. `name` + `tenant` are
    // persisted columns the admin Users UI surfaces. MFA is NOT a column —
    // it's derived from `totp_secret IS NOT NULL` in adminUsersRoutes.listAll().
    ["auth_users", "ALTER TABLE auth_users ADD COLUMN name TEXT"],
    ["auth_users", "ALTER TABLE auth_users ADD COLUMN tenant TEXT"],
    // ---- v25.51 name-split Phase 1 — discrete first/last (additive; composed
    // name columns kept populated for byte-stable readers/exports/hash-chains).
    // Mirrors migration 0093_v25_51_name_split_phase1.sql.
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN first_name TEXT"],
    ["partner_crm_contacts", "ALTER TABLE partner_crm_contacts ADD COLUMN last_name TEXT"],
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN contact_first_name TEXT"],
    ["consortium_applications", "ALTER TABLE consortium_applications ADD COLUMN contact_last_name TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN investor_first_name TEXT"],
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN investor_last_name TEXT"],
    // Shadie V6 5b (migration 0104) — durable "resent" marker.
    ["round_invitations", "ALTER TABLE round_invitations ADD COLUMN resent_at TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN investor_first_name TEXT"],
    ["soft_circles", "ALTER TABLE soft_circles ADD COLUMN investor_last_name TEXT"],
    // ---- v25.51 name-split Phase 2 — core identity (users.name kept composed). ----
    ["users", "ALTER TABLE users ADD COLUMN first_name TEXT"],
    ["users", "ALTER TABLE users ADD COLUMN last_name TEXT"],
    ["user_credentials", "ALTER TABLE user_credentials ADD COLUMN first_name TEXT"],
    ["user_credentials", "ALTER TABLE user_credentials ADD COLUMN last_name TEXT"],
    // ---- v25.51 name-split Phase 4 — investor CRM + cap-table holder identity.
    // Additive; composed name / holder_name kept authoritative (cap-table
    // holder first/last is metadata ONLY, never part of the commit hash-chain
    // or any amount/share math). Mirrors migration 0095.
    ["investor_crm_contacts", "ALTER TABLE investor_crm_contacts ADD COLUMN first_name TEXT"],
    ["investor_crm_contacts", "ALTER TABLE investor_crm_contacts ADD COLUMN last_name TEXT"],
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN holder_first_name TEXT"],
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN holder_last_name TEXT"],
    // ---- W-SAFE (2026-07-14) — unpriced-instrument (SAFE / convertible note)
    // commit support (migration 0112). Additive + idempotent; existing rows keep
    // instrument_class='priced' so no historical commit/hash is reinterpreted.
    // instrument_class + principal_amount + valuation_cap + discount_pct ARE part
    // of the commit hash body for unpriced rows (buildCommitBody) — this is the
    // one place cap-table hash-chain metadata is intentionally extended.
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN instrument_class TEXT NOT NULL DEFAULT 'priced'"],
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN principal_amount TEXT"],
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN valuation_cap TEXT"],
    ["captable_commits", "ALTER TABLE captable_commits ADD COLUMN discount_pct TEXT"],
    ["funded_queue", "ALTER TABLE funded_queue ADD COLUMN instrument_class TEXT NOT NULL DEFAULT 'priced'"],
    // ---- w-partner (2026-07-25) — migration 0115: designated partner-member
    // lead on the client CRM. The CREATE TABLE IF NOT EXISTS literal for
    // partner_client_crm is a no-op on an already-deployed DB, so without THIS
    // half the column never lands there and hydratePartnerClientCrmStore's
    // SELECT throws — which it swallows non-fatally, leaving every partner's
    // CRM stage projection silently EMPTY after boot.
    ["partner_client_crm", "ALTER TABLE partner_client_crm ADD COLUMN lead_user_id TEXT"],
    // ---- w-collective Wave 2 Stage A (2026-07-28) — migrations 0117/0118/0120.
    // Every CREATE TABLE IF NOT EXISTS literal above is a NO-OP on an
    // already-deployed database, so each of these columns needs this second half
    // or it never lands there. That matters concretely because shared/schema.ts
    // now DECLARES these columns: without the ALTERs, drizzle emits them in its
    // select list and hydrateNetworkPostsStore / any users read raises
    // "no such column" on a deployed DB.
    //
    // 0117 — comms_channels anchors. `kind` is in both the canonical and the
    // pre-0117 runtime shape, so that one is an expected swallowed duplicate on
    // every real DB; it is kept only to repair a hypothetical pre-canonical
    // table. Added nullable — SQLite cannot ADD NOT NULL without a default, and
    // inventing a default kind would mislabel existing channels.
    ["comms_channels", "ALTER TABLE comms_channels ADD COLUMN company_id TEXT"],
    ["comms_channels", "ALTER TABLE comms_channels ADD COLUMN round_id TEXT"],
    ["comms_channels", "ALTER TABLE comms_channels ADD COLUMN chapter_id TEXT"],
    ["comms_channels", "ALTER TABLE comms_channels ADD COLUMN kind TEXT"],
    // 0118 — network_posts scope. NO DEFAULT, deliberately: NULL means "no scope
    // was set" and the read side must treat that as the SAFE (author-only) case.
    ["network_posts", "ALTER TABLE network_posts ADD COLUMN scope TEXT"],
    ["network_posts", "ALTER TABLE network_posts ADD COLUMN company_id TEXT"],
    ["network_posts", "ALTER TABLE network_posts ADD COLUMN chapter_id TEXT"],
    // 0120 — optional self-entered investor profile location. Founders derive
    // theirs from companies.hq at read time; it is not duplicated onto users.
    ["users", "ALTER TABLE users ADD COLUMN location TEXT"],
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
    // w-collective Wave 2 Stage A — migration 0118. Placed in THIS array (not
    // next to the CREATE literal) because the columns they index are added by
    // the guarded ALTERs above, which run earlier in this same function.
    "CREATE INDEX IF NOT EXISTS idx_network_posts_scope ON network_posts(scope, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_network_posts_company ON network_posts(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_network_posts_chapter ON network_posts(chapter_id)",
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
      first_name TEXT,               -- v25.51 name-split (additive)
      last_name TEXT,                -- v25.51 name-split (additive)
      role TEXT NOT NULL,
      avatar_url TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      -- w-collective Wave 2 Stage A (migration 0120) — optional self-entered
      -- investor profile location. Founders derive theirs from companies.hq at
      -- read time; it is not duplicated here.
      location TEXT
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
      first_name TEXT,               -- v25.51 name-split (additive)
      last_name TEXT,                -- v25.51 name-split (additive)
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
    // v24.2 Bug 6 — durable storage for the Settings → Company default currency.
    // Deliberately a side table (NOT a column on the sacred `companies` table).
    `CREATE TABLE IF NOT EXISTS company_default_currency (
      company_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );`,
    // v24.2 Bug 6 — durable storage for the rich profileStore CompanyProfile
    // (the Sprint-8 production-shape profile edited via PATCH
    // /api/companies/:id/profile). This is distinct from the hash-chained
    // company_profile_extended table owned by companyProfileStore; we store
    // the full client-shaped JSON so a restart re-hydrates the founder's
    // saved profile (sector, contact, legal, etc.).
    `CREATE TABLE IF NOT EXISTS profilestore_company_profile (
      company_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT,
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
      holder_first_name TEXT,        -- v25.51 name-split metadata (NEVER hashed)
      holder_last_name TEXT,         -- v25.51 name-split metadata (NEVER hashed)
      instrument_class TEXT NOT NULL DEFAULT 'priced', -- W-SAFE: 'priced'|'unpriced' (hashed for unpriced)
      principal_amount TEXT,         -- W-SAFE: committed principal for unpriced (hashed)
      valuation_cap TEXT,            -- W-SAFE: SAFE/note valuation cap (hashed for unpriced)
      discount_pct TEXT,             -- W-SAFE: SAFE/note discount %% (hashed for unpriced)
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
      instrument_class TEXT NOT NULL DEFAULT 'priced', -- W-SAFE: carried from enqueue
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
      first_name TEXT,
      last_name TEXT,
      company_name TEXT,
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
      first_name TEXT,               -- v25.51 name-split (additive)
      last_name TEXT,                -- v25.51 name-split (additive)
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
    // ---------- v25.45 Bug C (Ozan QA wave) — round-close chain-head freezes ----------
    // Persists the per-round, append-only snapshot of the company carry-forward
    // hash-chain head captured at round-close time (freezeRoundChainHead).
    // Previously this lived ONLY in an in-memory Map (frozenRoundChainHead),
    // so on a server restart every closed round lost its frozen baseline and a
    // re-freeze could re-snapshot against a different chain head — corrupting the
    // round-close audit baseline. This table is ADDITIVE and append-only-by-use
    // (round_id PRIMARY KEY → a round can only freeze once). It does NOT touch the
    // sacred carry-forward chain itself or captable_commits.
    `CREATE TABLE IF NOT EXISTS round_chain_head_freezes (
      round_id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      chain_head TEXT NOT NULL,
      frozen_at TEXT NOT NULL
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
      deleted_at TEXT,
      -- w-collective Wave 2 Stage A (migration 0118) — re-scopable posts. NO
      -- DEFAULT on scope, deliberately: an unset scope is NULL and the read side
      -- must treat NULL as the SAFE (author-only) case. Do not add a default.
      scope TEXT,
      company_id TEXT,
      chapter_id TEXT
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
      investor_first_name TEXT,      -- v25.51 name-split (additive)
      investor_last_name TEXT,       -- v25.51 name-split (additive)
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
      investor_first_name TEXT,      -- v25.51 name-split (additive)
      investor_last_name TEXT,       -- v25.51 name-split (additive)
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
      cap_table_exempt INTEGER NOT NULL DEFAULT 0,
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
      open_to_refinement INTEGER NOT NULL DEFAULT 0,
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
    /* ── v25.50 Phase 3 (migration 0089) — NEW singular Private-Portfolio profile
       table (distinct from the legacy plural table above). Mirrored here so
       :memory: test runs (which skip the migration runner) have it ready. ── */
    `CREATE TABLE IF NOT EXISTS partner_portfolio_company (
      id             TEXT PRIMARY KEY,
      tenant_id      TEXT,
      partner_id     TEXT NOT NULL,
      company_id     TEXT NOT NULL,
      profile_json   TEXT NOT NULL DEFAULT '{}',
      prev_hash      TEXT,
      curr_hash      TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      updated_by     TEXT,
      deleted_at     TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_portfolio_company_partner ON partner_portfolio_company (partner_id, company_id);`,
    /* ── v25.50 Phase 7 (migration 0090) — partner-local team-member contact
       overrides (mobile / contact email / position note). Mirrored here for
       :memory: test runs. ── */
    `CREATE TABLE IF NOT EXISTS partner_team_member_contact (
      id             TEXT PRIMARY KEY,
      partner_id     TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      mobile         TEXT,
      contact_email  TEXT,
      position_note  TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      updated_by     TEXT
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_team_member_contact_key ON partner_team_member_contact (partner_id, user_id);`,
    `CREATE TABLE IF NOT EXISTS partner_crm_contacts (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      contact_user_id TEXT,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      first_name TEXT,               -- v25.51 name-split (additive)
      last_name TEXT,                -- v25.51 name-split (additive)
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
      contact_first_name TEXT,       -- v25.51 name-split (additive)
      contact_last_name TEXT,        -- v25.51 name-split (additive)
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

    /* ═════════════════════════════════════════════════════════════════════
     * Wave C-2 v26.6.0 (D1 integration) — production table statements for
     * migrations 0128-0137.
     *
     * WHY HERE, AT THE TAIL: every FK target these entries name
     * (partner_organizations :4159, companies :2737, partner_attributions
     * :2129, partner_crm_contacts :3944, users :2716) is declared EARLIER in
     * this same returned array, so appending keeps CREATE-time resolution in
     * dependency order. This whole array is consumed at :193 and executed at
     * :196 inside the tx() at :198 — i.e. BEFORE every self-heal call in
     * applyInlineMigrations, including all nine Wave C-2 installers.
     *
     * WHAT IS DELIBERATELY ABSENT: the four per-surface `idx_<surface>_pcr`
     * indexes from 0136 (:148-151) and 0130's
     * idx_mf_engagement_authority_artifact (:117). Those index COLUMNS that do
     * not exist until the corresponding self-heal ALTERs run, so putting them
     * here would fail every boot. They stay in their own installers.
     * ═════════════════════════════════════════════════════════════════════ */

    /* ---- 0130 (C-2.c) + 0131 (C-2.d) + 0136 (C-2.h) shared prerequisite:
     * mf_engagement FULL SHAPE.
     *
     * mf_engagement is a pre-Wave-C2 table created ONLY by applyMfcrmSchema()
     * (server/lib/mfcrmSchema.ts:56), which is NOT in this boot chain at all —
     * grep: its single non-test caller is managedFounderStore.ts:858, inside
     * hydrateManagedFounderStore(). Three Wave C-2 installers ALTER
     * mf_engagement (0130, 0131, 0136); without an entry here they hard-fail
     * with `no such table: mf_engagement` on every fresh boot.
     *
     * The DDL below is COPIED BYTE-FOR-BYTE from mfcrmSchema.ts:56-74 — all 14
     * columns plus UNIQUE (partner_id, company_id) plus both indexes. The
     * FULL shape is mandatory, not a convenience: applyMfcrmSchema() is
     * CREATE-only (mfcrmSchema.ts:243 `for (const sql of stmts) db.exec(sql);`
     * — zero ALTER TABLE / PRAGMA table_info anywhere in it) and it latches
     * `applied = true` even in its catch (mfcrmSchema.ts:244, :251). A
     * reduced-shape entry here would win the CREATE race, applyMfcrmSchema()'s
     * identical IF NOT EXISTS CREATE would silently no-op forever, and
     * managedFounderStore.createEngagement's INSERT would die on
     * `no column named mode` for the process lifetime. Byte-identical means
     * whichever runs first produces the complete table and the other is a
     * genuine no-op. Do NOT edit this block by hand — regenerate it from
     * mfcrmSchema.ts:56-74. ---- */
    `CREATE TABLE IF NOT EXISTS mf_engagement (
      id                     TEXT PRIMARY KEY NOT NULL,
      partner_id             TEXT NOT NULL,
      company_id             TEXT NOT NULL,
      mode                   TEXT NOT NULL DEFAULT 'B',
      status                 TEXT NOT NULL DEFAULT 'ACTIVE',
      authority_artifact_ref TEXT,
      authority_expires_at   TEXT,
      trial_expires_at       TEXT,
      chapter_id             TEXT,
      matter_id              TEXT,
      sources_capital_at_create INTEGER,
      created_by             TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL,
      UNIQUE (partner_id, company_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_partner ON mf_engagement(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_company ON mf_engagement(partner_id, company_id);`,

    /* ---- v26.7.1 POST-DEPLOY FIX — mf_engagement_event (Avi deploy failure, 2026-08-06).
     *
     * SIBLING to the mf_engagement fix above. Same class of defect, missed by all 3
     * triple-review reviewers: reviewers reasoned about the specific table called out
     * in D-INT-1 (`mf_engagement`) but not about the transitive sibling graph.
     *
     * mf_engagement_event is a pre-Wave-C2 table created ONLY by applyMfcrmSchema()
     * (server/lib/mfcrmSchema.ts:77). Three Wave C-2 migrations ALTER it (0130 comments,
     * 0131 Part 2 ADDs, 0131 Part 3 rebuild references it in INSERT...SELECT). Without
     * an entry here it hard-fails on every fresh boot with `no such column: company_id`
     * during 0131's PART 3 INSERT...SELECT statement.
     *
     * The DDL below is COPIED BYTE-FOR-BYTE from mfcrmSchema.ts:77-88 — all 8 baseline
     * columns plus both indexes. The 5 additional columns from 0131 (actor_role,
     * actor_partner_user_id, acting_on_behalf_of_user_id, partner_attribution_id,
     * event_data_json) are DELIBERATELY NOT added here — they remain the responsibility
     * of migration 0131's Part 2 ADD COLUMN statements, preserving the migration audit
     * trail and matching the D1 pattern. Byte-identical to the applyMfcrmSchema()
     * version means whichever runs first produces the complete table and the other is a
     * genuine no-op. Do NOT edit this block by hand — regenerate it from
     * mfcrmSchema.ts:77-88. ---- */
    `CREATE TABLE IF NOT EXISTS mf_engagement_event (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      engagement_id TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      detail_json   TEXT,
      actor         TEXT,
      created_at    TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_partner ON mf_engagement_event(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_eng ON mf_engagement_event(engagement_id);`,

    /* ---- 0128 (C-2.a) — MFC stage engine. Two tables + 5 indexes, matching
     * 0128_wave_c2_mfc_stages.sql post-round-1 (no REFERENCES users(id) on
     * actor_user_id per BLOCK-2; no idx_mfc_stages_partner_type per MINOR-2).
     * Present here so 0131's and 0132's sqlite_master probe for mfc_stages
     * succeeds on the SAME boot rather than one boot later (0128 round-1
     * MAJOR-2), which is what lets 0128 be registered last. ---- */
    `CREATE TABLE IF NOT EXISTS mfc_stages (
      id                       TEXT PRIMARY KEY NOT NULL,
      partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
      stage_machine_type       TEXT NOT NULL CHECK (stage_machine_type IN ('mfc_engagement','partner_pipeline','mp_soft_circle')),
      key                      TEXT NOT NULL,
      label                    TEXT NOT NULL,
      ordinal                  INTEGER NOT NULL,
      is_terminal              INTEGER NOT NULL DEFAULT 0,
      default_probability_pct  INTEGER CHECK (default_probability_pct IS NULL OR (default_probability_pct >= 0 AND default_probability_pct <= 100)),
      age_sla_hours            INTEGER CHECK (age_sla_hours IS NULL OR age_sla_hours >= 0),
      created_at               TEXT NOT NULL,
      updated_at               TEXT NOT NULL,
      UNIQUE (partner_id, stage_machine_type, key),
      UNIQUE (partner_id, stage_machine_type, ordinal),
      UNIQUE (id, stage_machine_type)
    );`,
    `CREATE TABLE IF NOT EXISTS mfc_stage_transitions (
      id                       TEXT PRIMARY KEY NOT NULL,
      partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
      stage_machine_type       TEXT NOT NULL CHECK (stage_machine_type IN ('mfc_engagement','partner_pipeline','mp_soft_circle')),
      subject_id               TEXT NOT NULL,
      from_stage_id            TEXT,
      to_stage_id              TEXT NOT NULL,
      actor_user_id            TEXT NOT NULL,
      actor_role               TEXT NOT NULL CHECK (actor_role IN ('founder','partner','admin','system')),
      reason                   TEXT,
      note                     TEXT,
      created_at               TEXT NOT NULL,
      FOREIGN KEY (from_stage_id, stage_machine_type) REFERENCES mfc_stages(id, stage_machine_type),
      FOREIGN KEY (to_stage_id,   stage_machine_type) REFERENCES mfc_stages(id, stage_machine_type)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_stages_terminal ON mfc_stages(is_terminal);`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_subject_created ON mfc_stage_transitions(subject_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_partner_type    ON mfc_stage_transitions(partner_id, stage_machine_type);`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_to_stage   ON mfc_stage_transitions(to_stage_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_from_stage ON mfc_stage_transitions(from_stage_id) WHERE from_stage_id IS NOT NULL;`,

    /* ---- 0130 (C-2.c) — authority_artifacts. Byte-identical to
     * 0130_wave_c2_authority_artifacts.sql. Note the partial UNIQUE index
     * uq_authority_artifacts_effective (V32-N7): at most one non-revoked
     * artifact per (partner_attribution_id, kind) for CLIENT-level artifacts;
     * firm-level rows (partner_attribution_id IS NULL) are policed at
     * contacts by uq_contacts_partner_agreement instead. ---- */
    `CREATE TABLE IF NOT EXISTS authority_artifacts (
      id                       TEXT PRIMARY KEY NOT NULL,
      partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
      partner_attribution_id   TEXT REFERENCES partner_attributions(id),
      company_id               TEXT REFERENCES companies(id),
      kind                     TEXT NOT NULL CHECK (kind IN (
                                 'engagement_letter',
                                 'client_authority_scope',
                                 'dpa',
                                 'referral_consent'
                               )),
      effective_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at               TEXT,
      revoked_at               TEXT,
      revoked_by               TEXT,
      content_hash             TEXT NOT NULL,
      storage_uri              TEXT NOT NULL,
      mime_type                TEXT NOT NULL,
      byte_size                INTEGER NOT NULL CHECK (byte_size > 0),
      signed_by_founder_at     TEXT,
      signed_by_founder_ip     TEXT,
      signed_by_partner_at     TEXT,
      signed_by_partner_ip     TEXT,
      verification_status      TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
                                 'unverified',
                                 'auto_verified',
                                 'admin_verified',
                                 'rejected'
                               )),
      verification_notes       TEXT,
      created_at               TEXT NOT NULL,
      created_by               TEXT,
      updated_at               TEXT NOT NULL,
      updated_by               TEXT,
      CHECK (
        (kind IN ('engagement_letter','client_authority_scope')
          AND partner_attribution_id IS NOT NULL AND company_id IS NOT NULL)
        OR
        (kind IN ('dpa','referral_consent'))
      )
    );`,
    `CREATE INDEX IF NOT EXISTS idx_authority_artifacts_partner ON authority_artifacts(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_authority_artifacts_partner_company ON authority_artifacts(partner_id, company_id) WHERE company_id IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_authority_artifacts_attribution ON authority_artifacts(partner_attribution_id) WHERE partner_attribution_id IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_authority_artifacts_effective ON authority_artifacts(partner_attribution_id, kind) WHERE revoked_at IS NULL AND partner_attribution_id IS NOT NULL;`,

    /* ---- 0134 (C-2.g) — partner_crm_contact_client_scope. created_at carries
     * a DEFAULT (R2 fix, M-g1) so §14.4's literal 5-column promotion-upsert
     * INSERT does not trip its NOT NULL. idx_pccs_contact is deliberately
     * omitted (MINOR m-g2 — redundant left-prefix of the UNIQUE index). ---- */
    `CREATE TABLE IF NOT EXISTS partner_crm_contact_client_scope (
      id                       TEXT PRIMARY KEY NOT NULL,
      partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
      partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
      scoped_by_user_id        TEXT NOT NULL REFERENCES users(id),
      scoped_at                TEXT NOT NULL,
      created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_by               TEXT,
      UNIQUE (partner_crm_contact_id, partner_attribution_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pccs_attribution ON partner_crm_contact_client_scope(partner_attribution_id);`,

    /* ---- 0136 (C-2.h) — PCR spine + surface-presence join. Spine-seed ids use
     * '|' as the partner_id/company_id separator (R2 fix, BLOCKER 2 — '_' was
     * non-injective); seeding itself lives in the numbered migration. ---- */
    `CREATE TABLE IF NOT EXISTS partner_company_relationship (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL REFERENCES partner_organizations(id),
      company_id  TEXT NOT NULL REFERENCES companies(id),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (partner_id, company_id)
    );`,
    `CREATE TABLE IF NOT EXISTS pcr_surface_presence (
      id          TEXT PRIMARY KEY NOT NULL,
      pcr_id      TEXT NOT NULL REFERENCES partner_company_relationship(id),
      surface     TEXT NOT NULL CHECK (surface IN ('mfc','pipeline','clients','portfolio')),
      row_id      TEXT NOT NULL,
      added_at    TEXT NOT NULL,
      removed_at  TEXT,
      UNIQUE (pcr_id, surface, row_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_partner  ON partner_company_relationship(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_company  ON partner_company_relationship(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_pcr     ON pcr_surface_presence(pcr_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_row     ON pcr_surface_presence(surface, row_id);`,

    /* ---- 0137 (C-2.i) — mfc_classification_requests.
     * uq_mfc_classification_requests_pending is a PARTIAL UNIQUE index, not a
     * plain index: it is the sole anti-spam / idempotency mechanism on the
     * request-classification route (V32-B6 — no rate limiter exists). ---- */
    `CREATE TABLE IF NOT EXISTS mfc_classification_requests (
      id                    TEXT PRIMARY KEY NOT NULL,
      partner_id            TEXT NOT NULL REFERENCES partner_organizations(id),
      requested_by_user_id  TEXT NOT NULL REFERENCES users(id),
      status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending',
                              'approved',
                              'rejected'
                            )),
      created_at            TEXT NOT NULL,
      resolved_at           TEXT,
      resolved_by_user_id   TEXT REFERENCES users(id),
      note                  TEXT
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_mfc_classification_requests_pending ON mfc_classification_requests(partner_id) WHERE status = 'pending';`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_status_created ON mfc_classification_requests(status, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_partner ON mfc_classification_requests(partner_id);`,

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

    // ============================================================
    // v24.4.1 — 6-store RAM→DB migration. Tables below are created on
    // every boot via `CREATE TABLE IF NOT EXISTS` so Avi's deploy needs no
    // separate migration step. Each table corresponds to one previously
    // pure-RAM store. Read paths stay in-memory caches; writes flow to both.
    // ============================================================

    // welcomeStore — per-user welcome-ack flag.
    `CREATE TABLE IF NOT EXISTS welcome_acks (
      user_id    TEXT PRIMARY KEY NOT NULL,
      ack        INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );`,

    // transactionPrepStore — M&A transaction-prep channels (one per company,
    // 30 thread anchors each). Stored as JSON blob keyed by channel id; the
    // duplicate company_id column is indexed for the getChannelByCompany() path.
    `CREATE TABLE IF NOT EXISTS transaction_prep_channels (
      id           TEXT PRIMARY KEY NOT NULL,
      company_id   TEXT NOT NULL,
      channel_json TEXT NOT NULL,
      archived_at  TEXT,
      updated_at   TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_txprep_company ON transaction_prep_channels(company_id);`,

    // introRequestStore — warm-intro requests routed through the CRM action
    // drawer. Stored as JSON blob keyed by request id.
    `CREATE TABLE IF NOT EXISTS intro_requests (
      id                   TEXT PRIMARY KEY NOT NULL,
      requester_company_id TEXT NOT NULL,
      status               TEXT NOT NULL,
      request_json         TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_intro_req_company ON intro_requests(requester_company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_intro_req_status ON intro_requests(status);`,

    // paymentStore — legacy v14 unified ledger (collective memberships,
    // founder subscriptions, company billing, refunds, prorations). Stored as
    // JSON blob keyed by entry id; intentId is unique-indexed for the
    // idempotency lookup path.
    `CREATE TABLE IF NOT EXISTS payment_ledger (
      id          TEXT PRIMARY KEY NOT NULL,
      intent_id   TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      state       TEXT NOT NULL,
      entry_json  TEXT NOT NULL,
      ts          TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_payment_customer ON payment_ledger(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_payment_state ON payment_ledger(state);`,
    /* v25.32 burndown — item 43: composite index backing the /api/admin/payments
       filter+sort path (WHERE state = ? AND ts >= ? ORDER BY ts DESC). The
       single-column idx_payment_state above can serve the equality predicate but
       not the ts range/sort; (state, ts) lets SQLite satisfy both the filter and
       the ordering from one index for large ledgers. CREATE INDEX IF NOT EXISTS —
       idempotent, additive. Source: paymentStore.ts /api/admin/payments. */
    `CREATE INDEX IF NOT EXISTS idx_payment_state_ts ON payment_ledger(state, ts);`,
    `CREATE INDEX IF NOT EXISTS idx_payment_ts ON payment_ledger(ts);`,

    // v25.32 P1c — durable payment webhook event log. Replaces the in-memory
    // `recentWebhookEvents` array in paymentGatewayAdapter.ts (standing rule:
    // nothing in memory; all DB-driven). The admin webhook-events view and any
    // future audit/replay path read directly from this table.
    `CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      intent_id    TEXT NOT NULL,
      status       TEXT NOT NULL,
      company_id   TEXT,
      gateway      TEXT,
      payload_json TEXT,
      received_at  TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pwe_intent ON payment_webhook_events(intent_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pwe_received ON payment_webhook_events(received_at DESC);`,

    // v25.32 deep — webhook idempotency claim table, promoted to the BOOT
    // schema. Previously this DDL was created lazily inside
    // paymentGatewayAdapter.ts / stripeGatewayAdapter.ts (and guarded by an
    // in-memory `_processedWebhookTableEnsured` flag). Per Ozan's standing rule
    // (nothing in memory; all DB-driven) the idempotency path is now DB-only and
    // must not depend on lazy per-process table creation. Both the Airwallex and
    // Stripe adapters share this table; the column is `processed_at` (its
    // historical name — kept stable so the Stripe adapter contract is unchanged).
    `CREATE TABLE IF NOT EXISTS processed_webhook_events (
      key          TEXT PRIMARY KEY NOT NULL,
      processed_at TEXT NOT NULL
    );`,

    /* v25.32 final — FX rates for soft-circle multi-currency display.
     * Previously hardcoded in paymentStore.softCircleRates() (USD/CAD/GBP/
     * EUR/SGD/HKD/CNY constants). Ozan: "no hardcoded values that should
     * come from DB/admin." Defaults seeded on first boot via INSERT OR
     * IGNORE so existing deploys don't drift from prior behavior; admin
     * can UPDATE rates through a dedicated endpoint or directly. */
    `CREATE TABLE IF NOT EXISTS fx_rates (
      currency_code TEXT PRIMARY KEY NOT NULL,
      rate          REAL NOT NULL,
      updated_at    TEXT NOT NULL
    );`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('USD', 1.0,  '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('CAD', 1.35, '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('GBP', 0.79, '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('EUR', 0.92, '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('SGD', 1.35, '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('HKD', 7.81, '2026-06-21T00:00:00Z');`,
    `INSERT OR IGNORE INTO fx_rates (currency_code, rate, updated_at) VALUES ('CNY', 7.27, '2026-06-21T00:00:00Z');`,

    /* v25.32 final — DB-backed provisioning locks (replaces the in-memory
     * AUTO_PROVISION_LOCKS Map<string, Promise> in paymentGatewayAdapter).
     * Each row is a lock claim on a (lock_key, holder) tuple with an
     * expiration. INSERT OR IGNORE against `lock_key` is the atomic acquire;
     * we cleanup expired rows opportunistically on every call. This is
     * cross-process safe (the original Map was only single-process safe). */
    `CREATE TABLE IF NOT EXISTS provisioning_locks (
      lock_key   TEXT PRIMARY KEY NOT NULL,
      holder     TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_provisioning_locks_expires ON provisioning_locks(expires_at);`,

    // profileStore.investorProfiles — mirror of the existing
    // profilestore_company_profile table from v24.2 Bug 6. The company-profile
    // side is already DB-backed; this closes the investor side. Storing as JSON
    // blob preserves the rich InvestorProfile shape (nested visibility, KYC
    // documents array, accreditation status, etc.) without flattening to columns.
    `CREATE TABLE IF NOT EXISTS profilestore_investor_profile (
      investor_id  TEXT PRIMARY KEY NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      deleted_at   TEXT
    );`,

    // ============================================================
    // partnerWorkspaceStore — v24.4.1 RAM→DB migration. Six in-memory
    // collections become durable so Avi's restarts no longer wipe partner
    // workspaces.
    // ============================================================

    // partner_team_members: who has access to which partner workspace, with
    // sub-role and active/removed status. Critical for requirePartnerAuth.
    `CREATE TABLE IF NOT EXISTS partner_team_members (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      sub_role    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      joined_at   TEXT NOT NULL,
      removed_at  TEXT,
      created_by  TEXT NOT NULL,
      is_seed     INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ptm_partner ON partner_team_members(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ptm_user ON partner_team_members(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ptm_status ON partner_team_members(status);`,

    // partner_team_invitations: magic-link invites (single-use, 7d expiry).
    `CREATE TABLE IF NOT EXISTS partner_team_invitations (
      id              TEXT PRIMARY KEY NOT NULL,
      partner_id      TEXT NOT NULL,
      invitation_json TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pti_partner ON partner_team_invitations(partner_id);`,

    // partner_notes: workspace-level notes (created/edited by team members).
    `CREATE TABLE IF NOT EXISTS partner_notes (
      id         TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      note_json  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pnote_partner ON partner_notes(partner_id);`,

    // partner_tasks: workspace task tracker.
    `CREATE TABLE IF NOT EXISTS partner_tasks (
      id         TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      task_json  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ptask_partner ON partner_tasks(partner_id);`,

    // partner_files: workspace file uploads.
    `CREATE TABLE IF NOT EXISTS partner_files (
      id         TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      file_json  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pfile_partner ON partner_files(partner_id);`,

    // partner_workspace_settings: per-partner workspace settings (currency,
    // branding, etc.).
    `CREATE TABLE IF NOT EXISTS partner_workspace_settings (
      partner_id    TEXT PRIMARY KEY NOT NULL,
      settings_json TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );`,

    // v25.49 Phase-3A — separate Partner Clients CRM engine (mirrors
    // migrations/0083). partner_client_crm holds the durable CRM stage per
    // (partner_id, company_id); partner_client_activity is an append-only
    // client-scoped timeline. Both partner-scoped / fail-closed at the store.
    // w-partner (0115) — lead_user_id is the designated partner-team member for
    // this client. This literal only covers FRESH DBs; the guarded ADD COLUMN in
    // applyV12AdditiveAlters covers already-deployed ones (CREATE TABLE IF NOT
    // EXISTS is a no-op there).
    `CREATE TABLE IF NOT EXISTS partner_client_crm (
      partner_id   TEXT NOT NULL,
      company_id   TEXT NOT NULL,
      stage        TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      updated_by   TEXT,
      lead_user_id TEXT,
      PRIMARY KEY (partner_id, company_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_client_crm_partner ON partner_client_crm(partner_id);`,
    `CREATE TABLE IF NOT EXISTS partner_client_activity (
      id             TEXT PRIMARY KEY NOT NULL,
      partner_id     TEXT NOT NULL,
      company_id     TEXT NOT NULL,
      activity_type  TEXT NOT NULL,
      body           TEXT,
      actor_user_id  TEXT,
      occurred_at    TEXT NOT NULL,
      meta_json      TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_partner_client_activity_partner ON partner_client_activity(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_partner_client_activity_company ON partner_client_activity(partner_id, company_id);`,

    // v25.49 Phase-4 — CANONICAL SPV Engine (mirrors migrations/0084). SINGULAR
    // table names so they never collide with the pre-existing PLURAL spvFundStore
    // tables (spvs / spv_distributions / …). Thin coordination layer; most
    // columns FK into existing canonical records. Audit anchors prev/curr_hash.
    `CREATE TABLE IF NOT EXISTS spv (
      id                  TEXT PRIMARY KEY NOT NULL,
      sponsor_partner_id  TEXT NOT NULL,
      gp_user_id          TEXT,
      name                TEXT NOT NULL,
      spv_type            TEXT NOT NULL DEFAULT 'spv',
      jurisdiction        TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'draft',
      distribution_scope  TEXT NOT NULL DEFAULT 'private',
      target_raise_minor  INTEGER,
      min_check_minor     INTEGER,
      cap_minor           INTEGER,
      currency            TEXT NOT NULL DEFAULT 'USD',
      carry_basis         TEXT NOT NULL,
      lp_visibility       TEXT NOT NULL DEFAULT 'own_only',   -- own_only | co_investors (Phase-4B)
      target_company_id   TEXT,
      close_date          TEXT,
      terms_json          TEXT,
      migrated_from       TEXT,
      created_at          TEXT NOT NULL,
      created_by          TEXT,
      updated_at          TEXT NOT NULL,
      updated_by          TEXT,
      archived_at         TEXT,
      prev_hash           TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash           TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_sponsor ON spv(sponsor_partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_status ON spv(sponsor_partner_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_scope ON spv(distribution_scope);`,
    `CREATE TABLE IF NOT EXISTS spv_mandate (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      mode          TEXT NOT NULL DEFAULT 'open',
      rule_tree_json TEXT NOT NULL,
      geography_json TEXT,
      sector_json    TEXT,
      company_ids_json TEXT,
      stage_json     TEXT,
      check_min_minor INTEGER,
      check_max_minor INTEGER,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      updated_by    TEXT,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_mandate_spv ON spv_mandate(spv_id);`,
    `CREATE TABLE IF NOT EXISTS spv_fee (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      layer         TEXT NOT NULL,
      fee_type      TEXT NOT NULL,
      fixed_amount_minor INTEGER,
      carry_pct     REAL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      effective_date TEXT NOT NULL,
      set_by        TEXT,
      created_at    TEXT NOT NULL,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_fee_spv ON spv_fee(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_fee_spv_layer ON spv_fee(spv_id, layer, effective_date);`,
    `CREATE TABLE IF NOT EXISTS spv_subscription (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      investor_id   TEXT NOT NULL,
      investor_persona TEXT,
      commitment_minor INTEGER NOT NULL,
      wired_minor   INTEGER NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'USD',
      status        TEXT NOT NULL DEFAULT 'review',
      kyc_ref       TEXT,
      accreditation_ref TEXT,
      subscription_doc_ref TEXT,
      ownership_pct REAL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      updated_by    TEXT,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_subscription_spv ON spv_subscription(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_subscription_investor ON spv_subscription(investor_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_spv_subscription_spv_investor ON spv_subscription(spv_id, investor_id);`,
    `CREATE TABLE IF NOT EXISTS spv_deployment (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      company_round_id TEXT NOT NULL,
      instrument    TEXT,
      amount_minor  INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      shares        TEXT,
      cap_table_ledger_ref TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      founder_confirmed_at TEXT,
      wired_at      TEXT,
      wire_payment_ref TEXT,
      closing_doc_ref TEXT,
      deployed_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_deployment_spv ON spv_deployment(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_deployment_company ON spv_deployment(company_id);`,
    `CREATE TABLE IF NOT EXISTS spv_distribution (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      event         TEXT NOT NULL,
      gross_proceeds_minor INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      waterfall_json TEXT NOT NULL,
      allocations_json TEXT NOT NULL,
      gp_carry_minor INTEGER NOT NULL DEFAULT 0,
      platform_carry_minor INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'recorded',
      created_at    TEXT NOT NULL,
      created_by    TEXT,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_distribution_spv ON spv_distribution(spv_id);`,
    `CREATE TABLE IF NOT EXISTS spv_document (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      doc_type      TEXT NOT NULL,
      title         TEXT,
      storage_key   TEXT NOT NULL,
      storage_backend TEXT NOT NULL DEFAULT 'fs',
      content_type  TEXT,
      size_bytes    INTEGER,
      expiry        TEXT,
      created_at    TEXT NOT NULL,
      created_by    TEXT,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_document_spv ON spv_document(spv_id);`,
    `CREATE TABLE IF NOT EXISTS spv_transfer (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      from_investor_id TEXT NOT NULL,
      to_investor_id   TEXT NOT NULL,
      units_pct     REAL,
      amount_minor  INTEGER,
      currency      TEXT NOT NULL DEFAULT 'USD',
      status        TEXT NOT NULL DEFAULT 'proposed',
      compliance_recheck_ref TEXT,
      gp_approval   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_transfer_spv ON spv_transfer(spv_id);`,
    // Phase-4C / Blocker 3 — money-movement-safe fee obligations. FIXED portions
    // accrued at funding (must be paid/waived before commit/deploy); CARRY
    // portions accrued at distribution (collected with a recorded payment ref).
    `CREATE TABLE IF NOT EXISTS spv_fee_obligation (
      id            TEXT PRIMARY KEY NOT NULL,
      spv_id        TEXT NOT NULL,
      layer         TEXT NOT NULL,
      portion       TEXT NOT NULL,
      timing        TEXT NOT NULL,
      amount_minor  INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      state         TEXT NOT NULL DEFAULT 'pending',
      payment_ref   TEXT,
      distribution_id TEXT,
      waived_by     TEXT,
      waived_reason TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_spv_fee_obligation_spv ON spv_fee_obligation(spv_id);`,
    `CREATE INDEX IF NOT EXISTS idx_spv_fee_obligation_spv_timing ON spv_fee_obligation(spv_id, timing, state);`,
    `CREATE TABLE IF NOT EXISTS investor_compliance_profile (
      investor_id   TEXT PRIMARY KEY NOT NULL,
      kyc_status    TEXT NOT NULL DEFAULT 'none',
      kyc_verified_at TEXT,
      kyc_expiry    TEXT,
      accreditation_status TEXT NOT NULL DEFAULT 'none',
      accreditation_certified_at TEXT,
      jurisdiction  TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      curr_hash     TEXT NOT NULL
    );`,

    // ============================================================
    // v25.0 Track 2 — Collective B Endpoints
    // ============================================================

    // B1 — collective_interest_threads: tracks expressed interest from
    // a Collective member toward a founder's company.
    `CREATE TABLE IF NOT EXISTS collective_interest_threads (
      id                         TEXT PRIMARY KEY NOT NULL,
      company_id                 TEXT NOT NULL,
      collective_member_user_id  TEXT NOT NULL,
      initial_message            TEXT,
      status                     TEXT NOT NULL DEFAULT 'open',
      created_at                 TEXT NOT NULL,
      last_message_at            TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cit_company ON collective_interest_threads(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cit_member ON collective_interest_threads(collective_member_user_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cit_dedup ON collective_interest_threads(company_id, collective_member_user_id) WHERE status != 'closed';`,

    // B3 — collective_directory_listings: founder companies auto-enrolled
    // after Collective application approval. The GET /api/collective/companies
    // endpoint filters to listed companies only.
    `CREATE TABLE IF NOT EXISTS collective_directory_listings (
      id              TEXT PRIMARY KEY NOT NULL,
      company_id      TEXT NOT NULL UNIQUE,
      application_id  TEXT NOT NULL,
      chapter         TEXT,
      stage           TEXT,
      sector          TEXT,
      listed_at       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'listed'
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cdl_company ON collective_directory_listings(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cdl_status ON collective_directory_listings(status);`,

    `CREATE INDEX IF NOT EXISTS idx_sync_company_tenant ON sync_company(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_investor_email ON sync_investor(email);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_round_company ON sync_round(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_audit_actor ON sync_audit_entry(actor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_post_channel ON sync_post(channel_id);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_redeem_email ON auth_redeem_tokens(email);`,

    // ============================================================
    // v25.0 Track 1 — Capavate core endpoints (A1-A8)
    // ============================================================

    // A2: term_sheets — generated term sheet docs (markdown + PDF)
    `CREATE TABLE IF NOT EXISTS term_sheets (
      id          TEXT PRIMARY KEY NOT NULL,
      round_id    TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      format      TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_term_sheets_round ON term_sheets(round_id);`,

    // A4: data_room_files — round-scoped file attachments with base64 content
    `CREATE TABLE IF NOT EXISTS data_room_files (
      id             TEXT PRIMARY KEY NOT NULL,
      round_id       TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      filename       TEXT NOT NULL,
      content_base64 TEXT NOT NULL,
      mime_type      TEXT NOT NULL,
      uploaded_at    TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_drf_round ON data_room_files(round_id);`,
    `CREATE INDEX IF NOT EXISTS idx_drf_owner ON data_room_files(owner_id);`,

    // A4: data_room_grants — token-gated access grants for data room files
    `CREATE TABLE IF NOT EXISTS data_room_grants (
      id          TEXT PRIMARY KEY NOT NULL,
      file_id     TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_drg_file ON data_room_grants(file_id);`,
    `CREATE INDEX IF NOT EXISTS idx_drg_token ON data_room_grants(token);`,

    // A5: investor_kyc — KYC attestation records for investors
    `CREATE TABLE IF NOT EXISTS investor_kyc (
      id                TEXT PRIMARY KEY NOT NULL,
      investor_id       TEXT NOT NULL,
      accredited        INTEGER NOT NULL DEFAULT 0,
      jurisdiction      TEXT NOT NULL,
      source_of_funds   TEXT NOT NULL,
      attestations_json TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ikyc_investor ON investor_kyc(investor_id);`,

    // A6: document_signatures — signature records for documents
    `CREATE TABLE IF NOT EXISTS document_signatures (
      id             TEXT PRIMARY KEY NOT NULL,
      document_id    TEXT NOT NULL,
      signer_id      TEXT NOT NULL,
      signature_text TEXT NOT NULL,
      signed_at      TEXT NOT NULL,
      ip_address     TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_docsig_document ON document_signatures(document_id);`,
    `CREATE INDEX IF NOT EXISTS idx_docsig_signer ON document_signatures(signer_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_docsig_unique ON document_signatures(document_id, signer_id);`,

    // A8: round_updates — founder update broadcasts per round
    `CREATE TABLE IF NOT EXISTS round_updates (
      id           TEXT PRIMARY KEY NOT NULL,
      round_id     TEXT NOT NULL,
      author_id    TEXT NOT NULL,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      visibility   TEXT NOT NULL DEFAULT 'all',
      published_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_rupd_round ON round_updates(round_id);`,
    `CREATE INDEX IF NOT EXISTS idx_rupd_author ON round_updates(author_id);`,

    // v25.0 Track 5 — E2: admin_compliance_holds (id-keyed, full audit trail)
    `CREATE TABLE IF NOT EXISTS admin_compliance_holds (
      id          TEXT PRIMARY KEY NOT NULL,
      tenant_type TEXT NOT NULL,
      tenant_id   TEXT NOT NULL,
      reason      TEXT NOT NULL,
      placed_by   TEXT NOT NULL,
      placed_at   TEXT NOT NULL,
      removed_at  TEXT,
      removed_by  TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ach_tenant ON admin_compliance_holds(tenant_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ach_active ON admin_compliance_holds(tenant_id, removed_at);`,

    // v25.0 Track 5 — E3: billing_disputes
    `CREATE TABLE IF NOT EXISTS billing_disputes (
      id               TEXT PRIMARY KEY NOT NULL,
      subscription_id  TEXT NOT NULL,
      amount_minor     INTEGER NOT NULL,
      reason           TEXT NOT NULL,
      customer_notes   TEXT,
      status           TEXT NOT NULL DEFAULT 'open',
      created_by       TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      resolved_at      TEXT,
      resolved_by      TEXT,
      resolution_notes TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_bd_sub ON billing_disputes(subscription_id);`,
    `CREATE INDEX IF NOT EXISTS idx_bd_status ON billing_disputes(status);`,

    // v25.0 Track 5 — E4: tenant_deletion_audit
    `CREATE TABLE IF NOT EXISTS tenant_deletion_audit (
      id                 TEXT PRIMARY KEY NOT NULL,
      tenant_type        TEXT NOT NULL,
      tenant_id          TEXT NOT NULL,
      deleted_by         TEXT NOT NULL,
      deleted_at         TEXT NOT NULL,
      audit_payload_json TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_tda_tenant ON tenant_deletion_audit(tenant_id);`,

    // v25.0 Track 5 — E5: email_campaigns_v25 + email_campaign_v25_recipients
    `CREATE TABLE IF NOT EXISTS email_campaigns_v25 (
      id              TEXT PRIMARY KEY NOT NULL,
      name            TEXT NOT NULL,
      cohort_filter   TEXT NOT NULL,
      subject         TEXT NOT NULL,
      body_text       TEXT NOT NULL,
      body_html       TEXT NOT NULL,
      sent_by         TEXT NOT NULL,
      sent_at         TEXT NOT NULL,
      queued_count    INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS email_campaign_v25_recipients (
      id           TEXT PRIMARY KEY NOT NULL,
      campaign_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      email        TEXT NOT NULL,
      queued_at    TEXT NOT NULL,
      delivered_at TEXT,
      failed_at    TEXT,
      fail_reason  TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ecr_campaign ON email_campaign_v25_recipients(campaign_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_campaign_v25_recipients(user_id);`,

    // v25.0 Track 5 — E6: region_toggles
    `CREATE TABLE IF NOT EXISTS region_toggles (
      region     TEXT PRIMARY KEY NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      toggled_at TEXT NOT NULL,
      toggled_by TEXT NOT NULL,
      reason     TEXT
    );`,

    // v25.0 Track 3 — C2: partner_billing_entries
    // Auto-populated when a deal is funded via partner channel.
    // Idempotent: deal_ref UNIQUE enforces no double-counting.
    `CREATE TABLE IF NOT EXISTS partner_billing_entries (
      id                  TEXT PRIMARY KEY NOT NULL,
      partner_id          TEXT NOT NULL,
      deal_ref            TEXT NOT NULL UNIQUE,
      amount_funded_minor INTEGER NOT NULL DEFAULT 0,
      tier_at_funding     TEXT NOT NULL,
      commission_pct      REAL NOT NULL,
      commission_minor    INTEGER NOT NULL DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'pending',
      paid_at             TEXT,
      created_at          TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pbe_partner ON partner_billing_entries(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pbe_status  ON partner_billing_entries(partner_id, status);`,

    // v25.0 Track 3 — C3: partner_sourced_investors
    // Links investors to the partner that sourced them via partner-channel invitation.
    `CREATE TABLE IF NOT EXISTS partner_sourced_investors (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      investor_id TEXT NOT NULL,
      sourced_at  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active'
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_psi_partner_investor ON partner_sourced_investors(partner_id, investor_id);`,
    `CREATE INDEX IF NOT EXISTS idx_psi_partner ON partner_sourced_investors(partner_id);`,

    // v25.0 Track 3 — C4: partner_sourced_founders
    // Companies the partner has sourced or co-sourced.
    `CREATE TABLE IF NOT EXISTS partner_sourced_founders (
      id         TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      sourced_at TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active'
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_psf_partner_company ON partner_sourced_founders(partner_id, company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_psf_partner ON partner_sourced_founders(partner_id);`,
    // v25.1 Bug 2 fix — comms messages must persist to DB. The in-memory Map
    // approach lost messages across PM2-cluster workers and server restarts.
    `CREATE TABLE IF NOT EXISTS comms_messages (
      id              TEXT PRIMARY KEY NOT NULL,
      channel_id      TEXT NOT NULL,
      author_user_id  TEXT NOT NULL,
      body            TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      edited_at       TEXT,
      deleted_at      TEXT,
      reply_to_message_id TEXT,
      attachments_json TEXT,
      starred_by_user_ids_json TEXT,
      reactions_json  TEXT,
      read_by_user_ids_json TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_comms_messages_channel ON comms_messages(channel_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_comms_messages_author ON comms_messages(author_user_id);`,
    /* ---- w-collective Wave 2 Stage A (2026-07-28) ------------------------
     * migration 0117 — comms_channels was NEVER migration-managed: it existed
     * only as lazy runtime DDL in commsStore.persistChannel, created on the
     * first channel write, so on a DB where no channel had been persisted the
     * table was absent and hydrateCommsStore's SELECT failed. This literal is
     * the canonical shape (persistChannel now emits the same one) plus the
     * durable company/round/chapter anchors. The guarded ADD COLUMN half lives
     * in applyV12AdditiveAlters — required, because on a DB whose
     * comms_channels was already built by the OLD runtime DDL this
     * CREATE TABLE IF NOT EXISTS is a no-op and the anchors would never land. */
    `CREATE TABLE IF NOT EXISTS comms_channels (
      id                        TEXT PRIMARY KEY NOT NULL,
      kind                      TEXT NOT NULL,
      participant_user_ids_json TEXT NOT NULL,
      created_at                TEXT NOT NULL,
      metadata_json             TEXT,
      deleted_at                TEXT,
      company_id                TEXT,
      round_id                  TEXT,
      chapter_id                TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_comms_channels_company ON comms_channels(company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_comms_channels_round ON comms_channels(round_id);`,
    `CREATE INDEX IF NOT EXISTS idx_comms_channels_chapter ON comms_channels(chapter_id);`,
    `CREATE INDEX IF NOT EXISTS idx_comms_channels_kind ON comms_channels(kind);`,
    /* migration 0116 — durable per-USER company follow relation. Followers were
     * in-memory demo seed arrays (commsStore.ts:489), empty in production, and
     * POST /api/comms/posts/:id/follow wrote the followed company onto the POST
     * object, so "who follows this company" was unanswerable and every follow
     * died on restart. Uniqueness is on the pair for all time (not partial on
     * deleted_at), so unfollow is a soft delete and re-follow is an upsert. */
    `CREATE TABLE IF NOT EXISTS company_followers (
      id          TEXT PRIMARY KEY NOT NULL,
      tenant_id   TEXT,
      user_id     TEXT NOT NULL,
      company_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT,
      deleted_at  TEXT
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_company_followers_user_company ON company_followers(user_id, company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_company_followers_user ON company_followers(user_id, deleted_at);`,
    `CREATE INDEX IF NOT EXISTS idx_company_followers_company ON company_followers(company_id, deleted_at);`,
    /* migration 0119 — durable per-user post engagement. restorePostFromDb
     * (commsStore.ts:2616-2619) resets likedByUserIds/commentCount/comments/
     * shareCount to empty on hydrate because there was nowhere to read them
     * from, so every restart wiped all engagement. The aggregate
     * network_posts.likes / .comments columns are KEPT (no silent drops). */
    `CREATE TABLE IF NOT EXISTS network_post_likes (
      post_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_network_post_likes_post_user ON network_post_likes(post_id, user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_likes_post ON network_post_likes(post_id);`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_likes_user ON network_post_likes(user_id);`,
    `CREATE TABLE IF NOT EXISTS network_post_comments (
      id             TEXT PRIMARY KEY NOT NULL,
      post_id        TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      body           TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      deleted_at     TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_comments_post ON network_post_comments(post_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_comments_author ON network_post_comments(author_user_id);`,
    /* Shares are an append-only event log — deliberately NOT unique per pair. */
    `CREATE TABLE IF NOT EXISTS network_post_shares (
      id         TEXT PRIMARY KEY NOT NULL,
      post_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_shares_post ON network_post_shares(post_id);`,
    `CREATE INDEX IF NOT EXISTS idx_network_post_shares_user ON network_post_shares(user_id);`,
    /* migration 0118 bookkeeping — the marker + undo journal for the one-time
     * legacy scope backfill. SCHEMA ONLY here: the backfill itself is
     * deliberately NOT replicated into this boot-time self-heal, because
     * applyInlineMigrations runs on every process start (including every
     * :memory: test worker) and must never mutate row data. The backfill
     * belongs to the migration runner, which runs once per deploy. */
    `CREATE TABLE IF NOT EXISTS migration_backfill_markers (
      marker        TEXT PRIMARY KEY NOT NULL,
      applied_at    TEXT NOT NULL,
      rows_affected INTEGER,
      notes         TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS network_post_scope_backfill (
      post_id          TEXT NOT NULL,
      migration_id     TEXT NOT NULL,
      prior_scope      TEXT,
      prior_company_id TEXT,
      prior_chapter_id TEXT,
      new_scope        TEXT NOT NULL,
      backfilled_at    TEXT NOT NULL,
      PRIMARY KEY (post_id, migration_id)
    );`,
    /* w-collective Wave 2 Stage B — durable drain for the two 500-item comms
     * ring buffers in server/commsStore.ts. `appendAudit` builds a
     * hash-chained envelope (prev_hash → hash) and `emitOutbox` carries that
     * chain on every event; both buffers used to `splice()` their oldest
     * entries away at 500, so a burst silently amputated the head of a
     * forensic chain. The drain persists the overflow HERE before evicting.
     *
     * Deliberately NOT `audit_log`: that table is walked as ONE global chain by
     * server/lib/auditChainVerifier.ts (CATALOG entry "audit_log", linkage
     * check at auditChainVerifier.ts:588), so interleaving a second
     * independently-seeded chain into it would make the verifier report a
     * break. Deliberately NOT `telemetry_events` either: that feeds the admin
     * activity feed and KPI counters (server/activityDeriver.ts:176,
     * server/adminPlatformStore.ts:1923), so comms rows would pollute a
     * user-visible surface.
     *
     * Self-heal only, no migration file (same precedent as telemetry_events
     * above, which has no file in migrations/ either). Stage B is under a
     * no-new-migrations rule and this runs on every connection open. */
    `CREATE TABLE IF NOT EXISTS comms_audit_log (
      id           TEXT PRIMARY KEY NOT NULL,
      ts           TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      actor_id     TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      prev_hash    TEXT NOT NULL,
      hash         TEXT NOT NULL,
      drained_at   TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_comms_audit_log_ts ON comms_audit_log(ts);`,
    `CREATE TABLE IF NOT EXISTS comms_outbox_events (
      event_id         TEXT PRIMARY KEY NOT NULL,
      event_type       TEXT NOT NULL,
      occurred_at      TEXT NOT NULL,
      actor_user_id    TEXT NOT NULL,
      actor_ip         TEXT,
      actor_user_agent TEXT,
      payload_json     TEXT NOT NULL,
      prior_hash       TEXT NOT NULL,
      hash             TEXT NOT NULL,
      schema_version   TEXT NOT NULL,
      drained_at       TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_comms_outbox_events_occurred ON comms_outbox_events(occurred_at);`,
    /* v25.21 Lane D NC-001 fix — durable key-value store for cross-product
     * inbound bridge state (DSC scores, M&A intelligence, KYC decisions,
     * membership renewals, etc.). Defined in shared/schema.ts as
     * `syncInboxState` since Sprint 29 KL-03 but never created on the
     * SQLite side, so the durableMap helper's write-through was a no-op.
     * Now created on boot so cross-product state survives restart. */
    `CREATE TABLE IF NOT EXISTS sync_inbox_state (
      key         TEXT PRIMARY KEY NOT NULL,
      value_json  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );`,
    /* v25.31.1 — durable per-entity drift snapshot store. Replaces the
     * process-local Maps in driftDetector.ts for read paths. Each row is a
     * point-in-time snapshot of (entity, aggregate, local payload, last
     * acked payload) so the /api/admin/sync/drift endpoint can compute drift
     * deterministically across PM2 reloads. Source-of-truth rule (Ozan,
     * 19-Jun): no process-local state. */
    `CREATE TABLE IF NOT EXISTS sync_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       TEXT NOT NULL DEFAULT '_global',
      entity_key      TEXT NOT NULL,
      aggregate_id    TEXT NOT NULL,
      local_json      TEXT,
      acked_json      TEXT,
      last_synced_at  TEXT,
      updated_at      TEXT NOT NULL,
      UNIQUE (tenant_id, entity_key, aggregate_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_entity ON sync_snapshots(entity_key);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_updated ON sync_snapshots(updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_tenant ON sync_snapshots(tenant_id);`,
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

