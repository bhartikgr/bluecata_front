export * from "./types.js";
export { D, Decimal, decToString, ZERO, ONE, HUNDRED } from "./primitives/bigDecimal.js";
export { decimalToShares, sharesToDecimal, shares as toShares } from "./primitives/shareCount.js";
export { sha256, hashFormulaDef } from "./primitives/hash.js";
export { convert as fxConvert } from "./primitives/fx.js";
/* WAVE 52c · B5 — the rounding policy is an engine rule, not a comment. */
export {
  ROUNDING_DIRECTIONS, ROUNDING_SITES, roundingDeviations, computeSubscriptionAmount,
  type RoundingDirection, type RoundingSite,
  type SubscriptionRoundingInput, type SubscriptionRoundingResult,
} from "./primitives/roundingPolicy.js";

export { convertSafeToPreferred } from "./conversion/safeToPreferred.js";
export { convertNoteToPreferred } from "./conversion/noteToPreferred.js";
export { exerciseOption } from "./conversion/optionExercise.js";
export { exerciseWarrant } from "./conversion/warrantExercise.js";
/* WAVE 71 · D13 — `applyMfnResolved` is exported alongside `applyMfn` so a caller
   can see WHICH instrument's terms an MFN election adopted and on what basis. An
   election that rewrites a holder's economics must be inspectable, not silent. */
export { applyMfn, applyMfnResolved, type MfnContext, type MfnResolution } from "./conversion/mfnOrdering.js";

export { applyFullRatchet } from "./antiDilution/fullRatchet.js";
export { applyBroadBasedWeightedAverage } from "./antiDilution/broadBasedWeightedAverage.js";
export { applyNarrowBasedWeightedAverage } from "./antiDilution/narrowBasedWeightedAverage.js";

export { computeWaterfall } from "./waterfall/liquidationWaterfall.js";
/* WAVE 193 · R165.1 — the exit-waterfall's mixed-currency refusal, exported so a
   caller can branch on the CONDITION rather than on a message substring. */
export { MixedCurrencyWaterfallError } from "./waterfall/liquidationWaterfall.js";
export { computeEsopTopUp } from "./instruments/esopTopUp.js";

export { computeCapTable, applyTransaction } from "./captable/compute.js";
/* WAVE 72 · DEFECT 1 — the named refusal raised when there are no fully-diluted
   shares to price a round against, so no price per share exists. Exported so a
   caller can branch on the CONDITION rather than on a message substring. */
export { ZeroPricingDenominatorError } from "./captable/compute.js";
/* WAVE 193 · R165.1 — the conversion-denominator refusal raised when the
   post-money SAFEs whose amounts are summed into that denominator are recorded in
   more than one currency. Capavate converts no currency (R156.1), so there is no
   share count to return. Exported for the same reason as the line above. */
export { MixedCurrencyConversionError } from "./captable/compute.js";
/* WAVE 198 · ITEM B — the sibling refusal for the SAFE CONVERSION itself, which
   is the surface a pre-money SAFE reaches (wave 194's ADV-3). Exported so the
   round-math route's generic `.code` + `.refusalHeadline` envelope can carry it
   and so tests can assert the class rather than a string. */
export { MixedCurrencyConversionInputError } from "./captable/compute.js";
/* WAVE 193 · R165.1 — the ONE absent-vs-mixed decision, exported so server and
   client layers apply the SAME rule instead of each inventing one. */
export { statedCurrencies, isMixedCurrency, describeStatedCurrencies } from "./primitives/currencySet.js";
/* WAVE 198 · ITEM A — the one definition of currency-code sameness (case +
   whitespace only, R156.1), exported so the sibling comparison surfaces the
   wave-198 sweep found can fold codes identically instead of each inventing its
   own comparison. */
export { normaliseCurrencyForComparison } from "./primitives/currencySet.js";
export { computeView } from "./captable/views.js";

export {
  registerFormula, getFormula, listFormulas, resolveFormula, REGIONS,
} from "./formulas/registry.js";

// Ledger (event-sourced, hash-chained)
export * from "./ledger/index.js";

// Reconciliation + close gate
export * from "./reconcile/index.js";
/* WAVE 71 · D8 — the ONE exact interest clock, exported so
   `shared/roundMathEngineAdapter.ts` can call it instead of reproducing the
   float expression a second time (which is what Wave 70 had to do). */
export * from "./primitives/timeElapsed.js";

