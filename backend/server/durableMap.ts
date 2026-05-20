/**
 * Sprint 29 KL-03 — Durable Map helper.
 *
 * @deprecated DO NOT ADOPT IN NEW CODE.
 *
 * This was a Sprint 29 attempt at a transparent Map-to-DB write-through. It
 * was never finished: `writeThrough` and `deleteThrough` below are still
 * `console.log` stubs that print "would upsert if Drizzle pg driver were
 * active" but never actually write. Furthermore, the intended target is a
 * single key-value `sync_inbox_state` blob table — not the real schema
 * tables. That defeats the whole purpose of having a typed Drizzle schema.
 *
 * Patch v12 (May 19, 2026) deliberately bypassed this helper in favour of
 * writing each store directly against its real Drizzle schema table via
 * `getDb()`. See `/home/user/workspace/audit_findings/phase5_db_persistence/
 * DB_PERSISTENCE_AUDIT.md` Section 6 (DB-2) for the architectural rationale.
 *
 * This file is retained ONLY because some legacy code may import the type.
 * Do not extend it. Do not adopt it. If you need persistence in a new
 * store, follow the v12 pattern: import `getDb` from `./db/connection`
 * and write directly against the schema table.
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
