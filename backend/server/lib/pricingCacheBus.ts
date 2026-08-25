/**
 * server/lib/pricingCacheBus.ts
 *
 * WAVE 131 — R95: PRICING IS REAL-TIME. ONE PLACE THAT DROPS EVERY PRICE CACHE.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * `build_log/wave129/W129_PREFLIGHT.md` reported the staleness as 60 s (the
 * `platformFeesStore` module cache) plus 30 s (the client `staleTime`) = 90 s.
 * That was too low. Wave 131's enumeration found two more, and the worse two:
 *
 *   * `server/publicPricingRoutes.ts` holds a **5-minute** module-scope cache of
 *     the whole public pricing payload, and its `invalidatePublicPricingCache()`
 *     had **zero callers** — the file's own comment admitted wiring it was
 *     "OPTIONAL".
 *   * the same endpoint sent `Cache-Control: public, max-age=300`, i.e. another
 *     five minutes in every browser and CDN, which nothing can invalidate.
 *
 * So an owner could change a price and have the old one quoted for minutes. The
 * browser cache is now `no-store`, the `platformFeesStore` cache is gone, and
 * every remaining server-side cache is dropped HERE, from one function, called
 * by every admin pricing write path. One function means the next person who adds
 * a price cache has one place to register it, and a test can assert the call.
 *
 * SAFETY. Never throws. A cache that fails to clear must not fail the write that
 * was already committed — but it also must not be silent, so it logs.
 */
import { log } from "./logger";
import { invalidateFeeCache } from "../platformFeesStore";
import { invalidatePublicPricingCache } from "../publicPricingRoutes";

/**
 * Every server-side price cache, named. Kept as data so "what is cached" is
 * answerable without reading three modules.
 */
export const PRICE_CACHES: readonly string[] = Object.freeze([
  "platformFeesStore (WAVE 131: cache removed; invalidate is a retained no-op)",
  "publicPricingRoutes public pricing payload (5 min TTL, now invalidated on write)",
]);

/**
 * Drop every server-side price cache so the NEXT request reads the database.
 *
 * @param reason short machine-ish string naming the write that triggered it, for
 *               the log line — e.g. "platform_fees.set" or "tier_price.set".
 */
export function invalidateAllPricingCaches(reason: string): void {
  try {
    invalidateFeeCache();
  } catch (err) {
    log.warn(`[pricing-cache-bus] invalidateFeeCache failed (${reason}): ${String(err)}`);
  }
  try {
    invalidatePublicPricingCache();
  } catch (err) {
    log.warn(`[pricing-cache-bus] invalidatePublicPricingCache failed (${reason}): ${String(err)}`);
  }
}
