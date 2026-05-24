/**
 * Sprint 14 D9 — Dual-engine reconcile gate.
 *
 * Each pair must reconcile across a basket of golden vectors.
 */
import { describe, it, expect } from "vitest";
import * as primary from "../src/index";
import * as ref from "@capavate/math-fns-ref";

const eps = 1e-5;
function close(a: number, b: number, e = eps) {
  if (a === 0 && b === 0) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale <= e;
}

describe("D9 termSheet — primary vs ref", () => {
  const cases: primary.TermSheetInput[] = [
    { preMoneyUsd: 8_000_000, newMoneyUsd: 2_000_000, esopTargetPct: 0.10, preRoundFullyDilutedShares: 8_000_000 },
    { preMoneyUsd: 25_000_000, newMoneyUsd: 5_000_000, esopTargetPct: 0.05, preRoundFullyDilutedShares: 12_500_000 },
    { preMoneyUsd: 2_000_000, newMoneyUsd: 500_000, esopTargetPct: 0.15, preRoundFullyDilutedShares: 5_000_000 },
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.termSheet(c);
    const r = ref.termSheet(c);
    expect(close(p.postMoneyUsd, r.postMoneyUsd)).toBe(true);
    expect(close(p.pricePerShare, r.pricePerShare)).toBe(true);
    expect(Math.abs(p.newSharesIssued - r.newSharesIssued) <= 2).toBe(true);
    expect(close(p.newOwnershipPct, r.newOwnershipPct)).toBe(true);
  });
});

describe("D9 convertSafeOrNote — primary vs ref", () => {
  const cases: primary.ConversionInput[] = [
    { principalUsd: 100_000, interestRatePct: 0, monthsElapsed: 0, valuationCapUsd: 5_000_000, discountPct: 0.20, roundPps: 1.0, roundPreMoneyUsd: 10_000_000 },
    { principalUsd: 250_000, interestRatePct: 8, monthsElapsed: 18, valuationCapUsd: 8_000_000, discountPct: 0.20, roundPps: 1.5, roundPreMoneyUsd: 20_000_000 },
    { principalUsd: 50_000, interestRatePct: 0, monthsElapsed: 0, discountPct: 0.20, roundPps: 2.0, roundPreMoneyUsd: 15_000_000 },
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.convertSafeOrNote(c);
    const r = ref.convertSafeOrNote(c);
    expect(close(p.conversionAmountUsd, r.conversionAmountUsd)).toBe(true);
    expect(close(p.effectivePps, r.effectivePps)).toBe(true);
    expect(Math.abs(p.sharesIssued - r.sharesIssued) <= 2).toBe(true);
  });
});

describe("D9 proRata — primary vs ref", () => {
  const cases: primary.ProRataInput[] = [
    { currentOwnershipPct: 0.05, roundSizeUsd: 5_000_000 },
    { currentOwnershipPct: 0.12, roundSizeUsd: 10_000_000, proRataMultiplier: 1.5 },
    { currentOwnershipPct: 0.01, roundSizeUsd: 25_000_000 },
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.proRata(c);
    const r = ref.proRata(c);
    expect(close(p.allocationUsd, r.allocationUsd)).toBe(true);
    expect(close(p.allocationPct, r.allocationPct)).toBe(true);
  });
});

describe("D9 antiDilution — primary vs ref", () => {
  const cases: primary.AntiDilutionInput[] = [
    { oldPps: 2.0, newPps: 1.0, oldShares: 1_000_000, variant: "broad", commonOutstanding: 5_000_000, newMoneyUsd: 1_000_000 },
    { oldPps: 1.5, newPps: 0.75, oldShares: 500_000, variant: "narrow", commonOutstanding: 3_000_000, newMoneyUsd: 750_000 },
    { oldPps: 3.0, newPps: 1.5, oldShares: 200_000, variant: "ratchet", newMoneyUsd: 1_500_000 },
    { oldPps: 1.0, newPps: 1.5, oldShares: 100_000, variant: "broad", commonOutstanding: 1_000_000, newMoneyUsd: 500_000 }, // up round
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.antiDilution(c);
    const r = ref.antiDilution(c);
    expect(close(p.adjustedPps, r.adjustedPps)).toBe(true);
    expect(Math.abs(p.protectedShares - r.protectedShares) <= 2).toBe(true);
  });
});

describe("D9 esopRefresh — primary vs ref", () => {
  const cases: primary.EsopRefreshInput[] = [
    { preFullyDilutedShares: 8_000_000, preEsopShares: 800_000, targetPostPct: 0.15, newSharesNonEsop: 1_000_000 },
    { preFullyDilutedShares: 12_500_000, preEsopShares: 1_500_000, targetPostPct: 0.10, newSharesNonEsop: 2_000_000 },
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.esopRefresh(c);
    const r = ref.esopRefresh(c);
    expect(Math.abs(p.topUpShares - r.topUpShares) <= 2).toBe(true);
    expect(Math.abs(p.postFullyDilutedShares - r.postFullyDilutedShares) <= 5).toBe(true);
  });
});

describe("D9 portfolioMetrics — primary vs ref", () => {
  const cases: primary.PortfolioInput[] = [
    { cashflows: [{ tDays: 0, amountUsd: -1_000_000 }, { tDays: 730, amountUsd: 500_000 }], navUsd: 1_500_000, contributedUsd: 1_000_000 },
    { cashflows: [{ tDays: 0, amountUsd: -500_000 }, { tDays: 1095, amountUsd: 2_000_000 }], navUsd: 0, contributedUsd: 500_000 },
    { cashflows: [{ tDays: 0, amountUsd: -250_000 }], navUsd: 350_000, contributedUsd: 250_000 },
  ];
  it.each(cases)("matches on case", (c) => {
    const p = primary.portfolioMetrics(c);
    const r = ref.portfolioMetrics(c);
    expect(close(p.moic, r.moic, 1e-4)).toBe(true);
    expect(close(p.dpi, r.dpi, 1e-4)).toBe(true);
    expect(close(p.tvpi, r.tvpi, 1e-4)).toBe(true);
    expect(close(p.irr, r.irr, 1e-3)).toBe(true);
  });
});

describe("D9 reconcileEqual helper", () => {
  it("matches simple objects within epsilon", () => {
    const r = primary.reconcileEqual({ a: 1.000001, b: 2 }, { a: 1.000002, b: 2 });
    expect(r.match).toBe(true);
  });
  it("flags divergence", () => {
    const r = primary.reconcileEqual({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(r.match).toBe(false);
  });
});
