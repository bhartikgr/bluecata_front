-- 0234 · WAVE 344 · record_archive — A REVERSIBLE ARCHIVE REGISTRY (ADDITIVE ONLY)
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
-- The obvious design is `ALTER TABLE <t> ADD COLUMN archived_at`. It was measured
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
--      founder_crm_contacts.deleted_at is read as `deleted_at IS NULL` by ten
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
