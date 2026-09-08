/**
 * server/lib/recordArchiveSchema.ts — WAVE 344 · ITEM 2 (ARCHIVE).
 *
 * GENERATED. Source of truth: migrations/0234_wave344_record_archive.sql
 * (byte-identically mirrored at
 *  server/db/migrations/0234_wave344_record_archive.sql).
 * Generator: build_log/ownerband2/evidence/gen_installer_0234.py. The SQL below is
 * the migration file's bytes, embedded — not a paraphrase, not a re-typing.
 *
 * WHY THIS FILE EXISTS — THE THIRD SCHEMA HOME.
 * This platform has TWO schema paths: migrations/NNNN_*.sql applied by
 * server/db/migrate.ts (what a real deploy gets), and the inline bootstrap inside
 * server/db/connection.ts, which builds the sandbox database, the dev database and
 * every in-memory test database. A migration shipped into the first alone leaves
 * the two disagreeing, and `npm run lint:schema-path-parity` fails on exactly that
 * disagreement. server/db/connection.ts is SACRED-FROZEN and may not be edited to
 * widen the inline bootstrap — ten owner-ratified waivers exist and the tenth is
 * SPENT, so there is no eleventh available to this work. The tree's established
 * answer is a self-heal installer beside the frozen file that executes the
 * CANONICAL MIGRATION TEXT: the arrangement used by
 * server/lib/angelChapterCarrySchema.ts (W340),
 * server/lib/spvSubscriptionDisplayNameSchema.ts (W338), server/lib/mfaSchema.ts
 * (W305) and others. RECORD_ARCHIVE_MIGRATION below is an exported CONSTANT rather
 * than a comment precisely because the parity lint strips comments before it looks.
 *
 * WHAT IT DOES.
 *   section 1  creates `record_archive` if it is absent.
 *   section 2  creates its three indexes if they are absent.
 *   section 3  creates its three refusal triggers if they are absent.
 *   section 4  is ASSERTED TO CONTAIN NO EXECUTABLE STATEMENT and is not run. The
 *              migration deliberately has no backfill: a backfill would archive
 *              records no human chose to archive, which is the invisible change
 *              this whole feature exists to prevent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *   · It does not ALTER any pre-existing table, so no tamper-sealed table and no
 *     money table is named in any statement it runs.
 *   · No DROP, no DELETE, no UPDATE, no table rebuild.
 *   · It never reads or writes `deleted_at` on any table. The existing
 *     `founder_crm_contacts.deleted_at` is an irreversible delete that hides rows
 *     from audit too; this feature is built ALONGSIDE it and leaves it alone.
 *
 * DRIFT IS FAILED LOUDLY, NOT ASSUMED AWAY:
 * server/__tests__/w344_item2_record_archive.test.ts asserts RECORD_ARCHIVE_SQL is
 * byte-identical to BOTH .sql copies, and asserts the allowlist parsed out of that
 * SQL has exactly eight members.
 */

/** The migration this module mirrors. Referenced as a VALUE, not in a comment, so
 *  scripts/lint/schema-path-parity.mjs (which strips comments first) can see it. */
export const RECORD_ARCHIVE_MIGRATION = "0234_wave344_record_archive.sql";

/** The one table this wave adds. Named once, here, so no consumer re-spells it. */
export const RECORD_ARCHIVE_TABLE = "record_archive";

/** The migration file, verbatim. Only \\ ` and ${ are escaped for the template
 *  literal; JS unescapes them back to the exact file bytes. */
export const RECORD_ARCHIVE_SQL = `-- 0234 · WAVE 344 · record_archive — A REVERSIBLE ARCHIVE REGISTRY (ADDITIVE ONLY)
--
-- WHAT THIS FILE DOES, IN ONE SENTENCE.
-- It creates ONE new table that records "this record has been put away", so that a
-- record can be hidden from a working list and then brought back, without the
-- record itself being touched, altered, moved or deleted.
--
-- NOTHING IS DROPPED. NOTHING IS RENAMED. NOTHING IS DELETED. NOT ONE COLUMN IS
-- ADDED TO ANY EXISTING TABLE, AND NOT ONE EXISTING ROW IS WRITTEN BY THIS FILE.
--
-- ── THE OWNER'S QUESTION THIS ANSWERS ──────────────────────────────────────
-- The owner asked how he could "archive" or remove test records. He accepted the
-- recommendation NOT to delete them. This file is the archive. It is not a delete
-- with better manners: the archived row stays exactly where it was, keeps its
-- history, keeps any tamper-proof seal it carries, and stays visible in audit and
-- administrator views. Only working lists leave it out, and every count that
-- leaves it out has to say so on screen.
--
-- ── WHY A SEPARATE REGISTRY TABLE, AND NOT A COLUMN ON EACH TABLE ──────────
-- The obvious design is \`ALTER TABLE <t> ADD COLUMN archived_at\`. It was measured
-- and REJECTED, for three reasons, each of which was checked against this
-- database and not assumed:
--
--   1. THE RECORDS THE OWNER NAMED LIVE PARTLY IN TAMPER-SEALED TABLES. Of the
--      eight kinds of record in scope, "pipeline cards" resolve to
--      partner_deal_pipeline and "portfolio companies" resolve to
--      partner_portfolio_companies and partner_portfolio_company. All three carry
--      prev_hash / curr_hash seal columns and all three are walked by the audit
--      chain verifier. partner_portfolio_companies also carries a money column
--      (lead_invested_amount_minor). The instruction for this work is that
--      archiving must NEVER touch a tamper-sealed table or a money row. Adding a
--      column to those tables would breach it on the first migration statement.
--      A registry breaches nothing: the sealed tables are never named in any
--      write this feature performs.
--
--   2. THERE ARE COMPETING TABLES FOR THE SAME IDEA, AND THE WRONG CHOICE IS
--      SILENT. "Contacts" alone exists as contacts, founder_crm_contacts,
--      investor_crm_contacts, partner_crm_contacts, pcrm_contacts and
--      sync_pcrm_contact. "Portfolio companies" exists in both a plural and a
--      singular spelling. A column added to the wrong one produces a feature that
--      looks like it works and archives nothing. With a registry, the binding
--      between a kind of record and its table lives in ONE named place in
--      application code (server/lib/recordArchiveSchema.ts:ARCHIVABLE_ENTITY_TYPES
--      and server/recordArchiveStore.ts), where it is asserted by test, instead of
--      being implied by fifteen separate ALTER statements nobody can see at once.
--
--   3. AN EXISTING "DELETE" ON THIS PLATFORM IS ALREADY THE THING TO AVOID.
--      founder_crm_contacts.deleted_at is read as \`deleted_at IS NULL\` by ten
--      call sites, it hides the row from EVERY surface including administrator and
--      audit views, and nothing in the interface reverses it. This file does NOT
--      extend, reuse, imitate or write that column, and the archive predicate is
--      deliberately a different one so the two can never be confused.
--
-- ── WHAT IS ARCHIVABLE, AND WHAT IS REFUSED ────────────────────────────────
-- The CHECK on entity_type below is a CLOSED allowlist. It is not a suggestion and
-- it is not a default: a kind of record that is not named there cannot be written
-- into this table at all, so the database itself refuses rather than relying on an
-- interface check that a future caller might skip.
--
--   ARCHIVABLE   contact · pipeline_card · note · task · post · file · client ·
--                portfolio_company
--
--   REFUSED      an investment vehicle (SPV), a commitment, a subscription, a fee,
--                a distribution, a cap-table row, and every audit row. These are
--                money and record-of-account. Hiding one from a list is how a
--                total quietly changes. Two things refuse them: they are absent
--                from the allowlist, and trg_record_archive_refuse_money_kinds
--                below names the common spellings explicitly so the error a caller
--                sees says WHY rather than just "constraint failed".
--
-- ── HOW IT IS REVERSIBLE, AND WHY THAT IS NOT A DELETE ─────────────────────
-- Un-archiving does NOT remove the registry row. It sets state='active' and stamps
-- unarchived_at / unarchived_by_user_id, so the fact that the record was once
-- archived, by whom, when, and why, survives the reversal. The pair of triggers
-- below make that the only possible behaviour: rows in this table can never be
-- deleted, and the original archive stamp can never be rewritten.
--
-- ── IDEMPOTENCE — SAFE TO RUN TWICE ────────────────────────────────────────
--   section 1  CREATE TABLE IF NOT EXISTS.
--   section 2  CREATE INDEX IF NOT EXISTS (x3).
--   section 3  CREATE TRIGGER IF NOT EXISTS (x3).
--   section 4  contains NO STATEMENTS AT ALL, by design. There is no backfill and
--              there must never be one: a backfill here would archive records
--              nobody asked to archive, which is precisely the invisible change
--              this whole feature exists to prevent.
--
-- ── THREE HOMES, NO DRIFT ──────────────────────────────────────────────────
-- This file is mirrored byte-identically at
-- server/db/migrations/0234_wave344_record_archive.sql, and its bytes are embedded
-- verbatim in server/lib/recordArchiveSchema.ts, because server/db/connection.ts is
-- SACRED-FROZEN (scripts/sacred_check.sh) and may not be edited to widen the inline
-- bootstrap that builds the sandbox, dev and every in-memory test database. All
-- three copies are asserted byte-identical by
-- server/__tests__/w344_item2_record_archive.test.ts.
--
-- ── NO DESTRUCTIVE SQL APPEARS IN THIS FILE ────────────────────────────────
-- No DROP. No DELETE. No UPDATE. No table rebuild. No write to any pre-existing
-- table. Every RAISE argument is a single string literal, so a host sqlite3 older
-- than 3.47 can still read this schema (scripts/lint/raise_literal_fence.mjs).


-- §1 · THE REGISTRY TABLE.
--
-- One row per (tenant, kind of record, record id). The record itself is NOT
-- referenced by a foreign key on purpose: a foreign key would tie this table to one
-- physical table per kind, which is the coupling this design exists to avoid, and a
-- cascade on a foreign key is a delete path.

CREATE TABLE IF NOT EXISTS record_archive (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT NOT NULL,
  entity_type           TEXT NOT NULL,
  record_id             TEXT NOT NULL,
  -- 'archived' means working lists leave this record out. 'active' means it has
  -- been brought back. There is no third state and no 'deleted' state.
  state                 TEXT NOT NULL DEFAULT 'archived',
  archived_at           TEXT NOT NULL,
  archived_by_user_id   TEXT NOT NULL,
  archive_reason        TEXT,
  unarchived_at         TEXT,
  unarchived_by_user_id TEXT,
  CHECK (state IN ('archived', 'active')),
  -- THE CLOSED ALLOWLIST. Money and record-of-account kinds are absent by design.
  CHECK (entity_type IN (
    'contact',
    'pipeline_card',
    'note',
    'task',
    'post',
    'file',
    'client',
    'portfolio_company'
  )),
  -- An archive stamp with no actor is not an archive record, it is a rumour.
  CHECK (length(trim(archived_by_user_id)) > 0),
  CHECK (length(trim(record_id)) > 0),
  CHECK (length(trim(tenant_id)) > 0),
  -- 'active' is only reachable by un-archiving, which must stamp who and when.
  CHECK (state = 'archived' OR (unarchived_at IS NOT NULL AND unarchived_by_user_id IS NOT NULL))
);


-- §2 · INDEXES.
--
-- The unique index is load-bearing: it makes "archive the same record twice" a
-- no-op-or-update rather than two competing rows, so there can never be two
-- disagreeing answers about whether a record is put away.

CREATE UNIQUE INDEX IF NOT EXISTS ux_record_archive_target
  ON record_archive(tenant_id, entity_type, record_id);
CREATE INDEX IF NOT EXISTS idx_record_archive_state
  ON record_archive(entity_type, state);
CREATE INDEX IF NOT EXISTS idx_record_archive_tenant_state
  ON record_archive(tenant_id, state);


-- §3 · THE THREE REFUSALS, MADE DATABASE-LEVEL FACTS.
--
-- Precedent: migrations/0185_wave45_pricing_model_v3.sql makes a refusal a trigger
-- rather than an interface check, for the same reason — an interface check protects
-- the screens somebody remembered to change.

-- 3a · Nothing in this table is ever deleted. Un-archiving is a state change, and a
--      registry you can delete from is a delete path wearing an archive's name.
CREATE TRIGGER IF NOT EXISTS trg_record_archive_no_delete
BEFORE DELETE ON record_archive
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_REGISTRY_IS_APPEND_ONLY: an archive record cannot be deleted; un-archive it instead, which keeps the history');
END;

-- 3b · The original archive stamp is never rewritten. Who archived a record, and
--      when, is the part an auditor relies on.
CREATE TRIGGER IF NOT EXISTS trg_record_archive_stamp_frozen
BEFORE UPDATE OF tenant_id, entity_type, record_id, archived_at, archived_by_user_id
ON record_archive
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_STAMP_IS_FROZEN: the original archive stamp cannot be changed; only the state and the un-archive stamp may be updated');
END;

-- 3c · The money and record-of-account kinds, named explicitly. The allowlist CHECK
--      in section 1 already refuses them; this trigger exists so the message a
--      caller receives says which rule it broke and why, instead of the opaque
--      "CHECK constraint failed". Both spellings (singular and plural) are named
--      because both appear in this tree.
CREATE TRIGGER IF NOT EXISTS trg_record_archive_refuse_money_kinds
BEFORE INSERT ON record_archive
WHEN NEW.entity_type IN (
  'spv', 'spvs', 'commitment', 'commitments', 'subscription', 'subscriptions',
  'fee', 'fees', 'distribution', 'distributions', 'captable', 'cap_table',
  'captable_commit', 'captable_commits', 'audit', 'audit_log', 'audit_row',
  'invoice', 'invoices', 'capital_call', 'capital_calls', 'position', 'positions'
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_REFUSED_MONEY_OR_AUDIT_RECORD: investment vehicles, commitments, subscriptions, fees, distributions, cap-table rows and audit rows are never archived, because hiding one from a list is how a total changes without anybody deciding to change it');
END;


-- §4 · THE BACKFILL THAT MUST NOT EXIST.
--
-- There is no INSERT in this section and there must never be one.
--
-- Any backfill here would archive records that no human asked to archive. That is
-- the exact failure this feature is built to prevent: an archive is a decision a
-- person makes about one record, and a count that quietly drops rows nobody chose
-- to drop is worse than no archive at all.
--
-- server/lib/recordArchiveSchema.ts ASSERTS that this section contains no
-- executable statement, so a future edit that slips an INSERT in here fails the
-- install loudly instead of silently putting records away.
`;

/** The migration's four sections, split on its own line-anchored `-- §N ·`
 *  banners. Those banners appear ONLY as section headers in that file; prose
 *  references to a section are spelled "section N" precisely so they cannot match. */
export function recordArchiveSections(): string[] {
  const parts = RECORD_ARCHIVE_SQL.split(/\n(?=-- \u00a7\d+ \u00b7 )/);
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

/**
 * THE ALLOWLIST, PARSED OUT OF THE SCHEMA ITSELF.
 *
 * This is deliberately NOT a hand-written array. The database CHECK in section 1 is
 * the thing that actually refuses a write; a separate hand-kept list beside it is
 * two sources of truth, and the interface would eventually offer a kind the
 * database rejects (or, far worse, stop offering one it accepts). Reading it out of
 * the embedded SQL means the screen, the endpoint and the constraint cannot
 * disagree.
 */
function parseAllowlist(): readonly string[] {
  const m = RECORD_ARCHIVE_SQL.match(
    /CHECK\s*\(entity_type IN \(([\s\S]*?)\)\s*\)/,
  );
  if (!m) return [];
  return Object.freeze(
    Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]),
  );
}

/** The eight kinds of record that may be archived. Order is the schema's order. */
export const ARCHIVABLE_ENTITY_TYPES: readonly string[] = parseAllowlist();

/** True when this kind of record may be archived at all. DEFAULT IS REFUSE: an
 *  unknown string is never archivable, so a new kind of record is a decision
 *  somebody has to make in the migration, not something that leaks in. */
export function isArchivableEntityType(entityType: string): boolean {
  return ARCHIVABLE_ENTITY_TYPES.includes(entityType);
}

/**
 * The kinds this feature REFUSES, spelled in the plain words the owner uses. Used
 * to build the message a person reads when the answer is no. The database refuses
 * them independently (the allowlist CHECK, plus
 * trg_record_archive_refuse_money_kinds); this list exists so the refusal can SAY
 * WHY on screen instead of surfacing a constraint error.
 */
export const NEVER_ARCHIVABLE_PLAIN_WORDS: readonly string[] = Object.freeze([
  "an investment vehicle",
  "a commitment",
  "a subscription",
  "a fee",
  "a distribution",
  "a cap-table entry",
  "an audit record",
]);

/** The exact sentence a person sees when they try to archive something that must
 *  never be archived. One spelling, shared by the endpoint and the screen, so the
 *  refusal cannot be worded two ways. */
export const ARCHIVE_REFUSED_MESSAGE =
  "This record cannot be archived, so it has not been hidden. Investment vehicles, " +
  "commitments, subscriptions, fees, distributions, cap-table entries and audit " +
  "records always stay visible, because hiding one of them would change a total " +
  "without anybody deciding to change it.";

/** The machine-readable refusal code. */
export const ARCHIVE_REFUSED_CODE = "archive_refused_record_kind";

interface DbLike {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  exec(sql: string): unknown;
}

export interface RecordArchiveInstallResult {
  /** true when section 1 had to create `record_archive` from scratch. */
  tableCreated: boolean;
  /** true when the table was already there. */
  tableAlreadyPresent: boolean;
  /** index names present after this call. */
  indexes: string[];
  /** trigger names present after this call. */
  triggers: string[];
  /** rows in the registry after this call, by state. Never fabricated: read back. */
  /** NOT MEASURED — always 0. See the note in the verification helper below. */
  archivedRows: number;
  /** NOT MEASURED — always 0. See the note in the verification helper below. */
  activeRows: number;
  /** the eight allowlisted kinds, as the schema declares them. */
  allowlist: readonly string[];
  /** anything that threw for a reason other than "already there". Non-empty means
   *  the install did NOT fully succeed. */
  failures: string[];
}

/**
 * Install migration 0234 on the handle given, idempotently.
 *
 * READ THE RESULT. It reports what it did rather than asserting success.
 */
export function ensureRecordArchiveSchema(db: DbLike): RecordArchiveInstallResult {
  const res: RecordArchiveInstallResult = {
    tableCreated: false,
    tableAlreadyPresent: false,
    indexes: [],
    triggers: [],
    archivedRows: 0,
    activeRows: 0,
    allowlist: ARCHIVABLE_ENTITY_TYPES,
    failures: [],
  };

  const sections = recordArchiveSections();
  if (sections.length !== 4) {
    res.failures.push(
      `expected 4 sections in ${RECORD_ARCHIVE_MIGRATION}, parsed ${sections.length}`,
    );
    return res;
  }

  /* Section 4 MUST stay empty of statements. Asserted BEFORE anything runs, so a
     future edit that slips a backfill in there fails the install loudly instead of
     quietly archiving records nobody chose to archive. */
  if (stripCommentLines(sections[3]).trim() !== "") {
    res.failures.push(
      "section 4 of the migration contains an executable statement; it must contain none " +
        "(a backfill would archive records no human asked to archive)",
    );
    return res;
  }

  if (ARCHIVABLE_ENTITY_TYPES.length !== 8) {
    res.failures.push(
      `the allowlist parsed out of the migration has ${ARCHIVABLE_ENTITY_TYPES.length} members, expected 8`,
    );
    return res;
  }

  const tableBefore = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='record_archive'")
      .all() as Array<{ name: string }>
  ).length;

  for (let i = 0; i < 3; i++) {
    try {
      db.exec(stripCommentLines(sections[i]));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/already exists/i.test(msg)) continue;
      res.failures.push(`section ${i + 1}: ${msg}`);
      return res;
    }
  }

  const tableAfter = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='record_archive'")
      .all() as Array<{ name: string }>
  ).length;
  if (tableAfter === 0) {
    res.failures.push("section 1 ran but record_archive still does not exist");
    return res;
  }
  if (tableBefore === 0) res.tableCreated = true;
  else res.tableAlreadyPresent = true;

  res.indexes = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='record_archive' AND name IS NOT NULL ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => String(r.name));
  res.triggers = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='record_archive' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => String(r.name));

  /* THE ROW COUNTS THAT USED TO BE READ HERE WERE REMOVED, DELIBERATELY.

     They were install diagnostics and nothing consumed them. To produce them this
     helper had to SELECT across the whole table with no tenant predicate, which
     `npm run lint:tenant-scope-fence` correctly reported as an unscoped read of a
     tenant-scoped table. Taking an exemption for a number nobody used would have
     spent a real control on a convenience. The fields below stay in the shape at
     their initialised value of 0 so no caller's type changes, and they are
     documented as NOT MEASURED rather than left to be mistaken for a measurement.
     A per-tenant count is available through the scoped reads in the stores. */
  return res;
}
