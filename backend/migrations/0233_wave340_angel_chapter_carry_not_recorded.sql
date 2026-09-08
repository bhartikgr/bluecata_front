-- 0233 · WAVE 340 · mf_angel_chapter.carry_bps_recorded (ADDITIVE ONLY)
--
-- WHAT THIS FILE DOES, IN ONE SENTENCE.
-- It adds one new, NULLABLE integer column that holds a carry rate ONLY when a
-- human actually recorded one, so that "no carry rate has been agreed" and "a
-- carry rate of exactly 0% has been agreed" stop being the same stored value.
-- Nothing is dropped, nothing is renamed, nothing is deleted, and NOT ONE
-- EXISTING ROW IS WRITTEN BY THIS FILE.
--
-- THE DEFECT THIS ADDRESSES.
-- `mf_angel_chapter.carry_bps` is declared `INTEGER NOT NULL DEFAULT 0` (the
-- table's only DDL is the lazy `CREATE TABLE IF NOT EXISTS` in
-- server/mfcrmAngelStore.ts), and BOTH writers coerce absent input to 0
-- (`createChapter`, `setChapterCarry`). A chapter created with the Carry box left
-- blank therefore stores 0 and reads back as a definite commercial claim — an
-- AGREED zero carry. It is not one. It is the ABSENCE of an arrangement wearing
-- a number's clothes, and for a chapter (which is not a fund) the absence is the
-- normal case. WALKTHROUGH_ENGINEERING_DOC.md:257-279 recorded this as a
-- correctness defect and referred the schema change to the owner as §Q4;
-- WALKTHROUGH_ENGINEERING_DOC.md:1012 records that on rows ALREADY STORED the two
-- states "cannot be told apart from the data held". The owner ruled on 2026-09-06
-- that the default must become NULL and the screen must read "Not set", and that
-- existing 0 values must NOT be overwritten.
--
-- WHY A COMPANION COLUMN AND NOT A NULLABLE `carry_bps`.
-- Making `carry_bps` itself nullable is impossible in SQLite without a TABLE
-- REBUILD (create-copy-drop-rename). That is destructive SQL on a live table and
-- is forbidden here. This file is additive-only, which is the only safe shape:
-- `carry_bps` keeps its declaration, keeps its value on every existing row, and
-- every existing reader of it keeps working unchanged.
--
-- WHAT THE TWO COLUMNS MEAN AFTER THIS MIGRATION.
--   carry_bps_recorded IS NOT NULL  a human recorded this rate. 0 here is a REAL,
--                                   DELIBERATE 0% and is rendered as 0.00%.
--   carry_bps_recorded IS NULL
--     AND carry_bps > 0             a rate recorded BEFORE this migration. It is
--                                   still shown, from `carry_bps`. Nothing is
--                                   hidden.
--   carry_bps_recorded IS NULL
--     AND carry_bps = 0             NO RATE IS KNOWN. Rendered "Not set". For a
--                                   row created after this migration that is
--                                   exactly true. For a row created BEFORE it,
--                                   this state is AMBIGUOUS — it may have been a
--                                   deliberately agreed 0% — and the platform
--                                   cannot tell. That ambiguity is PRE-EXISTING
--                                   and is not repaired here, because repairing
--                                   it would require guessing, and a stored guess
--                                   about carry is how LPs get quietly diluted.
--                                   It is REPORTED instead: the installer counts
--                                   these rows and names them.
--
-- IDEMPOTENCE — SAFE TO RUN TWICE.
--   section 1  every statement is `IF NOT EXISTS`.
--   section 2  `ADD COLUMN` on an existing column raises `duplicate column name`,
--              which server/db/migrate.ts isIdempotentSqliteError() classifies as
--              idempotent and skips at per-statement granularity.
--   section 3  contains NO STATEMENTS AT ALL, by design (see below), so it cannot
--              be non-idempotent.
--
-- THREE HOMES, NO DRIFT. This file is mirrored byte-identically at
-- server/db/migrations/0233_wave340_angel_chapter_carry_not_recorded.sql, and its
-- bytes are embedded verbatim in server/lib/angelChapterCarrySchema.ts because
-- server/db/connection.ts is SACRED-FROZEN (scripts/sacred_check.sh) and may not
-- be edited to widen the inline bootstrap. All three are asserted byte-identical
-- by server/__tests__/w340_angel_chapter_carry_not_set.test.ts.
--
-- NO DESTRUCTIVE SQL APPEARS IN THIS FILE. No DROP, no DELETE, no UPDATE, no
-- table rebuild, and no write of any kind to `carry_bps`.


-- §1 · SELF-SUFFICIENCY. Copied byte-identically from the lazy DDL in
-- server/mfcrmAngelStore.ts:ensureAngelTables(). A no-op on every database that
-- already has the table. It is here because server/db/migrate.ts:applyOne wraps
-- every migration in a transaction, so a migration may not assume a table another
-- path creates.

CREATE TABLE IF NOT EXISTS mf_angel_chapter (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      region      TEXT,
      carry_bps   INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_mf_angel_chapter_partner ON mf_angel_chapter(partner_id);

-- §2 · THE NEW COLUMN. Nullable INTEGER, NO DEFAULT. Nullable is the whole point:
-- NULL is the load-bearing value in this design and it means "no carry rate is
-- recorded for this chapter". A DEFAULT of any number would put the fabricated
-- zero straight back. The CHECK admits NULL and refuses a negative rate; it does
-- not cap the upper bound, because `carry_bps` next to it does not either and this
-- migration is not the place to start refusing values the old column accepts.

ALTER TABLE mf_angel_chapter ADD COLUMN carry_bps_recorded INTEGER
  CHECK (carry_bps_recorded IS NULL OR carry_bps_recorded >= 0);


-- §3 · THE BACKFILL THAT MUST NOT EXIST.
--
-- There is no UPDATE in this section and there must never be one. Consider what a
-- backfill could possibly write:
--
--   * `carry_bps_recorded = carry_bps` for every row would declare that EVERY
--     pre-existing chapter has a recorded rate, including the ones whose 0 was
--     never typed by anybody. That is the fabricated zero, promoted to a claim.
--   * `carry_bps_recorded = carry_bps WHERE carry_bps > 0` looks safer, and this
--     migration's READ rule achieves the same effect without writing anything —
--     so the write buys nothing and risks something.
--   * anything that treats a legacy 0 as a deliberate 0, or as a not-set, is a
--     GUESS about a commercial term. The data does not contain the answer.
--
-- The owner's ruling was explicit: only the DEFAULT changes; existing 0% values
-- that were deliberately set must NOT be overwritten. Since a deliberate 0 and a
-- defaulted 0 are INDISTINGUISHABLE on rows already stored, the only instruction
-- that can be obeyed without guessing is to write nothing. This section therefore
-- exists to say so, and server/lib/angelChapterCarrySchema.ts ASSERTS that it
-- contains no executable statement, so a future edit that adds one is a failure
-- rather than a silent change of meaning.
