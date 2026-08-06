-- migrations/0130_wave_c2_authority_artifacts.sql
-- Wave C-2 v26.6.0 — Authority artifacts (per-partner × per-client engagement letters,
-- client_authority_scope grants, DPAs, referral_consent). New greenfield table.
--
-- Also lands two additive columns on mf_engagement (created in an earlier
-- pre-Wave-C migration):
--   consent_scope         TEXT NOT NULL DEFAULT 'public_data_only'  (backfill every row)
--   authority_artifact_id TEXT REFERENCES authority_artifacts(id)   (nullable, V32-N6)
--
-- SPEC ANCHORS: §2.2 (migration 0130 row), §5.2, §9.4, §17.1, V32-M7, V32-N6, V32-N7
--
-- Sacred boundaries: zero touches to partnerConsortiumRoutes.ts, notificationsStore.ts,
-- sseHub.ts, captableCommitStore.ts, messagingStore.ts, paymentGatewayAdapter.ts,
-- roundInvitationsStore.ts, or Airwallex.
--
-- V32-M7: `authority_artifacts.partner_attribution_id` is declared HERE and ONLY here.
-- 0133 does NOT re-declare it (the v3.1 duplicate ALTER is deleted from spec §2/0133).
-- The FK target `partner_attributions.id` exists from the pre-C-2 platform (migration 0114),
-- so this table can carry the reference at CREATE time — no deferred-FK gymnastics needed
-- for THIS column. (The reverse — `partner_attributions.authority_artifact_id` in 0129 —
-- remains permanently bare, per V32-M8 and 0129's own header.)
--
-- V32-N7: `uq_authority_artifacts_effective` is a partial unique index that does NOT
-- constrain firm-level artifacts (partner_attribution_id IS NULL). See index comment
-- below. The COALESCE alternative was considered and rejected because SQLite's partial
-- index syntax is cleaner and matches the actual policy intent — firm-level artifacts
-- (e.g. blanket partner_agreement) are enforced by uq_contacts_partner_agreement at the
-- contacts table, not here.
--
-- Idempotent: guarded by the platform migration runner's duplicate-table handling and
-- the self-heal function `applyWaveC2AuthorityArtifactsSchema` at the connection module.

-- ═════════════════════════════════════════════════════════════════════════
-- authority_artifacts — the canonical per-partner × per-client artifact table
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS authority_artifacts (
  id                       TEXT PRIMARY KEY NOT NULL,
  partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
  partner_attribution_id   TEXT REFERENCES partner_attributions(id),  -- NULLABLE for firm-level (V32-M7)
  company_id               TEXT REFERENCES companies(id),              -- NULLABLE for firm-level
  kind                     TEXT NOT NULL CHECK (kind IN (
                             'engagement_letter',
                             'client_authority_scope',
                             'dpa',
                             'referral_consent'
                           )),
  -- effective_at: constant expression default, legal in both SQLite and Postgres mirror
  effective_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at               TEXT,                                       -- nullable = perpetual
  revoked_at               TEXT,                                       -- application sets on revoke
  revoked_by               TEXT,

  -- Artifact content (blob metadata; the actual file lives in object storage).
  content_hash             TEXT NOT NULL,                               -- SHA-256 of the signed artifact
  storage_uri              TEXT NOT NULL,                               -- e.g. s3://bucket/key or /uploads/...
  mime_type                TEXT NOT NULL,
  byte_size                INTEGER NOT NULL CHECK (byte_size > 0),

  -- Signing metadata.
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

  -- Audit chain (light — canonical audit is mf_engagement_event, not this row).
  created_at               TEXT NOT NULL,
  created_by               TEXT,
  updated_at               TEXT NOT NULL,
  updated_by               TEXT,

  -- Enforce kind-shape invariants:
  -- engagement_letter and client_authority_scope MUST carry both partner_attribution_id
  -- AND company_id (per-client). dpa and referral_consent MAY be firm-level (both NULL).
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

-- V32-N7: partial unique index enforcing "at most one non-revoked artifact per
-- (partner_attribution_id, kind)" for CLIENT-LEVEL artifacts. Firm-level artifacts
-- (partner_attribution_id IS NULL) are NOT constrained here — they are policed by
-- uq_contacts_partner_agreement at the contacts table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_authority_artifacts_effective
  ON authority_artifacts(partner_attribution_id, kind)
  WHERE revoked_at IS NULL AND partner_attribution_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- mf_engagement additive columns (V32-N6 + spec §2.2/0130)
-- ═════════════════════════════════════════════════════════════════════════
-- consent_scope: NOT NULL DEFAULT ensures every existing mf_engagement row gets
-- 'public_data_only' explicitly on migration. No backfill statement required —
-- the DEFAULT covers legacy rows at ADD COLUMN time.
ALTER TABLE mf_engagement ADD COLUMN consent_scope TEXT NOT NULL DEFAULT 'public_data_only';

-- authority_artifact_id: nullable FK to authority_artifacts.id. This is the ACTIVE
-- engagement-letter link (§9.4) for the engagement. Set/unset via the artifact-upload
-- flow. V32-N6: stated as an explicit column-list row (previously only in §9.4 prose).
ALTER TABLE mf_engagement ADD COLUMN authority_artifact_id TEXT REFERENCES authority_artifacts(id);

CREATE INDEX IF NOT EXISTS idx_mf_engagement_authority_artifact
  ON mf_engagement(authority_artifact_id) WHERE authority_artifact_id IS NOT NULL;
