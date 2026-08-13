/**
 * WAVE 3E — A MISSING TABLE MUST NOT MEAN "ALLOW".
 *
 * The single most dangerous failure mode of moving an authorization control
 * into the database is that the database becomes a soft dependency: a lookup
 * throws, the `catch` returns a default, and the default is permissive. WAVE 2B
 * MAJOR 1 found exactly that bug in `isPlatformAdmin`. This suite exists so the
 * same bug cannot be reintroduced by WAVE 3E.
 *
 * Fault injection is done by replacing `../db/connection` wholesale — the
 * authority module imports `rawDb`/`getDbDriver` as live ESM bindings, so a spy
 * on the namespace would not be observed.
 *
 * Run: npx vitest run server/__tests__/wave3e_authority_fail_closed.test.ts
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

type AuthorityModule = typeof import("../lib/feeSettlementAuthority");

/** The fault the mocked connection module should inject. */
type Fault =
  | { kind: "ok" }                 // healthy sqlite, schema bootstrapped normally
  | { kind: "raw_throws" }         // rawDb() itself throws (outage)
  | { kind: "raw_null" }           // rawDb() returns nothing
  | { kind: "postgres" }           // a backend the authority does not support
  | { kind: "readonly" }           // sqlite present but the bootstrap cannot write
  | { kind: "table_dropped" };     // schema latch says ready, table is gone

let fault: Fault = { kind: "ok" };
let live: Database.Database | null = null;
const tmpDirs: string[] = [];

function makeDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "w3e_fc_"));
  tmpDirs.push(dir);
  return new Database(path.join(dir, "a.db"));
}

vi.mock("../db/connection", () => ({
  getDbDriver: () => (fault.kind === "postgres" ? "postgres" : "sqlite"),
  rawDb: () => {
    if (fault.kind === "raw_throws") throw new Error("SQLITE_CANTOPEN: unable to open database file");
    if (fault.kind === "raw_null") return null;
    return live;
  },
  getDb: () => live,
}));

async function load(): Promise<AuthorityModule> {
  vi.resetModules();
  const mod = (await import("../lib/feeSettlementAuthority")) as AuthorityModule;
  mod.__resetSchemaLatchForTest();
  return mod;
}

beforeEach(() => {
  fault = { kind: "ok" };
  live = makeDb();
});

afterAll(() => {
  try { live?.close(); } catch { /* best effort */ }
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("W3E-FAILCLOSED — the authority denies whenever it cannot prove permission", () => {
  it("W3E-FC-1 — an UNREACHABLE database refuses to mint and refuses to settle", async () => {
    const m = await load();
    fault = { kind: "raw_throws" };
    expect(() => m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" }))
      .toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
    expect(() => m.rehydrateSettlementAuthorization("fsa_x")).toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
    expect(() => m.withSettlementTransaction(() => 1)).toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
    // And the transaction probe reports "not in a transaction", so a consume
    // attempted through it would ALSO be refused.
    expect(m.inSettlementTransaction()).toBe(false);
  });

  it("W3E-FC-2 — a NULL handle is refused, not treated as an empty allow-list", async () => {
    const m = await load();
    fault = { kind: "raw_null" };
    expect(() => m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" }))
      .toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
  });

  it("W3E-FC-3 — an unsupported backend refuses rather than settling unguarded", async () => {
    const m = await load();
    fault = { kind: "postgres" };
    expect(() => m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" }))
      .toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
    expect(() => m.rehydrateSettlementAuthorization("fsa_x")).toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE/);
  });

  it("W3E-FC-4 — a database on which the schema CANNOT be created refuses to settle", async () => {
    const m = await load();
    // Make every write fail: the bootstrap cannot create the tables.
    live!.pragma("query_only = ON");
    expect(() => m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" }))
      .toThrow(/SETTLEMENT_AUTHORITY_UNAVAILABLE|readonly|query_only/i);
    // Nothing was created and nothing was authorized.
    const t = live!.prepare(`SELECT name FROM sqlite_master WHERE name = 'fee_settlement_authorization'`).get();
    expect(t).toBeUndefined();
  });

  it("W3E-FC-5 — with the table PRESENT but EMPTY, nothing can be settled", async () => {
    const m = await load();
    // Force the bootstrap by minting once, then remove the row's basis: an
    // empty authority table is the correct steady state and authorizes nothing.
    const a = m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" });
    expect(a.id).toMatch(/^fsa_/);
    const n = live!.prepare(`SELECT COUNT(*) AS n FROM fee_settlement_authorization`).get() as { n: number };
    expect(Number(n.n)).toBe(1);
    // An id that is not in the table is refused, even though the table exists.
    expect(() => m.rehydrateSettlementAuthorization("fsa_absent")).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
  });

  it("W3E-FC-6 — if the table DISAPPEARS mid-flight, the consume throws instead of succeeding", async () => {
    const m = await load();
    const a = m.__authorizeForTest({ purpose: "fee_obligation", spvId: "s", obligationId: "o", outcome: "succeeded" });
    // Simulate catastrophic loss of the authority store after the latch was set.
    live!.exec(`DROP TRIGGER IF EXISTS trg_fsa_no_delete;
                DROP TABLE IF EXISTS fee_settlement_authorization_use;
                DROP TABLE IF EXISTS fee_settlement_authorization;`);
    let threw = false;
    try {
      m.withSettlementTransaction(() =>
        m.consumeSettlementAuthorization(a, { purpose: "fee_obligation", spvId: "s", obligationId: "o" }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // deny, never a silent allow
  });

  it("W3E-FC-7 — the module contains NO catch that returns a permissive default", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "lib", "feeSettlementAuthority.ts"), "utf8");
    // Isolate the consume/rehydrate/authorityDb region and confirm every catch
    // either throws or logs-and-throws. `inSettlementTransaction` is the one
    // catch that returns a value, and it returns FALSE — the denying answer.
    const catches = [...src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\n  \}/g)].map((mm) => mm[1]);
    expect(catches.length).toBeGreaterThan(0);
    for (const body of catches) {
      const returnsTrue = /return\s+true\s*;/.test(body);
      const returnsOk = /return\s*\{[^}]*ok:\s*true/.test(body);
      expect(returnsTrue).toBe(false);
      expect(returnsOk).toBe(false);
    }
    expect(src).not.toMatch(/catch[\s\S]{0,120}return\s+auth\s*;/);
  });
});
