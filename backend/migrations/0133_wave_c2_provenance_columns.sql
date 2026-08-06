-- migrations/0133_wave_c2_provenance_columns.sql
-- Wave C-2.f v3.3.5 — Provenance columns, per LOCK 1, LOCK 2, V32-M6.
--
-- Adds delegated-agency provenance/principal columns to `round_invitations`
-- (5 columns, V33-4-B5 raised from 4 to 5 by adding `engagement_id`) and
-- LOCK-1 partner-CRM/workflow-stage columns to `soft_circles` (5 columns,
-- V32-M6 renames the companion CHECK column to `current_stage_machine_type`).
--
-- SPEC ANCHORS: §2 (migration 0133 row, line ~230), §14.4, §7.6 (25-column
-- INSERT), V32-M6, V32-M7, V33-4-B5, V33-4-N2.
--
-- All ten new columns are additive and nullable. No column here uses a
-- NOT NULL DEFAULT backfill — every legacy row simply reads these as NULL.
--
-- V32-M7 (already resolved in 0130, restated here so this file's own header
-- carries the fact): `authority_artifacts.partner_attribution_id` is declared
-- in 0130 and ONLY 0130. This migration does NOT re-declare it — the v3.1
-- duplicate ALTER that once lived in 0133 is deleted from the spec and is
-- deleted from this file too. There is no such statement below.
--
-- Sacred boundaries: zero touches to roundInvitationsStore.ts. This migration
-- is schema-only (ADD COLUMN); the LOCK-5 refactor of `createInvitation` /
-- `createInvitationTx` (which is what actually WRITES these columns on the
-- delegated path) lives in Wave C-2.j and is out of scope here.
--
-- Idempotent: guarded by the platform migration runner's duplicate-column
-- handling and by the self-heal function `applyWaveC2ProvenanceColumnsSchema`
-- at the connection module (V33-1-B1 pattern, V33-4-N2 scope).

-- ═════════════════════════════════════════════════════════════════════════
-- round_invitations — 5 delegated-agency provenance/principal columns
-- (shared/schema.ts:390; real DDL at server/db/connection.ts:3250)
-- ═════════════════════════════════════════════════════════════════════════
-- V33-4-B5: column order below is the ALTER order, and is also the exact
-- order §7.6's 25-column INSERT appends as positions 21-25 (byte-preservation
-- criterion for the founder path, which binds NULL to all five).
ALTER TABLE round_invitations
  ADD COLUMN sourced_from_partner_id TEXT REFERENCES partner_organizations(id);

ALTER TABLE round_invitations
  ADD COLUMN sourced_from_partner_attribution_id TEXT REFERENCES partner_attributions(id);

ALTER TABLE round_invitations
  ADD COLUMN acting_on_behalf_of_user_id TEXT REFERENCES users(id);

ALTER TABLE round_invitations
  ADD COLUMN actor_partner_user_id TEXT REFERENCES users(id);

-- V33-4-B5 (v3.3.4, raised from 4 to 5): required so §20.4's
-- `actingOnBehalfOf: {actorPartnerUserId, engagementId, partnerAttributionId} | null`
-- DTO can be constructed from a single row read.
--
-- R2 FIX (root fix 4, Opus BLOCKER B-f1 / Gemini BLOCK-1 / GPT-5.6 Major):
-- dropped the `REFERENCES mf_engagement(id)` clause — bare `TEXT` now, per
-- the V32-M8 precedent already applied to `partner_attributions.
-- authority_artifact_id` in 0129, for the identical reason. `mf_engagement`
-- is created ONLY by `applyMfcrmSchema()` (mfcrmSchema.ts), which runs AFTER
-- `applyInlineMigrations` on a fresh boot (index.ts:143 -> hydrateAllStores()
-- -> hydrateStores.ts -> managedFounderStore.ts:858 -> applyMfcrmSchema()).
-- SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so a `REFERENCES` clause
-- naming a not-yet-created table is permanent for the life of the column
-- once added via `ADD COLUMN` — and under `PRAGMA foreign_keys=ON`
-- (connection.ts:125, the live default), SQLite validates that EVERY
-- REFERENCES target table named anywhere in a table's schema exists at
-- INSERT time for ANY insert into that table, even one binding NULL to the
-- FK column. Probe-verified (SQLite 3.50.4): `ALTER TABLE ri ADD COLUMN
-- engagement_id TEXT REFERENCES mf_engagement(id);` succeeds, but the very
-- next `INSERT INTO ri (id) VALUES ('a')` (binding NULL to engagement_id)
-- raises `no such table: main.mf_engagement`. This is not merely a
-- self-closing boot-time window: Opus's r1 review grep-verified six test
-- files that write `round_invitations` directly without ever calling
-- `applyMfcrmSchema()` (waveW2_gate_accreditation.test.ts:138,
-- v25_47_blocker1_invitation_tokens.test.ts:24,74, and four more) — those
-- writers would break permanently, not just during a boot window. Bare TEXT
-- makes this application-layer-enforced only, matching 0129's own carve-out
-- for the analogous authority_artifact_id hazard.
ALTER TABLE round_invitations
  ADD COLUMN engagement_id TEXT;  -- V32-M8 precedent: bare TEXT, application-layer FK only

-- ═════════════════════════════════════════════════════════════════════════
-- soft_circles — LOCK 1 partner-sourcing columns + V32-M6 stage-machine column
-- (real DDL at server/db/connection.ts:3274)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE soft_circles
  ADD COLUMN sourced_from_partner_id TEXT REFERENCES partner_organizations(id);

ALTER TABLE soft_circles
  ADD COLUMN sourced_from_partner_attribution_id TEXT REFERENCES partner_attributions(id);

-- partner_crm_contact_id: the Layer-1 contact identity the promotion path
-- (§14.4) needs. One column, one meaning — never overloads `source_id`.
ALTER TABLE soft_circles
  ADD COLUMN partner_crm_contact_id TEXT REFERENCES partner_crm_contacts(id);

-- partner_workflow_stage_id: intentionally NO `REFERENCES` clause — §4.1's
-- trigger-based substitute polices this column's validity against
-- `mfc_stages` (stage_machine_type='mp_soft_circle'), not a DB-level FK.
ALTER TABLE soft_circles
  ADD COLUMN partner_workflow_stage_id TEXT;

-- current_stage_machine_type: V32-M6 renamed from v3.1's non-executable
-- `stage_machine_type` to match §14.1's DDL and §4.1's trigger DDL exactly.
-- Single-value CHECK constant is deliberate (the column exists so §4.1's
-- co-population guard clause has something to gate on and so the row shape
-- is self-describing) — 'mp_soft_circle' is the only legal value.
ALTER TABLE soft_circles
  ADD COLUMN current_stage_machine_type TEXT CHECK (current_stage_machine_type = 'mp_soft_circle');

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
-- §14.3 (V33-F6a): the partner-facing soft-circle GET route filters on
-- `sourced_from_partner_id IS NOT NULL AND sourced_from_partner_attribution_id = :id`.
-- Partial index matches that predicate shape exactly (uq_partner_attributions_active
-- partial-index precedent, §5.2/V32-M2) — rows with no partner provenance never
-- need to appear in this index.
CREATE INDEX IF NOT EXISTS idx_soft_circles_sourced_partner
  ON soft_circles(sourced_from_partner_id, sourced_from_partner_attribution_id)
  WHERE sourced_from_partner_id IS NOT NULL;

-- Symmetric read-path index for round_invitations — the delegated-agency
-- listing/lookup surfaces (§7, §20.4) filter invitations by the sourcing
-- partner the same way soft_circles does. Partial, same shape rationale.
CREATE INDEX IF NOT EXISTS idx_round_invitations_sourced_partner
  ON round_invitations(sourced_from_partner_id, sourced_from_partner_attribution_id)
  WHERE sourced_from_partner_id IS NOT NULL;

-- engagement_id lookup support for the §20.4 actingOnBehalfOf DTO read path.
CREATE INDEX IF NOT EXISTS idx_round_invitations_engagement
  ON round_invitations(engagement_id)
  WHERE engagement_id IS NOT NULL;
