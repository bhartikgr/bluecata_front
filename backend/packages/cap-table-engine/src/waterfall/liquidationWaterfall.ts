/**
 * Liquidation waterfall.
 *
 * Pays out:
 *   1. Most-senior preferred class first; gets max(invested×LP_multiple, asConvertedShare).
 *   2. Participating preferred: after preference, also participates pro-rata in remaining
 *      proceeds with common, optionally capped at participationCapMultiple × invested.
 *   3. Non-participating preferred takes max of (preference) vs (as-converted share).
 *   4. Common shareholders split the remainder pro-rata.
 *
 * Reference: NVCA Model Certificate §2 (Liquidation Preference); Pulley waterfall guide.
 *
 * NOTE: This implementation handles multi-class senior stacking. For each class, the
 * "as converted" alternative is computed and compared. The function is deliberately
 * conservative — when math is ambiguous it defers to the literal preference text.
 */
import { D, Decimal, ZERO } from "../primitives/bigDecimal.js";
import { hashFormulaDef } from "../primitives/hash.js";
import type { TraceStep, Region } from "../types.js";

export type WaterfallClass = {
  classId: string;
  className: string;
  invested: string;
  shares: bigint;
  liquidationPreferenceMultiple: number;
  participating: boolean;
  participationCapMultiple?: number;
  seniority: number;            // 0 = most senior
};

export type WaterfallCommonHolder = {
  holderId: string;
  shares: bigint;
};

export type WaterfallInput = {
  exitProceeds: string;         // Decimal
  preferred: WaterfallClass[];
  common: WaterfallCommonHolder[];
  formulaId: string;
  formulaVersion: string;
  region: Region;
  formulaDef: Record<string, unknown>;
  /**
   * Optional withholding-tax rate applied to exit proceeds BEFORE the preference
   * stack. Used in jurisdictions where onshore distributions to an offshore parent
   * are subject to dividend WHT (e.g. mainland China: 10% standard, 5% under HK-PRC
   * double-tax treaty).
   * Decimal-as-string, e.g. "0.10" for 10%. Omit or pass "0" to disable.
   */
  withholdingTaxRate?: string;
  /**
   * AU-specific: when true, indicates that holdings being liquidated qualify for
   * the 50% CGT discount under ITAA 1997 §115-100 (asset held > 12 months by
   * AU-resident individual / qualifying trust / SMSF). Engine emits
   * au_cgt_50_percent_discount_eligible: true in the trace.
   */
  auCgtDiscountEligible?: boolean;
};

export type WaterfallPayout = {
  classId?: string;
  holderId?: string;
  className?: string;
  preferenceTaken: string;
  participation: string;
  asConvertedTaken: string;
  total: string;
  decision: "preference_then_participate" | "preference_only" | "as_converted" | "common_pro_rata";
};

export type WaterfallOutput = {
  payouts: WaterfallPayout[];
  remainder: string;
  trace: TraceStep;
};

export function computeWaterfall(input: WaterfallInput): WaterfallOutput {
  const grossExit = D(input.exitProceeds);
  const whtRate = input.withholdingTaxRate ? D(input.withholdingTaxRate) : ZERO;
  const whtAmount = whtRate.gt(0) ? grossExit.mul(whtRate) : ZERO;
  const exit = grossExit.minus(whtAmount);
  let remaining = exit;

  const sortedPreferred = [...input.preferred].sort((a, b) => a.seniority - b.seniority);
  const totalCommonShares = input.common.reduce((s, c) => s + c.shares, 0n);
  const totalPreferredShares = sortedPreferred.reduce((s, p) => s + p.shares, 0n);
  const totalAsConvertedShares = totalCommonShares + totalPreferredShares;

  // Step 1: pay each preferred class its preference in seniority order, deciding
  //   for non-participating: take max(preference, as-converted) BUT if as-converted is
  //   chosen we treat that class like common (no preference, share pro-rata at the end).
  // Strategy: first compute each class's would-be as-converted share at the *full* exit
  // proceeds; if that is greater than preference + participation outcome, the rational
  // class converts. Otherwise it takes preference (and participates if applicable).

  const payouts: WaterfallPayout[] = [];
  const treatAsCommon = new Set<string>();

  // First pass: decide convert vs preference for each preferred class
  const totalPreferenceCash: Decimal = sortedPreferred.reduce<Decimal>((s, p) => {
    return s.plus(D(p.invested).mul(D(p.liquidationPreferenceMultiple)));
  }, ZERO);

  /* v25.20 Lane 2 NC3 (hard close) — the waterfall cannot pay out more than
     the exit proceeds. Pre-v25.20 a $10M 1× preference on an $8M exit
     reported a $10M payout from an $8M pool. We now track `prefBudget` as we
     walk classes in seniority order and clamp each preference at the
     remaining budget. Lower-seniority classes get $0 if higher classes
     exhausted the pool (standard NVCA stacking).

     Note: the test asserted `total >= 8000000`, which we PRESERVE — the
     test will still pass when the new code returns 8,000,000 (the correct
     amount). The bug-acknowledging comment in the test no longer needs to
     apologise. */
  let prefBudget: Decimal = exit;

  for (const pref of sortedPreferred) {
    const preferenceFull: Decimal = D(pref.invested).mul(D(pref.liquidationPreferenceMultiple));
    // v25.20 Lane 2 NC3: clamp preference at remaining exit budget.
    const preference: Decimal = preferenceFull.gt(prefBudget) ? prefBudget : preferenceFull;
    const asConvertedAtFull: Decimal = D(pref.shares.toString())
      .mul(exit)
      .div(D(totalAsConvertedShares.toString()));
    if (pref.participating) {
      // Participating: takes preference + pro-rata of remaining
      // Decision is to participate; the cap may force conversion if cap binds
      const remainingAfterAllPref = exit.minus(totalPreferenceCash);
      const totalParticipatingShares = computeParticipatingShares(sortedPreferred) + totalCommonShares;
      let participation = ZERO;
      if (remainingAfterAllPref.gt(0) && totalParticipatingShares > 0n) {
        participation = D(pref.shares.toString())
          .mul(remainingAfterAllPref)
          .div(D(totalParticipatingShares.toString()));
      }
      let total = preference.plus(participation);
      // Apply cap
      if (pref.participationCapMultiple !== undefined) {
        const cap = D(pref.invested).mul(D(pref.participationCapMultiple));
        if (total.gt(cap)) {
          // If as-converted exceeds cap, convert instead
          if (asConvertedAtFull.gt(cap)) {
            treatAsCommon.add(pref.classId);
            continue;
          }
          total = cap;
          // Adjust components: keep preference; participation = cap − preference
          participation = cap.minus(preference);
          if (participation.lt(0)) participation = ZERO;
        }
      }
      // v25.20 Lane 2 NC3: final clamp — a single class cannot exceed remaining budget.
      if (total.gt(prefBudget)) {
        total = prefBudget;
      }
      payouts.push({
        classId: pref.classId,
        className: pref.className,
        preferenceTaken: preference.toFixed(),
        participation: participation.toFixed(),
        asConvertedTaken: "0",
        total: total.toFixed(),
        decision: "preference_then_participate",
      });
      prefBudget = prefBudget.minus(total);
      if (prefBudget.lt(0)) prefBudget = ZERO;
    } else {
      // Non-participating: convert vs preference.
      //
      // v25.20 Lane 2 NC3 (post-verification fix — see /home/user/workspace/v25_20_math_verification.md):
      //
      //   The election decision (convert vs preference) MUST use the TRUE
      //   as-converted value computed against the FULL exit (lines 123-125),
      //   NOT clamped to the residual prefBudget. Clamping the election
      //   value conflates the rational-actor decision with the downstream
      //   cash constraint, and can wrongly flip a junior class with large
      //   equity (whose unclamped as-converted exceeds preference) into
      //   preference_only — zeroing common's residual share.
      //
      //   Concrete regression case the verification probe surfaced:
      //     Senior $17M / Junior $4M (owns 9M/10M shares) / common 1M / exit $20M.
      //     With clamp: Junior gets $3M, common $0. WRONG.
      //     Without clamp: Junior converts, takes 9M/10M of $3M residual = $2.70M, common $0.30M. NVCA-correct.
      //
      //   The cash budget is still enforced safely: the preference path's
      //   payout uses the already-budget-clamped `preference` (line 122) and
      //   decrements prefBudget below; the convert path does NOT add to
      //   payouts here — it only flags treatAsCommon and is paid from
      //   `remaining = exit − paidPref` (lines 192–194, floored at 0).
      if (asConvertedAtFull.gt(preferenceFull)) {
        treatAsCommon.add(pref.classId);
      } else {
        payouts.push({
          classId: pref.classId,
          className: pref.className,
          preferenceTaken: preference.toFixed(),
          participation: "0",
          asConvertedTaken: "0",
          total: preference.toFixed(),
          decision: "preference_only",
        });
        prefBudget = prefBudget.minus(preference);
        if (prefBudget.lt(0)) prefBudget = ZERO;
      }
    }
  }

  // Subtract everything paid so far
  const paidPref: Decimal = payouts.reduce<Decimal>((s, p) => s.plus(D(p.total)), ZERO);
  remaining = exit.minus(paidPref);
  /* v25.20 Lane 2 NC3 — safety: remaining never goes negative. */
  if (remaining.lt(0)) remaining = ZERO;

  // Step 2: pro-rata distribute remaining among common + classes treated-as-common
  const sharesInPool = totalCommonShares + sortedPreferred.filter((p) => treatAsCommon.has(p.classId))
    .reduce((s, p) => s + p.shares, 0n);

  if (sharesInPool > 0n && remaining.gt(0)) {
    for (const c of input.common) {
      const share = D(c.shares.toString()).mul(remaining).div(D(sharesInPool.toString()));
      payouts.push({
        holderId: c.holderId,
        preferenceTaken: "0",
        participation: "0",
        asConvertedTaken: share.toFixed(),
        total: share.toFixed(),
        decision: "common_pro_rata",
      });
    }
    for (const pref of sortedPreferred) {
      if (!treatAsCommon.has(pref.classId)) continue;
      const share = D(pref.shares.toString()).mul(remaining).div(D(sharesInPool.toString()));
      payouts.push({
        classId: pref.classId,
        className: pref.className,
        preferenceTaken: "0",
        participation: "0",
        asConvertedTaken: share.toFixed(),
        total: share.toFixed(),
        decision: "as_converted",
      });
    }
    remaining = ZERO;
  }

  return {
    payouts,
    remainder: remaining.toFixed(),
    trace: {
      formulaId: input.formulaId,
      formulaVersion: input.formulaVersion,
      region: input.region,
      inputs: {
        exitProceeds: grossExit.toFixed(),
        preferredCount: String(input.preferred.length),
        commonCount: String(input.common.length),
        withholdingTaxRate: whtRate.toFixed(),
      },
      outputs: {
        totalPayouts: String(payouts.length),
        remainder: remaining.toFixed(),
        netExit: exit.toFixed(),
        withholdingTaxApplied: whtAmount.toFixed(),
        ...(input.region === "CN" && whtRate.gt(0)
          ? { cn_dividend_wht_applied: "true" }
          : {}),
        ...(input.region === "IN"
          ? { in_ccps_required: "true" }
          : {}),
        ...(input.region === "JP"
          ? { jp_class_shares_required: "true" }
          : {}),
        ...(input.region === "AU"
          ? {
              au_corporations_act_filing: "true",
              au_cgt_50_percent_discount_eligible: String(Boolean(input.auCgtDiscountEligible)),
            }
          : {}),
      },
      defHash: hashFormulaDef(input.formulaDef),
      note: "1x/2x/3x preference, participating + cap, multi-class stacking",
    } satisfies TraceStep,
  };
}

function computeParticipatingShares(prefs: WaterfallClass[]): bigint {
  return prefs.filter((p) => p.participating).reduce((s, p) => s + p.shares, 0n);
}
