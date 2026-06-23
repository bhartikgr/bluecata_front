-- v18 Phase C — Ask-an-Expert (Q&A + reputation).
--
-- Four tables backing the Collective Ask-an-Expert surface:
--
--   expert_questions   Per-chapter knowledge-base question. Hash-chained
--                      across every status / body / accept-best transition.
--   expert_answers     Per-question response. Hash-chained. Denormalized
--                      upvote_count is reconciled inside the vote tx via
--                      COUNT(*) so race conditions never desync the cache.
--   expert_votes       Per-(answer, voter) ballot. UNIQUE(answer_id,
--                      voter_user_id) is the single-vote invariant — toggle
--                      semantics are insert/delete inside the tx.
--   expert_reputation  Per-(user, chapter) running totals. UNIQUE(user_id,
--                      chapter_id). Recomputed inside every triggering tx;
--                      milestone notifications fire at 50 / 200 / 500.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS expert_questions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  asker_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',                    -- JSON string[]
  status TEXT NOT NULL DEFAULT 'open',                -- open | answered | closed | flagged
  best_answer_id TEXT,                                -- FK → expert_answers.id
  flag_reason TEXT,
  flagged_by_user_id TEXT,
  flagged_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS expert_answers (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  responder_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  upvote_count INTEGER NOT NULL DEFAULT 0,            -- recomputed inside vote tx
  is_best_answer INTEGER NOT NULL DEFAULT 0,          -- 0/1 boolean
  status TEXT NOT NULL DEFAULT 'active',              -- active | edited | deleted | flagged
  flag_reason TEXT,
  flagged_by_user_id TEXT,
  flagged_at TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS expert_votes (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  answer_id TEXT NOT NULL,
  voter_user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL,                            -- 'up' | 'down'
  created_at TEXT NOT NULL,
  deleted_at TEXT,                                    -- carried so withTenant() compiles cleanly
  UNIQUE(answer_id, voter_user_id)
);

CREATE TABLE IF NOT EXISTS expert_reputation (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  questions_asked INTEGER NOT NULL DEFAULT 0,
  answers_given INTEGER NOT NULL DEFAULT 0,
  best_answers INTEGER NOT NULL DEFAULT 0,
  upvotes_received INTEGER NOT NULL DEFAULT 0,
  last_milestone_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,                                    -- carried so withTenant() compiles cleanly
  UNIQUE(user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_expert_questions_tenant     ON expert_questions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expert_questions_chapter    ON expert_questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_expert_questions_asker      ON expert_questions(asker_user_id);
CREATE INDEX IF NOT EXISTS idx_expert_questions_status     ON expert_questions(status);
CREATE INDEX IF NOT EXISTS idx_expert_questions_created    ON expert_questions(created_at);

CREATE INDEX IF NOT EXISTS idx_expert_answers_tenant       ON expert_answers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expert_answers_chapter      ON expert_answers(chapter_id);
CREATE INDEX IF NOT EXISTS idx_expert_answers_question     ON expert_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_expert_answers_responder    ON expert_answers(responder_user_id);
CREATE INDEX IF NOT EXISTS idx_expert_answers_status       ON expert_answers(status);

CREATE INDEX IF NOT EXISTS idx_expert_votes_tenant         ON expert_votes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expert_votes_chapter        ON expert_votes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_expert_votes_answer         ON expert_votes(answer_id);
CREATE INDEX IF NOT EXISTS idx_expert_votes_voter          ON expert_votes(voter_user_id);

CREATE INDEX IF NOT EXISTS idx_expert_reputation_tenant    ON expert_reputation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expert_reputation_chapter   ON expert_reputation(chapter_id);
CREATE INDEX IF NOT EXISTS idx_expert_reputation_user      ON expert_reputation(user_id);
CREATE INDEX IF NOT EXISTS idx_expert_reputation_score     ON expert_reputation(score);
