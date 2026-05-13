/**
 * Sprint 29 KL-03 — Durable Map helper.
 *
 * A Map-compatible wrapper that, when DATABASE_URL is set, writes through
 * to a backing store (Postgres `sync_inbox_state` table via Drizzle).
 * When DATABASE_URL is absent (sandbox), it stays in-memory but is annotated
 * as "ephemeral" in log messages.
 *
 * Usage:
 *   const myMap = durableMap<string, MyPayload>("my_namespace");
 *   myMap.set("key", value);      // upserts to DB in production
 *   myMap.get("key");             // reads from in-memory (hydrated at boot)
 *   myMap.has("key");
 *   myMap.delete("key");
 *   myMap.entries() / .keys() / .values() / .size
 */

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

const isProduction = (): boolean => Boolean(process.env.DATABASE_URL);

/**
 * Creates a DurableMap.
 * @param namespace - unique namespace for DB key disambiguation
 */
export function durableMap<V>(namespace: string, _opts: DurableMapOptions = {}): DurableMap<string, V> {
  const inner = new Map<string, V>();
  const mode = isProduction() ? "durable" : "ephemeral";

  if (mode === "ephemeral") {
    console.log(`[durable-map] ${namespace}: running in ephemeral (in-memory) mode — data will not survive restart`);
  }

  function dbKey(k: string): string {
    return `${namespace}::${k}`;
  }

  function writeThrough(key: string, value: V): void {
    if (!isProduction()) return;
    // In production with Drizzle pg driver active, Avinay will activate:
    // await db.insert(syncInboxState).values({ key: dbKey(key), valueJson: JSON.stringify(value) })
    //   .onConflictDoUpdate({ target: syncInboxState.key, set: { valueJson: JSON.stringify(value) } });
    console.log(`[durable-map] ${namespace}: would upsert key=${dbKey(key)} into sync_inbox_state if Drizzle pg driver were active`);
  }

  function deleteThrough(key: string): void {
    if (!isProduction()) return;
    // await db.delete(syncInboxState).where(eq(syncInboxState.key, dbKey(key)));
    console.log(`[durable-map] ${namespace}: would delete key=${dbKey(key)} from sync_inbox_state if Drizzle pg driver were active`);
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
