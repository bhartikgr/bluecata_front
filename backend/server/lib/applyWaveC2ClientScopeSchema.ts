// server/lib/applyWaveC2ClientScopeSchema.ts
// Wave C-2.g v26.6.0 — Self-heal for migration 0134
// (partner_crm_contact_client_scope join table).
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on
// unknown errors (never rethrow — boot must not die). Mirrors the shape of
// the 0130 predecessor, applyWaveC2AuthorityArtifactsSchema.
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341). Registered AFTER applyWaveC2PartnerAttributionsScopeSchema
// (dependency: partner_attributions must exist so this table's FK to
// partner_attributions.id resolves at CREATE TABLE time) per spec §2/0134's
// stated dependency on 0129.
//
// SPEC ANCHORS: §2 (migration 0134 row), §13.2 (D2, full DDL), §14.4 (E3).
//
// R2 FIX (Opus r1 MAJOR M-g2 / root fix 5): this file's header path and
// import corrected. It previously claimed to live at
// server/db/schemaHeals/applyWaveC2ClientScopeSchema.ts (a directory that
// does not exist in the real tree) and imported `{ log } from
// "../lib/logger"`, which from that claimed path resolves to the nonexistent
// server/db/lib/logger — a compile error. Relocated to server/lib/ (sibling
// of server/lib/logger.ts) to match the b-f R2 convention (0129-0133 all
// now declare server/lib/applyWaveC2*.ts on line 1 and import `./logger`).
// R2 FIX (Opus r1 MAJOR M-g1): created_at gained a DEFAULT expression in the
// CREATE TABLE body below — see 0134_wave_c2_partner_crm_contact_client_scope.sql
// header for the full rationale (a spec-§13.2-shaped 5-column INSERT, which
// is exactly what §14.4's promotion-upsert issues, previously failed with
// "NOT NULL constraint failed: partner_crm_contact_client_scope.created_at").
// R2 FIX (Opus r1 MINOR m-g1): the two-parent sqlite_master guard below now
// logs a warning on the skip path (previously silently returned), so a
// mis-ordered registration is observable rather than silent.
// R2 FIX (Opus r1 MINOR m-g2): dropped idx_pccs_contact — fully redundant
// with the implicit index behind UNIQUE(partner_crm_contact_id,
// partner_attribution_id) under SQLite's leftmost-prefix rule.

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Creates partner_crm_contact_client_scope (if missing). Idempotent under
 * re-run; safe as a first-boot heal or as a post-migration verification pass.
 *
 * Guard rationale (sqlite_master-checked against BOTH FK parents, not just
 * one): partner_crm_contacts is a pre-C-2 platform table that is always
 * present by the time any C-2 self-heal runs, but partner_attributions is
 * gated behind 0129 landing first in a fresh-boot sequence — the same
 * fresh-boot ordering hazard V33-F1/V33-F6f names explicitly for the rest of
 * the migration sequence. This function checks for both parents before
 * attempting the CREATE, exactly like the 0130 predecessor's single-parent
 * guard, extended to two parents since this table has two live FK targets.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 */
export function applyWaveC2ClientScopeSchema(db: DbLike): void {
  try {
    // Guard: if either FK parent does not yet exist (fresh boot, zero
    // migrations run yet), silently no-op — the FK targets do not yet exist
    // and CREATE TABLE would fail outright under foreign_keys=ON semantics
    // for a REFERENCES clause naming a genuinely-absent table.
    const crmContactsParent = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_crm_contacts'`
    ).get() as { name: string } | undefined;
    const attributionsParent = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_attributions'`
    ).get() as { name: string } | undefined;
    if (!crmContactsParent || !attributionsParent) {
      log.warn(
        "[wave-c2-client-scope] self-heal skipped: missing FK parent(s)",
        { partner_crm_contacts: !!crmContactsParent, partner_attributions: !!attributionsParent }
      );
      return;
    }

    // Create partner_crm_contact_client_scope if it doesn't exist.
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_crm_contact_client_scope'`
    ).get() as { name: string } | undefined;

    if (!tableExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS partner_crm_contact_client_scope (
          id                       TEXT PRIMARY KEY NOT NULL,
          partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
          partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
          scoped_by_user_id        TEXT NOT NULL REFERENCES users(id),
          scoped_at                TEXT NOT NULL,
          created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          created_by               TEXT,
          UNIQUE (partner_crm_contact_id, partner_attribution_id)
        );
      `);
    }

    // Index is its own IF NOT EXISTS statement — safe to run every boot
    // regardless of whether the table was just created or already existed
    // (mirrors the 0130 predecessor's unconditional trailing CREATE INDEX
    // IF NOT EXISTS calls). idx_pccs_contact removed (R2 fix, MINOR m-g2 —
    // fully redundant with the implicit index behind
    // UNIQUE(partner_crm_contact_id, partner_attribution_id)).
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pccs_attribution
        ON partner_crm_contact_client_scope(partner_attribution_id);
    `);
  } catch (err) {
    log.warn("[wave-c2-client-scope] self-heal skipped:", (err as Error).message);
  }
}
