// server/lib/applyWaveC2AuthorityArtifactsSchema.ts
//
// R2 FIX (root fix 5, SHARED-B1 item 4): header path corrected from
// `server/db/schemaHeals/` (does not exist in the real tree) to `server/lib/`.
// `import { log } from "./logger";` below resolves correctly from that path.
// Wave C-2 v26.6.0 — Self-heal for migration 0130 (authority_artifacts table +
// mf_engagement additive columns).
//
// V33-1-B1 pattern: PRAGMA-guarded, idempotent, log.warn-and-continue on unknown
// errors (never rethrow — boot must not die).
//
// Runs at first rawDb() call via applyInlineMigrations (server/db/connection.ts
// approx :191-341). Registered AFTER applyWaveC2PartnerAttributionsScopeSchema
// (dependency: partner_attributions must exist so authority_artifacts's FK to
// partner_attributions.id resolves at CREATE TABLE time).

import { log } from "./logger";

interface DbLike {
  prepare(sql: string): { all(): any[]; get(...args: any[]): any };
  exec(sql: string): void;
}

/**
 * Creates authority_artifacts (if missing) + adds two mf_engagement columns
 * (consent_scope, authority_artifact_id) if not already present. Idempotent
 * under re-run; safe as a first-boot heal or as a post-migration verification pass.
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws.
 */
export function applyWaveC2AuthorityArtifactsSchema(db: DbLike): void {
  try {
    // Guard: if partner_attributions does not exist yet (fresh boot, zero
    // migrations run, and buildProductionTableStatements hasn't included it),
    // silently no-op — the FK target does not yet exist.
    const parentExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_attributions'`
    ).get() as { name: string } | undefined;
    if (!parentExists) {
      return;
    }

    // Create authority_artifacts if it doesn't exist.
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='authority_artifacts'`
    ).get() as { name: string } | undefined;

    if (!tableExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS authority_artifacts (
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
        );
        CREATE INDEX IF NOT EXISTS idx_authority_artifacts_partner
          ON authority_artifacts(partner_id);
        CREATE INDEX IF NOT EXISTS idx_authority_artifacts_partner_company
          ON authority_artifacts(partner_id, company_id) WHERE company_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_authority_artifacts_attribution
          ON authority_artifacts(partner_attribution_id) WHERE partner_attribution_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_authority_artifacts_effective
          ON authority_artifacts(partner_attribution_id, kind)
          WHERE revoked_at IS NULL AND partner_attribution_id IS NOT NULL;
      `);
    }

    // Add mf_engagement additive columns (guarded by PRAGMA check).
    const mfEngagementExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mf_engagement'`
    ).get() as { name: string } | undefined;

    if (mfEngagementExists) {
      const existingCols = new Set(
        (db.prepare(`PRAGMA table_info(mf_engagement)`).all() as Array<{ name: string }>)
          .map((r) => r.name)
      );

      if (!existingCols.has("consent_scope")) {
        try {
          db.exec(`ALTER TABLE mf_engagement ADD COLUMN consent_scope TEXT NOT NULL DEFAULT 'public_data_only';`);
        } catch (e: any) {
          if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
            throw e;
          }
        }
      }

      if (!existingCols.has("authority_artifact_id")) {
        try {
          db.exec(`ALTER TABLE mf_engagement ADD COLUMN authority_artifact_id TEXT REFERENCES authority_artifacts(id);`);
        } catch (e: any) {
          if (!/duplicate column name/i.test(String(e?.message ?? ""))) {
            throw e;
          }
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mf_engagement_authority_artifact
          ON mf_engagement(authority_artifact_id) WHERE authority_artifact_id IS NOT NULL;
      `);
    }
  } catch (err) {
    log.warn("[wave-c2-authority-artifacts] self-heal skipped:", (err as Error).message);
  }
}
