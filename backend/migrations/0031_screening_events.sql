-- v18 Phase A — Screening event scheduling.
--
-- Adds two tables that back the chapter-scoped screening event surface:
--
--   screening_events            Hash-chained event lifecycle (created → cancelled / completed).
--   screening_event_attendees   One row per (event, user). UNIQUE(event_id, user_id).
--
-- ICS export: every event has a unique `ics_uid` (RFC5545 UID) so calendar
-- clients dedup re-imports. The GET /api/collective/screening-events/:id/ics
-- endpoint emits a valid VCALENDAR/VEVENT body from these columns alone.
--
-- Third-party calendar integration (Google Calendar API / Microsoft Graph)
-- is deferred to Avi — env-gated by GOOGLE_CALENDAR_CLIENT_ID /
-- GOOGLE_CALENDAR_CLIENT_SECRET / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET.
-- When these are unset (default), only ICS export is produced.
--
-- Idempotent: every CREATE TABLE / INDEX uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS screening_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  round_id TEXT,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scheduled_for INTEGER NOT NULL,        -- unix seconds since epoch
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  location TEXT,                          -- free-form text; may be a video URL for virtual events
  event_type TEXT NOT NULL DEFAULT 'screening',  -- 'screening' | 'pitch' | 'office_hours'
  status TEXT NOT NULL DEFAULT 'scheduled',      -- 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  organizer_user_id TEXT NOT NULL,
  ics_uid TEXT NOT NULL UNIQUE,           -- RFC5545 UID for calendar dedup
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS screening_event_attendees (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'observer',  -- 'founder' | 'investor' | 'dsc' | 'observer'
  rsvp TEXT NOT NULL DEFAULT 'invited',   -- 'invited' | 'accepted' | 'declined' | 'tentative'
  attended INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_screening_events_tenant ON screening_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_screening_events_chapter ON screening_events(chapter_id);
CREATE INDEX IF NOT EXISTS idx_screening_events_company ON screening_events(company_id);
CREATE INDEX IF NOT EXISTS idx_screening_events_round ON screening_events(round_id);
CREATE INDEX IF NOT EXISTS idx_screening_events_status ON screening_events(status);
CREATE INDEX IF NOT EXISTS idx_screening_events_scheduled ON screening_events(chapter_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_screening_event_attendees_event ON screening_event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_screening_event_attendees_user ON screening_event_attendees(user_id);
