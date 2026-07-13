-- 0108_1c_spv_launch_signoffs
-- 1c (v26.1.x Consortium Partner QA) — durable, verifiable SPV launch sign-off.
--
-- Records an institutional-grade electronic attestation captured BEFORE an SPV
-- is launched from the Consortium Partner SPV Engine (Review & launch step).
-- The sign-off is the "verifiable and recorded" evidence that the acting GP
-- affirmed the vehicle's terms under an ESIGN/UETA-style attestation.
--
-- Columns:
--   id                 TEXT  — PK  sof_<random>
--   partner_id         TEXT  — the consortium_partner org id (indexed)
--   spv_id             TEXT  — the SPV this sign-off applies to (indexed; may be
--                             the created SPV id, or a client draft ref when the
--                             sign-off is captured immediately pre-create)
--   user_id            TEXT  — the authenticated signer (from session ONLY)
--   signer_legal_name  TEXT  — typed full legal name (wet-signature equivalent)
--   signer_sub_role    TEXT  — the signer's partner sub-role at signing time
--   attestation_text   TEXT  — the EXACT wording the signer agreed to
--   attestation_version TEXT — versioned so we can prove what was shown
--   signed_at          TEXT  — UTC ISO timestamp of assent
--   ip                 TEXT  — request IP (audit trail; nullable)
--   user_agent         TEXT  — request UA (audit trail; nullable)
--   created_at         TEXT
--
-- ADDITIVE + IDEMPOTENT. CREATE TABLE / INDEX IF NOT EXISTS is non-destructive
-- and re-runnable. No FKs to Avi-owned / money-core tables, so it cannot
-- constrain existing data. NEVER touches Airwallex/payments or the cap-table
-- ledger (captableCommitStore). Mirrored VERBATIM in both migrations/ and
-- server/db/migrations/, plus an inline self-heal in server/db/connection.ts.

CREATE TABLE IF NOT EXISTS spv_launch_signoffs (
  id                  TEXT PRIMARY KEY NOT NULL,
  partner_id          TEXT NOT NULL,
  spv_id              TEXT NOT NULL DEFAULT '',
  user_id             TEXT NOT NULL,
  signer_legal_name   TEXT NOT NULL,
  signer_sub_role     TEXT,
  attestation_text    TEXT NOT NULL,
  attestation_version TEXT NOT NULL DEFAULT 'v1',
  signed_at           TEXT NOT NULL,
  ip                  TEXT,
  user_agent          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spv_launch_signoffs_partner
  ON spv_launch_signoffs (partner_id);

CREATE INDEX IF NOT EXISTS idx_spv_launch_signoffs_spv
  ON spv_launch_signoffs (spv_id);
