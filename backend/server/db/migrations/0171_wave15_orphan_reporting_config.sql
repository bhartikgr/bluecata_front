-- =========================================================================
-- 0171_wave15_orphan_reporting_config.sql
--
-- WAVE 15 — the DB half of the Orphan sweep and the Money/Reporting/Audit
-- items Wave 14 left unwired.
--
-- NO NEW TABLES. Deliberately. Every table this wave needs already exists:
--   wave9_reporting_config        (0159:222, seeded 0159:232 + 0170:330)
--   build_policy_decision         (0170:42)
--   orphan_surface_disposition    (0170:111)
--   spv_carry_accrual             (0170:242)
--   platform_audit_incident       (0170:~268)
--   founder_notification_preference (0170:209)
--   ddl_column_disposition        (0159:332, 12 seeded rows)
-- Wave 14 built all of them and wrote NO code against three of them. This wave
-- supplies the code; this migration supplies only the CONFIG and the RULINGS the
-- new code reads, plus the audit trail of what got adopted.
--
-- The last two waves both hit shape collisions caused by a second file
-- redeclaring a table (`IF NOT EXISTS` silently discarded the incompatible
-- second definition, and install order decided which shape won). Not creating a
-- table is the strongest available defence against repeating that.
--
-- IDEMPOTENT. Every statement is INSERT OR IGNORE keyed on a UNIQUE column, so a
-- re-run is a no-op and never a duplicate ruling.
-- =========================================================================

-- -------------------------------------------------------------------------
-- M-1d — the ONE config key the footnote binding needs that 0170 did not seed.
--
-- 0170 seeded five `footnote.*` keys but not this one. The renderer's
-- FootnoteConfig (packages/math-fns/src/ilpa.ts:594) distinguishes "how a
-- subscription line is treated" (`footnote.subline_treatment`, seeded) from
-- "whether one was used at all". Without the second fact the binding cannot
-- decide whether to emit the subline footnote, and emitting a subscription-line
-- disclosure for a vehicle that never drew on a facility is a false statement in
-- an investor report — so the binding requires this key rather than assuming.
--
-- FALSE is the conservative default: no facility unless someone says so.
-- -------------------------------------------------------------------------
INSERT OR IGNORE INTO wave9_reporting_config (key, value_json, value_type, description, updated_by, updated_at) VALUES
  ('footnote.subline_used', 'false', 'boolean',
   'M-1d — whether this platform''s reported vehicles used a subscription (capital-call) line. FALSE = no facility, so the subline footnote is suppressed; TRUE = the facility is disclosed per footnote.subline_treatment. Defaulting to FALSE is deliberate: printing a facility disclosure for a vehicle that never drew one is a false statement in an investor report.',
   'migration:0171', '2026-08-10T00:00:00Z');

-- -------------------------------------------------------------------------
-- M-5 — the hurdle day-count convention.
--
-- The accrued-carry engine computes a preferred return owed at an as-of date.
-- That requires a day-count convention, and there is no defensible default that
-- can be silently chosen: ACT/365 simple and ACT/365 compounded give materially
-- different hurdles on the same cashflows, and an LP shown one number under the
-- other convention has been shown a wrong number.
--
-- `simple_act_365` is seeded as the CONFIGURED value with its reasoning, and the
-- engine's domain is exactly {simple_act_365, none}. A value outside the domain
-- makes `readHurdleConvention` THROW rather than fall back — the engine refuses
-- to compute rather than compute under a convention nobody chose. Compounding is
-- NOT in the domain: it is not implemented, so accepting it as a config value
-- would let the config claim a behaviour the code does not have.
-- -------------------------------------------------------------------------
INSERT OR IGNORE INTO wave9_reporting_config (key, value_json, value_type, description, updated_by, updated_at) VALUES
  ('carry.hurdle_convention', '"simple_act_365"', 'string',
   'M-5 — day-count convention for the preferred return in the accrued-carry engine. Domain is exactly {simple_act_365, none}; a value outside it makes the engine THROW (CARRY_HURDLE_CONVENTION_OUT_OF_DOMAIN) instead of defaulting, because simple and compounded accrual give different hurdles on identical cashflows. Compounding is intentionally absent from the domain: it is not implemented, and config must not be able to claim behaviour the code lacks.',
   'migration:0171', '2026-08-10T00:00:00Z');

-- -------------------------------------------------------------------------
-- BUILD POLICY DECISIONS.
--
-- Two rows. The first RECORDS a decision this wave was entitled to make. The
-- second is OPEN, because A-3b is not this agent's call and an open question
-- belongs in a queryable table rather than in a report file nobody queries.
-- -------------------------------------------------------------------------
INSERT OR IGNORE INTO build_policy_decision
  (id, item_id, decision_key, state, question, ruling, rationale, source_ref, owner_required, recorded_at, recorded_by)
VALUES
  ('bpd_w15_hurdle_convention', 'M-5', 'carry.hurdle_convention', 'recorded',
   'Which day-count convention does the accrued-carry engine use for the preferred return, and what happens when it is unset?',
   'simple_act_365, stored in wave9_reporting_config and read per computation. The engine domain is {simple_act_365, none}. UNSET or out-of-domain THROWS (CARRY_HURDLE_CONVENTION_OUT_OF_DOMAIN); it never defaults.',
   'A hurdle is a money figure an LP is shown, and simple vs compounded accrual on the same cashflows produce different hurdles and therefore different carry. Choosing silently would have made the number unattributable. The convention is configured, the domain is closed to what is actually implemented, and the engine refuses to compute outside it. server/__tests__/wave15_carry_accrual.test.ts asserts BOTH poles: the configured value computes, and an out-of-domain value throws rather than falling back.',
   'spec/CONSORTIUM_PARTNER_BUILD_v8.md M-5; server/lib/wave15CarryAccrual.ts readHurdleConvention',
   0, '2026-08-10T00:00:00Z', 'system:wave15_m5'),

  ('bpd_w15_gate_a3', 'A-3b', 'GATE-A3', 'open',
   'Should the Collective bridge be flipped from mock to live, and with which counterparty endpoint and secret?',
   NULL,
   'OPEN — OWNER DECISION, NOT DEFERRED WORK. Three facts make this unavailable to a build agent. (1) LIVE_MODE is DERIVED, not stored: server/lib/bridgeRuntime.ts:44-56 computes it from COLLECTIVE_WEBHOOK_URL + COLLECTIVE_WEBHOOK_SECRET, so there is no flag to set — flipping it IS supplying production credentials, which this agent does not have and must not fabricate. (2) server/lib/bridgeRuntime.ts is SACRED (sacred_baseline/SACRED_SHA256.txt). (3) The flip starts POSTing real envelopes to a real counterparty and starts HMAC-rejecting unsigned inbound posts. What Wave 15 DID ship is the part that is not the owner''s decision: GET /api/admin/bridge/mode discloses the current mode, which credential is absent, and what would change on flip (previously bridgeHealth() reported "mock" with no way to distinguish deliberate mock from misconfiguration), and server/__tests__/wave15_bridge_mode.test.ts fences that no Wave 15 file assigns either credential — the fence is proved to FAIL on an injected violation, so "we did not flip it" is checked rather than asserted.',
   'spec/CONSORTIUM_PARTNER_BUILD_v8.md A-3b (owner_decision=Y, GATE-A3); server/lib/wave15BridgeMode.ts',
   1, '2026-08-10T00:00:00Z', 'system:wave15_a3b');

-- -------------------------------------------------------------------------
-- ORPHAN SURFACE DISPOSITIONS — what Wave 15 ADOPTED.
--
-- Every route this wave mounted is recorded ADOPTED with its caller_ref, because
-- the table's own CHECK refuses an `adopted` row without one:
--   CHECK (disposition <> 'adopted' OR (caller_ref IS NOT NULL AND length(trim(caller_ref)) > 0))
-- So "adopted" cannot be claimed here without naming the surface that consumes
-- it. That is the fence, and it is the database's, not a linter's.
--
-- NOTE ON ORP-062: this migration still does NOT seed the route inventory. 0170
-- explained why ("a frozen list of 121 paths in a migration is stale the moment a
-- route moves"), and GET /api/admin/orphan-surfaces now computes it from the LIVE
-- Express router and LEFT JOINs these rulings. The rows below are rulings, not an
-- inventory: a mounted route with no ruling reports `pending` by absence, and a
-- ruling whose route is not mounted reports `orphan_ruling`.
-- -------------------------------------------------------------------------
INSERT OR IGNORE INTO orphan_surface_disposition
  (id, surface_kind, method, path, silo, declared_in, disposition, caller_ref, item_id, rationale, recorded_at, recorded_by)
VALUES
  -- ORP-033 — founder notification preferences.
  ('osd_w15_notif_prefs_get', 'route', 'GET', '/api/founder/notification-preferences', 'founder',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/founder/Settings.tsx', 'ORP-033',
   'Reads the founder''s effective preferences plus the honest enforcement-coverage statement. Replaces ten decorative Switch controls that had no handler and no query.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp033'),
  ('osd_w15_notif_prefs_put', 'route', 'PUT', '/api/founder/notification-preferences', 'founder',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/founder/Settings.tsx', 'ORP-033',
   'Writes one (key, channel) preference for the SESSION user, validated against server/lib/founderNotificationPrefs.ts NOTIFICATION_PREF_KEYS. Enforcement is in notificationCadence.evaluateCadence, so the stored preference actually suppresses delivery instead of being decorative.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp033'),

  -- ORP-062 — the inventory route itself.
  ('osd_w15_orphan_surfaces', 'route', 'GET', '/api/admin/orphan-surfaces', 'admin',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/OrphanSurfaces.tsx', 'ORP-062',
   'Publishes the orphan-surface inventory computed LIVE from the mounted Express router and LEFT JOINed to these rulings, so the count cannot go stale and an undispositioned route cannot be lost.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp062'),

  -- ORP-053 — DDL-only column rulings, published and verified.
  ('osd_w15_ddl_cols', 'route', 'GET', '/api/admin/ddl-column-dispositions', 'admin',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/OrphanSurfaces.tsx', 'ORP-053',
   'Publishes the 12 seeded ddl_column_disposition rows (all ruled document/retain, owner_ruled=1) AND verifies each named column still exists in the live schema. Returns 409 DDL_RULING_VIOLATED when a retained column has vanished: a document ruling nothing verifies is a ruling that can be violated invisibly.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp053'),

  -- A-2 — audit incident banner.
  ('osd_w15_audit_incidents', 'route', 'GET', '/api/admin/audit/incidents', 'admin',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/OrphanSurfaces.tsx', 'A-2',
   'Lists platform_audit_incident rows. The table was created by 0170 with ZERO code readers.',
   '2026-08-10T00:00:00Z', 'system:wave15_a2'),
  ('osd_w15_audit_clear', 'route', 'POST', '/api/admin/audit/incidents/:key/clear', 'admin',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/OrphanSurfaces.tsx', 'A-2',
   'Clears an incident ONLY when (a) the evidence names files that exist on disk — a prior incident record named a mitigation file that did not exist — and (b) the live audit-chain verification passes right now. An unavailable verifier is treated as failing, not as healthy.',
   '2026-08-10T00:00:00Z', 'system:wave15_a2'),
  ('osd_w15_audit_banner', 'route', 'GET', '/api/platform/audit-banner', 'core',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/OrphanSurfaces.tsx', 'A-2',
   'The banner state the client renders: the OR of the live chain signal and the durable open rows, with the raising sources named so "why is the banner on?" is answerable from the payload. Replaces a hardcoded client string that no evidence could clear.',
   '2026-08-10T00:00:00Z', 'system:wave15_a2'),

  -- A-3b — read-only disclosure. The flip itself remains an OPEN owner decision.
  ('osd_w15_bridge_mode', 'route', 'GET', '/api/admin/bridge/mode', 'admin',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/admin/Sync.tsx', 'A-3b',
   'Discloses the CURRENT bridge mode, which credential input is absent, and what would change on a flip. Read-only: bridgeRuntime.ts is SACRED and LIVE_MODE is derived from env, so this route cannot and does not change the mode. GATE-A3 stays open.',
   '2026-08-10T00:00:00Z', 'system:wave15_a3b'),

  -- CP-BRG-07 — feeSchedule aggregate.
  ('osd_w15_fee_aggregate', 'route', 'GET', '/api/partner/fee-schedule/aggregate', 'partner',
   'server/lib/wave15Routes.ts', 'adopted', 'client/src/pages/partner/FeeSchedule.tsx', 'CP-BRG-07',
   'Composes resolvePartnerFee, resolveCommissionRate and listFeeSchedules into ONE payload with computedVia preserved per line, so a partner surface no longer re-derives fee precedence client-side. Published on the EXISTING partner-workspace SSE topic (sseHub.ts SSE_TOPICS is SACRED and cannot gain a member) with chapterId = partnerId, the established convention at server/collectiveSseRoutes.ts:220-253.',
   '2026-08-10T00:00:00Z', 'system:wave15_brg07'),

  -- M-1d / M-5 — the reporting engines that had no route before this wave.
  ('osd_w15_footnotes', 'route', 'GET', '/api/reporting/vehicles/:kind/:id/footnotes', 'reporting',
   'server/lib/wave15ReportingRoutes.ts', 'adopted', 'client/src/pages/partner/SpvPerformance.tsx', 'M-1d',
   'Binds packages/math-fns renderFootnotes (which had ZERO callers tree-wide despite being tested) to the DB-backed footnote.* config. An engine with no route is not shipped.',
   '2026-08-10T00:00:00Z', 'system:wave15_m1d'),
  ('osd_w15_carry_accrual', 'route', 'GET', '/api/reporting/spv/:spvId/carry-accrual', 'reporting',
   'server/lib/wave15ReportingRoutes.ts', 'adopted', 'client/src/pages/partner/SpvPerformance.tsx', 'M-5',
   'Accrued carry at an as-of date. spv_carry_accrual (0170) had zero writers before this wave.',
   '2026-08-10T00:00:00Z', 'system:wave15_m5'),

  -- ORP-052 — GET /api/stream, the CP-034 canonical SSE path with zero callers.
  ('osd_w15_stream', 'route', 'GET', '/api/stream', 'core',
   'server/collectiveSseRoutes.ts:336', 'adopted', 'client/src/lib/sseClient.ts useCollectiveStream(path)', 'ORP-052',
   'ADOPTED BY WIRING, NOT REBUILT. The canonical CP-034 stream was mounted and auth-only but unreachable: client/src/lib/sseClient.ts hardcoded the flag-gated /api/collective/stream. sseClient now takes a `path` option defaulting to the previous URL (so every existing caller is byte-identical in behaviour) and partner surfaces pass /api/stream, which needs no collective flag and no chapter — which is what the CP-BRG-07 aggregate needs as its transport.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp052'),

  -- ORP-063 — two authored SPV_EDU copy keys that no surface rendered.
  ('osd_w15_edu_terms', 'copy_key', NULL, 'SPV_EDU.terms', 'partner',
   'client/src/lib/spvEducation.ts:17', 'adopted',
   'client/src/components/partner/SpvDetailTabs.tsx spv-edu-terms', 'ORP-063',
   'Authored investor-facing copy explaining target raise, minimum, currency and carry basis, defined and never rendered. RENDERED, not deleted: existing functionality must be reflected in the UI. Added as a SIBLING element, never appended inside an existing text node, which the silent-drop guard reads as one removal plus one addition.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp063'),
  ('osd_w15_edu_review_launch', 'copy_key', NULL, 'SPV_EDU.reviewLaunch', 'partner',
   'client/src/lib/spvEducation.ts:19', 'adopted',
   'client/src/components/partner/SpvDetailTabs.tsx spv-edu-review-launch', 'ORP-063',
   'Authored copy stating that launching an SPV moves no money — a materially reassuring fact that was defined and never shown. Rendered as a sibling element in the overview tab.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp063'),

  -- ORP-029 — verified ALREADY DELIVERED. Recorded so it cannot be re-reported.
  ('osd_w15_orp029_verified', 'event', NULL, 'spv.deployment_fee.engine_path', 'partner',
   'server/spvEngineStore.ts:1629 -> server/lib/spvEngineDeploymentFeeHook.ts:327', 'adopted',
   'server/__tests__/wave15_orphan_surfaces.test.ts engine-path fence', 'ORP-029',
   'VERIFIED ALREADY DELIVERED BY WAVE 8, not re-built. The item''s premise is true: shared/spvEngine.ts SPV_STATUSES contains no ''active'', so the legacy spvFundStore.ts:1261 trigger could never fire for an engine SPV. The live path is spvEngineStore.ts:1629 (the ONLY writer of status=deployed) calling chargeEngineSpvDeploymentFee, with durable pending state via openBillingRecord/recordBillingOutcome and an admin retry at POST /api/admin/consortium-spv/:id/deployment-fee/retry. Wave 15 added the fence test that would fail if a second status writer or a second fee path appeared.',
   '2026-08-10T00:00:00Z', 'system:wave15_orp029');
