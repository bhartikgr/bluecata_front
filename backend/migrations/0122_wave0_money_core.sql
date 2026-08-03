-- 0122_wave0_money_core.sql — Wave 0 deliverable 0-1 part 2
-- V7 §5.0 verbatim (lines 4451-4485). `allocation_rule` + `fx_rate_snapshot`.
--
-- ADR-5 rule 5: allocator rules are versioned so past runs are reproducible.
-- ADR-5 rule 4: no cross-currency math without an fx_rate_snapshot.
--
-- Neither table is money-mutating (they hold rules and rates, not amounts), so
-- they do NOT carry the `«event columns»` template. V7 §5.0 line 4488 says
-- explicitly "every money-mutating table BELOW also carries the Wave-0 event
-- columns" — these two are above that boundary.
--
-- fx_rate_snapshot uses INTEGER rate_numerator/rate_denominator (an exact
-- rational), not REAL, so a conversion is reproducible to the minor unit.
-- fx snapshots gain no-update / no-delete triggers per V7 §5.0 round-5 finding
-- (a mutable rate silently rewrites every approved NAV that referenced it).
--
-- DEPLOYMENT STATUS: Wave 0 migrations 0121-0123 have NEVER been applied to
-- any live environment. Everything in this wave predates the CODE-BEGIN
-- boundary. Migration IDs have been edited in place across v1→v2→v3 review
-- rounds, which is safe ONLY while the wave remains pre-code. If Wave 0 ever
-- ships to a live DB before this constraint is lifted, subsequent schema
-- changes MUST bump to fresh migration IDs (0124-0126) and rewrite as
-- re-shape migrations. See v3 review Opus M5.
--
-- Wave 0 Increment 1 review corrections (Aug 2026):
--   1. allocation_rule PRIMARY KEY changed from (rule_id) to (rule_id, rule_version).
--      The prior single-column PK made the versioning that justifies the
--      table's existence structurally impossible. The dead UNIQUE(rule_id,
--      rule_version) is removed (subsumed by the composite PK).
--   2. allocation_rule.tie_break CHECK restricted to 'remainder_desc_index_asc'
--      — the actual tie-break implemented in server/lib/money.ts
--      allocateResidualCents. The prior 'payee_type_then_payee_ref_asc' single
--      value was a silent-drop contradiction with the shipped allocator; v3
--      review Opus M3 asked to drop it entirely because it is implemented
--      nowhere. If a future wave ships payee-type-ordered tie-break, it will
--      add the enum value in the same wave that ships the code.
--      NOTE (v6, Opus v4 C3 + v5 C4): tie_break is DESCRIPTIVE metadata for
--      operators, auditors, and future migration writers. server/lib/money.ts
--      does NOT read this column at runtime; the allocator's tie-break is
--      hard-coded to remainder_desc_index_asc. The DB CHECK enforces that
--      the two never disagree — if the allocator ever gains a second tie-break
--      strategy, the CHECK widens in the same wave that ships it. Do not
--      assume this column drives the allocator.
--   3. allocation_rule gains BEFORE UPDATE + BEFORE DELETE immutability triggers.
--      A rule row is a historical fact — the way you "change" a rule is to
--      insert a new (rule_id, rule_version+1) row, never edit an old one.
--      Same rationale as fx_rate_snapshot.
--
-- Three-place rule (ADR-6):
--   1. migrations/0122_wave0_money_core.sql (this file)
--   2. server/db/migrations/0122_wave0_money_core.sql (byte-identical mirror)
--   3. applyWave0MoneyCoreSchema() in server/db/connection.ts (idempotent inline)

CREATE TABLE IF NOT EXISTS allocation_rule (
  rule_id             TEXT NOT NULL,
  rule_version        INTEGER NOT NULL CHECK (rule_version > 0),
  method              TEXT NOT NULL CHECK (method IN ('largest_remainder_stable')),
  tie_break           TEXT NOT NULL
                        CHECK (tie_break = 'remainder_desc_index_asc'),
  created_at          TEXT NOT NULL
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  PRIMARY KEY (rule_id, rule_version)
) STRICT;

-- Immutability: a rule row is a historical fact. A rule "change" is a new
-- (rule_id, rule_version+1) row, never an edit or delete.
CREATE TRIGGER IF NOT EXISTS trg_allocation_rule_no_update
  BEFORE UPDATE ON allocation_rule
  BEGIN SELECT RAISE(ABORT, 'ALLOCATION_RULE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_allocation_rule_no_delete
  BEFORE DELETE ON allocation_rule
  BEGIN SELECT RAISE(ABORT, 'ALLOCATION_RULE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS fx_rate_snapshot (
  fx_id               TEXT PRIMARY KEY NOT NULL,
  from_currency       TEXT NOT NULL REFERENCES currency_ref(code),
  to_currency         TEXT NOT NULL REFERENCES currency_ref(code),
  rate_numerator      INTEGER NOT NULL CHECK (rate_numerator > 0),
  rate_denominator    INTEGER NOT NULL CHECK (rate_denominator > 0),
  as_of_date          TEXT NOT NULL
      CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             AND date(as_of_date) = as_of_date),
  source              TEXT NOT NULL,
  created_at          TEXT NOT NULL
                        CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  UNIQUE (from_currency, to_currency, as_of_date, source)
) STRICT;

-- V7 §5.0 round-5 blocker 5: fx snapshots must be immutable. A rate correction
-- is a NEW snapshot on a new (from,to,as_of,source) key, never an edit.
CREATE TRIGGER IF NOT EXISTS trg_fx_no_update BEFORE UPDATE ON fx_rate_snapshot
BEGIN SELECT RAISE(ABORT, 'FX_SNAPSHOT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_fx_no_delete BEFORE DELETE ON fx_rate_snapshot
BEGIN SELECT RAISE(ABORT, 'FX_SNAPSHOT_IMMUTABLE'); END;
