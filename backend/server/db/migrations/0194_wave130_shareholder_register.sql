-- WAVE 130 · FINDING 1 + FINDING 3 — RECORD SHAREHOLDERS WITHOUT INVENTING A ROUND,
-- AND MAKE CAP-TABLE VISIBILITY EXPLICIT.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE DEFECT (owner instruction, 2026-08-24; re-verified in W130_PREFLIGHT.md §1 §2)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Every write path that puts a real holding on a Capavate cap table is
-- round-scoped, vehicle-scoped or admin-only. The enumeration is in
-- W130_PREFLIGHT.md §2.1: nine paths, eight of them through the SACRED money
-- core, five reachable from a UI, and not one of them able to record
-- "these are the shareholders this company already had when it arrived".
--
-- The consequence is not a missing button. The round-create wizard's Step 2
-- (Terms) is a MANDATORY BLOCKING gate requiring pre-money valuation,
-- fully-diluted pre-money shares, price per share and new shares issued, all
-- > 0, even when the vehicle is Common Shares. So a company that joins Capavate
-- after raising several rounds MUST FABRICATE FOUR NUMBERS in order to record
-- shareholders it already has — and the fabricated price per share then
-- propagates into reconcile() and constrains every share count seated on that
-- round (server/founderOpsRoutes.ts:190-200). This platform has spent weeks
-- removing fabricated figures; the product currently REQUIRES a founder to
-- invent them to describe his own company.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY A NEW TABLE AND NOT THE SACRED COMMIT LEDGER
-- ═══════════════════════════════════════════════════════════════════════════════
-- `server/captableCommitStore.ts` is SACRED and records a TRANSACTION: money
-- moved, on a round, reconciled two independent ways, hashed into an append-only
-- chain. It refuses a share count on an unpriced instrument (:711) and
-- reconciles shares against amount ÷ pricePerShare (:611-628).
--
-- A pre-existing holding is not a transaction Capavate witnessed. It happened
-- elsewhere, possibly years ago, possibly in another currency, and QUITE POSSIBLY
-- WITH AN AMOUNT THE FOUNDER NO LONGER KNOWS. There is nothing to reconcile, and
-- teaching the money core to accept "amount unknown" would be a sacred edit.
-- So this is a REGISTER, kept beside the ledger, and it reaches the screens
-- through the same read-only display bridge W-SAFE (2026-07-14) and W-CAP
-- (2026-07-17) already built in `buildCompanySecurities`
-- (server/routes.ts:2436-2660). NO SACRED FILE IS MODIFIED BY THIS WAVE.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- UNKNOWN IS NOT ZERO — WHY TWO COLUMNS ARE NULLABLE ON PURPOSE (R6 / R47)
-- ═══════════════════════════════════════════════════════════════════════════════
-- `amount_minor` and `price_per_share_minor` are NULLABLE, and NULL means
-- "the founder stated he does not know", NOT "zero". The recording route
-- distinguishes THREE inputs — a figure, the explicit word "unknown", and an
-- omission — and REFUSES an omission rather than defaulting it, so a NULL in
-- this table is always a recorded decision and never an accident. Every renderer
-- shows a plain-English refusal for NULL. There is no `?? 0` on this path.
--
-- Money is stored as EXACT MINOR UNITS in a TEXT column holding the decimal
-- digits of an integer, parsed by a string-only BigInt parser — no Number(),
-- no parseInt, no parseFloat, and the ISO-4217 exponent comes from
-- `currencyExponent()` (server/lib/currency.ts:45), never a literal 100.
-- `currency` and `minor_unit_exponent` are stored ON THE ROW because
-- jurisdiction and currency are variables, not constants: the live company in
-- the owner's own walkthrough computes under Hong Kong conventions and prices in
-- HK$10.0000 (R5: "No `delaware` fallback anywhere").
--
-- `shares` is likewise TEXT holding the decimal digits of a non-negative
-- integer, so a nine-figure share count is exact rather than a float.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE THREE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. company_shareholder_records   — the register itself.
-- 2. company_captable_first_run    — which of the owner's TWO scenarios a company
--                                    is working through, and how far it got, so
--                                    the flow is RESUMABLE and a founder who
--                                    skips is never locked out.
-- 3. captable_visibility_grants    — explicit, expiring, REVOCABLE cap-table
--                                    visibility for a Consortium Partner or a
--                                    Collective party, modelled on Wave 120's
--                                    data-room grants (`revoked_at` / `revoked_by`).
--                                    Positional visibility (founder, admin, any
--                                    holder of a committed position) is NOT
--                                    stored here and is NOT revocable — R8:
--                                    "scope follows the POSITION, never an
--                                    account flag", and a cap-table member has
--                                    "full, identical rights".
--
-- ADDITIVE ONLY. Three CREATE TABLE IF NOT EXISTS. No column is dropped, no
-- column is retyped, no existing row is rewritten, and no existing table is
-- touched. Re-running is a no-op.
--
-- NO INDEX IS CREATED HERE, DELIBERATELY — the same reasoning migrations 0188 and
-- 0193 record: a plain CREATE INDEX that fails is downgraded to a warning by the
-- runner and leaves the migration UNRECORDED and pending, and
-- scripts/migration_chain_check.sh counts index warnings as failures. These
-- tables are read by `company_id` scans over a per-company row count in the
-- tens; the primary key covers every point lookup.
--
-- WHY server/db/connection.ts IS NOT ALSO EDITED. It creates tables inline for
-- dev/test and is SACRED under ratified WAIVER-6. Instead
-- `server/lib/shareholderRegisterStore.ts` calls a local, PRAGMA-checked
-- `ensureShareholderRegisterTables()` before it reads or writes — the same
-- self-heal pattern migration 0188 documents for WAIVER-6 and Wave 120 reused.

CREATE TABLE IF NOT EXISTS company_shareholder_records (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL,
  -- The human's own words for who holds this. Rendered as given; never a machine key.
  holder_name            TEXT NOT NULL,
  holder_email           TEXT,
  -- founder | investor | employee | advisor | entity | option_pool
  holder_type            TEXT NOT NULL,
  -- common | preferred | option | warrant | safe | note
  instrument             TEXT NOT NULL,
  -- The share class or series as the company's own constitution names it
  -- (e.g. "Ordinary A" under Hong Kong conventions). NULL = not applicable.
  series                 TEXT,
  -- Decimal digits of a non-negative integer. Never a float.
  shares                 TEXT NOT NULL,
  -- Exact minor units, as decimal digits of an integer. NULL = STATED UNKNOWN.
  amount_minor           TEXT,
  price_per_share_minor  TEXT,
  currency               TEXT NOT NULL,
  minor_unit_exponent    INTEGER NOT NULL,
  -- ISO calendar date (YYYY-MM-DD) the holding was issued / came into existence.
  issue_date             TEXT NOT NULL,
  -- incorporation | existing_captable | direct — which of the owner's two
  -- scenarios (or the ad-hoc cap-table control) this row was recorded through.
  -- The two scenarios are genuinely different and are NEVER collapsed.
  origin                 TEXT NOT NULL,
  -- Optional link to a platform identity, so a holder who later signs in is the
  -- same person. NULL is ordinary: most pre-existing holders have no account.
  investor_id            TEXT,
  -- Free-text provenance the founder can leave for an auditor.
  note                   TEXT,
  recorded_by            TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  -- Append-only supersede: a revision writes a NEW row and stamps the old one,
  -- so filling in a figure that was once unknown never erases the fact that it
  -- was unknown. NULL = this row is the live one.
  superseded_at          TEXT,
  superseded_by          TEXT
);

CREATE TABLE IF NOT EXISTS company_captable_first_run (
  company_id      TEXT PRIMARY KEY,
  -- incorporation | existing_captable | null (not yet chosen)
  scenario        TEXT,
  -- As-at date for the existing-cap-table scenario; incorporation date for the other.
  as_at_date      TEXT,
  -- not_started | in_progress | skipped | completed
  state           TEXT NOT NULL,
  -- Set when a founder skips. He is NEVER locked out: the entry point stays on
  -- the cap table and re-entering clears this.
  skipped_at      TEXT,
  completed_at    TEXT,
  updated_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captable_visibility_grants (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  -- consortium_partner | collective — the two parties the owner qualified with
  -- "if required". An investor is NOT granted here; his access is positional.
  subject_kind  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  -- The human label the founder chose, so the visibility list never renders a raw id.
  subject_label TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  -- Wave 120's two columns, same meaning: NULL = live; the read path re-reads the
  -- row on EVERY request, so revocation takes effect on the very next call —
  -- no cache to invalidate and no TTL to wait out.
  revoked_at    TEXT,
  revoked_by    TEXT
);
