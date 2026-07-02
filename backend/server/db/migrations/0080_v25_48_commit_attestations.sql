-- 0080_v25_48_commit_attestations.sql
-- v25.48 B5 — REQUIRED founder attestation at commit.
-- ADDITIVE ONLY: new table + indexes, PARALLEL to the Sacred cap-table ledger
-- (captableCommitStore). Stores the attestor user id + timestamp for each
-- founder-confirmed commit. Fail-closed: the commit wrapper refuses to call the
-- ledger commit fn unless an attestation row is written first. The Sacred
-- ledger file and its hash-chain math are NOT modified.
CREATE TABLE IF NOT EXISTS commit_attestations (
  id               TEXT PRIMARY KEY NOT NULL,
  invitation_id    TEXT NOT NULL,
  round_id         TEXT,
  company_id       TEXT,
  investor_id      TEXT,
  attestor_user_id TEXT NOT NULL,
  attested_at      TEXT NOT NULL,
  amount           TEXT,
  currency         TEXT,
  statement        TEXT
);
CREATE INDEX IF NOT EXISTS idx_commit_attest_invitation ON commit_attestations (invitation_id);
CREATE INDEX IF NOT EXISTS idx_commit_attest_company ON commit_attestations (company_id);
