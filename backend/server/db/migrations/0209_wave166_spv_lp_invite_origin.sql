-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 166 · BATCH 3 · ITEM D (PATH 2) · R131.2 — WHERE AN LP CAME FROM.
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE OWNER'S SECOND PATH, VERBATIM: "If the SPV already has LPs before it is
-- launched on the platform, GPs are able to directly add LPs to the SPV. These
-- LPs will still be allowed to signin/register to the platform but would be
-- automatically included as LPs in the SPV/fund."
--
-- Before this migration `spv_lp_invite` recorded WHO an LP is and WHAT STATE
-- their invitation is in, but not WHERE THEY CAME FROM. Those are different
-- questions and the platform was answering the third with the second: a
-- pre-existing LP who was on the cap table before the vehicle ever reached this
-- platform was stored as `status='invited'`, indistinguishable from someone who
-- had just been emailed and had not replied. That is wrong in both directions —
-- it implies an outstanding invitation that nobody sent, and it loses the fact
-- that this holder's position predates the platform entirely.
--
-- ONE COLUMN, DEFAULT `direct`, AND WHY THAT DEFAULT IS THE HONEST ONE.
-- Every existing row was created by `createLpInvite`, i.e. by a GP acting inside
-- the platform. `direct` is what actually happened to those rows. Back-filling
-- them as `existing_captable` would ASSERT a pre-platform history the database
-- has no evidence for, and this migration will not invent provenance.
--
-- THE VALUE SET IS THE SHAREHOLDER-ORIGIN VOCABULARY FROM WAVE 130
-- (`server/lib/shareholderRegisterStore.ts`, `ShareholderRecordOrigin` at :66):
--   incorporation      — a founding holder
--   existing_captable  — already a holder before the platform saw the vehicle
--   direct             — added on the platform by a GP
--
-- THREE VOCABULARIES, DELIBERATELY NOT UNIFIED. An invitation state
-- (invited/accepted/expired/revoked), a commitment state
-- (review/soft_circled/founder_confirmed/wire_funded/committed/withdrawn) and a
-- shareholder origin (the three above) answer three different questions about
-- the same person. They are NOT merged into a shared enum and they do NOT share a
-- label map. A single "status" spanning all three is precisely how "invited"
-- came to mean "was already an owner".
--
-- CHECK CONSTRAINT, NOT A TRIGGER. SQLite applies a column CHECK on ALTER TABLE
-- ADD COLUMN to future writes; every existing row takes the DEFAULT and is
-- already inside the set, so no row is invalidated and no data is rewritten.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE spv_lp_invite
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'direct'
  CHECK (origin IN ('incorporation', 'existing_captable', 'direct'));

-- Reading "show me the holders this vehicle arrived with" is a per-SPV question,
-- so the index is (spv_id, origin) and not origin alone.
CREATE INDEX IF NOT EXISTS idx_spv_lp_invite_spv_origin
  ON spv_lp_invite (spv_id, origin);
