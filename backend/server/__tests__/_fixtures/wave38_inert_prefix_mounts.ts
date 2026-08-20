/**
 * WAVE 38 · ROW 3 — the EXACT missed-route pin for
 * `wave28_item1_prefix_middleware_ordering.test.ts` case (13).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE REPLACED A LIST OF COUNTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The old pin read `requireAdmin@684 claims=358 missed=212`. Two things were
 * wrong with it, and both are the "a check that passed while checking nothing"
 * shape:
 *
 *   1. `@684` is an ABSOLUTE ROUTER-STACK INDEX. Every wave that registered a
 *      route ahead of the mount shifted it, so the pin went red for reasons
 *      that had nothing to do with the defect and had to be re-based in Waves
 *      29, 30 and 38. A pin that cries wolf every wave gets re-based on sight,
 *      which is exactly how a real regression walks through it. The identity
 *      here is instead `name#ordinal-among-same-named-mounts`, which moves only
 *      when a mount is genuinely added, removed or reordered.
 *
 *   2. `missed=212` is a COUNT. A count cannot see one route LEAVING the missed
 *      set while another JOINS it — a brand-new admin route escaping its gate
 *      is invisible so long as the arithmetic balances. This file pins the
 *      SET OF PATHS. Nothing balances out.
 *
 * This is strictly stronger than what it replaced: every state the old pin
 * rejected, this one still rejects, plus the substitutions it could not see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE ENTRIES ARE
 * ─────────────────────────────────────────────────────────────────────────────
 * Entries are METHOD-QUALIFIED (`GET /x` and `POST /x` are two separate router
 * layers and can sit on opposite sides of a mount).
 *
 * Each key is a prefix middleware mount that CLAIMS routes registered ABOVE it,
 * so those routes do not pass through it. Every one is a REAL, LIVE finding
 * dispositioned individually in `build_log/WAVE28_REPORT.md` §1.6 and
 * `WAVE29_REPORT.md` §1.2/§1.5. None is fixed here, and Wave 38 claims none of
 * them: each fix would newly APPLY AN AUTHORIZATION GATE to routes that
 * currently answer without it — a user-visible lockout risk that is an owner
 * call. `requireAdmin#2` is the one benign entry, a documented duplicate of the
 * mount that already covers every admin route with zero missed.
 *
 * THIS IS A TWO-WAY PIN. A new inert mount fails it. Fixing one without
 * updating the report fails it. A route newly escaping any of these mounts
 * fails it. Do not edit one side alone.
 */
export const WAVE38_INERT_PREFIX_MOUNTS: Readonly<Record<string, readonly string[]>> = {
  // /api/collective auth gate. LEFT AS IS by owner ruling (WAVE30_REPORT.md): two routes under it are deliberately anonymous for pre-signup callers, and the rest refuse anonymous callers on their own.
  "requireAuthenticated#1": [
    "GET /api/collective/applications",
    "GET /api/collective/applications/:id",
    "GET /api/collective/applications/mine",
    "GET /api/collective/discovery/spvs",
    "GET /api/collective/eligibility",
    "GET /api/collective/gate-state",
    "GET /api/collective/legal-copy",
    "GET /api/collective/me/invoices",
    "GET /api/collective/me/payment-entries",
    "GET /api/collective/me/payment-quote",
    "GET /api/collective/membership-status",
    "GET /api/collective/spvs",
    "GET /api/collective/waitlist/mine",
    "POST /api/collective/applications",
    "POST /api/collective/waitlist/cap-table-promote",
    "POST /api/collective/waitlist/founder-application",
    "POST /api/collective/waitlist/investor-membership",
  ],
  // BENIGN documented duplicate (server/routes.ts) of the earlier requireAdmin mount, which already covers every admin route with zero missed.
  "requireAdmin#2": [
    "DELETE /api/admin/companies/:id/consortium-partner",
    /* WAVE 57c · ITEM 2 — TWO LAYERS, ONE PATH, RECORDED RATHER THAN RE-BASED.

       `DELETE /api/admin/compliance-hold/:tenantId` and
       `POST   /api/admin/compliance-hold` each now carry TWO route layers: the
       audit/actor-binding hook from `server/lib/complianceHoldAuditGuard.ts`,
       registered in `server/routes.ts` immediately before
       `registerCaptableCommitRoutes(app)`, and the original handler inside
       SACRED `server/captableCommitStore.ts` (:1352 and :1366). `sweep()`
       enumerates LAYERS, not unique paths, so each signature legitimately
       appears twice — exactly as `"POST /api/admin/bridge/drain"` already does
       a few lines below, for the same reason.

       WHY THIS PIN MOVED AT ALL, stated plainly so the next reader can judge it:
       R37 order #2 requires the compliance-hold release to be audited with a
       bound actor, and says that if the fix needs an edit to the sacred file it
       must STOP and become an owner question. The registration-order hook is the
       one mechanism that satisfies both, and it necessarily adds a layer. The
       alternatives were: edit a sacred file (forbidden), or leave a
       financial-control release unaudited (forbidden by R35).

       WHAT DID NOT CHANGE, and is what this pin actually protects: `requireAdmin#2`
       is the BENIGN documented DUPLICATE mount. Case (13b) in
       wave28_item1_prefix_middleware_ordering.test.ts asserts that the EARLIEST
       `requireAdmin` mount misses ZERO routes, and it is green — so neither new
       layer escapes the admin gate. The hook additionally fails closed on
       identity itself. No route became less guarded. */
    "DELETE /api/admin/compliance-hold/:tenantId",
    "DELETE /api/admin/compliance-hold/:tenantId",
    "DELETE /api/admin/compliance/holds/:id",
    "DELETE /api/admin/partners/:id/attributions/:companyId",
    "DELETE /api/admin/pricing-models/:id",
    "GET /api/admin/audit-chain-health",
    "GET /api/admin/audit-log",
    "GET /api/admin/audit-log/export.csv",
    "GET /api/admin/audit-log/verify",
    "GET /api/admin/billing/disputes",
    "GET /api/admin/bridge/event/:id",
    "GET /api/admin/bridge/history",
    "GET /api/admin/bridge/inbox",
    "GET /api/admin/bridge/outbox",
    "GET /api/admin/bridge/verify-chain",
    "GET /api/admin/collective/renewal-worker-config",
    "GET /api/admin/collective/waitlist",
    "GET /api/admin/companies",
    "GET /api/admin/companies/:id",
    "GET /api/admin/companies/:id/activity",
    "GET /api/admin/companies/:id/export.csv",
    "GET /api/admin/companies/:id/profile",
    "GET /api/admin/companies/:id/stats",
    "GET /api/admin/companies/bulk-export.csv",
    "GET /api/admin/companies/full",
    "GET /api/admin/compliance-hold",
    "GET /api/admin/compliance/holds",
    "GET /api/admin/consortium-spv",
    "GET /api/admin/consortium-spv/:spvId/deployment-fee",
    "GET /api/admin/consortium-spv/deployment-fee/pending",
    "GET /api/admin/contacts",
    "GET /api/admin/contacts/:id",
    "GET /api/admin/contacts/:id/history",
    "GET /api/admin/contacts/sample-csv",
    "GET /api/admin/contacts/stats",
    "GET /api/admin/crm-dedup-review",
    "GET /api/admin/dashboard/activity",
    "GET /api/admin/dashboard/kpis",
    "GET /api/admin/deal-statistics",
    "GET /api/admin/email-campaigns",
    "GET /api/admin/email-campaigns/:id",
    "GET /api/admin/email-campaigns/:id/audience-preview",
    "GET /api/admin/email-campaigns/:id/history",
    "GET /api/admin/email-campaigns/stats",
    "GET /api/admin/email-campaigns/v25",
    "GET /api/admin/email/outbox",
    "GET /api/admin/email/templates",
    "GET /api/admin/email/templates/:slug",
    "GET /api/admin/email/transport/config",
    "GET /api/admin/email/transport/outbox",
    "GET /api/admin/investors",
    "GET /api/admin/investors/:id",
    "GET /api/admin/invoices",
    "GET /api/admin/invoices/:id",
    "GET /api/admin/invoices/:id/pdf",
    "GET /api/admin/legal/consents",
    "GET /api/admin/lifecycle-policies",
    "GET /api/admin/lock-text",
    "GET /api/admin/lock-text/:key/revisions",
    "GET /api/admin/mfcrm/capability/:partnerId",
    "GET /api/admin/mfcrm/engagements/:partnerId",
    "GET /api/admin/mfcrm/handovers/:partnerId",
    "GET /api/admin/migration/dry-run",
    "GET /api/admin/migration/mapping",
    "GET /api/admin/notification-campaigns",
    "GET /api/admin/notification-campaigns/:id",
    "GET /api/admin/notification-campaigns/:id/audience-preview",
    "GET /api/admin/notification-campaigns/:id/history",
    "GET /api/admin/notification-campaigns/stats",
    "GET /api/admin/partner-billing/decisions",
    "GET /api/admin/partner-billing/money-events",
    "GET /api/admin/partner-billing/promotions",
    "GET /api/admin/partner-billing/roster-reconcile",
    "GET /api/admin/partner-billing/tier-prices",
    "GET /api/admin/partner-referrals",
    "GET /api/admin/partners",
    "GET /api/admin/partners/:id",
    "GET /api/admin/partners/:id/attributions",
    "GET /api/admin/partners/:id/seat-report",
    "GET /api/admin/partners/:partnerId/workspace/audit",
    "GET /api/admin/partners/metrics/funnel",
    "GET /api/admin/partners/seat-report",
    "GET /api/admin/payment-gateway/config",
    "GET /api/admin/payment-gateway/webhook-events",
    "GET /api/admin/pricing-models",
    "GET /api/admin/pricing-models/:id",
    "GET /api/admin/pricing-models/:id/history",
    "GET /api/admin/pricing-models/:id/price-preview",
    "GET /api/admin/pricing-tiers",
    "GET /api/admin/pricing/founder-tiers",
    "GET /api/admin/reconciliation/runs",
    "GET /api/admin/regions/extensions",
    "GET /api/admin/regions/extensions/:id",
    "GET /api/admin/regions/extensions/:id/history",
    "GET /api/admin/regions/rollup",
    "GET /api/admin/search",
    "GET /api/admin/spv-fee-obligations",
    "GET /api/admin/subscriptions",
    "GET /api/admin/subscriptions/:companyId",
    "GET /api/admin/subscriptions/:companyId/history",
    "GET /api/admin/sync/drift",
    "GET /api/admin/sync/overview",
    /* WAVE 44 — added by the telemetry counter fix. It sits in the identical
       position to its three sibling telemetry routes below: registered by
       registerAdminPlatformRoutes(app) at routes.ts:1090, i.e. BELOW the FIRST
       `app.use("/api/admin", requireAdmin)` mount (routes.ts:611) which DOES gate
       it, and ABOVE the benign duplicate mount pinned here (routes.ts:1300).
       This is inventory bookkeeping for a documented-benign duplicate, not a
       relaxation: the route's admin gate is proved by execution in
       wave44_admin_telemetry_counts_gate.test.ts (anon 401, admin 200).

       WAVE 44b — INDEPENDENTLY RE-VERIFIED AGAINST A LIVE SERVER, NOT AGAINST
       THIS FILE'S OWN ARGUMENT. `tsx server/index.ts` was booted on port 5199
       (the real index.ts stack: express.json -> cookie parser -> registerRoutes
       -> applyRouteGuards) and probed with real curl requests carrying
       production-shaped HMAC `cap_uid` session cookies minted by
       `signSessionValue` — the same signer /api/auth/login uses, so no test
       affordance is involved. Measured three ways, on the NEW route and on
       three routes ALREADY pinned in this list:

                                            ANON  FOUNDER  INVESTOR  ADMIN
         GET /api/admin/telemetry/counts      401    403       403     200
         GET /api/admin/dashboard/kpis        401    403       403     200
         GET /api/admin/audit-chain-health    401    403       403     200
         GET /api/admin/telemetry/events      401    403       403     200

       Bodies: anon `{ok:false,error:"UNAUTHORIZED"}`; non-admin
       `{ok:false,error:"ADMIN_REQUIRED"}`; admin 200 with the real counts. The
       refusal bodies leak no numbers. IDENTICAL, cell for cell, to its
       neighbours — so this entry is equivalence bookkeeping, not a re-baseline.
       Re-run under DISABLE_DEV_BYPASS=1 (production identity posture): the
       matrix is byte-identical, and `x-user-id: u_admin` alone -> 401 while
       `?as=admin` alone -> 401, so neither dev affordance confers admin.

       FALSIFICATION CONTROLS (the probe CAN observe the opposite): anonymous
       GET /api/health, /api/pricing-public and /api/auth/me all returned 200,
       so the harness is not blanket-401ing everything; and both non-admin
       personas returned `isAuthed:true` from /api/auth/me, so their 403 is a
       ROLE refusal and not a failed session. Decisively, an anonymous GET of a
       NON-EXISTENT admin path (/api/admin/telemetry/does-not-exist) returned
       401 while the admin session got 404 — a 401 on a path with no registered
       route at all can only come from a PREFIX mount, never from inline route
       middleware.

       AND THE SWEEP'S OWN NUMBERS SAY THE SAME THING. Re-running this file's
       matcher over the live router stack: requireAdmin#1 (routes.ts:611) is
       claims=362 missed=0 and DOES cover `GET /api/admin/telemetry/counts`;
       requireAdmin#2 (routes.ts:1300) claims the same 362 with missed=216. The
       216 paths below are therefore NOT ungoverned routes — they are the routes
       the benign duplicate was registered beneath. Raw transcripts:
       build_log/WAVE44b_REPORT.md and build_log/wave44b/. */
    "GET /api/admin/telemetry/counts",
    "GET /api/admin/telemetry/events",
    "GET /api/admin/telemetry/export.csv",
    "GET /api/admin/telemetry/schema",
    "GET /api/admin/tenants/deletion-audit",
    "GET /api/admin/users/:id",
    "PATCH /api/admin/billing/disputes/:id",
    "PATCH /api/admin/collective/waitlist/:id",
    "PATCH /api/admin/companies/:id/profile",
    "PATCH /api/admin/contacts/:id",
    "PATCH /api/admin/email-campaigns/:id",
    "PATCH /api/admin/email/transport/config",
    "PATCH /api/admin/lifecycle-policies",
    "PATCH /api/admin/mfcrm/capability/:partnerId",
    "PATCH /api/admin/notification-campaigns/:id",
    "PATCH /api/admin/partners/:id",
    "PATCH /api/admin/pricing-models/:id",
    "PATCH /api/admin/pricing-tiers/:id",
    "PATCH /api/admin/regions/extensions/:id",
    "PATCH /api/admin/subscriptions/:companyId",
    "POST /api/admin/applications/:id/decline",
    "POST /api/admin/audit-chain-health/resolve",
    "POST /api/admin/audit-log/append",
    "POST /api/admin/billing/disputes",
    "POST /api/admin/bridge/archive",
    "POST /api/admin/bridge/dlq/clear",
    "POST /api/admin/bridge/drain",
    "POST /api/admin/bridge/drain",
    "POST /api/admin/bridge/emit",
    "POST /api/admin/companies/:id/consortium-partner",
    /* WAVE 57c · ITEM 2 — second layer: the audit hook. See the note above the
       DELETE pair. */
    "POST /api/admin/compliance-hold",
    "POST /api/admin/compliance-hold",
    "POST /api/admin/compliance/holds",
    "POST /api/admin/consortium-spv/:spvId/deployment-fee/retry",
    "POST /api/admin/consortium-spv/:spvId/distributions",
    "POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/settle",
    "POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive",
    "POST /api/admin/consortium-spv/:spvId/platform-fee",
    "POST /api/admin/contacts",
    "POST /api/admin/contacts/:id/archive",
    "POST /api/admin/contacts/:id/restore",
    "POST /api/admin/contacts/:id/suspend",
    "POST /api/admin/contacts/:id/verify",
    "POST /api/admin/contacts/import-csv",
    "POST /api/admin/crm-dedup-review/:id/reopen",
    "POST /api/admin/crm-dedup-review/:id/resolve",
    "POST /api/admin/crm-dedup-review/detect",
    "POST /api/admin/email-campaigns",
    "POST /api/admin/email-campaigns/:id/cancel",
    "POST /api/admin/email-campaigns/:id/render-preview",
    "POST /api/admin/email-campaigns/:id/schedule",
    "POST /api/admin/email-campaigns/:id/send",
    "POST /api/admin/email-campaigns/:id/test-send",
    "POST /api/admin/email-campaigns/audience-preview",
    "POST /api/admin/email-campaigns/send",
    "POST /api/admin/email/bulk-send",
    "POST /api/admin/email/outbox/:id/cancel",
    "POST /api/admin/email/outbox/:id/retry",
    "POST /api/admin/email/preview",
    "POST /api/admin/email/test-send",
    "POST /api/admin/email/tick",
    "POST /api/admin/email/transport/outbox/:id/cancel",
    "POST /api/admin/email/transport/outbox/:id/retry",
    "POST /api/admin/email/transport/test-connection",
    "POST /api/admin/investors/bulk",
    "POST /api/admin/invoices/:id/refund",
    "POST /api/admin/mfcrm/capability/:partnerId/seed",
    "POST /api/admin/mfcrm/engagements/:partnerId/:engagementId/trial-override",
    "POST /api/admin/mfcrm/engagements/:partnerId/expire-stale-trials",
    "POST /api/admin/mfcrm/handovers/:partnerId/:handoverId/override",
    "POST /api/admin/migration/commit",
    "POST /api/admin/migration/commit",
    "POST /api/admin/migration/reset-cursor",
    "POST /api/admin/migration/wfix2/allow-dms",
    "POST /api/admin/migration/wfix2/spv-bug1",
    "POST /api/admin/notification-campaigns",
    "POST /api/admin/notification-campaigns/:id/cancel",
    "POST /api/admin/notification-campaigns/:id/schedule",
    "POST /api/admin/notification-campaigns/:id/send",
    "POST /api/admin/notification-campaigns/audience-preview",
    "POST /api/admin/partner-billing/commission-split",
    "POST /api/admin/partner-billing/invoices",
    "POST /api/admin/partner-billing/promotions/:id/grant",
    "POST /api/admin/partner-billing/promotions/:id/moderate",
    "POST /api/admin/partner-referrals/:id/approve",
    "POST /api/admin/partner-referrals/:id/reject",
    "POST /api/admin/partners",
    "POST /api/admin/partners/:id/archive",
    "POST /api/admin/partners/:id/attributions",
    "POST /api/admin/partners/:id/promote-tier",
    "POST /api/admin/partners/:id/reactivate",
    "POST /api/admin/partners/:id/suspend",
    "POST /api/admin/pricing-models",
    "POST /api/admin/pricing-models/:id/clone",
    "POST /api/admin/pricing-models/:id/promote",
    "POST /api/admin/pricing-models/bootstrap-founder-tiers",
    "POST /api/admin/pricing-models/migrate-legacy",
    "POST /api/admin/reconciliation/force-commit",
    "POST /api/admin/reconciliation/run",
    "POST /api/admin/regions/:region/toggle",
    "POST /api/admin/regions/extensions",
    "POST /api/admin/regions/extensions/:id/archive",
    "POST /api/admin/regions/extensions/:id/transition",
    "POST /api/admin/sync/_reset",
    "POST /api/admin/sync/replay",
    "POST /api/admin/sync/reset-demo",
    "POST /api/admin/telemetry/cohort",
    "POST /api/admin/telemetry/funnel",
    "POST /api/admin/tenants/:id/delete",
    "POST /api/admin/users/:id/sessions/revoke",
    "POST /api/admin/users/bulk",
    "PUT /api/admin/collective/renewal-worker-config",
    "PUT /api/admin/email/templates/:slug",
    "PUT /api/admin/lock-text/:key",
    "PUT /api/admin/partner-billing/tier-prices",
  ],
  // gate(investor.hasAnyCapTable) on /api/investor/portfolio.
  "<anonymous>#3": [
    "GET /api/investor/portfolio/:id/marks",
    "GET /api/investor/portfolio/analytics",
    "GET /api/investor/portfolio/tax",
  ],
  // gate(investor.hasAnyCapTable) on /api/investor/crm — TOTALLY INERT. Wave 29 closed the six genuinely-open routes AT THE HANDLER (crmStore.ts); moving this mount would lock out cap-table-less investors.
  "<anonymous>#4": [
    "DELETE /api/investor/crm/:id",
    "DELETE /api/investor/crm/contacts/:id",
    "DELETE /api/investor/crm/contacts/:id",
    "DELETE /api/investor/crm/tasks/:id",
    "GET /api/investor/crm",
    "GET /api/investor/crm/contacts",
    "GET /api/investor/crm/contacts",
    "GET /api/investor/crm/notes",
    "GET /api/investor/crm/tasks",
    "PATCH /api/investor/crm/:id",
    "PATCH /api/investor/crm/:id/tasks/:taskId",
    "PATCH /api/investor/crm/contacts/:id",
    "PATCH /api/investor/crm/contacts/:id",
    "PATCH /api/investor/crm/contacts/:id/tasks/:taskId",
    "PATCH /api/investor/crm/tasks/:id",
    "POST /api/investor/crm",
    "POST /api/investor/crm/:id/notes",
    "POST /api/investor/crm/:id/tasks",
    "POST /api/investor/crm/broadcast",
    "POST /api/investor/crm/contacts",
    "POST /api/investor/crm/contacts",
    "POST /api/investor/crm/contacts/:id/notes",
    "POST /api/investor/crm/contacts/:id/tasks",
    "POST /api/investor/crm/notes",
    "POST /api/investor/crm/tasks",
  ],
  // inline gate on /api/collective/applications — TOTALLY INERT.
  "<anonymous>#7": [
    "GET /api/collective/applications",
    "GET /api/collective/applications/:id",
    "GET /api/collective/applications/mine",
    "POST /api/collective/applications",
  ],
  // gate(collective.active) on /api/collective/network — TOTALLY INERT.
  "<anonymous>#8": [
    "GET /api/collective/network",
  ],
  // gate(collective.active) on /api/collective/dealroom — TOTALLY INERT.
  "<anonymous>#9": [
    "GET /api/collective/dealroom/companies",
  ],
  // gate(founder.ofCompany) on /api/founder/companies/:id/billing — TOTALLY INERT.
  "<anonymous>#10": [
    "GET /api/founder/companies/:id/billing",
  ],
};

export const WAVE38_RATE_LIMIT_ESCAPEES: readonly string[] = [];

/** The prefixes `collectiveRateLimit` is mounted on. */
export const WAVE38_RATE_LIMITED_PREFIXES: readonly string[] = [
  "/api/collective",
  "/api/partner",
  "/api/messages",
];
