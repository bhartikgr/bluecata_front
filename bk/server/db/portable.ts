/**
 * server/db/portable.ts — Wave H Track A: Postgres compatibility helpers.
 *
 * BACKGROUND
 * ----------
 * Drizzle's better-sqlite3 driver exposes `.all()`, `.get()`, `.run()` as
 * synchronous terminal methods on a query builder. The postgres-js driver
 * does NOT — postgres-js query builders are thenable (Promise-like) and
 * resolve directly to `Row[]` via `await`.
 *
 * As a result, code written for SQLite that calls `.all()` crashes on
 * Postgres with:
 *
 *   db.select(...).from(...).where(...).all is not a function
 *
 * which is exactly Avi's production hydration error.
 *
 * STRATEGY
 * --------
 * This module exports three small helpers — `pAll`, `pGet`, `pRun` — that
 * detect the driver at call-time and dispatch to the correct terminal
 * shape. They return `Promise<…>` in both cases, so call sites uniformly
 * use `await`. The SQLite path stays purely synchronous under the hood,
 * so we add **zero latency** on the existing happy path. There is no
 * polyfill, no deasync, no worker; just feature-detect-and-dispatch.
 *
 * USAGE
 * -----
 *   // BEFORE (SQLite-only, crashes on Postgres):
 *   const rows = db.select().from(table).where(eq(table.id, id)).all();
 *
 *   // AFTER (portable, works on both drivers):
 *   const rows = await pAll<Row>(
 *     db.select().from(table).where(eq(table.id, id))
 *   );
 *
 * The wrapping function must be `async`. Propagate `await` up the call
 * stack as needed; the route handlers that ultimately consume these
 * results were already async, so the propagation usually terminates
 * within one or two frames.
 *
 * MATH-SACRED CARVE-OUT
 * ---------------------
 * `server/captableCommitStore.ts` is byte-locked to SHA
 *   5b0be7ccc3acade42029ee6c4d75236ae64c910c4447a33f4428012ff86d6b78
 * (Wave G baseline). It contains nine `.all()` call sites, two of which
 * (lines 364 and 476) sit inside the math-sacred zone (lines 354–477,
 * SHA e27651e33947…). Touching that file in Wave H would re-baseline the
 * SHA — which is an intentional break, not a casual edit, and is therefore
 * scoped out of this wave.
 *
 * Consequence: the captable commit ledger's `.all()` reads remain
 * SQLite-only in Wave H. The cap-table ENGINE itself
 * (`packages/cap-table-engine/*`) does not touch the database and is
 * therefore Postgres-compatible without changes. Wave H Track B (separate
 * subagent / future wave) will re-baseline math-sacred under audit and
 * convert those nine sites; see
 *   avi_patch_v19/docs/WAVE_H_TRACK_A_POSTGRES_COMPAT.md §5.
 *
 * The pAllSync helper below is provided for code paths that MUST stay
 * synchronous (e.g. inline-migration bootstrap in connection.ts). It
 * throws loudly on Postgres so misuse is caught immediately rather than
 * silently corrupting data.
 */

import { getDbDriver } from "./connection";
import { log } from "../lib/logger";

// ──────────────────────────────────────────────────────────────────────
// Driver detection
// ──────────────────────────────────────────────────────────────────────

/** Returns true if the active driver is postgres-js. */
export function isPostgres(): boolean {
  return getDbDriver() === "postgres";
}

/** Returns true if the active driver is better-sqlite3. */
export function isSqlite(): boolean {
  return getDbDriver() === "sqlite";
}

/**
 * Driver capability matrix. Useful for store-level guards that need to
 * branch on what the underlying driver supports.
 */
export interface DriverCapabilities {
  /** Sync terminal methods (.all/.get/.run) exist on query builders. */
  supportsSync: boolean;
  /** `.all()` is a function on query builders. */
  supportsAll: boolean;
  /** Sync `db.transaction((tx) => {...})` is supported. */
  supportsSyncTx: boolean;
  /** Async `await db.transaction(async (tx) => {...})` is supported. */
  supportsAsyncTx: boolean;
  driver: "sqlite" | "postgres";
}

export function getDriverCapabilities(): DriverCapabilities {
  const driver = getDbDriver();
  if (driver === "sqlite") {
    return {
      supportsSync: true,
      supportsAll: true,
      supportsSyncTx: true,
      supportsAsyncTx: false, // better-sqlite3 transactions are sync-only
      driver: "sqlite",
    };
  }
  return {
    supportsSync: false,
    supportsAll: false,
    supportsSyncTx: false,
    supportsAsyncTx: true,
    driver: "postgres",
  };
}

// ──────────────────────────────────────────────────────────────────────
// Portable terminal methods
// ──────────────────────────────────────────────────────────────────────

/**
 * Portable `.all()`. Returns a Promise of an array of rows.
 *
 * On SQLite: invokes the synchronous `.all()` method and wraps the result
 * in `Promise.resolve` for uniform await semantics.
 *
 * On Postgres: awaits the thenable query builder, which resolves to
 * `Row[]` directly.
 *
 * @param qb A Drizzle query builder (the value returned by
 *           `db.select().from(...).where(...)`, etc.).
 */
export async function pAll<T = any>(qb: any): Promise<T[]> {
  if (qb != null && typeof qb.all === "function") {
    // SQLite path — synchronous .all(); wrap in Promise.resolve via await.
    return qb.all() as T[];
  }
  // Postgres path — query builder is thenable; await yields Row[].
  const rows = await qb;
  return rows as T[];
}

/**
 * Portable `.get()`. Returns a Promise of the first row or undefined.
 *
 * On SQLite: invokes synchronous `.get()`.
 *
 * On Postgres: appends `.limit(1)` (if not already constrained), awaits,
 * and returns `rows[0]`. Callers that have already applied `.limit(1)`
 * upstream still get correct behavior because `rows[0]` is undefined when
 * the result set is empty.
 *
 * NOTE: on Postgres we attempt `qb.limit(1)` only when `.limit` exists
 * (i.e. SELECT queries). For non-select builders that happen to be passed
 * in, we fall back to awaiting directly and returning the first element.
 */
export async function pGet<T = any>(qb: any): Promise<T | undefined> {
  if (qb != null && typeof qb.get === "function") {
    return qb.get() as T | undefined;
  }
  let target = qb;
  if (qb != null && typeof qb.limit === "function") {
    try {
      target = qb.limit(1);
    } catch {
      // If `.limit` was already applied or the builder doesn't support
      // re-limit, fall back to the original.
      target = qb;
    }
  }
  const rows = await target;
  if (Array.isArray(rows)) return rows[0] as T | undefined;
  return rows as T | undefined;
}

/**
 * Portable `.run()`. Returns a Promise of a { changes } object.
 *
 * On SQLite: invokes synchronous `.run()` which natively returns
 * `{ changes, lastInsertRowid }`.
 *
 * On Postgres: awaits the query builder. Postgres INSERT/UPDATE/DELETE
 * without RETURNING resolves to a result object whose `count` field
 * carries the row count; with RETURNING it resolves to a row array.
 * We normalize both to `{ changes }` for caller uniformity.
 */
export async function pRun(qb: any): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
  if (qb != null && typeof qb.run === "function") {
    const r = qb.run();
    // better-sqlite3 returns { changes, lastInsertRowid }
    return {
      changes: typeof r?.changes === "number" ? r.changes : 0,
      lastInsertRowid: r?.lastInsertRowid,
    };
  }
  const result = await qb;
  if (Array.isArray(result)) {
    return { changes: result.length };
  }
  // postgres-js Drizzle returns objects shaped like { count } for write
  // statements without RETURNING; default to 1 if we can't introspect.
  const count =
    typeof (result as any)?.count === "number"
      ? (result as any).count
      : typeof (result as any)?.rowCount === "number"
        ? (result as any).rowCount
        : 1;
  return { changes: count };
}

// ──────────────────────────────────────────────────────────────────────
// Sync escape hatches (SQLite-only — throws loudly on Postgres)
// ──────────────────────────────────────────────────────────────────────

/**
 * Synchronous `.all()` — SQLite only. Use ONLY in code paths that
 * cannot be made async (e.g. module-load-time setup, inline-migration
 * bootstrap, or math-sacred files we cannot refactor without
 * re-baselining the SHA chain).
 *
 * Throws on Postgres so misuse is caught at boot rather than corrupting
 * data through a silent fallback.
 */
export function pAllSync<T = any>(qb: any): T[] {
  if (qb != null && typeof qb.all === "function") {
    return qb.all() as T[];
  }
  throw new Error(
    "pAllSync called under Postgres — this code path requires sync .all() " +
    "which postgres-js does not support. Convert the caller to use pAll() " +
    "(async) instead, or guard the call site with isSqlite().",
  );
}

/** Synchronous `.get()` — SQLite only. Same contract as pAllSync. */
export function pGetSync<T = any>(qb: any): T | undefined {
  if (qb != null && typeof qb.get === "function") {
    return qb.get() as T | undefined;
  }
  throw new Error(
    "pGetSync called under Postgres — convert caller to pGet() (async) " +
    "or guard with isSqlite().",
  );
}

/** Synchronous `.run()` — SQLite only. Same contract as pAllSync. */
export function pRunSync(qb: any): { changes: number; lastInsertRowid?: number | bigint } {
  if (qb != null && typeof qb.run === "function") {
    const r = qb.run();
    return {
      changes: typeof r?.changes === "number" ? r.changes : 0,
      lastInsertRowid: r?.lastInsertRowid,
    };
  }
  throw new Error(
    "pRunSync called under Postgres — convert caller to pRun() (async) " +
    "or guard with isSqlite().",
  );
}

// ──────────────────────────────────────────────────────────────────────
// Portable transaction wrapper
// ──────────────────────────────────────────────────────────────────────

/**
 * Portable transaction wrapper. The callback receives a Drizzle `tx`
 * handle. On SQLite the underlying transaction is synchronous (callbacks
 * must NOT await DB work on the tx — better-sqlite3 will throw); on
 * Postgres it is asynchronous and callbacks SHOULD await.
 *
 * To bridge both shapes, the callback signature is `(tx) => T | Promise<T>`.
 * This wrapper:
 *   - On SQLite: calls `db.transaction((tx) => callback(tx))` and assumes
 *     the callback returns a synchronous value. If a Promise is returned,
 *     we await it OUTSIDE the txn boundary (which is incorrect for SQLite
 *     ACID semantics) and log a loud warning. Callers that need to do
 *     async work inside a SQLite txn must restructure (this matches
 *     existing math-sacred patterns).
 *   - On Postgres: calls `await db.transaction(async (tx) => callback(tx))`.
 *
 * NOTE: math-sacred files (captableCommitStore.ts) bypass this wrapper
 * entirely — they use `db.transaction((tx) => {...})` directly. Those
 * files are SQLite-only in Wave H; see module header.
 */
export async function pTransaction<T>(
  db: any,
  callback: (tx: any) => T | Promise<T>,
): Promise<T> {
  if (getDbDriver() === "sqlite") {
    // better-sqlite3: sync transaction. The callback may return a Promise,
    // but better-sqlite3 will not await it inside the txn boundary. We
    // surface this as a warning so it is caught in dev.
    let captured: T | Promise<T>;
    db.transaction((tx: any) => {
      captured = callback(tx);
    })();
    if (captured! && typeof (captured as any).then === "function") {
      log.warn(
        "[pTransaction] callback returned a Promise under SQLite — the " +
        "transaction has already committed synchronously. Restructure to " +
        "avoid await inside the txn.",
      );
    }
    return await (captured! as Promise<T>);
  }
  // postgres-js: async transaction.
  return await db.transaction(async (tx: any) => await callback(tx));
}
