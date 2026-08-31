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
          scoped_by_user_id        TEXT NOT NULL,
          scoped_at                TEXT NOT NULL,
          created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          created_by               TEXT,
          UNIQUE (partner_crm_contact_id, partner_attribution_id)
        );
      `);
    } else {
      /* ══════════════════════════════════════════════════════════════════
         WAVE 178 · ITEM B — CONVERGE A DATABASE THAT STILL CARRIES 0134's
         `scoped_by_user_id ... REFERENCES users(id)`.

         That FK is the proved cause of a 100%-failing "Add to client" button:
         with `PRAGMA foreign_keys = ON` (connection.ts:160) an acting partner
         whose session userId has no `users` row makes the INSERT raise
         `FOREIGN KEY constraint failed`, which the store rethrows and the route
         turns into a bare 500. Migration 0213 rebuilds the table — but this heal
         exists because the heal is the only path that runs on EVERY boot.

         IT IS ALSO LOAD-BEARING FOR A REASON THAT CANNOT BE FIXED ELSEWHERE:
         `server/db/connection.ts` is SACRED (frozen hash, WAVE50) and its inline
         baseline at :4782-4791 still creates this table WITH the users FK. That
         statement cannot be edited. Ordering is what saves it — this heal is
         called at connection.ts:524, EARLIER in `applyInlineMigrations` than the
         baseline array at :4782, and both are `CREATE TABLE IF NOT EXISTS`. So on
         a fresh database the corrected CREATE above wins and the sacred baseline's
         statement is a no-op; on a database that already has the legacy shape,
         the rebuild below converges it.

         Same V33-1-B1 contract as the rest of this file: guarded, idempotent, and
         it never throws — the outer catch keeps boot alive.
         ══════════════════════════════════════════════════════════════════ */
      const declared = db.prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_crm_contact_client_scope'`
      ).get() as { sql?: string } | undefined;
      const ddl = String(declared?.sql ?? "");
      /* Match only the actor column's reference. `partner_crm_contact_id` and
         `partner_attribution_id` also carry REFERENCES clauses and must be left
         exactly as they are, so the test is anchored on scoped_by_user_id. */
      const hasLegacyActorFk = /scoped_by_user_id[^,]*REFERENCES\s+users\s*\(/i.test(ddl);
      if (hasLegacyActorFk) {
        log.warn(
          "[wave-c2-client-scope] legacy actor FK detected on partner_crm_contact_client_scope " +
          "(scoped_by_user_id REFERENCES users(id)); rebuilding without it — wave 178 item B"
        );
        db.exec(`
          DROP TABLE IF EXISTS partner_crm_contact_client_scope_w178_new;
          CREATE TABLE partner_crm_contact_client_scope_w178_new (
            id                       TEXT PRIMARY KEY NOT NULL,
            partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
            partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
            scoped_by_user_id        TEXT NOT NULL,
            scoped_at                TEXT NOT NULL,
            created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            created_by               TEXT,
            UNIQUE (partner_crm_contact_id, partner_attribution_id)
          );
          INSERT INTO partner_crm_contact_client_scope_w178_new
            (id, partner_crm_contact_id, partner_attribution_id, scoped_by_user_id,
             scoped_at, created_at, created_by)
          SELECT
             id, partner_crm_contact_id, partner_attribution_id, scoped_by_user_id,
             scoped_at, created_at, created_by
          FROM partner_crm_contact_client_scope;
          DROP TABLE partner_crm_contact_client_scope;
          PRAGMA legacy_alter_table = ON;
          ALTER TABLE partner_crm_contact_client_scope_w178_new
            RENAME TO partner_crm_contact_client_scope;
          PRAGMA legacy_alter_table = OFF;
        `);
      }
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
