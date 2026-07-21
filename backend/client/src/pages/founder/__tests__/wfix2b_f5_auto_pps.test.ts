/**
 * W-FIX2b F5 — investor-grade auto-PPS in the priced-round wizard.
 *
 * Standard: PPS = pre-money ÷ fully-diluted PRE-MONEY shares INCLUDING the
 * option-pool top-up ("pool shuffle"). A pre-money pool of p% grosses the FD
 * denominator up to existingFD / (1 − p), which LOWERS the price per share
 * (founders absorb the pool). Override stays available; with no pool it reduces
 * to pre-money ÷ shares.
 *
 * The wizard math is inline in RoundNew.tsx, so (per this tree's client-test
 * convention) we (a) re-derive the exact formula here and lock its numeric
 * behavior + cap-table reconciliation, and (b) assert the source wires the
 * pool-inclusive denominator + educational formula.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mirror of RoundNew's derived denominator + PPS. */
function fdPreMoneyShares(existingFD: number, poolPct: number): number {
  if (!(existingFD > 0)) return 0;
  const p = poolPct > 0 && poolPct < 100 ? poolPct / 100 : 0;
  return p > 0 ? existingFD / (1 - p) : existingFD;
}
function pps(preMoney: number, existingFD: number, poolPct: number): number {
  const fd = fdPreMoneyShares(existingFD, poolPct);
  if (!(preMoney > 0) || !(fd > 0)) return NaN;
  return preMoney / fd;
}

describe("W-FIX2b F5 — pool-inclusive PPS math", () => {
  it("no pool: PPS = pre-money ÷ FD shares", () => {
    // $8,000,000 pre / 10,000,000 FD = $0.80
    expect(pps(8_000_000, 10_000_000, 0)).toBeCloseTo(0.8, 6);
  });

  it("pre-money pool lowers PPS (pool shuffle)", () => {
    // 20% pre-money pool → FD grosses to 10,000,000 / 0.8 = 12,500,000
    expect(fdPreMoneyShares(10_000_000, 20)).toBeCloseTo(12_500_000, 3);
    // PPS = 8,000,000 / 12,500,000 = $0.64 (below the $0.80 no-pool price)
    expect(pps(8_000_000, 10_000_000, 20)).toBeCloseTo(0.64, 6);
    expect(pps(8_000_000, 10_000_000, 20)).toBeLessThan(pps(8_000_000, 10_000_000, 0));
  });

  it("reconciles with the cap table: new-investor shares = investment ÷ PPS", () => {
    const price = pps(8_000_000, 10_000_000, 20); // 0.64
    const investment = 2_000_000;
    const newShares = investment / price; // 3,125,000
    expect(newShares).toBeCloseTo(3_125_000, 0);
    // post-money FD total = FD_pre (incl pool) + new shares
    const postFD = fdPreMoneyShares(10_000_000, 20) + newShares; // 15,625,000
    const ownership = newShares / postFD; // = investment / (pre + investment) = 2M/10M = 20%
    expect(ownership).toBeCloseTo(0.2, 6);
  });

  it("ignores an out-of-range pool pct (guards div-by-zero / negative)", () => {
    expect(fdPreMoneyShares(10_000_000, 100)).toBeCloseTo(10_000_000, 3);
    expect(fdPreMoneyShares(10_000_000, -5)).toBeCloseTo(10_000_000, 3);
  });
});

describe("W-FIX2b F5 — source wiring", () => {
  const src = readFileSync(resolve(__dirname, "..", "RoundNew.tsx"), "utf8");
  it("derives PPS from the pool-inclusive FD denominator", () => {
    expect(src).toContain("fdPreMoneyShares");
    expect(src).toContain("poolTopUpPct");
    expect(src).toContain("shares / (1 - poolTopUpPct)");
    expect(src).toContain("pre / fdPreMoneyShares");
  });
  it("surfaces the pool-inclusive formula inline (educational)", () => {
    expect(src).toContain('data-testid="pps-formula"');
    expect(src).toContain("incl. option-pool top-up");
  });
  it("keeps the manual override affordance", () => {
    expect(src).toContain("pricePerShareOverridden");
    expect(src).toContain('data-testid="btn-pps-override"');
  });
});
