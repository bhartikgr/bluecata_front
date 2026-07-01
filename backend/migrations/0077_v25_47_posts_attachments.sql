-- 0077_v25_47_posts_attachments.sql
-- v25.47 APD-024 — Network post attachments.
-- ADDITIVE ONLY: nullable column on network_posts. Mirrors connection.ts
-- applyV2547Schema. Re-runnable: duplicate-column errors are swallowed by
-- the migration runner's idempotent guard. attachments holds a JSON array of
-- {key, mime, size, name} object-storage descriptors.
ALTER TABLE network_posts ADD COLUMN attachments TEXT;
