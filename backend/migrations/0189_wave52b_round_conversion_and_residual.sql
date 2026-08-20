-- WAVE 52b · AC-17 and §11.4.3 — THE TWO VALUES WAVE 52 COMPUTED BUT DID NOT STORE.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS MIGRATION EXISTS
-- ─────────────────────────────────────────────────────────────────────────────
-- Wave 52 built both of these as live, tested, exact-decimal derivations in
-- `client/src/lib/roundMath.ts` and then persisted neither of them:
--
--   1. `conversion_status` — whether a SAFE or note CONVERTS IN THIS ROUND, does
--      NOT convert, or is UNDETERMINED. AC-17 asks for a *stored* per-instrument
--      field, because the value changes the pricing denominator `D`, therefore
--      the price `p`, therefore `N`, therefore every holder's percentage. A
--      value that decides the arithmetic and disappears when the page unmounts
--      is a dead variable, which R21 forbids ("no dead variables").
--
--   2. `residual_disposition` — what actually HAPPENS to the money that the
--      floor() in `N = floor(I/p)` leaves unapplied. STRATEGY §11.4.3 requires a
--      stored, ENUMERATED value, and
--      `spec/strategy/RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` §10 item 7 —
--      ALREADY SENT TO AN EXTERNAL REVIEWER — promises exactly that: "with the
--      residual's disposition stored as an enumerated value rather than
--      described in prose."
--
-- The enumeration is not decoration. The post-money identity closes DIFFERENTLY
-- depending on which value is chosen, which is precisely why prose is not
-- acceptable here:
--
--     T·p = PMV + I − r                (the only form W52 may assert)
--
--     returned                 → I_committed reduces to I_applied; r leaves the
--                                cap table entirely
--     not_called               → I_committed was never received; r is disclosed
--                                as uncalled, not as cash on the balance sheet
--     credited_next_close      → r is a LIABILITY carried forward and re-applied
--                                at the NEXT close's price, so it re-enters the
--                                identity at a different p
--     waived                   → a contribution WITHOUT shares; r stays with the
--                                company and issues nothing
--     subscription_receivable  → r appears on the reconciliation as a balance,
--     subscription_payable       never as shares
--     retained_by_agreement    → retained under the SPA, disclosed with the
--                                clause reference
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY TWO NEW TABLES AND NOT TWO NEW COLUMNS — THE SACRED CONSTRAINT
-- ─────────────────────────────────────────────────────────────────────────────
-- `rounds` and `securities` are created by INLINE DDL inside
-- `server/db/connection.ts`, which is SACRED. Dev and `NODE_ENV=test` build
-- SQLite from those inline definitions and DO NOT run this numbered migration
-- set, so an `ALTER TABLE rounds ADD COLUMN …` here would reach production and
-- NOT reach dev or test. That exact mismatch is what happened in Repair Wave 1:
-- migration 0188 added `audit_log.hash_version`, the inline `CREATE TABLE
-- audit_log` did not have it, `auditChainVerifier.test.ts` could not load, and
-- 20 assertions were silently reported as SKIPPED rather than failed. WAIVER-6
-- (owner ruling R24a) was granted to close that gap by editing the sacred file.
--
-- WAVE 52b DOES NOT NEED A WAIVER, because it adds NEW TABLES ONLY. A new table
-- is absent from the inline DDL by definition, so there is no shape to keep in
-- parity — and dev/test parity is delivered instead by
-- `server/lib/applyWave52bRoundMathSchema.ts`, which READS THIS FILE and
-- executes it through the real runner's own `splitStatements`. Parity by
-- construction, the same mechanism `applyWave43RoundCloseSchema.ts` uses for
-- 0184 and `applyWave38EventLedgerSchema.ts` uses for 0183. Nothing in
-- `server/db/connection.ts` is read, written or needed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE AND IDEMPOTENT ONLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Every statement is `CREATE TABLE IF NOT EXISTS` or
-- `CREATE [UNIQUE] INDEX IF NOT EXISTS`. There is no DROP, no ALTER, no UPDATE,
-- no DELETE and no INSERT anywhere in this file. Re-running it is a no-op, and
-- it cannot change one existing row of one existing table.
--
-- NOTE ON THE FEATURE FLAG. Wave 52b's rollback flag is NOT created here. It is
-- a `platform_config` row, and `trg_pc_no_direct_insert` (connection.ts:1035)
-- rejects any INSERT into `platform_config` that is not matched by a genesis
-- history row carrying a computed revision hash — which SQL cannot compute. So
-- the flag is seeded from TypeScript through the established
-- `ensurePlatformConfigKey()` path, exactly as WAVE 11 / EN-9 documents. That
-- keeps the flag DB-driven per R21 while leaving this migration purely DDL.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PER-INSTRUMENT CONVERSION STATUS  (AC-17)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (round, instrument). The row IS the founder's recorded decision
-- about that instrument for that round; the instrument itself is untouched, so
-- nothing in `securities` or in the sacred hash-chained `captable_commits` moves.
CREATE TABLE IF NOT EXISTS round_instrument_conversion (
  id                        TEXT NOT NULL PRIMARY KEY,
  -- Nullable for the same reason it is nullable on `rounds`: pre-tenant rows
  -- exist in this tree.
  tenant_id                 TEXT,
  round_id                  TEXT NOT NULL,
  company_id                TEXT,
  -- `securities.id` of the SAFE / note / warrant. A pointer, never a copy of
  -- its terms: two numbers for one instrument is how a money bug is born.
  instrument_id             TEXT NOT NULL,
  instrument_kind           TEXT NOT NULL
                              CHECK (instrument_kind IN (
                                'safe_post',
                                'safe_pre',
                                'convertible_note',
                                'warrant'
                              )),
  -- THE ENUMERATION. Mirrors `CONVERSION_STATUSES` in client/src/lib/roundMath.ts
  -- exactly. NOT NULL with NO DEFAULT: an absent row means "not yet recorded",
  -- and the disclosure treats that as `undetermined` and FAILS CLOSED. A column
  -- default here would let a silent write decide the denominator.
  conversion_status         TEXT NOT NULL
                              CHECK (conversion_status IN (
                                'converts_in_this_round',
                                'does_not_convert',
                                'undetermined'
                              )),
  -- WHY it converts. Mirrors `CONVERSION_TRIGGER_BASES`. NULL is legitimate for
  -- `does_not_convert` and for `undetermined`; the CHECK below requires it
  -- whenever the instrument DOES convert, so "it converted, we don't know why"
  -- cannot be stored.
  conversion_trigger_basis  TEXT
                              CHECK (conversion_trigger_basis IS NULL OR
                                     conversion_trigger_basis IN (
                                       'qualified_financing_threshold_met',
                                       'elective',
                                       'cap_binding',
                                       'discount_binding',
                                       'mfn'
                                     )),
  -- Notes only: whether the accrued-interest data path (issue date, day-count
  -- convention, compounding term) is complete. 0 means the conversion amount is
  -- NOT known, and AC-17's Pole B requires a REFUSAL rather than a silent
  -- zero-interest conversion.
  accrued_interest_modelled INTEGER NOT NULL DEFAULT 0
                              CHECK (accrued_interest_modelled IN (0, 1)),
  -- The as-converted share count at the time of recording, as an INTEGER STRING
  -- (shares are exact integers and `bigint` does not survive a REAL column).
  -- NULL when it could not be computed — never 0, which would mean "converts,
  -- for nothing".
  --
  -- TWO MEASURED CORRECTIONS, BOTH RECORDED RATHER THAN QUIETLY APPLIED.
  --
  --  (a) The first draft was `TEXT CHECK (… GLOB '[0-9]*')`, and
  --      `build_log/wave52b/w52b_enum_probe.py` caught it ACCEPTING '12.5' — a
  --      GLOB of that shape anchors only the FIRST character.
  --  (b) The second draft added `AND NOT GLOB '*[^0-9]*'`, which does reject
  --      '12.5' — and then `server/__tests__/wave0_2_strict_check_conventions_lint.ts`
  --      ("no unparseable statement in program-era migrations") went RED on the
  --      full-suite run, because the AST parser Wave 0 uses does not accept
  --      `NOT GLOB` at all.
  --
  -- So the floor is now `typeof(col) = 'integer'`, the SAME floor WAVE 48 / R14
  -- installed on money-shaped columns (migrations/0186) — which is stronger than
  -- either GLOB, parseable by the Wave 0 lint, and correct for a quantity that is
  -- an exact integer by definition. SQLite's INTEGER is 64-bit, so it holds any
  -- real share count with eleven orders of magnitude to spare. '12.5' becomes a
  -- REAL and is refused; 'not-a-number' stays TEXT and is refused; '2500000' is
  -- coerced LOSSLESSLY to 2500000 and is accepted.
  as_converted_shares       INTEGER
                              CHECK (as_converted_shares IS NULL OR (
                                     typeof(as_converted_shares) = 'integer' AND
                                     as_converted_shares >= 0)),
  recorded_at               TEXT NOT NULL,
  -- Taken from the authenticated session by the store, never from a request body.
  recorded_by               TEXT,
  notes                     TEXT,
  -- A converting instrument must say on what basis it converts. Declared here
  -- rather than left to the store, so a direct SQL writer cannot create a row
  -- whose status and basis disagree.
  CHECK (
    (conversion_status =  'converts_in_this_round' AND conversion_trigger_basis IS NOT NULL)
    OR
    (conversion_status <> 'converts_in_this_round')
  )
);

-- The disclosure read: "which instruments enter D for this round?" runs on every
-- price derivation and on every Review-step preview.
CREATE INDEX IF NOT EXISTS idx_round_instrument_conversion_round
  ON round_instrument_conversion(round_id);

-- One decision per instrument per round. Without this, a retry could record the
-- same SAFE twice and it would enter the denominator twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_instrument_conversion_round_instrument
  ON round_instrument_conversion(round_id, instrument_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESIDUAL DISPOSITION  (§11.4.3)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per (round, close, investor). `close_ref` exists because
-- `credited_next_close` is meaningless without knowing WHICH close the residual
-- arose at; structured multi-close is not implemented (§11.5.4 and the response
-- document both say so), so it defaults to 'initial' and is honest about it.
CREATE TABLE IF NOT EXISTS round_residual_disposition (
  id                     TEXT NOT NULL PRIMARY KEY,
  tenant_id              TEXT,
  round_id               TEXT NOT NULL,
  close_ref              TEXT NOT NULL DEFAULT 'initial',
  investor_id            TEXT NOT NULL,
  -- ISO-4217. The minor-unit EXPONENT is resolved from server/lib/currency.ts;
  -- there is no exponent arithmetic in this schema and no hardcoded 2 anywhere.
  currency               TEXT NOT NULL,
  -- MONEY AS INTEGER MINOR UNITS WITH A REAL TYPE FLOOR. In a non-STRICT SQLite
  -- table `INTEGER` is an AFFINITY, not a type: it accepts 'not-a-number'
  -- verbatim and silently coerces '12.5' to a REAL. WAVE 48 / owner ruling R14
  -- installed `typeof(col) = 'integer'` as the floor on exactly this class of
  -- column (migrations/0186), and that is the floor used here — declared inline
  -- on a brand-new table rather than bolted on by a trigger, because there are no
  -- pre-existing rows to grandfather.
  --
  -- `I_committed`, `I_applied` and `r` are three DISTINCT quantities per §11.4.2
  -- and are never conflated. All three are stored: keeping only two would force
  -- whoever reads the row to recompute the third, which is how they drift apart.
  -- `I_applied + r == I_committed` exactly, in minor units, is invariant I-5, and
  -- the CHECK below makes the database itself refuse a row that breaks it.
  committed_minor        INTEGER NOT NULL
                           CHECK (typeof(committed_minor) = 'integer' AND committed_minor >= 0),
  applied_minor          INTEGER NOT NULL
                           CHECK (typeof(applied_minor)   = 'integer' AND applied_minor   >= 0),
  residual_minor         INTEGER NOT NULL
                           CHECK (typeof(residual_minor)  = 'integer' AND residual_minor  >= 0),
  -- THE ENUMERATION. Mirrors `RESIDUAL_DISPOSITIONS` in
  -- client/src/lib/roundMath.ts exactly, and is the executable form of ISR §5's
  -- "returned, waived, or left as a subscription residual".
  --
  -- NOT NULL AND NO DEFAULT — §11.4.3: "No default is permitted." A round with a
  -- non-zero residual and NO recorded disposition has NO ROW HERE, and the
  -- disclosure reports the round INCOMPLETE. That is the whole point: a DEFAULT
  -- would silently pick a treatment, and each treatment closes the post-money
  -- identity differently.
  residual_disposition   TEXT NOT NULL
                           CHECK (residual_disposition IN (
                             'returned',
                             'not_called',
                             'credited_next_close',
                             'waived',
                             'subscription_receivable',
                             'subscription_payable',
                             'retained_by_agreement'
                           )),
  -- Required for 'retained_by_agreement' (§11.4.3: "disclosed with the clause
  -- reference"), optional otherwise.
  disposition_clause_ref TEXT,
  -- Required for 'credited_next_close': a residual carried forward has to name
  -- the close it is carried to, or it is carried nowhere.
  credited_to_close_ref  TEXT,
  recorded_at            TEXT NOT NULL,
  recorded_by            TEXT,
  notes                  TEXT,
  CHECK (
    (residual_disposition =  'retained_by_agreement' AND disposition_clause_ref IS NOT NULL)
    OR
    (residual_disposition <> 'retained_by_agreement')
  ),
  CHECK (
    (residual_disposition =  'credited_next_close' AND credited_to_close_ref IS NOT NULL)
    OR
    (residual_disposition <> 'credited_next_close')
  ),
  -- INVARIANT I-5, ENFORCED BY THE DATABASE. `I_applied + r == I_committed`
  -- exactly, in integer minor units, tolerance ZERO (§11.4.4). A row that does
  -- not reconcile cannot be stored, so no reader has to trust that it does.
  CHECK (applied_minor + residual_minor = committed_minor)
);

-- The reconciliation read: "sum the residuals for this round" is the −Σr term of
-- the universal reconciliation equation `T·p − PMV − ΣI == −Σr + Σ(outside-D)·p`.
CREATE INDEX IF NOT EXISTS idx_round_residual_disposition_round
  ON round_residual_disposition(round_id, close_ref);

-- One disposition per investor per close. A second row would double-count the
-- residual on both sides of the reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_residual_disposition_investor
  ON round_residual_disposition(round_id, close_ref, investor_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE §5.8 DENOMINATOR SWITCHES  (invariant I-10)
-- ─────────────────────────────────────────────────────────────────────────────
-- STRATEGY §5.8 lists ELEVEN places where the authorities genuinely disagree
-- about what a cap-table denominator contains, and rules that "where authorities
-- genuinely disagree, the platform lets the user choose and discloses the
-- choice… Each becomes a STORED, VERSIONED, USER-VISIBLE round setting."
--
-- None of them was stored. That is not a cosmetic gap: `note_conversion_method`
-- alone changes the answer from 20.00% to 18.52% to 18.18% ON IDENTICAL FACTS
-- (Buchanan Ingersoll, four defensible methods), and ISR §10 error #10 records
-- that not disclosing the method is a diligence failure. A percentage computed
-- under an unrecorded convention cannot be reproduced by anybody, including us.
--
-- Invariant I-10 is the reason this table is in THIS migration rather than a
-- later one: "Persistence round trip — Save → new process, fresh DB read →
-- recompute → identical to pre-save, FOR EVERY DENOMINATOR SWITCH OF §5.8", with
-- the falsifying mutation "drop one switch from the persisted column set → RED".
-- Without somewhere to persist them, I-10 could only ever have been asserted
-- against an in-memory object holding its own literals, which §11.4.5 says
-- "proves nothing".
--
-- KEY/VALUE AND NOT ELEVEN COLUMNS, deliberately: a twelfth disagreement will be
-- found (the eleventh, `fx_rate_date`, is already marked UNVERIFIED because ISR
-- §13 #13 located no Tier-A/B standard for it), and adding a row is additive
-- while adding a column to a table `server/db/connection.ts` creates inline is
-- not — see the note at the top of this file.
--
-- VERSIONED: `version` is the round-setting revision, so "which convention was
-- this percentage computed under, on the day it was published?" has an answer.
-- Rows are corrected by INSERTing a higher version, never by rewriting history.
CREATE TABLE IF NOT EXISTS round_denominator_switches (
  id            TEXT NOT NULL PRIMARY KEY,
  tenant_id     TEXT,
  round_id      TEXT NOT NULL,
  -- The eleven switches of §5.8, by name. A twelfth cannot be smuggled in as a
  -- typo of one of these.
  switch_key    TEXT NOT NULL
                  CHECK (switch_key IN (
                    'include_unallocated_pool',
                    'pool_top_up_placement',
                    'converting_instruments_in_premoney',
                    'note_conversion_method',
                    'pool_target_basis',
                    'rsu_sar_in_fd',
                    'promised_options',
                    'displayed_post_money',
                    'second_close_pricing',
                    'liquidity_denominator',
                    'fx_rate_date'
                  )),
  -- PER-KEY VALUE DOMAIN, enforced in SQL rather than left to the store, so a
  -- direct writer cannot store 'in' for `note_conversion_method` and have every
  -- reader silently fall back to a default.
  switch_value  TEXT NOT NULL
                  CHECK (
                    (switch_key = 'include_unallocated_pool'
                       AND switch_value IN ('in', 'out'))
                    OR (switch_key = 'pool_top_up_placement'
                       AND switch_value IN ('pre_money', 'post_money'))
                    OR (switch_key = 'converting_instruments_in_premoney'
                       AND switch_value IN ('in', 'out'))
                    OR (switch_key = 'note_conversion_method'
                       AND switch_value IN ('pre_money_method', 'post_money_method',
                                            'dollars_for_dollars', 'percentage_ownership'))
                    OR (switch_key = 'pool_target_basis'
                       AND switch_value IN ('post_money_fd', 'pre_money_fd'))
                    OR (switch_key = 'rsu_sar_in_fd'
                       AND switch_value IN ('in', 'out'))
                    OR (switch_key = 'promised_options'
                       AND switch_value IN ('recognise_when_safe_outstanding', 'always', 'never'))
                    OR (switch_key = 'displayed_post_money'
                       AND switch_value IN ('show_both_when_differ', 't_times_p_only', 'pmv_plus_i_only'))
                    OR (switch_key = 'second_close_pricing'
                       AND switch_value IN ('same_price', 'reprice'))
                    OR (switch_key = 'liquidity_denominator'
                       AND switch_value IN ('without_pool', 'with_pool'))
                    OR (switch_key = 'fx_rate_date'
                       AND switch_value IN ('closing_date', 'commitment_date', 'payment_date'))
                  ),
  -- TRUE when the value is the ISR-recommended default rather than a deliberate
  -- founder choice. Disclosure reads differently in the two cases, and a default
  -- that presents itself as a decision is a dead promise.
  is_default    INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  -- The authority the choice rests on, and whether one exists at all.
  -- `fx_rate_date` is stored with 'UNVERIFIED — ISR §13 #13 located no Tier-A/B
  -- standard', because claiming an authority we do not have is worse than none.
  authority_ref TEXT,
  recorded_at   TEXT NOT NULL,
  recorded_by   TEXT,
  CHECK (
    (is_default = 0 AND authority_ref IS NOT NULL) OR (is_default = 1)
  )
);

-- The disclosure read: "under which conventions was this round's denominator
-- computed?" runs on every preview and every published percentage.
CREATE INDEX IF NOT EXISTS idx_round_denominator_switches_round
  ON round_denominator_switches(round_id, switch_key);

-- One LIVE value per switch per round. Corrections arrive as a higher `version`,
-- so the pair is unique rather than the key alone: history is preserved and the
-- current value is still unambiguous (MAX(version)).
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_denominator_switches_round_key_version
  ON round_denominator_switches(round_id, switch_key, version);
