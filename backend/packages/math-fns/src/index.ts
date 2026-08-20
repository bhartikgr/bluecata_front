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

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 81 · ITEM 1 (D3) — WHY THIS GLOBAL `Decimal.set` STAYS, MEASURED.
   ═══════════════════════════════════════════════════════════════════════════
   THIS LINE IS NOT UNTOUCHED BY ACCIDENT, AND IT IS NOT ENDORSED EITHER.

   The defect Wave 81 fixed was that TWO modules mutated this one shared
   decimal.js constructor and the cap-table engine's rounding therefore depended
   on which loaded last. `packages/cap-table-engine/src/primitives/bigDecimal.ts`
   now constructs through its OWN `Decimal.clone({ 38, ROUND_HALF_EVEN })`, so
   the engine is immune to this line and this line is immune to the engine.

   THE OBVIOUS SECOND HALF — give this package a clone too and delete this
   `set` — WAS MEASURED AND IS NOT SAFE THIS WAVE. Eight modules construct off
   the BARE global constructor and inherit whatever this line leaves behind:

       server/captableCommitStore.ts        ← SACRED (manifest row 1); not editable
       server/routes.ts
       server/track1Routes.ts
       shared/roundMathEngineAdapter.ts
       server/lib/founderOwnershipEngine.ts
       server/lib/warrantExercise.ts
       server/paymentStore.ts
       packages/math-fns/src/ilpa.ts

   Remove this line and, in any process that does not otherwise configure
   decimal.js, all eight fall back to decimal.js's DEFAULT precision 20. That is
   not a no-op:

       server/track1Routes.ts:657 sums the engine's exact payout strings —
         precision 40 -> 50000000            (legs reconcile to the exit)
         precision 20 -> 50000000.000000000001

       server/routes.ts:6952 derives an exact PPS x shares product —
         precision 40 -> 15241578.751714595060205
         precision 20 -> 15241578.75171459506      (truncated)

   The first of those is the R72 "money as exact decimal text" reconciliation the
   QA document publishes. A sacred file is among the consumers, so the honest
   fix — every consumer owning its own configuration — cannot be completed in
   this wave. Recorded as an OPEN ITEM rather than half-done:
   `build_log/wave81/W81_ROUNDING_AUTHORITY.md`.

   WHAT THIS LINE NOW IS. After the engine's clone it is the ONLY global
   decimal.js mutation in the tree, which makes the shared constructor
   DETERMINISTIC — 40 / ROUND_HALF_UP in every process that loads this package,
   decimal.js's default in every process that does not, and never a function of
   ordering. It is a platform compatibility pin for the eight consumers above,
   not this package's private configuration.
   `server/__tests__/w81_rounding_authority.test.ts` pins that there is exactly
   ONE such writer and that it is this one; a second one anywhere re-opens D3 and
   fails that test.

   40 AND ROUND_HALF_UP ARE LEFT EXACTLY AS FOUND. Every function in this file
   ends in `.toDecimalPlaces(<=12).toNumber()`, so its published outputs do not
   expose digit 39 or 40, but "does not appear to matter" is not a reason to move
   a money setting in the last wave before a freeze.
   ═══════════════════════════════════════════════════════════════════════════ */
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

/* ===== WAVE 9 — ILPA taxonomy, ACT/365F Brent XIRR, metrics service =====
 * See ./ilpa.ts. ENGINE_REGISTRY C-4 declares this package CANONICAL for all
 * fund math; the Wave 9 surface is re-exported here so every consumer has a
 * single import specifier, `@capavate/math-fns`.
 */
export * from "./ilpa";
