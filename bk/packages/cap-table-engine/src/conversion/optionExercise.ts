/**
 * Option exercise — convert a granted option into common shares.
 *
 * Cash exercise:  sharesIssued = exercisedOptions
 * Cashless / net exercise (FMV − strike spread paid in shares):
 *     sharesIssued = exercisedOptions × (fmvPerShare − exercisePrice) / fmvPerShare
 *
 * Region-specific tax notes:
 *   - HK (IRD DIPN 38): exercise spread is taxed as employment income on exercise date.
 *     Engine emits hk_income_tax_at_exercise: true in the trace.
 *   - CN (STA Cai Shui [2016] 101): qualifying ESOPs get deferred IIT until sale;
 *     phantom equity is taxed as employment income at payout. Engine emits the flag.
 */
import { D } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import type { TraceStep, Region } from "../types.js";
import { hashFormulaDef } from "../primitives/hash.js";

export type OptionExerciseInput = {
  exercisedOptions: bigint;
  exercisePrice: string;
  fmvPerShare?: string;
  cashless: boolean;
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
  /**
   * JP-specific: when true, the option grant satisfies Income Tax Act §29-2
   * tax-qualified requirements (W-2 employee, ¥12M annual cap [¥36M for
   * scale-up certified startups post-2024], 2-10 yr exercise window from
   * grant, exercise price ≥ FMV, non-transferable). When tax-qualified, NO
   * income tax at exercise — only 20.315% capital gains tax at sale.
   */
  jpTaxQualified?: boolean;
  /**
   * AU-specific: when true, the company qualifies for the ESS startup
   * concession under ITAA 1997 §83A-105 (< 10 yr, < $50M turnover, unlisted,
   * AU-resident). Under the startup concession NO tax accrues until the
   * eventual disposal.
   */
  auEssStartupConcession?: boolean;
};

export type OptionExerciseOutput = {
  sharesIssued: Shares;
  trace: TraceStep;
};

export function exerciseOption(input: OptionExerciseInput): OptionExerciseOutput {
  let sharesIssued: Shares;
  if (input.cashless && input.fmvPerShare) {
    const fmv = D(input.fmvPerShare);
    const strike = D(input.exercisePrice);
    if (fmv.lte(0)) {
      sharesIssued = 0n;
    } else {
      const ratio = fmv.minus(strike).div(fmv);
      const sharesDec = D(input.exercisedOptions.toString()).mul(ratio);
      sharesIssued = decimalToShares(sharesDec);
    }
  } else {
    sharesIssued = input.exercisedOptions;
  }

  const extra: Record<string, string> = {};
  if (input.region === "HK") {
    extra.hk_income_tax_at_exercise = "true";
    extra.hk_no_cgt = "true";
  }
  if (input.region === "CN") {
    extra.cn_iit_at_exercise = "true";
  }
  if (input.region === "IN") {
    // §17(2)(vi) Income-tax Act 1961 — spread is a perquisite taxed at slab rate;
    // employer must withhold TDS under §192 in payroll cycle of exercise.
    extra.in_perquisite_tax_at_exercise = "true";
  }
  if (input.region === "JP") {
    // Income Tax Act §29-2: tax-qualified vs non-qualified determines exercise-time tax.
    extra.jp_tax_qualified_option = String(Boolean(input.jpTaxQualified));
    if (!input.jpTaxQualified) {
      // Non-qualified: spread taxed as employment income (up to ~55% combined national+local).
      extra.jp_income_tax_at_exercise = "true";
    }
  }
  if (input.region === "AU") {
    // ESS startup concession under §83A-105: no tax until disposal.
    extra.au_ess_startup_concession_eligible = String(Boolean(input.auEssStartupConcession));
    if (!input.auEssStartupConcession) {
      // Deferred-tax regime: taxing point is earliest of cessation, 15-yr ceiling, or sale.
      extra.au_ess_deferred_tax_regime = "true";
    }
  }

  const trace: TraceStep = {
    formulaId: input.formulaId,
    formulaVersion: input.formulaVersion,
    region: input.region,
    inputs: {
      exercisedOptions: input.exercisedOptions.toString(),
      exercisePrice: input.exercisePrice,
      fmvPerShare: input.fmvPerShare ?? "",
      cashless: String(input.cashless),
    },
    outputs: {
      sharesIssued: sharesIssued.toString(),
      ...extra,
    },
    defHash: hashFormulaDef(input.formulaDef),
  };

  return { sharesIssued, trace };
}
