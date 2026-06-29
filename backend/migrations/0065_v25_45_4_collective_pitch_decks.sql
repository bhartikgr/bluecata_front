-- 0065_v25_45_4_collective_pitch_decks.sql
--
-- v25.45.4 M-7 (Ozan live QA wave) — Collective pitch-deck upload metadata.
--
-- ADDITIVE ONLY. The /founder/apply-to-collective Path B "Pitch deck" control
-- was a TEXT input ("In production this would be multipart upload to S3+KMS") —
-- no real upload. Per Ozan's locked decision, the founder MUST upload a real
-- pitch-deck file because the Collective Deal Screening Committee (DSC) reviews
-- the deck alongside company round info during screening. The bytes are stored
-- via server/lib/objectStorage.ts (S3+KMS when configured, FS fallback in dev).
-- This table records the per-upload metadata the DSC review surface reads.
--
-- No DROP, no destructive ALTER. CREATE TABLE IF NOT EXISTS is safe to re-run.

CREATE TABLE IF NOT EXISTS collective_pitch_decks (
  id                  TEXT PRIMARY KEY NOT NULL,
  company_id          TEXT NOT NULL,
  application_id      TEXT,
  s3_key              TEXT NOT NULL,        -- objectStorage storageKey (S3 key OR uploads/ path)
  kms_key_id          TEXT,                 -- KMS key id when SSE-KMS used; NULL on FS fallback
  storage_backend     TEXT NOT NULL DEFAULT 'fs', -- 's3' | 'fs'
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  original_name       TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collective_pitch_decks_company
  ON collective_pitch_decks (company_id);
