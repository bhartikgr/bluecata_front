-- 0170_wave14_money_orphan_reporting_audit.sql
--
-- WAVE 14 — the remaining Money / Orphan / Reporting / Audit items.
--
-- NUMBER CHOICE. Highest number occupied on disk before this file was 0169
-- (`ls migrations/ | sort | tail`), verified in BOTH migration directories.
-- 0152 / 0154 / 0155 / 0158 are BURNT (claimed and abandoned by earlier waves)
-- and are not reused. This file is mirrored byte-identically into
-- `migrations/` and `server/db/migrations/`; `cmp` parity is asserted by
-- server/__tests__/wave14_money_orphan.test.ts.
--
-- SHAPE-COLLISION RULE. Every table below is declared HERE AND NOWHERE ELSE.
-- Checked with `grep -rn "CREATE TABLE.*<name>" migrations server/db` before
-- writing: zero prior declarations, so no `IF NOT EXISTS` can silently discard
-- an incompatible second definition (the Wave 13 defect).
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not price anything, does not flip
-- the bridge to live, and does not answer an owner question. Owner-decision
-- items are recorded as OPEN rows so they are visible in the product and cannot
-- be silently dropped (standing rule: account for every item; never defer).
--
-- ITEM MAP
--   CP-PROMO-04 / CP-PROMO-17 / CP-PROMO-22 / CP-SUB-19  -> build_policy_decision
--   CP-PROMO-19                                          -> build_policy_decision (policy row) + code
--   ORP-037 / ORP-041 / ORP-062                          -> orphan_surface_disposition
--   ORP-053                                              -> ddl_column_disposition is READ by a route now
--                                                           (no schema change: the rows already exist,
--                                                            seeded by 0159 — this wave executes them)
--   ORP-033                                              -> founder_notification_preference
--   M-5                                                  -> spv_carry_accrual
--   M-1d                                                 -> wave9_reporting_config footnote keys
--   A-2                                                  -> platform_audit_incident
--   CP-BRG-07                                            -> no schema (SSE aggregate over existing rows)

-- ---------------------------------------------------------------------------
-- build_policy_decision — a durable, inspectable record of a BUILD-LEVEL
-- decision (sequencing, packaging, owner question). Distinct from
-- `percent_policy_record` (percent semantics only) and from
-- `your_decision_records` (an end-user product feature). One row per decision;
-- `state='open'` means nobody has ruled and the build must not assume.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS build_policy_decision (
  id              TEXT PRIMARY KEY NOT NULL,
  item_id         TEXT NOT NULL,
  decision_key    TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('open','ruled','recorded')),
  question        TEXT NOT NULL,
  ruling          TEXT,
  rationale       TEXT NOT NULL,
  source_ref      TEXT NOT NULL,
  owner_required  INTEGER NOT NULL DEFAULT 0 CHECK (owner_required IN (0,1)),
  recorded_at     TEXT NOT NULL
                    CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  recorded_by     TEXT NOT NULL,
  UNIQUE (decision_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_bpd_state ON build_policy_decision(state, item_id);

INSERT OR IGNORE INTO build_policy_decision
  (id, item_id, decision_key, state, question, ruling, rationale, source_ref, owner_required, recorded_at, recorded_by)
VALUES
  ('bpd_promo04_sequencing', 'CP-PROMO-04', 'promo.g0_sequencing', 'recorded',
   'In what order must the G.0 promotion work land relative to the money fix?',
   'Money fix FIRST, refactor SECOND. Enforced, not merely documented: the promotion discount resolver (partnerBillingStore.resolvePromotionDiscount) is exact-BigInt and is the ONLY discount producer on the partner checkout path; any promotion refactor that bypasses it fails server/__tests__/wave14_money_orphan.test.ts.',
   'A promotion refactor that lands before the discount arithmetic is exact will silently re-round every promoted price. The sequencing is therefore a MONEY constraint, not a project-management preference, and it is recorded here with the test that enforces it.',
   'spec/PARTNER_BUILT_VS_PROMISED.md PROMO-04 (ABSENT P1); register row PRM-146',
   0, '2026-08-10T00:00:00Z', 'system:wave14_promo04'),

  ('bpd_promo17_packaging', 'CP-PROMO-17', 'promo.g0_single_commit', 'recorded',
   'How is the G.0 promotion change packaged for deploy?',
   'ONE migration (this file, 0170), ONE route module (server/lib/wave14MoneyRoutes.ts), ONE deploy. No promotion schema is created in any other file in this wave.',
   'Splitting G.0 across two migrations is how the 0153/0167 partner_subscription collision happened: two files declaring overlapping shapes, install order deciding the outcome. A single migration makes the shape unambiguous. The single-file claim is machine-checked by the test suite, which greps the migration tree for any OTHER file declaring the tables in this one.',
   'spec/PARTNER_BUILT_VS_PROMISED.md PROMO-17 (ABSENT P2); register row PRM-159',
   0, '2026-08-10T00:00:00Z', 'system:wave14_promo17'),

  ('bpd_promo19_supersede', 'CP-PROMO-19', 'promo.supersedes_founder_free', 'recorded',
   'When a promotion applies to a partner already on founder_free, do the two stack?',
   'NEVER STACK. A promotion SUPERSEDES founder_free: the grandfathered row moves to status=superseded with superseded_reason in the SAME transaction that inserts the new subscription.',
   'Stacking a 100%-off grandfathered row with a promotion produces a negative charge, which is why partnerBillingStore.createSubscription performs the supersession inside its transaction. Wave 14 found the supersession was on a writer with NO ROUTE while the live checkout writer (partnerSubscriptionStore) did not supersede at all — the second-path defect. Both writers now supersede.',
   'spec/PARTNER_BUILT_VS_PROMISED.md PROMO-19 (ABSENT P1); register row PRM-161',
   0, '2026-08-10T00:00:00Z', 'system:wave14_promo19'),

  ('bpd_promo22_oq4', 'CP-PROMO-22', 'promo.oq4_disposition', 'open',
   'OQ-4: may a partner-authored deal promotion discount the PLATFORM fee, or only the partner''s own commission?',
   NULL,
   'Owner? = Y. The two answers have different money paths: discounting the platform fee moves platform revenue and needs an admin approval gate; discounting the partner''s own commission moves only partner revenue and needs none. The build does NOT choose. Today the resolver applies promotions to the SUBSCRIPTION amount only (never to a platform fee or a commission line), which is the conservative reading and is asserted by test so the open question cannot be silently closed by a later edit.',
   'spec/PARTNER_BUILT_VS_PROMISED.md PROMO-22 (NEVER-SCOPED); register row PRM-164; spec/OQ4_OQ12_ANSWERS.md',
   1, '2026-08-10T00:00:00Z', 'system:wave14_promo22'),

  ('bpd_sub19_annual_model', 'CP-SUB-19', 'pricing.annual_model_surface', 'open',
   'CP-SUB-19 surface half: the annual pricing model question is recorded in percent_policy_record (ppr_annual_pricing_model) but was not visible anywhere in the product.',
   NULL,
   'Owner? = Y and still open. Wave 5 recorded the question; Wave 14 makes it READABLE from the admin money-operations surface (GET /api/admin/partner-billing/decisions) so an unanswered pricing decision is visible to the person who has to answer it. No default was invented: every tier except founder_free still ships price_minor = NULL.',
   'spec/PARTNER_BUILT_VS_PROMISED.md SUB-19 (NEVER-SCOPED); register row PRM-025',
   1, '2026-08-10T00:00:00Z', 'system:wave14_sub19');

-- ---------------------------------------------------------------------------
-- orphan_surface_disposition — ORP-062 / ORP-037 / ORP-041.
--
-- The R-3 orphan sweep needs a place to record, per route, whether the surface
-- is ADOPTED (a client caller now exists), RETIRED (deliberately unreachable,
-- kept for a named reason) or PENDING (inventoried, not yet ruled). A markdown
-- table would drift; this is queryable and is published by a route, so the
-- inventory is part of the product rather than a document.
--
-- `caller_ref` is NOT NULL for 'adopted' by CHECK: you cannot claim adoption
-- without naming the caller. That CHECK is the falsification target — the test
-- suite proves the INSERT fails when caller_ref is omitted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orphan_surface_disposition (
  id            TEXT NOT NULL PRIMARY KEY,
  surface_kind  TEXT NOT NULL CHECK (surface_kind IN ('route','table','column','copy_key','event')),
  method        TEXT,
  path          TEXT NOT NULL,
  silo          TEXT NOT NULL,
  declared_in   TEXT NOT NULL,
  disposition   TEXT NOT NULL CHECK (disposition IN ('adopted','retired','pending')),
  caller_ref    TEXT,
  item_id       TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
                  CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  recorded_by   TEXT NOT NULL,
  UNIQUE (surface_kind, method, path),
  CHECK (disposition <> 'adopted' OR (caller_ref IS NOT NULL AND length(trim(caller_ref)) > 0)),
  CHECK (disposition <> 'retired' OR length(trim(rationale)) >= 20)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_osd_item ON orphan_surface_disposition(item_id, disposition);
CREATE INDEX IF NOT EXISTS idx_osd_disp ON orphan_surface_disposition(disposition, silo);

-- ORP-062 — THE 121-ROUTE INVENTORY IS NOT SEEDED HERE, ON PURPOSE.
-- A frozen list of 121 paths in a migration is stale the moment a route moves;
-- three waves have now been misled by exactly that kind of frozen citation.
-- Instead GET /api/admin/orphan-surfaces computes the inventory LIVE from the
-- mounted Express router and LEFT JOINs it to this table, so an undispositioned
-- route shows as `pending` by absence and a route that no longer exists cannot
-- masquerade as outstanding work. Only RULINGS are stored, never the inventory.

-- ORP-037 — the legacy /api/messages* surface. server/messagingStore.ts is
-- SACRED (read, never edited), so the disposition can only be recorded and
-- published, never implemented by editing the store. RETIRED, with the reason
-- stated: the live client messaging surfaces are /api/partner/me/messages and
-- /api/comms/*, and adopting a THIRD vocabulary for the same fact is what
-- created the orphan.
INSERT OR IGNORE INTO orphan_surface_disposition
  (id, surface_kind, method, path, silo, declared_in, disposition, caller_ref, item_id, rationale, recorded_at, recorded_by)
VALUES
  ('osd_msg_post',        'route', 'POST',   '/api/messages',             'messaging', 'server/messagingStore.ts:802',  'retired', NULL, 'ORP-037',
   'Legacy consolidated messaging surface with zero client callers. server/messagingStore.ts is SACRED so the surface cannot be altered; it stays mounted (removing a mounted route is a silent drop) and is recorded RETIRED. The live surfaces are /api/comms/* and /api/partner/me/messages. Adopting this third vocabulary would give the platform three names for one fact.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp037'),
  ('osd_msg_list',        'route', 'GET',    '/api/messages',             'messaging', 'server/messagingStore.ts:903',  'retired', NULL, 'ORP-037',
   'Same disposition as POST /api/messages: retired-in-place, sacred store, published so the retirement is auditable rather than implicit.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp037'),
  ('osd_msg_threads',     'route', 'GET',    '/api/messages/threads',     'messaging', 'server/messagingStore.ts:963',  'retired', NULL, 'ORP-037',
   'Same disposition as the other /api/messages* routes: retired-in-place because the sacred store cannot be edited and a fourth messaging vocabulary must not be adopted.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp037'),
  ('osd_msg_thread_get',  'route', 'GET',    '/api/messages/threads/:id', 'messaging', 'server/messagingStore.ts:1025', 'retired', NULL, 'ORP-037',
   'Same disposition as the other /api/messages* routes: retired-in-place, recorded and published, store untouched because it is sacred.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp037'),

-- ORP-041 — /api/auth/secure/*. NOT uniformly orphaned: `redeem` and `me` DO
-- have live callers (client/src/pages/SetPasswordPage.tsx:132,
-- client/src/lib/realtimeSync.ts:19). Those two are ADOPTED with the caller
-- named. signup / login / logout / 2fa have no caller and are RETIRED rather
-- than wired, because Login.tsx is SACRED: adopting a second login path would
-- put two password checks in production with one of them untested by the login
-- regression suite. This is the honest split, verified caller-by-caller.
  ('osd_auth_redeem', 'route', 'POST', '/api/auth/secure/redeem',     'auth', 'server/lib/secureAuthRoutes.ts:140', 'adopted',
   'client/src/pages/SetPasswordPage.tsx:132', 'ORP-041',
   'Live caller verified at source: the set-password page posts here to consume the redeem token. The audit''s claim of "no caller" is wrong for this route.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_me', 'route', 'GET', '/api/auth/secure/me', 'auth', 'server/lib/secureAuthRoutes.ts:124', 'adopted',
   'client/src/lib/realtimeSync.ts:19', 'ORP-041',
   'Live caller verified at source: the realtime sync invalidation map lists this key under the "user" topic, so the route is refetched on user events.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_signup', 'route', 'POST', '/api/auth/secure/signup', 'auth', 'server/lib/secureAuthRoutes.ts:69', 'retired', NULL, 'ORP-041',
   'No client caller. RETIRED rather than adopted: client/src/pages/Login.tsx is SACRED and the live signup paths are the founder/partner signup flows. Shipping a second credential-creating endpoint that the login regression suite does not cover is a security regression, not a feature.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_login', 'route', 'POST', '/api/auth/secure/login', 'auth', 'server/lib/secureAuthRoutes.ts:89', 'retired', NULL, 'ORP-041',
   'No client caller. RETIRED for the same reason as signup: two password-verification paths in production, only one of which is covered by the sacred login regression, is worse than one. The hardened path stays available for a future migration of the sacred page, which is a separate, owner-visible piece of work.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_logout', 'route', 'POST', '/api/auth/secure/logout', 'auth', 'server/lib/secureAuthRoutes.ts:116', 'retired', NULL, 'ORP-041',
   'No client caller. Retired with the login/signup pair it belongs to; adopting logout alone would clear a cookie the live session path does not set.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_2fa_setup', 'route', 'POST', '/api/auth/secure/2fa/setup', 'auth', 'server/lib/secureAuthRoutes.ts:233', 'retired', NULL, 'ORP-041',
   'No client caller and no enrolment surface. Retired and published rather than wired: a half-wired second factor that users can enable but not recover from is a lockout risk.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041'),
  ('osd_auth_2fa_verify', 'route', 'POST', '/api/auth/secure/2fa/verify', 'auth', 'server/lib/secureAuthRoutes.ts:248', 'retired', NULL, 'ORP-041',
   'No client caller. Retired with 2fa/setup for the same lockout reason; the pair must be adopted together or not at all.',
   '2026-08-10T00:00:00Z', 'system:wave14_orp041');

-- ---------------------------------------------------------------------------
-- founder_notification_preference — ORP-033.
--
-- server/notificationsStore.ts is SACRED, so the preference cannot live inside
-- it. This table is the persistence the decorative switches in
-- client/src/pages/founder/Settings.tsx never had. One row per (user, key,
-- channel); absence means "platform default", which is why there is no
-- seed here and no NOT NULL default that would silently opt anyone in.
--
-- `key` is NOT an enum in the DDL on purpose: the switch list is authored in the
-- client and validated against a server-side allowlist
-- (server/lib/founderNotificationPrefs.ts NOTIFICATION_PREF_KEYS), so adding a
-- switch does not need a migration. The allowlist is the fence, and the test
-- suite proves an unknown key is REJECTED by the route.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS founder_notification_preference (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  pref_key     TEXT NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('in_app','email','webhook')),
  enabled      INTEGER NOT NULL CHECK (enabled IN (0,1)),
  -- Critical security alerts cannot be suppressed. A row that tries to disable
  -- one is rejected by the DB, not merely by the route: that is the second-path
  -- defence, because any future writer hits the same CHECK.
  locked       INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  updated_at   TEXT NOT NULL
                 CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_by   TEXT NOT NULL,
  UNIQUE (user_id, pref_key, channel),
  CHECK (locked = 0 OR enabled = 1)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_fnp_user ON founder_notification_preference(user_id);

-- ---------------------------------------------------------------------------
-- spv_carry_accrual — M-5.
--
-- Accrued carry AT AN AS-OF DATE. The terms live in `spv_carry_terms` (0159,
-- FRACTIONS); this table is the computed, dated result, so an as-of figure an
-- investor was shown can be reproduced byte-for-byte later.
--
-- MONEY RULES. Every amount is integer minor units. `basis` records which
-- convention produced the number — per-deployment (carry computed and hurdled
-- deal by deal) or whole-SPV (one aggregate waterfall) — because the two give
-- different answers on the same data and a figure without its convention is
-- unreadable. `catch_up_minor` is separated from `carry_minor` so a catch-up
-- can be audited independently of the carry it accelerates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spv_carry_accrual (
  id                     TEXT NOT NULL PRIMARY KEY,
  spv_id                 TEXT NOT NULL,
  tenant_id              TEXT NOT NULL,
  as_of_date             TEXT NOT NULL
                           CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'),
  basis                  TEXT NOT NULL CHECK (basis IN ('per_deployment','whole_spv')),
  contributed_minor      INTEGER NOT NULL CHECK (contributed_minor >= 0),
  distributed_minor      INTEGER NOT NULL CHECK (distributed_minor >= 0),
  -- The preferred return owed at as_of_date, before any carry is taken.
  hurdle_owed_minor      INTEGER NOT NULL CHECK (hurdle_owed_minor >= 0),
  hurdle_met             INTEGER NOT NULL CHECK (hurdle_met IN (0,1)),
  carry_minor            INTEGER NOT NULL CHECK (carry_minor >= 0),
  catch_up_minor         INTEGER NOT NULL CHECK (catch_up_minor >= 0),
  lp_net_minor           INTEGER NOT NULL CHECK (lp_net_minor >= 0),
  currency               TEXT NOT NULL,
  -- FRACTIONS, exactly as stored in spv_carry_terms. Never percent-as-written.
  carry_rate_fraction    REAL NOT NULL CHECK (carry_rate_fraction >= 0 AND carry_rate_fraction <= 1),
  hurdle_rate_fraction   REAL NOT NULL CHECK (hurdle_rate_fraction >= 0 AND hurdle_rate_fraction <= 1),
  catch_up_rate_fraction REAL NOT NULL CHECK (catch_up_rate_fraction >= 0 AND catch_up_rate_fraction <= 1),
  hurdle_kind            TEXT NOT NULL CHECK (hurdle_kind IN ('none','hard','soft')),
  component_count        INTEGER NOT NULL CHECK (component_count >= 0),
  computed_at            TEXT NOT NULL
                           CHECK (computed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  computed_by            TEXT NOT NULL,
  -- CENT CONSERVATION, enforced by the DATABASE and not merely by the engine.
  -- The three-way split must exhaust distributions exactly, so no future writer
  -- — including one that reintroduces an independent Math.round per party — can
  -- persist a row where a cent went missing. This CHECK is the falsification
  -- target proved by server/__tests__/wave14_money_orphan.test.ts.
  CHECK (carry_minor + catch_up_minor + lp_net_minor = distributed_minor),
  UNIQUE (spv_id, as_of_date, basis)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sca_spv ON spv_carry_accrual(spv_id, as_of_date);

-- ---------------------------------------------------------------------------
-- platform_audit_incident — A-2.
--
-- The platform-wide audit incident banner was a hardcoded client string. A
-- banner that cannot be cleared by evidence is not an incident record, it is
-- decoration; and one that is deleted by an edit leaves no trace that the
-- incident happened. Both failure modes are closed by making the banner a row
-- whose `state` moves open -> cleared only with `cleared_evidence`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_incident (
  id                TEXT NOT NULL PRIMARY KEY,
  incident_key      TEXT NOT NULL UNIQUE,
  severity          TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  state             TEXT NOT NULL CHECK (state IN ('open','cleared')),
  headline          TEXT NOT NULL,
  detail            TEXT NOT NULL,
  scope             TEXT NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id         TEXT,
  opened_at         TEXT NOT NULL
                      CHECK (opened_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  cleared_at        TEXT
                      CHECK (cleared_at IS NULL OR cleared_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  cleared_by        TEXT,
  cleared_evidence  TEXT,
  -- Honesty CHECK: a cleared incident must carry WHO cleared it and WHAT
  -- evidence cleared it. "Clear the banner honestly" is enforced, not hoped for.
  CHECK (state <> 'cleared' OR (cleared_at IS NOT NULL AND cleared_by IS NOT NULL
         AND cleared_evidence IS NOT NULL AND length(trim(cleared_evidence)) >= 20))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pai_state ON platform_audit_incident(state, severity);

-- The banner that was hardcoded. Seeded OPEN, because on a database whose audit
-- chain has not been verified the honest state is OPEN. It is cleared by
-- POST /api/admin/audit/incidents/:key/clear, which REQUIRES a chain-verify
-- result as its evidence — the route refuses to clear on an unverified chain.
INSERT OR IGNORE INTO platform_audit_incident
  (id, incident_key, severity, state, headline, detail, scope, tenant_id, opened_at)
VALUES
  ('pai_audit_chain', 'audit.chain_integrity', 'warn', 'open',
   'Audit chain verification outstanding',
   'The platform audit hash chain has not been verified since this database was provisioned. Until a verification run succeeds, audit-derived figures should be treated as unattested. Clearing this banner requires a passing verifyTenantAuditChain result as evidence.',
   'platform', NULL, '2026-08-10T00:00:00Z');

-- ---------------------------------------------------------------------------
-- M-1d — footnote configuration. The renderer (packages/math-fns renderFootnotes)
-- takes a FootnoteConfig; before this wave nothing supplied one from the DB, so
-- the footnotes a reader saw could not be traced to a configured treatment.
-- These keys are the config the renderer is now bound to. Values are the
-- conservative reading and are admin-editable through the existing
-- GET/PUT /api/admin/reporting/config surface.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO wave9_reporting_config (key, value_json, value_type, description, updated_by, updated_at) VALUES
  ('footnote.recallable_treatment', '"excluded_from_paid_in"', 'string',
   'M-1d — ILPA recallable-distribution treatment disclosed in the footnote. excluded_from_paid_in means recallable distributions do NOT reduce paid-in capital for DPI/TVPI.',
   'migration:0170', '2026-08-10T00:00:00Z'),
  ('footnote.gp_capital_included', 'true', 'boolean',
   'M-1d — whether GP commitment capital is included in the reported fund-level figures. Disclosed in the footnote either way.',
   'migration:0170', '2026-08-10T00:00:00Z'),
  ('footnote.subline_treatment', '"disclosed_separately"', 'string',
   'M-1d — subscription-line (capital-call facility) treatment. disclosed_separately means IRR is reported without netting the facility, and the facility is footnoted.',
   'migration:0170', '2026-08-10T00:00:00Z'),
  ('footnote.valuation_source_label', '"platform_derived"', 'string',
   'M-1d — the valuation source named in the footnote. platform_derived = marks derived from the last priced round on this platform, per owner ruling Q5.',
   'migration:0170', '2026-08-10T00:00:00Z'),
  ('footnote.require_valuation_date', 'true', 'boolean',
   'M-1d — when true the footnote block must carry the as-of valuation date; a footnote set without one is rejected by the renderer binding rather than printed undated.',
   'migration:0170', '2026-08-10T00:00:00Z');

-- ---------------------------------------------------------------------------
-- FE-16 — NO SCHEMA CHANGE, DELIBERATELY.
--
-- `collective_renewal_worker_config` already exists (migration 0153) and is
-- already seeded with its `id = 'singleton'` row (enabled=0, poll_interval_ms=60000,
-- lead_window_sec=86400, max_consecutive_failures=3, quiet_after_write_min=30,
-- env_override_allowed=1). Verified at source before writing this file. The
-- defect is NOT a missing table — it is that server/lib/collectiveRenewalWorker.ts
-- still reads four env gates and never reads the row. FE-16 is therefore a
-- CODE WIRING item, fixed in that file, and re-seeding here would be a second
-- declaration of the same fact.
--
-- The seeded values are also the values the env defaults produced, so switching
-- the read path changes no behaviour on an existing deployment; the item's value
-- is that the settings become inspectable and admin-settable.
-- ---------------------------------------------------------------------------
