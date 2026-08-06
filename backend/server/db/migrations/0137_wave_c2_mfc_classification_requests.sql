-- migrations/0137_wave_c2_mfc_classification_requests.sql
-- Wave C-2 v26.6.0 — Classification-request queue for CAPABILITY_UNCLASSIFIED
-- partner unblock (live-blocker fix §8.2(b)). New greenfield, non-sacred table.
--
-- SPEC ANCHORS: §2.2 (migration 0137 row, line 234: "Unchanged from v3.1"),
-- §8.2 (route contracts + same-DB-transaction close-of-loop), §16.1 (admin
-- classification-queue surface), §19 (wave_c2_classification_request.test.ts,
-- 10 cases). Full column list is NOT restated in v3.3.5's own 0137 row prose
-- (which only says "Unchanged from v3.1") — the authoritative column list is
-- v3.1's own 0137 row, carried forward untouched across v3/v3.1/v3.2/v3.3.x,
-- verbatim: `id, partner_id, requested_by_user_id, status CHECK (status IN
-- ('pending','approved','rejected')), created_at, resolved_at,
-- resolved_by_user_id, note`. Partial unique index verbatim:
-- `CREATE UNIQUE INDEX uq_mfc_classification_requests_pending ON
-- mfc_classification_requests(partner_id) WHERE status='pending'`.
--
-- Sacred boundaries: zero touches to partnerConsortiumRoutes.ts,
-- notificationsStore.ts, sseHub.ts, captableCommitStore.ts, messagingStore.ts,
-- paymentGatewayAdapter.ts, roundInvitationsStore.ts, or Airwallex. §8.2
-- explicitly confirms this is a "New non-sacred table" — zero dependency on
-- notificationsStore.ts is restated at §16.1 for the admin queue page too.
--
-- Depends on: none (per spec §2.2's "Depends on" column for 0137) — but the
-- two FK targets (`partner_organizations`, `users`) are pre-existing platform
-- tables (confirmed live at connection.ts:4159 and :2716 respectively), not
-- anything created earlier in the Wave C-2 sequence itself.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT
-- EXISTS`, guarded further by the self-heal function
-- `applyWaveC2ClassificationRequestsSchema` (V33-1-B1 pattern) at the
-- connection module, which re-asserts this shape on every boot.

-- ═════════════════════════════════════════════════════════════════════════
-- mfc_classification_requests — one row per partner's request to have their
-- capability profile classified (unblocks CAPABILITY_UNCLASSIFIED writes)
-- ═════════════════════════════════════════════════════════════════════════
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
  resolved_at           TEXT,                                   -- nullable until approve/reject
  resolved_by_user_id   TEXT REFERENCES users(id),               -- nullable until approve/reject
  note                  TEXT                                     -- optional admin note (e.g. reject reason)
);

-- Anti-spam / idempotency structural enforcement (§8.2's route-contract row,
-- verbatim per §2's 0137 row): at most one PENDING request per partner at a
-- time. This is the sole mechanism preventing duplicate requests — spec §8.2
-- states explicitly there is "no rate limiter today," so this partial unique
-- index is load-bearing, not a redundant defense-in-depth measure.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfc_classification_requests_pending
  ON mfc_classification_requests(partner_id)
  WHERE status = 'pending';

-- Read-path support: GET /api/admin/mfcrm/classification-queue accepts an
-- optional `status` filter (spec §16.1) and the queue view naturally orders
-- by recency; index the common filter+sort access pattern.
CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_status_created
  ON mfc_classification_requests(status, created_at);

-- Read-path support: GET /api/partner/me/mfcrm/classification-status resolves
-- a single partner's current/most-recent request by partner_id.
CREATE INDEX IF NOT EXISTS idx_mfc_classification_requests_partner
  ON mfc_classification_requests(partner_id);
