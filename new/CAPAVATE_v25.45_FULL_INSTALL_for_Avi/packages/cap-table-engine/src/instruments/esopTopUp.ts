/**
 * ESOP top-up math.
 *
 * Two modes — the difference is who bears the dilution:
 *
 * Pre-money pool top-up (most common at priced rounds):
 *   The new pool is created BEFORE the round closes — existing shareholders dilute themselves.
 *   Target post-round pool % = P
 *   Solve for T (additional pool shares) such that:
 *     (existingPool + T) / (existingShares + T + newInvestorShares) = P
 *
 *   newInvestorShares is determined by the round price; we treat them as fixed once PPS is set.
 *
 * Post-money pool top-up:
 *   Pool is added AFTER the round — new investors share the dilution with existing holders.
 *   Target post-round pool % = P
 *   Solve for T such that:
 *     (existingPool + T) / (existingShares + T + newInvestorShares + T_post) = P
 *   In simple form when "post-money" means the pool is part of post-money cap:
 *     T = (P × postMoneyShares) − existingPool
 *   where postMoneyShares already includes new investor shares.
 *
 * References:
 *   - YC primer "Pre-money vs post-money option pool"
 *   - Carta "Option pool shuffle" guide
 *   - Pulley pre-money pool calculator
 */
import { D, Decimal } from "../primitives/bigDecimal.js";
import { decimalToShares, type Shares } from "../primitives/shareCount.js";
import { hashFormulaDef } from "../primitives/hash.js";
import type { TraceStep, Region } from "../types.js";

export type EsopTopUpInput = {
  mode: "pre_money" | "post_money";
  targetPoolPercent: string;            // 0..1, e.g. "0.10" for 10%
  existingShares: bigint;               // common + preferred + already-issued options
  existingPool: bigint;                 // unallocated pool already on cap
  newInvestorShares: bigint;            // shares to be issued to new investors at the round
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
  /**
   * CN-specific: when true, the grant is phantom equity / SARs (Stock Appreciation
   * Rights) — a contractual cash-settled instrument, not actual share issuance.
   * The math still computes pool sizing for tracking purposes, but the trace
   * surfaces phantom_equity: true so downstream cap-table mutators skip the
   * actual share issuance.
   */
  phantomEquity?: boolean;
  /**
   * JP-specific: when true, the option grant qualifies under Income Tax Act
   * §29-2 (tax-qualified stock option). Trace surfaces jp_tax_qualified_option.
   */
  jpTaxQualified?: boolean;
  /**
   * AU-specific: when true, the company is eligible for the ESS startup
   * concession under ITAA 1997 §83A-105 (< 10 yr, < $50M turnover, unlisted,
   * AU-resident). When true, no tax accrues until disposal of vested ESS
   * interests; the trace surfaces au_ess_startup_concession_eligible: true.
   */
  auEssStartupConcession?: boolean;
};

export type EsopTopUpOutput = {
  poolSharesToAdd: Shares;
  newPoolTotal: Shares;
  newTotalShares: Shares;
  resultingPoolPercent: string;
  trace: TraceStep;
};

export function computeEsopTopUp(input: EsopTopUpInput): EsopTopUpOutput {
  const P = D(input.targetPoolPercent);
  const existing = D(input.existingShares.toString());
  const pool = D(input.existingPool.toString());
  const newInv = D(input.newInvestorShares.toString());

  let T: Decimal;
  if (input.mode === "pre_money") {
    // (pool + T) / (existing + T + newInv) = P  →  pool + T = P×(existing + newInv) + P×T
    // T(1−P) = P×(existing + newInv) − pool
    // T = (P×(existing + newInv) − pool) / (1 − P)
    const numerator: Decimal = P.mul(existing.plus(newInv)).minus(pool);
    const denominator: Decimal = D(1).minus(P);
    if (denominator.lte(0)) throw new Error("Pool target must be < 100%");
    T = numerator.div(denominator);
  } else {
    // post-money: pool is part of post-money cap
    // post-money shares (target) = existing + newInv + T
    // (pool + T) / (existing + newInv + T) = P
    // pool + T = P×existing + P×newInv + P×T
    // T(1−P) = P×(existing + newInv) − pool
    // SAME formula in this construction; the practical difference is which side
    // dilutes (the round price/PPS is computed differently in each mode upstream).
    const numerator: Decimal = P.mul(existing.plus(newInv)).minus(pool);
    const denominator: Decimal = D(1).minus(P);
    T = numerator.div(denominator);
  }

  if (T.lt(0)) T = D(0);  // already meets target

  const poolSharesToAdd = decimalToShares(T, "ceil");
  const newPoolTotal = input.existingPool + poolSharesToAdd;
  const newTotalShares = input.existingShares + input.newInvestorShares + poolSharesToAdd;
  const resultingPct = D(newPoolTotal.toString()).div(D(newTotalShares.toString()));

  return {
    poolSharesToAdd,
    newPoolTotal,
    newTotalShares,
    resultingPoolPercent: resultingPct.toFixed(),
    trace: {
      formulaId: input.formulaId,
      formulaVersion: input.formulaVersion,
      region: input.region,
      inputs: {
        mode: input.mode,
        targetPoolPercent: P.toFixed(),
        existingShares: input.existingShares.toString(),
        existingPool: input.existingPool.toString(),
        newInvestorShares: input.newInvestorShares.toString(),
      },
      outputs: {
        poolSharesToAdd: poolSharesToAdd.toString(),
        newPoolTotal: newPoolTotal.toString(),
        newTotalShares: newTotalShares.toString(),
        resultingPoolPercent: resultingPct.toFixed(),
        ...(input.phantomEquity
          ? { phantom_equity: "true", shares_issued: "0" }
          : {}),
        ...(input.region === "HK"
          ? { hk_income_tax_at_exercise: "true" }
          : {}),
        ...(input.region === "CN" && input.phantomEquity
          ? { cn_phantom_equity_no_samr_filing: "true" }
          : {}),
        ...(input.region === "IN"
          ? { in_perquisite_tax_at_exercise: "true" }
          : {}),
        ...(input.region === "JP"
          ? { jp_tax_qualified_option: String(Boolean(input.jpTaxQualified)) }
          : {}),
        ...(input.region === "AU"
          ? {
              au_corporations_act_filing: "true",
              au_ess_startup_concession_eligible: String(Boolean(input.auEssStartupConcession)),
            }
          : {}),
      },
      defHash: hashFormulaDef(input.formulaDef),
      note: input.mode === "pre_money"
        ? "Pre-money pool: dilution borne by existing shareholders"
        : "Post-money pool: dilution borne by all (incl. new round)",
    } satisfies TraceStep,
  };
}
