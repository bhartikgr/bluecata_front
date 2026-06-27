/**
 * Sprint 14 D9 — Primary math fns (Decimal.js based).
 *
 * Each function is paired with a reference implementation in
 * `@capavate/math-fns-ref` and reconciled at runtime via `reconcile()`.
 *
 * Six pairs in this sprint:
 *   - termSheet:      compute pre/post money dilution from terms
 *   - conversion:     SAFE/Note → Preferred conversion math
 *   - proRata:        compute pro-rata allocation
 *   - antiDilution:   weighted-average / full-ratchet (broad/narrow)
 *   - esopRefresh:    pool top-up to target post-round %
 *   - portfolioIRR:   IRR / MOIC / TVPI / DPI given cashflows
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/* ===== TERM SHEET ===== */
export interface TermSheetInput {
  preMoneyUsd: number;
  newMoneyUsd: number;
  esopTargetPct: number; // e.g. 0.10
  preRoundFullyDilutedShares: number;
}
export interface TermSheetResult {
  postMoneyUsd: number;
  pricePerShare: number;
  newSharesIssued: number;
  newOwnershipPct: number;
  esopRefreshShares: number;
}

export function termSheet(input: TermSheetInput): TermSheetResult {
  const pre = new Decimal(input.preMoneyUsd);
  const newMoney = new Decimal(input.newMoneyUsd);
  const post = pre.plus(newMoney);
  const esopTarget = new Decimal(input.esopTargetPct);
  const preShares = new Decimal(input.preRoundFullyDilutedShares);

  // Investor ownership = newMoney / postMoney
  const investorPct = newMoney.div(post);

  // ESOP top-up: target_pool_pct of POST-round fully diluted, allocated PRE-money
  // pre-money fully diluted = preShares + esopTopUp + investorShares is recursive;
  // we solve: esopShares = (esopTarget * postFD) - existing_esop (assume 0 for top-up math)
  // With investor share = investorPct * postFD:
  //   postFD = preShares + esopShares + investorShares
  //   investorShares = investorPct * postFD
  //   esopShares = esopTarget * postFD
  //   ⇒ preShares = postFD * (1 - investorPct - esopTarget)
  //   ⇒ postFD = preShares / (1 - investorPct - esopTarget)
  const denom = new Decimal(1).minus(investorPct).minus(esopTarget);
  if (denom.lte(0)) throw new Error("infeasible_terms");
  const postFD = preShares.div(denom);
  const investorShares = postFD.mul(investorPct);
  const esopShares = postFD.mul(esopTarget);
  const pps = newMoney.div(investorShares);

  return {
    postMoneyUsd: post.toNumber(),
    pricePerShare: pps.toDecimalPlaces(6).toNumber(),
    newSharesIssued: investorShares.toDecimalPlaces(0).toNumber(),
    newOwnershipPct: investorPct.toDecimalPlaces(6).toNumber(),
    esopRefreshShares: esopShares.toDecimalPlaces(0).toNumber(),
  };
}

/* ===== CONVERSION (SAFE/Note → Preferred) ===== */
export interface ConversionInput {
  principalUsd: number;
  /** APR on note (0 for SAFE). */
  interestRatePct: number;
  /** Months elapsed (used only for note interest). */
  monthsElapsed: number;
  /** Cap (post-money for YC SAFE). */
  valuationCapUsd?: number;
  /** Discount, e.g. 0.20. */
  discountPct?: number;
  /** Round price per share. */
  roundPps: number;
  /** Round pre-money. */
  roundPreMoneyUsd: number;
}
export interface ConversionResult {
  conversionAmountUsd: number;
  effectivePps: number;
  sharesIssued: number;
}
export function convertSafeOrNote(input: ConversionInput): ConversionResult {
  const P = new Decimal(input.principalUsd);
  const r = new Decimal(input.interestRatePct).div(100);
  const t = new Decimal(input.monthsElapsed).div(12);
  const interest = P.mul(r).mul(t);
  const total = P.plus(interest);
  // Effective pps = min(roundPps, capPps, discountPps)
  const candidates: Decimal[] = [new Decimal(input.roundPps)];
  if (input.valuationCapUsd && input.valuationCapUsd > 0) {
    // capPps = cap / preMoney * roundPps (approx; treats cap as "pre-money cap")
    const capPps = new Decimal(input.valuationCapUsd).div(input.roundPreMoneyUsd).mul(input.roundPps);
    candidates.push(capPps);
  }
  if (input.discountPct && input.discountPct > 0) {
    const discPps = new Decimal(input.roundPps).mul(new Decimal(1).minus(input.discountPct));
    candidates.push(discPps);
  }
  const eff = candidates.reduce((a, b) => (a.lt(b) ? a : b));
  const shares = total.div(eff);
  return {
    conversionAmountUsd: total.toDecimalPlaces(2).toNumber(),
    effectivePps: eff.toDecimalPlaces(6).toNumber(),
    sharesIssued: shares.toDecimalPlaces(0).toNumber(),
  };
}

/* ===== PRO-RATA ===== */
export interface ProRataInput {
  currentOwnershipPct: number;
  roundSizeUsd: number;
  /** Cap on pro-rata as multiplier of ownership (e.g. 1.0 = exact pro-rata, 2.0 = super-pro-rata cap). */
  proRataMultiplier?: number;
}
export interface ProRataResult { allocationUsd: number; allocationPct: number; }
export function proRata(input: ProRataInput): ProRataResult {
  const own = new Decimal(input.currentOwnershipPct);
  const mult = new Decimal(input.proRataMultiplier ?? 1);
  const allocPct = own.mul(mult);
  const allocUsd = new Decimal(input.roundSizeUsd).mul(allocPct);
  return {
    allocationUsd: allocUsd.toDecimalPlaces(2).toNumber(),
    allocationPct: allocPct.toDecimalPlaces(6).toNumber(),
  };
}

/* ===== ANTI-DILUTION ===== */
export interface AntiDilutionInput {
  oldPps: number;
  newPps: number;
  oldShares: number;
  /** "broad" = WA broad-based, "narrow" = WA narrow-based, "ratchet" = full ratchet. */
  variant: "broad" | "narrow" | "ratchet";
  /** Common+option pool outstanding (broad uses; narrow excludes options). */
  commonOutstanding?: number;
  newMoneyUsd: number;
}
export interface AntiDilutionResult { adjustedPps: number; protectedShares: number; }
export function antiDilution(input: AntiDilutionInput): AntiDilutionResult {
  const oldPps = new Decimal(input.oldPps);
  const newPps = new Decimal(input.newPps);
  if (newPps.gte(oldPps)) {
    return { adjustedPps: oldPps.toNumber(), protectedShares: input.oldShares };
  }
  if (input.variant === "ratchet") {
    return { adjustedPps: newPps.toNumber(), protectedShares: new Decimal(input.oldShares).mul(oldPps).div(newPps).toDecimalPlaces(0).toNumber() };
  }
  // Weighted average: NCP = OCP * ((A + B) / (A + C))
  // A = outstanding before issuance, B = newMoney/oldPps, C = newShares actually issued
  const oldShares = new Decimal(input.oldShares);
  const A = new Decimal(input.commonOutstanding ?? input.oldShares).plus(input.variant === "broad" ? oldShares : 0);
  const B = new Decimal(input.newMoneyUsd).div(oldPps);
  const newSharesIssued = new Decimal(input.newMoneyUsd).div(newPps);
  const C = newSharesIssued;
  const adjusted = oldPps.mul(A.plus(B)).div(A.plus(C));
  return {
    adjustedPps: adjusted.toDecimalPlaces(6).toNumber(),
    protectedShares: oldShares.mul(oldPps).div(adjusted).toDecimalPlaces(0).toNumber(),
  };
}

/* ===== ESOP REFRESH ===== */
export interface EsopRefreshInput {
  preFullyDilutedShares: number;
  preEsopShares: number;
  targetPostPct: number;
  newSharesNonEsop: number;
}
export interface EsopRefreshResult { topUpShares: number; postFullyDilutedShares: number; }
export function esopRefresh(input: EsopRefreshInput): EsopRefreshResult {
  // postFD = preFD + topUp + newSharesNonEsop
  // (preEsop + topUp) / postFD = targetPostPct
  // ⇒ preEsop + topUp = targetPostPct * (preFD + topUp + newSharesNonEsop)
  // Let X = topUp.
  // preEsop + X = T * (preFD + X + new)
  // X * (1 - T) = T * (preFD + new) - preEsop
  // X = (T * (preFD + new) - preEsop) / (1 - T)
  const T = new Decimal(input.targetPostPct);
  const num = T.mul(new Decimal(input.preFullyDilutedShares).plus(input.newSharesNonEsop)).minus(input.preEsopShares);
  const denom = new Decimal(1).minus(T);
  const X = num.div(denom);
  const postFD = new Decimal(input.preFullyDilutedShares).plus(X).plus(input.newSharesNonEsop);
  return {
    topUpShares: X.toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber(),
    postFullyDilutedShares: postFD.toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber(),
  };
}

/* ===== PORTFOLIO IRR / MOIC / TVPI / DPI ===== */
export interface CashFlow { tDays: number; amountUsd: number; }
export interface PortfolioInput {
  cashflows: CashFlow[];   // negative = invested, positive = distribution
  navUsd: number;          // current unrealized value
  contributedUsd: number;  // total invested
}
export interface PortfolioResult { irr: number; moic: number; tvpi: number; dpi: number; }

export function portfolioMetrics(input: PortfolioInput): PortfolioResult {
  // MOIC = (distributions + nav) / contributed
  const distributions = input.cashflows.filter((c) => c.amountUsd > 0).reduce((a, c) => a.plus(c.amountUsd), new Decimal(0));
  const contributed = new Decimal(input.contributedUsd);
  const nav = new Decimal(input.navUsd);
  const moic = contributed.gt(0) ? distributions.plus(nav).div(contributed) : new Decimal(0);
  const tvpi = moic; // same as MOIC for partnership lens
  const dpi = contributed.gt(0) ? distributions.div(contributed) : new Decimal(0);
  // IRR via Newton iteration on XIRR-style equation
  const flows = [...input.cashflows];
  if (input.navUsd > 0) flows.push({ tDays: Math.max(...flows.map((f) => f.tDays), 0), amountUsd: input.navUsd });
  const irr = newtonXirr(flows);
  return {
    irr: Number.isFinite(irr) ? Number(new Decimal(irr).toDecimalPlaces(6).toNumber()) : 0,
    moic: moic.toDecimalPlaces(6).toNumber(),
    tvpi: tvpi.toDecimalPlaces(6).toNumber(),
    dpi: dpi.toDecimalPlaces(6).toNumber(),
  };
}

function newtonXirr(flows: CashFlow[]): number {
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
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }
  return r;
}

/* ===== RECONCILE ===== */
export interface ReconcileResult<T> { match: boolean; primary: T; ref: T; diff?: string; }
export function reconcileEqual<T>(primary: T, ref: T, epsilon = 1e-6): ReconcileResult<T> {
  const matches = (a: unknown, b: unknown): boolean => {
    if (typeof a === "number" && typeof b === "number") {
      const diff = Math.abs(a - b);
      const scale = Math.max(1, Math.abs(a), Math.abs(b));
      return diff / scale <= epsilon;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ak = Object.keys(a as Record<string, unknown>);
      const bk = Object.keys(b as Record<string, unknown>);
      if (ak.length !== bk.length) return false;
      return ak.every((k) => matches((a as any)[k], (b as any)[k]));
    }
    return a === b;
  };
  const ok = matches(primary, ref);
  return ok ? { match: true, primary, ref } : { match: false, primary, ref, diff: "values differ beyond epsilon" };
}
