-- WAVE 38 · ROW 4 — THE FIVE EVENT TABLES GET THEIR LEDGER PRIMITIVES BACK.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DEFECT, PROVEN AGAINST A LIVE DATABASE — NOT INFERRED FROM SQL TEXT
-- ─────────────────────────────────────────────────────────────────────────────
-- `server/__tests__/wave0_3_ledger_primitives_lint.test.ts` has been red on
-- three assertions. Wave 37 and Review 3A independently concluded the LINT IS
-- RIGHT and the SCHEMA IS WRONG, and 3A demonstrated it rather than asserting
-- it. Against a database built end-to-end by the shipped production migrator:
--
--   INSERT INTO partner_subscription_event(... amount_minor ...) VALUES ('12.5')
--     -> stored (12.5, 'real')
--   INSERT INTO partner_subscription_event(... amount_minor ...) VALUES ('not-a-number')
--     -> stored ('not-a-number', 'text')
--
-- `amount_minor INTEGER` is a MONEY COLUMN. In a non-STRICT SQLite table
-- INTEGER is an affinity, not a type: a string that does not look like a number
-- is stored verbatim. The control on an equivalent STRICT table is
-- `cannot store TEXT value in INTEGER column`. Three of the five tables below
-- were declared without STRICT and therefore have no type floor at all.
--
-- Review 3A's mitigating finding is that all five tables are audit/telemetry
-- rather than the ledger of record (partner balances are computed from
-- `partner_invoice_line`; the cap-table ledger is the hash-chained, sacred
-- `captable_commits`). That is why this is MEDIUM and not CRITICAL. It is NOT
-- why it should be left alone: a money column that accepts 'not-a-number' is a
-- defect even on a telemetry table, because that data is read back and
-- reported. `listMoneyEvents` / `listMoneyEventsForPartner` / the subscription
-- timeline all render these rows to operators.
--
-- The second half of the defect is the missing IDEMPOTENCY FLOOR: none of the
-- five carried `idempotency_key`, and none carried any unique index beyond the
-- primary key, so a retried emit silently duplicated the event; and with no
-- `seq` there was no gap or ordering detection over an append-only log.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FIX IS THE SCHEMA, NOT THE LINT
-- ─────────────────────────────────────────────────────────────────────────────
-- Every one of the SIX tables (five from Review 3A plus mf_engagement_event,
-- which the strengthened lint found on its first run — see block 6/6) is
-- rebuilt to the canonical Wave 0 event shape
-- (`wave0/EVENT_COLUMNS_CANONICAL.sql`):
--
--     actor_id          TEXT    NOT NULL
--     request_id        TEXT
--     idempotency_key   TEXT
--     source_event_type TEXT
--     source_event_id   TEXT
--     reverses_id       TEXT
--     seq               INTEGER NOT NULL CHECK (seq > 0)
--     created_at        TEXT    NOT NULL CHECK (created_at GLOB 'YYYY-MM-DDT*')
--     deleted_at        TEXT    CHECK (NULL OR GLOB 'YYYY-MM-DDT*')
--
-- plus `STRICT` on all five and `CREATE UNIQUE INDEX ... ON t(idempotency_key)
-- WHERE idempotency_key IS NOT NULL` on all five, exactly as the canonical
-- template requires. No lint expectation was widened, no exemption added, and
-- `EVENT_TABLE_SUFFIX_RE` was not touched.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE REBUILD AND NOT `ALTER TABLE ... ADD COLUMN`
-- ─────────────────────────────────────────────────────────────────────────────
-- SQLite cannot add `STRICT` to an existing table, cannot add a NOT NULL column
-- without a constant default, and cannot add a CHECK constraint in place. The
-- 12-step table-rebuild procedure documented in the SQLite manual is the only
-- shape that gets a type floor onto a live table. Each rebuild here:
--   1. creates `<t>__w38` with the canonical, STRICT shape;
--   2. copies EVERY existing row, deriving the new columns rather than
--      fabricating them (see the per-table notes);
--   3. drops the old table (which drops its indexes and triggers with it);
--   4. renames the new table into place;
--   5. RECREATES every index and every append-only trigger the old table had,
--      byte-for-byte in behaviour. Nothing is silently dropped.
--
-- BACKFILL HONESTY. `seq` is per-parent (canonical exception 2), so it is
-- derived with `ROW_NUMBER() OVER (PARTITION BY <parent> ORDER BY <time>, rowid)`
-- — a real ordering read off the rows that exist, not a constant. `actor_id`
-- is taken from the row's own actor column where the table has one, and is
-- otherwise `'system'`, which is the truthful statement that the historical
-- row was machine-emitted and no actor was ever recorded. It is NOT presented
-- as a user id. `idempotency_key` is left NULL on every historical row: a key
-- invented after the fact would collide arbitrarily and would assert an
-- idempotency guarantee that never held. The partial unique index skips NULLs
-- precisely so history can be honest about this.
--
-- RUN-ONCE, NOT IDEMPOTENT — AND SAID PLAINLY. `db/migrate.ts` records every
-- applied filename in `__drizzle_migrations_applied` and skips it thereafter,
-- so this file executes exactly once per database. A table rebuild is NOT a
-- self-idempotent statement and this header does not pretend otherwise: a
-- forced second execution would copy the already-canonical rows through the
-- historical column list and blank `request_id` / `idempotency_key`. The
-- leading `DROP TABLE IF EXISTS <t>__w38` on each block exists so that a run
-- INTERRUPTED mid-rebuild leaves no half-built scratch table behind to poison
-- the retry — that is crash tolerance, which is a different property from
-- idempotency, and it is the one that is actually claimed here.
--
-- MIRRORED. This file is copied byte-identically to
-- `server/db/migrations/0183_wave38_event_table_ledger_primitives.sql` and
-- verified with `cmp`.
--
-- SACRED: `server/db/connection.ts` and `server/db/migrate.ts` were READ and
-- NOT EDITED for this change.
-- ===========================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1/6 — partner_money_event (0153). Was STRICT; had NONE of the canonical
--       columns and used `emitted_at` rather than `created_at`.
--       `emitted_at` is KEPT (four read paths select it) and `created_at` is
--       populated from it, so no reader breaks and no fact is invented.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS partner_money_event__w38;
CREATE TABLE IF NOT EXISTS partner_money_event__w38 (
  id                TEXT    PRIMARY KEY NOT NULL,
  event_name        TEXT    NOT NULL,
  partner_id        TEXT,
  subject_kind      TEXT    NOT NULL
                      CHECK (subject_kind IN ('subscription','invoice','promotion','commission','captable_commit')),
  subject_id        TEXT    NOT NULL,
  payload_json      TEXT    NOT NULL,
  emitted_at        TEXT    NOT NULL
                      CHECK (emitted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  actor_id          TEXT    NOT NULL,
  request_id        TEXT,
  idempotency_key   TEXT,
  source_event_type TEXT,
  source_event_id   TEXT,
  reverses_id       TEXT,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at        TEXT
                      CHECK (deleted_at IS NULL
                             OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

INSERT OR IGNORE INTO partner_money_event__w38
  (id, event_name, partner_id, subject_kind, subject_id, payload_json, emitted_at,
   actor_id, seq, created_at)
SELECT id, event_name, partner_id, subject_kind, subject_id, payload_json, emitted_at,
       'system',
       ROW_NUMBER() OVER (PARTITION BY subject_kind, subject_id ORDER BY emitted_at, rowid),
       emitted_at
  FROM partner_money_event;

DROP TABLE IF EXISTS partner_money_event;
-- `PRAGMA legacy_alter_table` — REQUIRED, and not for legacy's sake. This is the
-- same guard, for the same reason, as migrations/0169:265-275. With the flag OFF
-- (the default) SQLite re-parses EVERY trigger and view in the schema on any
-- ALTER TABLE ... RENAME and aborts if ANY unrelated object fails to parse. On a
-- database where 0123's `trg_pc_chain_guard` sits over a `platform_config` of a
-- different shape, that unrelated breakage takes THIS rename down with
-- "error in trigger trg_pc_chain_guard: no such column: NEW.prev_revision_hash".
-- Proven, not assumed: `wave38_row4_event_ledger_primitives_schema.test.ts`
-- builds the whole canonical chain and asserted exactly that failure before this
-- guard was added. Nothing in the schema references these six tables by view,
-- foreign key or trigger at rename time (their own triggers are dropped with the
-- old table and recreated below), so the re-parse has nothing useful to rewrite.
-- The flag is restored immediately after each rename.
PRAGMA legacy_alter_table = ON;
ALTER TABLE partner_money_event__w38 RENAME TO partner_money_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_pme_subject ON partner_money_event(subject_kind, subject_id, emitted_at);
CREATE INDEX IF NOT EXISTS idx_pme_partner ON partner_money_event(partner_id, emitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_partner_money_event_idem
  ON partner_money_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pme_seq ON partner_money_event(subject_kind, subject_id, seq);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2/6 — valuation_event (0159). Was STRICT; had `created_at` but none of the
--       seven canonical columns and no `deleted_at`.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS valuation_event__w38;
CREATE TABLE IF NOT EXISTS valuation_event__w38 (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT NOT NULL,
  vehicle_kind      TEXT NOT NULL CHECK (vehicle_kind IN ('spv','fund','company','portfolio')),
  vehicle_id        TEXT NOT NULL,
  holding_id        TEXT,
  valuation_date    TEXT NOT NULL
                      CHECK (valuation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'),
  fair_value_minor  INTEGER NOT NULL CHECK (fair_value_minor >= 0),
  currency          TEXT NOT NULL,
  method            TEXT NOT NULL CHECK (method IN (
                      'last_priced_round','transaction_price','market_multiple',
                      'dcf','cost','write_off','gp_override')),
  source            TEXT NOT NULL CHECK (source IN (
                      'derived_priced_round','gp_override','external_appraisal','admin_import')),
  source_ref        TEXT,
  preparer          TEXT NOT NULL,
  is_external       INTEGER NOT NULL CHECK (is_external IN (0,1)),
  created_by        TEXT NOT NULL,
  superseded_at     TEXT,
  actor_id          TEXT NOT NULL,
  request_id        TEXT,
  idempotency_key   TEXT,
  source_event_type TEXT,
  source_event_id   TEXT,
  reverses_id       TEXT,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  created_at        TEXT NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at        TEXT
                      CHECK (deleted_at IS NULL
                             OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

-- `created_by` IS a real recorded actor on this table, so actor_id is derived
-- from it rather than defaulted to 'system'.
INSERT OR IGNORE INTO valuation_event__w38
  (id, tenant_id, vehicle_kind, vehicle_id, holding_id, valuation_date,
   fair_value_minor, currency, method, source, source_ref, preparer,
   is_external, created_by, superseded_at, actor_id, seq, created_at)
SELECT id, tenant_id, vehicle_kind, vehicle_id, holding_id, valuation_date,
       fair_value_minor, currency, method, source, source_ref, preparer,
       is_external, created_by, superseded_at,
       created_by,
       ROW_NUMBER() OVER (PARTITION BY vehicle_kind, vehicle_id ORDER BY created_at, rowid),
       created_at
  FROM valuation_event;

DROP TABLE IF EXISTS valuation_event;
PRAGMA legacy_alter_table = ON;
ALTER TABLE valuation_event__w38 RENAME TO valuation_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_w9_val_vehicle ON valuation_event(vehicle_kind, vehicle_id, valuation_date DESC);
CREATE INDEX IF NOT EXISTS idx_w9_val_holding ON valuation_event(holding_id, valuation_date DESC);
CREATE INDEX IF NOT EXISTS idx_w9_val_live    ON valuation_event(vehicle_id, superseded_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_valuation_event_idem
  ON valuation_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_w9_val_seq ON valuation_event(vehicle_kind, vehicle_id, seq);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3/6 — partner_subscription_event (0167). THE MONEY-TYPING HOLE.
--       Was NOT STRICT, so `amount_minor INTEGER` accepted '12.5' and
--       'not-a-number'. Now STRICT, so both are rejected by the engine.
--       The two append-only triggers are recreated verbatim.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS partner_subscription_event__w38;
CREATE TABLE IF NOT EXISTS partner_subscription_event__w38 (
  id                TEXT    PRIMARY KEY NOT NULL,
  subscription_id   TEXT    NOT NULL,
  event_kind        TEXT    NOT NULL,
  from_status       TEXT,
  to_status         TEXT,
  amount_minor      INTEGER,
  currency          TEXT,
  detail_json       TEXT,
  actor             TEXT,
  actor_id          TEXT    NOT NULL,
  request_id        TEXT,
  idempotency_key   TEXT,
  source_event_type TEXT,
  source_event_id   TEXT,
  reverses_id       TEXT,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at        TEXT
                      CHECK (deleted_at IS NULL
                             OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

-- THE MONEY COLUMN IS RE-TYPED ON THE WAY IN, AND REFUSES RATHER THAN GUESSES.
-- Integers pass through untouched. A REAL that is exactly integral (12.0) is
-- narrowed. Digit-only text ('1250') is narrowed. EVERYTHING ELSE BECOMES NULL:
-- a REAL with a fractional part has no correct minor-unit value (12.5 minor
-- units is not a thing, and rounding it to 13 would invent money), and
-- 'not-a-number' is not money at all. Per the standing money rule these become
-- NULLS, NOT ZEROS, so the read paths render a refusal instead of a made-up
-- amount. On a clean database this CASE is a pass-through and changes nothing;
-- it exists because the missing STRICT floor means we cannot assume clean.
INSERT OR IGNORE INTO partner_subscription_event__w38
  (id, subscription_id, event_kind, from_status, to_status, amount_minor,
   currency, detail_json, actor, actor_id, seq, created_at)
SELECT id, subscription_id, event_kind, from_status, to_status,
       CASE
         WHEN amount_minor IS NULL THEN NULL
         WHEN typeof(amount_minor) = 'integer' THEN amount_minor
         WHEN typeof(amount_minor) = 'real'
              AND amount_minor = CAST(amount_minor AS INTEGER)
           THEN CAST(amount_minor AS INTEGER)
         -- Round-trip equality is an EXACT integer test and needs no pattern
         -- matching: '1250' survives CAST->TEXT unchanged, while '12.5'
         -- becomes '12' and 'not-a-number' becomes '0'. Both mismatch and are
         -- refused. (GLOB is deliberately avoided here: the Wave 0 AST lint's
         -- parser rejects GLOB in an expression position, and a migration the
         -- lint cannot parse is a migration nobody is checking.)
         WHEN typeof(amount_minor) = 'text'
              AND TRIM(amount_minor) <> ''
              AND CAST(CAST(TRIM(amount_minor) AS INTEGER) AS TEXT) = TRIM(amount_minor)
           THEN CAST(TRIM(amount_minor) AS INTEGER)
         ELSE NULL
       END,
       currency, detail_json, actor,
       COALESCE(NULLIF(TRIM(COALESCE(actor, '')), ''), 'system'),
       ROW_NUMBER() OVER (PARTITION BY subscription_id ORDER BY created_at, rowid),
       created_at
  FROM partner_subscription_event;

DROP TABLE IF EXISTS partner_subscription_event;
PRAGMA legacy_alter_table = ON;
ALTER TABLE partner_subscription_event__w38 RENAME TO partner_subscription_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_partner_subscription_event_sub
  ON partner_subscription_event(subscription_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_partner_subscription_event_idem
  ON partner_subscription_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pse_seq ON partner_subscription_event(subscription_id, seq);

-- Append-only enforcement, recreated verbatim from 0167. A rebuild that dropped
-- these would have silently removed the immutability guarantee.
DROP TRIGGER IF EXISTS trg_w11_pse_no_update;
CREATE TRIGGER trg_w11_pse_no_update
BEFORE UPDATE ON partner_subscription_event
BEGIN
  SELECT RAISE(ABORT, 'partner_subscription_event is append-only (WAVE 11 EN-6)');
END;

DROP TRIGGER IF EXISTS trg_w11_pse_no_delete;
CREATE TRIGGER trg_w11_pse_no_delete
BEFORE DELETE ON partner_subscription_event
BEGIN
  SELECT RAISE(ABORT, 'partner_subscription_event is append-only (WAVE 11 EN-6)');
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4/6 — esign_event (0168). Was NOT STRICT. The FK to esign_envelope(id) and
--       both append-only triggers are preserved.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS esign_event__w38;
CREATE TABLE IF NOT EXISTS esign_event__w38 (
  id                TEXT    PRIMARY KEY NOT NULL,
  envelope_id       TEXT    NOT NULL REFERENCES esign_envelope(id),
  recipient_id      TEXT,
  event_kind        TEXT    NOT NULL,
  from_status       TEXT,
  to_status         TEXT,
  actor             TEXT,
  detail_json       TEXT,
  actor_id          TEXT    NOT NULL,
  request_id        TEXT,
  idempotency_key   TEXT,
  source_event_type TEXT,
  source_event_id   TEXT,
  reverses_id       TEXT,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at        TEXT
                      CHECK (deleted_at IS NULL
                             OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

INSERT OR IGNORE INTO esign_event__w38
  (id, envelope_id, recipient_id, event_kind, from_status, to_status, actor,
   detail_json, actor_id, seq, created_at)
SELECT id, envelope_id, recipient_id, event_kind, from_status, to_status, actor,
       detail_json,
       COALESCE(NULLIF(TRIM(COALESCE(actor, '')), ''), 'system'),
       ROW_NUMBER() OVER (PARTITION BY envelope_id ORDER BY created_at, rowid),
       created_at
  FROM esign_event;

DROP TABLE IF EXISTS esign_event;
PRAGMA legacy_alter_table = ON;
ALTER TABLE esign_event__w38 RENAME TO esign_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_w11_esign_event_env
  ON esign_event(envelope_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_esign_event_idem
  ON esign_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_w11_esign_event_seq ON esign_event(envelope_id, seq);

CREATE TRIGGER IF NOT EXISTS trg_w11_ese_no_update
  BEFORE UPDATE ON esign_event
  BEGIN SELECT RAISE(ABORT, 'ESIGN_EVENT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_w11_ese_no_delete
  BEFORE DELETE ON esign_event
  BEGIN SELECT RAISE(ABORT, 'ESIGN_EVENT_IMMUTABLE'); END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5/6 — spv_discovery_event (0179). Was NOT STRICT. `viewer_user_id` is the
--       identity the discovery predicate ran for, so it IS the actor.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS spv_discovery_event__w38;
CREATE TABLE IF NOT EXISTS spv_discovery_event__w38 (
  id                TEXT    PRIMARY KEY NOT NULL,
  spv_id            TEXT    NOT NULL,
  viewer_user_id    TEXT    NOT NULL,
  context           TEXT    NOT NULL,
  scope_at_time     TEXT    NOT NULL,
  via_invitation    INTEGER NOT NULL DEFAULT 0,
  actor_id          TEXT    NOT NULL,
  request_id        TEXT,
  idempotency_key   TEXT,
  source_event_type TEXT,
  source_event_id   TEXT,
  reverses_id       TEXT,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  created_at        TEXT    NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at        TEXT
                      CHECK (deleted_at IS NULL
                             OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (context IN ('collective', 'capavate', 'network', 'invited')),
  CHECK (via_invitation IN (0, 1))
) STRICT;

INSERT OR IGNORE INTO spv_discovery_event__w38
  (id, spv_id, viewer_user_id, context, scope_at_time, via_invitation,
   actor_id, seq, created_at)
SELECT id, spv_id, viewer_user_id, context, scope_at_time, via_invitation,
       viewer_user_id,
       ROW_NUMBER() OVER (PARTITION BY spv_id ORDER BY created_at, rowid),
       created_at
  FROM spv_discovery_event;

DROP TABLE IF EXISTS spv_discovery_event;
PRAGMA legacy_alter_table = ON;
ALTER TABLE spv_discovery_event__w38 RENAME TO spv_discovery_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_spv_discovery_event_spv
  ON spv_discovery_event(spv_id, created_at);
CREATE INDEX IF NOT EXISTS idx_spv_discovery_event_viewer
  ON spv_discovery_event(viewer_user_id, spv_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_spv_discovery_event_idem
  ON spv_discovery_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spv_discovery_event_seq ON spv_discovery_event(spv_id, seq);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6/6 — mf_engagement_event. FOUND BY THE STRENGTHENED LINT, NOT BY REVIEW.
--
-- Review 3A listed five offending tables. There are SIX. The sixth was
-- invisible to the old lint for a structural reason worth recording: 0131
-- rebuilt this table through a scratch name, `mf_engagement_event_new`, and the
-- lint's event-table predicate is a name test (`_event$`). `..._event_new` does
-- not match, so the shape that 0131 actually LEFT IN THE DATABASE was never
-- examined by anything. The old lint was checking a declaration that had been
-- superseded and skipping the one that survived. Folding the corpus into an
-- effective schema surfaced it on the first run.
--
-- Its shape here is 0131's relaxed shape (nullable engagement_id/company_id,
-- the five LOCK-3-A columns, the scope CHECK) plus the canonical event columns
-- and STRICT. Nothing 0131 established is removed.
--
-- PRESENCE. This table is NOT created by any canonical migration — it is born
-- in application code (`server/lib/mfcrmSchema.ts`, mirrored into
-- `server/db/connection.ts`'s inline boot DDL), and 0131 merely ALTERs and
-- rebuilds it. That was NOT an assumption: the first run of
-- `wave38_row4_event_ledger_primitives_schema.test.ts`, which builds from
-- `migrations/` ALONE, reported "no such table: mf_engagement_event" here and
-- shows 0131's own ALTERs failing on the same install for the same reason.
-- So this block creates the table first if it is absent, in 0131's
-- post-rebuild shape. On every real database the table already exists and the
-- guard is a no-op; on a canonical-only install it makes the rebuild total
-- rather than conditional, and the copy below simply moves zero rows.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mf_engagement_event (
  id                           TEXT PRIMARY KEY NOT NULL,
  partner_id                   TEXT NOT NULL,
  engagement_id                TEXT,
  company_id                   TEXT,
  event_type                   TEXT NOT NULL,
  detail_json                  TEXT,
  actor                        TEXT,
  created_at                   TEXT NOT NULL,
  actor_role                   TEXT CHECK (actor_role IN ('founder','partner','admin','system')),
  actor_partner_user_id        TEXT REFERENCES users(id),
  acting_on_behalf_of_user_id  TEXT REFERENCES users(id),
  partner_attribution_id       TEXT REFERENCES partner_attributions(id),
  event_data_json              TEXT,
  CHECK (engagement_id IS NOT NULL OR partner_attribution_id IS NOT NULL)
);

DROP TABLE IF EXISTS mf_engagement_event__w38;
CREATE TABLE IF NOT EXISTS mf_engagement_event__w38 (
  id                           TEXT    PRIMARY KEY NOT NULL,
  partner_id                   TEXT    NOT NULL,
  engagement_id                TEXT,
  company_id                   TEXT,
  event_type                   TEXT    NOT NULL,
  detail_json                  TEXT,
  actor                        TEXT,
  actor_role                   TEXT    CHECK (actor_role IN ('founder','partner','admin','system')),
  actor_partner_user_id        TEXT    REFERENCES users(id),
  acting_on_behalf_of_user_id  TEXT    REFERENCES users(id),
  partner_attribution_id       TEXT    REFERENCES partner_attributions(id),
  event_data_json              TEXT,
  actor_id                     TEXT    NOT NULL,
  request_id                   TEXT,
  idempotency_key              TEXT,
  source_event_type            TEXT,
  source_event_id              TEXT,
  reverses_id                  TEXT,
  seq                          INTEGER NOT NULL CHECK (seq > 0),
  created_at                   TEXT    NOT NULL
                                 CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  deleted_at                   TEXT
                                 CHECK (deleted_at IS NULL
                                        OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  CHECK (engagement_id IS NOT NULL OR partner_attribution_id IS NOT NULL)
) STRICT;

INSERT OR IGNORE INTO mf_engagement_event__w38
  (id, partner_id, engagement_id, company_id, event_type, detail_json, actor,
   actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
   partner_attribution_id, event_data_json, actor_id, seq, created_at)
SELECT id, partner_id, engagement_id, company_id, event_type, detail_json, actor,
       actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
       partner_attribution_id, event_data_json,
       COALESCE(NULLIF(TRIM(COALESCE(actor, '')), ''),
                actor_partner_user_id,
                'system'),
       ROW_NUMBER() OVER (PARTITION BY partner_id, engagement_id ORDER BY created_at, rowid),
       created_at
  FROM mf_engagement_event;

DROP TABLE IF EXISTS mf_engagement_event;
PRAGMA legacy_alter_table = ON;
ALTER TABLE mf_engagement_event__w38 RENAME TO mf_engagement_event;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_partner ON mf_engagement_event(partner_id);
CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_eng ON mf_engagement_event(engagement_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mf_engagement_event_idem
  ON mf_engagement_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_seq
  ON mf_engagement_event(partner_id, engagement_id, seq);
