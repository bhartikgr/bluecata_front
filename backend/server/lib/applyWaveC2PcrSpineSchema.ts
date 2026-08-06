// server/lib/applyWaveC2PcrSpineSchema.ts
// Wave C-2.h v3.3.5 — Self-heal for migration 0136 (`partner_company_relationship`
// spine + `pcr_surface_presence` join table + `pcr_id` columns on all four
// real PCR surfaces).
//
// V33-1-B1 pattern: sqlite_master/PRAGMA-guarded, idempotent, log.warn-and-
// continue on any unexpected error — NEVER rethrows and kills boot. Mirrors
// `applyWaveC2MfcStagesSchema` (0128) for table creation and
// `applyWaveC2ProvenanceColumnsSchema` (0133) for additive-column coverage.
//
// SCOPE, STATED EXPLICITLY (mirrors the 0131 precedent's own header note that
// "self-heal only ever ADDs columns, never rebuilds"): this function creates
// the two new tables and adds the four `pcr_id` columns if missing. It does
// **NOT** run the backfill (spine seeding, pcr_id population, presence-row
// writes) — the backfill is a one-time numbered-migration step (0136's own
// `.sql` file), exactly like 0132's KV-to-SQL backfill is a guarded
// TypeScript boot step distinct from its schema self-heal. Running a
// multi-surface, orphan-pre-flighted backfill on every boot would be
// wasteful (full-table scans across four surfaces on every process start)
// and would duplicate the numbered migration's own idempotent INSERT/UPDATE
// logic for no benefit — the self-heal's job is ONLY to guarantee the
// SCHEMA (tables + pcr_id columns) is present before any forward-write call
// site (`ensurePcr`/`attachSurfacePresence`/`detachSurfacePresence`, §3.3)
// executes, so those helpers are never deploy-order-fragile. This is the
// same division of labor V33-4-N2 established for 0133: self-heal covers
// schema-readiness; the numbered migration covers data.
//
// SURFACE-NAMING NOTE (restated from the .sql file's header, load-bearing
// here too): the four real PCR surface tables are `mf_engagement`,
// `partner_deal_pipeline`, `partner_attributions`, `partner_portfolio_company`
// — per §3.2's own `surface` CHECK values (`'mfc','pipeline','clients',
// 'portfolio'`) and §3.3's four named forward-write call sites. `soft_circles`
// is NOT one of these four (grep-verified: no `partner_id` column exists on
// `soft_circles` at all) and gets NO `pcr_id` column from this function.
//
// Runs at first `rawDb()` call via `applyInlineMigrations` (server/db/
// connection.ts approx :191-341). Registered AFTER `applyWaveC2MfcStagesSchema`
// (0128 — not a hard dependency of THIS function's own DDL, since
// `partner_organizations`/`companies` are pre-C-2 platform tables, but the
// registration order documented here mirrors §2.2's stated dependency chain:
// "0128-0134 (backfill reads all four surfaces)") and after
// `applyWaveC2PipelineSchema` (0132 — `partner_deal_pipeline`'s pcr_id ALTER
// target must itself already exist, which it always does as a pre-C-2
// platform table, but 0132's own additive columns on that table are a sibling
// concern worth sequencing after for review-diff clarity, not a hard runtime
// dependency).
//
// Fresh-boot ordering note (mirrors 0133's ASSUMPTIONS_C2F.md precedent):
// `mf_engagement` is created by `applyMfcrmSchema()` (mfcrmSchema.ts), NOT by
// connection.ts's own buildProductionTableStatements chain. On a fresh boot,
// `applyMfcrmSchema()` runs AFTER `applyInlineMigrations` in the documented
// synchronous chain (server/index.ts:143 -> hydrateAllStores() ->
// hydrateManagedFounderStore() -> applyMfcrmSchema() -> rawDb() -> getDb() ->
// applyInlineMigrations()). This function therefore guards the
// `mf_engagement` ALTER with its own `sqlite_master` existence check (not
// just a column-existence check) and silently skips that one ALTER if the
// table does not exist yet.
//
// R2 FIX (Opus r1 MAJOR M-h1): a previous version of this comment claimed
// the skipped ALTER "will be picked up on the NEXT call to this function...
// per the existing `getDb()` memoization pattern." That claim was FALSE and
// is retracted here. `getDb()`
// memoizes the returned `Database` handle, not re-invocation of
// `applyInlineMigrations`/this self-heal -- `applyInlineMigrations` (and
// therefore this function) runs exactly ONCE per process, at the first
// `rawDb()`/`getDb()` call, not on every subsequent call. If `mf_engagement`
// does not exist yet at that first call, this ALTER is skipped and is NOT
// retried later in the same boot -- the column genuinely stays absent for
// the remainder of that process's lifetime. The only real recovery path is
// a SUBSEQUENT process boot (a full restart), where `applyMfcrmSchema()`'s
// prior run has already created `mf_engagement` on disk before this
// self-heal's own next first-call fires. This is a materially weaker
// guarantee than the retracted claim implied, and is the reason BLOCKER 1
// (this same R2 pass, see header note and connection_ts_patch.md) closes
// the gap at its root instead: giving `mf_engagement` a guaranteed
// basic-shape entry in `buildProductionTableStatements` means this ALTER
// never needs a second-chance retry at all, on any boot.
//
// This is the identical shape of hazard 0133's self-heal documents for
// `round_invitations.engagement_id REFERENCES mf_engagement(id)` — see
// ASSUMPTIONS_C2H.md for the analogous discussion
// here (spine-table FK targets `partner_organizations(id)`/`companies(id)`,
// both of which ARE created by connection.ts's own
// buildProductionTableStatements chain and are therefore never absent, so
// the spine/presence CREATE TABLE statements themselves carry no such
// hazard — only the `mf_engagement.pcr_id` ALTER does).

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Creates `partner_company_relationship` + `pcr_surface_presence` (migration
 * 0136's two new tables) and adds the additive `pcr_id` column to each of
 * the four real PCR surface tables (`mf_engagement`, `partner_deal_pipeline`,
 * `partner_attributions`, `partner_portfolio_company`) if not already
 * present. Idempotent under re-run; safe as a first-boot heal or as a
 * post-migration verification pass. Does NOT run the backfill — see the
 * file-header "SCOPE" note above.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 */
export function applyWaveC2PcrSpineSchema(db: DbLike): void {
  try {
    // ─────────────────────────────────────────────────────────────────
    // Guard: partner_organizations + companies must exist for the spine's
    // own FKs to compile. Both are created by connection.ts's own
    // buildProductionTableStatements chain, so this is always true in
    // practice — checked anyway per the applyWaveC2MfcStagesSchema (0128)
    // precedent, for safety under every boot ordering.
    // ─────────────────────────────────────────────────────────────────
    const partnerOrgsExist = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='partner_organizations'`
    ).get();
    const companiesExist = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies'`
    ).get();
    if (!partnerOrgsExist || !companiesExist) {
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // partner_company_relationship — the spine (§3.2, verbatim)
    // ─────────────────────────────────────────────────────────────────
    db.exec(`CREATE TABLE IF NOT EXISTS partner_company_relationship (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL REFERENCES partner_organizations(id),
      company_id  TEXT NOT NULL REFERENCES companies(id),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (partner_id, company_id)
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pcr_partner ON partner_company_relationship(partner_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pcr_company ON partner_company_relationship(company_id)`);

    // ─────────────────────────────────────────────────────────────────
    // pcr_surface_presence — join table (§3.2, verbatim)
    // ─────────────────────────────────────────────────────────────────
    db.exec(`CREATE TABLE IF NOT EXISTS pcr_surface_presence (
      id          TEXT PRIMARY KEY NOT NULL,
      pcr_id      TEXT NOT NULL REFERENCES partner_company_relationship(id),
      surface     TEXT NOT NULL CHECK (surface IN ('mfc','pipeline','clients','portfolio')),
      row_id      TEXT NOT NULL,
      added_at    TEXT NOT NULL,
      removed_at  TEXT,
      UNIQUE (pcr_id, surface, row_id)
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_pcr ON pcr_surface_presence(pcr_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_row ON pcr_surface_presence(surface, row_id)`);

    // ─────────────────────────────────────────────────────────────────
    // pcr_id additive columns on the four real surfaces. Each is guarded
    // independently: (a) table-existence check (mf_engagement may not
    // exist yet on a fresh boot — see file header), (b) column-existence
    // check via PRAGMA table_info (V33-1-B1 pattern, so a second call this
    // same boot, or a later boot after the numbered migration has run, is
    // a clean no-op).
    // ─────────────────────────────────────────────────────────────────
    const surfaceAlters: Array<[table: string, indexName: string]> = [
      ["mf_engagement", "idx_mf_engagement_pcr"],
      ["partner_deal_pipeline", "idx_partner_deal_pipeline_pcr"],
      ["partner_attributions", "idx_partner_attributions_pcr"],
      ["partner_portfolio_company", "idx_partner_portfolio_company_pcr"],
    ];

    for (const [table, indexName] of surfaceAlters) {
      const tableExists = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);
      if (!tableExists) {
        // mf_engagement fresh-boot ordering hazard (see file header) — will
        // be picked up on the next rawDb() call later in the same boot
        // chain, or on a subsequent boot. Never throw.
        continue;
      }

      const cols = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      if (!cols.has("pcr_id")) {
        try {
          db.exec(
            `ALTER TABLE ${table} ADD COLUMN pcr_id TEXT REFERENCES partner_company_relationship(id)`
          );
        } catch (e: any) {
          if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
            throw e;
          }
        }
      }

      db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(pcr_id)`);
    }
  } catch (err) {
    log.warn("[wave-c2-pcr-spine] self-heal skipped:", (err as Error).message);
  }
}
