/**
 * Reconciliation tests — primary engine vs. reference engine.
 *
 * Both engines must agree on every published worked example. When they agree,
 * `status === "match"` and `diffs.length === 0`. When they disagree, the diff
 * tells us exactly which holder/instrument the discrepancy is on.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/reconcile/reconcile.js";
import { referenceComputeCapTable } from "../../../cap-table-engine-ref/src/refCapTable.js";
import type { Holder, Security, PricedRound } from "../../src/types.js";

const FOUNDER: Security = {
  id: "f1", holderId: "founder1", kind: "common", series: "Common",
  shares: 8000000n,
};

const SAFE_INV: Security = {
  id: "safe1", holderId: "yc-safe", kind: "safe",
  investmentAmount: "1000000", currency: "USD",
  safe: { type: "post_money_cap", cap: "10000000" },
};

const HOLDERS: Holder[] = [
  { id: "founder1", name: "Avi", type: "founder" },
  { id: "yc-safe", name: "YC SAFE", type: "investor" },
  { id: "investors-A", name: "Series A Investors", type: "investor" },
  { id: "pool", name: "ESOP Pool", type: "pool" },
];

describe("reconcile — primary vs reference", () => {
  it("simple founder issue — match", () => {
    const result = reconcile(
      {
        companyId: "c1",
        asOf: "2026-01-01",
        view: "fully_diluted",
        formulaRegion: "US",
        holders: HOLDERS,
        transactions: [{ type: "issue", security: FOUNDER, date: "2026-01-01" }],
      },
      referenceComputeCapTable,
    );
    expect(result.status).toBe("match");
    expect(result.diffs).toHaveLength(0);
    expect(result.primaryHash).toBe(result.referenceHash);
  });

  it("SAFE conversion at priced round — match", () => {
    const round: PricedRound = {
      id: "A", series: "Series A",
      preMoneyValuation: "9000000", investmentAmount: "3000000",
      pricePerShare: "1.00", currency: "USD",
      liquidationPreferenceMultiple: 1, participating: false,
      antiDilution: "broad_based",
    };
    const result = reconcile(
      {
        companyId: "c2",
        asOf: "2026-12-31",
        view: "fully_diluted",
        formulaRegion: "US",
        holders: HOLDERS,
        transactions: [
          { type: "issue", security: FOUNDER, date: "2026-01-01" },
          { type: "issue", security: SAFE_INV, date: "2026-02-01" },
          { type: "issue_preferred_round", round, date: "2026-06-01" },
        ],
      },
      referenceComputeCapTable,
    );
    expect(result.status).toBe("match");
    expect(result.diffs).toHaveLength(0);
    expect(result.primaryTotal).toBe(result.referenceTotal);
    expect(result.primaryHash).toBe(result.referenceHash);
  });

  it("Performance: 5-holder cap table reconciles in under 500ms", () => {
    const holders: Holder[] = Array.from({ length: 5 }, (_, i) => ({
      id: `h${i}`, name: `Holder ${i}`, type: i === 0 ? "founder" : "investor",
    }));
    const txs = holders.map((h, i) => ({
      type: "issue" as const,
      security: {
        id: `s${i}`, holderId: h.id, kind: "common" as const,
        series: "Common", shares: 1000000n,
      },
      date: "2026-01-01",
    }));
    const t0 = Date.now();
    const result = reconcile(
      {
        companyId: "perf",
        asOf: "2026-01-02",
        view: "fully_diluted",
        formulaRegion: "US",
        holders,
        transactions: txs,
      },
      referenceComputeCapTable,
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
    expect(result.status).toBe("match");
  });

  it("Divergence detected when reference engine returns wrong answer (sentinel)", () => {
    // Inject a buggy reference function that randomly subtracts shares from one row
    const buggy = (opts: any) => {
      const r = referenceComputeCapTable(opts);
      const rows = r.rows.map((row: any, i: number) =>
        i === 0 ? { ...row, shares: row.shares - 1n } : row,
      );
      return { ...r, rows, totalShares: r.totalShares - 1n };
    };
    const result = reconcile(
      {
        companyId: "c3",
        asOf: "2026-01-02",
        view: "fully_diluted",
        formulaRegion: "US",
        holders: HOLDERS,
        transactions: [{ type: "issue", security: FOUNDER, date: "2026-01-01" }],
      },
      buggy,
    );
    expect(result.status).toBe("divergence");
    expect(result.diffs.length).toBeGreaterThan(0);
    expect(result.primaryHash).not.toBe(result.referenceHash);
  });
});
