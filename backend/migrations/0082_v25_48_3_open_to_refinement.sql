-- 0082_v25_48_3_open_to_refinement.sql
-- v25.48.3 Q-I1 — founder "open to Collective refinement" opt-in on the
-- direct company application. Additive + idempotent: SQLite has no
-- "ADD COLUMN IF NOT EXISTS", so a duplicate-column error on re-run is
-- expected and safe to ignore (the connection.ts bootstrap swallows it).
ALTER TABLE founder_collective_applications ADD COLUMN open_to_refinement INTEGER NOT NULL DEFAULT 0;
