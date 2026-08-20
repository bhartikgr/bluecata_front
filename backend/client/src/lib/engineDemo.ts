/**
 * client/src/lib/engineDemo.ts — RE-EXPORT SHIM (WAVE 52c · B1).
 *
 * The implementation moved to `shared/roundMathEngineAdapter.ts` so that the
 * SERVER can call the identical adapter. It had to move because Wave 52's
 * pricing-order flag reached no production code: the only production caller of
 * the round-pricing pipeline was this client module, and a browser cannot read
 * the `platform_config` row the flag lives in. A server route can, and now does
 * — `GET /api/founder/rounds/:id/round-math` in `server/roundMathRoutes.ts`.
 *
 * Nothing was duplicated. There is exactly ONE `adaptSecuritiesToEngine`, ONE
 * `runEngine` and ONE `projectPostClose` in the tree, and both the route and the
 * Projection screen use it. Every existing `@/lib/engineDemo` import keeps
 * working unchanged.
 *
 * WAVE 3F / ITEM 5 is preserved verbatim in the moved file: `readDiscountFraction`
 * is the only way a discount is read, the forbidden `n > 1 ? n / 100 : n`
 * magnitude guess is absent, and an out-of-domain wire value is REJECTED rather
 * than rescaled.
 *
 * WAVE 58e · D1 adds `toWireDiscount` in the same file: the ONE declared
 * conversion from the storage unit (percent-as-written, R30) to the engine's wire
 * unit (a fraction), applied UNCONDITIONALLY and never by sniffing the magnitude.
 * `readDiscountFraction` is unchanged and still the only arbiter of `[0,1]`.
 */
export {
  InvalidDiscountWireValueError,
  readDiscountFraction,
  /* WAVE 58e · D1 — the unit boundary, re-exported so client surfaces can state
     the same conversion they are about to be shown the result of. */
  toWireDiscount,
  /* WAVE 58e · D2/D3 — one range rule and one disclosure across every surface. */
  validateDiscountPercentAsWritten,
  validateInterestRatePercentAsWritten,
  describeDiscount,
  DISCOUNT_MARKET_NORM_MIN,
  DISCOUNT_MARKET_NORM_MAX,
  INTEREST_RATE_PERCENT_MAX,
  DISCOUNT_STORAGE_UNIT,
  DISCOUNT_WIRE_UNIT,
  DISCOUNT_STORED_PERCENT_MAX,
  adaptSecuritiesToEngine,
  runEngine,
  projectPostClose,
  /* WAVE 58b · DEFECT 3 — re-exported so client surfaces resolve the ONE
     fully-diluted pre-money base through the same function the server does. */
  ledgerFullyDilutedPreMoneyShares,
  resolveFdPreMoneyBase,
  unconvertedConvertibleCount,
  /* WAVE 58c · A3 — the non-throwing form, for the three RENDER-SCOPE callers.
     A malformed committed row must produce a named on-screen refusal, never an
     ErrorBoundary fallback on the screen a founder raises money from. */
  tryLedgerFullyDilutedPreMoneyShares,
} from "@shared/roundMathEngineAdapter";
export type {
  FdBaseResolution,
  LedgerFdResolution,
  WireDiscount,
  TermRangeVerdict,
  DiscountDisclosure,
} from "@shared/roundMathEngineAdapter";
export type { ApiSecurity } from "@shared/roundMathEngineAdapter";
