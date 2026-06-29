-- 0067_v25_45_4_dataroom_file_storage.sql
--
-- v25.45.4 M-5 / M-6 (Ozan live QA wave) — durable dataroom file bytes.
--
-- ADDITIVE ONLY. Prior to this version, dataroom file BYTES were held in an
-- in-memory `_buf` only; the DB row (dataroom_files) stored metadata alone.
-- The download/view route therefore served a text/plain placeholder
-- ("Placeholder content for <name> (Sprint 11 preview)") for any file whose
-- bytes were not in memory — i.e. all seeded files and every real upload after
-- a restart. LIVE-12/LIVE-13: the "View" eye opened a plain-text stub and
-- "Download" produced a 102-byte ASCII file misnamed .pdf.
--
-- Fix: persist uploaded bytes via server/lib/objectStorage.ts (S3+KMS in prod,
-- local FS fallback in dev) and record the storage key + KMS key id on the file
-- row so the download route can stream the REAL bytes back across restarts.
--
-- Two nullable columns (no default required) added to the existing table. No
-- DROP, no destructive ALTER. ADD COLUMN on SQLite is additive and safe.

ALTER TABLE dataroom_files ADD COLUMN storage_key TEXT;
ALTER TABLE dataroom_files ADD COLUMN storage_kms_key_id TEXT;
ALTER TABLE dataroom_files ADD COLUMN storage_backend TEXT;
