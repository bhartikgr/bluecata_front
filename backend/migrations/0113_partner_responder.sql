-- 0113_partner_responder.sql
-- W6 (2026-07-14) — Ask-an-Expert partner-responder / "connect a partner" backend.
--
-- Additive + idempotent + mirrored (server/db/migrations/0113_*.sql) + self-healed
-- in server/db/connection.ts. Touches NO sacred store, NO money core, NO Airwallex
-- (rule #14). Independent of the existing expert_questions/expert_answers tables —
-- it only REFERENCES a questionId by value (no FK coupling to the sacred-adjacent
-- Q&A hash chain, which stays byte-identical).
--
-- Two tables:
--   partner_responder_registry — which Consortium Partners have opted in to
--     respond to member questions (per chapter; chapter-agnostic when NULL),
--     with optional topic tags. Admin-managed.
--   partner_connect_requests   — a member's request on a specific question for a
--     partner to respond, and the partner's accept/decline/answer lifecycle.
--     Each row carries its own SHA-256 hash chain (prev_hash/curr_hash) so a
--     tamper is detectable, mirroring expertQAStore / captableCommitStore.

CREATE TABLE IF NOT EXISTS partner_responder_registry (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  partner_id TEXT NOT NULL,
  chapter_id TEXT,                 -- NULL = chapter-agnostic (all chapters)
  display_name TEXT NOT NULL,
  topics_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',   -- active | paused | archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_prr_partner ON partner_responder_registry(partner_id);
CREATE INDEX IF NOT EXISTS idx_prr_chapter_status ON partner_responder_registry(chapter_id, status);

CREATE TABLE IF NOT EXISTS partner_connect_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  chapter_id TEXT,
  question_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested',  -- requested | accepted | declined | answered | cancelled
  responder_user_id TEXT,                    -- partner team member who accepted/answered
  answer_id TEXT,                            -- expert_answers.id once the partner answers
  decline_reason TEXT,
  responded_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pcr_question ON partner_connect_requests(question_id);
CREATE INDEX IF NOT EXISTS idx_pcr_partner_status ON partner_connect_requests(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_pcr_requester ON partner_connect_requests(requester_user_id);
-- One live request per (question, partner) — re-requests reuse the row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcr_question_partner ON partner_connect_requests(question_id, partner_id);
