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
  ComputeOptions, CapTableResult, Security, Transaction, TraceStep, Region, PricedRound,
  PricingOrderMode, Holder,
} from "../types.js";
import { D } from "../primitives/bigDecimal.js";
import { computeView } from "./views.js";
import { applyMfn, applyMfnResolved } from "../conversion/mfnOrdering.js";
import { convertSafeToPreferred } from "../conversion/safeToPreferred.js";
import { convertNoteToPreferred } from "../conversion/noteToPreferred.js";
import { exerciseOption } from "../conversion/optionExercise.js";
import { exerciseWarrant } from "../conversion/warrantExercise.js";
import { applyBroadBasedWeightedAverage } from "../antiDilution/broadBasedWeightedAverage.js";
import { applyFullRatchet } from "../antiDilution/fullRatchet.js";
import { applyNarrowBasedWeightedAverage } from "../antiDilution/narrowBasedWeightedAverage.js";
import { computeEsopTopUp } from "../instruments/esopTopUp.js";
import { resolveFormula } from "../formulas/registry.js";
/* WAVE 71 · D8 — the ONE exact interest clock. See `primitives/timeElapsed.ts`
   for why the 365.25-day / 8-dp CONVENTION is unchanged and only the
   ARITHMETIC moved off IEEE-754, and why the adapter now imports the same
   function instead of reproducing the expression (Wave 70 had to duplicate it
   character-for-character to stop D4 coming back). */
import { exactYearsElapsedString } from "../primitives/timeElapsed.js";

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
      /* WAVE 52 · 52-Q6 OPTION 2 — pricing now happens AFTER the pool top-up and
         AFTER SAFE/note conversion. See priceAndBuildRound() below for the full
         before/after statement and why the solve is a fixed point. */
      const round = tx.round;
      const built = priceAndBuildRound(
        ledger, round, getTxDate(tx), region,
        /* WAVE 52b §11.6.2 — resolved from the DATABASE by the caller and passed
           in; this package never reads env or config. Absent = the corrected
           Wave 52 order, because the flag is a rollback and not a gate. */
        opts.pricingOrderMode ?? "w52_post_pool_post_conversion",
      );
      /* ═══════════════════════════════════════════════════════════════════
         WAVE 70 · D2 — `A` IS MEASURED IMMEDIATELY BEFORE THE DILUTIVE ISSUANCE.
         ═══════════════════════════════════════════════════════════════════
         THE DEFECT. `broadBaseShares` and `narrowBaseShares` inside
         `applyAntiDilutionPass` were computed on `ledger` AFTER this line, i.e.
         after `priceAndBuildRound` had already pushed the new round's own shares
         `C`, the converted SAFE/note shares and the pool top-up into it. So the
         dilutive issuance was inside its own anti-dilution base.

         THE AUTHORITY, which the leaf function already cites and the pipeline
         already contradicted: NVCA Model Certificate of Incorporation
         §4.4(d)(ii)(A) defines `A` as the shares outstanding IMMEDIATELY PRIOR
         TO the dilutive issuance. `broadBasedWeightedAverage.ts:4-22` says so in
         its own header. https://nvca.org/model-legal-documents/

         MEASURED on the documented fixture, identical input:
           A pre-issuance  13,000,000 -> NCP 2.14705882352941176470588235294117647
                                        newShares 4,657,534   delta +657,534
           A post-issuance 17,000,000 -> NCP 2.21428571428571428571428571428571428
                                        newShares 4,516,129   delta +516,129
         DIRECTION: the post-issuance base UNDER-compensates the protected holder
         by 141,405 shares (broad) / 160,428 shares (narrow). It was masked by
         finding D1, because nothing ever set `antiDilution` on an existing class.

         `preIssuanceLedger` is captured BEFORE the reassignment below and is used
         ONLY for `A`. `newPref` and `sharesIssuedInRound` (`C`) still come from
         the POST-issuance ledger, because `C` is by definition the issuance
         itself. */
      const preIssuanceLedger = ledger;
      ledger = built.ledger;
      const pps = built.pps;
      trace.push(built.pricingTrace);
      for (const t of built.trace) trace.push(t);
      built.formulaIds.forEach((id) => formulaIdsUsed.add(id));
      formulaIdsUsed.add("round.pricing.order");
      // Apply anti-dilution to existing preferred at lower seniority if NIP < their OIP
      ledger = applyAntiDilutionPass(
        ledger, pps.toFixed(), round, trace, formulaIdsUsed, region,
        /* WAVE 70 · D2 — the NVCA `A` base. See the block comment above. */
        preIssuanceLedger,
      );
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
  /* WAVE 71 · D14 — the pool top-up row's missing Holder, supplied here so the
     row renders with a name and the type `pool` instead of `pool` / `other`. */
  const viewHolders = withPoolHolder(opts.holders, ledger);
  const rows = computeView({
    view: opts.view,
    securities: ledger,
    holders: viewHolders,
    estimatedPps: undefined,
    estimatedCompanyCap: currentFullyDilutedShares(ledger),
  });

  const totalShares = rows.reduce<bigint>((s, r) => s + r.shares, 0n);

  // Add an ownership.percent trace so the badge has something to show
  const ownf = resolveFormula("ownership.percent", region);
  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 71 · D17 — THE TRACE'S OWN OWNERSHIP TOTAL IS NOW EXACT.
     ═══════════════════════════════════════════════════════════════════════
     THE DEFECT. This line read

         rows.reduce((s, r) => s + parseFloat(r.ownershipPercent), 0).toFixed(6)

     Every row's `ownershipPercent` is a FULL-PRECISION Decimal string; the trace
     parsed each one down to an IEEE-754 double and added the doubles. On several
     runs the float sum lands on `99.99999999999999` or `100.00000000000001` — a
     trace field that contradicts the invariant the package asserts elsewhere
     (`test/property/ownership-sums-100.test.ts`, which passes, and which measures
     the EXACT strings). Materiality is low; the inconsistency is the point, in a
     codebase whose rule is that no float touches money.

     NOW: summed in `decimal.js` at the package's declared precision, from the
     exact strings, then stated to 6 dp exactly as before. On a fixture whose
     float sum already read `100.000000` the value does not move — so this is a
     precision fix, not a number change, and the harness prints both.

     D18-AWARE. `ownershipPercent` may now be `null` (0 ÷ 0 is undefined, not
     zero). A `null` row is NOT read as `0`: the total is reported as the token
     `"undefined"`, because a sum that includes an undefined term is undefined.
     Adding zero would be the exact substitution D18 exists to remove. */
  const anyOwnershipUndefined = rows.some((r) => r.ownershipPercent === null);
  const exactOwnershipTotal = anyOwnershipUndefined
    ? "undefined"
    : rows
        .reduce((s, r) => s.plus(D(r.ownershipPercent as string)), D(0))
        .toFixed(6);
  trace.push({
    formulaId: "ownership.percent",
    formulaVersion: ownf.version,
    region,
    inputs: { totalShares: totalShares.toString(), holderRows: String(rows.length) },
    outputs: {
      totalOwnership: exactOwnershipTotal,
      /* Declared, so a reader never has to guess whether this figure was summed
         in floats. It used to be, and nothing said so. */
      totalOwnershipArithmetic: "decimal.js exact sum of the row strings, stated to 6 dp (WAVE 71 · D17)",
      ...(anyOwnershipUndefined
        ? { totalOwnershipUndefinedReason: "at least one row has a zero-share denominator (0 / 0), so the sum is undefined rather than zero (WAVE 71 · D18, owner ruling R47)" }
        : {}),
    },
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

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 71 · D14 — THE NEW POOL ROW HAS A HOLDER.
   ═══════════════════════════════════════════════════════════════════════════
   THE DEFECT, measured. Both places this file creates an option-plan top-up push
   a row with `holderId: "pool"` (the standalone `esop_topup` transaction and the
   priced round's `pushPoolTopUp`). No caller ever creates a `Holder` with that
   id — `adaptSecuritiesToEngine` builds holders from `s.holderName`, and no
   security is named "pool" — so `computeView` fell through to its raw-id fallback
   and the row rendered as:

       holderName="pool"   holderType="other"   kind=option   series="Pool"

   i.e. a lowercase `pool` row of type "other" sitting immediately beside the
   founder's properly-named `ESOP Pool` row of type `pool`. Both rows are the same
   employee option plan. Cosmetic, and VISIBLE on `/founder/captable` and on the
   Projection — which is why it is fixed rather than merely documented.

   THE ROW IS NOT REMOVED AND ITS SHARE COUNT IS NOT TOUCHED. D14's instruction is
   explicit: fix or document, DO NOT remove the row. The reserve is real dilution
   and deleting it would be a silent drop of the founder's own pool instruction.
   Only the identity is supplied.

   WHY A SYNTHETIC HOLDER AND NOT A RENAME OF THE ROW. `holderId` is the join key
   the whole engine groups by (`views.ts`, `reconcile.ts`'s `rowKey`), and every
   pool top-up in a run must group together. Changing the id would change
   reconciliation keys and hashes; supplying the missing Holder changes only what
   is DISPLAYED. An existing `pool` holder supplied by a caller WINS — this never
   overwrites a name someone else chose.

   `"pool"` IS a legal `Holder["type"]` (`types.ts`), so the row also stops
   claiming to be type "other". */
export const POOL_TOPUP_HOLDER_ID = "pool" as const;
export const POOL_TOPUP_HOLDER_NAME = "Option pool (unallocated reserve)" as const;

function withPoolHolder(holders: Holder[], ledger: Security[]): Holder[] {
  const needsPoolHolder = ledger.some((s) => s.holderId === POOL_TOPUP_HOLDER_ID);
  if (!needsPoolHolder) return holders;
  if (holders.some((h) => h.id === POOL_TOPUP_HOLDER_ID)) return holders;
  return [...holders, { id: POOL_TOPUP_HOLDER_ID, name: POOL_TOPUP_HOLDER_NAME, type: "pool" }];
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
  /* WAVE 58b · DEFECT 5 — WARRANTS ARE NOW IN THE POOL-TARGET BASE.
     BEFORE: `existingShares` filtered `common|preferred` and `existingPool`
     filtered `option`, so a `warrant` row was in NEITHER. A warrant's underlying
     shares are a real dilutive instrument and are inside every fully-diluted
     definition Capavate uses — `currentFullyDilutedShares` immediately above this
     function counts them (`sec.kind === "warrant" … underlyingShares`). Omitting
     them from the base the pool target is solved against is THE SAME DEFECT CLASS
     Wave 58 fixed for the existing pool: a denominator that omits a real dilutive
     instrument. It UNDER-sizes the top-up (too small a base produces too few
     shares), so the founder's negotiated pool percentage is silently missed.

     AUTHORITY. WSGR, "How do you calculate Series A price per share" — the
     fully-diluted pre-money capitalisation includes shares issuable on exercise
     of outstanding warrants; recorded in
     `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §12 Step 2, whose `D`
     composition carries a warrants term `W`.

     WHERE THEY GO. Into `existingShares`, NOT `existingPool`. `existingPool` is
     the NUMERATOR of the target percentage; a warrant is dilutive but is not part
     of the employee option plan, so counting it as pool would make the target
     percentage claim warrants are ESOP. Warrants enlarge the BASE only, exactly
     like common and preferred. */
  const existingIssuedShares = ledger
    .filter((s) => s.kind === "common" || s.kind === "preferred")
    .reduce<bigint>((sum, s) => sum + (s.shares ?? 0n), 0n);
  /* Kept as a SEPARATE reduce, added on, rather than folded into the line above:
     the line above is byte-identical to the pre-wave code, so a reviewer can see
     at a glance that the only change is an ADDITION to the base. */
  const existingWarrantShares = ledger
    .filter((s) => s.kind === "warrant")
    .reduce<bigint>((sum, s) => sum + (s.warrant?.underlyingShares ?? BigInt(0)), BigInt(0));
  const existingShares = existingIssuedShares + existingWarrantShares;
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
  /* WAVE 70 · D2 — the ledger as it stood IMMEDIATELY BEFORE the dilutive
     issuance. This is `A` in NVCA Model Certificate of Incorporation
     §4.4(d)(ii)(A) ("...outstanding immediately prior to such issue..."), which
     is the authority `broadBasedWeightedAverage.ts:4-22` already cites.
     https://nvca.org/model-legal-documents/
     Defaults to `ledger` so any future caller that does not supply it keeps the
     pre-Wave-70 behaviour visibly rather than silently. */
  preIssuanceLedger: Security[] = ledger,
): Security[] {
  const newPref = ledger.filter(
    (s) => s.kind === "preferred" && s.preferred && s.preferred.originalIssuePrice === newIssuePrice,
  );
  /* `A` — measured on the PRE-issuance ledger (D2). BROAD base: common +
     preferred + all option-plan shares + warrants' underlying. */
  const broadBaseShares = preIssuanceLedger.reduce<bigint>((s, sec) => {
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
      /* `A`, NARROW base — outstanding common + preferred only, and likewise
         measured IMMEDIATELY PRIOR to the issuance (D2, NVCA §4.4(d)(ii)(A)). */
      const narrowBaseShares = preIssuanceLedger
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

/* ===========================================================================
   WAVE 52 · 52-Q6 (OPTION 2) — THE ENGINE NOW PRICES *LAST*.

   WHAT THE ORDER WAS. Inside `issue_preferred_round`, the price per share was
   the FIRST thing computed:

       :99   const pps = D(round.pricePerShare ?? D(round.preMoneyValuation)
                            .div(currentFullyDilutedShares(ledger)).toFixed());
       :100  const newInvestorSharesDec = D(round.investmentAmount).div(pps);
       :101  const newInvestorShares = BigInt(...floor()...);
       :102  // Apply ESOP top-up first          <- the pool was pushed HERE
       :125  // Convert SAFEs in this round      <- SAFEs converted HERE
       :129  const companyCap = currentFullyDilutedShares(...)

   So when `round.pricePerShare` was ABSENT, the derived price was
   pre-money / (a denominator containing NEITHER the new pool NOR any
   converting instrument), and `newInvestorShares` was frozen from that
   premature price at :101 before either adjustment existed. On the canonical
   worked example the engine could only reach p = $3.00 on F0 = 10,000,000; the
   correct D = 15,000,000 and p = $2.00 were unreachable.

   Direction of the error: too small a denominator => too high a price => the
   incoming investor is overcharged and every existing holder's percentage is
   overstated. Same direction as the wizard-side defect (item 5a).

   WHAT THE ORDER IS NOW. Pricing is a FIXED POINT, solved before anything is
   written to the ledger:

       p_0     = stored PPS, else pre-money / FD(ledger)      (the old value)
       repeat: N_k = floor(I / p_k)
               T_k = pool top-up sized against N_k
               C_k = as-converted shares of every SAFE / note at p_k
               D_k = FD(ledger ex safe/note) + T_k + sum(C_k)
               p_k+1 = stored PPS, else pre-money / D_k
       until p_k+1 == p_k exactly (Decimal, no epsilon), or a repeat is seen.

   The pool top-up and the conversions are therefore APPLIED (in a throwaway
   copy of the ledger) BEFORE the price is settled, and the price that is
   finally written is derived from a denominator that includes both. The real
   pass then runs ONCE, with the converged price, in the same push order as
   before, so nothing downstream sees a different shape of ledger.

   WHY THIS IS SAFE FOR EXISTING ROWS. When `round.pricePerShare` IS supplied —
   which the wizard does for every priced round — p_0 is the stored price, the
   loop is skipped entirely, and the real pass is computed from exactly the same
   inputs in exactly the same order as before this change. The reference share
   counts that the sacred, hash-chained `server/captableCommitStore.ts`
   recomputes through `reconcile()` are therefore unchanged for every stored-PPS
   row. Only the PPS-ABSENT branch moves, and it moves from a provably wrong
   denominator to the correct one.

   WHY A FIXED POINT AND NOT A REORDERING OF THE LINES. The system is genuinely
   simultaneous, not merely mis-sequenced: the pool top-up T is sized against
   the new investor share count N (esopTopUp.ts solves
   (pool+T)/(existing+T+N) = P), N is floor(I/p), and p is pre-money/D where D
   contains T and the conversion shares. Straight-line code in ANY order cannot
   express that; only a solve can. Convergence is by EXACT Decimal equality with
   a repeat-detector, never a tolerance — an epsilon here permits a fabricated
   share.

   NOT CHANGED, AND FLAGGED FOR AN OWNER RULING. The post-money SAFE cap
   denominator (the v25.20 Lane 2 NC1 re-basing below) is left exactly as it is.
   The canonical worked example implies a SAFE conversion price of
   cap / (common + pool) = $0.80 and 2,500,000 SAFE shares, whereas YC v1.2's
   post-money construction — which the re-basing implements, and which the
   v25.20 evidence shows was a deliberate fix for a proven 900,000-vs-1,000,000
   defect — gives the SAFE its full purchase/cap share of the post-SAFE
   capitalization. Those two are different conventions, not a bug and a fix.
   Picking one is a modelling decision, so Wave 52 measures the divergence and
   does not silently resolve it. See build_log/wave52/W52_ENGINE_REORDER.md.
   =========================================================================== */

/** Hard ceiling on the pricing solve. Reached only if a cycle escapes the
    repeat-detector; the result is still returned, marked non-converged. */
const PRICING_MAX_ITERATIONS = 24;

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 72 · DEFECT 1 — A PRICE DOES NOT EXIST AGAINST A ZERO DENOMINATOR.
 * ═══════════════════════════════════════════════════════════════════════════
 * REPRODUCED, NOT REASONED ABOUT (`build_log/final_review/REVIEW_1_MATH.md`,
 * §"Still-wrong boundary", re-executed by `build_log/wave72/scratch/p1_repro.mts`):
 * a $30,000,000 pre-money and a $10,000,000 raise over a company with ZERO
 * fully-diluted shares returned a SUCCESSFUL cap table carrying
 *
 *     pricePerShare = "Infinity"   pricingDenominator = "0"
 *     newInvestorShares = "0"      converged = "false"
 *
 * i.e. the investor's $10,000,000 bought ZERO shares at an INFINITE price and
 * the platform reported success. `p = preMoney ÷ FD` is `30000000 ÷ 0`, and
 * `Decimal` division by zero yields `Infinity` rather than throwing, so nothing
 * downstream noticed: `floor(I ÷ Infinity) = 0` is a perfectly legal BigInt.
 *
 * WHY THIS IS A REFUSAL AND NOT A SUBSTITUTION. There are no shares to price
 * against, so no price exists — not a large one, not a zero one. Any figure put
 * here would be invented, and every share count and ownership percentage on the
 * projection is derived from it (the same reasoning R6/D16 applied to a missing
 * pre-money valuation, one boundary below this one).
 *
 * WHY IT IS THROWN HERE AND NOT ONLY IN THE ADAPTER. This is the ONE line in the
 * tree that divides a valuation by a share count, so it is the only place that
 * can promise `Infinity` is never emitted — including for the `legacy_pre_w52`
 * rollback mode, which skips the solve entirely and would otherwise carry the
 * same `Infinity` out. `shared/roundMathEngineAdapter.ts::projectPostClose`
 * translates this into the founder-facing `RoundMathTermRefusal`
 * (`zero_pricing_denominator`) that the HTTP surface already knows how to render.
 */
export class ZeroPricingDenominatorError extends Error {
  readonly code = "zero_pricing_denominator" as const;
  readonly field = "shares" as const;
  constructor(
    readonly roundId: string,
    readonly preMoneyValuation: string,
    readonly investmentAmount: string,
    readonly fdSharesBeforeRound: string,
  ) {
    super(
      `Round "${roundId}" cannot be priced: there are no fully-diluted shares to price against, so no ` +
      `price per share exists. Price per share is the pre-money valuation ÷ the fully-diluted share ` +
      `count, and that count is ${fdSharesBeforeRound} here, which would make the price ` +
      `arithmetically infinite and issue the incoming ${investmentAmount} ZERO shares against a ` +
      `${preMoneyValuation} pre-money valuation. Capavate will not report that as a closed price. ` +
      `Record the company's existing shares before projecting a priced round: equity originates ` +
      `through the round/ledger flow on /founder/rounds. The cap table at /founder/captable is ` +
      `VIEW-ONLY — its "Add security in Rounds" button links there (v25.48.3 Q-F1).`,
    );
    this.name = "ZeroPricingDenominatorError";
  }
}

type PricedRoundBuild = {
  ledger: Security[];
  newInvestorShares: bigint;
  /** D — fully-diluted count AFTER pool top-up and conversions, BEFORE the new
      investor shares. This is the pricing denominator. */
  denominatorShares: bigint;
  trace: TraceStep[];
  formulaIds: Set<string>;
};

/**
 * Applies the pool top-up, every SAFE conversion, every note conversion and the
 * new investor issuance at a GIVEN price. Pure with respect to `ledgerIn`: it
 * copies the array first and never mutates a member object.
 */
function buildPricedRound(
  ledgerIn: Security[],
  round: PricedRound,
  txDate: string,
  region: Region,
  pps: ReturnType<typeof D>,
  /* WAVE 52b §11.6.2 — see `PricingOrderMode` in types.ts. `legacy_pre_w52`
     restores the pre-Wave-52 order and, with it, all three measured arithmetic
     defects. A flag that cannot restore the prior behaviour is not a rollback,
     so this parameter is load-bearing rather than cosmetic. */
  mode: PricingOrderMode = "w52_post_pool_post_conversion",
): PricedRoundBuild {
  const legacy = mode === "legacy_pre_w52";
  let ledger: Security[] = [...ledgerIn];
  const sinkTrace: TraceStep[] = [];
  const sinkIds = new Set<string>();
  const tx = { date: txDate };

  /* ── WAVE 52 · 52-Q6 CONSEQUENCE 3 — THE CONVERTING INSTRUMENT'S OWN
     DENOMINATOR IS TAKEN *BEFORE* THE POOL TOP-UP. ───────────────────────────

     WHAT WAS WRONG. `companyCap` was computed at the old `:129`, i.e. AFTER the
     pool row had already been pushed at `:102-123`, and the filter excluded only
     `safe` and `note` — so a just-created pre-money pool sat inside the
     post-money SAFE's company-capitalization input.

     WHY THAT IS WRONG, in one line from the source authority: a post-money SAFE
     is post-money precisely BECAUSE its own denominator excludes the new pool
     reserved at the financing. On the canonical example the pre-SAFE
     fully-diluted base is 10,000,000, so

         SAFE share of company capitalization = $2,000,000 / $10,000,000 = 20%
         company capitalization = 10,000,000 / (1 − 0.20)  = 12,500,000
         SAFE price             = $10,000,000 / 12,500,000 = $0.80
         SAFE shares            = 12,500,000 − 10,000,000  = 2,500,000

     With the 2,500,000-share pool wrongly inside, the base became 12,500,000,
     the re-based denominator 15,625,000, the price $0.64, and the SAFE took
     3,125,000 shares — 625,000 shares of dilution the SAFE was not entitled to,
     taken from the founders.

     The v25.20 Lane 2 NC1 re-basing below is CORRECT and is untouched: with the
     right base it reproduces the authority's arithmetic exactly. The defect was
     never the formula; it was the order in which its input was measured. */
  const conversionCompanyCap = currentFullyDilutedShares(
    ledgerIn.filter((s) => s.kind !== "safe" && s.kind !== "note"),
  );

    const newInvestorSharesDec = D(round.investmentAmount).div(pps);
    const newInvestorShares = BigInt(newInvestorSharesDec.floor().toFixed(0));
    /* WAVE 52: the ESOP top-up used to be applied HERE, first, before any
       instrument converted — so it was sized against a share base that omitted
       every converting SAFE and note. It has moved BELOW the conversion loops.
       See the relocated block, and W52_ENGINE_REORDER.md.

       WAVE 52b: the push itself is now the closure `pushPoolTopUp` below, called
       from ONE of TWO places depending on the resolved flag. The body is
       IDENTICAL in both, so the flag changes the ORDER and nothing else — which
       is exactly what the defect was. */
    /* WAVE 58b · DEFECT 1.3 — POST-MONEY PLACEMENT IS NOW MODELLED, NOT DROPPED.
       BEFORE: the gate below read `&& round.optionPoolMode === "pre_money"`, so a
       round whose stored placement was `post_money` produced NO POOL ROW AT ALL.
       The founder chose a placement, the wizard quoted numbers, and the Projection
       then showed no pool whatsoever. That is a silent drop of the founder's own
       instruction, and R21 forbids it.

       WHAT DIFFERS BETWEEN THE TWO MODES, and it is exactly one thing: whether the
       new reserve is INSIDE the pricing denominator.
         pre-money  : pool INSIDE  -> p = PMV / (B + S) -> existing holders pay
         post-money : pool OUTSIDE -> p = PMV /  B      -> everyone pays pro-rata
       The TARGET CONDITION `(u + S)/(B + N + S) = q` is IDENTICAL in both, which
       is why `computeEsopTopUp` needs no new branch: its single expression
       `T = (Pp·(E + u + N) − 100·u)/(100 − Pp)` already solves that condition for
       whatever `newInvestorShares` it is handed. The placement is expressed HERE,
       by excluding the pool row from `denominatorShares` for post-money (see the
       `denominatorShares` computation at the end of this function), which is what
       makes `priceAndBuildRound`'s fixed-point solve converge on the un-grossed-up
       price.

       AUTHORITY. Pre-money placement is the model-form default (Cooley GO,
       "Negotiating the option pool"; `CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.1).
       Post-money placement is a NEGOTIATED DEPARTURE with no model-form authority
       — the arithmetic is derived from the same target condition rather than
       quoted, and `build_log/wave58b/W58B_PLACEMENT_MATH.md` proves the resulting
       dilution is exactly pro-rata.

       ABSENT STILL MEANS ABSENT: the gate is still on `optionPoolPostPercent`, so
       a round with no pool percentage behaves byte-identically to before. An
       UNRECOGNISED placement string is treated as `pre_money`, the market default,
       rather than dropping the pool. */
    const poolPlacement: "pre_money" | "post_money" =
      round.optionPoolMode === "post_money" ? "post_money" : "pre_money";
    const pushPoolTopUp = (): void => {
      if (round.optionPoolPostPercent) {
        const topup = applyTopUp(ledger, round.optionPoolPostPercent, poolPlacement, newInvestorShares, region);
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
          sinkTrace.push(topup.trace);
          sinkIds.add(f?.id ?? "esop.topup");
        }
      }
    };

    /* ROLLBACK POLE. The pre-Wave-52 order pushed the pool HERE, at the old
       `:102`, before any instrument converted — so the top-up was sized against a
       base omitting every converting SAFE and note, AND the pool row was already
       in the ledger when the SAFE's own company capitalization was measured. Both
       defects come back together, because they were one ordering bug. */
    if (legacy) pushPoolTopUp();

    // Convert SAFEs in this round
    const safes = ledger.filter((s) => s.kind === "safe");
    /* WAVE 52: measured BEFORE the pool top-up (see conversionCompanyCap above).
       Was: currentFullyDilutedShares(ledger.filter(...)) — i.e. after the push,
       which is precisely what the `legacy` branch restores, byte for byte.
       WAVE 71 · D13 — MOVED ABOVE THE MFN RESOLUTION. It is computed from
       `ledgerIn` / `ledger` and does not depend on the resolved SAFEs, so moving it
       up changes no value; it is moved because MFN now needs it. Verified by the
       engine's own 128 tests and by the h71 harness at both poles. */
    const companyCap = legacy
      ? currentFullyDilutedShares(ledger.filter((s) => s.kind !== "safe" && s.kind !== "note"))
      : conversionCompanyCap;
    /* ── WAVE 71 · D13 — MFN IS RESOLVED AGAINST THE REAL PRICING CONTEXT ─────
       Was: `applyMfn(s, { candidates: safes })` — no price, no denominator, so the
       resolver had nothing to compare candidates WITH and fell back to taking the
       lowest cap and the highest discount INDEPENDENTLY, which can compose a
       pairing no single SAFE offered. Both figures are known exactly at this point
       — `pps` is the solved round price and `companyCap` is the same denominator
       the conversion below divides the cap by — so the election is now decided by
       the actual conversion price, and ONE instrument's terms are adopted as a
       set. See `mfnOrdering.ts` for the YC authority. */
    const mfnResolutions: Array<{ securityId: string; adoptedFrom: string; basis: string }> = [];
    const resolvedSafes = safes.map((s) => {
      const r = applyMfnResolved(s, {
        candidates: safes,
        seriesPricePerShare: pps.toFixed(),
        companyCapitalization: companyCap.toString(),
      });
      if (r.resolution.applied) {
        mfnResolutions.push({
          securityId: s.id,
          adoptedFrom: r.resolution.adoptedFromSecurityId,
          basis: r.resolution.basis,
        });
      }
      return r.security;
    });
    if (mfnResolutions.length > 0) {
      /* DISCLOSED, not silent. An MFN election REWRITES a holder's economic terms;
         a founder is entitled to see which instrument's terms were adopted and on
         what basis. R21 / no-silent-drops. */
      sinkTrace.push({
        formulaId: "safe.mfn",
        formulaVersion: "1.0.0",
        region,
        inputs: {
          mfnSafeCount: String(mfnResolutions.length),
          seriesPricePerShare: pps.toFixed(),
          companyCapitalization: companyCap.toString(),
        },
        outputs: {
          elections: mfnResolutions
            .map((m) => `${m.securityId} adopted the terms of ${m.adoptedFrom} (basis: ${m.basis})`)
            .join("; "),
          termsAdoptedAs: "a SET from ONE instrument — cap, discount and cap convention together",
          authority: "Y Combinator safe financing documents, Most Favored Nation provision (https://www.ycombinator.com/documents)",
        },
        defHash: "see-formula",
        note: "MFN election: the holder adopts one later instrument's terms as a package, never a best-of",
      });
      sinkIds.add("safe.mfn");
    }

    /* v25.20 Lane 2 NC1 (hard close) — post-money SAFE cap denominator.

       Empirically proven bug: a $1M post-money SAFE at $10M cap produced
       900,000 shares / 8.65% instead of the correct 1,000,000 / 10%.

       Root cause: every SAFE conversion in the loop below was using the
       SAME `companyCap` (the pre-SAFE fully-diluted count). For a YC
       post-money SAFE, the cap denominator must INCLUDE the SAFE's own
       shares (and all other post-money SAFEs converting at the same time).

       YC formula:
         sharesIssued = SAFE_amount * S0 / (cap - sum(post_money_SAFE_amounts))
       where S0 is the pre-SAFE fully-diluted count, and the sum is over
       all post-money SAFEs at THIS conversion event.

       For pre-money SAFEs the original denominator (`companyCap`) is
       correct — the SAFE shares are an additional pool on top. */
    const totalPostMoneySafeAmt = resolvedSafes
      .filter((s) => s.safe?.type === "post_money_cap")
      .reduce((acc, s) => acc.add(D(s.investmentAmount ?? "0")), D(0));

    /* v25.20 Lane 2 NC1 — companyCap is a BigInt; convert to Decimal for math. */
    const companyCapDecimal = D(companyCap.toString());

    for (const safe of resolvedSafes) {
      if (!safe.safe) continue;
      const f = resolveFormula(
        safe.safe.type === "post_money_cap" ? "safe.postmoney.conversion" : "safe.premoney.conversion",
        region,
      );
      /* v25.20 Lane 2 NC1: pick the right denominator per SAFE type. */
      const safeCap = D(safe.safe.cap ?? "0");
      let denominator = companyCap.toString();
      if (safe.safe.type === "post_money_cap" && safeCap.gt(0)) {
        // Effective cap (cap − sum of post-money SAFE $) so that
        // companyCap / effectiveCap == correct expansion factor.
        const effectiveCap = safeCap.minus(totalPostMoneySafeAmt);
        if (effectiveCap.gt(0)) {
          // Re-base companyCapitalization so the leaf function's
          // `capPrice = cap / companyCap` works out to:
          //   cap_real / (companyCap_real * cap_real/effectiveCap)
          //     = effectiveCap / companyCap_real
          //     = (cap - sum_safes) / S0   -- the correct post-money price.
          const rebased = companyCapDecimal.mul(safeCap).div(effectiveCap);
          denominator = rebased.toFixed(0);
        }
      }
      const result = convertSafeToPreferred({
        purchaseAmount: safe.investmentAmount ?? "0",
        capType: safe.safe.type,
        cap: safe.safe.cap,
        discount: safe.safe.discount,
        seriesPricePerShare: pps.toFixed(),
        companyCapitalization: denominator,
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
      sinkTrace.push(result.trace);
      sinkIds.add(f.id);
    }

    // Convert notes
    const notes = ledger.filter((s) => s.kind === "note");
    for (const note of notes) {
      if (!note.note) continue;
      const issued = new Date(note.note.issueDate);
      const closeDate = new Date(tx.date);
      /* WAVE 71 · D8 — was:
             (closeDate.getTime() - issued.getTime()) / (365.25 * 24 * 3600 * 1000)
         the only IEEE-754 float in the conversion path, in a codebase whose stated
         rule is that no float touches money. Same convention, exact arithmetic,
         and now shared with the adapter so the two cannot drift. */
      const yearsElapsed = exactYearsElapsedString(issued, closeDate);
      const f = resolveFormula("note.conversion", region);
      const result = convertNoteToPreferred({
        principal: note.note.principal,
        interestRate: note.note.interestRate,
        interestKind: note.note.interestKind,
        yearsElapsed,
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
      sinkTrace.push(result.trace);
      sinkIds.add(f.id);
    }

    /* ── WAVE 52 · THE POOL TOP-UP IS NOW SIZED AFTER CONVERSION ──────────────
       The target is a percentage of the POST-ROUND fully-diluted total, so the
       base it is solved against must already contain the converted SAFE and note
       shares. Applied before the new investor issuance (the pool is carved out of
       the PRE-money: existing holders dilute themselves, new money does not) and
       after conversion (the converted holders are existing holders by then).

       Canonical check: with the SAFE converted at 2,500,000 shares, the base is
       8,000,000 common + 2,500,000 converted preferred = 10,500,000 with a
       2,000,000 existing option pool; a 22.5% post-round pool target then yields
       exactly 2,500,000 new pool shares, D = 15,000,000 and p = $2.00.

       WAVE 58 · R27 — FIXED, AND THE CANONICAL TARGET RESTATED. Wave 52 recorded
       that computeEsopTopUp's `newTotalShares` omitted `existingPool` and left it.
       R27 makes the fix a prerequisite because the wizard now feeds this path a
       real percentage. Two consequences, both stated rather than smoothed over:

         1. `newTotalShares` and the SOLVED BASE both now include `existingPool`.
            See instruments/esopTopUp.ts for the algebra, the exact before/after
            numbers, and the independent corroboration from the second engine.
         2. The canonical target above was "25" and is now "22.5". The 25 was an
            artifact of the defect: through the wrong base, 25 produced the
            canonical 2,500,000 top-up. The scenario's TRUE post-round pool
            percentage is (2,000,000 + 2,500,000) / 20,000,000 = 22.5% — the very
            figure Wave 52c's own header called "the truth" while pinning 25.
            With the base corrected and the target set to 22.5, every canonical
            figure is reproduced unchanged: D = 15,000,000, p = $2.00,
            N = 5,000,000, T = 20,000,000, founders 40.000% of fully diluted.

       STILL NOT FIXED, NAMED: `applyTopUp` below folds granted options and the
       unallocated reserve into one `existingPool` figure (the data model cannot
       separate them) and does not include warrants in the base. Disclosed in the
       trace as `poolTargetBaseExclusions`. */
    /* WAVE 52b: the Wave 52 position for the push. Same closure, same body, six
       hundred lines of comment above explaining why the position matters. */
    if (!legacy) pushPoolTopUp();

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

  /* WAVE 58b · DEFECT 1.3 — THIS FILTER *IS* THE PLACEMENT.
     `denominatorShares` is the pricing denominator: `priceAndBuildRound` iterates
     `p := PMV / denominatorShares` to a fixed point. Excluding the new investor
     row makes it a PRE-money denominator. Additionally excluding the pool row
     makes the pool POST-money — the price is then `PMV / B`, unchanged by the
     pool, and the pool's dilution falls on founders and the new investor in
     proportion to their post-raise holdings. Including it (pre-money, the default)
     lowers the price and puts the whole cost on the existing holders. One line,
     both conventions, no duplicated arithmetic. */
  const denominatorShares =
    currentFullyDilutedShares(
      ledger.filter(
        (s) =>
          s.id !== `round-${round.id}-newpref` &&
          !(poolPlacement === "post_money" && s.id === `pool-topup-${round.id}`),
      ),
    );

  return { ledger, newInvestorShares, denominatorShares, trace: sinkTrace, formulaIds: sinkIds };
}

/**
 * Solves for the price per share, then builds the round ONCE at that price.
 * Returns the iteration transcript so the solve is auditable rather than
 * asserted — a gate that cannot be inspected is a number, not a gate.
 */
function priceAndBuildRound(
  ledgerIn: Security[],
  round: PricedRound,
  txDate: string,
  region: Region,
  mode: PricingOrderMode = "w52_post_pool_post_conversion",
): PricedRoundBuild & {
  pps: ReturnType<typeof D>;
  pricingTrace: TraceStep;
} {
  const legacy = mode === "legacy_pre_w52";
  const stored = round.pricePerShare ?? null;
  /* p_0 is byte-identically the value the pre-Wave-52 engine used, so the
     transcript shows exactly what moved. */
  let pps = D(stored ?? D(round.preMoneyValuation).div(currentFullyDilutedShares(ledgerIn)).toFixed());
  const trail: string[] = [pps.toFixed()];
  let converged = stored !== null;
  let iterations = 0;

  /* ROLLBACK POLE (WAVE 52b). The pre-Wave-52 engine had no solve at all: the
     price was `pre-money / FD(ledger)`, computed on the first line of
     `issue_preferred_round`, from a denominator containing neither the new pool
     nor any converting instrument. `legacy` therefore SKIPS THE LOOP ENTIRELY and
     keeps p_0 — which on the canonical example is $3.00 against a true $2.00.
     `converged` is reported as false so the trace never claims a fixed point it
     did not reach. */
  if (stored === null && !legacy) {
    const seen = new Set<string>([pps.toFixed()]);
    for (let k = 0; k < PRICING_MAX_ITERATIONS; k++) {
      iterations = k + 1;
      const dry = buildPricedRound(ledgerIn, round, txDate, region, pps, mode);
      if (dry.denominatorShares <= BigInt(0)) break;
      const next = D(round.preMoneyValuation).div(D(dry.denominatorShares.toString()));
      trail.push(next.toFixed());
      if (next.eq(pps)) {
        converged = true;
        break;
      }
      if (seen.has(next.toFixed())) {
        /* A floor()-induced 2-cycle. Stop on the LOWER price: it is the one that
           does not overcharge the incoming investor. Reported, never hidden. */
        if (next.lt(pps)) pps = next;
        break;
      }
      seen.add(next.toFixed());
      pps = next;
    }
  }

  /* WAVE 72 · DEFECT 1 — THE REFUSAL, BEFORE THE ROUND IS BUILT AT THIS PRICE.
     `pps` is non-finite for exactly one reason: the denominator it was derived
     from was zero (`Decimal` returns `Infinity`, and `0 ÷ 0` returns `NaN`).
     Checked AFTER the loop so it covers all three ways to arrive here — the
     solve breaking out on a zero denominator, `legacy_pre_w52` skipping the solve
     and keeping p_0, and a stored price that is itself unusable. */
  if (!pps.isFinite()) {
    throw new ZeroPricingDenominatorError(
      String(round.id ?? round.series ?? "(unnamed round)"),
      String(round.preMoneyValuation),
      String(round.investmentAmount),
      currentFullyDilutedShares(ledgerIn).toString(),
    );
  }

  const real = buildPricedRound(ledgerIn, round, txDate, region, pps, mode);

  return {
    ...real,
    pps,
    pricingTrace: {
      formulaId: "round.pricing.order",
      /* Bumped from 52.1.0: the trace now carries the resolved mode, so a
         production trail states WHICH order produced the number rather than
         leaving a reader to infer it. */
      formulaVersion: "52.2.0",
      region,
      inputs: {
        storedPricePerShare: stored ?? "(absent - derived)",
        preMoneyValuation: round.preMoneyValuation,
        investmentAmount: round.investmentAmount,
        fdBeforeRound: currentFullyDilutedShares(ledgerIn).toString(),
      },
      outputs: {
        pricePerShare: pps.toFixed(),
        pricingDenominator: real.denominatorShares.toString(),
        newInvestorShares: real.newInvestorShares.toString(),
        iterations: String(iterations),
        converged: String(converged),
        trail: trail.join(" -> "),
        /* WAVE 52b §11.6.2 — which order was actually used, on the record. */
        pricingOrderMode: mode,
      },
      defHash: "see-formula",
      note:
        "WAVE 52 (52-Q6 option 2): price per share is solved AFTER the option-pool " +
        "top-up and AFTER SAFE/note conversion, so the pricing denominator contains " +
        "both. Previously the price was fixed before either existed.",
    },
  };
}
