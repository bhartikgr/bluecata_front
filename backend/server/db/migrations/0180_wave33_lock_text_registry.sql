-- migrations/0180_wave33_lock_text_registry.sql
-- WAVE 33 · CP-PIPE-10 — LOCK 1 wording registry (OQ-5).
--
-- WHY A TABLE AND NOT A CONSTANT.
-- The verbatim LOCK 1 text lives in the owner's LOCK register and was never
-- captured into any document available to this build (OQ-5). Paraphrasing a
-- lock is not acceptable, so no text is invented. What ships is the MECHANISM
-- that carries the wording; the owner supplies the VALUE through an admin
-- route, with no code change and no redeploy.
--
-- This is also the standing "all DB-driven, no hardcoding" rule applied to the
-- one kind of string where hardcoding is most tempting and most harmful: legal
-- wording that must be reproduced exactly and that changes on the owner's
-- schedule, not on the release schedule.
--
-- `text` is NULLABLE ON PURPOSE and ships NULL. A row with NULL text means
-- "this lock exists and its wording has not been supplied" — which is a
-- different and more useful fact than the absence of a row, because the surface
-- can then say so explicitly instead of rendering nothing. An unsatisfied lock
-- that looks satisfied is the failure mode this build has found 24 times.
--
-- NO SEED TEXT IS INSERTED. The seed row below carries NULL text deliberately.
--
-- Additive: creates one new table and two indexes. No existing table is
-- altered, no existing row is modified, nothing is dropped.
-- Idempotent: every statement is IF NOT EXISTS / OR IGNORE.

CREATE TABLE IF NOT EXISTS platform_lock_text (
  key         TEXT PRIMARY KEY NOT NULL,
  -- The owner's verbatim wording. NULL until supplied. Never a placeholder.
  text        TEXT,
  set_by      TEXT,
  set_at      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_lock_text_set_at
  ON platform_lock_text(set_at);

-- Revision history: a lock's wording is legal text, so every change to it is
-- kept. The current value is never the only record of what a lock has said.
CREATE TABLE IF NOT EXISTS platform_lock_text_revision (
  id          TEXT PRIMARY KEY NOT NULL,
  key         TEXT NOT NULL,
  text        TEXT,
  set_by      TEXT,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_lock_text_revision_key
  ON platform_lock_text_revision(key, recorded_at);

-- The LOCK 1 row, present so the surface can state that the lock exists and its
-- wording is outstanding. Text is NULL — see the header.
INSERT OR IGNORE INTO platform_lock_text (key, text, set_by, set_at, created_at, updated_at)
VALUES ('LOCK_1', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
