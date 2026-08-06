// server/lib/applyWaveC2ClassificationRequestsSchema.ts
// Wave C-2 v26.6.0 — Self-heal for migration 0137 (mfc_classification_requests
// table). Live-blocker fix §8.2(b): unblocks CAPABILITY_UNCLASSIFIED partners.
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on
// unknown errors (never rethrow — boot must not die). Mirrors the
// applyWaveC2AuthorityArtifactsSchema (0130) and applyWaveCFdPreMoneySharesSchema
// (0127, connection.ts:875) precedents already live in this tree.
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341). No dependency on any other Wave C-2 migration (spec §2.2's
// 0137 row: "Depends on: none") — the only FK targets, `partner_organizations`
// and `users`, are pre-existing platform tables (connection.ts:4159, :2716),
// present on every boot before any Wave C-2 self-heal runs.
//
// R2 FIX (Opus r1 MAJOR M-i1 / SHARED-B1 item 4): this file's header path and
// import corrected. It previously claimed to live at
// server/db/schemaHeals/applyWaveC2ClassificationRequestsSchema.ts (a
// directory that does not exist in the real tree) and imported `{ log }
// from "../lib/logger"`, an unreachable path from that claimed location.
// Relocated to server/lib/ (sibling of server/lib/logger.ts), matching the
// b-f/g/h R2 convention exactly.
// R2 FIX (Opus r1 MINOR m-i1): spec citations that were actually LINE
// numbers ("§3198", "§3200") mis-labeled as section numbers are corrected
// throughout this file, the migration .sql, and ASSUMPTIONS_C2I.md to their
// real section numbers, §8.2 and §16.1 respectively.

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Creates mfc_classification_requests (if missing) + its supporting indexes,
 * including the load-bearing partial unique index that enforces "at most one
 * PENDING request per partner" (the sole anti-spam mechanism per spec §8.2 —
 * there is no rate limiter on the request-classification route today).
 *
 * Idempotent under re-run; safe as a first-boot heal or as a post-migration
 * verification pass. V33-1-B1: catches all errors, log.warn-and-continue.
 * Never throws.
 */
export function applyWaveC2ClassificationRequestsSchema(db: DbLike): void {
  try {
    // Guard: both FK targets (partner_organizations, users) are pre-existing
    // platform tables that should always exist by the time any Wave C-2
    // self-heal runs. If either is somehow missing (e.g. a stripped-down test
    // harness), silently no-op rather than create a table whose FK targets
    // cannot resolve.
    const partnerOrgsExist = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_organizations'`
    ).get() as { name: string } | undefined;
    const usersExist = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='users'`
    ).get() as { name: string } | undefined;
    if (!partnerOrgsExist || !usersExist) {
      return;
    }

    // Create mfc_classification_requests if it doesn't exist.
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mfc_classification_requests'`
    ).get() as { name: string } | undefined;

    if (!tableExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mfc_classification_requests (
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
        );
      `);
    }

    // Indexes are asserted unconditionally on every call (CREATE ... IF NOT
    // EXISTS is inherently idempotent) — mirrors the 0130 self-heal precedent
    // of re-asserting index shape even when the table already existed, so a
    // partially-applied prior boot (table created, index step interrupted)
    // still converges to the full shape on the next boot.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mfc_classification_requests_pending
        ON mfc_classification_requests(partner_id)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_status_created
        ON mfc_classification_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_partner
        ON mfc_classification_requests(partner_id);
    `);
  } catch (err) {
    log.warn(
      "[wave-c2-classification-requests] self-heal skipped:",
      (err as Error).message
    );
  }
}
