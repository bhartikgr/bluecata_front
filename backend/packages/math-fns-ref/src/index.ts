/**
 * Sprint 14 D9 — Reference math fns.
 *
 * These intentionally use a SECOND implementation strategy (plain double
 * arithmetic, manual rounding) so the runtime reconcile is non-trivial — if
 * the two diverge we know one is wrong.
 *
 * Same shapes, same names as `@capavate/math-fns`.
 */
export interface TermSheetInput {
  preMoneyUsd: number; newMoneyUsd: number; esopTargetPct: number; preRoundFullyDilutedShares: number;
}
export interface TermSheetResult {
  postMoneyUsd: number; pricePerShare: number; newSharesIssued: number;
  newOwnershipPct: number; esopRefreshShares: number;
}
export function termSheet(i: TermSheetInput): TermSheetResult {
  const post = i.preMoneyUsd + i.newMoneyUsd;
  const investorPct = i.newMoneyUsd / post;
  const denom = 1 - investorPct - i.esopTargetPct;
  if (denom <= 0) throw new Error("infeasible_terms");
  const postFD = i.preRoundFullyDilutedShares / denom;
  const investorShares = postFD * investorPct;
  const esopShares = postFD * i.esopTargetPct;
  const pps = i.newMoneyUsd / investorShares;
  return {
    postMoneyUsd: post,
    pricePerShare: round6(pps),
    newSharesIssued: Math.round(investorShares),
    newOwnershipPct: round6(investorPct),
    esopRefreshShares: Math.round(esopShares),
  };
}

export interface ConversionInput {
  principalUsd: number; interestRatePct: number; monthsElapsed: number;
  valuationCapUsd?: number; discountPct?: number; roundPps: number; roundPreMoneyUsd: number;
}
export interface ConversionResult { conversionAmountUsd: number; effectivePps: number; sharesIssued: number; }
export function convertSafeOrNote(i: ConversionInput): ConversionResult {
  const interest = i.principalUsd * (i.interestRatePct / 100) * (i.monthsElapsed / 12);
  const total = i.principalUsd + interest;
  let eff = i.roundPps;
  if (i.valuationCapUsd && i.valuationCapUsd > 0) {
    const capPps = (i.valuationCapUsd / i.roundPreMoneyUsd) * i.roundPps;
    if (capPps < eff) eff = capPps;
  }
  if (i.discountPct && i.discountPct > 0) {
    const disc = i.roundPps * (1 - i.discountPct);
    if (disc < eff) eff = disc;
  }
  return {
    conversionAmountUsd: round2(total),
    effectivePps: round6(eff),
    sharesIssued: Math.round(total / eff),
  };
}

export interface ProRataInput { currentOwnershipPct: number; roundSizeUsd: number; proRataMultiplier?: number; }
export interface ProRataResult { allocationUsd: number; allocationPct: number; }
export function proRata(i: ProRataInput): ProRataResult {
  const m = i.proRataMultiplier ?? 1;
  const pct = i.currentOwnershipPct * m;
  return { allocationUsd: round2(i.roundSizeUsd * pct), allocationPct: round6(pct) };
}

export interface AntiDilutionInput {
  oldPps: number; newPps: number; oldShares: number;
  variant: "broad" | "narrow" | "ratchet"; commonOutstanding?: number; newMoneyUsd: number;
}
export interface AntiDilutionResult { adjustedPps: number; protectedShares: number; }
export function antiDilution(i: AntiDilutionInput): AntiDilutionResult {
  if (i.newPps >= i.oldPps) return { adjustedPps: i.oldPps, protectedShares: i.oldShares };
  if (i.variant === "ratchet") {
    return { adjustedPps: i.newPps, protectedShares: Math.round(i.oldShares * i.oldPps / i.newPps) };
  }
  const A = (i.commonOutstanding ?? i.oldShares) + (i.variant === "broad" ? i.oldShares : 0);
  const B = i.newMoneyUsd / i.oldPps;
  const C = i.newMoneyUsd / i.newPps;
  const adj = i.oldPps * (A + B) / (A + C);
  return { adjustedPps: round6(adj), protectedShares: Math.round(i.oldShares * i.oldPps / adj) };
}

export interface EsopRefreshInput {
  preFullyDilutedShares: number; preEsopShares: number; targetPostPct: number; newSharesNonEsop: number;
}
export interface EsopRefreshResult { topUpShares: number; postFullyDilutedShares: number; }
export function esopRefresh(i: EsopRefreshInput): EsopRefreshResult {
  const T = i.targetPostPct;
  const num = T * (i.preFullyDilutedShares + i.newSharesNonEsop) - i.preEsopShares;
  const denom = 1 - T;
  const X = Math.ceil(num / denom);
  const postFD = Math.ceil(i.preFullyDilutedShares + X + i.newSharesNonEsop);
  return { topUpShares: X, postFullyDilutedShares: postFD };
}

export interface CashFlow { tDays: number; amountUsd: number; }
export interface PortfolioInput { cashflows: CashFlow[]; navUsd: number; contributedUsd: number; }
export interface PortfolioResult { irr: number; moic: number; tvpi: number; dpi: number; }
export function portfolioMetrics(i: PortfolioInput): PortfolioResult {
  const distributions = i.cashflows.filter((c) => c.amountUsd > 0).reduce((s, c) => s + c.amountUsd, 0);
  const contributed = i.contributedUsd;
  const moic = contributed > 0 ? (distributions + i.navUsd) / contributed : 0;
  const dpi = contributed > 0 ? distributions / contributed : 0;
  const flows: CashFlow[] = [...i.cashflows];
  if (i.navUsd > 0) flows.push({ tDays: Math.max(...flows.map((f) => f.tDays), 0), amountUsd: i.navUsd });
  let r = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    let f = 0, fp = 0;
    for (const c of flows) {
      const t = c.tDays / 365;
      f += c.amountUsd / Math.pow(1 + r, t);
      fp += -t * c.amountUsd / Math.pow(1 + r, t + 1);
    }
    if (Math.abs(fp) < 1e-12) break;
    const next = r - f / fp;
    if (Math.abs(next - r) < 1e-9) { r = next; break; }
    r = next;
  }
  return { irr: round6(Number.isFinite(r) ? r : 0), moic: round6(moic), tvpi: round6(moic), dpi: round6(dpi) };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round6(n: number): number { return Math.round(n * 1e6) / 1e6; }
