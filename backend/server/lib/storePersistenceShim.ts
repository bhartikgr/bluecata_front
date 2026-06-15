/**
 * v25.9 — Store persistence shim.
 *
 * Background:
 *   Avi reported on 12-Jun-2026: "Most of the records are being saved in
 *   memory instead of the database. Please fix this issue and ensure that
 *   all records are stored properly in the database tables."
 *
 *   Boot logs showed:
 *     [hydrate] DATABASE_URL detected — running stub hydrators for 19
 *     non-v12 stores...
 *     [hydrate] would load X from DATABASE_URL=... if Drizzle pg driver were
 *     active
 *
 *   13 of those 19 stores actually have real hydrate functions in HYDRATE_ORDER.
 *   The remaining 6 — pricingModelStore, notificationCampaignStore,
 *   emailCampaignStore, regionExtensionStore, membershipStore, notificationsStore —
 *   have NO DB persistence at all. Anything written during a session vanishes
 *   on restart.
 *
 * Approach:
 *   This shim provides a SIMPLE, deterministic generic JSON-blob persistence
 *   layer for those stores:
 *     - One table per store: `kv_<storeName>(id PRIMARY KEY, payload_json TEXT,
 *       updated_at TEXT, deleted_at TEXT)`
 *     - persistEntry(storeName, id, obj) writes/updates one row
 *     - hydrateEntries(storeName) reads all rows back as `[id, obj]` tuples
 *     - softDelete(storeName, id) sets deleted_at
 *
 *   Stores call persistEntry on every mutation; their existing in-memory Map
 *   is left untouched (writes go to both Map AND DB). On boot, their hydrate
 *   function calls hydrateEntries and repopulates the Map.
 *
 *   Why generic JSON over per-table schemas:
 *     - 6 stores × N columns × evolving shapes = too many CREATE TABLE statements
 *     - Stores already serialize/deserialize their own internal shape
 *     - This is a SAFETY NET for stores that legitimately had no schema —
 *       it gets data into the DB now, without requiring a per-store migration.
 *     - For stores that later get a proper Drizzle migration, they can
 *       continue to write to the typed table and stop calling persistEntry;
 *       the kv_<store> table can then be dropped.
 *
 * NOTE: This shim is the CORRECT immediate fix per Avi's instruction (no more
 * RAM-only). When time permits, individual stores should migrate to typed
 * Drizzle tables for query-ability. The shim writes ARE durable; reads still
 * go through the in-memory Map for performance.
 */

import { rawDb } from "../db/connection";
import { log } from "./logger";

const ensuredTables = new Set<string>();

function tableNameFor(storeName: string): string {
  /* Sanitize: alphanumeric + underscore only, max 48 chars */
  const safe = storeName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48);
  return `kv_${safe}`;
}

function ensureTable(storeName: string): boolean {
  const t = tableNameFor(storeName);
  if (ensuredTables.has(t)) return true;
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_updated_at ON ${t}(updated_at);`);
    ensuredTables.add(t);
    return true;
  } catch (err) {
    log.warn({
      route: "storePersistenceShim.ensureTable",
      message: `${t} CREATE TABLE failed (non-fatal): ${(err as Error).message}`,
    });
    return false;
  }
}

/**
 * Persist one entry into the kv_<storeName> table.
 * Returns true on success, false on failure (non-fatal — caller continues).
 */
export function persistEntry(storeName: string, id: string, obj: unknown): boolean {
  if (!id || !obj) return false;
  if (!ensureTable(storeName)) return false;
  try {
    const db: any = rawDb();
    const t = tableNameFor(storeName);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ${t} (id, payload_json, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
    ).run(id, JSON.stringify(obj), now);
    return true;
  } catch (err) {
    log.warn({
      route: "storePersistenceShim.persistEntry",
      message: `${storeName}.${id} persist failed: ${(err as Error).message}`,
    });
    return false;
  }
}

/**
 * v25.23 NC-D — Strict (fail-closed) variant of persistEntry.
 *
 * Background: Lane D (NC-2 / NC-3) and Lane A (NEW-10) found that callers wrap
 * `persistEntry` in `catch { /* non-fatal *\/ }` and discard its boolean
 * return, so a DB-write failure leaves the record in RAM only while the API
 * still reports success — the exact "saved in memory instead of the database"
 * regression Avi reported (12-Jun-2026).
 *
 * This variant performs the SAME DB write but THROWS on failure instead of
 * returning `false`, so opt-in callers on the money / identity surfaces can
 * fail closed (roll back the in-memory mutation and re-throw to the caller).
 *
 * IMPORTANT: the default `persistEntry` semantics above are deliberately left
 * UNCHANGED — Lane G validated 46 prior-wave breadcrumbs whose non-fatal
 * best-effort persists must keep their existing behaviour. Only the new strict
 * call sites are migrated.
 *
 * Throws on: missing id/obj, ensureTable failure, or INSERT failure.
 */
export function persistEntryStrict(storeName: string, id: string, obj: unknown): true {
  if (!id || !obj) {
    throw new Error(`STRICT_PERSIST_FAILED: ${storeName} missing id/obj`);
  }
  if (!ensureTable(storeName)) {
    throw new Error(`STRICT_PERSIST_FAILED: ${storeName} ensureTable failed`);
  }
  try {
    const db: any = rawDb();
    const t = tableNameFor(storeName);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ${t} (id, payload_json, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
    ).run(id, JSON.stringify(obj), now);
    return true;
  } catch (err) {
    /* Fail closed: surface the failure so the caller can roll back RAM. */
    log.error?.({
      route: "storePersistenceShim.persistEntryStrict",
      message: `${storeName}.${id} strict persist failed: ${(err as Error).message}`,
    });
    throw new Error(
      `STRICT_PERSIST_FAILED: ${storeName}.${id}: ${(err as Error).message}`,
    );
  }
}

/**
 * Soft-delete one entry. Hydration skips deleted rows.
 */
export function softDeleteEntry(storeName: string, id: string): boolean {
  if (!ensureTable(storeName)) return false;
  try {
    const db: any = rawDb();
    const t = tableNameFor(storeName);
    db.prepare(`UPDATE ${t} SET deleted_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      id,
    );
    return true;
  } catch (err) {
    log.warn({
      route: "storePersistenceShim.softDelete",
      message: `${storeName}.${id} soft-delete failed: ${(err as Error).message}`,
    });
    return false;
  }
}

/**
 * Hydrate all entries for a store. Returns `[id, parsedObj]` tuples for
 * non-deleted rows. The store's hydrate function uses these to repopulate
 * its in-memory Map.
 */
export function hydrateEntries<T = any>(storeName: string): Array<[string, T]> {
  if (!ensureTable(storeName)) return [];
  try {
    const db: any = rawDb();
    const t = tableNameFor(storeName);
    const rows: any[] = db
      .prepare(`SELECT id, payload_json FROM ${t} WHERE deleted_at IS NULL ORDER BY updated_at ASC`)
      .all();
    const result: Array<[string, T]> = [];
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.payload_json) as T;
        result.push([r.id, obj]);
      } catch {
        /* Skip corrupt rows — log but don't fail the whole hydrate. */
        log.warn({
          route: "storePersistenceShim.hydrateEntries",
          message: `${t}.${r.id} JSON parse failed; skipping`,
        });
      }
    }
    return result;
  } catch (err) {
    log.warn({
      route: "storePersistenceShim.hydrateEntries",
      message: `${storeName} hydrate failed: ${(err as Error).message}`,
    });
    return [];
  }
}

/**
 * Convenience: hydrate directly into a Map. Returns the count of entries
 * loaded so the caller can log it.
 */
export function hydrateIntoMap<T>(storeName: string, target: Map<string, T>): number {
  const entries = hydrateEntries<T>(storeName);
  for (const [id, obj] of entries) {
    target.set(id, obj);
  }
  return entries.length;
}
