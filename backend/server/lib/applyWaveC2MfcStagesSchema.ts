// server/db/connection.ts — new self-heal function for Wave C-2 migration 0128
// Follows the applyWaveCFdPreMoneySharesSchema precedent at connection.ts:875:
//   - sqlite_master-guarded (checks for the parent table before DDL)
//   - try/catch swallowing "already exists"/"no such table" errors
//   - idempotent under re-run (uses CREATE TABLE IF NOT EXISTS)
//   - safely no-ops on a fresh boot before migration runs
//   - safely no-ops on a boot after migration has already run
//   - V33-1-B1 pattern: any OTHER error is logged via log.warn and swallowed,
//     never rethrown — an unexpected error here must not take down the
//     entire DB layer, since applyInlineMigrations runs synchronously on the
//     very first DB access (getDb() -> hydrateAllStores() -> ... -> rawDb()).
//
// This function must be registered inside applyInlineMigrations(db)
// immediately after applyWaveCFdPreMoneySharesSchema(db) (connection.ts:306),
// and — per MAJOR-2 (round-1 review) — BEFORE the three trigger self-heal
// installers (applyWaveC2MfEngagementSchema / …SoftCircleSchema /
// …PipelineSchema), each of which early-returns unless mfc_stages already
// exists. See connection_ts_patch.md in this directory for the exact patch,
// including the required buildProductionTableStatements entries
// (connection.ts:2703) that structurally guarantee this ordering on every
// boot (productionStmts execute at connection.ts:193, ahead of ALL self-heal
// calls).
//
// ROUND-1 FIXES applied to this file (Opus + GPT-5.6 + Gemini triple review):
//   BLOCK-2: dropped `REFERENCES users(id)` from actor_user_id — see the SQL
//     migration's header comment for the full rationale (no `users` row with
//     id='system' exists or is seeded anywhere in the tree; the tree-wide
//     convention for non-human actors is the free-text literal "system").
//   MAJOR-1: mfc_stages DDL is schema-only and untouched by the LAPSED fix
//     (that's a seed-data change, confined to the migration file) — nothing
//     to change here for MAJOR-1 beyond staying byte/shape-equivalent with
//     the migration's CREATE TABLE bodies.
//   MAJOR-4: added idx_mfc_stage_transitions_to_stage /
//     idx_mfc_stage_transitions_from_stage so the self-heal path produces the
//     same indexes as the migration (DDL-equivalence).
//   MAJOR-5: catch block now does `log.warn(...)` + continue instead of
//     rethrowing on unrecognized errors, matching the V33-1-B1 canonical
//     pattern. Added the `log` import.
//   MINOR-2: dropped idx_mfc_stages_partner_type (redundant left-prefix of
//     the automatic index backing UNIQUE (partner_id, stage_machine_type,
//     key)) to stay DDL-equivalent with the migration.

// D1-02 (integration): this module now lives at server/lib/applyWaveC2MfcStagesSchema.ts
// (it was drafted to be inlined into server/db/connection.ts). Two mechanical
// relocation fixes, per connection_ts_INTEGRATED.diff.md hunk 1's note:
//   1. `log` is imported from "./logger" (sibling in server/lib/), not
//      "../lib/logger" (which from server/lib/ would resolve to the
//      nonexistent server/lib/lib/logger).
//   2. `applyWaveC2MfcStagesSchema` is `export`ed so connection.ts can import
//      it as `from "../lib/applyWaveC2MfcStagesSchema"`.
// The function body below is otherwise byte-preserved.
import { log } from "./logger";

export function applyWaveC2MfcStagesSchema(db: any) {
  try {
    // Guard: partner_organizations must exist for the FK to compile.
    // On a fresh DB, partner_organizations is created by the same
    // buildProductionTableStatements chain applyInlineMigrations invokes,
    // but check anyway to make this function safe under all boot orderings.
    const parentTableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='partner_organizations'"
    ).get();
    if (!parentTableExists) {
      // Extremely unlikely on any real boot, but silent-no-op is safer
      // than throwing.
      return;
    }

    // CREATE TABLE IF NOT EXISTS is safe under all boot orderings.
    // Idempotent by construction — re-running against an existing table is a no-op.
    db.exec(`CREATE TABLE IF NOT EXISTS mfc_stages (
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
    )`);

    db.exec("CREATE INDEX IF NOT EXISTS idx_mfc_stages_terminal ON mfc_stages(is_terminal)");
    // idx_mfc_stages_partner_type intentionally NOT created (MINOR-2 fix,
    // round 1) — redundant left-prefix of the automatic UNIQUE index.

    db.exec(`CREATE TABLE IF NOT EXISTS mfc_stage_transitions (
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
    )`);

    db.exec("CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_subject_created ON mfc_stage_transitions(subject_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_partner_type    ON mfc_stage_transitions(partner_id, stage_machine_type)");
    // MAJOR-4 fix (round 1): keep self-heal DDL-equivalent with the migration.
    db.exec("CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_to_stage   ON mfc_stage_transitions(to_stage_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_from_stage ON mfc_stage_transitions(from_stage_id) WHERE from_stage_id IS NOT NULL");

    // Note: SEED rows live in migration 0128_wave_c2_mfc_stages.sql, NOT here.
    // Self-heal functions add SCHEMA, not DATA. Seeding via self-heal would
    // race with the migration runner and duplicate rows on every boot.
    // This function is safe to re-run because CREATE TABLE IF NOT EXISTS is
    // a no-op; the seed step is idempotent for a DIFFERENT reason (the
    // migration runner tracks completion) and lives in the migration file.
  } catch (err: any) {
    // MAJOR-5 fix (round 1): V33-1-B1 canonical pattern — log and continue,
    // never rethrow. An unexpected error here must not kill the entire DB
    // layer's boot path (applyInlineMigrations runs synchronously from the
    // very first DB access). Idempotent-error cases ("already exists",
    // "no such table") and genuinely unexpected errors are both handled the
    // same way: log and move on.
    log.warn("[wave-c2-mfc-stages] self-heal skipped:", (err as Error).message);
  }
}
