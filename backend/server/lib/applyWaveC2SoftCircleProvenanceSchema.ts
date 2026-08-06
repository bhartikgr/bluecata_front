// server/lib/applyWaveC2SoftCircleProvenanceSchema.ts
//
// R2 FIX (root fix 5, SHARED-B1 item 4): header path corrected from
// `server/db/schemaHeals/` (does not exist in the real tree) to `server/lib/`.
// `import { log } from "./logger";` below resolves correctly from that path.
// Wave C-2.e v26.6.0 — Self-heal for migration 0132 (partner_deal_pipeline
// unification: additive columns + lock table + skip log).
//
// NAMING NOTE (see ASSUMPTIONS_C2E.md item A1 and the header comment in
// 0132_wave_c2_soft_circle_provenance.sql): this file is named
// applyWaveC2SoftCircleProvenanceSchema.ts per the task brief, but per the
// LOCKED spec's §2.2 migration table, the self-heal function BOUND TO
// migration 0132 is named `applyWaveC2PipelineSchema` (spec §2.2 row
// "0132" -> "Self-heal function" column: `applyWaveC2PipelineSchema`).
// `applyWaveC2SoftCircleSchema` is a DIFFERENT, already-spoken-for name in
// the spec (§2/0131's V33-F1 self-heal inventory: "three new self-heal
// functions ... applyWaveC2MfEngagementSchema(db), applyWaveC2SoftCircleSchema(db),
// applyWaveC2PipelineSchema(db)") that installs the mfc_stages trigger pair
// for soft_circles' OWN columns (owned by migration 0133, not 0132).
// To avoid a function-name collision with that already-spec'd function
// (the exact class of bug V32/V33's "NEW-MAJ-R6-2" finding closed for
// applyWaveC2MfEngagementSchema/applyWaveC2PipelineSchema — two different
// bodies under one name is not resolvable at the type level), this file's
// exported function keeps this task's requested filename but is internally
// implemented as, and re-exported under, the spec's real 0132 name:
//   export function applyWaveC2PipelineSchema(db) { ... }   // spec-correct name
//   export { applyWaveC2PipelineSchema as applyWaveC2SoftCircleProvenanceSchema };
// so callers using either name reach the identical, single implementation.
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on
// unknown errors (never rethrow — boot must not die).
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341). Depends on mfc_stages existing (migration 0128's seed) —
// current_stage_id's FK target.

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Adds partner_deal_pipeline's Wave C-2 additive columns (stage-machine
 * dual-column set + full canonical-field-preservation set), the
 * uq_partner_deal_pipeline_legacy_id partial unique index, the shared
 * c2_backfill_skip_log table, and the _c2_pipeline_backfill_lock marker
 * table — all guarded, all idempotent under re-run.
 *
 * Does NOT run the KV-to-SQL data backfill itself (see
 * runWaveC2PipelineKvBackfill, a separate guarded boot step per spec
 * §2.2/0132 — "guarded TypeScript boot step ... not raw SQL"). This
 * function is schema-only, matching every other applyWaveC2*Schema
 * function's scope in the tree.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 */
export function applyWaveC2PipelineSchema(db: DbLike): void {
  try {
    // Guard: if partner_deal_pipeline does not exist yet, silently no-op.
    // Ground truth (V33-F6f / re-verified this pass): partner_deal_pipeline
    // DOES pre-exist at connection.ts:3969 in buildProductionTableStatements
    // on every boot — but this guard is still required because
    // applyInlineMigrations can run before buildProductionTableStatements
    // has executed on a sufficiently early lazy rawDb() call, and because a
    // future refactor could change that ordering; the guard costs nothing
    // and removes the dependency on today's specific boot order.
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_deal_pipeline'`
    ).get() as { name: string } | undefined;
    if (!tableExists) {
      return;
    }

    const existingCols = new Set(
      (db.prepare(`PRAGMA table_info(partner_deal_pipeline)`).all() as Array<{ name: string }>)
        .map((r) => r.name)
    );

    // mfc_stages must exist before current_stage_id's REFERENCES clause can
    // resolve at ADD COLUMN time under foreign_keys=ON, per the same
    // discipline documented for 0130's authority_artifact_id FK guard.
    const mfcStagesExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mfc_stages'`
    ).get() as { name: string } | undefined;

    const addColumnIfMissing = (col: string, ddl: string) => {
      if (existingCols.has(col)) return;
      try {
        db.exec(ddl);
        existingCols.add(col);
      } catch (e: any) {
        if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
          throw e;
        }
      }
    };

    // Stage-machine dual-column set (§10.1 item 9). current_stage_id's FK
    // only added if mfc_stages exists; if not, the column still needs to
    // exist for later writers, so add it WITHOUT the REFERENCES clause as a
    // degraded fallback and let the numbered migration (which always runs
    // after 0128 per §2.2's declared dependency) supply the fully-FK'd
    // version. This mirrors 0129's permanently-bare-column precedent for
    // the analogous "referenced table doesn't exist yet" hazard.
    if (!existingCols.has("current_stage_id")) {
      if (mfcStagesExists) {
        addColumnIfMissing(
          "current_stage_id",
          `ALTER TABLE partner_deal_pipeline ADD COLUMN current_stage_id TEXT REFERENCES mfc_stages(id);`
        );
      } else {
        addColumnIfMissing(
          "current_stage_id",
          `ALTER TABLE partner_deal_pipeline ADD COLUMN current_stage_id TEXT;`
        );
      }
    }
    addColumnIfMissing(
      "current_stage_machine_type",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN current_stage_machine_type TEXT CHECK (current_stage_machine_type = 'partner_pipeline');`
    );
    addColumnIfMissing(
      "probability_pct_override",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN probability_pct_override INTEGER;`
    );
    addColumnIfMissing(
      "deal_size_usd",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN deal_size_usd REAL;`
    );
    addColumnIfMissing(
      "mapping_note",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN mapping_note TEXT;`
    );

    // Canonical-field-preservation set (§10.1's mapping table, V32-B5).
    addColumnIfMissing("deal_name", `ALTER TABLE partner_deal_pipeline ADD COLUMN deal_name TEXT;`);
    addColumnIfMissing("currency", `ALTER TABLE partner_deal_pipeline ADD COLUMN currency TEXT;`);
    addColumnIfMissing("sector", `ALTER TABLE partner_deal_pipeline ADD COLUMN sector TEXT;`);
    addColumnIfMissing("geography", `ALTER TABLE partner_deal_pipeline ADD COLUMN geography TEXT;`);
    addColumnIfMissing("kv_notes", `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_notes TEXT;`);
    addColumnIfMissing("kv_version", `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_version INTEGER;`);
    addColumnIfMissing("kv_updated_at", `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_updated_at TEXT;`);
    addColumnIfMissing("kv_updated_by", `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_updated_by TEXT;`);
    addColumnIfMissing("kv_is_seed", `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_is_seed INTEGER;`);
    addColumnIfMissing(
      "kv_prev_revision_hash",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_prev_revision_hash TEXT;`
    );
    addColumnIfMissing(
      "kv_revision_hash",
      `ALTER TABLE partner_deal_pipeline ADD COLUMN kv_revision_hash TEXT;`
    );

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_partner_deal_pipeline_current_stage
        ON partner_deal_pipeline(current_stage_id) WHERE current_stage_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_deal_pipeline_legacy_id
        ON partner_deal_pipeline(legacy_id) WHERE legacy_id IS NOT NULL;
    `);

    // Shared skip-log table (0129/0132/0136 all write here; CREATE TABLE IF
    // NOT EXISTS makes ownership order-independent).
    db.exec(`
      CREATE TABLE IF NOT EXISTS c2_backfill_skip_log (
        id            TEXT PRIMARY KEY NOT NULL,
        source_table  TEXT NOT NULL,
        source_id     TEXT NOT NULL,
        missing_fk    TEXT NOT NULL CHECK (missing_fk IN ('company_id','partner_id','legacy_id','duplicate_grain','none')),
        reason        TEXT NOT NULL,
        skipped_at    TEXT NOT NULL
      );
    `);

    // Backfill single-writer marker-row lock table (§10.1 item 11).
    db.exec(`
      CREATE TABLE IF NOT EXISTS _c2_pipeline_backfill_lock (
        id            TEXT PRIMARY KEY NOT NULL,
        started_at    TEXT NOT NULL,
        host          TEXT NOT NULL,
        completed_at  TEXT
      );
    `);
  } catch (err) {
    log.warn("[wave-c2-pipeline] self-heal skipped:", (err as Error).message);
  }
}

// Re-exported under the task-requested name so either import spelling
// resolves to the identical implementation (see header note — avoids a
// function-name collision with the spec's already-assigned
// applyWaveC2SoftCircleSchema, which belongs to migration 0133's trigger
// install, not this migration's column ALTERs).
export { applyWaveC2PipelineSchema as applyWaveC2SoftCircleProvenanceSchema };
