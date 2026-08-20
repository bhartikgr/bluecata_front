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

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 71 · D10 — A PARTICIPATING CLASS'S PARTICIPATION IS MEASURED AGAINST
     THE PREFERENCES THAT ARE ACTUALLY TAKEN.
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured. `totalPreferenceCash` was summed ONCE, over EVERY
     class, BEFORE any convert-or-take decision had been made, and
     `remainingAfterAllPref = exit − totalPreferenceCash` is what each
     participating class's pro-rata slice is measured against. A class that
     CONVERTS waives its preference and takes no preference cash at all — but the
     residual every other participating class shared was still reduced by it.

     Executed, exit $50,000,000, Series A participating and uncapped,
     Series B participating with $4,000,000 invested:

       Series B's treatment              | B's outcome        | A's TOTAL
       ----------------------------------|--------------------|-------------
       uncapped                          | $13,000,000        | $19,000,000
       capped 4x (does not bind)         | $13,000,000        | $19,000,000
       capped 2x (BINDS -> B CONVERTS)   | $10,333,333.33…    | $19,000,000

     A's payout was IDENTICAL in all three. A's participation was computed as if B
     had taken a $4,000,000 preference that B did not take. The company-level
     arithmetic was conserved in every run (Σ payouts + remainder = the exit)
     because the residual absorbed the error — so this never showed up as money
     appearing or disappearing. It showed up only in the SPLIT between Series A
     and the founders, which is the number both of them care about.

     THE FIX, and why it needs a fixed point rather than a reordering. The
     decisions and the total are mutually dependent:
       · a NON-PARTICIPATING class's decision (`asConvertedAtFull > preferenceFull`)
         does NOT depend on the total, so those converters are known immediately;
       · a PARTICIPATING class converts only when its participation cap BINDS, and
         its participation depends on `remainingAfterAllPref`, which depends on the
         total, which depends on who converted.
     Excluding a converter can only RAISE the residual, which can only RAISE
     another class's participation, which can only make a cap MORE likely to bind.
     So the converter set is monotonically non-decreasing under iteration and the
     loop terminates in at most one pass per class. Convergence is by exact set
     equality, never a tolerance.

     `computeParticipatingShares` IS ALSO FIXED, and it is the second half of the
     same defect: it counted a class as participating even after the cap had forced
     it to convert, so a converter's shares sat in the participation denominator
     AND in the residual pool. It now takes the converter set and excludes them.

     WHAT WAVE 71 DELIBERATELY DID NOT CHANGE, AND WHY WAVE 79 HAD TO. Wave 71
     left the converters OUT of the participation denominator and called that "a
     modelling question about which residual pool is which, not an arithmetic
     error", recorded as an owner question in `build_log/wave71/`. THAT REASON WAS
     WRONG, and the paragraph is kept here rather than erased so the record shows
     what was believed and what corrected it. See the WAVE 79 block below: leaving
     them out pays ONE residual at TWO different per-share prices, and on this
     wave's own advertised fixture it made the FOUNDERS' error more than three
     times LARGER than it was before Wave 71. Conservation held in every run either
     way, which is exactly why it never showed up as money appearing or
     disappearing — only as the split.

     AUTHORITY. NVCA Model Certificate of Incorporation, Article IV §2 (liquidation
     preference and participation): a holder electing to convert to Common Stock
     is treated AS a holder of Common Stock and receives no Preferred payment —
     which is precisely why its preference cannot be inside the sum that sizes
     everyone else's participation. https://nvca.org/model-legal-documents/ */
  const preferenceIsTaken = (p: WaterfallClass, converters: ReadonlySet<string>): boolean =>
    !converters.has(p.classId);

  const preferenceCashExcluding = (converters: ReadonlySet<string>): Decimal =>
    sortedPreferred.reduce<Decimal>(
      (s, p) => (preferenceIsTaken(p, converters) ? s.plus(D(p.invested).mul(D(p.liquidationPreferenceMultiple))) : s),
      ZERO,
    );

  /* ════════════════════════════════════════════════════════════════════════
     WAVE 79 · ITEM 1 (Review A §D-A1) — ONE RESIDUAL, ONE POOL, ONE PRICE.
     ════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured. A class that CONVERTS was excluded from the
     PARTICIPATION denominator (Wave 71's fix, correct) and yet was still paid out
     of the SAME residual through `sharesInPool` in Step 2 (unchanged). So one pool
     of money was divided by two different share counts, and the residual was paid
     at two different per-share prices at once.

     Executed on Wave 71's own advertised $50,000,000 fixture — Series A $10m /
     4,000,000 shares participating uncapped, Series B $4m / 4,000,000 shares
     participating with a 2× cap that BINDS so B converts, founders 8,000,000
     common. Taken from the engine's OWN output fields, not recomputed:

       Series A participation  = $13,333,333.33 over 4,000,000 shares = $3.3333/share
       founders + converted B  =                                        $2.2222/share
       residual actually available (exit − A's $10m preference) =      $40,000,000
       common-equivalent shares that share it (8m common + 4m A + 4m converted B) = 16,000,000
       $3.3333 × 16,000,000   = $53,333,333.33 out of a $40,000,000 residual.

     A RATE THAT WOULD NEED $53.33m OUT OF $40m IS NOT A POOL PRICE. It is not a
     modelling preference about which pool is which; it is an unbalanced division.
     Conservation was preserved only because Step 2 absorbed the difference, which
     is precisely what Wave 71 said of the half it did fix.

     THE CORRECTION, and its size. Against an independent model of standard
     American venture terms written in exact BigInt rationals
     (`build_log/wave79/w79_independent_waterfall.mts`, which agrees with this
     engine TO THE DIGIT on every non-converting fixture — that agreement is what
     makes its disagreement credible):

       $50m exit, B's 2× cap binds | correct | pre-Wave-71 | post-Wave-71 (the defect)
       Series A                    | 20,000,000 | 19,000,000     | 23,333,333.33
       Series B                    | 10,000,000 | 10,333,333.33  |  8,888,888.89
       Founders                    | 20,000,000 | 20,666,666.67  | 17,777,777.78

     THE FOUNDERS' ERROR WAS MORE THAN THREE TIMES LARGER AFTER WAVE 71 THAN
     BEFORE IT (+$666,666.67 -> −$2,222,222.22), and $23,333,333 was reported to
     the owner as a corrected figure. It was not one.

     AUTHORITY. NVCA Model Certificate of Incorporation, Article IV §2: a holder
     that elects to convert IS a holder of Common Stock. After the preferences
     actually taken, one residual is shared pro rata by one pool of
     common-equivalent shares at one price. A converter's shares therefore belong
     in the participation denominator — the same denominator Step 2 already uses.
     https://nvca.org/model-legal-documents/

     WHY THIS CANNOT CHANGE A NON-CONVERTING CASE. `convertedSharesOf` is a sum
     over the converter set, so it is exactly `0n` whenever nothing converts, and
     `x + 0n` is `x`. Every fixture with no converter is byte-identical — pinned
     over 4,000 randomised fixtures in `w79_waterfall_split.test.ts`, and that is
     the set where this engine already agrees with the independent model.

     WHY THE FIXED POINT STILL TERMINATES, restated because the fix changes the
     monotonicity argument above rather than merely inheriting it. When a class
     moves from participating to converted it now LEAVES `participatingSharesNow`
     and ENTERS `convertedSharesOf`, so `denom` is UNCHANGED, while `prefCash`
     falls and the residual therefore RISES. Every other participating class's
     participation can only rise, so a cap can only become MORE likely to bind. The
     converter set is still monotonically non-decreasing and still converges by
     exact set equality, never a tolerance. */
  const convertedSharesOf = (converters: ReadonlySet<string>): bigint =>
    sortedPreferred
      .filter((p) => converters.has(p.classId))
      .reduce<bigint>((s, p) => s + p.shares, BigInt(0));

  /* Pass 0 — the decisions that do not depend on the total at all. */
  const seedConverters = new Set<string>();
  for (const pref of sortedPreferred) {
    if (pref.participating) continue;
    const preferenceFull0 = D(pref.invested).mul(D(pref.liquidationPreferenceMultiple));
    const asConvertedAtFull0 = D(pref.shares.toString())
      .mul(exit)
      .div(D(totalAsConvertedShares.toString()));
    if (asConvertedAtFull0.gt(preferenceFull0)) seedConverters.add(pref.classId);
  }

  /* Fixed point over the participating classes' cap-binding decisions. */
  let converters: Set<string> = seedConverters;
  for (let pass = 0; pass <= sortedPreferred.length; pass++) {
    const prefCash = preferenceCashExcluding(converters);
    const next = new Set<string>(converters);
    const participatingSharesNow = sortedPreferred
      .filter((p) => p.participating && !converters.has(p.classId))
      .reduce<bigint>((s, p) => s + p.shares, BigInt(0));
    /* WAVE 79 · ITEM 1 — site 1 of 2. `+ convertedSharesOf(converters)` is the
       whole fix here; it is `0n` when nothing has converted. */
    const denom = participatingSharesNow + totalCommonShares + convertedSharesOf(converters);
    for (const pref of sortedPreferred) {
      if (!pref.participating || converters.has(pref.classId)) continue;
      if (pref.participationCapMultiple === undefined) continue;
      const preferenceFullP = D(pref.invested).mul(D(pref.liquidationPreferenceMultiple));
      const preferenceP = preferenceFullP.gt(exit) ? exit : preferenceFullP;
      const residual = exit.minus(prefCash);
      let participationP = ZERO;
      if (residual.gt(0) && denom > BigInt(0)) {
        participationP = D(pref.shares.toString()).mul(residual).div(D(denom.toString()));
      }
      const totalP = preferenceP.plus(participationP);
      const capP = D(pref.invested).mul(D(pref.participationCapMultiple));
      if (totalP.gt(capP)) {
        const asConvertedAtFullP = D(pref.shares.toString())
          .mul(exit)
          .div(D(totalAsConvertedShares.toString()));
        if (asConvertedAtFullP.gt(capP)) next.add(pref.classId);
      }
    }
    if (next.size === converters.size) break;   /* exact set equality — no tolerance */
    converters = next;
  }

  /* THE number the participating classes are measured against: the preferences
     that are actually taken, and nothing else. */
  const totalPreferenceCash: Decimal = preferenceCashExcluding(converters);

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
      /* WAVE 71 · D10 — a class the cap forced to CONVERT is not a participant:
         it is paid from the residual pool in Step 2 instead. Passing the whole list
         counted it in both places. */
      const stillParticipating = sortedPreferred.filter((p) => !converters.has(p.classId));
      /* WAVE 79 · ITEM 1 — site 2 of 2. The converters are excluded from
         `stillParticipating` (Wave 71, correct: they take no preference and no
         PREFERRED participation) and added back as COMMON-EQUIVALENT shares, which
         is what they are once they convert and is exactly the pool `sharesInPool`
         pays in Step 2. One residual, one denominator, one price. `0n` when
         nothing has converted. */
      const totalParticipatingShares =
        computeParticipatingShares(stillParticipating) + totalCommonShares + convertedSharesOf(converters);
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

/**
 * The shares that participate in the residual as PREFERRED.
 *
 * WAVE 71 · D10 — its BODY is unchanged, deliberately. The second half of D10 was
 * that this function was handed EVERY class, including classes whose participation
 * cap had already forced them to CONVERT — so a converter's shares sat in the
 * participation denominator here AND in `sharesInPool` in Step 2, counted twice.
 * The fix is at the CALL SITE, which now passes only the classes that are still
 * participating. Filtering at the call site rather than adding a parameter keeps
 * this function a single-purpose sum over whatever it is given, and keeps the
 * "who converted" decision in exactly one place.
 */
function computeParticipatingShares(prefs: WaterfallClass[]): bigint {
  return prefs.filter((p) => p.participating).reduce((s, p) => s + p.shares, 0n);
}
