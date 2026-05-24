/**
 * Sprint 29 KL-04 — Store hydration from database on startup.
 *
 * Each in-memory store gets a hydrateFromDatabase() async function.
 * In sandbox (no DATABASE_URL): no-op with log message.
 * In production (DATABASE_URL set): Avinay activates the Drizzle pg queries.
 *
 * server/index.ts calls hydrateAllStores() before httpServer.listen().
 */

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
];

/** Stub hydrate factory. */
function makeHydrate(storeName: string) {
  return async function hydrateFromDatabase(_db?: unknown): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return; // sandbox no-op
    }
    // Production stub: log the activation message. Avinay will add the query bodies.
    console.log(
      `[hydrate] would load ${storeName} from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`,
    );
  };
}

/* Per-store hydrate functions — each store imports its own from here. */
export const hydrateSubscriptionsStore = makeHydrate("subscriptionsStore");
export const hydrateAdminContactsStore = makeHydrate("adminContactsStore");
export const hydrateInvoiceStore = makeHydrate("invoiceStore");
export const hydratePricingModelStore = makeHydrate("pricingModelStore");
export const hydrateNotificationCampaignStore = makeHydrate("notificationCampaignStore");
export const hydrateEmailCampaignStore = makeHydrate("emailCampaignStore");
export const hydrateRegionExtensionStore = makeHydrate("regionExtensionStore");
export const hydrateLegalConsentStore = makeHydrate("legalConsentStore");

/** Master hydrator — called once at server start. */
export async function hydrateAllStores(_db?: unknown): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[hydrate] DATABASE_URL not set — all stores remain in-memory (sandbox mode)");
    return;
  }

  console.log(`[hydrate] DATABASE_URL detected — hydrating ${STORES.length} stores...`);
  await Promise.all(
    STORES.map(async (name) => {
      console.log(
        `[hydrate] would load ${name} from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`,
      );
    }),
  );
  console.log("[hydrate] all stores hydration complete (stubs — activate queries before production)");
}
