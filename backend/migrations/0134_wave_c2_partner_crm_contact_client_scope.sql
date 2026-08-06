-- migrations/0134_wave_c2_partner_crm_contact_client_scope.sql
-- Wave C-2.g v26.6.0 — partner_crm_contact_client_scope join table.
--
-- Per spec §2 (0134 row, ~line 231): "partner_crm_contact_client_scope only.
-- UNIQUE(partner_crm_contact_id, partner_attribution_id). Unchanged from v3.1."
-- Full column shape per §13.2 (D2 — client-scoped sub-CRM; three-layer model
-- preserved), the ONLY place the spec gives the complete CREATE TABLE body.
--
-- Purpose (§13.2/§14.4): this table is the Layer-1 -> Layer-2 scoping record.
-- A Consortium Partner's CRM contact (Layer 1, partner_crm_contacts) becomes
-- "scoped" to a specific client engagement (Layer 2, partner_attributions)
-- when a soft-circle's partner_workflow_stage_id reaches the terminal key
-- 'partner_committed' (§14.4 item 1). The upsert reads partner_crm_contact_id
-- directly from soft_circles.partner_crm_contact_id — never from source_id.
-- UNIQUE(partner_crm_contact_id, partner_attribution_id) guarantees exactly
-- one scope row per (contact, client-attribution) pair even under a racing
-- double-transition (§14.4), additionally protected at the call site by the
-- §14.3 compare-and-set contract on partner_workflow_stage_id itself
-- (409 STAGE_TRANSITION_CONFLICT, first-writer-wins-with-visible-conflict,
-- V32-M4).
--
-- SPEC ANCHORS: §2 (migration 0134 row, ~line 231), §13.2 (D2, full DDL),
-- §14.4 (E3 — two-step promotion, race-safe), LOCK 2 (Ozan — the scoping key
-- is the existing partner_attributions.id; "clientAttributionId" naming is
-- rejected everywhere, including here — the column is partner_attribution_id,
-- matching V33-F6c's route-level correction of the same naming question).
--
-- Applicable V32/V33 findings:
--   V32-M2 — precedent for a uniqueness index closing a scoping gap after
--            LOCK 2 (applied there to partner_attributions itself via
--            uq_partner_attributions_active; the analogous concern here is
--            already closed by the UNIQUE(...) table constraint the spec
--            calls for directly — no separate CREATE UNIQUE INDEX needed
--            since SQLite's inline UNIQUE(...) on a CREATE TABLE already
--            creates the backing index automatically).
--   V32-M9 — LOCK 2 naming discipline: this migration uses partner_attribution_id
--            (never clientAttributionId/client_attribution_id) throughout,
--            consistent with the real column name on partner_attributions.id.
--   V32-M1, V32-M3 through V32-M8 — not applicable to this table (they concern
--            mf_engagement_event delivery, engagement_letter_active forms,
--            set_stage compare-and-set, identity_not_resolved typing, the
--            0130/0133 authority_artifacts double-declare, and the 0129/0130
--            deferred-FK sequencing respectively — none of which touch
--            partner_crm_contact_client_scope).
--
-- FK targets confirmed against the real tree (server/db/connection.ts):
--   partner_crm_contacts.id  — TEXT PRIMARY KEY NOT NULL (connection.ts ~:3944)
--   partner_attributions.id  — TEXT PRIMARY KEY NOT NULL (connection.ts ~:2129)
--   users.id                 — pre-existing platform table (scoped_by_user_id FK)
--
-- Sacred boundaries: zero touches to roundInvitationsStore.ts,
-- partnerConsortiumRoutes.ts, notificationsStore.ts, sseHub.ts,
-- captableCommitStore.ts, messagingStore.ts, paymentGatewayAdapter.ts.
-- Zero Airwallex touches.
--
-- Idempotent: the CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- clauses themselves are what make re-running this file a no-op (R2 fix,
-- MINOR m-g3 -- "the platform migration runner's duplicate-table handling"
-- is a different, non-existent mechanism and should not have been credited
-- here; IF NOT EXISTS is doing the work). The self-heal function
-- applyWaveC2ClientScopeSchema at server/lib/ is a separate, additional
-- idempotent guard (sqlite_master-checked against both parent tables,
-- partner_crm_contacts and partner_attributions, before attempting the
-- CREATE), not the source of this file's own idempotency.
--
-- R2 FIX (Opus r1 MAJOR M-g1): created_at gained a DEFAULT expression (see
-- below) so a spec-Sec-13.2-shaped 5-column INSERT (the one Section 14.4's
-- promotion-upsert actually issues) no longer fails with
-- "NOT NULL constraint failed: partner_crm_contact_client_scope.created_at".
-- R2 FIX (SHARED-B1): connection_ts_patch.md / mirror_copy.md /
-- w9_pin_advance.md / shared_schema_delta.md added this pass -- see this
-- directory. Self-heal relocated to server/lib/applyWaveC2ClientScopeSchema.ts
-- (was incorrectly headed server/db/schemaHeals/, a directory that does not
-- exist, per root fix 5 / Opus MAJOR M-g2).
--
-- Depends on: 0129 (partner_attributions must already exist — table-level
-- REFERENCES clause below names it at CREATE TABLE time), and the pre-C-2
-- platform's partner_crm_contacts (connection.ts ~:3944, always present).

-- ═════════════════════════════════════════════════════════════════════════
-- partner_crm_contact_client_scope — Layer-1 x Layer-2 scoping join table
-- ═════════════════════════════════════════════════════════════════════════
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

-- Read-path index. Spec §13.2/§14.4 does not call out additional named
-- indexes beyond the UNIQUE(...) table constraint itself (which SQLite
-- backs with an implicit unique index on (partner_crm_contact_id,
-- partner_attribution_id) automatically). Only ONE additional single-column
-- index is added: idx_pccs_attribution, for the "which clients is this
-- contact scoped to" reverse-lookup direction (used by dedup/promotion-
-- idempotency checks per §14.4). R2 FIX (Opus r1 MINOR m-g2): the former
-- idx_pccs_contact (on partner_crm_contact_id alone) is DROPPED here -- it
-- was fully redundant with the implicit index SQLite already creates for
-- UNIQUE(partner_crm_contact_id, partner_attribution_id), since a
-- leftmost-prefix lookup on partner_crm_contact_id alone is already served
-- by that composite index (leftmost-prefix rule). Only
-- idx_pccs_attribution earns its keep, because partner_attribution_id is
-- NOT the leftmost column of the UNIQUE constraint's composite index.
CREATE INDEX IF NOT EXISTS idx_pccs_attribution
  ON partner_crm_contact_client_scope(partner_attribution_id);
