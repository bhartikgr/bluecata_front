/**
 * server/lib/angelChapterCarrySchema.ts — WAVE 340 · ITEM 2.
 *
 * GENERATED. Source of truth: migrations/0233_wave340_angel_chapter_carry_not_recorded.sql
 * (byte-identically mirrored at
 *  server/db/migrations/0233_wave340_angel_chapter_carry_not_recorded.sql).
 * Generator: build_log/productgaps/evidence/gen_installer_0233.py. The SQL below is
 * the migration file's bytes, embedded — not a paraphrase, not a re-typing.
 *
 * WHY THIS FILE EXISTS — THE THIRD SCHEMA HOME.
 * This platform has TWO schema paths: migrations/NNNN_*.sql applied by
 * server/db/migrate.ts (what a real deploy gets), and the inline bootstrap inside
 * server/db/connection.ts, which builds the sandbox database, the dev database and
 * every `:memory:` test database. A migration shipped into the first alone leaves
 * the two disagreeing and `npm run lint:schema-path-parity` fails mechanically on
 * that disagreement. server/db/connection.ts is SACRED-FROZEN (nine owner-ratified
 * waivers; a tenth is forbidden), so the inline bootstrap cannot be widened
 * directly. The tree's established answer is a self-heal installer beside the
 * frozen file that executes the CANONICAL MIGRATION TEXT — the arrangement used by
 * server/lib/spvSubscriptionDisplayNameSchema.ts (W338), server/lib/mfaSchema.ts
 * (W305), server/lib/platformConfigShapeSchema.ts (W314b) and others.
 * scripts/lint/schema-path-parity.mjs forgives the divergence when the migration's
 * BASENAME appears as a value in a non-test server file — which is why
 * ANGEL_CHAPTER_CARRY_MIGRATION below is an exported constant and not a comment.
 *
 * WHAT IT DOES.
 *   section 1  runs the self-sufficiency DDL (`CREATE TABLE IF NOT EXISTS
 *              mf_angel_chapter` + its index) so neither this installer nor the
 *              migration can fail with "no such table".
 *   section 2  adds `carry_bps_recorded` ONLY when `PRAGMA table_info` shows it
 *              absent. Re-inspected on every call, so it is correct on a database
 *              some other path has already widened.
 *   section 3  is ASSERTED TO CONTAIN NO EXECUTABLE STATEMENT and is not run. The
 *              migration deliberately has no backfill: on rows already stored, a
 *              deliberate 0% carry and a defaulted 0% carry are indistinguishable,
 *              so anything written there would be a guess about a commercial term.
 *              The installer instead COUNTS those ambiguous rows and reports them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *   · No DROP, no DELETE, no UPDATE, no table rebuild. It never writes `carry_bps`.
 *   · It does not invent a carry rate, and it does not convert a legacy 0 into
 *     either state.
 *
 * DRIFT IS FAILED LOUDLY, NOT ASSUMED AWAY:
 * server/__tests__/w340_angel_chapter_carry_not_set.test.ts asserts
 * ANGEL_CHAPTER_CARRY_SQL is byte-identical to BOTH .sql copies.
 */

/** The migration this module mirrors. Referenced as a VALUE, not in a comment, so
 *  scripts/lint/schema-path-parity.mjs (which strips comments first) can see it. */
export const ANGEL_CHAPTER_CARRY_MIGRATION =
  "0233_wave340_angel_chapter_carry_not_recorded.sql";

/** The column this wave adds. Named once, here, so no consumer re-spells it. */
export const ANGEL_CHAPTER_CARRY_COLUMN = "carry_bps_recorded";

/** The migration file, verbatim. Only \\ ` and ${ are escaped for the template
 *  literal; JS unescapes them back to the exact file bytes. */
export const ANGEL_CHAPTER_CARRY_SQL = `-- 0233 · WAVE 340 · mf_angel_chapter.carry_bps_recorded (ADDITIVE ONLY)
--
-- WHAT THIS FILE DOES, IN ONE SENTENCE.
-- It adds one new, NULLABLE integer column that holds a carry rate ONLY when a
-- human actually recorded one, so that "no carry rate has been agreed" and "a
-- carry rate of exactly 0% has been agreed" stop being the same stored value.
-- Nothing is dropped, nothing is renamed, nothing is deleted, and NOT ONE
-- EXISTING ROW IS WRITTEN BY THIS FILE.
--
-- THE DEFECT THIS ADDRESSES.
-- \`mf_angel_chapter.carry_bps\` is declared \`INTEGER NOT NULL DEFAULT 0\` (the
-- table's only DDL is the lazy \`CREATE TABLE IF NOT EXISTS\` in
-- server/mfcrmAngelStore.ts), and BOTH writers coerce absent input to 0
-- (\`createChapter\`, \`setChapterCarry\`). A chapter created with the Carry box left
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
-- WHY A COMPANION COLUMN AND NOT A NULLABLE \`carry_bps\`.
-- Making \`carry_bps\` itself nullable is impossible in SQLite without a TABLE
-- REBUILD (create-copy-drop-rename). That is destructive SQL on a live table and
-- is forbidden here. This file is additive-only, which is the only safe shape:
-- \`carry_bps\` keeps its declaration, keeps its value on every existing row, and
-- every existing reader of it keeps working unchanged.
--
-- WHAT THE TWO COLUMNS MEAN AFTER THIS MIGRATION.
--   carry_bps_recorded IS NOT NULL  a human recorded this rate. 0 here is a REAL,
--                                   DELIBERATE 0% and is rendered as 0.00%.
--   carry_bps_recorded IS NULL
--     AND carry_bps > 0             a rate recorded BEFORE this migration. It is
--                                   still shown, from \`carry_bps\`. Nothing is
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
--   section 1  every statement is \`IF NOT EXISTS\`.
--   section 2  \`ADD COLUMN\` on an existing column raises \`duplicate column name\`,
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
-- table rebuild, and no write of any kind to \`carry_bps\`.


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
-- not cap the upper bound, because \`carry_bps\` next to it does not either and this
-- migration is not the place to start refusing values the old column accepts.

ALTER TABLE mf_angel_chapter ADD COLUMN carry_bps_recorded INTEGER
  CHECK (carry_bps_recorded IS NULL OR carry_bps_recorded >= 0);


-- §3 · THE BACKFILL THAT MUST NOT EXIST.
--
-- There is no UPDATE in this section and there must never be one. Consider what a
-- backfill could possibly write:
--
--   * \`carry_bps_recorded = carry_bps\` for every row would declare that EVERY
--     pre-existing chapter has a recorded rate, including the ones whose 0 was
--     never typed by anybody. That is the fabricated zero, promoted to a claim.
--   * \`carry_bps_recorded = carry_bps WHERE carry_bps > 0\` looks safer, and this
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
`;

/** The migration's three sections, split on its own line-anchored `-- §N ·`
 *  banners. Those banners appear ONLY as section headers in that file; prose
 *  references to a section are spelled "section N" precisely so they cannot match. */
export function angelChapterCarrySections(): string[] {
  const parts = ANGEL_CHAPTER_CARRY_SQL.split(/\n(?=-- \u00a7\d+ \u00b7 )/);
  // parts[0] is the file header, which contains no statements.
  return parts.slice(1);
}

/** Comment-only lines removed, so a commented-out statement can never be executed
 *  or counted. */
function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");
}

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): unknown;
}

export interface AngelChapterCarryResult {
  /** true when section 1 had to create `mf_angel_chapter` from scratch. */
  tableCreated: boolean;
  /** true when the column was absent and this call added it. */
  columnAdded: boolean;
  /** true when the column was already there, so section 2 was skipped. */
  columnAlreadyPresent: boolean;
  /** total rows in the table after this call. */
  totalRows: number;
  /** rows where a rate IS recorded (`carry_bps_recorded IS NOT NULL`), including a
   *  deliberate 0. */
  recordedRows: number;
  /** rows with NO recorded rate but a non-zero legacy `carry_bps`. These still
   *  render their legacy rate; nothing is hidden. */
  legacyNonZeroRows: number;
  /** rows with NO recorded rate and `carry_bps = 0`. THE AMBIGUOUS SET: created
   *  before this migration, a deliberate 0% and a defaulted 0% cannot be told
   *  apart. Reported, never guessed at. */
  ambiguousLegacyZeroRows: number;
  /** anything that threw for a reason other than "already there". Non-empty means
   *  the install did NOT fully succeed. */
  failures: string[];
}

/**
 * Install migration 0233's column on the handle given, idempotently.
 *
 * READ THE RESULT. It reports what it did rather than asserting success.
 */
export function ensureAngelChapterCarryRecorded(db: DbLike): AngelChapterCarryResult {
  const res: AngelChapterCarryResult = {
    tableCreated: false,
    columnAdded: false,
    columnAlreadyPresent: false,
    totalRows: 0,
    recordedRows: 0,
    legacyNonZeroRows: 0,
    ambiguousLegacyZeroRows: 0,
    failures: [],
  };
  const sections = angelChapterCarrySections();
  if (sections.length !== 3) {
    res.failures.push(
      `expected 3 sections in ${ANGEL_CHAPTER_CARRY_MIGRATION}, parsed ${sections.length}`,
    );
    return res;
  }

  /* section 3 MUST stay empty of statements. Asserted BEFORE anything runs, so a
     future edit that slips a backfill in there fails the install loudly instead of
     quietly writing a guess into a money column. */
  if (stripCommentLines(sections[2]).trim() !== "") {
    res.failures.push(
      "section 3 of the migration contains an executable statement; it must contain none " +
        "(a backfill would have to guess whether a stored 0 was deliberate)",
    );
    return res;
  }

  const tableBefore = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mf_angel_chapter'")
      .all() as Array<{ name: string }>
  ).length;
  try {
    db.exec(stripCommentLines(sections[0]));
  } catch (e) {
    res.failures.push(`section 1: ${String((e as Error)?.message ?? e)}`);
    return res;
  }
  const tableAfter = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mf_angel_chapter'")
      .all() as Array<{ name: string }>
  ).length;
  if (tableBefore === 0 && tableAfter === 1) res.tableCreated = true;
  if (tableAfter === 0) {
    res.failures.push("section 1 ran but mf_angel_chapter still does not exist");
    return res;
  }

  const have = new Set(
    (db.prepare("PRAGMA table_info(mf_angel_chapter)").all() as Array<{ name: string }>).map((r) =>
      String(r.name).toLowerCase(),
    ),
  );
  if (have.has(ANGEL_CHAPTER_CARRY_COLUMN)) {
    res.columnAlreadyPresent = true;
  } else {
    try {
      db.exec(stripCommentLines(sections[1]));
      res.columnAdded = true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/duplicate column name/i.test(msg)) res.columnAlreadyPresent = true;
      else {
        res.failures.push(`section 2: ${msg}`);
        return res;
      }
    }
  }

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN carry_bps_recorded IS NOT NULL THEN 1 ELSE 0 END) AS recorded,
              SUM(CASE WHEN carry_bps_recorded IS NULL AND carry_bps <> 0 THEN 1 ELSE 0 END) AS legacyNonZero,
              SUM(CASE WHEN carry_bps_recorded IS NULL AND carry_bps = 0 THEN 1 ELSE 0 END) AS ambiguous
         FROM mf_angel_chapter`,
    )
    .get() as Record<string, number | null>;
  res.totalRows = Number(counts?.total ?? 0);
  res.recordedRows = Number(counts?.recorded ?? 0);
  res.legacyNonZeroRows = Number(counts?.legacyNonZero ?? 0);
  res.ambiguousLegacyZeroRows = Number(counts?.ambiguous ?? 0);
  return res;
}
