/**
 * server/lib/spvSubscriptionDisplayNameSchema.ts — WAVE 338.
 *
 * GENERATED. Source of truth: migrations/0232_wave338_spv_subscription_display_name.sql
 * (byte-identically mirrored at
 *  server/db/migrations/0232_wave338_spv_subscription_display_name.sql).
 * Generator: build_log/w338/evidence/gen_installer.py. The SQL below is the
 * migration file's bytes, embedded — not a paraphrase, not a re-typing.
 *
 * WHY THIS FILE EXISTS — THE THIRD SCHEMA HOME.
 * ---------------------------------------------
 * This platform has TWO schema paths:
 *   PATH 1  migrations/NNNN_*.sql, applied by server/db/migrate.ts. What a real
 *           deploy gets.
 *   PATH 2  the inline bootstrap inside server/db/connection.ts, which builds the
 *           sandbox database, the dev database and EVERY `:memory:` test database.
 *
 * A migration shipped into PATH 1 alone leaves PATH 1 and PATH 2 disagreeing, and
 * `npm run lint:schema-path-parity` fails mechanically on that disagreement — it
 * reports the new `column:spv_subscription.investor_display_name` as a divergence.
 * server/db/connection.ts is SACRED-FROZEN (scripts/sacred_check.sh pins its
 * sha256; there are nine owner-ratified waivers and a tenth is forbidden), so the
 * inline bootstrap cannot be widened directly. The tree's established answer to
 * exactly this situation is a self-heal installer beside the frozen file that
 * executes the CANONICAL MIGRATION TEXT — the arrangement used by
 * server/lib/mfaSchema.ts (W305), server/lib/platformConfigShapeSchema.ts (W314b),
 * server/lib/rateLimitStoreSchema.ts (W21) and others.
 * scripts/lint/schema-path-parity.mjs names that as the accepted remedy in its own
 * failure message, and forgives the divergence when the migration's BASENAME
 * appears as a value in a non-test server file — which is why
 * SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION below is an exported constant and not a
 * comment.
 *
 * WHAT IT DOES.
 *   section 1  runs the self-sufficiency DDL (`CREATE TABLE IF NOT EXISTS
 *              spv_subscription` + its three indexes) so that neither this
 *              installer nor the migration can fail with "no such table".
 *   section 2  adds `investor_display_name` ONLY when `PRAGMA table_info` shows it
 *              absent. Re-inspected on every call, so it is correct on a database
 *              some other path has already widened.
 *   section 3  runs the migration's own guarded backfill UPDATE and REPORTS THE
 *              ROW COUNT IT ACTUALLY CHANGED. It does not report a success it did
 *              not achieve.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *   · It contains no DROP, no DELETE, no table rebuild, and it never writes to
 *     `investor_id` (R195.5).
 *   · It does not invent a display name. Ambiguous rows are left NULL — see the
 *     migration header for the exact rule and its stated asymmetries.
 *
 * DRIFT IS FAILED LOUDLY, NOT ASSUMED AWAY:
 * server/__tests__/w338_spv_subscription_display_name.test.ts asserts
 * SPV_SUBSCRIPTION_DISPLAY_NAME_SQL is byte-identical to BOTH .sql copies.
 */

/** The migration this module mirrors. Referenced as a VALUE, not in a comment, so
 *  scripts/lint/schema-path-parity.mjs (which strips comments first) can see it. */
export const SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION =
  "0232_wave338_spv_subscription_display_name.sql";

/** The column this wave adds. Named once, here, so no consumer re-spells it. */
export const SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN = "investor_display_name";

/** The migration file, verbatim. Only \\ ` and ${ are escaped for the template
 *  literal; JS unescapes them back to the exact file bytes. */
export const SPV_SUBSCRIPTION_DISPLAY_NAME_SQL = `-- 0232 · WAVE 338 · spv_subscription.investor_display_name (ADDITIVE ONLY)
--
-- WHAT THIS FILE DOES, IN ONE SENTENCE.
-- It adds one new, nullable text column that is allowed to hold a person's or a
-- firm's DISPLAY NAME, and it copies into that column only those existing
-- \`investor_id\` values that are UNAMBIGUOUSLY display names. Everything else is
-- left NULL. Nothing is dropped, nothing is renamed, nothing is deleted, and
-- \`investor_id\` itself is not touched by a single statement in this file.
--
-- THE DEFECT THIS ADDRESSES.
-- \`spv_subscription.investor_id\` — a column whose name says "id" — sometimes
-- contains display text. Confirmed live: the partner LP-roster endpoint returned
-- \`investorId: "Mark Invest Partners"\` for a real subscription. Every screen that
-- reads that column must therefore GUESS whether it is holding a storage key or a
-- human-readable name, and the guess is made by a text heuristic
-- (\`displayNameFromNonIdentifier\` in shared/partyIdentifierShape.ts) rather than
-- by the schema.
--
-- WHY \`investor_id\` IS NOT RENAMED, NORMALISED OR RE-KEYED. NON-NEGOTIABLE.
-- The same string is used as a JSON OBJECT KEY inside \`spv.terms._fundsConfirmations\`,
-- where money is matched against it (live: the key "Mark Invest Partners" carries
-- receivedMinor 250000 / expectedMinor 250000 / status "matched"). A display string
-- is currently load-bearing as a money key. Renaming, trimming, casing or re-keying
-- that value would break the association between an investor and their money.
-- ADDITIVE-ONLY IS THE ONLY SAFE SHAPE. This file is additive-only.
--
-- SELF-SUFFICIENCY (section 1). WHY A \`CREATE TABLE\` APPEARS IN AN ALTER MIGRATION.
-- A recent live install FAILED because a migration assumed a table that another
-- migration creates, and the boot path rolled that table back inside its own
-- transaction — so the assumption was true when it was written and false when it
-- ran. server/db/migrate.ts:applyOne wraps every migration file in
-- \`db.transaction(...)\`, which is exactly the mechanism that produced that
-- failure. This file therefore CREATES ITS OWN DEPENDENCY IF MISSING, with
-- \`IF NOT EXISTS\`, using DDL COPIED BYTE-IDENTICALLY out of
-- migrations/0084_v25_49_spv_engine.sql lines 93-117 — copied by script, never
-- retyped. On any database that already has the table (i.e. every real one) the
-- three statements of section 1 are no-ops.
--
-- IDEMPOTENCE — SAFE TO RUN TWICE, AND SAFE WHERE THE COLUMN ALREADY EXISTS.
--   section 1  every statement is \`IF NOT EXISTS\`.
--   section 2  \`ADD COLUMN\` on an existing column raises \`duplicate column name\`,
--              which server/db/migrate.ts:295 isIdempotentSqliteError() classifies
--              as idempotent and skips at per-statement granularity.
--   section 3  the UPDATE is guarded by \`investor_display_name IS NULL\`, so a
--              second run writes zero rows and — importantly — a value a human has
--              since corrected by hand is NEVER overwritten.
--
-- THREE HOMES, NO DRIFT. This file is mirrored byte-identically at
-- server/db/migrations/0232_wave338_spv_subscription_display_name.sql, and its
-- bytes are embedded verbatim in server/lib/spvSubscriptionDisplayNameSchema.ts
-- because server/db/connection.ts is SACRED-FROZEN (scripts/sacred_check.sh) and
-- may not be edited to widen the inline bootstrap. All three are asserted
-- byte-identical by server/__tests__/w338_spv_subscription_display_name.test.ts.


-- §1 · SELF-SUFFICIENCY. Copied byte-identically from
-- migrations/0084_v25_49_spv_engine.sql lines 93-117. A no-op on every database
-- that already has the table. See the header for why it is here at all.

-- One LP commitment. investor_id FKs the canonical investor/user; gate refs
-- point at the reusable investor_compliance_profile. Unified across all 3 LP
-- personas (collective member / capavate investor / consortium partner).
CREATE TABLE IF NOT EXISTS spv_subscription (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  investor_id   TEXT NOT NULL,
  investor_persona TEXT,                                  -- collective | capavate | partner
  commitment_minor INTEGER NOT NULL,
  wired_minor   INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL DEFAULT 'review',           -- review|soft_circled|founder_confirmed|wire_funded|committed|withdrawn
  kyc_ref       TEXT,
  accreditation_ref TEXT,
  subscription_doc_ref TEXT,
  ownership_pct REAL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  curr_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spv_subscription_spv ON spv_subscription (spv_id);
CREATE INDEX IF NOT EXISTS idx_spv_subscription_investor ON spv_subscription (investor_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spv_subscription_spv_investor ON spv_subscription (spv_id, investor_id);

-- §2 · THE NEW COLUMN. Nullable TEXT, no default, no constraint. Nullable is not
-- laziness: NULL is the load-bearing value in this design. It means "this row's
-- display name is NOT KNOWN", which is the truth for every row whose \`investor_id\`
-- is ambiguous. A default of '' would replace that truth with a claim.

ALTER TABLE spv_subscription ADD COLUMN investor_display_name TEXT;


-- §3 · THE BACKFILL. THIS IS THE DANGEROUS PART, AND IT IS DELIBERATELY NARROW.
--
-- This is the SQL transcription of \`displayNameFromNonIdentifier\`
-- (shared/partyIdentifierShape.ts). A wrong value written here becomes a LIE
-- STORED IN THE DATABASE, which is strictly worse than the lie currently being
-- DISPLAYED, because a displayed guess disappears when the display code is fixed
-- and a stored guess does not. So where a value is ambiguous, this writes NOTHING
-- and the column stays NULL. It never guesses.
--
-- THE RULE, in words: copy \`TRIM(investor_id)\` into the new column only when the
-- trimmed value is non-empty, is at most 200 characters, contains NO underscore,
-- contains at least one SPACE, and contains at least one ASCII letter.
--
-- WHY EACH CLAUSE.
--   investor_display_name IS NULL   never overwrite an existing or hand-corrected
--                                   value; this is also what makes re-running safe.
--   investor_id IS NOT NULL         the column is NOT NULL in the schema, but a
--                                   database built by another path may differ; a
--                                   NULL here would make every later test UNKNOWN
--                                   and silently skip the row, which is the right
--                                   outcome but should be spelled, not inherited.
--   TRIM(...) <> ''                 mirrors the TS guard on the empty string.
--   LENGTH(TRIM(...)) <= 200        mirrors PARTY_DISPLAY_NAME_MAX_LENGTH = 200.
--                                   NOTE: SQLite LENGTH() on TEXT counts
--                                   CHARACTERS, matching JavaScript \`.length\` for
--                                   the BMP. Both count astral characters
--                                   differently (JS counts surrogate pairs as 2),
--                                   so a >200 name made of astral characters could
--                                   be judged differently by the two. It would be
--                                   judged TOO LONG by JS and possibly SHORT ENOUGH
--                                   by SQLite, i.e. the SQL is the more permissive
--                                   side on that one exotic input. Recorded, not
--                                   hidden.
--   INSTR(investor_id, '_') = 0     mirrors the TS \`raw.includes("_")\` rejection.
--                                   Note it tests the UNTRIMMED value, exactly as
--                                   the TS predicate does.
--   TRIM(...) LIKE '% %'            mirrors the TS \`/\\s/\` whitespace requirement.
--                                   THIS IS AN ASYMMETRY AND IT MUST BE STATED:
--                                   the TypeScript predicate accepts ANY whitespace
--                                   (tab, newline, non-breaking space); this SQL
--                                   accepts only the ASCII SPACE. The SQL is
--                                   therefore NARROWER. A value separated by a tab
--                                   would be shown as a name by the live display
--                                   heuristic but left NULL here. Narrower is the
--                                   safe direction: it leaves a row alone rather
--                                   than storing a guess about it.
--   GLOB '*[A-Za-z]*'               THE ONE DELIBERATE NARROWING BEYOND THE TS
--                                   PREDICATE. The TS heuristic would accept
--                                   "123 456" as a display name. Storing that as a
--                                   person's name would be a fabrication, so at
--                                   least one ASCII letter is required. Consequence,
--                                   stated plainly: a legitimate name written only
--                                   in a non-Latin script (e.g. Japanese or Arabic
--                                   with a space) is ALSO left NULL by this clause.
--                                   That row keeps exactly today's behaviour. It is
--                                   not made worse; it is simply not improved.
--   NOT GLOB 'u_*' … 'mp_*'         the nine PARTY_IDENTIFIER_PREFIXES, in the order
--                                   they are declared in shared/partyIdentifierShape.ts.
--                                   Every one of them contains an underscore, so
--                                   \`INSTR(...,'_') = 0\` above already excludes them
--                                   and these nine clauses are REDUNDANT BY
--                                   CONSTRUCTION. They are written out anyway, one
--                                   per line, so that this file is a line-by-line
--                                   readable transcription of the TypeScript
--                                   predicate and a reviewer never has to reason
--                                   about which of the nine is covered by which
--                                   clause. \`LOWER()\` matches the TS
--                                   case-insensitive prefix test.
--
-- WHAT STAYS NULL, ON PURPOSE, FOREVER (until a human types the real name):
--   "Blackstone"                     one word — could be a firm, could be a login
--   "Acme"                           same
--   "jsmith"                         same
--   "u_redeemed_1783181835779"       a real storage id
--   "co_261cb9e192f7"                a real storage id
--   "123 456"                        no letters
--   any value longer than 200 characters
--   '' or '   '                      empty after trimming
--
-- NO DESTRUCTIVE SQL APPEARS IN THIS FILE. No DROP, no DELETE, no table rebuild,
-- no write of any kind to \`investor_id\` (R195.5).

UPDATE spv_subscription
   SET investor_display_name = TRIM(investor_id)
 WHERE investor_display_name IS NULL
   AND investor_id IS NOT NULL
   AND TRIM(investor_id) <> ''
   AND LENGTH(TRIM(investor_id)) <= 200
   AND INSTR(investor_id, '_') = 0
   AND TRIM(investor_id) LIKE '% %'
   AND TRIM(investor_id) GLOB '*[A-Za-z]*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'u_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'ac_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'co_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'ext_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'spvlp_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'spv_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'round_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'inv_*'
   AND LOWER(TRIM(investor_id)) NOT GLOB 'mp_*';
`;

/** The migration's three sections, split on its own line-anchored `-- \u00a7N \u00b7`
 *  banners. Those banners appear ONLY as section headers in that file; prose
 *  references to a section are spelled "section N" precisely so they cannot match.
 *  Returns the banner line with each body, which is harmless (it is a comment) and
 *  keeps the split verifiable by eye. */
export function spvSubscriptionDisplayNameSections(): string[] {
  const parts = SPV_SUBSCRIPTION_DISPLAY_NAME_SQL.split(/\n(?=-- \u00a7\d+ \u00b7 )/);
  // parts[0] is the file header, which contains no statements.
  return parts.slice(1);
}

/** Comment-only lines removed, so a commented-out statement can never be executed
 *  or counted (the decoy class of R237.4). Trailing inline comments are left
 *  alone: SQLite parses them correctly and removing them would change the bytes
 *  copied from 0084. */
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

export interface SpvSubscriptionDisplayNameResult {
  /** true when section 1 had to create `spv_subscription` from scratch. */
  tableCreated: boolean;
  /** true when the column was absent and this call added it. */
  columnAdded: boolean;
  /** true when the column was already there, so section 2 was skipped. */
  columnAlreadyPresent: boolean;
  /** rows the backfill UPDATE actually changed on this call. A truthful zero on a
   *  second run; a truthful zero on a database with no qualifying rows. */
  backfilled: number;
  /** rows still NULL in the column after this call — i.e. rows whose display name
   *  remains UNKNOWN. Reported because it is the honest other half of
   *  `backfilled`. */
  leftNull: number;
  /** total rows in the table after this call. */
  totalRows: number;
  /** anything that threw for a reason other than "already there". Non-empty means
   *  the install did NOT fully succeed. */
  failures: string[];
}

/**
 * Install migration 0232's schema and backfill on the handle given, idempotently.
 *
 * READ THE RESULT. It reports what it did rather than asserting success (R265.1).
 */
export function ensureSpvSubscriptionDisplayName(db: DbLike): SpvSubscriptionDisplayNameResult {
  const res: SpvSubscriptionDisplayNameResult = {
    tableCreated: false,
    columnAdded: false,
    columnAlreadyPresent: false,
    backfilled: 0,
    leftNull: 0,
    totalRows: 0,
    failures: [],
  };
  const sections = spvSubscriptionDisplayNameSections();
  if (sections.length !== 3) {
    res.failures.push(
      `expected 3 sections in ${SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION}, parsed ${sections.length}`,
    );
    return res;
  }

  /* section 1 — SELF-SUFFICIENCY. Every statement is IF NOT EXISTS, so this is a
     no-op wherever the table already exists. Recording whether it had to create
     the table is the only way the caller can tell a fresh database from a real
     one, and the migration's whole self-sufficiency claim is unproved without it. */
  const tableBefore = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spv_subscription'")
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
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spv_subscription'")
      .all() as Array<{ name: string }>
  ).length;
  if (tableBefore === 0 && tableAfter === 1) res.tableCreated = true;
  if (tableAfter === 0) {
    res.failures.push("section 1 ran but spv_subscription still does not exist");
    return res;
  }

  /* section 2 — THE COLUMN. PRAGMA-inspected every call. */
  const have = new Set(
    (db.prepare("PRAGMA table_info(spv_subscription)").all() as Array<{ name: string }>).map((r) =>
      String(r.name).toLowerCase(),
    ),
  );
  if (have.has(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN)) {
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

  /* section 3 — THE BACKFILL. Prepared rather than exec'd, because `exec` cannot
     report a row count and an uncounted backfill is exactly the defect that once
     shipped as FAILED=0 with zero rows written. */
  const update = stripCommentLines(sections[2]).trim().replace(/;\s*$/, "");
  try {
    const info = db.prepare(update).run() as { changes?: number };
    res.backfilled = typeof info?.changes === "number" ? info.changes : 0;
  } catch (e) {
    res.failures.push(`section 3: ${String((e as Error)?.message ?? e)}`);
    return res;
  }

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN investor_display_name IS NULL THEN 1 ELSE 0 END) AS nulls
         FROM spv_subscription`,
    )
    .get() as { total?: number; nulls?: number | null };
  res.totalRows = Number(counts?.total ?? 0);
  res.leftNull = Number(counts?.nulls ?? 0);
  return res;
}
