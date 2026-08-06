// server/lib/applyWaveC2ProvenanceColumnsSchema.ts
//
// R2 FIX (root fix 5, SHARED-B1 item 4): header path corrected from
// `server/db/schemaHeals/` (does not exist in the real tree) to `server/lib/`.
// `import { log } from "./logger";` below resolves correctly from that path
// (server/lib/logger.ts is a sibling file).
// Wave C-2.f v3.3.5 — Self-heal for migration 0133 (round_invitations 5
// delegated-agency provenance/principal columns + soft_circles LOCK-1 +
// V32-M6 columns).
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on
// unknown errors (never rethrow — boot must not die).
//
// V33-4-N2 (closes Opus r9 MIN-R9-2, spec-mandated, critical): this function
// MUST cover ALL of migration 0133's ALTERs — both the round_invitations
// 5-column extension AND the soft_circles 5-column extension — so the
// 25-column INSERT in §7.6 never targets an under-schema'd round_invitations
// even if the numbered migration 0133 has not yet been operator-invoked.
// The founder path (roundInvitationsStore.ts's createInvitation /
// createInvitationTx) is never deploy-order-fragile as a result.
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341). Registered AFTER applyWaveC2AuthorityArtifactsSchema
// (dependency: authority_artifacts already exists from 0130 — not required by
// THIS function's own FK targets, but the registration order documented here
// mirrors §2.2's stated dependency chain: 0130 [authority_artifacts already
// created there], 0129 [partner_attributions], track4Routes.ts module-load
// ALTER [source_type/source_id on soft_circles]).
//
// Fresh-boot ordering hazard (V33-F6, restated from §21/§4.1 so this file's
// own header carries the fact): `round_invitations` and `soft_circles` are
// both created by buildProductionTableStatements() in connection.ts and are
// therefore NEVER absent when applyInlineMigrations runs — but their FK
// target `mf_engagement` is created ONLY by applyMfcrmSchema() (mfcrmSchema.ts),
// which runs AFTER applyInlineMigrations on a fresh boot (server/index.ts:143
// -> hydrateAllStores() -> hydrateManagedFounderStore() -> applyMfcrmSchema()
// -> rawDb() -> getDb() -> applyInlineMigrations(), all synchronous, in that
// nesting order). SQLite does not validate a REFERENCES target's existence
// at ALTER TABLE ... ADD COLUMN time, so the `engagement_id` ALTER below
// always SUCCEEDS even before `mf_engagement` exists. **However (probe-
// verified, see ASSUMPTIONS_C2F.md)**: this app runs with
// `PRAGMA foreign_keys = ON` (connection.ts:125), and under that pragma
// SQLite validates that EVERY REFERENCES target table named anywhere in a
// table's schema exists at INSERT time for ANY insert into that table --
// even one binding NULL to the FK column. So there is a narrow window,
// between this self-heal adding `engagement_id` and `applyMfcrmSchema()`
// creating `mf_engagement` later in the SAME synchronous boot chain, during
// which ALL `round_invitations` inserts (including the founder path) fail
// with `no such table: main.mf_engagement`. The window is self-closing on
// the same boot and is not expected to be user-visible in practice (no
// request can reach the invitation-create handler before boot finishes),
// but it is a real, reproducible gap -- documented here rather than papered
// over. The column-existence guards below (not just table-existence guards)
// are required for the same reason V33-1-B1's trigger self-heals need them:
// `round_invitations`/`soft_circles` are stable tables across every boot,
// but their WAVE-C2-ADDED COLUMNS are not, until either this self-heal or
// the numbered migration 0133 has run.

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Adds migration 0133's 10 additive columns (5 on round_invitations, 5 on
 * soft_circles) plus their 3 supporting indexes, if not already present.
 * Idempotent under re-run; safe as a first-boot heal or as a post-migration
 * verification pass.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 * V33-4-N2: covers BOTH tables' ALTERs — this is the entire point of this
 * function's existence and is asserted directly by probe_0133_migration.py.
 */
export function applyWaveC2ProvenanceColumnsSchema(db: DbLike): void {
  try {
    // ─────────────────────────────────────────────────────────────────
    // round_invitations — 5 columns (V33-4-B5)
    // ─────────────────────────────────────────────────────────────────
    const roundInvitationsExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='round_invitations'`
    ).get() as { name: string } | undefined;

    if (roundInvitationsExists) {
      const riCols = new Set(
        (db.prepare(`PRAGMA table_info(round_invitations)`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      const riAlters: Array<[string, string]> = [
        ["sourced_from_partner_id",
          `ALTER TABLE round_invitations ADD COLUMN sourced_from_partner_id TEXT REFERENCES partner_organizations(id)`],
        ["sourced_from_partner_attribution_id",
          `ALTER TABLE round_invitations ADD COLUMN sourced_from_partner_attribution_id TEXT REFERENCES partner_attributions(id)`],
        ["acting_on_behalf_of_user_id",
          `ALTER TABLE round_invitations ADD COLUMN acting_on_behalf_of_user_id TEXT REFERENCES users(id)`],
        ["actor_partner_user_id",
          `ALTER TABLE round_invitations ADD COLUMN actor_partner_user_id TEXT REFERENCES users(id)`],
        // V33-4-B5: engagement_id, raised from 4 to 5 columns in v3.3.4.
        // R2 FIX (root fix 4, Opus BLOCKER B-f1 / Gemini BLOCK-1): dropped the
        // `REFERENCES mf_engagement(id)` clause — bare TEXT now, per the
        // V32-M8 precedent (partner_attributions.authority_artifact_id in
        // 0129). mf_engagement is created ONLY by applyMfcrmSchema(), which
        // runs AFTER applyInlineMigrations on a fresh boot; under
        // PRAGMA foreign_keys=ON a REFERENCES clause naming a not-yet-created
        // table breaks EVERY round_invitations INSERT (even binding NULL)
        // until mf_engagement exists — and permanently for any process/test
        // that never calls applyMfcrmSchema() at all (six such writers
        // grep-verified in the real tree per Opus r1 review). Application-
        // layer enforcement only, matching 0129's own carve-out.
        ["engagement_id",
          `ALTER TABLE round_invitations ADD COLUMN engagement_id TEXT`],
      ];

      for (const [colName, sql] of riAlters) {
        if (!riCols.has(colName)) {
          try {
            db.exec(sql + ";");
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_round_invitations_sourced_partner
          ON round_invitations(sourced_from_partner_id, sourced_from_partner_attribution_id)
          WHERE sourced_from_partner_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_round_invitations_engagement
          ON round_invitations(engagement_id)
          WHERE engagement_id IS NOT NULL;
      `);
    }

    // ─────────────────────────────────────────────────────────────────
    // soft_circles — 5 columns (LOCK 1 + V32-M6)
    // ─────────────────────────────────────────────────────────────────
    const softCirclesExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='soft_circles'`
    ).get() as { name: string } | undefined;

    if (softCirclesExists) {
      const scCols = new Set(
        (db.prepare(`PRAGMA table_info(soft_circles)`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      const scAlters: Array<[string, string]> = [
        ["sourced_from_partner_id",
          `ALTER TABLE soft_circles ADD COLUMN sourced_from_partner_id TEXT REFERENCES partner_organizations(id)`],
        ["sourced_from_partner_attribution_id",
          `ALTER TABLE soft_circles ADD COLUMN sourced_from_partner_attribution_id TEXT REFERENCES partner_attributions(id)`],
        ["partner_crm_contact_id",
          `ALTER TABLE soft_circles ADD COLUMN partner_crm_contact_id TEXT REFERENCES partner_crm_contacts(id)`],
        // No REFERENCES clause by design — §4.1's trigger-based substitute
        // polices this column against mfc_stages, not a DB-level FK.
        ["partner_workflow_stage_id",
          `ALTER TABLE soft_circles ADD COLUMN partner_workflow_stage_id TEXT`],
        // V32-M6: renamed from v3.1's non-executable `stage_machine_type`.
        ["current_stage_machine_type",
          `ALTER TABLE soft_circles ADD COLUMN current_stage_machine_type TEXT CHECK (current_stage_machine_type = 'mp_soft_circle')`],
      ];

      for (const [colName, sql] of scAlters) {
        if (!scCols.has(colName)) {
          try {
            db.exec(sql + ";");
          } catch (e: any) {
            if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
              throw e;
            }
          }
        }
      }

      // §14.3/V33-F6a: self-heal index, added to THIS function (not a new
      // one) since it indexes columns this function itself creates.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_soft_circles_sourced_partner
          ON soft_circles(sourced_from_partner_id, sourced_from_partner_attribution_id)
          WHERE sourced_from_partner_id IS NOT NULL;
      `);
    }
  } catch (err) {
    log.warn("[wave-c2-provenance-columns] self-heal skipped:", (err as Error).message);
  }
}
