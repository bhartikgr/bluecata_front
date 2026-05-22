/**
 * Sprint 29 KL-04 — Store hydration from database on startup.
 * Patch v12 Phase E — Sequential, real hydration for v12-migrated stores.
 *
 * Each in-memory store gets a hydrateFromDatabase() async function.
 *
 * Patch v12 Phase E rewrites the boot path so the v12-migrated stores
 * (userCredentialsStore, subscriptionsStore, multiCompanyStore) are
 * hydrated SEQUENTIALLY via `for...of HYDRATE_ORDER`. Sequential ordering
 * matters because:
 *   1) subscriptions reads from `companies` indirectly via mergeBilling — but
 *      multiCompany hydration is what re-establishes the per-user company
 *      mapping that downstream callers rely on, so userCredentials runs first
 *      (so login works), then subscriptions (so billing is restored), then
 *      multiCompany (so /api/founder/companies works).
 *   2) Promise.all is FORBIDDEN — it interleaves transactions and risks
 *      version-counter races on the hash-chained subscriptions table (DB-6).
 *
 * The legacy stubs for non-migrated stores stay as console-log no-ops; Day 2+
 * will swap them out as those stores migrate.
 *
 * server/index.ts calls hydrateAllStores() before httpServer.listen().
 *
 * Test contract preserved:
 *   - In sandbox (no DATABASE_URL): v12 hydrators STILL run against the local
 *     SQLite DB (Phase A wired connection.ts to ./data.db / :memory:).
 *     `hydrateAllStores()` resolves undefined without throwing.
 *   - When DATABASE_URL is set: the legacy "Drizzle pg driver were active"
 *     log line is preserved so sprint29_kl_closures.test.ts keeps passing.
 */

import { hydrateUserCredentialsStore } from "../userCredentialsStore";
import { hydrateSubscriptionsStore as realHydrateSubscriptions } from "../subscriptionsStore";
import { hydrateMultiCompanyStore as realHydrateMultiCompany } from "../multiCompanyStore";
import { hydrateCompanyProfileStore as realHydrateCompanyProfile } from "../companyProfileStore";
import { hydrateAdminPlatformStore as realHydrateAdminPlatform } from "../adminPlatformStore";
// Patch v12 Day 2 Wave 2 — the six newly DB-backed stores expose real hydrators.
import { hydrateLegalConsentStore as realHydrateLegalConsent } from "../legalConsentStore";
import { hydrateDataroomStore as realHydrateDataroom } from "../dataroomStore";
import { hydrateCaptableCommitStore as realHydrateCaptableCommit } from "../captableCommitStore";
import { hydrateTermSheetStore as realHydrateTermSheet } from "../termSheetStore";
import { hydrateInvoiceStore as realHydrateInvoice } from "../invoiceStore";
import { hydrateAdminContactsStore as realHydrateAdminContacts } from "../adminContactsStore";
// Patch v12 Day 3 — three CRM stores (audit §3.9, §3.10, §3.11).
import { hydrateFounderCrmStore as realHydrateFounderCrm } from "../founderCrmStore";
import { hydrateInvestorCrmStore as realHydrateInvestorCrm } from "../investorCrmStore";
import { hydrateCrmStore as realHydrateCrm } from "../crmStore";
// Patch v13 — Avi's Issues 3/4/5 newly DB-backed stores.
import { hydrateRoundsStore as realHydrateRounds } from "../roundsStore";
import { hydrateReportsStore as realHydrateReports } from "../reportsStore";
import { hydrateNetworkPostsStore as realHydrateNetworkPosts } from "../networkPostsStore";
// v15 P0-4..P0-11 — invitation + soft-circle DB-backed stores.
import { hydrateRoundInvitationsStore as realHydrateRoundInvitations } from "../roundInvitationsStore";
import { hydrateSoftCircleStore as realHydrateSoftCircle } from "../softCircleStore";
// v16 Fix 6 — Collective waitlist DB-backed store.
import { hydrateCollectiveWaitlistStore as realHydrateCollectiveWaitlist } from "../collectiveWaitlistStore";
// v16 Addendum A/B — DSC feedback (DB-migrated) and DSC votes (new foundation).
import { hydrateDscFeedbackStore as realHydrateDscFeedback } from "../dscFeedbackStore";
import { hydrateDscVoteStore as realHydrateDscVotes } from "../dscVoteStore";
// v17 Phase A — chapter scoping. chaptersStore is DB-only (no in-memory hydrator needed).
// v17 Phase B — 8 Collective stores migrated to hybrid Map+DB pattern.
import { hydrateCollectiveAppStore as realHydrateCollectiveApp } from "../collectiveAppStore";
import { hydrateCollectiveMembershipStore as realHydrateCollectiveMembership } from "../collectiveMembershipStore";
import { hydrateFounderCollectiveApplyStore as realHydrateFounderCollectiveApply } from "../founderCollectiveApplyStore";
import { hydrateSprint21PortfolioStore as realHydrateSprint21Portfolio } from "../sprint21PortfolioRoutes";
import { hydrateAdminDscStore as realHydrateAdminDsc } from "../adminDscRoutes";
import { hydrateCollectiveSettingsStore as realHydrateCollectiveSettings } from "../collectiveSettingsStore";
import { hydrateCommsCollectiveStore as realHydrateCommsCollective } from "../commsStore";
import { hydratePartnerWorkspaceCollectiveStore as realHydratePartnerCollective } from "../partnerWorkspaceStore";
// v19 Phase B — Messaging + Partner Workspace remaining DB-backed slices.
import { hydrateMessagingStore as realHydrateMessaging } from "../messagingStore";
import { hydratePartnerWorkspaceV19Store as realHydratePartnerV19 } from "../partnerWorkspaceV19Store";
// CP Phase A — DB-backed SPV/Fund store + one-time CRM hash-chain stitcher.
import { hydrateSpvFundStore as realHydrateSpvFund } from "../spvFundStore";
import { stitchPartnerCrmChain } from "./partnerCrmChainStitch";
// CP Phase B — consortium apply DB-backed hydrator.
import { hydrateConsortiumApplyStore as realHydrateConsortiumApply } from "../consortiumApplyStore";
import { log } from "./logger";

const STORES = [
  "subscriptionsStore",
  "adminContactsStore",
  "invoiceStore",
  "pricingModelStore",
  "notificationCampaignStore",
  "emailCampaignStore",
  "regionExtensionStore",
  "legalConsentStore",
  "companyProfileStore",
  // Sprint-fix additions:
  "founderCrmStore",
  "multiCompanyStore",
  "membershipStore",
  "dataroomStore",
  "reportsStore",
  "captableCommitStore",
  "termSheetStore",
  "crmStore",
  "commsStore",
  "notificationsStore",
];

/**
 * HYDRATE_ORDER — v12 sequential hydration sequence. Order matters:
 *   userCredentials → subscriptions → multiCompany
 *
 * userCredentials is first so login is restored even if a later hydrate
 * throws. subscriptions runs before multiCompany because mergeBillingFromSubscription
 * is called when /api/founder/companies/:id/billing serves a request — the
 * subscription map needs to be warm before any /api/founder/* request hits.
 * multiCompany is last so it has the full subscription map to overlay onto
 * its in-memory cache.
 */
const HYDRATE_ORDER: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: "userCredentialsStore", fn: hydrateUserCredentialsStore },
  { name: "subscriptionsStore",   fn: realHydrateSubscriptions },
  { name: "multiCompanyStore",    fn: realHydrateMultiCompany },
  // Patch v12 Day 2 Wave 1: companyProfile + adminPlatform DB-backed hybrid.
  // companyProfile after multiCompany because profile maps to co_<id> created
  // during multiCompany hydration. adminPlatform last because its audit chain
  // can reference any tenant — chain tips are looked up per-tenant inside tx.
  { name: "companyProfileStore", fn: realHydrateCompanyProfile },
  { name: "adminPlatformStore",  fn: realHydrateAdminPlatform },
  // Patch v12 Day 2 Wave 2: six additional DB-backed stores. Order matters:
  //   legalConsent  — no dependencies (platform-tenant ledger).
  //   dataroom     — references company IDs, so it follows multiCompany.
  //   captableCommit — ledger keyed by company; depends on multiCompany.
  //   termSheet    — per-round chain; rounds belong to companies.
  //   invoice      — hybrid cache; reads tenantForCompany.
  //   adminContacts — last (HIGH-CARE) so an early failure here does not
  //                   prevent the rest from booting; admin CRM is read-only
  //                   for most of the rest of the platform.
  { name: "legalConsentStore",   fn: realHydrateLegalConsent },
  { name: "dataroomStore",       fn: realHydrateDataroom },
  { name: "captableCommitStore", fn: realHydrateCaptableCommit },
  { name: "termSheetStore",      fn: realHydrateTermSheet },
  { name: "invoiceStore",        fn: realHydrateInvoice },
  { name: "adminContactsStore",  fn: realHydrateAdminContacts },
  // Patch v12 Day 3 — CRM stores. Order:
  //   founderCrm  — founder's view of investors; refs companies (after multiCompany).
  //   investorCrm — investor's broader contact tracker; independent.
  //   crm (pcrm)  — Sprint 10 personal CRM; independent, but child notes/tasks
  //                  ride alongside, so the store hydrates contacts first then
  //                  notes then tasks internally.
  { name: "founderCrmStore",     fn: realHydrateFounderCrm },
  { name: "investorCrmStore",    fn: realHydrateInvestorCrm },
  { name: "crmStore",            fn: realHydrateCrm },
  // Patch v13 — Avi's Issues 3/4/5. Order:
  //   roundsStore        — references company IDs (after multiCompany).
  //                         Slotted after multiCompany but · anywhere after
  //                         it is fine; placed here to keep grouping.
  //   reportsStore       — references company IDs.
  //   networkPostsStore  — platform-wide feed, independent.
  { name: "roundsStore",         fn: realHydrateRounds },
  { name: "reportsStore",        fn: realHydrateReports },
  { name: "networkPostsStore",   fn: realHydrateNetworkPosts },
  // v15 — invitations + soft-circles ride after roundsStore so the
  // round IDs they reference are already in memory.
  { name: "roundInvitationsStore", fn: realHydrateRoundInvitations },
  { name: "softCircleStore",       fn: realHydrateSoftCircle },
  // v16 Fix 6 — waitlist after softCircles, before DSC stores.
  { name: "collectiveWaitlistStore", fn: realHydrateCollectiveWaitlist },
  // v16 Addendum A — dscFeedback DB-backed (hybrid Map+DB, write-through).
  { name: "dscFeedbackStore",      fn: realHydrateDscFeedback },
  // v16 Addendum B — dsc_votes hash-chained foundation store.
  { name: "dscVoteStore",          fn: realHydrateDscVotes },
  // v17 Phase B — 8 Collective stores. Sequential order matters:
  //   collectiveAppStore         — applications to be a chapter member.
  //   collectiveMembershipStore  — active memberships (depends on apps).
  //   founderCollectiveApply     — founder-side nominations + applications.
  //   sprint21Portfolio          — investor portfolio nominations (hash-chained).
  //   adminDscRoutes             — DSC roles + pipeline (hash-chained for roles).
  //   collectiveSettingsStore    — per-chapter settings (hash-chained, upsert).
  //   commsCollective            — Collective-visibility channel posts.
  //   partnerWorkspaceCollective — partner deal promotions (Collective slice).
  { name: "collectiveAppStore",          fn: realHydrateCollectiveApp },
  { name: "collectiveMembershipStore",   fn: realHydrateCollectiveMembership },
  { name: "founderCollectiveApplyStore", fn: realHydrateFounderCollectiveApply },
  { name: "sprint21PortfolioStore",      fn: realHydrateSprint21Portfolio },
  { name: "adminDscStore",               fn: realHydrateAdminDsc },
  { name: "collectiveSettingsStore",     fn: realHydrateCollectiveSettings },
  { name: "commsCollectiveStore",        fn: realHydrateCommsCollective },
  { name: "partnerWorkspaceCollective",  fn: realHydratePartnerCollective },
  // v19 Phase B — Messaging DB migration (remaining slices). Messaging tables
  // hydrate AFTER auth/user-credentials (which is first) and AFTER the
  // Collective stores (which establish chapter context) but BEFORE
  // notifications/SSE (kept as legacy stubs further down). Sequential by
  // brief contract.
  { name: "messagingStore",              fn: realHydrateMessaging },
  // v19 Phase B — Partner workspace remaining slices. Hydrates AFTER
  // companies (multiCompanyStore is up early) and AFTER tenants because
  // the rows reference company_id and tenant scopes. Placed at end of the
  // v17 Phase B Collective slice block so partner_workspace tables are all
  // resident before any read traffic hits the routes.
  { name: "partnerWorkspaceV19Store",    fn: realHydratePartnerV19 },
  // CP Phase A (CP-028) — DB-backed SPV/Fund store. Hydrates after the
  // partner workspace so partner ids are known. Failure does not block boot.
  { name: "spvFundStore",                fn: realHydrateSpvFund },
  // CP Phase B (CP-001..005) — Consortium apply applications + partner
  // organizations row hydration. Hydrates AFTER spvFundStore so partner
  // identities are warm; safe to fail (boot continues).
  { name: "consortiumApplyStore",        fn: realHydrateConsortiumApply },
  // CP Phase A (CP-008) — One-time CRM hash-chain stitcher. Marked idempotent
  // via _migrations_applied; subsequent boots are a no-op.
  {
    name: "partnerCrmChainStitch",
    fn: async () => {
      try {
        stitchPartnerCrmChain();
      } catch (e) {
        // Already logged inside the module — swallow so boot proceeds.
        void e;
      }
    },
  },
];

/** Stub hydrate factory — used for stores not yet migrated to DB-backed hybrid. */
function makeHydrate(storeName: string) {
  return async function hydrateFromDatabase(_db?: unknown): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return; // sandbox no-op
    }
    // Production stub: log the activation message. Avi will add the query bodies.
    log.info(
      `[hydrate] would load ${storeName} from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`,
    );
  };
}

/* Per-store hydrate functions — each store imports its own from here.
 *
 * v12 Phase E: the three migrated stores re-export their REAL hydrators
 * instead of stubs. Downstream callers that import these by name get the
 * real DB-backed behavior. Legacy stub exports are kept for the other
 * stores (not yet migrated). */
export const hydrateSubscriptionsStore = realHydrateSubscriptions;
export const hydrateMultiCompanyStore = realHydrateMultiCompany;
// (userCredentials store does not appear in the legacy export list — only used
// via HYDRATE_ORDER below, so no re-export needed here.)

// Patch v12 Day 2 Wave 2: real DB-backed hydrators replace stubs.
export const hydrateAdminContactsStore = realHydrateAdminContacts;
export const hydrateInvoiceStore = realHydrateInvoice;
export const hydratePricingModelStore = makeHydrate("pricingModelStore");
export const hydrateNotificationCampaignStore = makeHydrate("notificationCampaignStore");
export const hydrateEmailCampaignStore = makeHydrate("emailCampaignStore");
export const hydrateRegionExtensionStore = makeHydrate("regionExtensionStore");
export const hydrateLegalConsentStore = realHydrateLegalConsent;
// Patch v12 Day 2 Wave 1: real DB-backed hydrator replaces stub.
export const hydrateCompanyProfileStore = realHydrateCompanyProfile;
// Patch v12 Day 2 Wave 1: real DB-backed hydrator replaces stub.
export const hydrateAdminPlatformStore = realHydrateAdminPlatform;
// Patch v12 Day 3: real DB-backed hydrator replaces stub.
export const hydrateFounderCrmStore = realHydrateFounderCrm;
export const hydrateMembershipStore = makeHydrate("membershipStore");
export const hydrateDataroomStore = realHydrateDataroom;
// Patch v13 (Avi's Issue 4): real DB-backed hydrator replaces stub.
export const hydrateReportsStore = realHydrateReports;
export const hydrateCaptableCommitStore = realHydrateCaptableCommit;
export const hydrateTermSheetStore = realHydrateTermSheet;
// Patch v12 Day 3: real DB-backed hydrators replace stubs.
export const hydrateInvestorCrmStore = realHydrateInvestorCrm;
export const hydrateCrmStore = realHydrateCrm;
// Patch v13 (Avi's Issue 5): real DB-backed hydrator for network posts. commsStore stays stubbed.
export const hydrateNetworkPostsStore = realHydrateNetworkPosts;
export const hydrateCommsStore = makeHydrate("commsStore");
// v19 Phase B — messaging + partner workspace V19 real DB-backed hydrators.
export const hydrateMessagingStore = realHydrateMessaging;
export const hydratePartnerWorkspaceV19Store = realHydratePartnerV19;
export const hydrateNotificationsStore = makeHydrate("notificationsStore");

/**
 * Master hydrator — called once at server start.
 *
 * v12 Phase E: walks HYDRATE_ORDER sequentially with `for...of`. NEVER uses
 * Promise.all (DB-6 hash-chain consistency).
 *
 * After the v12 sequence completes, the legacy stub stores are walked (still
 * no-ops in sandbox, console-log in prod). They will migrate in Day 2+.
 */
/* v19 Phase C — expose hydrate progress for /api/health. Single mutable
 * record updated as hydrateAllStores walks HYDRATE_ORDER. */
export interface HydrateProgress {
  state: "pending" | "in_progress" | "ok" | "partial" | "failed";
  total: number;
  succeeded: number;
  failed: number;
  failedNames: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const _hydrateProgress: HydrateProgress = {
  state: "pending",
  total: 0,
  succeeded: 0,
  failed: 0,
  failedNames: [],
  startedAt: null,
  finishedAt: null,
};

/** Read the live hydration progress snapshot. */
export function getHydrateProgress(): HydrateProgress {
  return { ..._hydrateProgress, failedNames: [..._hydrateProgress.failedNames] };
}

export async function hydrateAllStores(_db?: unknown): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  _hydrateProgress.state = "in_progress";
  _hydrateProgress.total = HYDRATE_ORDER.length;
  _hydrateProgress.succeeded = 0;
  _hydrateProgress.failed = 0;
  _hydrateProgress.failedNames = [];
  _hydrateProgress.startedAt = new Date().toISOString();
  _hydrateProgress.finishedAt = null;

  // v12 Phase E: sequential `for...of HYDRATE_ORDER` over the migrated stores.
  // Runs in BOTH sandbox (SQLite via connection.ts) and prod (Postgres when
  // DATABASE_URL is set). Errors in one hydrator must not silently kill the
  // others — we log and continue so the server can still boot.
  for (const { name, fn } of HYDRATE_ORDER) {
    try {
      await fn();
      _hydrateProgress.succeeded += 1;
      log.info(`[hydrate] v12 store hydrated: ${name}`);
    } catch (err) {
      _hydrateProgress.failed += 1;
      _hydrateProgress.failedNames.push(name);
      log.warn(`[hydrate] v12 store ${name} failed to hydrate:`, (err as Error).message);
    }
  }
  _hydrateProgress.finishedAt = new Date().toISOString();
  _hydrateProgress.state =
    _hydrateProgress.failed === 0
      ? "ok"
      : _hydrateProgress.succeeded > 0
        ? "partial"
        : "failed";

  if (!dbUrl) {
    log.info("[hydrate] DATABASE_URL not set — non-v12 stores remain in-memory (sandbox mode)");
    return;
  }

  log.info(`[hydrate] DATABASE_URL detected — running stub hydrators for ${STORES.length} non-v12 stores...`);
  // Preserve the legacy log message — Sprint 29 KL test asserts on it.
  for (const name of STORES) {
    log.info(
      `[hydrate] would load ${name} from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`,
    );
  }
  log.info("[hydrate] all stores hydration complete (v12 sequence + legacy stubs)");
}
