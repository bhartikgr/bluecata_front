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
export { computeEsopTopUp } from "./instruments/esopTopUp.js";

export { computeCapTable, applyTransaction } from "./captable/compute.js";
/* WAVE 72 · DEFECT 1 — the named refusal raised when there are no fully-diluted
   shares to price a round against, so no price per share exists. Exported so a
   caller can branch on the CONDITION rather than on a message substring. */
export { ZeroPricingDenominatorError } from "./captable/compute.js";
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

