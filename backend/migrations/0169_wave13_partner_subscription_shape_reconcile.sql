-- 0169_wave13_partner_subscription_shape_reconcile.sql
--
-- WAVE 13 — RECONCILE THE `partner_subscription` SCHEMA COLLISION.
--
-- THE DEFECT
-- ----------
-- Two migrations created the SAME table with INCOMPATIBLE shapes:
--
--   * 0153_wave5_money_captable.sql  →  partner_id, cadence, period_start,
--     period_end, grandfathered_from, superseded_by, superseded_reason
--   * 0167_wave11_partner_subscription_engine.sql:37  →  subject_kind,
--     subject_id, cycle, current_period_start, current_period_end,
--     merchant_order_id, activated_at, grace_until, suspended_at
--
-- Both used `CREATE TABLE IF NOT EXISTS`. 0153 sorts first, so it WON and
-- 0167's CREATE was a silent no-op. The runner then downgraded 0167's two
-- subject-keyed CREATE INDEX statements to WARNINGS
-- (server/db/migrate.ts:isNonFatalIndexError — "skipped perf index — no such
-- column: subject_kind") and the whole chain exited 0. Under a strict applier
-- the same statements are hard errors: "no such column: subject_kind".
--
-- Either way the outcome was worse than a failure: a fresh database ended up
-- with the Wave 5 shape while server/lib/partnerSubscriptionStore.ts,
-- subscriptionEnforcementWorker.ts and subscriptionChangeStore.ts all read and
-- write `subject_kind` / `subject_id` / `cycle`. The partner subscription and
-- self-service registration path — the Consortium Partners launch path — could
-- not work on a new install.
--
-- WAVE 13 fixes the collision at BOTH ends:
--   * 0153 no longer declares `partner_subscription` at all (its superseded
--     declaration is retained there as a comment naming this file), so 0167
--     becomes the FIRST declaration and its indexes apply cleanly;
--   * this migration reconciles whatever shape a given database already has
--     into the one canonical shape below.
--
-- THE CANONICAL SHAPE: `subject_kind` + `subject_id`
-- --------------------------------------------------
-- 0167:22 documents EN-8 as persona-agnostic BY CONSTRUCTION: the subscription
-- subject may be a partner, a founder or a collective, and the enforcement
-- worker sweeps on those two columns, so a new persona needs no migration and
-- no second worker. `partner_id` cannot express that. Three of the four
-- consumers and the only enforcement worker already speak `subject_kind`. So
-- the Wave 11 shape is canonical, EXTENDED with the three Wave 5 columns that
-- carry real money semantics and have a live writer
-- (partnerBillingStore.createSubscription, CP-ONB-05 / CP-PROMO-19):
--
--   grandfathered_from, superseded_by, superseded_reason
--
-- and with the UNION of both status vocabularies and both cycle vocabularies,
-- so no existing row and no existing writer becomes invalid:
--
--   status  0153: pending active past_due cancelled grandfathered superseded
--   status  0167: pending active past_due grace suspended cancelled failed
--   cycle   0153 (`cadence`): monthly annual quarterly one_time
--   cycle   0167: monthly annual
--
-- `period_start` / `period_end` are NOT kept as separate columns: they are the
-- same fact as `current_period_start` / `current_period_end`, and carrying both
-- would recreate the two-sources-of-truth problem this migration exists to fix.
-- Existing values are CARRIED into the current_* columns below, and
-- server/lib/partnerBillingStore.ts is repointed in the same wave.
--
-- SAFETY ON A LIVE SERVER WITH EXISTING ROWS
-- ------------------------------------------
-- SQLite cannot rename a column or widen a CHECK in place, so a table rebuild
-- is genuinely required. It is done so that:
--
--   * EVERY ROW IS PRESERVED. The legacy identity is first CARRIED into the new
--     columns on the existing table (step 3), then copied by an explicit
--     INSERT … SELECT (step 4) that runs BEFORE the old table is dropped.
--     server/db/migrate.ts wraps each migration file in a transaction, so any
--     failure rolls the whole rebuild back and leaves the original table
--     exactly as it was. Row counts are asserted by
--     server/__tests__/waveW13_partner_subscription_shape.test.ts, which seeds
--     legacy rows, runs this file, and compares every field.
--   * NOTHING IS INVENTED. `subject_kind` is set to 'partner' for a carried
--     row, which is what a `partner_id` row factually was. `activated_at` is
--     left NULL rather than back-dated to a guess.
--   * IT IS IDEMPOTENT AND SHAPE-AGNOSTIC. Steps 1-2 bring ANY of the three
--     possible starting states (absent / Wave 5 legacy / Wave 11) up to the
--     canonical column set; step 3 carries legacy identity for exactly the rows
--     that lack one; step 4 rebuilds using ONLY canonical column names, so
--     re-running this file against an already-canonical table is a no-op copy.
--     The duplicate-column errors the additive ALTERs raise on an
--     already-canonical database are the runner's documented idempotency
--     contract (server/db/migrate.ts:isIdempotentSqliteError, the same
--     mechanism every additive ALTER in this tree relies on), and the self-heal
--     installer applies this file with the same per-statement tolerance
--     (server/lib/applyWave13SubscriptionShape.ts).
--   * IT IS REVERSIBLE. The exact down-migration, with its own row-preserving
--     copy, is in migrations/ROLLBACK_0169_wave13_partner_subscription_shape.md.
--
-- Mirrored byte-identically into server/db/migrations/.

-- ---------------------------------------------------------------------------
-- 1. The canonical table, for a database that does not have it at all
--    (post-0153-neutralisation fresh install where 0167 has not run, and every
--    :memory: test database, which is built from connection.ts inline DDL and
--    never sees a numbered migration).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_subscription (
  id                    TEXT    PRIMARY KEY NOT NULL,
  -- EN-8. Persona-agnostic subject: 'partner' today, 'founder'/'collective'
  -- accepted so a new persona needs no schema change and no second worker.
  subject_kind          TEXT    NOT NULL CHECK (subject_kind IN ('partner','founder','collective')),
  subject_id            TEXT    NOT NULL,
  tier_slug             TEXT    NOT NULL,
  -- Union of the Wave 11 `cycle` and Wave 5 `cadence` vocabularies.
  cycle                 TEXT    NOT NULL CHECK (cycle IN ('monthly','annual','quarterly','one_time')),
  -- Union of both status vocabularies (Wave 11 lifecycle + Wave 5 supersession).
  status                TEXT    NOT NULL CHECK (status IN
                          ('pending','active','past_due','grace','suspended',
                           'cancelled','failed','grandfathered','superseded')),
  -- Money is INTEGER MINOR UNITS everywhere. amount_minor is what is actually
  -- charged for the current period, after any discount.
  amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency              TEXT    NOT NULL DEFAULT 'USD',
  -- Pre-discount list amount. NULLABLE, as in 0167: a legacy or grandfathered
  -- row may not have one, and inventing 0 would make a discount unauditable.
  list_amount_minor     INTEGER CHECK (list_amount_minor IS NULL OR list_amount_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  discount_code         TEXT,
  price_derivation      TEXT,
  payment_intent_id     TEXT,
  merchant_order_id     TEXT,
  created_at            TEXT    NOT NULL,
  activated_at          TEXT,
  current_period_start  TEXT,
  current_period_end    TEXT,
  grace_until           TEXT,
  suspended_at          TEXT,
  cancelled_at          TEXT,
  -- CP-ONB-05 / CP-PROMO-19 — grandfathering and supersession (Wave 5).
  grandfathered_from    TEXT,
  superseded_by         TEXT,
  superseded_reason     TEXT,
  updated_at            TEXT    NOT NULL,
  created_by            TEXT,
  -- Wave 5's money invariant, preserved: amount = list - discount, ALWAYS,
  -- whenever a list amount is recorded at all. No writer can persist an
  -- inconsistent triple.
  CHECK (list_amount_minor IS NULL OR amount_minor = list_amount_minor - discount_minor)
) STRICT;

-- ---------------------------------------------------------------------------
-- 2. Bring an EXISTING table (either shape) up to the canonical column set.
--    Purely additive, so no row is touched and no data can be lost. On a table
--    that already has a column, SQLite raises "duplicate column name" and the
--    runner swallows exactly that error — the same idempotency contract used by
--    connection.ts:applyV12AdditiveAlters and by every additive migration here.
--    Every column is added NULLABLE; step 4 is what enforces NOT NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE partner_subscription ADD COLUMN subject_kind TEXT;
ALTER TABLE partner_subscription ADD COLUMN subject_id TEXT;
ALTER TABLE partner_subscription ADD COLUMN cycle TEXT;
ALTER TABLE partner_subscription ADD COLUMN current_period_start TEXT;
ALTER TABLE partner_subscription ADD COLUMN current_period_end TEXT;
ALTER TABLE partner_subscription ADD COLUMN merchant_order_id TEXT;
ALTER TABLE partner_subscription ADD COLUMN activated_at TEXT;
ALTER TABLE partner_subscription ADD COLUMN grace_until TEXT;
ALTER TABLE partner_subscription ADD COLUMN suspended_at TEXT;
ALTER TABLE partner_subscription ADD COLUMN grandfathered_from TEXT;
ALTER TABLE partner_subscription ADD COLUMN superseded_by TEXT;
ALTER TABLE partner_subscription ADD COLUMN superseded_reason TEXT;

-- The three Wave 5 identity columns and its two period columns, added as
-- NULLABLE SHIMS when they are absent. They exist for exactly one statement —
-- the carry in step 3, which cannot be compiled at all unless every column it
-- names is present (see the note there) — and they are discarded by the rebuild
-- in step 4. On a Wave 5 database these ALTERs are no-ops (duplicate column).
ALTER TABLE partner_subscription ADD COLUMN partner_id TEXT;
ALTER TABLE partner_subscription ADD COLUMN cadence TEXT;
ALTER TABLE partner_subscription ADD COLUMN period_start TEXT;
ALTER TABLE partner_subscription ADD COLUMN period_end TEXT;

-- ---------------------------------------------------------------------------
-- 3. CARRY the Wave 5 identity onto the canonical columns, for existing rows.
--
--    WHY THE SHIM COLUMNS ABOVE EXIST. SQLite resolves column names when it
--    PREPARES a statement, so `UPDATE … SET subject_id = partner_id` cannot even
--    be compiled against a database that has the Wave 11 shape — which is the
--    other case this same file must survive. (A trigger does not help: a trigger
--    body is compiled when the FIRING statement is prepared, whether or not any
--    row matches.) So step 2 guarantees that BOTH column families exist,
--    nullable, on every shape, which makes the single carry statement below
--    statically valid everywhere. The shim columns are discarded by the rebuild
--    in step 4, so they never survive into the canonical table.
--
--    COALESCE + the WHERE clause make this a no-op on a database that is already
--    canonical: those rows have subject_kind/subject_id/cycle populated, so no
--    row matches and nothing is rewritten. `updated_at` is deliberately NOT
--    bumped — this is a schema reshape, not a business event, and rewriting the
--    audit timestamp would destroy information.
-- ---------------------------------------------------------------------------
UPDATE partner_subscription
   SET subject_kind         = COALESCE(subject_kind, 'partner'),
       subject_id           = COALESCE(subject_id,           partner_id),
       cycle                = COALESCE(cycle,                cadence),
       current_period_start = COALESCE(current_period_start, period_start),
       current_period_end   = COALESCE(current_period_end,   period_end)
 WHERE subject_kind IS NULL OR subject_id IS NULL OR cycle IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Rebuild into the canonical shape: NOT NULL where it must be, the widened
--    CHECKs, and none of the superseded columns. The copy names ONLY canonical
--    columns, which step 2 guaranteed exist whatever the starting shape was —
--    that is what makes this file safe to run against a Wave 5 table, a Wave 11
--    table, or its own output.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS partner_subscription_w13_new;

CREATE TABLE partner_subscription_w13_new (
  id                    TEXT    PRIMARY KEY NOT NULL,
  subject_kind          TEXT    NOT NULL CHECK (subject_kind IN ('partner','founder','collective')),
  subject_id            TEXT    NOT NULL,
  tier_slug             TEXT    NOT NULL,
  cycle                 TEXT    NOT NULL CHECK (cycle IN ('monthly','annual','quarterly','one_time')),
  status                TEXT    NOT NULL CHECK (status IN
                          ('pending','active','past_due','grace','suspended',
                           'cancelled','failed','grandfathered','superseded')),
  amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency              TEXT    NOT NULL DEFAULT 'USD',
  list_amount_minor     INTEGER CHECK (list_amount_minor IS NULL OR list_amount_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  discount_code         TEXT,
  price_derivation      TEXT,
  payment_intent_id     TEXT,
  merchant_order_id     TEXT,
  created_at            TEXT    NOT NULL,
  activated_at          TEXT,
  current_period_start  TEXT,
  current_period_end    TEXT,
  grace_until           TEXT,
  suspended_at          TEXT,
  cancelled_at          TEXT,
  grandfathered_from    TEXT,
  superseded_by         TEXT,
  superseded_reason     TEXT,
  updated_at            TEXT    NOT NULL,
  created_by            TEXT,
  CHECK (list_amount_minor IS NULL OR amount_minor = list_amount_minor - discount_minor)
) STRICT;

INSERT INTO partner_subscription_w13_new
  (id, subject_kind, subject_id, tier_slug, cycle, status, amount_minor, currency,
   list_amount_minor, discount_minor, discount_code, price_derivation,
   payment_intent_id, merchant_order_id, created_at, activated_at,
   current_period_start, current_period_end, grace_until, suspended_at,
   cancelled_at, grandfathered_from, superseded_by, superseded_reason,
   updated_at, created_by)
SELECT
   id, subject_kind, subject_id, tier_slug, cycle, status, amount_minor, currency,
   list_amount_minor, discount_minor, discount_code, price_derivation,
   payment_intent_id, merchant_order_id, created_at, activated_at,
   current_period_start, current_period_end, grace_until, suspended_at,
   cancelled_at, grandfathered_from, superseded_by, superseded_reason,
   updated_at, created_by
FROM partner_subscription;

-- The copy above has already run, inside the runner's per-file transaction: had
-- it failed, nothing below would execute and the original table would still be
-- here untouched.
DROP TABLE partner_subscription;

-- `PRAGMA legacy_alter_table` — REQUIRED, and not for legacy's sake. With it OFF
-- (the default) SQLite re-parses EVERY trigger and view in the schema on any
-- ALTER TABLE … RENAME and aborts the rename if ANY unrelated object fails to
-- parse. On a database where an earlier migration left a trigger whose host
-- table has a different shape (e.g. `trg_pc_chain_guard` over `platform_config`
-- where 0123 could not apply), that unrelated breakage would take THIS rename
-- down: "error in trigger trg_pc_chain_guard: no such column:
-- NEW.prev_revision_hash". Nothing in the schema references
-- `partner_subscription` — no view, no foreign key, no trigger (verified against
-- a fully migrated database) — so the re-parse has nothing useful to rewrite.
-- The flag is restored immediately after.
PRAGMA legacy_alter_table = ON;
ALTER TABLE partner_subscription_w13_new RENAME TO partner_subscription;
PRAGMA legacy_alter_table = OFF;

-- ---------------------------------------------------------------------------
-- 5. Indexes. Both naming families are created: the 0167 names (so 0167's
--    intent is finally satisfied) and the 0153 names (so nothing that reasoned
--    about `idx_psub_*` silently loses its index).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_partner_subscription_subject
  ON partner_subscription(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_partner_subscription_status
  ON partner_subscription(status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_partner_subscription_intent
  ON partner_subscription(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_psub_subject
  ON partner_subscription(subject_kind, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_psub_intent
  ON partner_subscription(payment_intent_id);

-- 0167 declared `payment_intent_id TEXT UNIQUE`; expressed here as a PARTIAL
-- unique index so the many rows that legitimately have no intent yet do not
-- collide on NULL semantics. A pre-existing duplicate intent id aborts this
-- migration inside its transaction — loudly, with no data lost — which is the
-- correct outcome: two subscription rows on one gateway intent is a double
-- charge waiting to happen and must be resolved by a human, not silently
-- indexed away.
CREATE UNIQUE INDEX IF NOT EXISTS uq_psub_intent
  ON partner_subscription(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

-- At most ONE live subscription per SUBJECT — the Wave 5 invariant
-- (`uq_psub_one_live`, previously on partner_id) repointed at the canonical
-- identity. 'grace' joins the live set because a graced subscription is still
-- an entitlement and startCheckout already refuses to mint a second one
-- (server/lib/partnerSubscriptionStore.ts:hasActiveSubscription).
DROP INDEX IF EXISTS uq_psub_one_live;
CREATE UNIQUE INDEX uq_psub_one_live
  ON partner_subscription(subject_kind, subject_id)
  WHERE status IN ('pending','active','past_due','grace','grandfathered');
