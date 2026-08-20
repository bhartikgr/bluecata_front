import type { Decimal } from "./primitives/bigDecimal.js";
import type { Shares } from "./primitives/shareCount.js";
import type { Currency, FxSnapshot } from "./primitives/fx.js";

export type Region = "US" | "CA" | "UK" | "SG" | "HK" | "CN" | "IN" | "JP" | "AU" | "Custom";
export type Stage = "foundation" | "pre_seed" | "seed" | "series_a" | "series_b" | "series_c" | "later";

export type InstrumentKind = "common" | "preferred" | "safe" | "note" | "warrant" | "option";

export type Holder = {
  id: string;
  name: string;
  type: "founder" | "investor" | "employee" | "pool" | "advisor" | "other";
};

/** Every issued security carries an explicit instrument kind + per-instrument fields. */
export type Security = {
  id: string;
  holderId: string;
  kind: InstrumentKind;
  series?: string;             // "Common", "Series Seed", "Series A", "Pre-Seed SAFE"
  shares?: Shares;             // common / preferred / option pool / warrant share-equivalent
  pricePerShare?: string;      // Decimal-as-string
  investmentAmount?: string;   // Decimal-as-string in `currency`
  currency?: Currency;
  // SAFE-specific
  safe?: {
    type: "post_money_cap" | "pre_money_cap" | "uncapped" | "discount_only";
    cap?: string;              // valuation cap, Decimal-as-string
    discount?: string;         // 0..1 (e.g. "0.20" for 20%)
    mfn?: boolean;
  };
  // Note-specific
  note?: {
    principal: string;
    discount?: string;
    cap?: string;
    interestRate: string;      // annual, e.g. "0.06"
    interestKind: "simple" | "compounded";
    issueDate: string;         // ISO
    /* WAVE 70 · D7 — OPTIONAL, because it is honest for it to be absent.
       `maturityDate` reaches NO arithmetic anywhere in this package:
       `convertNoteToPreferred` never reads it, there is no maturity trigger, no
       default and no automatic conversion. It was REQUIRED, so the one caller
       that builds notes (`shared/roundMathEngineAdapter.ts`) hardcoded
       "2027-12-31" to satisfy the type — a literal date asserted about every
       note on the platform. Making it optional lets the adapter pass the STORED
       maturity when there is one and pass nothing when there is not.
       THE GAP THIS DOES NOT CLOSE, stated so it is not over-read: maturity still
       triggers nothing. `maturityMonths` is fenced [0,600] at both layers
       (Wave 61b, migration 0192) and its value still reaches no arithmetic. A
       maturity trigger is an owner-scope feature, not a defect fix. */
    maturityDate?: string;     // ISO
  };
  // Warrant
  warrant?: {
    underlyingShares: Shares;
    strikePrice: string;
    expiry: string;
    cashless: boolean;
  };
  // Option grant / pool
  option?: {
    grantedShares: Shares;     // options granted (issued out of pool)
    exercisePrice: string;
    vestingMonths: number;
    cliffMonths: number;
    poolName?: string;
  };
  // Preferred-specific
  preferred?: {
    liquidationPreferenceMultiple: number;   // 1, 2, 3
    /* WAVE 70 · D1 / R60 §6 — OPTIONAL. It was required, so the adapter
       hardcoded `participating: false` on every existing preferred class: a
       negotiated liquidation term asserted as fact about investors who never
       agreed it. Nothing in this package reads it on a `Security` (only
       `computeWaterfall` reads its own separate input type), so absence changes
       no arithmetic here — it just stops the adapter having to invent a term. */
    participating?: boolean;
    participationCapMultiple?: number;       // optional cap for participating preferred
    seniority: number;                       // 0 = most senior
    antiDilution?: "none" | "full_ratchet" | "broad_based" | "narrow_based";
    originalIssuePrice: string;
  };
  issuedAt?: string;
};

export type Transaction =
  | { type: "issue"; security: Security; date: string; currency?: Currency }
  | { type: "transfer"; securityId: string; toHolderId: string; date: string }
  | { type: "exercise_option"; securityId: string; sharesExercised: bigint; date: string }
  | { type: "exercise_warrant"; securityId: string; date: string; cashless?: boolean; fmvPerShare?: string }
  | { type: "convert_safe"; securityId: string; round: PricedRound; date: string }
  | { type: "convert_note"; securityId: string; round: PricedRound; date: string }
  | { type: "issue_preferred_round"; round: PricedRound; date: string }
  /** WAVE 52c · B4 — `targetPercent` is PERCENT-AS-WRITTEN (R16): "25" = 25%. */
  | { type: "esop_topup"; targetPercent: string; mode: "pre_money" | "post_money"; date: string };

export type PricedRound = {
  id: string;
  series: string;              // "Series Seed", "Series A"
  preMoneyValuation: string;   // Decimal-as-string
  investmentAmount: string;    // new money raised
  pricePerShare?: string;      // optional explicit; otherwise computed
  currency?: Currency;
  /**
   * WAVE 52c · B4 — PERCENT-AS-WRITTEN (R16 / OR-1). `"10"` → 10% post-money
   * pool, `"25"` → 25%. NOT a fraction: before Wave 52c this field was
   * documented as `"0.10"` → 10%, and a UI supplying a percent-as-written `25`
   * threw "Pool target must be < 100%". Read by BOTH engines under this unit.
   */
  optionPoolPostPercent?: string;
  optionPoolMode?: "pre_money" | "post_money";
  liquidationPreferenceMultiple?: number;
  participating?: boolean;
  antiDilution?: "none" | "full_ratchet" | "broad_based" | "narrow_based";
};

export type View = "basic" | "fully_diluted" | "as_converted";

export type CapTableHolderRow = {
  holderId: string;
  holderName: string;
  holderType: string;
  kind: InstrumentKind;
  series?: string;
  shares: Shares;
  /* ── WAVE 71 · D18 — `null` MEANS UNDEFINED, AND NEVER MEANS ZERO ─────────
     THE DEFECT. `computeView` returned the confident string `"0"` for a holder
     whose ownership is 0 / 0 — a zero-share holder on a zero-share cap table.
     Owner ruling R47 is explicit that "a percentage of zero shares is undefined,
     not zero", and the honest em-dash a founder sees on `/founder/captable` comes
     from the CLIENT's own `totalSharesNum > 0` gate (`CapTable.tsx:569-571`), NOT
     from this engine and NOT from R54's formatter — `fmtPct("0")` prints `0.00%`
     quite correctly, because `0` is finite. So every OTHER consumer of the engine
     received `"0"` for an undefined ratio and had no way to know.

     THE CONTRACT. `null` is returned when, and only when, the view's denominator
     is zero. A caller cannot mistake `null` for a number: `parseFloat(null)` does
     not type-check, `Number(null)` is a deliberate coercion the author must
     write, and JSON carries it as `null` rather than `0`. Every caller in the
     tree was checked and is listed in `build_log/wave71/W71_VISIBILITY.md`. */
  ownershipPercent: string | null;   // Decimal as string, full precision. `null` = 0 ÷ 0, undefined.
  invested?: string;
  currency?: Currency;
};

export type TraceStep = {
  formulaId: string;
  formulaVersion: string;
  region: Region;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  defHash: string;
  note?: string;
};

export type CapTableResult = {
  asOf: string;
  view: View;
  region: Region;
  rows: CapTableHolderRow[];
  totalShares: Shares;
  trace: TraceStep[];
  formulaIdsUsed: string[];
};

/**
 * WAVE 52b · §11.6.2 — THE ROLLBACK FLAG FOR THE WAVE 52 PRICING ORDER.
 *
 * `"w52_post_pool_post_conversion"` (the DEFAULT, and the corrected arithmetic):
 *   the price per share is solved AFTER the option-pool top-up and AFTER SAFE /
 *   note conversion, and a post-money SAFE's company capitalization is measured
 *   BEFORE the pool push.
 *
 * `"legacy_pre_w52"` (the ROLLBACK): the pre-Wave-52 order, with all three
 *   measured defects restored together — no fixed-point solve, the pool top-up
 *   applied ABOVE the conversion loops, and the SAFE's capitalization measured
 *   AFTER the pool push. On the canonical worked example this returns the engine
 *   to $3.00 as its starting price against a true $2.00 and hands the SAFE
 *   403,225 shares it is not entitled to. It exists ONLY so that Wave 52 can be
 *   reverted without redeploying v26.16.0 and losing every other wave with it.
 *
 * The value is NOT decided here and NOT read from `process.env`. It is resolved
 * from the database at call time by
 * `server/lib/roundMathDisclosureStore.ts::resolveW52PricingOrder()`, per owner
 * ruling R21 ("100% dynamic. Nothing static or hard coded."). This package stays
 * pure and takes the resolved value as an input.
 */
export type PricingOrderMode = "w52_post_pool_post_conversion" | "legacy_pre_w52";

export type ComputeOptions = {
  companyId: string;
  asOf: string;
  view: View;
  formulaRegion: Region;
  fx?: FxSnapshot;
  holders: Holder[];
  transactions: Transaction[];
  /** Omitted means the corrected Wave 52 order. See `PricingOrderMode`. */
  pricingOrderMode?: PricingOrderMode;
};

/** Formula registry record. */
export type FormulaRecord<TIn = Record<string, unknown>, TOut = Record<string, unknown>> = {
  id: string;
  name: string;
  region: Region;
  version: string;            // semver
  status: "active" | "draft" | "archived";
  category: "safe_conversion" | "note_conversion" | "anti_dilution" | "esop_topup" | "waterfall" | "ownership";
  citation: { source: string; url: string; note?: string };
  definition: Record<string, unknown>;  // declarative description (parameters, formulae)
  evaluator?: (input: TIn) => TOut;     // runtime
  test?: { name: string; description: string };
};
