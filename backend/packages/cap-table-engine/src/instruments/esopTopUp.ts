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
 * ─────────────────────────────────────────────────────────────────────────────
 * WAVE 52c · B4 — THE PERCENT INTERFACE IS PERCENT-AS-WRITTEN (R16 / OR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE this wave `targetPoolPercent` was a FRACTION: "0.25" meant 25%, and
 * `"25"` computed `1 − 25 = −24` and threw "Pool target must be < 100%".
 * `resultingPoolPercent` came back as a fraction too (`0.25000003…`). That is a
 * factor-of-100 defect on the interface, and binding owner ruling R16 / OR-1 is
 * explicit: PERCENT-AS-WRITTEN, `1 = 1%`, `100 = 100%`, NO CONVERSION AT ANY
 * LAYER.
 *
 * The fix is NOT a `/100` at the boundary — R16 forbids conversion layers, and a
 * boundary divide is the same defect with a nicer name. Instead the ALGEBRA IS
 * RESTATED IN PERCENT UNITS. Writing Pp for the percent-as-written target:
 *
 *   fraction form:  T = (P·(E+N) − pool) / (1 − P)          with P = Pp/100
 *   percent form:   T = (Pp·(E+N) − 100·pool) / (100 − Pp)
 *
 * These are the SAME EXPRESSION with numerator and denominator both multiplied
 * by 100. Nothing is converted, nothing is scaled, and there is no layer at
 * which a unit changes: the percent goes in as a percent and the guard reads
 * `100 − Pp <= 0`. `resultingPoolPercent` is likewise DERIVED in percent units
 * (`newPoolTotal · 100 / newTotalShares`) rather than produced as a fraction and
 * multiplied afterwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WAVE 58 · SCOPE 1 — THE DENOMINATOR DEFECT IS FIXED (owner ruling R27)
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 52c recorded this defect by name and left it: `existingPool` was absent
 * from BOTH the equation being solved AND from `newTotalShares`, so the target
 * percentage was solved against a base that omitted the pool already on the cap
 * table, and the resulting percentage was then reported against a total that
 * omitted it too. The two omissions cancelled ON THE REPORTED NUMBER and did
 * NOT cancel on the share counts, which is why it read as "25.000%" and looked
 * right.
 *
 * REPRODUCED EXACTLY, before the fix (`existingShares` 8,000,000 founders,
 * `existingPool` 1,000,000, `newInvestorShares` 0, `targetPoolPercent` "25"):
 *   T                    = (25·8,000,000 − 100·1,000,000)/75 = 1,333,333.33… → 1,333,334
 *   newPoolTotal         = 2,333,334
 *   newTotalShares       = 9,333,334          ← omits the 1,000,000 existing pool
 *   resultingPoolPercent = 25.000005%         ← measured against 9,333,334
 * and the SAME top-up measured against the true total 10,333,334 is 22.580650%
 * — a 2.42-point overstatement of the founder's own dilution.
 *
 * AFTER the fix, same inputs:
 *   T                    = (25·(8,000,000+1,000,000+0) − 100·1,000,000)/75
 *                        = 1,666,666.67… → 1,666,667
 *   newPoolTotal         = 2,666,667
 *   newTotalShares       = 10,666,667        ← includes the existing pool
 *   resultingPoolPercent = 25.000002%        ← now TRUE of that total
 *
 * THE ALGEBRA. Writing E for `existingShares` (which by this type's own
 * contract EXCLUDES the unallocated pool), u for `existingPool`, N for
 * `newInvestorShares` and T for the top-up, the target condition is
 *
 *     (u + T) / (E + u + N + T) = P
 *  ⟹  T·(1 − P) = P·(E + u + N) − u
 *  ⟹  T = (P·(E + u + N) − u) / (1 − P)
 *  percent-as-written form (× 100/100, no conversion layer, R16):
 *     T = (Pp·(E + u + N) − 100·u) / (100 − Pp)
 *
 * INDEPENDENT CORROBORATION, not assertion. Three sources agree with the form
 * above and disagreed with the code:
 *  1. The SECOND, independently written engine already had it right:
 *     `packages/cap-table-engine-ref/src/refMath.ts::refEsopTopUp` solves
 *     `totalPool = Pp·(E + N)/(100 − Pp)` then `T = totalPool − u`, which is the
 *     same expression (multiply out: T(1−P) = P(E+N) − u(1−P) = P(E+u+N) − u).
 *     Its file comment states the correct denominator verbatim.
 *  2. `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.3 derives
 *     `S = (q·B/(1−k) − u)/(1 − q/(1−k))` with B INCLUDING the pre-existing
 *     unallocated pool u, and §10 lists "applying the pool-target percentage to
 *     the wrong base" as error 11, "off-by-a-lot, not off-by-one".
 *  3. The gross-up identity of §4.2, `F/(1 − p) = F + S`, now holds EXACTLY on
 *     the engine's own outputs with F the non-pool base and S the TOTAL pool:
 *     8,000,000/(1 − 0.25) = 10,666,666.67 and 8,000,000 + 2,666,667 =
 *     10,666,667 (the one-share gap is the documented ceil on T, below).
 *
 * WHY THE GOLDEN MASTER DID NOT CATCH IT. `test/golden-master/esop-topup.test.ts`
 * passed `existingShares: 9_000_000` while ALSO passing
 * `existingPool: 1_000_000`, and its own header described that 9,000,000 as
 * "8M founders + 1M existing pool" — i.e. the fixture DOUBLE-COUNTED the pool,
 * which is exactly the compensation the defective denominator needed. With the
 * fixture corrected to the contract (8,000,000) the reference figure 111,112 is
 * reproduced by the FIXED engine and returns 0 from the defective one.
 *
 * STILL OUT OF SCOPE, NAMED RATHER THAN HIDDEN. `applyTopUp` in `compute.ts`
 * folds GRANTED options and the UNALLOCATED reserve into one `existingPool`
 * figure, because the data model cannot separate them (§10 item 5 of the sent
 * response document). The percentage therefore targets granted+unallocated
 * together, which is NOT the Cooley/WSGR "unallocated pool" convention. That is
 * a data-model gap, not an arithmetic one, and it is disclosed in the trace.
 * Warrants are likewise absent from `applyTopUp`'s base — see the trace field
 * `poolTargetBaseExclusions`.
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
  /**
   * PERCENT-AS-WRITTEN (R16 / OR-1). `"10"` = 10%, `"25"` = 25%, `"100"` = 100%.
   * NOT a fraction. `"0.25"` means a quarter of one percent, and that is a
   * legitimate value, not a mis-scaled 25%.
   */
  targetPoolPercent: string;
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
  /** PERCENT-AS-WRITTEN (R16 / OR-1). `"25.000003"` = 25.000003%. */
  resultingPoolPercent: string;
  trace: TraceStep;
};

/** Percent-as-written whole, used as the algebraic unit base. Never a converter. */
const PERCENT_WHOLE = 100;

export function computeEsopTopUp(input: EsopTopUpInput): EsopTopUpOutput {
  /* Pp is the target IN PERCENT AS WRITTEN. It is never divided by 100. */
  const Pp = D(input.targetPoolPercent);
  const whole = D(PERCENT_WHOLE);
  const existing = D(input.existingShares.toString());
  const pool = D(input.existingPool.toString());
  const newInv = D(input.newInvestorShares.toString());

  /* WAVE 58 · R27 — the pool ALREADY ON THE CAP TABLE is part of the base the
     target percentage is measured against. It was missing from both branches.
     `existingShares` excludes it by this type's own contract, so it must be
     added here explicitly rather than assumed to be inside `existing`. */
  const baseInclExistingPool: Decimal = existing.plus(pool).plus(newInv);

  let T: Decimal;
  if (input.mode === "pre_money") {
    // (pool + T) / (existing + pool + newInv + T) = P
    // pool + T = P×(existing + pool + newInv) + P×T
    // T(1−P) = P×(existing + pool + newInv) − pool
    // T = (P×(existing + pool + newInv) − pool) / (1 − P)
    // WAVE 52c · B4 — restated in percent units, same expression × 100/100:
    // T = (Pp·(existing + pool + newInv) − 100·pool) / (100 − Pp)
    // WAVE 58 · R27 — `pool` added to the base; it was omitted.
    const numerator: Decimal = Pp.mul(baseInclExistingPool).minus(whole.mul(pool));
    const denominator: Decimal = whole.minus(Pp);
    if (denominator.lte(0)) throw new Error("Pool target must be < 100%");
    T = numerator.div(denominator);
  } else {
    // post-money: pool is part of post-money cap
    // post-money shares (target) = existing + pool + newInv + T
    // (pool + T) / (existing + pool + newInv + T) = P
    // T(1−P) = P×(existing + pool + newInv) − pool
    // SAME formula in this construction; the practical difference is which side
    // dilutes (the round price/PPS is computed differently in each mode upstream).
    // Percent-as-written form, identical restatement — see the pre_money branch.
    const numerator: Decimal = Pp.mul(baseInclExistingPool).minus(whole.mul(pool));
    const denominator: Decimal = whole.minus(Pp);
    if (denominator.lte(0)) throw new Error("Pool target must be < 100%");
    T = numerator.div(denominator);
  }

  if (T.lt(0)) T = D(0);  // already meets target

  const poolSharesToAdd = decimalToShares(T, "ceil");
  const newPoolTotal = input.existingPool + poolSharesToAdd;
  /* WAVE 58 · R27 — `input.existingPool` was ABSENT here. Its absence understated
     the denominator by exactly the pool already reserved, so every percentage
     derived below overstated the pool. */
  const newTotalShares =
    input.existingShares + input.existingPool + input.newInvestorShares + poolSharesToAdd;
  /* Derived DIRECTLY in percent-as-written. No fraction is produced here and
     then converted: the ×100 is part of the definition of "percent", the same
     way the ÷ is part of the definition of "ratio". */
  const resultingPct =
    newTotalShares === BigInt(0)
      ? D(0)
      : D(newPoolTotal.toString()).mul(whole).div(D(newTotalShares.toString()));

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
        /* Echoed back in the SAME unit it arrived in. */
        targetPoolPercent: Pp.toFixed(),
        targetPoolPercentUnit: "percent_as_written_r16",
        existingShares: input.existingShares.toString(),
        existingPool: input.existingPool.toString(),
        newInvestorShares: input.newInvestorShares.toString(),
      },
      outputs: {
        poolSharesToAdd: poolSharesToAdd.toString(),
        newPoolTotal: newPoolTotal.toString(),
        newTotalShares: newTotalShares.toString(),
        resultingPoolPercent: resultingPct.toFixed(),
        resultingPoolPercentUnit: "percent_as_written_r16",
        /* B4 named this denominator because it was a known defect. WAVE 58 · R27
           FIXED the defect, so the label now names a denominator that is true of
           the number beside it. R27: every rendered percentage carries its
           denominator label. */
        resultingPoolPercentDenominator:
          "existingShares + existingPool + newInvestorShares + poolSharesToAdd (WAVE 58 · R27: existingPool is now INSIDE the denominator and inside the solved base)",
        /* WAVE 58 · R27 — the base the TARGET percentage was solved against,
           stated as a number so a reviewer never has to re-derive it. */
        poolTargetBase: baseInclExistingPool.toFixed(),
        poolTargetBaseDefinition:
          "existingShares + existingPool + newInvestorShares",
        /* Named, not hidden: what this base still does NOT contain. */
        poolTargetBaseExclusions:
          "granted options are NOT separated from the unallocated reserve (one data-model figure); " +
          "warrants are not in compute.ts::applyTopUp's base",
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
