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
    maturityDate: string;      // ISO
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
    participating: boolean;
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
  | { type: "esop_topup"; targetPercent: string; mode: "pre_money" | "post_money"; date: string };

export type PricedRound = {
  id: string;
  series: string;              // "Series Seed", "Series A"
  preMoneyValuation: string;   // Decimal-as-string
  investmentAmount: string;    // new money raised
  pricePerShare?: string;      // optional explicit; otherwise computed
  currency?: Currency;
  optionPoolPostPercent?: string;  // e.g. "0.10" → 10% post-money pool
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
  ownershipPercent: string;   // Decimal as string, full precision
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

export type ComputeOptions = {
  companyId: string;
  asOf: string;
  view: View;
  formulaRegion: Region;
  fx?: FxSnapshot;
  holders: Holder[];
  transactions: Transaction[];
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
