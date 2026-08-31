-- 0228 — WAVE 221 · benchmarking / matchmaking opt-out (investor + partner silos)
--
-- R190.10, owner verbatim: "This platform is enabling communication between
-- investors, founders, consortium partners and I feel that this may hinder that
-- communication. I want to keep it open and available. Users should have the
-- option to turn it off by themselves."
--
-- The founder silo already has this control (companies.ma_privacy_json, migration
-- 0059). These two columns give the same control to the two silos that lack it.
--
-- SEMANTICS: NULL = PARTICIPATE. The column records the ISO-8601 instant at which
-- the subject switched sharing OFF, and is set back to NULL when they switch it
-- back on. NULL is therefore the state of every pre-existing row, which is what
-- keeps benchmark output byte-identical for a platform with no takers. There is
-- no "permanent" state and nothing here cannot be turned off again.
--
-- The column is deliberately NOT declared in the drizzle schema: drizzle names
-- every declared column in its INSERT, and leaving it undeclared keeps every
-- existing insert byte-unchanged.
--
-- Both statements are also applied by the self-heal installer in
-- server/lib/wave221BenchmarkingOptOut.ts, which READS THEM OUT OF THIS FILE
-- rather than re-typing them, because server/db/connection.ts is SACRED and its
-- inline bootstrap (the schema every :memory: test gets) cannot be extended.

ALTER TABLE users ADD COLUMN w221_benchmarking_opt_out_at TEXT;

ALTER TABLE partner_workspace_settings ADD COLUMN w221_benchmarking_opt_out_at TEXT;
