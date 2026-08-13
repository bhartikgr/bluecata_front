// server/lib/applyWaveC2MfEngagementSchema.ts
//
// R2 FIX (root fix 5, SHARED-B1 item 4): header path corrected from
// `server/db/schemaHeals/` (does not exist in the real tree) to `server/lib/`.
// `import { log } from "./logger";` below resolves correctly from that path.
// Wave C-2 v26.6.0 — Self-heal for migration 0131 (mf_engagement additive
// columns + mf_engagement_event LOCK-3-A additive columns).
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on
// unknown errors (never rethrow — boot must not die).
//
// SCOPE (per spec §2/0131's own function-inventory row): this self-heal
// function covers ONLY the column ADDs on `mf_engagement` and
// `mf_engagement_event` — "self-heal only ever ADDs columns, never rebuilds
// tables." The `mf_engagement_event` NULL-relaxation rebuild (relaxing
// engagement_id/company_id to nullable + the new CHECK) is a ONE-TIME
// numbered-migration step (0131_wave_c2_mf_engagement_columns.sql) and is
// intentionally NOT re-implemented here. Per §4.1 (V33-F1), this function
// ALSO owns installing the two `mf_engagement`-consumer stage-integrity
// triggers (TRG_MF_ENGAGEMENT_INSERT / TRG_MF_ENGAGEMENT_UPDATE) once their
// prerequisite columns exist — trigger bodies are out of scope for THIS
// migration's deliverable (0131 itself carries no trigger DDL, per §2/0131)
// and are deliberately NOT duplicated here; this wrapper's job is the two
// tables' additive columns only, matching the C-2.c precedent's scope
// (`applyWaveC2AuthorityArtifactsSchema` also only does column/table ADDs,
// no trigger DDL).
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341), following the existing `applyWaveCFdPreMoneySharesSchema`
// call pattern (defined :875, invoked :306). `mf_engagement` and
// `mf_engagement_event` are created by `server/lib/mfcrmSchema.ts`
// (`applyMfcrmSchema()`), NOT by connection.ts (grep-verified: `grep -c
// "CREATE TABLE IF NOT EXISTS mf_engagement" server/db/connection.ts` = 0) —
// so this function is NOT guaranteed either table exists on a fresh,
// zero-migrations-run boot, since `applyInlineMigrations` runs BEFORE
// `applyMfcrmSchema()` in the boot sequence (§1/§21 fresh-boot ordering
// hazard, V33-F6). The guard clauses below make a fresh boot a no-op rather
// than a crash, mirroring the V33-1-B1 discipline already used across every
// other Wave C-2 self-heal function.

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Adds mf_engagement's five additive columns (founder_revoked_at,
 * founder_revoked_by, archived_at, owner_user_id, current_stage_id,
 * current_stage_machine_type) and mf_engagement_event's five additive
 * columns (actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
 * partner_attribution_id, event_data_json) if not already present.
 * Idempotent under re-run; safe as a first-boot heal or as a
 * post-migration verification pass.
 *
 * Does NOT perform the mf_engagement_event NULL-relaxation rebuild — that
 * is a one-time step owned exclusively by
 * 0131_wave_c2_mf_engagement_columns.sql (§2/0131: self-heal never rebuilds
 * tables). If this function runs BEFORE the numbered migration has applied,
 * it simply adds these columns onto the pre-rebuild (NOT NULL
 * engagement_id/company_id) shape of mf_engagement_event, which is a valid,
 * harmless intermediate state — the columns being added here are unrelated
 * to the nullability of engagement_id/company_id.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 */
export function applyWaveC2MfEngagementSchema(db: DbLike): void {
  try {
    // --- mf_engagement additive columns ---
    const mfEngagementExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mf_engagement'`
    ).get() as { name: string } | undefined;

    if (mfEngagementExists) {
      const engagementCols = new Set(
        (db.prepare(`PRAGMA table_info(mf_engagement)`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      const engagementAdds: Array<[string, string]> = [
        ["founder_revoked_at", `ALTER TABLE mf_engagement ADD COLUMN founder_revoked_at TEXT;`],
        ["founder_revoked_by", `ALTER TABLE mf_engagement ADD COLUMN founder_revoked_by TEXT;`],
        ["archived_at", `ALTER TABLE mf_engagement ADD COLUMN archived_at TEXT;`],
        ["owner_user_id", `ALTER TABLE mf_engagement ADD COLUMN owner_user_id TEXT REFERENCES users(id);`],
        // current_stage_id's FK target (mfc_stages) must exist first (migration
        // 0128); guarded separately below so a fresh boot without 0128 applied
        // still heals the other four columns.
      ];

      for (const [col, ddl] of engagementAdds) {
        if (!engagementCols.has(col)) {
          try {
            db.exec(ddl);
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }
      }

      // current_stage_id / current_stage_machine_type: only add once
      // mfc_stages exists (migration 0128's FK target). On a boot where 0128
      // has not yet run, silently skip these two — the next self-heal pass
      // (post-migrate, or next boot) picks them up.
      const mfcStagesExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='mfc_stages'`
      ).get() as { name: string } | undefined;

      if (mfcStagesExists) {
        const refreshedCols = new Set(
          (db.prepare(`PRAGMA table_info(mf_engagement)`).all() as Array<{ name: string }>)
            .map((r) => r.name)
        );

        if (!refreshedCols.has("current_stage_id")) {
          try {
            db.exec(`ALTER TABLE mf_engagement ADD COLUMN current_stage_id TEXT REFERENCES mfc_stages(id);`);
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }

        if (!refreshedCols.has("current_stage_machine_type")) {
          try {
            db.exec(
              `ALTER TABLE mf_engagement ADD COLUMN current_stage_machine_type TEXT CHECK (current_stage_machine_type = 'mfc_engagement');`
            );
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }
      }
    }

    // --- mf_engagement_event additive columns (LOCK 3-A, five columns) ---
    const mfEngagementEventExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mf_engagement_event'`
    ).get() as { name: string } | undefined;

    if (mfEngagementEventExists) {
      const eventCols = new Set(
        (db.prepare(`PRAGMA table_info(mf_engagement_event)`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      const eventAdds: Array<[string, string]> = [
        [
          "actor_role",
          `ALTER TABLE mf_engagement_event ADD COLUMN actor_role TEXT CHECK (actor_role IN ('founder','partner','admin','system'));`,
        ],
        [
          "actor_partner_user_id",
          `ALTER TABLE mf_engagement_event ADD COLUMN actor_partner_user_id TEXT REFERENCES users(id);`,
        ],
        [
          "acting_on_behalf_of_user_id",
          `ALTER TABLE mf_engagement_event ADD COLUMN acting_on_behalf_of_user_id TEXT REFERENCES users(id);`,
        ],
        [
          "partner_attribution_id",
          `ALTER TABLE mf_engagement_event ADD COLUMN partner_attribution_id TEXT REFERENCES partner_attributions(id);`,
        ],
        ["event_data_json", `ALTER TABLE mf_engagement_event ADD COLUMN event_data_json TEXT;`],

        // ── WAVE 38 · FINAL GATE RUN — the ledger primitives 0183 added. ──
        // Row 4's migration rebuilt `mf_engagement_event` to the canonical
        // Wave 0 event shape and `managedFounderStore.recordEvent` now writes
        // `actor_id` and `seq`. But TWO OTHER PLACES create this table with
        // the pre-0183 8-column shape: `server/db/connection.ts` (SACRED —
        // read, never edit) and `server/lib/mfcrmSchema.ts`, both with
        // CREATE TABLE IF NOT EXISTS. On any database that never runs
        // `migrations/` — i.e. every test fixture, and any dev DB where
        // connection.ts's DDL block wins the race — the writer therefore hit
        // `table mf_engagement_event has no column named actor_id` and every
        // engagement write failed fail-closed (STRICT_PERSIST_FAILED). The
        // full-suite gate run caught it in mfcrm_gates / mfcrm_isolation /
        // mfcrm_moneypath / mfcrm_persona; it was NOT caught by the row-4
        // schema test, which asserts against a migrated database only.
        // This is the correct home for the repair: connection.ts is sacred,
        // and this function is already the additive self-heal that
        // connection.ts:503 calls immediately after its own DDL block. On a
        // 0183-migrated database every column below already exists and each
        // ALTER is skipped.
        //
        // The DEFAULTs exist ONLY because SQLite forbids adding a NOT NULL
        // column without one to a table that may already hold rows; they are
        // the same values 0183's backfill uses ('system', 1). No caller relies
        // on them — `recordEvent` always supplies both explicitly, and the
        // seq it supplies is the real per-parent MAX(seq)+1.
        ["actor_id", `ALTER TABLE mf_engagement_event ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'system';`],
        ["request_id", `ALTER TABLE mf_engagement_event ADD COLUMN request_id TEXT;`],
        ["idempotency_key", `ALTER TABLE mf_engagement_event ADD COLUMN idempotency_key TEXT;`],
        ["source_event_type", `ALTER TABLE mf_engagement_event ADD COLUMN source_event_type TEXT;`],
        ["source_event_id", `ALTER TABLE mf_engagement_event ADD COLUMN source_event_id TEXT;`],
        ["reverses_id", `ALTER TABLE mf_engagement_event ADD COLUMN reverses_id TEXT;`],
        ["seq", `ALTER TABLE mf_engagement_event ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;`],
        ["deleted_at", `ALTER TABLE mf_engagement_event ADD COLUMN deleted_at TEXT;`],
      ];

      for (const [col, ddl] of eventAdds) {
        if (!eventCols.has(col)) {
          try {
            db.exec(ddl);
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }
      }
    }

    // NOTE: the mf_engagement_event NULL-relaxation rebuild (engagement_id /
    // company_id -> nullable, + CHECK (engagement_id IS NOT NULL OR
    // partner_attribution_id IS NOT NULL)) is intentionally NOT performed
    // here. It is a one-time table rebuild owned exclusively by
    // 0131_wave_c2_mf_engagement_columns.sql, run via the operator-invoked
    // `npm run db:migrate` step — self-heal functions only ever ADD columns,
    // never rebuild tables (§2/0131).
  } catch (err) {
    log.warn("[wave-c2-mf-engagement] self-heal skipped:", (err as Error).message);
  }
}
