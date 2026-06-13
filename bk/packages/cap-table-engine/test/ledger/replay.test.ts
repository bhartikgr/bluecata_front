/**
 * Ledger replay tests.
 *
 * Each scenario is built two ways:
 *   1. Direct: feed transactions to `computeCapTable`.
 *   2. Replay: append ledger entries, then `reconstructCapTable` walks the chain.
 * The two cap tables must be identical, share-for-share.
 *
 * Reference: NVCA Model Stock Purchase Agreement §3 (issuance / conversion).
 */
import { describe, it, expect } from "vitest";
import { appendTransaction, emptyLedger, reconstructCapTable } from "../../src/ledger/ledger.js";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Holder, Transaction, Security, PricedRound } from "../../src/types.js";

function makeHolders(): Holder[] {
  return [
    { id: "founder1", name: "Avi", type: "founder" },
    { id: "investor-yc", name: "YC SAFE Investor", type: "investor" },
    { id: "investor-seriesA", name: "Lead Series A", type: "investor" },
    { id: "investors-roundA", name: "Round A Investors", type: "investor" },
    { id: "warrant1", name: "Warrant Holder", type: "investor" },
    { id: "pool", name: "ESOP Pool", type: "pool" },
  ];
}

const FOUNDER_COMMON: Security = {
  id: "sec-founder",
  holderId: "founder1",
  kind: "common",
  series: "Common",
  shares: 8000000n,
  pricePerShare: "0.0001",
};

const SAFE_SEC: Security = {
  id: "sec-safe-1",
  holderId: "investor-yc",
  kind: "safe",
  investmentAmount: "1000000",
  currency: "USD",
  safe: { type: "post_money_cap", cap: "10000000" },
};

const WARRANT_SEC: Security = {
  id: "sec-warrant-1",
  holderId: "warrant1",
  kind: "warrant",
  warrant: {
    underlyingShares: 100000n,
    strikePrice: "0.10",
    expiry: "2030-01-01",
    cashless: false,
  },
};

const ROUND_A: PricedRound = {
  id: "round-A",
  series: "Series A",
  preMoneyValuation: "9000000",
  investmentAmount: "3000000",
  pricePerShare: "1.00",
  currency: "USD",
  liquidationPreferenceMultiple: 1,
  participating: false,
  antiDilution: "broad_based",
};

describe("ledger replay — issue + SAFE conversion + warrant exercise", () => {
  it("matches direct compute share-for-share", () => {
    const holders = makeHolders();
    const txs: Transaction[] = [
      { type: "issue", security: FOUNDER_COMMON, date: "2026-01-01" },
      { type: "issue", security: SAFE_SEC, date: "2026-02-01" },
      { type: "issue", security: WARRANT_SEC, date: "2026-03-01" },
      { type: "issue_preferred_round", round: ROUND_A, date: "2026-06-01" },
      { type: "exercise_warrant", securityId: "sec-warrant-1", date: "2026-09-01", cashless: false },
    ];

    const direct = computeCapTable({
      companyId: "cmp-1",
      asOf: "2026-12-31",
      view: "fully_diluted",
      formulaRegion: "US",
      holders,
      transactions: txs,
    });

    let ledger = emptyLedger();
    const baseEntry = {
      companyId: "cmp-1",
      actorId: "founder1",
      actorRole: "founder" as const,
      idempotencyKey: "",
      ipAddress: "127.0.0.1",
      location: { country: "US" },
    };
    ledger = appendTransaction(ledger, {
      ...baseEntry, id: "e-1", type: "issue", instrumentRef: FOUNDER_COMMON.id,
      timestamp: "2026-01-01T00:00:00Z",
      idempotencyKey: "issue-founder",
      payload: { type: "issue", data: { security: FOUNDER_COMMON } },
    });
    ledger = appendTransaction(ledger, {
      ...baseEntry, id: "e-2", type: "issue", instrumentRef: SAFE_SEC.id,
      timestamp: "2026-02-01T00:00:00Z", idempotencyKey: "issue-safe",
      payload: { type: "issue", data: { security: SAFE_SEC } },
    });
    ledger = appendTransaction(ledger, {
      ...baseEntry, id: "e-3", type: "issue", instrumentRef: WARRANT_SEC.id,
      timestamp: "2026-03-01T00:00:00Z", idempotencyKey: "issue-warrant",
      payload: { type: "issue", data: { security: WARRANT_SEC } },
    });
    ledger = appendTransaction(ledger, {
      ...baseEntry, id: "e-4", type: "issue_round", instrumentRef: null,
      timestamp: "2026-06-01T00:00:00Z", idempotencyKey: "round-a-close",
      payload: { type: "issue_round", data: { round: ROUND_A } },
    });
    ledger = appendTransaction(ledger, {
      ...baseEntry, id: "e-5", type: "exercise", instrumentRef: WARRANT_SEC.id,
      timestamp: "2026-09-01T00:00:00Z", idempotencyKey: "exercise-warrant",
      payload: { type: "exercise", data: { securityId: WARRANT_SEC.id, kind: "warrant", cashless: false } },
    });

    const replayed = reconstructCapTable({
      companyId: "cmp-1",
      ledger,
      holders,
      view: "fully_diluted",
      region: "US",
      asOf: "2026-12-31T00:00:00Z",
    });

    expect(replayed.totalShares).toBe(direct.totalShares);
    expect(replayed.rows.length).toBe(direct.rows.length);
    // Compare share counts per holder
    const directByHolder = new Map(direct.rows.map((r) => [`${r.holderId}/${r.kind}/${r.series ?? ""}`, r.shares]));
    for (const r of replayed.rows) {
      const k = `${r.holderId}/${r.kind}/${r.series ?? ""}`;
      expect(directByHolder.get(k)).toBe(r.shares);
    }
  });
});

describe("ledger replay — deterministic and side-effect-free", () => {
  it("two replays of the same ledger produce identical results", () => {
    const holders = makeHolders();
    let ledger = emptyLedger();
    ledger = appendTransaction(ledger, {
      id: "x-1", companyId: "cmp-2", type: "issue", instrumentRef: FOUNDER_COMMON.id,
      timestamp: "2026-01-01T00:00:00Z", actorId: "f1", actorRole: "founder",
      idempotencyKey: "k1", payload: { type: "issue", data: { security: FOUNDER_COMMON } },
    });
    ledger = appendTransaction(ledger, {
      id: "x-2", companyId: "cmp-2", type: "issue_round", instrumentRef: null,
      timestamp: "2026-06-01T00:00:00Z", actorId: "f1", actorRole: "founder",
      idempotencyKey: "k2", payload: { type: "issue_round", data: { round: ROUND_A } },
    });
    const r1 = reconstructCapTable({ companyId: "cmp-2", ledger, holders, view: "fully_diluted", region: "US", asOf: "2027-01-01T00:00:00Z" });
    const r2 = reconstructCapTable({ companyId: "cmp-2", ledger, holders, view: "fully_diluted", region: "US", asOf: "2027-01-01T00:00:00Z" });
    expect(r1.totalShares).toBe(r2.totalShares);
    expect(r1.rows.length).toBe(r2.rows.length);
    for (let i = 0; i < r1.rows.length; i++) {
      expect(r1.rows[i].shares).toBe(r2.rows[i].shares);
      expect(r1.rows[i].ownershipPercent).toBe(r2.rows[i].ownershipPercent);
    }
  });
});

describe("ledger replay — asOf truncation", () => {
  it("replays only entries at-or-before asOf", () => {
    const holders = makeHolders();
    let ledger = emptyLedger();
    ledger = appendTransaction(ledger, {
      id: "t-1", companyId: "cmp-3", type: "issue", instrumentRef: FOUNDER_COMMON.id,
      timestamp: "2026-01-01T00:00:00Z", actorId: "f1", actorRole: "founder",
      idempotencyKey: "k1", payload: { type: "issue", data: { security: FOUNDER_COMMON } },
    });
    ledger = appendTransaction(ledger, {
      id: "t-2", companyId: "cmp-3", type: "issue_round", instrumentRef: null,
      timestamp: "2027-06-01T00:00:00Z", actorId: "f1", actorRole: "founder",
      idempotencyKey: "k2", payload: { type: "issue_round", data: { round: ROUND_A } },
    });

    const beforeRound = reconstructCapTable({
      companyId: "cmp-3", ledger, holders, view: "fully_diluted", region: "US",
      asOf: "2026-06-01T00:00:00Z",
    });
    const afterRound = reconstructCapTable({
      companyId: "cmp-3", ledger, holders, view: "fully_diluted", region: "US",
      asOf: "2028-01-01T00:00:00Z",
    });

    // Before the round there are only founder shares; after there are more.
    expect(beforeRound.totalShares).toBe(8000000n);
    expect(afterRound.totalShares).toBeGreaterThan(beforeRound.totalShares);
  });
});
