-- v19 Phase C — Performance hardening: hot-path composite indexes.
-- All idempotent (CREATE INDEX IF NOT EXISTS). No data changes.

-- expert_questions: list-by-status-within-chapter is the hottest read.
CREATE INDEX IF NOT EXISTS idx_expert_questions_hot
  ON expert_questions (tenant_id, chapter_id, status, created_at);

-- expert_answers: best-answer / upvote ordering per question.
CREATE INDEX IF NOT EXISTS idx_expert_answers_question_upvote
  ON expert_answers (question_id, upvote_count DESC);

-- screening_events: chapter calendar lookup.
CREATE INDEX IF NOT EXISTS idx_screening_events_calendar
  ON screening_events (tenant_id, chapter_id, scheduled_for);

-- messages: per-thread-within-chapter is the hot list query.
CREATE INDEX IF NOT EXISTS idx_messages_thread_hot
  ON messages (tenant_id, chapter_id, thread_id, created_at);

-- collective_memberships_billing: lookup by (user, chapter) in webhook handler.
CREATE INDEX IF NOT EXISTS idx_collective_billing_user_chapter
  ON collective_memberships_billing (tenant_id, user_id, chapter_id);

-- chapter_announcements: pinned + priority sort is the hot list path.
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_hot
  ON chapter_announcements (tenant_id, chapter_id, pinned, priority);

-- chapter_resources: tag filter + list ordering.
CREATE INDEX IF NOT EXISTS idx_chapter_resources_hot
  ON chapter_resources (tenant_id, chapter_id, resource_type, created_at);

-- message_threads: list threads scoped to caller.
CREATE INDEX IF NOT EXISTS idx_message_threads_hot
  ON message_threads (tenant_id, chapter_id, last_activity_at);

-- partner_portfolio_companies: portfolio list per partner.
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_hot
  ON partner_portfolio_companies (tenant_id, partner_id, created_at);

-- partner_deal_pipeline: stage filter per partner.
CREATE INDEX IF NOT EXISTS idx_partner_deal_pipeline_hot
  ON partner_deal_pipeline (tenant_id, partner_id, stage, created_at);

-- partner_crm_contacts: per-partner list ordered by recency.
CREATE INDEX IF NOT EXISTS idx_partner_crm_hot
  ON partner_crm_contacts (tenant_id, partner_id, last_contact_at);

-- collective_billing_events: webhook-event chain walk per billing row.
CREATE INDEX IF NOT EXISTS idx_collective_billing_events_chain
  ON collective_billing_events (tenant_id, billing_id, created_at);

-- screening_attendees: lookup attendees per event (FK).
CREATE INDEX IF NOT EXISTS idx_screening_attendees_event
  ON screening_attendees (event_id);

-- audit_log: chain-walk index (tenant + created_at). Already exists but
-- this re-declaration is harmless and serves as documentation.
CREATE INDEX IF NOT EXISTS idx_audit_log_chain_walk
  ON audit_log (tenant_id, created_at, id);

-- dsc_votes: chain walk for the per-chapter audit verifier.
CREATE INDEX IF NOT EXISTS idx_dsc_votes_chain_walk
  ON dsc_votes (chapter_id, created_at, id);

-- chapter_announcements: chain walk (used by the v19C verifier).
CREATE INDEX IF NOT EXISTS idx_chapter_announcements_chain_walk
  ON chapter_announcements (chapter_id, created_at, id);

-- chapter_resources: chain walk.
CREATE INDEX IF NOT EXISTS idx_chapter_resources_chain_walk
  ON chapter_resources (chapter_id, created_at, id);

-- messages: chain walk.
CREATE INDEX IF NOT EXISTS idx_messages_chain_walk
  ON messages (chapter_id, created_at, id);

-- screening_events: chain walk.
CREATE INDEX IF NOT EXISTS idx_screening_events_chain_walk
  ON screening_events (chapter_id, created_at, id);

-- expert_questions: chain walk.
CREATE INDEX IF NOT EXISTS idx_expert_questions_chain_walk
  ON expert_questions (chapter_id, created_at, id);
