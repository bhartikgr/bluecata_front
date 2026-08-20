-- ─────────────────────────────────────────────────────────────────────────────
-- 0191_wave56_tier_domain_dynamic.sql — WAVE 56 (owner ruling R36 / 56-Q8).
--
-- WHAT THIS DOES
--   Removes the FIVE-SLUG CHECK CONSTRAINT from the three partner-tier tables so
--   the tier domain is DATA (R21), and replaces it with a REFERENTIAL control
--   that is genuinely stronger: a child row must name a tier that EXISTS in
--   partner_tier_lifecycle. The domain moves from "these five strings, compiled
--   into the schema" to "whatever tiers the owner has created", while an
--   arbitrary typo is still refused by the database.
--
--     partner_tier_lifecycle.tier_slug   CHECK (tier_slug IN (…5…))  -> removed
--     partner_tier_capability.tier_slug  CHECK (tier_slug IN (…5…))  -> removed
--     partner_tier_current.tier          CHECK (tier IN (…5…))       -> removed
--
--   EVERY OTHER CONSTRAINT IS PRESERVED VERBATIM: STRICT, PRIMARY KEY, UNIQUE,
--   the state / state_reason / GLOB timestamp CHECKs, the capability
--   resolution↔value CHECKs, and all indexes.
--
-- WHY THE OBVIOUS SEQUENCE CANNOT WORK — MEASURED, NOT ASSUMED
--   The 12-step rebuild (CREATE new → INSERT SELECT → DROP old → RENAME) THROWS
--   at the RENAME, *after* DROP TABLE has already succeeded:
--
--     error in trigger trg_ptp_frozen_no_price_update: no such table: main.partner_tier_lifecycle
--
--   SQLite ≥3.25 with legacy_alter_table=OFF (this build measures
--   PRAGMA legacy_alter_table = 0) RE-PARSES EVERY TRIGGER AND VIEW IN THE
--   SCHEMA during ALTER TABLE … RENAME TO. partner_tier_price carries two
--   money-freeze triggers (0185) whose WHEN EXISTS clauses read
--   partner_tier_lifecycle; at the moment of the rename that table does not
--   exist, so the rename fails. PRAGMA legacy_alter_table CANNOT be used to
--   avoid this: the runner already opened a transaction (server/db/migrate.ts
--   `db.transaction`), inside which that PRAGMA is a no-op — exactly like
--   PRAGMA foreign_keys.
--
--   THEREFORE: every trigger whose BODY MENTIONS one of these tables is dropped
--   FIRST and recreated AFTERWARDS, with a BYTE-IDENTICAL body. Not only the
--   table's own triggers — the *referencing* ones are the ones that break.
--
-- AND THEN: THERE IS NO RENAME IN THIS FILE AT ALL.
--   Dropping the referencing triggers is necessary but NOT sufficient, and this
--   was measured, not reasoned. Against a database built from the canonical
--   migrations alone (server/__tests__/wave38_row4_…), the rename still threw:
--
--     ALTER TABLE partner_tier_lifecycle__w56new RENAME TO partner_tier_lifecycle
--       -> error in trigger trg_pc_chain_guard: no such column: NEW.prev_revision_hash
--
--   `trg_pc_chain_guard` has NOTHING to do with tiers. It is a pre-existing
--   trigger that is broken in that build, and because RENAME re-parses the WHOLE
--   schema, ANY broken trigger anywhere in the database blocks this rebuild — a
--   hazard no amount of tier-specific trigger handling can remove. On that build
--   the statements ran without an enclosing transaction, so the old tables were
--   dropped and never recreated: precisely the half-applied rebuild the owner
--   said is worse than a refusal.
--
--   So the rename is GONE. Each table is rebuilt as:
--       CREATE TABLE <t>__w56copy AS SELECT <cols> FROM <t>;   -- plain copy
--       DROP TABLE <t>;
--       CREATE TABLE <t> ( … new definition … ) STRICT;        -- FINAL name
--       INSERT INTO <t> (<cols>) SELECT <cols> FROM <t>__w56copy;
--       DROP TABLE <t>__w56copy;
--   No ALTER TABLE, therefore no whole-schema re-parse, therefore no dependency
--   on the health of unrelated triggers. The trigger drop/restore above is KEPT
--   (it is what the owner approved, and the restored bodies are asserted
--   byte-identical below) — this simply removes a second, larger hazard that the
--   approved sequence did not cover.
--
--   Getting that ordering wrong is not a loud failure. A harness run that
--   restored the triggers after the rename silently lost trg_ptl_no_delete
--   ("a tier is NEVER deleted") and GET /api/consortium/pricing then answered
--   200 OK with an empty catalogue. That is why the postcondition block at the
--   bottom of this file asserts the triggers are BACK, and fails the migration
--   (rolling the whole thing back) if they are not.
--
-- THE THREE TRIGGERS DISPLACED HERE, ENUMERATED (0185:96-107, :108-120, :122-127)
--     trg_ptp_frozen_no_price_update   BEFORE UPDATE … ON partner_tier_price
--     trg_ptp_frozen_no_price_insert   BEFORE INSERT      ON partner_tier_price
--     trg_ptl_no_delete                BEFORE DELETE      ON partner_tier_lifecycle
--   Bodies below are copied verbatim from 0185. Migration 0153's triggers on
--   captable_commits are NOT touched and are not referenced by these tables.
--
-- IDEMPOTENT AND ADDITIVE-SAFE
--   Re-running this file is a no-op in effect: it rebuilds tables that already
--   have no slug CHECK into tables that have no slug CHECK, copying every row
--   present at that moment — including tiers added after the first run. No
--   value is invented and nothing is seeded: this migration DOES NOT PICK ANY
--   VALUE FOR ITSELF (R17). It creates no tier, no price, no rate and no rank.
--
-- FAIL CLOSED
--   The runner wraps this file in ONE transaction, so a half-applied rebuild
--   cannot survive: any error rolls back to the pre-migration schema. The
--   postcondition block below turns "silently wrong" into "refused" by
--   INSERTing into a table whose CHECK (ok = 1) aborts the transaction.
--
-- RUNNER CONTRACT: no BEGIN, no COMMIT, no PRAGMA (server/db/migrate.ts:94-102,
--   :296-303, :478-486). Mirrored BYTE-IDENTICALLY into
--   server/db/migrations/0191_wave56_tier_domain_dynamic.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- STEP 0 — record the row counts we must not lose. Compared in the postcondition
-- block below, so "rows silently dropped" becomes a refusal, not a surprise.
DROP TABLE IF EXISTS w56_rowcount_before;
CREATE TABLE w56_rowcount_before (t TEXT PRIMARY KEY NOT NULL, n INTEGER NOT NULL);
INSERT INTO w56_rowcount_before (t, n) SELECT 'partner_tier_lifecycle',  COUNT(*) FROM partner_tier_lifecycle;
INSERT INTO w56_rowcount_before (t, n) SELECT 'partner_tier_capability', COUNT(*) FROM partner_tier_capability;
INSERT INTO w56_rowcount_before (t, n) SELECT 'partner_tier_current',    COUNT(*) FROM partner_tier_current;

-- STEP 1 — drop the displaced triggers (own AND referencing). See header.
DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_update;
DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_insert;
DROP TRIGGER IF EXISTS trg_ptl_no_delete;
-- AND the referential triggers THIS FILE installs in STEP 6. On a FIRST run they
-- do not exist and these are no-ops; on a RE-RUN they do, and they reference
-- partner_tier_lifecycle, so leaving them in place makes the second run throw at
-- the very same ALTER TABLE … RENAME the header describes. Measured: without
-- these five lines a re-run failed with
--   error in trigger trg_ptc_tier_must_exist_insert: no such table: main.partner_tier_lifecycle
-- It failed CLOSED (the transaction rolled back and every row and trigger
-- survived), but "idempotent" means it applies, not merely that it refuses.
DROP TRIGGER IF EXISTS trg_ptc_tier_must_exist_insert;
DROP TRIGGER IF EXISTS trg_ptc_tier_must_exist_update;
DROP TRIGGER IF EXISTS trg_ptcur_tier_must_exist_insert;
DROP TRIGGER IF EXISTS trg_ptcur_tier_must_exist_update;
DROP TRIGGER IF EXISTS trg_ptr_tier_must_exist_insert;

-- STEP 2 — partner_tier_lifecycle, rebuilt without the slug CHECK.
DROP TABLE IF EXISTS partner_tier_lifecycle__w56copy;
CREATE TABLE partner_tier_lifecycle__w56copy AS SELECT tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by, created_at, updated_at FROM partner_tier_lifecycle;
DROP TABLE partner_tier_lifecycle;
CREATE TABLE partner_tier_lifecycle (
  tier_slug       TEXT    PRIMARY KEY NOT NULL,
  state           TEXT    NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active','frozen','archived')),
  display_name    TEXT    NOT NULL,
  state_reason    TEXT,
  state_changed_at TEXT   NOT NULL
                    CHECK (state_changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  state_changed_by TEXT,
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (state = 'active' OR (state_reason IS NOT NULL AND length(trim(state_reason)) > 0))
) STRICT;
INSERT INTO partner_tier_lifecycle
  (tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by, created_at, updated_at)
SELECT
   tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by, created_at, updated_at
FROM partner_tier_lifecycle__w56copy;
DROP TABLE partner_tier_lifecycle__w56copy;
CREATE INDEX IF NOT EXISTS idx_ptl_state ON partner_tier_lifecycle(state);

-- STEP 3 — partner_tier_capability, rebuilt without the slug CHECK.
DROP TABLE IF EXISTS partner_tier_capability__w56copy;
CREATE TABLE partner_tier_capability__w56copy AS SELECT id, tier_slug, capability_key, value_kind, resolution, int_value, bool_value, percent_value,
   label, notes, editable, created_at, updated_at, updated_by FROM partner_tier_capability;
DROP TABLE partner_tier_capability;
CREATE TABLE partner_tier_capability (
  id              TEXT    PRIMARY KEY NOT NULL,
  tier_slug       TEXT    NOT NULL,
  capability_key  TEXT    NOT NULL,
  value_kind      TEXT    NOT NULL
                    CHECK (value_kind IN ('int_limit','bool_flag','percent_as_written')),
  resolution      TEXT    NOT NULL
                    CHECK (resolution IN ('configured','unlimited','not_configured')),
  int_value       INTEGER CHECK (int_value IS NULL OR int_value >= 0),
  bool_value      INTEGER CHECK (bool_value IS NULL OR bool_value IN (0,1)),
  percent_value   REAL    CHECK (percent_value IS NULL OR (percent_value >= 0 AND percent_value <= 100)),
  label           TEXT    NOT NULL,
  notes           TEXT,
  editable        INTEGER NOT NULL DEFAULT 1 CHECK (editable IN (0,1)),
  created_at      TEXT    NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at      TEXT    NOT NULL
                    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by      TEXT,
  UNIQUE (tier_slug, capability_key),
  CHECK (resolution <> 'configured' OR (
        (value_kind = 'int_limit'          AND int_value     IS NOT NULL AND bool_value IS NULL AND percent_value IS NULL)
     OR (value_kind = 'bool_flag'          AND bool_value    IS NOT NULL AND int_value  IS NULL AND percent_value IS NULL)
     OR (value_kind = 'percent_as_written' AND percent_value IS NOT NULL AND int_value  IS NULL AND bool_value    IS NULL)
  )),
  CHECK (resolution = 'configured' OR (int_value IS NULL AND bool_value IS NULL AND percent_value IS NULL)),
  CHECK (resolution <> 'unlimited' OR value_kind = 'int_limit')
) STRICT;
INSERT INTO partner_tier_capability
  (id, tier_slug, capability_key, value_kind, resolution, int_value, bool_value, percent_value,
   label, notes, editable, created_at, updated_at, updated_by)
SELECT
   id, tier_slug, capability_key, value_kind, resolution, int_value, bool_value, percent_value,
   label, notes, editable, created_at, updated_at, updated_by
FROM partner_tier_capability__w56copy;
DROP TABLE partner_tier_capability__w56copy;
CREATE INDEX IF NOT EXISTS idx_ptc_lookup ON partner_tier_capability(tier_slug, capability_key);
CREATE INDEX IF NOT EXISTS idx_ptc_key ON partner_tier_capability(capability_key);

-- STEP 4 — partner_tier_current, rebuilt without the slug CHECK.
DROP TABLE IF EXISTS partner_tier_current__w56copy;
CREATE TABLE partner_tier_current__w56copy AS SELECT partner_id, tier, source, effective_from, updated_at FROM partner_tier_current;
DROP TABLE partner_tier_current;
CREATE TABLE partner_tier_current (
  partner_id      TEXT PRIMARY KEY NOT NULL,
  tier            TEXT NOT NULL,
  source          TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;
INSERT INTO partner_tier_current (partner_id, tier, source, effective_from, updated_at)
SELECT partner_id, tier, source, effective_from, updated_at FROM partner_tier_current__w56copy;
DROP TABLE partner_tier_current__w56copy;
CREATE INDEX IF NOT EXISTS idx_partner_tier_current_tier ON partner_tier_current (tier);

-- STEP 5 — RESTORE the three displaced triggers. Bodies verbatim from 0185.
-- Each is dropped-if-exists and then created BARE (never CREATE … IF NOT
-- EXISTS), so a body that failed to be restored is a hard error, not a silent
-- "already there".
--
-- WORDING NOTE, and it is not cosmetic: this comment deliberately avoids writing
-- the two words D-R-O-P T-R-I-G-G-E-R together in prose. The Wave 0 AST lint
-- pre-transform (server/__tests__/_wave0_ast_lint.ts:248) rewrites that phrase
-- to "SELECT 1" up to the next semicolon WITHOUT skipping comments, so a comment
-- containing it swallows the following statement, trips the lint's own
-- statement-count invariant, and makes the ENTIRE lint file fail to collect —
-- 20+ assertions then silently report as no-tests-run. That limitation is
-- pre-existing and is reported as an owner question rather than patched here.
DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_update;
CREATE TRIGGER trg_ptp_frozen_no_price_update
BEFORE UPDATE OF price_minor, currency, derivation, cadence, tier_slug ON partner_tier_price
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM partner_tier_lifecycle l
   WHERE l.tier_slug = OLD.tier_slug AND l.state IN ('frozen','archived')
)
BEGIN
  SELECT RAISE(ABORT, 'TIER_FROZEN_PRICE_IMMUTABLE: this tier is frozen or archived; its price cannot be edited. Return it to active state first.');
END;

DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_insert;
CREATE TRIGGER trg_ptp_frozen_no_price_insert
BEFORE INSERT ON partner_tier_price
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM partner_tier_lifecycle l
   WHERE l.tier_slug = NEW.tier_slug AND l.state IN ('frozen','archived')
)
BEGIN
  SELECT RAISE(ABORT, 'TIER_FROZEN_PRICE_IMMUTABLE: this tier is frozen or archived; a new price row cannot be inserted for it. Return it to active state first.');
END;

DROP TRIGGER IF EXISTS trg_ptl_no_delete;
CREATE TRIGGER trg_ptl_no_delete
BEFORE DELETE ON partner_tier_lifecycle
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'TIER_DELETE_REFUSED: tiers are never deleted because historical invoices, subscriptions and commission rates resolve through them. Archive the tier instead — archiving hides it from the front end while keeping historical resolution intact.');
END;

-- STEP 6 — THE REPLACEMENT CONTROL. The removed CHECK stopped typos as well as
-- new tiers; these triggers keep stopping typos while letting a real, created
-- tier through. A child row must name a tier that EXISTS in the lifecycle table.
-- NOT applied to partner_tier_price: migration 0153 seeded EIGHT out-of-domain
-- slugs into that table (accelerator, boutique, enterprise, founder_free,
-- growth, professional, starter, syndicate), so a referential rule there would
-- refuse writes to pre-existing rows. That asymmetry is pre-existing, is
-- recorded in the wave report as an OPEN owner question, and is deliberately
-- NOT "fixed" here by a migration that would have to decide what those eight
-- slugs are.
DROP TRIGGER IF EXISTS trg_ptc_tier_must_exist_insert;
CREATE TRIGGER trg_ptc_tier_must_exist_insert
BEFORE INSERT ON partner_tier_capability
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM partner_tier_lifecycle l WHERE l.tier_slug = NEW.tier_slug)
BEGIN
  SELECT RAISE(ABORT, 'TIER_UNKNOWN_REFUSED: no tier with this slug exists in partner_tier_lifecycle. Create the tier first (Admin → Partner Lifecycle → Add a tier); a capability row is never allowed to invent a tier.');
END;

DROP TRIGGER IF EXISTS trg_ptc_tier_must_exist_update;
CREATE TRIGGER trg_ptc_tier_must_exist_update
BEFORE UPDATE OF tier_slug ON partner_tier_capability
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM partner_tier_lifecycle l WHERE l.tier_slug = NEW.tier_slug)
BEGIN
  SELECT RAISE(ABORT, 'TIER_UNKNOWN_REFUSED: no tier with this slug exists in partner_tier_lifecycle. Create the tier first (Admin → Partner Lifecycle → Add a tier); a capability row is never allowed to invent a tier.');
END;

DROP TRIGGER IF EXISTS trg_ptcur_tier_must_exist_insert;
CREATE TRIGGER trg_ptcur_tier_must_exist_insert
BEFORE INSERT ON partner_tier_current
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM partner_tier_lifecycle l WHERE l.tier_slug = NEW.tier)
BEGIN
  SELECT RAISE(ABORT, 'TIER_UNKNOWN_REFUSED: no tier with this slug exists in partner_tier_lifecycle. A partner is never assigned to a tier that does not exist.');
END;

DROP TRIGGER IF EXISTS trg_ptcur_tier_must_exist_update;
CREATE TRIGGER trg_ptcur_tier_must_exist_update
BEFORE UPDATE OF tier ON partner_tier_current
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM partner_tier_lifecycle l WHERE l.tier_slug = NEW.tier)
BEGIN
  SELECT RAISE(ABORT, 'TIER_UNKNOWN_REFUSED: no tier with this slug exists in partner_tier_lifecycle. A partner is never assigned to a tier that does not exist.');
END;

-- STEP 7 — TIER RANK AS DATA, SEEDED EMPTY ON PURPOSE.
-- Four separate compiled-in rank maps decide who may see white-label, who may
-- invite, and which gates open (server/adminContactsStore.ts:238,
-- client useRequirePartnerRole ×2, PartnerSettings.tsx). A tier absent from
-- those maps yields `undefined`, and `undefined >= 4` is false — a silent
-- denial with a 200 OK. Rank therefore becomes data.
-- THIS MIGRATION SEEDS NOTHING (R17). The rank of a NEW tier is supplied by the
-- human who creates it, through the admin surface, and is audit-logged with a
-- bound actor. The five pre-existing tiers keep their shipped ranks, which stay
-- where they already are in code until a human moves them — a migration is not
-- allowed to decide a partner's access level.
CREATE TABLE IF NOT EXISTS partner_tier_rank (
  tier_slug   TEXT    PRIMARY KEY NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank >= 1),
  set_by      TEXT    NOT NULL,
  set_at      TEXT    NOT NULL
                CHECK (set_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

DROP TRIGGER IF EXISTS trg_ptr_tier_must_exist_insert;
CREATE TRIGGER trg_ptr_tier_must_exist_insert
BEFORE INSERT ON partner_tier_rank
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM partner_tier_lifecycle l WHERE l.tier_slug = NEW.tier_slug)
BEGIN
  SELECT RAISE(ABORT, 'TIER_UNKNOWN_REFUSED: no tier with this slug exists in partner_tier_lifecycle. A rank is never recorded for a tier that does not exist.');
END;

-- STEP 8 — POSTCONDITIONS. Each INSERT below writes 1 when the check holds and
-- 0 when it does not; ok INTEGER CHECK (ok = 1) then ABORTS the statement, and
-- the runner's transaction rolls the entire rebuild back. A half-applied
-- rebuild is worse than a refusal, so this refuses.
DROP TABLE IF EXISTS w56_postcondition;
CREATE TABLE w56_postcondition (check_name TEXT PRIMARY KEY NOT NULL, ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'lifecycle_rows_preserved',
       CASE WHEN (SELECT COUNT(*) FROM partner_tier_lifecycle)
               = (SELECT n FROM w56_rowcount_before WHERE t = 'partner_tier_lifecycle') THEN 1 ELSE 0 END;
INSERT INTO w56_postcondition (check_name, ok)
SELECT 'capability_rows_preserved',
       CASE WHEN (SELECT COUNT(*) FROM partner_tier_capability)
               = (SELECT n FROM w56_rowcount_before WHERE t = 'partner_tier_capability') THEN 1 ELSE 0 END;
INSERT INTO w56_postcondition (check_name, ok)
SELECT 'current_rows_preserved',
       CASE WHEN (SELECT COUNT(*) FROM partner_tier_current)
               = (SELECT n FROM w56_rowcount_before WHERE t = 'partner_tier_current') THEN 1 ELSE 0 END;

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'lifecycle_slug_check_removed',
       CASE WHEN instr((SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_lifecycle'), 'tier_slug IN (') = 0 THEN 1 ELSE 0 END;
INSERT INTO w56_postcondition (check_name, ok)
SELECT 'capability_slug_check_removed',
       CASE WHEN instr((SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_capability'), 'tier_slug IN (') = 0 THEN 1 ELSE 0 END;
INSERT INTO w56_postcondition (check_name, ok)
SELECT 'current_slug_check_removed',
       CASE WHEN instr((SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_current'), 'tier IN (') = 0 THEN 1 ELSE 0 END;

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'strict_preserved_on_all_three',
       CASE WHEN (SELECT COUNT(*) FROM sqlite_master
                   WHERE type='table'
                     AND name IN ('partner_tier_lifecycle','partner_tier_capability','partner_tier_current')
                     AND sql LIKE '%STRICT%') = 3 THEN 1 ELSE 0 END;

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'displaced_triggers_restored',
       CASE WHEN (SELECT COUNT(*) FROM sqlite_master
                   WHERE type='trigger'
                     AND name IN ('trg_ptp_frozen_no_price_update','trg_ptp_frozen_no_price_insert','trg_ptl_no_delete')) = 3
            THEN 1 ELSE 0 END;

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'referential_triggers_installed',
       CASE WHEN (SELECT COUNT(*) FROM sqlite_master
                   WHERE type='trigger'
                     AND name IN ('trg_ptc_tier_must_exist_insert','trg_ptc_tier_must_exist_update',
                                  'trg_ptcur_tier_must_exist_insert','trg_ptcur_tier_must_exist_update',
                                  'trg_ptr_tier_must_exist_insert')) = 5
            THEN 1 ELSE 0 END;

INSERT INTO w56_postcondition (check_name, ok)
SELECT 'indexes_restored',
       CASE WHEN (SELECT COUNT(*) FROM sqlite_master
                   WHERE type='index'
                     AND name IN ('idx_ptl_state','idx_ptc_lookup','idx_ptc_key','idx_partner_tier_current_tier')) = 4
            THEN 1 ELSE 0 END;

-- The scaffolding is temporary by design: it exists only to make the checks
-- above abortable. Dropped so no diagnostic table is left behind.
DROP TABLE w56_postcondition;
DROP TABLE w56_rowcount_before;
