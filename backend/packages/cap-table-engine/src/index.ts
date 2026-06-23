export * from "./types.js";
export { D, Decimal, decToString, ZERO, ONE, HUNDRED } from "./primitives/bigDecimal.js";
export { decimalToShares, sharesToDecimal, shares as toShares } from "./primitives/shareCount.js";
export { sha256, hashFormulaDef } from "./primitives/hash.js";
export { convert as fxConvert } from "./primitives/fx.js";

export { convertSafeToPreferred } from "./conversion/safeToPreferred.js";
export { convertNoteToPreferred } from "./conversion/noteToPreferred.js";
export { exerciseOption } from "./conversion/optionExercise.js";
export { exerciseWarrant } from "./conversion/warrantExercise.js";
export { applyMfn } from "./conversion/mfnOrdering.js";

export { applyFullRatchet } from "./antiDilution/fullRatchet.js";
export { applyBroadBasedWeightedAverage } from "./antiDilution/broadBasedWeightedAverage.js";
export { applyNarrowBasedWeightedAverage } from "./antiDilution/narrowBasedWeightedAverage.js";

export { computeWaterfall } from "./waterfall/liquidationWaterfall.js";
export { computeEsopTopUp } from "./instruments/esopTopUp.js";

export { computeCapTable, applyTransaction } from "./captable/compute.js";
export { computeView } from "./captable/views.js";

export {
  registerFormula, getFormula, listFormulas, resolveFormula, REGIONS,
} from "./formulas/registry.js";

// Ledger (event-sourced, hash-chained)
export * from "./ledger/index.js";

// Reconciliation + close gate
export * from "./reconcile/index.js";

