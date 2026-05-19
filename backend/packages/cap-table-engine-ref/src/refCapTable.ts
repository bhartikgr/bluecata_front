/**
 * Reference cap-table computation.
 *
 * Mirrors the public surface of the primary engine's `computeCapTable` but uses
 * the reference math (BigInt scaled fixed-point) under the hood. Both engines
 * accept the same `ComputeOptions` and return the same `CapTableResult` shape;
 * `reconcile` will compare them holder-by-holder, instrument-by-instrument.
 *
 * Pipeline mirrors the primary, with deliberate code-style differences.
 */

import type {
  ComputeOptions, CapTableResult, Security, Holder, PricedRound, Region,
} from "@capavate/cap-table-engine";
import {
  refConvertSafe, refConvertNote, refBroadBasedAD, refEsopTopUp, refWaterfall,
  type RefWaterfallInput, type RefWaterfallOutput,
} from "./refMath.js";
import { fxFromString, fxToString, fxDiv, fxFromBigInt, fxMul, fxAdd, FX_ONE } from "./fixed.js";

export type ReferenceCapTableOptions = ComputeOptions & {
  // Optional control: skip ESOP top-up replay (matches engine when same is true)
  skipEsopTopUp?: boolean;
};

export function referenceComputeCapTable(opts: ReferenceCapTableOptions): CapTableResult {
  const region: Region = opts.formulaRegion;
  const trace: CapTableResult["trace"] = [];
  const formulaIdsUsed = new Set<string>();

  // Walk transactions in date order
  const txs = [...opts.transactions].sort((a, b) =>
    getTxDate(a).localeCompare(getTxDate(b)),
  );

  let ledger: Security[] = [];

  for (const tx of txs) {
    if (tx.type === "issue") {
      ledger.push(tx.security);
    } else if (tx.type === "exercise_option") {
      const sec = ledger.find((s) => s.id === tx.securityId);
      if (sec && sec.option) {
        const newCommon: Security = {
          id: `${sec.id}-ex`,
          holderId: sec.holderId,
          kind: "common",
          series: "Common",
          shares: sec.option.grantedShares,
        };
        ledger = ledger.filter((s) => s.id !== sec.id);
        ledger.push(newCommon);
        formulaIdsUsed.add("option.exercise");
      }
    } else if (tx.type === "exercise_warrant") {
      const sec = ledger.find((s) => s.id === tx.securityId);
      if (sec && sec.warrant) {
        // Cash exercise: 1 underlying share per option exercised
        const underlying = sec.warrant.underlyingShares;
        // Cashless: shares = underlying × (FMV − strike) / FMV
        let issuedShares = underlying;
        const cashless = tx.cashless ?? sec.warrant.cashless;
        if (cashless && tx.fmvPerShare) {
          const fmv = fxFromString(tx.fmvPerShare);
          const strike = fxFromString(sec.warrant.strikePrice);
          if (fmv > 0n) {
            const ratio = fxDiv(fxMul(fxFromBigInt(underlying), (fmv - strike)), fmv);
            issuedShares = ratio / (10n ** 38n); // floor
            if (issuedShares < 0n) issuedShares = 0n;
          }
        }
        const newCommon: Security = {
          id: `${sec.id}-ex`,
          holderId: sec.holderId,
          kind: "common",
          series: "Common",
          shares: issuedShares,
        };
        ledger = ledger.filter((s) => s.id !== sec.id);
        ledger.push(newCommon);
        formulaIdsUsed.add("warrant.exercise");
      }
    } else if (tx.type === "issue_preferred_round") {
      ledger = applyPricedRound(ledger, tx.round, tx.date, region, formulaIdsUsed);
    } else if (tx.type === "esop_topup") {
      const result = refEsopTopUp({
        mode: tx.mode,
        targetPoolPercent: tx.targetPercent,
        existingShares: sumShares(ledger, ["common", "preferred"]),
        existingPool: sumOptionPool(ledger),
        newInvestorShares: 0n,
      });
      if (result.poolSharesToAdd > 0n) {
        ledger.push({
          id: `pool-${tx.date}`,
          holderId: "pool",
          kind: "option",
          series: "Pool",
          option: {
            grantedShares: result.poolSharesToAdd,
            exercisePrice: "0.01",
            vestingMonths: 0,
            cliffMonths: 0,
            poolName: "ESOP top-up",
          },
        });
        formulaIdsUsed.add("esop.topup");
      }
    }
  }

  // Compute view rows
  const rows = renderView(ledger, opts.holders, opts.view);
  const totalShares = rows.reduce<bigint>((s, r) => s + r.shares, 0n);

  return {
    asOf: opts.asOf,
    view: opts.view,
    region,
    rows,
    totalShares,
    trace,
    formulaIdsUsed: Array.from(formulaIdsUsed),
  };
}

function getTxDate(t: { date?: string }): string { return t.date ?? "1970-01-01"; }

function sumShares(ledger: Security[], kinds: string[]): bigint {
  return ledger.reduce<bigint>((s, sec) => {
    if (kinds.includes(sec.kind)) return s + (sec.shares ?? 0n);
    return s;
  }, 0n);
}

function sumOptionPool(ledger: Security[]): bigint {
  return ledger.reduce<bigint>((s, sec) => {
    if (sec.kind === "option" && sec.option) return s + sec.option.grantedShares;
    return s;
  }, 0n);
}

function fdShares(ledger: Security[]): bigint {
  let s = 0n;
  for (const sec of ledger) {
    if (sec.kind === "common" || sec.kind === "preferred") s += sec.shares ?? 0n;
    else if (sec.kind === "option" && sec.option) s += sec.option.grantedShares;
    else if (sec.kind === "warrant" && sec.warrant) s += sec.warrant.underlyingShares;
  }
  return s;
}

function applyPricedRound(
  ledger: Security[],
  round: PricedRound,
  date: string,
  region: Region,
  formulaIdsUsed: Set<string>,
): Security[] {
  const ppsStr = round.pricePerShare ?? fxToString(
    fxDiv(fxFromString(round.preMoneyValuation), fxFromBigInt(fdShares(ledger))),
  );

  const ppsFx = fxFromString(ppsStr);
  const newInvSharesFx = fxDiv(fxFromString(round.investmentAmount), ppsFx);
  const newInvestorShares = newInvSharesFx / (10n ** 38n);

  // Pre-money ESOP top-up first (pool grows BEFORE round PPS in conventional pre-money model)
  if (round.optionPoolPostPercent && round.optionPoolMode === "pre_money") {
    const top = refEsopTopUp({
      mode: "pre_money",
      targetPoolPercent: round.optionPoolPostPercent,
      existingShares: sumShares(ledger, ["common", "preferred"]),
      existingPool: sumOptionPool(ledger),
      newInvestorShares,
    });
    if (top.poolSharesToAdd > 0n) {
      ledger.push({
        id: `pool-topup-${round.id}`,
        holderId: "pool",
        kind: "option",
        series: "Pool",
        option: {
          grantedShares: top.poolSharesToAdd,
          exercisePrice: "0.01",
          vestingMonths: 0,
          cliffMonths: 0,
          poolName: `${round.series} pool top-up`,
        },
      });
      formulaIdsUsed.add("esop.topup");
    }
  }

  // Convert SAFEs
  const safes = ledger.filter((s) => s.kind === "safe");
  const companyCap = ledger
    .filter((s) => s.kind !== "safe" && s.kind !== "note")
    .reduce<bigint>((sum, sec) => {
      if (sec.kind === "common" || sec.kind === "preferred") return sum + (sec.shares ?? 0n);
      if (sec.kind === "option" && sec.option) return sum + sec.option.grantedShares;
      if (sec.kind === "warrant" && sec.warrant) return sum + sec.warrant.underlyingShares;
      return sum;
    }, 0n);

  for (const safe of safes) {
    if (!safe.safe) continue;
    const result = refConvertSafe({
      purchaseAmount: safe.investmentAmount ?? "0",
      capType: safe.safe.type,
      cap: safe.safe.cap,
      discount: safe.safe.discount,
      seriesPricePerShare: ppsStr,
      companyCapitalization: companyCap.toString(),
    });
    ledger = ledger.filter((s) => s.id !== safe.id);
    ledger.push({
      id: `${safe.id}-conv`,
      holderId: safe.holderId,
      kind: "preferred",
      series: round.series,
      shares: result.safeShares,
      pricePerShare: result.conversionPrice,
      investmentAmount: safe.investmentAmount,
      preferred: {
        liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
        participating: round.participating ?? false,
        seniority: 1,
        antiDilution: round.antiDilution ?? "broad_based",
        originalIssuePrice: result.conversionPrice,
      },
    });
    formulaIdsUsed.add(safe.safe.type === "post_money_cap" ? "safe.postmoney.conversion" : "safe.premoney.conversion");
  }

  // Convert notes
  const notes = ledger.filter((s) => s.kind === "note");
  for (const note of notes) {
    if (!note.note) continue;
    const issued = new Date(note.note.issueDate);
    const closeDate = new Date(date);
    const yearsElapsed = (closeDate.getTime() - issued.getTime()) / (365.25 * 24 * 3600 * 1000);
    const result = refConvertNote({
      principal: note.note.principal,
      interestRate: note.note.interestRate,
      interestKind: note.note.interestKind,
      yearsElapsed: yearsElapsed.toFixed(8),
      cap: note.note.cap,
      discount: note.note.discount,
      seriesPricePerShare: ppsStr,
      companyCapitalization: companyCap.toString(),
    });
    ledger = ledger.filter((s) => s.id !== note.id);
    ledger.push({
      id: `${note.id}-conv`,
      holderId: note.holderId,
      kind: "preferred",
      series: round.series,
      shares: result.noteShares,
      pricePerShare: result.conversionPrice,
      investmentAmount: note.note.principal,
      preferred: {
        liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
        participating: round.participating ?? false,
        seniority: 1,
        antiDilution: round.antiDilution ?? "broad_based",
        originalIssuePrice: result.conversionPrice,
      },
    });
    formulaIdsUsed.add("note.conversion");
  }

  // Issue new investor preferred
  ledger.push({
    id: `round-${round.id}-newpref`,
    holderId: `investors-${round.id}`,
    kind: "preferred",
    series: round.series,
    shares: newInvestorShares,
    pricePerShare: ppsStr,
    investmentAmount: round.investmentAmount,
    currency: round.currency ?? "USD",
    preferred: {
      liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
      participating: round.participating ?? false,
      seniority: 0,
      antiDilution: round.antiDilution ?? "broad_based",
      originalIssuePrice: ppsStr,
    },
  });

  // Anti-dilution: any existing preferred with OIP > NIP and broad_based gets recomputed
  const broadBaseSharesAfter = fdShares(ledger);
  const newSharesIssued = ledger
    .filter((s) => s.kind === "preferred" && s.preferred && s.preferred.originalIssuePrice === ppsStr)
    .reduce<bigint>((s, sec) => s + (sec.shares ?? 0n), 0n);

  ledger = ledger.map((sec) => {
    if (sec.kind !== "preferred" || !sec.preferred) return sec;
    if (sec.preferred.originalIssuePrice === ppsStr) return sec;
    if (sec.preferred.antiDilution !== "broad_based") return sec;
    const oip = sec.preferred.originalIssuePrice;
    const oipFx = fxFromString(oip);
    if (ppsFx >= oipFx) return sec;
    const result = refBroadBasedAD({
      originalConversionPrice: oip,
      newIssuePrice: ppsStr,
      moneyRaised: round.investmentAmount,
      outstandingBroadBased: broadBaseSharesAfter,
      sharesIssuedInRound: newSharesIssued,
      protectedShares: sec.shares ?? 0n,
    });
    formulaIdsUsed.add("antiDilution.broadBased");
    return { ...sec, shares: result.newShares };
  });

  return ledger;
}

function renderView(
  ledger: Security[],
  holders: Holder[],
  view: "basic" | "fully_diluted" | "as_converted",
): CapTableResult["rows"] {
  const out: CapTableResult["rows"] = [];
  let total = 0n;
  for (const sec of ledger) {
    let shares = 0n;
    if (view === "basic") {
      if (sec.kind === "common" || sec.kind === "preferred") shares = sec.shares ?? 0n;
    } else {
      if (sec.kind === "common" || sec.kind === "preferred") shares = sec.shares ?? 0n;
      else if (sec.kind === "option" && sec.option) shares = sec.option.grantedShares;
      else if (sec.kind === "warrant" && sec.warrant) shares = sec.warrant.underlyingShares;
      // SAFE/note are not rendered in views — same as primary
    }
    if (shares === 0n) continue;
    total += shares;
    const holder = holders.find((h) => h.id === sec.holderId);
    out.push({
      holderId: sec.holderId,
      holderName: holder?.name ?? sec.holderId,
      holderType: holder?.type ?? "investor",
      kind: sec.kind,
      series: sec.series,
      shares,
      ownershipPercent: "0", // computed below
      invested: sec.investmentAmount,
      currency: sec.currency,
    });
  }
  // Compute ownership percent
  const totalFx = fxFromBigInt(total);
  for (const r of out) {
    if (total === 0n) {
      r.ownershipPercent = "0";
      continue;
    }
    const pct = fxMul(fxDiv(fxFromBigInt(r.shares), totalFx), fxFromString("100"));
    r.ownershipPercent = fxToString(pct, 12);
  }
  return out;
}

// Re-exports
export {
  refConvertSafe, refConvertNote, refBroadBasedAD, refEsopTopUp, refWaterfall,
};
export type { RefWaterfallInput, RefWaterfallOutput };
