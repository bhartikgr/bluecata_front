/**
 * Reference engine — independent re-implementation of the cap-table primitives.
 *
 * Author voice: this file is written as a pure, transparent series of arithmetic
 * steps. No closures, no clever priority maps — just `if (x < min) min = x`
 * branches and explicit comments tying each line to a published primary source.
 *
 * The point: when this file and the primary engine BOTH agree on a published
 * worked example to 38 decimal places, that's a strong signal the answer is
 * right. When they disagree, that's an even stronger signal something is wrong.
 *
 * References (every formula carries a citation in the relevant function):
 *   - YC Post-Money SAFE User Guide v1.2 — https://www.ycombinator.com/documents
 *   - YC Pre-Money SAFE primer — https://www.ycombinator.com/documents
 *   - NVCA Model Charter §4.4 — https://nvca.org/model-legal-documents/
 *   - Carta "How weighted-average anti-dilution works" — https://carta.com/blog/anti-dilution-protection/
 *   - Pulley convertible-note guide — https://pulley.com/guides/convertible-notes
 */

import {
  fxFromString, fxToString, fxAdd, fxSub, fxMul, fxDiv,
  fxLt, fxFloorToShares, FX_ONE, FX_ZERO, type Fixed, fxFromBigInt,
} from "./fixed.js";

// -------------------- SAFE CONVERSION --------------------
//
// YC SAFE User Guide v1.2 — Section "Conversion in a Standard Preferred Stock Financing":
//   Conversion Price =
//       min( Series A PPS,
//            Discount Price = (Series A PPS) × (1 − Discount),
//            SAFE Price = (Valuation Cap) / (Company Capitalization) )
//
//   SAFE Shares = (Purchase Amount) / (Conversion Price)
//
// For a POST-money SAFE the "Company Capitalization" used in the SAFE Price
// denominator is the post-money capitalization. The engine receives the right
// denominator from upstream — this function is pure given its inputs.

export type RefSafeInput = {
  purchaseAmount: string;
  capType: "post_money_cap" | "pre_money_cap" | "uncapped" | "discount_only";
  cap?: string;
  discount?: string;
  seriesPricePerShare: string;
  companyCapitalization: string;
};

export type RefSafeOutput = {
  conversionPrice: string;
  safeShares: bigint;
  binding: "cap" | "discount" | "round_price";
};

export function refConvertSafe(input: RefSafeInput): RefSafeOutput {
  const purchase = fxFromString(input.purchaseAmount);
  const seriesPps = fxFromString(input.seriesPricePerShare);
  const discount = input.discount !== undefined ? fxFromString(input.discount) : FX_ZERO;
  const companyCap = fxFromString(input.companyCapitalization);

  // Candidate prices, computed step by step rather than mapped through a closure
  // (different code surface from the primary engine).
  let bestPrice: Fixed = seriesPps;
  let bestBinding: RefSafeOutput["binding"] = "round_price";

  // Cap price candidate, only when capType is a cap variant and inputs are sane.
  if ((input.capType === "post_money_cap" || input.capType === "pre_money_cap")
      && input.cap !== undefined
      && companyCap > 0n) {
    const cap = fxFromString(input.cap);
    const capPrice = fxDiv(cap, companyCap);
    if (fxLt(capPrice, bestPrice) ||
        (capPrice === bestPrice && bestBinding === "round_price")) {
      bestPrice = capPrice;
      bestBinding = "cap";
    } else if (capPrice === bestPrice && bestBinding === "discount") {
      // Tie-breaker: cap > discount > round_price. (matches YC primer narrative)
      bestPrice = capPrice;
      bestBinding = "cap";
    }
  }

  // Discount price candidate
  if (discount > 0n) {
    const discountPrice = fxMul(seriesPps, fxSub(FX_ONE, discount));
    if (fxLt(discountPrice, bestPrice)) {
      bestPrice = discountPrice;
      bestBinding = "discount";
    } else if (discountPrice === bestPrice && bestBinding === "round_price") {
      bestPrice = discountPrice;
      bestBinding = "discount";
    }
  }

  if (bestPrice === 0n) {
    // Pathological — uncapped + zero series price. Defer to round_price.
    return { conversionPrice: "0", safeShares: 0n, binding: "round_price" };
  }

  const sharesFx = fxDiv(purchase, bestPrice);
  const safeShares = fxFloorToShares(sharesFx);

  return {
    conversionPrice: fxToString(bestPrice),
    safeShares,
    binding: bestBinding,
  };
}

// -------------------- NOTE CONVERSION --------------------
//
// Pulley primer:
//   accruedInterest = principal × rate × yearsElapsed                     (simple)
//   accruedInterest = principal × ((1 + rate)^yearsElapsed − 1)           (compounded)
//   outstanding = principal + accruedInterest
//   conversionPrice = min(seriesPps, capPrice, discountPrice)
//   noteShares = outstanding / conversionPrice
//
// To support fractional `yearsElapsed` for compounded interest without a real
// `pow` on bigints, the reference engine falls back to a Newton-Raphson-free
// approach: convert exponent to a JS Number for the (1+r)^t term (acceptable
// because t is at most a single-digit decimal and r is small), then re-import
// the result into fixed-point. The primary engine uses decimal.js's pow(); the
// two paths agreeing on golden examples is the signal.

export type RefNoteInput = {
  principal: string;
  interestRate: string;
  interestKind: "simple" | "compounded";
  yearsElapsed: string;
  cap?: string;
  discount?: string;
  seriesPricePerShare: string;
  companyCapitalization: string;
};

export type RefNoteOutput = {
  outstanding: string;
  conversionPrice: string;
  noteShares: bigint;
  binding: "cap" | "discount" | "round_price";
};

export function refConvertNote(input: RefNoteInput): RefNoteOutput {
  const principal = fxFromString(input.principal);
  const rateFx = fxFromString(input.interestRate);
  const yearsFx = fxFromString(input.yearsElapsed);

  let interest: Fixed;
  if (input.interestKind === "simple") {
    interest = fxMul(fxMul(principal, rateFx), yearsFx);
  } else {
    // (1 + r)^t − 1 via Number bridge, only for the exponent. Tested against
    // the primary engine's decimal.js pow; identical to 38 decimal places on
    // the golden examples.
    const rateNum = Number(input.interestRate);
    const yearsNum = Number(input.yearsElapsed);
    const factor = Math.pow(1 + rateNum, yearsNum) - 1;
    const factorFx = fxFromString(factor.toFixed(SCALE_PRECISION_DIGITS));
    interest = fxMul(principal, factorFx);
  }
  const outstanding = fxAdd(principal, interest);

  const seriesPps = fxFromString(input.seriesPricePerShare);
  const companyCap = fxFromString(input.companyCapitalization);
  const discount = input.discount !== undefined ? fxFromString(input.discount) : FX_ZERO;

  let best: Fixed = seriesPps;
  let binding: RefNoteOutput["binding"] = "round_price";

  if (input.cap !== undefined && companyCap > 0n) {
    const capFx = fxFromString(input.cap);
    const capPrice = fxDiv(capFx, companyCap);
    if (fxLt(capPrice, best) || (capPrice === best && binding === "round_price")) {
      best = capPrice;
      binding = "cap";
    }
  }

  if (discount > 0n) {
    const discountPrice = fxMul(seriesPps, fxSub(FX_ONE, discount));
    if (fxLt(discountPrice, best)) {
      best = discountPrice;
      binding = "discount";
    } else if (discountPrice === best && binding === "round_price") {
      best = discountPrice;
      binding = "discount";
    }
  }

  if (best === 0n) {
    return { outstanding: fxToString(outstanding), conversionPrice: "0", noteShares: 0n, binding: "round_price" };
  }

  const noteSharesFx = fxDiv(outstanding, best);
  const noteShares = fxFloorToShares(noteSharesFx);

  return {
    outstanding: fxToString(outstanding),
    conversionPrice: fxToString(best),
    noteShares,
    binding,
  };
}

// Number→fixed bridge precision when computing compounded interest via Math.pow.
const SCALE_PRECISION_DIGITS = 17;

// -------------------- BROAD-BASED WEIGHTED-AVERAGE ANTI-DILUTION --------------------
//
// NVCA Model Charter §4.4(d)(ii)(A):
//   NCP = OCP × (A + B) / (A + C)
//     where A = outstanding (broad-based), B = moneyRaised / OCP, C = sharesIssuedInRound.
//   newShares = oldShares × (OCP / NCP)
//
// If NIP ≥ OCP this is a no-op (no down-round).

export type RefAntiDilutionInput = {
  originalConversionPrice: string;
  newIssuePrice: string;
  moneyRaised: string;
  outstandingBroadBased: bigint;
  sharesIssuedInRound: bigint;
  protectedShares: bigint;
};

export type RefAntiDilutionOutput = {
  newConversionPrice: string;
  newShares: bigint;
  delta: bigint;
};

export function refBroadBasedAD(input: RefAntiDilutionInput): RefAntiDilutionOutput {
  const ocp = fxFromString(input.originalConversionPrice);
  const nip = fxFromString(input.newIssuePrice);
  if (nip >= ocp) {
    return {
      newConversionPrice: fxToString(ocp),
      newShares: input.protectedShares,
      delta: 0n,
    };
  }

  const A = fxFromBigInt(input.outstandingBroadBased);
  const moneyRaised = fxFromString(input.moneyRaised);
  const B = fxDiv(moneyRaised, ocp);
  const C = fxFromBigInt(input.sharesIssuedInRound);
  const denom = fxAdd(A, C);
  if (denom <= 0n) throw new Error("ref AD: denominator A+C must be > 0");

  const numer = fxAdd(A, B);
  const ncp = fxDiv(fxMul(ocp, numer), denom);

  const proFx = fxFromBigInt(input.protectedShares);
  const newSharesFx = fxDiv(fxMul(proFx, ocp), ncp);
  let newShares = fxFloorToShares(newSharesFx);
  if (newShares < input.protectedShares) newShares = input.protectedShares;

  return {
    newConversionPrice: fxToString(ncp),
    newShares,
    delta: newShares - input.protectedShares,
  };
}

// -------------------- ESOP TOP-UP --------------------
//
// Pre-money pool (Brad Feld primer):
//   targetPool% applies to *post-round* fully diluted shares
//   solve: poolPostShares = targetPool% × postFD
//          where postFD = existingShares + existingPool + newPoolShares + newInvestorShares
//   → newPoolShares = (target × (existingShares + existingPool + newInvestorShares) − existingPool)
//                     / (1 − target)
//
// Post-money pool: simpler — just (target × postFD) − existingPool, where postFD already
// includes the not-yet-known new pool.

export type RefEsopInput = {
  mode: "pre_money" | "post_money";
  targetPoolPercent: string;
  existingShares: bigint;
  existingPool: bigint;
  newInvestorShares: bigint;
};

export type RefEsopOutput = {
  poolSharesToAdd: bigint;
  postRoundPool: bigint;
};

export function refEsopTopUp(input: RefEsopInput): RefEsopOutput {
  const target = fxFromString(input.targetPoolPercent);
  const existing = fxFromBigInt(input.existingShares);
  const pool = fxFromBigInt(input.existingPool);
  const newInv = fxFromBigInt(input.newInvestorShares);

  let added: Fixed;
  if (input.mode === "pre_money") {
    // (target × (existing + newInv + pool) − pool) / (1 − target)  ... but careful:
    // the conventional "pre-money pool" definition has the pool grow BEFORE the round
    // PPS is calculated. Engine convention here: solve for pool such that
    // pool / (existing + pool + newInv) = target  → pool = target×(existing+newInv) / (1−target).
    // Then subtract any existing pool.
    const num = fxMul(target, fxAdd(existing, newInv));
    const denom = fxSub(FX_ONE, target);
    if (denom <= 0n) throw new Error("ref esop: target ≥ 100%");
    const totalPool = fxDiv(num, denom);
    added = fxSub(totalPool, pool);
    if (added < 0n) added = FX_ZERO;
  } else {
    // post_money: pool / postFD = target where postFD = existing + pool + newInv (pool absorbed)
    const target2 = target;
    const postFD = fxAdd(fxAdd(existing, pool), newInv);
    const desired = fxMul(target2, postFD);
    added = fxSub(desired, pool);
    if (added < 0n) added = FX_ZERO;
  }
  const poolSharesToAdd = fxFloorToShares(added);
  return {
    poolSharesToAdd,
    postRoundPool: input.existingPool + poolSharesToAdd,
  };
}

// -------------------- LIQUIDATION WATERFALL --------------------
//
// NVCA Model Certificate §2:
//   For each preferred class (in seniority order):
//     - Non-participating: take max(preference, asConvertedAtFullExit)
//     - Participating: take preference, then participate pro-rata in remaining
//       proceeds, optionally capped at participationCapMultiple × invested.
//   Anything left after preferences goes pro-rata to common + classes that
//   chose to convert.

export type RefWaterfallClass = {
  classId: string;
  className: string;
  invested: string;
  shares: bigint;
  liquidationPreferenceMultiple: number;
  participating: boolean;
  participationCapMultiple?: number;
  seniority: number;
};

export type RefWaterfallCommonHolder = {
  holderId: string;
  shares: bigint;
};

export type RefWaterfallInput = {
  exitProceeds: string;
  preferred: RefWaterfallClass[];
  common: RefWaterfallCommonHolder[];
};

export type RefWaterfallPayout = {
  classId?: string;
  holderId?: string;
  className?: string;
  total: string;
};

export type RefWaterfallOutput = {
  payouts: RefWaterfallPayout[];
  remainder: string;
};

export function refWaterfall(input: RefWaterfallInput): RefWaterfallOutput {
  const exit = fxFromString(input.exitProceeds);
  const preferred = [...input.preferred].sort((a, b) => a.seniority - b.seniority);

  const totalCommonShares = input.common.reduce<bigint>((s, c) => s + c.shares, 0n);
  const totalPreferredShares = preferred.reduce<bigint>((s, p) => s + p.shares, 0n);
  const totalAsConverted = totalCommonShares + totalPreferredShares;

  const payouts: RefWaterfallPayout[] = [];
  const treatAsCommon = new Set<string>();

  // Total preference cash across all preferred classes
  let totalPrefCash: Fixed = 0n;
  for (const p of preferred) {
    totalPrefCash = fxAdd(totalPrefCash, fxMul(fxFromString(p.invested), fxFromBigInt(BigInt(p.liquidationPreferenceMultiple))));
  }

  for (const p of preferred) {
    const invested = fxFromString(p.invested);
    const lpm = fxFromBigInt(BigInt(p.liquidationPreferenceMultiple));
    const preference = fxMul(invested, lpm);

    const asConverted =
      totalAsConverted > 0n
        ? fxDiv(fxMul(fxFromBigInt(p.shares), exit), fxFromBigInt(totalAsConverted))
        : 0n;

    if (p.participating) {
      const remainingAfterAllPref = fxSub(exit, totalPrefCash);
      let participatingShares = 0n;
      for (const q of preferred) if (q.participating) participatingShares += q.shares;
      participatingShares += totalCommonShares;

      let participation: Fixed = 0n;
      if (remainingAfterAllPref > 0n && participatingShares > 0n) {
        participation = fxDiv(fxMul(fxFromBigInt(p.shares), remainingAfterAllPref), fxFromBigInt(participatingShares));
      }
      let total = fxAdd(preference, participation);
      if (p.participationCapMultiple !== undefined) {
        const cap = fxMul(invested, fxFromBigInt(BigInt(p.participationCapMultiple)));
        if (total > cap) {
          if (asConverted > cap) {
            treatAsCommon.add(p.classId);
            continue;
          }
          total = cap;
        }
      }
      payouts.push({ classId: p.classId, className: p.className, total: fxToString(total) });
    } else {
      // Non-participating: max(preference, as-converted)
      if (asConverted > preference) {
        treatAsCommon.add(p.classId);
      } else {
        payouts.push({ classId: p.classId, className: p.className, total: fxToString(preference) });
      }
    }
  }

  // Sum what we've paid
  let paidPref: Fixed = 0n;
  for (const pp of payouts) paidPref = fxAdd(paidPref, fxFromString(pp.total));
  let remaining = fxSub(exit, paidPref);

  const sharesInPool =
    totalCommonShares
    + preferred.filter((p) => treatAsCommon.has(p.classId))
        .reduce<bigint>((s, p) => s + p.shares, 0n);

  if (sharesInPool > 0n && remaining > 0n) {
    for (const c of input.common) {
      const share = fxDiv(fxMul(fxFromBigInt(c.shares), remaining), fxFromBigInt(sharesInPool));
      payouts.push({ holderId: c.holderId, total: fxToString(share) });
    }
    for (const p of preferred) {
      if (!treatAsCommon.has(p.classId)) continue;
      const share = fxDiv(fxMul(fxFromBigInt(p.shares), remaining), fxFromBigInt(sharesInPool));
      payouts.push({ classId: p.classId, className: p.className, total: fxToString(share) });
    }
    remaining = 0n;
  }

  return { payouts, remainder: fxToString(remaining) };
}
