/**
 * Sprint 29 KL-03 — Durable Map helper.
 *
 * **v25.21 Lane D NC-001 fix — implementation completed.**
 *
 * Historical note: this helper shipped in Sprint 29 with `console.log` stubs
 * for `writeThrough` / `deleteThrough` and was marked `@deprecated DO NOT
 * ADOPT IN NEW CODE`. Patch v12 (May 19, 2026) bypassed it for new stores in
 * favour of the direct `getDb()` + per-table Drizzle pattern. However, the
 * inbound bridge state in `server/lib/bridgeInbound.ts` already adopted it,
 * meaning every inbound Collective→Capavate cross-product event (DSC scores,
 * M&A intelligence rankings, partner status, social signals, member
 * decisions, membership renewals, KYC decisions, round participants — 9
 * stores in total) was RAM-only and lost on every restart. This violated
 * the standing rule "ALL TIED DIRECTLY TO THE DATABASE / NO MEMORY STORAGE."
 *
 * v25.21 closes that gap by giving durableMap a real SQLite write-through
 * AND boot-time hydrate against the existing `sync_inbox_state` table
 * (defined in shared/schema.ts since Sprint 29 KL-03; CREATE TABLE added in
 * v25.21 if missing). Each map's namespaced keys (`namespace::mapKey`) live
 * in that one key-value table. The helper still says `@deprecated` because
 * new business stores should follow the per-table pattern — but the
 * existing nine inbound-bridge stores can now safely use this helper for
 * what it is: an event-state durable key-value cache that survives restart.
 *
 * Usage (unchanged from callers' perspective):
 *   const myMap = durableMap<MyPayload>("my_namespace");
 *   myMap.set("key", value);      // upserts to sync_inbox_state
 *   myMap.get("key");             // reads in-memory (hydrated at boot via hydrateDurableMaps)
 *   myMap.has("key"), myMap.delete("key"), .entries() / .keys() / .values() / .size
 *
 * Boot order: `hydrateDurableMaps()` MUST be called once during the
 * hydration sequence before the first inbound bridge event is dispatched.
 * `bridgeRuntime.ts` already drives this via the standard hydrate flow.
 */

import { log } from "./lib/logger";
import { rawDb } from "./db/connection";
export interface DurableMapOptions {
  /** Namespace prefix stored in the DB key. Defaults to "default". */
  namespace?: string;
}

export interface DurableMap<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): void;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  readonly size: number;
  /** Dump the raw in-memory backing map (for tests). */
  _raw(): Map<K, V>;
}

/**
 * v25.21 Lane D NC-001 fix — module-level registry of every durableMap
 * created in this process so `hydrateDurableMaps()` can rehydrate each one
 * from `sync_inbox_state` on boot.
 */
interface RegisteredMap {
  namespace: string;
  inner: Map<string, unknown>;
}
const registeredMaps: RegisteredMap[] = [];

/**
 * Creates a DurableMap.
 * @param namespace - unique namespace for DB key disambiguation
 */
export function durableMap<V>(namespace: string, _opts: DurableMapOptions = {}): DurableMap<string, V> {
  const inner = new Map<string, V>();
  // Register for boot-time hydration.
  registeredMaps.push({ namespace, inner: inner as Map<string, unknown> });

  function dbKey(k: string): string {
    return `${namespace}::${k}`;
  }

  /* v25.21 Lane D NC-001 fix — real write-through to sync_inbox_state.
   * Best-effort: a DB hiccup degrades to memory-only for this one call
   * (and is loudly logged) rather than aborting the inbound bridge
   * dispatch. The next set() will retry the upsert. */
  function writeThrough(key: string, value: V): void {
    try {
      const db: any = rawDb();
      db.prepare(
        `INSERT INTO sync_inbox_state (key, value_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
      ).run(dbKey(key), JSON.stringify(value), new Date().toISOString());
    } catch (err) {
      log.warn(
        `[durable-map] ${namespace}: write-through failed for key=${dbKey(key)} (memory only):`,
        (err as Error).message,
      );
    }
  }

  function deleteThrough(key: string): void {
    try {
      const db: any = rawDb();
      db.prepare(`DELETE FROM sync_inbox_state WHERE key = ?`).run(dbKey(key));
    } catch (err) {
      log.warn(
        `[durable-map] ${namespace}: delete-through failed for key=${dbKey(key)} (memory only):`,
        (err as Error).message,
      );
    }
  }

  return {
    get(key: string): V | undefined {
      return inner.get(key);
    },
    set(key: string, value: V): void {
      inner.set(key, value);
      writeThrough(key, value);
    },
    has(key: string): boolean {
      return inner.has(key);
    },
    delete(key: string): void {
      inner.delete(key);
      deleteThrough(key);
    },
    entries(): IterableIterator<[string, V]> {
      return inner.entries();
    },
    keys(): IterableIterator<string> {
      return inner.keys();
    },
    values(): IterableIterator<V> {
      return inner.values();
    },
    get size(): number {
      return inner.size;
    },
    _raw(): Map<string, V> {
      return inner;
    },
  };
}

/**
 * v25.21 Lane D NC-001 fix — rehydrate every registered durableMap from
 * the `sync_inbox_state` table. Idempotent; safe to call multiple times.
 * Should be invoked once during the boot hydration sequence (see
 * server/lib/hydrateStores.ts) BEFORE any inbound bridge event is
 * dispatched.
 */
export function hydrateDurableMaps(): void {
  if (registeredMaps.length === 0) return;
  let total = 0;
  try {
    const db: any = rawDb();
    const rows: Array<{ key: string; value_json: string }> = db
      .prepare(`SELECT key, value_json FROM sync_inbox_state`)
      .all();
    for (const row of rows) {
      const sep = row.key.indexOf("::");
      if (sep < 0) continue;
      const ns = row.key.slice(0, sep);
      const mapKey = row.key.slice(sep + 2);
      const target = registeredMaps.find((m) => m.namespace === ns);
      if (!target) continue;
      try {
        target.inner.set(mapKey, JSON.parse(row.value_json));
        total += 1;
      } catch (parseErr) {
        log.warn(
          `[durable-map] hydrate skipping ${row.key}: invalid JSON — ${(parseErr as Error).message}`,
        );
      }
    }
    log.info(`[durable-map] hydrate complete: ${total} keys restored across ${registeredMaps.length} namespace(s)`);
  } catch (err) {
    log.warn(
      "[durable-map] hydrate failed (continuing with empty maps):",
      (err as Error).message,
    );
  }
}
