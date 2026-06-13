/**
 * Wave H Track A — Unit tests for server/db/portable.ts.
 *
 * The portable helpers are load-bearing: every store that calls `.all()`
 * on a Drizzle query builder will route through them. A bug here
 * propagates to ~199 call sites in production code. These tests cover:
 *
 *   1. SQLite-shape query builders (sync .all/.get/.run present) — the
 *      helper must dispatch to the sync method and return its result
 *      inside a resolved Promise.
 *
 *   2. Postgres-shape query builders (thenable, no .all/.get/.run) — the
 *      helper must `await` the builder. For pGet, it must call `.limit(1)`
 *      first if available.
 *
 *   3. Capability matrix — getDriverCapabilities() reflects the active
 *      driver.
 *
 *   4. Sync escape hatches (pAllSync etc.) — must throw under Postgres-shape
 *      input.
 *
 * The tests do NOT spin up a real Postgres connection; they use minimal
 * fakes that match the postgres-js Drizzle shape (thenable + limit method).
 * Real Postgres integration is covered separately in Wave H verification
 * once a postgres-shaped CI is wired up.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pAll,
  pGet,
  pRun,
  pAllSync,
  pGetSync,
  pRunSync,
  isPostgres,
  isSqlite,
  getDriverCapabilities,
} from "../portable";
import * as connection from "../connection";

// ──────────────────────────────────────────────────────────────────────
// Helpers: fake query builders mirroring the two driver shapes
// ──────────────────────────────────────────────────────────────────────

/** A fake better-sqlite3 Drizzle query builder — sync terminal methods. */
function sqliteBuilder<T>(rows: T[]) {
  return {
    all: () => rows,
    get: () => rows[0],
    run: () => ({ changes: rows.length, lastInsertRowid: 1 as number | bigint }),
  };
}

/** A fake postgres-js Drizzle query builder — thenable, supports .limit. */
function postgresBuilder<T>(rows: T[], opts?: { write?: boolean }) {
  let limitApplied: number | undefined;
  const builder: any = {
    limit(n: number) {
      limitApplied = n;
      return builder;
    },
    then(onFulfilled: (v: any) => any, onRejected?: any) {
      try {
        if (opts?.write) {
          // postgres-js write without RETURNING resolves to { count }
          return Promise.resolve({ count: rows.length }).then(onFulfilled, onRejected);
        }
        const out = limitApplied !== undefined ? rows.slice(0, limitApplied) : rows;
        return Promise.resolve(out).then(onFulfilled, onRejected);
      } catch (e) {
        return Promise.reject(e).then(onFulfilled, onRejected);
      }
    },
    // expose for assertions
    _limitApplied: () => limitApplied,
  };
  return builder;
}

// ──────────────────────────────────────────────────────────────────────
// Driver-detection mocks
// ──────────────────────────────────────────────────────────────────────

let driverSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Default to sqlite for tests; individual tests override.
  driverSpy = vi.spyOn(connection, "getDbDriver").mockReturnValue("sqlite");
});

afterEach(() => {
  driverSpy.mockRestore();
});

// ──────────────────────────────────────────────────────────────────────
// pAll
// ──────────────────────────────────────────────────────────────────────

describe("pAll (portable .all)", () => {
  it("dispatches to sync .all() on SQLite-shape builders", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const qb = sqliteBuilder(rows);
    const result = await pAll<{ id: number }>(qb);
    expect(result).toEqual(rows);
  });

  it("awaits thenable Postgres-shape builders", async () => {
    driverSpy.mockReturnValue("postgres");
    const rows = [{ id: 1 }, { id: 2 }];
    const qb = postgresBuilder(rows);
    const result = await pAll<{ id: number }>(qb);
    expect(result).toEqual(rows);
  });

  it("returns an empty array when the result set is empty (SQLite)", async () => {
    const qb = sqliteBuilder<{ id: number }>([]);
    expect(await pAll(qb)).toEqual([]);
  });

  it("returns an empty array when the result set is empty (Postgres)", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = postgresBuilder<{ id: number }>([]);
    expect(await pAll(qb)).toEqual([]);
  });

  it("propagates rejection from a Postgres-shape builder", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = {
      then: (_ok: any, fail: any) => fail(new Error("connection refused")),
    };
    await expect(pAll(qb)).rejects.toThrow("connection refused");
  });
});

// ──────────────────────────────────────────────────────────────────────
// pGet
// ──────────────────────────────────────────────────────────────────────

describe("pGet (portable .get)", () => {
  it("dispatches to sync .get() on SQLite-shape builders", async () => {
    const qb = sqliteBuilder([{ id: 42, name: "row" }]);
    const result = await pGet<{ id: number; name: string }>(qb);
    expect(result).toEqual({ id: 42, name: "row" });
  });

  it("returns undefined for empty SQLite result", async () => {
    const qb = sqliteBuilder<{ id: number }>([]);
    expect(await pGet(qb)).toBeUndefined();
  });

  it("applies .limit(1) on Postgres-shape builders and returns first row", async () => {
    driverSpy.mockReturnValue("postgres");
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const qb = postgresBuilder(rows);
    const result = await pGet<{ id: number }>(qb);
    expect(result).toEqual({ id: 1 });
    expect(qb._limitApplied()).toBe(1);
  });

  it("returns undefined for empty Postgres result", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = postgresBuilder<{ id: number }>([]);
    expect(await pGet(qb)).toBeUndefined();
  });

  it("handles a Postgres-shape builder that lacks .limit (falls back to first element)", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = {
      then: (ok: any) => ok([{ id: 7 }, { id: 8 }]),
    };
    expect(await pGet<{ id: number }>(qb)).toEqual({ id: 7 });
  });
});

// ──────────────────────────────────────────────────────────────────────
// pRun
// ──────────────────────────────────────────────────────────────────────

describe("pRun (portable .run)", () => {
  it("dispatches to sync .run() on SQLite-shape builders", async () => {
    const qb = sqliteBuilder([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const result = await pRun(qb);
    expect(result.changes).toBe(3);
    expect(result.lastInsertRowid).toBe(1);
  });

  it("normalises Postgres write result to { changes }", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = postgresBuilder([{}, {}, {}], { write: true });
    const result = await pRun(qb);
    expect(result.changes).toBe(3);
  });

  it("normalises Postgres write result to { changes: 1 } when no count/rowCount available", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = {
      then: (ok: any) => ok({ something: "else" }),
    };
    const result = await pRun(qb);
    expect(result.changes).toBe(1);
  });

  it("treats Postgres array result (RETURNING) as { changes: array.length }", async () => {
    driverSpy.mockReturnValue("postgres");
    const qb = {
      then: (ok: any) => ok([{ id: 1 }, { id: 2 }]),
    };
    const result = await pRun(qb);
    expect(result.changes).toBe(2);
  });

  it("handles a builder where .run() returns no metadata", async () => {
    const qb = { run: () => ({}) };
    const result = await pRun(qb as any);
    expect(result.changes).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Sync escape hatches
// ──────────────────────────────────────────────────────────────────────

describe("sync escape hatches (pAllSync/pGetSync/pRunSync)", () => {
  it("pAllSync passes through on SQLite-shape", () => {
    const qb = sqliteBuilder([{ a: 1 }]);
    expect(pAllSync(qb)).toEqual([{ a: 1 }]);
  });

  it("pAllSync throws on Postgres-shape (no .all method)", () => {
    const qb = postgresBuilder([{ a: 1 }]);
    expect(() => pAllSync(qb)).toThrow(/pAllSync.*Postgres/);
  });

  it("pGetSync passes through on SQLite-shape", () => {
    const qb = sqliteBuilder([{ a: 1 }]);
    expect(pGetSync(qb)).toEqual({ a: 1 });
  });

  it("pGetSync throws on Postgres-shape", () => {
    const qb = postgresBuilder([{ a: 1 }]);
    expect(() => pGetSync(qb)).toThrow(/pGetSync.*Postgres/);
  });

  it("pRunSync passes through on SQLite-shape", () => {
    const qb = sqliteBuilder([{ a: 1 }]);
    expect(pRunSync(qb).changes).toBe(1);
  });

  it("pRunSync throws on Postgres-shape", () => {
    const qb = postgresBuilder([{ a: 1 }]);
    expect(() => pRunSync(qb)).toThrow(/pRunSync.*Postgres/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Driver detection
// ──────────────────────────────────────────────────────────────────────

describe("isPostgres / isSqlite / getDriverCapabilities", () => {
  it("reports sqlite by default", () => {
    expect(isSqlite()).toBe(true);
    expect(isPostgres()).toBe(false);
  });

  it("reports postgres when getDbDriver mocked to postgres", () => {
    driverSpy.mockReturnValue("postgres");
    expect(isPostgres()).toBe(true);
    expect(isSqlite()).toBe(false);
  });

  it("capability matrix is consistent for sqlite", () => {
    const caps = getDriverCapabilities();
    expect(caps.driver).toBe("sqlite");
    expect(caps.supportsSync).toBe(true);
    expect(caps.supportsAll).toBe(true);
    expect(caps.supportsSyncTx).toBe(true);
    expect(caps.supportsAsyncTx).toBe(false);
  });

  it("capability matrix is consistent for postgres", () => {
    driverSpy.mockReturnValue("postgres");
    const caps = getDriverCapabilities();
    expect(caps.driver).toBe("postgres");
    expect(caps.supportsSync).toBe(false);
    expect(caps.supportsAll).toBe(false);
    expect(caps.supportsSyncTx).toBe(false);
    expect(caps.supportsAsyncTx).toBe(true);
  });
});
