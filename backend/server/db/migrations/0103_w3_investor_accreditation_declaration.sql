-- 0103_w3_investor_accreditation_declaration
-- W3-B / C-5 — Investor accredited-investor SELF-DECLARATION capture.
--
-- Append-only, hash-chained record of an individual's signed accreditation
-- self-certification. This is the durable source of truth for "this member has
-- self-declared accredited" that the C-5 individual-membership gate reads (see
-- server/lib/requireCollectiveMember.ts, behind COLLECTIVE_C5_ACCRED_ENFORCE).
--
-- Append-only: a re-certification is a NEW row (never UPDATE/DELETE). The gate
-- and status read the newest row per investor. Hash-chained per investor
-- (prev_hash/curr_hash) for tamper-evidence, mirroring the other compliance
-- rows.
--
-- Rule #13: signature_name (typed full legal name) is MANDATORY → NOT NULL.
--
-- ADDITIVE + IDEMPOTENT. CREATE TABLE / INDEX IF NOT EXISTS is non-destructive
-- and re-runnable. Mirrored VERBATIM in both migrations/ and
-- server/db/migrations/, plus the inline applyInlineMigrations() bootstrap
-- (server/db/connection.ts) for :memory: test DBs.

CREATE TABLE IF NOT EXISTS investor_accreditation_declaration (
  id              TEXT PRIMARY KEY NOT NULL,
  investor_id     TEXT NOT NULL,
  clause_version  TEXT NOT NULL,
  criteria_json   TEXT NOT NULL,
  signature_name  TEXT NOT NULL,
  signed_at       TEXT NOT NULL,
  jurisdiction    TEXT,
  created_at      TEXT NOT NULL,
  prev_hash       TEXT,
  curr_hash       TEXT
);

CREATE INDEX IF NOT EXISTS idx_iad_investor ON investor_accreditation_declaration (investor_id, signed_at);
