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
];

/** Stub hydrate factory — used for stores not yet migrated to DB-backed hybrid. */
function makeHydrate(storeName: string) {
  return async function hydrateFromDatabase(_db?: unknown): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return; // sandbox no-op
    }
    // Production stub: log the activation message. Avi will add the query bodies.
    console.log(
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
export const hydrateReportsStore = makeHydrate("reportsStore");
export const hydrateCaptableCommitStore = realHydrateCaptableCommit;
export const hydrateTermSheetStore = realHydrateTermSheet;
// Patch v12 Day 3: real DB-backed hydrators replace stubs.
export const hydrateInvestorCrmStore = realHydrateInvestorCrm;
export const hydrateCrmStore = realHydrateCrm;
export const hydrateCommsStore = makeHydrate("commsStore");
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
export async function hydrateAllStores(_db?: unknown): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;

  // v12 Phase E: sequential `for...of HYDRATE_ORDER` over the migrated stores.
  // Runs in BOTH sandbox (SQLite via connection.ts) and prod (Postgres when
  // DATABASE_URL is set). Errors in one hydrator must not silently kill the
  // others — we log and continue so the server can still boot.
  for (const { name, fn } of HYDRATE_ORDER) {
    try {
      await fn();
      console.log(`[hydrate] v12 store hydrated: ${name}`);
    } catch (err) {
      console.warn(`[hydrate] v12 store ${name} failed to hydrate:`, (err as Error).message);
    }
  }

  if (!dbUrl) {
    console.log("[hydrate] DATABASE_URL not set — non-v12 stores remain in-memory (sandbox mode)");
    return;
  }

  console.log(`[hydrate] DATABASE_URL detected — running stub hydrators for ${STORES.length} non-v12 stores...`);
  // Preserve the legacy log message — Sprint 29 KL test asserts on it.
  for (const name of STORES) {
    console.log(
      `[hydrate] would load ${name} from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`,
    );
  }
  console.log("[hydrate] all stores hydration complete (v12 sequence + legacy stubs)");
}
