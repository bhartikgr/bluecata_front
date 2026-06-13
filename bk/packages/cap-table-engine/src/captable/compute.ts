/**
 * Main cap-table computation pipeline.
 *
 * Pipeline:
 *   1. Apply transactions in date order, materialising the security ledger.
 *   2. Resolve MFN among SAFEs.
 *   3. Convert SAFEs and notes at any priced rounds along the way.
 *   4. Apply anti-dilution at down rounds.
 *   5. Apply ESOP top-ups.
 *   6. Compute view (basic / fd / as-converted).
 *   7. Return rows + trace.
 */
import type {
  ComputeOptions, CapTableResult, Security, Transaction, TraceStep, Region,
} from "../types.js";
import { D } from "../primitives/bigDecimal.js";
import { computeView } from "./views.js";
import { applyMfn } from "../conversion/mfnOrdering.js";
import { convertSafeToPreferred } from "../conversion/safeToPreferred.js";
import { convertNoteToPreferred } from "../conversion/noteToPreferred.js";
import { exerciseOption } from "../conversion/optionExercise.js";
import { exerciseWarrant } from "../conversion/warrantExercise.js";
import { applyBroadBasedWeightedAverage } from "../antiDilution/broadBasedWeightedAverage.js";
import { applyFullRatchet } from "../antiDilution/fullRatchet.js";
import { applyNarrowBasedWeightedAverage } from "../antiDilution/narrowBasedWeightedAverage.js";
import { computeEsopTopUp } from "../instruments/esopTopUp.js";
import { resolveFormula } from "../formulas/registry.js";

export function computeCapTable(opts: ComputeOptions): CapTableResult {
  const region: Region = opts.formulaRegion;
  const trace: TraceStep[] = [];
  const formulaIdsUsed = new Set<string>();

  // 1. Apply transactions in date order
  let ledger: Security[] = [];
  const txs = [...opts.transactions].sort((a, b) =>
    getTxDate(a).localeCompare(getTxDate(b)),
  );

  for (const tx of txs) {
    if (tx.type === "issue") {
      ledger.push(tx.security);
    } else if (tx.type === "exercise_option") {
      const sec = ledger.find((s) => s.id === tx.securityId);
      if (sec && sec.option) {
        const f = resolveFormula("option.exercise", region);
        const result = exerciseOption({
          exercisedOptions: tx.sharesExercised,
          exercisePrice: sec.option.exercisePrice,
          fmvPerShare: undefined,
          cashless: false,
          formulaId: "option.exercise",
          formulaVersion: f?.version ?? "1.0.0",
          region,
          formulaDef: f?.definition ?? {},
        });
        // Replace option with common shares for the holder
        const newCommon: Security = {
          id: `${sec.id}-ex`,
          holderId: sec.holderId,
          kind: "common",
          series: "Common",
          shares: result.sharesIssued,
        };
        ledger = ledger.filter((s) => s.id !== sec.id);
        ledger.push(newCommon);
        trace.push(result.trace);
        formulaIdsUsed.add("option.exercise");
      }
    } else if (tx.type === "exercise_warrant") {
      const sec = ledger.find((s) => s.id === tx.securityId);
      if (sec && sec.warrant) {
        const f = resolveFormula("warrant.exercise", region);
        const result = exerciseWarrant({
          underlyingShares: sec.warrant.underlyingShares,
          strikePrice: sec.warrant.strikePrice,
          fmvPerShare: tx.fmvPerShare,
          cashless: tx.cashless ?? sec.warrant.cashless,
          formulaId: "warrant.exercise",
          formulaVersion: f?.version ?? "1.0.0",
          region,
          formulaDef: f?.definition ?? {},
        });
        const newCommon: Security = {
          id: `${sec.id}-ex`,
          holderId: sec.holderId,
          kind: "common",
          series: "Common",
          shares: result.sharesIssued,
        };
        ledger = ledger.filter((s) => s.id !== sec.id);
        ledger.push(newCommon);
        trace.push(result.trace);
        formulaIdsUsed.add("warrant.exercise");
      }
    } else if (tx.type === "issue_preferred_round") {
      // Issue priced round: compute new investor shares + apply ESOP top-up if requested
      const round = tx.round;
      const pps = D(round.pricePerShare ?? D(round.preMoneyValuation).div(currentFullyDilutedShares(ledger)).toFixed());
      const newInvestorSharesDec = D(round.investmentAmount).div(pps);
      const newInvestorShares = BigInt(newInvestorSharesDec.floor().toFixed(0));
      // Apply ESOP top-up first (pre-money pool grows BEFORE round)
      if (round.optionPoolPostPercent && round.optionPoolMode === "pre_money") {
        const topup = applyTopUp(ledger, round.optionPoolPostPercent, "pre_money", newInvestorShares, region);
        if (topup.poolSharesToAdd > 0n) {
          const f = resolveFormula("esop.topup", region);
          ledger.push({
            id: `pool-topup-${round.id}`,
            holderId: "pool",
            kind: "option",
            series: "Pool",
            option: {
              grantedShares: topup.poolSharesToAdd,
              exercisePrice: "0.01",
              vestingMonths: 0,
              cliffMonths: 0,
              poolName: `${round.series} pool top-up`,
            },
          });
          trace.push(topup.trace);
          formulaIdsUsed.add(f?.id ?? "esop.topup");
        }
      }

      // Convert SAFEs in this round
      const safes = ledger.filter((s) => s.kind === "safe");
      // Resolve MFN
      const resolvedSafes = safes.map((s) => applyMfn(s, { candidates: safes }));
      const companyCap = currentFullyDilutedShares(ledger.filter((s) => s.kind !== "safe" && s.kind !== "note"));
      for (const safe of resolvedSafes) {
        if (!safe.safe) continue;
        const f = resolveFormula(
          safe.safe.type === "post_money_cap" ? "safe.postmoney.conversion" : "safe.premoney.conversion",
          region,
        );
        const result = convertSafeToPreferred({
          purchaseAmount: safe.investmentAmount ?? "0",
          capType: safe.safe.type,
          cap: safe.safe.cap,
          discount: safe.safe.discount,
          seriesPricePerShare: pps.toFixed(),
          companyCapitalization: companyCap.toString(),
          formulaId: f.id,
          formulaVersion: f.version,
          region,
          formulaDef: f.definition,
        });
        // Replace SAFE with preferred
        ledger = ledger.filter((s) => s.id !== safe.id);
        ledger.push({
          id: `${safe.id}-conv`,
          holderId: safe.holderId,
          kind: "preferred",
          series: round.series,
          shares: result.safeShares,
          pricePerShare: result.conversionPrice,
          investmentAmount: safe.investmentAmount,
          currency: safe.currency,
          preferred: {
            liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
            participating: round.participating ?? false,
            seniority: 1,
            antiDilution: round.antiDilution ?? "broad_based",
            originalIssuePrice: result.conversionPrice,
          },
        });
        trace.push(result.trace);
        formulaIdsUsed.add(f.id);
      }

      // Convert notes
      const notes = ledger.filter((s) => s.kind === "note");
      for (const note of notes) {
        if (!note.note) continue;
        const issued = new Date(note.note.issueDate);
        const closeDate = new Date(tx.date);
        const yearsElapsed = (closeDate.getTime() - issued.getTime()) / (365.25 * 24 * 3600 * 1000);
        const f = resolveFormula("note.conversion", region);
        const result = convertNoteToPreferred({
          principal: note.note.principal,
          interestRate: note.note.interestRate,
          interestKind: note.note.interestKind,
          yearsElapsed: yearsElapsed.toFixed(8),
          cap: note.note.cap,
          discount: note.note.discount,
          seriesPricePerShare: pps.toFixed(),
          companyCapitalization: companyCap.toString(),
          formulaId: f.id,
          formulaVersion: f.version,
          region,
          formulaDef: f.definition,
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
          currency: note.currency,
          preferred: {
            liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
            participating: round.participating ?? false,
            seniority: 1,
            antiDilution: round.antiDilution ?? "broad_based",
            originalIssuePrice: result.conversionPrice,
          },
        });
        trace.push(result.trace);
        formulaIdsUsed.add(f.id);
      }

      // Issue new investor preferred
      ledger.push({
        id: `round-${round.id}-newpref`,
        holderId: `investors-${round.id}`,
        kind: "preferred",
        series: round.series,
        shares: newInvestorShares,
        pricePerShare: pps.toFixed(),
        investmentAmount: round.investmentAmount,
        currency: round.currency ?? "USD",
        preferred: {
          liquidationPreferenceMultiple: round.liquidationPreferenceMultiple ?? 1,
          participating: round.participating ?? false,
          seniority: 0,
          antiDilution: round.antiDilution ?? "broad_based",
          originalIssuePrice: pps.toFixed(),
        },
      });

      // Apply anti-dilution to existing preferred at lower seniority if NIP < their OIP
      ledger = applyAntiDilutionPass(ledger, pps.toFixed(), round, trace, formulaIdsUsed, region);
    } else if (tx.type === "esop_topup") {
      const topup = applyTopUp(ledger, tx.targetPercent, tx.mode, 0n, region);
      if (topup.poolSharesToAdd > 0n) {
        ledger.push({
          id: `pool-${tx.date}`,
          holderId: "pool",
          kind: "option",
          series: "Pool",
          option: {
            grantedShares: topup.poolSharesToAdd,
            exercisePrice: "0.01",
            vestingMonths: 0,
            cliffMonths: 0,
            poolName: "ESOP top-up",
          },
        });
        trace.push(topup.trace);
        formulaIdsUsed.add("esop.topup");
      }
    }
  }

  // Compute view
  const rows = computeView({
    view: opts.view,
    securities: ledger,
    holders: opts.holders,
    estimatedPps: undefined,
    estimatedCompanyCap: currentFullyDilutedShares(ledger),
  });

  const totalShares = rows.reduce<bigint>((s, r) => s + r.shares, 0n);

  // Add an ownership.percent trace so the badge has something to show
  const ownf = resolveFormula("ownership.percent", region);
  trace.push({
    formulaId: "ownership.percent",
    formulaVersion: ownf.version,
    region,
    inputs: { totalShares: totalShares.toString(), holderRows: String(rows.length) },
    outputs: { totalOwnership: rows.reduce((s, r) => s + parseFloat(r.ownershipPercent), 0).toFixed(6) },
    defHash: "see-formula",
    note: "Ownership pro-rata over chosen view denominator",
  });
  formulaIdsUsed.add("ownership.percent");

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

function getTxDate(t: Transaction): string {
  return (t as { date?: string }).date ?? "1970-01-01";
}

function currentFullyDilutedShares(ledger: Security[]): bigint {
  let s = 0n;
  for (const sec of ledger) {
    if (sec.kind === "common" || sec.kind === "preferred") s += sec.shares ?? 0n;
    else if (sec.kind === "option" && sec.option) s += sec.option.grantedShares;
    else if (sec.kind === "warrant" && sec.warrant) s += sec.warrant.underlyingShares;
  }
  return s;
}

function applyTopUp(
  ledger: Security[],
  targetPercent: string,
  mode: "pre_money" | "post_money",
  newInvestorShares: bigint,
  region: Region,
) {
  const existingShares = ledger
    .filter((s) => s.kind === "common" || s.kind === "preferred")
    .reduce<bigint>((sum, s) => sum + (s.shares ?? 0n), 0n);
  const existingPool = ledger
    .filter((s) => s.kind === "option")
    .reduce<bigint>((sum, s) => sum + (s.option?.grantedShares ?? 0n), 0n);
  const f = resolveFormula("esop.topup", region);
  return computeEsopTopUp({
    mode,
    targetPoolPercent: targetPercent,
    existingShares,
    existingPool,
    newInvestorShares,
    formulaId: f.id,
    formulaVersion: f.version,
    region,
    formulaDef: f.definition,
  });
}

function applyAntiDilutionPass(
  ledger: Security[],
  newIssuePrice: string,
  round: { investmentAmount: string },
  trace: TraceStep[],
  formulaIdsUsed: Set<string>,
  region: Region,
): Security[] {
  const newPref = ledger.filter(
    (s) => s.kind === "preferred" && s.preferred && s.preferred.originalIssuePrice === newIssuePrice,
  );
  const broadBaseShares = ledger.reduce<bigint>((s, sec) => {
    if (sec.kind === "common" || sec.kind === "preferred") return s + (sec.shares ?? 0n);
    if (sec.kind === "option" && sec.option) return s + sec.option.grantedShares;
    if (sec.kind === "warrant" && sec.warrant) return s + sec.warrant.underlyingShares;
    return s;
  }, 0n);
  const newSharesIssued = newPref.reduce<bigint>((s, sec) => s + (sec.shares ?? 0n), 0n);

  return ledger.map((sec) => {
    if (sec.kind !== "preferred" || !sec.preferred) return sec;
    if (sec.preferred.originalIssuePrice === newIssuePrice) return sec;
    const oip = sec.preferred.originalIssuePrice;
    const nip = newIssuePrice;
    if (D(nip).gte(D(oip))) return sec;

    if (sec.preferred.antiDilution === "full_ratchet") {
      const f = resolveFormula("antiDilution.fullRatchet", region);
      const r = applyFullRatchet({
        originalIssuePrice: oip,
        newIssuePrice: nip,
        protectedShares: sec.shares ?? 0n,
        formulaId: f.id,
        formulaVersion: f.version,
        region,
        formulaDef: f.definition,
      });
      trace.push(r.trace);
      formulaIdsUsed.add(f.id);
      return { ...sec, shares: r.newShares };
    }
    if (sec.preferred.antiDilution === "broad_based") {
      const f = resolveFormula("antiDilution.broadBased", region);
      const r = applyBroadBasedWeightedAverage({
        originalConversionPrice: oip,
        newIssuePrice: nip,
        moneyRaised: round.investmentAmount,
        outstandingBroadBased: broadBaseShares,
        sharesIssuedInRound: newSharesIssued,
        protectedShares: sec.shares ?? 0n,
        formulaId: f.id,
        formulaVersion: f.version,
        region,
        formulaDef: f.definition,
      });
      trace.push(r.trace);
      formulaIdsUsed.add(f.id);
      return { ...sec, shares: r.newShares };
    }
    if (sec.preferred.antiDilution === "narrow_based") {
      const f = resolveFormula("antiDilution.narrowBased", region);
      const narrowBaseShares = ledger
        .filter((s) => s.kind === "common" || s.kind === "preferred")
        .reduce<bigint>((s, sec2) => s + (sec2.shares ?? 0n), 0n);
      const r = applyNarrowBasedWeightedAverage({
        originalConversionPrice: oip,
        newIssuePrice: nip,
        moneyRaised: round.investmentAmount,
        outstandingNarrowBased: narrowBaseShares,
        sharesIssuedInRound: newSharesIssued,
        protectedShares: sec.shares ?? 0n,
        formulaId: f.id,
        formulaVersion: f.version,
        region,
        formulaDef: f.definition,
      });
      trace.push(r.trace);
      formulaIdsUsed.add(f.id);
      return { ...sec, shares: r.newShares };
    }
    return sec;
  });
}

export function applyTransaction(
  prior: ComputeOptions,
  next: Transaction,
): CapTableResult {
  return computeCapTable({ ...prior, transactions: [...prior.transactions, next] });
}
