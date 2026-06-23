/**
 * v25.10 — Securities persistence.
 *
 * Closes a launch-blocker: POST /api/companies/:id/securities previously
 * pushed into the in-process `securities` array imported from mockData.ts
 * with NO DB write and NO boot hydrator. On restart, every security a
 * founder added vanished. The comment at routes.ts:2192-2198 explicitly
 * flagged "durable engine-backed persistence for v24.1" — never landed.
 *
 * This module adds that persistence layer using the generic kv_<storeName>
 * shim from v25.9. The existing `securities` array in mockData.ts is
 * preserved (Avi-preserved sacred files rule); we just add a write-through
 * to `kv_securitiesStore` on every push, and a hydrator that rehydrates the
 * legacy array on boot.
 *
 * Routes that mutate securities should call `persistSecurity(sec)` AFTER
 * pushing to the legacy array. Routes that READ should use the existing
 * `securities` array; hydration restores it at boot.
 */

import { persistEntry, hydrateEntries } from "./storePersistenceShim";
import { log } from "./logger";

export interface Security {
  id: string;
  companyId: string;
  kind: string;
  principal: unknown;
  terms: unknown;
  issuedAt: string;
}

const STORE_NAME = "securitiesStore";

/**
 * Persist a security to the DB. Call this AFTER pushing to the legacy
 * `securities` array so reads in the same process see it immediately
 * AND the row survives restart.
 */
export function persistSecurity(sec: Security): boolean {
  if (!sec || !sec.id) return false;
  return persistEntry(STORE_NAME, sec.id, sec);
}

/**
 * Hydrate the in-memory `securities` array from DB at boot.
 * Called from the HYDRATE_ORDER sequence in hydrateStores.ts.
 *
 * @param target the imported `securities` array from mockData.ts
 */
export function hydrateSecuritiesStore(target: Security[]): number {
  const entries = hydrateEntries<Security>(STORE_NAME);
  let restored = 0;
  for (const [, sec] of entries) {
    /* De-dupe: if this id is already in the legacy array (because the demo
     * seed pre-seeded it), skip. We don't overwrite seed data with a
     * possibly-empty DB row, but we DO add any rows that are not in the
     * seed. */
    if (target.some((s) => s.id === sec.id)) continue;
    target.push(sec);
    restored++;
  }
  if (restored > 0) {
    log.info({
      route: "securitiesStore.hydrate",
      message: `restored ${restored} securities from kv_securitiesStore`,
    });
  }
  return restored;
}
