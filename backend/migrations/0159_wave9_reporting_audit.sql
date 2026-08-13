-- migrations/0159_wave9_reporting_audit.sql
-- WAVE 9 — REPORTING, AUDIT AND DATA.
--
-- MIGRATION NUMBER — 0152. Verified against THIS tree on 2026-08-10, not assumed:
--   `ls migrations/*.sql | tail -1`            -> 0151_wave3e_fee_settlement_authorization.sql
--   `ls server/db/migrations/*.sql | tail -1`  -> 0151_wave3e_fee_settlement_authorization.sql
--   0149 / 0150 / 0151 are TAKEN (Wave 4B, Wave 3D, Wave 3E). 0152 is the next free id
--   in BOTH directories. This file is mirrored byte-identically into
--   server/db/migrations/0159_wave9_reporting_audit.sql (see
--   server/__tests__/w9_migration_mirror_drift.test.ts, which enforces it).
--
-- WHY EVERY TABLE HERE EXISTS
--   Wave 9 removes fabricated reporting figures (RP-1..RP-5) and replaces them
--   with numbers that trace to real rows. A deletion without a producer is a
--   silent drop, so the producers land in the same migration as the deletions:
--
--     vehicle_cashflow          M-1   ILPA transaction taxonomy — the dated flow
--                                     ledger XIRR / DPI / RVPI / TVPI / PIC read.
--     valuation_event           M-2   Marks derived from the last priced round,
--                                     badged with date + source, stale at 180/365 d
--                                     (owner ruling Q5).
--     valuation_mark_override   M-2b  GP override with a MANDATORY reason (Q5:
--                                     GP-overridable, admin "able to approve").
--     portfolio_metric_snapshot M-3   MONTHLY snapshots (owner ruling Q9). Charts
--                                     render only at >= 3 points.
--     spv_carry_terms           M-5   Hurdle / catch-up / GP commitment. `spv.carry_basis`
--                                     (per_deployment | whole_spv) already exists and is
--                                     NOT duplicated here — it is referenced.
--     wave9_reporting_config    M-3/M-4/M-2  Every threshold this wave needs, DB-driven.
--                                     No hardcoded 180 / 365 / 3 / min-N anywhere in code.
--     bridge_runtime_config     A-3   Durable bridge MODE (was: nowhere at all).
--     bridge_runtime_config_history A-3 Append-only audit of every MODE change.
--     bridge_event_grandfather  A-4   OQ-10: grandfather all queued events, DO NOT DRAIN.
--     ddl_column_disposition    DA-4  The ruled disposition of the 9 DDL-only columns.
--     spv_scope_migration       SM-1  OQ-5: collective_only collapses into network,
--                                     with the before/after of every vehicle recorded.
--
-- MONEY is INTEGER MINOR UNITS everywhere in this file (`*_minor`).
-- PERCENTAGES are FRACTIONS everywhere in this file (`*_rate`, `*_pct` in [0,1]).
--
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss, no rewrite of an existing row
-- except the SM-1 scope collapse, which is itself journalled row-by-row.

-- ---------------------------------------------------------------------------
-- M-1 — ILPA cash-flow ledger (14 transaction types)
-- ---------------------------------------------------------------------------
-- Types are exactly the ILPA set named in spec/OQ8_OQ9_INDUSTRY_STANDARDS.md A.10#1.
CREATE TABLE IF NOT EXISTS vehicle_cashflow (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT NOT NULL,
  vehicle_kind      TEXT NOT NULL CHECK (vehicle_kind IN ('spv','fund','company','portfolio')),
  vehicle_id        TEXT NOT NULL,
  lp_id             TEXT,
  txn_type          TEXT NOT NULL CHECK (txn_type IN (
                      'capital_call_investment',
                      'capital_call_management_fee',
                      'capital_call_expenses',
                      'distribution_income',
                      'distribution_gain_loss',
                      'distribution_return_of_capital_permanent',
                      'distribution_return_of_capital_recallable',
                      'distribution_return_of_mgmt_fees_permanent',
                      'distribution_return_of_mgmt_fees_recallable',
                      'distribution_return_of_excess_capital',
                      'carry_clawback',
                      'deemed_contribution',
                      'deemed_distribution',
                      'in_specie_distribution')),
  value_date        TEXT NOT NULL
                      CHECK (value_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'),
  -- SIGN CONVENTION: contributions (LP -> vehicle) are NEGATIVE, distributions
  -- (vehicle -> LP) are POSITIVE. This is the XIRR convention and is asserted
  -- by server/lib/ilpaCashflowLedger.ts assertSignConvention().
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  is_recallable     INTEGER NOT NULL DEFAULT 0 CHECK (is_recallable IN (0,1)),
  source_kind       TEXT NOT NULL DEFAULT 'manual',
  source_ref        TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_vcf_vehicle  ON vehicle_cashflow(vehicle_kind, vehicle_id, value_date);
CREATE INDEX IF NOT EXISTS idx_w9_vcf_lp       ON vehicle_cashflow(lp_id, value_date);
CREATE INDEX IF NOT EXISTS idx_w9_vcf_tenant   ON vehicle_cashflow(tenant_id);
CREATE INDEX IF NOT EXISTS idx_w9_vcf_type     ON vehicle_cashflow(txn_type);

-- ---------------------------------------------------------------------------
-- M-2 — valuation events (marks). A.10#2: "No implicit defaults."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valuation_event (
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
  created_at        TEXT NOT NULL
                      CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  superseded_at     TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_val_vehicle ON valuation_event(vehicle_kind, vehicle_id, valuation_date DESC);
CREATE INDEX IF NOT EXISTS idx_w9_val_holding ON valuation_event(holding_id, valuation_date DESC);
CREATE INDEX IF NOT EXISTS idx_w9_val_live    ON valuation_event(vehicle_id, superseded_at);

-- ---------------------------------------------------------------------------
-- M-2b — GP mark override. Owner ruling Q5: marks are GP-OVERRIDABLE; the
-- override carries a MANDATORY reason and raises an admin notification.
-- The CHECK enforces the reason at the STORAGE layer, not just in code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS valuation_mark_override (
  id                  TEXT PRIMARY KEY NOT NULL,
  tenant_id           TEXT NOT NULL,
  valuation_event_id  TEXT NOT NULL,
  vehicle_kind        TEXT NOT NULL CHECK (vehicle_kind IN ('spv','fund','company','portfolio')),
  vehicle_id          TEXT NOT NULL,
  holding_id          TEXT,
  prior_fair_value_minor INTEGER,
  fair_value_minor    INTEGER NOT NULL CHECK (fair_value_minor >= 0),
  currency            TEXT NOT NULL,
  reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  overridden_by       TEXT NOT NULL,
  overridden_at       TEXT NOT NULL
                        CHECK (overridden_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  -- Q5 ruling as scoped in CONSORTIUM_PARTNER_BUILD_v8.md:687 — build "able to
  -- approve", not "must approve". The override is EFFECTIVE on write; approval
  -- is an admin affordance recorded here, never a gate on the GP.
  approval_state      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (approval_state IN ('pending','approved','rejected')),
  approved_by         TEXT,
  approved_at         TEXT,
  approval_note       TEXT,
  -- Optional per-share expression of the override. A mark derived from the last
  -- priced round is a PRICE PER SHARE; when a GP overrides that price rather
  -- than a total fair value, this is where the replacement price lives, and
  -- effectiveMarkForCompany() substitutes it. NULL means the override carries
  -- only a total fair value.
  price_per_share_override REAL CHECK (price_per_share_override IS NULL OR price_per_share_override >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_mov_event   ON valuation_mark_override(valuation_event_id);
CREATE INDEX IF NOT EXISTS idx_w9_mov_state   ON valuation_mark_override(approval_state);
CREATE INDEX IF NOT EXISTS idx_w9_mov_vehicle ON valuation_mark_override(vehicle_kind, vehicle_id);

-- ---------------------------------------------------------------------------
-- M-3 — MONTHLY portfolio metric snapshots (owner ruling Q9).
-- Precedent: chapter_leaderboard_snapshots (migrations/0036, server/db/connection.ts:4174).
-- Shape deliberately echoes that table: (tenant, subject, period, period_start, generated_at).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_metric_snapshot (
  id                 TEXT PRIMARY KEY NOT NULL,
  tenant_id          TEXT NOT NULL,
  subject_kind       TEXT NOT NULL CHECK (subject_kind IN ('investor','spv','fund','platform')),
  subject_id         TEXT NOT NULL,
  -- Q9: MONTHLY. The CHECK makes any other cadence unrepresentable.
  period             TEXT NOT NULL DEFAULT 'monthly' CHECK (period = 'monthly'),
  period_start       TEXT NOT NULL
                       CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01'),
  contributed_minor  INTEGER NOT NULL,
  distributed_minor  INTEGER NOT NULL,
  residual_value_minor INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  -- Multiples are stored as PLAIN MULTIPLES (1.42 == 1.42x), not fractions and
  -- not percents. IRR is stored as a FRACTION (0.185 == 18.5%) per the
  -- platform-wide percent policy; client/src/lib/percentDisplay.ts multiplies.
  dpi                REAL,
  rvpi               REAL,
  tvpi               REAL,
  pic_multiple       REAL,
  net_irr            REAL,
  gross_irr          REAL,
  -- Per-metric status enum (M-1c). Persisted so a chart point can never be
  -- re-interpreted as a computed number after the fact.
  status_json        TEXT NOT NULL CHECK (json_valid(status_json)),
  marked_positions   INTEGER NOT NULL DEFAULT 0,
  unmarked_positions INTEGER NOT NULL DEFAULT 0,
  generated_at       TEXT NOT NULL
                       CHECK (generated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  UNIQUE (tenant_id, subject_kind, subject_id, period, period_start)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_pms_subject ON portfolio_metric_snapshot(subject_kind, subject_id, period_start);
CREATE INDEX IF NOT EXISTS idx_w9_pms_period  ON portfolio_metric_snapshot(period, period_start);
CREATE INDEX IF NOT EXISTS idx_w9_pms_tenant  ON portfolio_metric_snapshot(tenant_id);

-- ---------------------------------------------------------------------------
-- M-5 — carry terms. `spv.carry_basis` (per_deployment | whole_spv) already
-- exists in the spv table and is NOT re-declared. Only the terms the carry
-- engine needs and that had nowhere to live are added.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_carry_terms (
  spv_id               TEXT PRIMARY KEY NOT NULL,
  tenant_id            TEXT NOT NULL,
  -- FRACTIONS. hurdle_rate 0.08 == an 8% preferred return.
  hurdle_rate          REAL NOT NULL DEFAULT 0 CHECK (hurdle_rate >= 0 AND hurdle_rate <= 1),
  hurdle_kind          TEXT NOT NULL DEFAULT 'none'
                         CHECK (hurdle_kind IN ('none','hard','soft')),
  -- catch_up_rate 1.0 == a 100% GP catch-up.
  catch_up_rate        REAL NOT NULL DEFAULT 0 CHECK (catch_up_rate >= 0 AND catch_up_rate <= 1),
  gp_commitment_minor  INTEGER NOT NULL DEFAULT 0 CHECK (gp_commitment_minor >= 0),
  currency             TEXT NOT NULL,
  set_by               TEXT NOT NULL,
  created_at           TEXT NOT NULL
                         CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at           TEXT NOT NULL
                         CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

-- ---------------------------------------------------------------------------
-- CONFIG — every Wave 9 threshold, DB-driven. "No hardcoding" is a standing rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wave9_reporting_config (
  key          TEXT PRIMARY KEY NOT NULL,
  value_json   TEXT NOT NULL CHECK (json_valid(value_json)),
  value_type   TEXT NOT NULL CHECK (value_type IN ('string','number','boolean','json')),
  description  TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
                 CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

INSERT OR IGNORE INTO wave9_reporting_config (key, value_json, value_type, description, updated_by, updated_at) VALUES
  ('marks.stale_warn_days', '180', 'number',
   'Owner ruling Q5 — a derived mark is badged STALE after this many days.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('marks.stale_expired_days', '365', 'number',
   'Owner ruling Q5 — a derived mark is badged EXPIRED after this many days and stops counting as a mark.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('marks.auto_derive', 'true', 'boolean',
   'Owner ruling Q5 — marks auto-derive from the last priced round.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('marks.override_admin_approval_mode', '"able_to"', 'string',
   'Owner ruling Q5 / OPEN-3 — admin is ABLE TO approve a GP override; approval is not a gate.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('snapshot.min_points_for_chart', '3', 'number',
   'Owner ruling Q9 — a time-series chart renders only at or above this many snapshot points.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('benchmark.min_cohort_n', '5', 'number',
   'GATE-Q10N — minimum cohort sample size before a benchmark is published. Owner-settable; admin surface writes this key.',
   'migration:0152', '2026-08-10T00:00:00Z'),
  ('benchmark.source', '"platform_snapshots"', 'string',
   'Owner ruling Q10 — benchmarks are computed FROM PLATFORM DATA, never an external feed.',
   'migration:0152', '2026-08-10T00:00:00Z');

-- ---------------------------------------------------------------------------
-- A-3 — DURABLE bridge MODE. Before Wave 9 the bridge mode existed only as the
-- derived process constant LIVE_MODE (server/lib/bridgeRuntime.ts:56), computed
-- from two env vars at import time. It could not be inspected, changed, or
-- audited, and it did not survive a restart. It is now a row.
-- IMPLEMENTATION ONLY — the seeded value is 'shadow'. NO PRODUCTION FLIP (A-3b
-- is the owner-authorised flip and is gated on GATE-A3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_runtime_config (
  key         TEXT PRIMARY KEY NOT NULL,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  description TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
                CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

CREATE TABLE IF NOT EXISTS bridge_runtime_config_history (
  id          TEXT PRIMARY KEY NOT NULL,
  key         TEXT NOT NULL,
  from_json   TEXT,
  to_json     TEXT NOT NULL CHECK (json_valid(to_json)),
  reason      TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  authorised_by TEXT NOT NULL,
  changed_at  TEXT NOT NULL
                CHECK (changed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_brch_key ON bridge_runtime_config_history(key, changed_at DESC);

INSERT OR IGNORE INTO bridge_runtime_config (key, value_json, description, updated_by, updated_at) VALUES
  ('mode', '"shadow"',
   'Bridge delivery mode: off | shadow | live. A-3 ships storage only; shadow is the safe default. Flipping to live is A-3b and requires an owner authorisation reason.',
   'migration:0152', '2026-08-10T00:00:00Z');

-- ---------------------------------------------------------------------------
-- A-4 — OQ-10 grandfather boundary. "Grandfather them all in. Draining would
-- erase test data points." Every queued event is PRESERVED and MARKED, never
-- replayed, delivered or deleted. One row per grandfathered event; one
-- boundary row recording the count, range and reason.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_grandfather_boundary (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT NOT NULL,
  event_count     INTEGER NOT NULL CHECK (event_count >= 0),
  range_from      TEXT,
  range_to        TEXT,
  reason          TEXT NOT NULL,
  audit_note_id   TEXT,
  prior_anchor_hash TEXT,
  new_anchor_hash TEXT,
  new_anchor_row_id TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL
                    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;

CREATE TABLE IF NOT EXISTS bridge_event_grandfather (
  event_id      TEXT PRIMARY KEY NOT NULL,
  boundary_id   TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  queued_at     TEXT,
  grandfathered_at TEXT NOT NULL
                    CHECK (grandfathered_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*')
) STRICT;
CREATE INDEX IF NOT EXISTS idx_w9_beg_boundary ON bridge_event_grandfather(boundary_id);
CREATE INDEX IF NOT EXISTS idx_w9_beg_tenant   ON bridge_event_grandfather(tenant_id);

-- ---------------------------------------------------------------------------
-- DA-4 / OPN-025 — the ruled disposition of the 9 DDL-only orphan columns.
-- Owner decision required (owner_decision = Y). Deletion is the LAST resort
-- under standing rule OR-J, and OR-J requires a signed dossier per surface,
-- which does not exist for any of these columns. The disposition applied here
-- is therefore DOCUMENT for all nine — recorded durably, surfaced in the admin
-- UI, and enforced by a lint test so a tenth undocumented DDL-only column
-- cannot appear silently. Nothing is dropped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ddl_column_disposition (
  id             TEXT PRIMARY KEY NOT NULL,
  table_name     TEXT NOT NULL,
  column_name    TEXT NOT NULL,
  declared_in    TEXT NOT NULL,
  disposition    TEXT NOT NULL CHECK (disposition IN ('use','drop','document')),
  rationale      TEXT NOT NULL,
  risk_class     TEXT NOT NULL CHECK (risk_class IN ('security','compliance','feature','marker','unknown')),
  owner_ruled    INTEGER NOT NULL DEFAULT 0 CHECK (owner_ruled IN (0,1)),
  recorded_at    TEXT NOT NULL
                   CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  UNIQUE (table_name, column_name)
) STRICT;

INSERT OR IGNORE INTO ddl_column_disposition
  (id, table_name, column_name, declared_in, disposition, rationale, risk_class, owner_ruled, recorded_at) VALUES
  ('ddc_auth_users_locked_until','auth_users','locked_until','db/schema.ts:185; db/connection.ts:4879; migration 0001','document',
   'Account lockout is DECLARED but never implemented — no code reads or writes it. Security-relevant, so it is NOT dropped: dropping it would delete the only evidence that lockout was intended. Retained and published pending a lockout implementation item.','security',1,'2026-08-10T00:00:00Z'),
  ('ddc_fcc_invite_status','founder_crm_contacts','invite_status','migration 0069; db/connection.ts:1788','document',
   'Invite-tracking trio declared v25.47 HIGH-1 and never wired. Retained for the invite-tracking feature; dropping would silently remove a promised capability.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_fcc_invited_at','founder_crm_contacts','invited_at','migration 0069','document',
   'Second member of the invite-tracking trio. Same disposition as invite_status.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_fcc_invited_round_id','founder_crm_contacts','invited_round_id','migration 0069; db/connection.ts:1789','document',
   'Third member of the invite-tracking trio. Same disposition as invite_status.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_mfe_consent_scope','mf_engagement','consent_scope','lib/applyWaveC2AuthorityArtifactsSchema.ts:116','document',
   'Consent scoping declared for delegated agency, never enforced in code. Compliance-relevant with a NOT NULL DEFAULT ''public_data_only'' — dropping it would widen the implied consent scope. Retained and published.','compliance',1,'2026-08-10T00:00:00Z'),
  ('ddc_mfe_founder_revoked_by','mf_engagement','founder_revoked_by','lib/applyWaveC2MfEngagementSchema.ts:83; migration 0131:74','document',
   'Revocation ACTOR never recorded although founder_revoked_at IS used (lib/delegatedAgency.ts:183). Half-wired audit field; retained so the actor can be back-filled rather than lost.','compliance',1,'2026-08-10T00:00:00Z'),
  ('ddc_cdr_contact_ids','crm_dedup_review','contact_ids','migration DDL only','document',
   'Dedup-review table declared; only scope_id is used elsewhere. Likely an abandoned feature — but OR-J forbids deletion without a signed cross-platform impact dossier, and none exists.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_cdr_crm_scope','crm_dedup_review','crm_scope','migration DDL only','document',
   'Same table and same disposition as crm_dedup_review.contact_ids.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_cdr_distinct_names','crm_dedup_review','distinct_names','migration DDL only','document',
   'Same table and same disposition as crm_dedup_review.contact_ids.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_cdr_email_norm','crm_dedup_review','email_norm','migration DDL only','document',
   'Same table and same disposition as crm_dedup_review.contact_ids.','feature',1,'2026-08-10T00:00:00Z'),
  ('ddc_npsb_marker','network_post_scope_backfill','*','migration DDL only','document',
   'One-shot migration marker table. INTENTIONAL, explicitly NOT a defect (PLATFORM_ORPHAN_AUDIT.md §G). Recorded so it is never re-reported as an orphan.','marker',1,'2026-08-10T00:00:00Z'),
  ('ddc_preflight_marker','_preflight_check','*','migration DDL only','document',
   'Migration smoke-test table. INTENTIONAL, explicitly NOT a defect (PLATFORM_ORPHAN_AUDIT.md §G). Recorded so it is never re-reported as an orphan.','marker',1,'2026-08-10T00:00:00Z');

-- ---------------------------------------------------------------------------
-- SM-1 / OQ-5 — collective_only collapses into network.
-- Owner ruling: "Private deals are meant for invitation only views/soft-circles
-- and collective deals are all network." Two audiences, not three.
-- The migration is JOURNALLED: every affected vehicle keeps its prior scope in
-- a row, so the collapse is reversible and provable. The journal is written
-- FIRST, then the update.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_scope_migration (
  id            TEXT PRIMARY KEY NOT NULL,
  spv_id        TEXT NOT NULL,
  spv_name      TEXT,
  prior_scope   TEXT NOT NULL,
  new_scope     TEXT NOT NULL,
  ruling        TEXT NOT NULL,
  migrated_at   TEXT NOT NULL
                  CHECK (migrated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  UNIQUE (spv_id, prior_scope, new_scope)
) STRICT;

-- THE COLLAPSE ITSELF IS NOT RUN HERE. `spv` is created by the boot-time
-- bootstrap in server/db/connection.ts:5166, NOT by a migration, so a DML
-- statement against it in this file would fail on a fresh database where
-- migrations run before bootstrap. The journal-then-update is executed by
-- server/lib/applyWave9ReportingSchema.ts applyOq5ScopeCollapse(), which runs
-- against a live driver and is table-existence guarded. It writes the SAME
-- rows into THIS table. Proven by server/__tests__/wave9_sm1_scope_collapse.test.ts.

-- ---------------------------------------------------------------------------
-- DA-5 — contacts.subscription_id is READ at
--   server/lib/partnerSelfServiceRoutes.ts:119
--   server/lib/partnerFeeAdminRoutes.ts:207,:222
-- and WRITTEN NOWHERE (DEF-006 / SUB-20 / PLATFORM_ORPHAN_AUDIT.md §G1), so
-- GET /api/partner/me/subscription always resolved null.
-- The WRITER lands in code: server/lib/contactSubscriptionLink.ts, called from
-- the checkout path (subscriptionStore.recordPendingSubscription and
-- activateByPaymentIntent). `capavate_subscriptions` is likewise a lazily
-- created table (server/subscriptionStore.ts:108), not a migration table, so
-- the backfill of pre-existing rows also lives in that module
-- (backfillContactSubscriptionLinks) rather than in this file.
-- The column already exists (migration 0054:118) — no ALTER here.

-- ---------------------------------------------------------------------------
-- A-6 / OPN-009 — the 21-vs-36 unregistered spv.* count. The TRUE number is
-- computed at runtime by server/lib/bridgeEventRegistryReconcile.ts from the
-- actual emit sites and the actual registry, and published on
-- GET /api/bridge/event-types. This table stores each published reconciliation
-- so the number is auditable rather than asserted in prose.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_registry_reconciliation (
  id                 TEXT PRIMARY KEY NOT NULL,
  computed_at        TEXT NOT NULL
                       CHECK (computed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  emitted_spv_types  INTEGER NOT NULL CHECK (emitted_spv_types >= 0),
  registered_spv_types INTEGER NOT NULL CHECK (registered_spv_types >= 0),
  unregistered_spv_types INTEGER NOT NULL CHECK (unregistered_spv_types >= 0),
  detail_json        TEXT NOT NULL CHECK (json_valid(detail_json)),
  computed_by        TEXT NOT NULL
) STRICT;
