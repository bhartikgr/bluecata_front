/**
 * WAVE 52c · B5 — THE ROUNDING POLICY, AS AN EXECUTABLE RULE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `spec/strategy/RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` — a document
 * ALREADY SENT to an external reviewer — states, at §6.5 / §13.3 and again in
 * §10 item 7:
 *
 *   "Orrick prescribes ROUNDDOWN on shares with ROUNDUP on the subscription
 *    amount 'so that shares are fully paid up'."
 *
 * and quotes the worked figure `$499,998.97` for 448,671 shares at $1.1144.
 * Before this file existed the ROUNDDOWN half was implemented (investor and
 * SAFE shares floor) and the ROUNDUP half was NOT IMPLEMENTED ANYWHERE. The
 * reviewer can test the sentence, so the sentence has to be executable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DECLARED HERE, AND WHY A TABLE RATHER THAN PROSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Every rounding direction the round pipeline applies is declared in
 * `ROUNDING_DIRECTIONS` with the site it applies at, the direction, the reason,
 * and whether it is an authority-backed rule or a MEASURED, DISCLOSED DEVIATION.
 * Two of the four are deviations and are labelled as such rather than quietly
 * described as policy:
 *
 *   · pool top-up shares CEIL — a deviation. Ceiling the pool over-delivers the
 *     pool target by at most one share and dilutes existing holders by that one
 *     share. It is pre-existing engine behaviour (`decimalToShares(T, "ceil")`);
 *     this wave DISCLOSES it and does not change it, because changing a share
 *     count is an arithmetic change and B5 is a disclosure-and-rule blocker.
 *   · a post-money SAFE's company capitalization rounds to NEAREST whole share —
 *     also a deviation, also pre-existing, also disclosed rather than changed.
 *
 * A caller that renders a figure produced at one of these sites is expected to
 * render `disclosure` next to it. `lint:percent-denominator-fence` and the
 * Wave 52c tests are what keep that honest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO CURRENCY EXPONENT IS HARDCODED (WAVE 34 money fence)
 * ─────────────────────────────────────────────────────────────────────────────
 * `minorUnitExponent` is a REQUIRED argument. There is no `?? 2`, because a
 * default of 2 is exactly the bug the money-exponent fence exists to stop: JPY
 * has exponent 0 and a hardcoded 2 inflates every subscription 100x.
 */
import { D, Decimal } from "./bigDecimal.js";
import { decimalToShares, type Shares } from "./shareCount.js";

/** One rounding site, declared so a UI can print it verbatim. */
export interface RoundingDirection {
  /** Stable id. Used as the disclosure key on the wire and on screen. */
  site: string;
  direction: "floor" | "ceil" | "nearest";
  /** True when an authority prescribes this direction; false = deviation. */
  authorityBacked: boolean;
  authority: string;
  /** One sentence, written to be shown to a founder or an investor. */
  disclosure: string;
}

export const ROUNDING_DIRECTIONS: Readonly<Record<string, RoundingDirection>> = {
  investor_shares: {
    site: "investor_shares",
    direction: "floor",
    authorityBacked: true,
    authority:
      "Orrick UK Founder Series (ROUNDDOWN on shares); YC post-money safe primer Appendix II",
    disclosure:
      "Share counts are rounded DOWN to whole shares. No fraction of a share is ever issued, " +
      "so a small cash residual is left unapplied and is disclosed separately.",
  },
  safe_conversion_shares: {
    site: "safe_conversion_shares",
    direction: "floor",
    authorityBacked: true,
    authority: "YC post-money safe primer Appendix II",
    disclosure:
      "Shares issued on conversion of a SAFE or note are rounded DOWN to whole shares.",
  },
  subscription_amount: {
    site: "subscription_amount",
    direction: "ceil",
    authorityBacked: true,
    authority:
      "Orrick UK Founder Series — ROUNDUP on the subscription amount \"so that shares are fully paid up\"",
    disclosure:
      "The subscription amount actually applied is rounded UP to the smallest currency unit, " +
      "so the shares issued are fully paid up. The difference between the amount committed and " +
      "the amount applied is the residual, and its treatment is recorded, not assumed.",
  },
  pool_topup_shares: {
    site: "pool_topup_shares",
    direction: "ceil",
    authorityBacked: false,
    authority:
      "DEVIATION — no authority located for ceiling the pool top-up; recorded as pre-existing engine behaviour by WAVE 52c",
    disclosure:
      "Option-pool top-up shares are rounded UP to whole shares. This over-delivers the pool " +
      "target by at most one share and that one share dilutes existing holders. This is a " +
      "deviation from the round-down rule used everywhere else and is stated, not hidden.",
  },
  safe_company_capitalization: {
    site: "safe_company_capitalization",
    direction: "nearest",
    authorityBacked: false,
    authority:
      "DEVIATION — the post-money SAFE company-capitalization intermediate rounds to the NEAREST whole share; recorded as pre-existing engine behaviour by WAVE 52c",
    disclosure:
      "The company-capitalization figure used to price a post-money SAFE is rounded to the " +
      "NEAREST whole share as an intermediate step. This is a deviation from the round-down " +
      "rule and is stated, not hidden.",
  },
} as const;

export type RoundingSite = keyof typeof ROUNDING_DIRECTIONS;

export const ROUNDING_SITES = Object.keys(ROUNDING_DIRECTIONS) as string[];

/** Every declared deviation, so a screen can list them without knowing the keys. */
export function roundingDeviations(): RoundingDirection[] {
  return ROUNDING_SITES.map((k) => ROUNDING_DIRECTIONS[k]).filter((r) => !r.authorityBacked);
}

export interface SubscriptionRoundingInput {
  /** Amount the investor committed, in INTEGER minor units. */
  committedMinor: bigint;
  /** Price per share in MAJOR units, as a decimal string. Must be > 0. */
  pricePerShare: string;
  /**
   * ISO 4217 minor-unit exponent for the round's currency. REQUIRED — see the
   * header. USD/EUR/GBP = 2, JPY/KRW = 0, KWD/BHD = 3.
   */
  minorUnitExponent: number;
}

export interface SubscriptionRoundingResult {
  /** ROUNDDOWN(committed / price) — whole shares, never a fraction. */
  shares: Shares;
  /** ROUNDUP(shares × price) in integer minor units — "fully paid up". */
  subscriptionMinor: bigint;
  /** committed − subscription, in integer minor units. Always >= 0. */
  residualMinor: bigint;
  /** The exact, unrounded product, for the audit trail. */
  exactProductMinor: string;
  /** The two directions this result applied, ready to render. */
  disclosures: RoundingDirection[];
}

/**
 * THE ORRICK ROUND-UP RULE, EXECUTABLE.
 *
 *   shares       = ROUNDDOWN(committed ÷ price)
 *   subscription = ROUNDUP(shares × price)   ← to the smallest currency unit
 *   residual     = committed − subscription
 *
 * Worked example from the sent document (§6.5 / §13.3), reproduced by
 * `packages/cap-table-engine/test/rounding/w52c-rounding-policy.test.ts`:
 *   committed $500,000.00, price $1.1144, exponent 2
 *     → shares 448,671  (500000 / 1.1144 = 448,671.93…)
 *     → 448,671 × 1.1144 = $499,998.9624
 *     → subscription ROUNDED UP = $499,998.97  (49,999,897 minor units)
 *     → residual = $1.03  (103 minor units)
 *
 * `residualMinor` can be zero and zero is a legitimate answer; it is never
 * defaulted, and a non-zero residual has no default disposition either — see
 * `server/lib/roundMathDisclosureStore.ts::recordResidualDisposition`.
 */
export function computeSubscriptionAmount(
  input: SubscriptionRoundingInput,
): SubscriptionRoundingResult {
  const price = D(input.pricePerShare);
  if (!price.isFinite() || price.lte(0)) {
    throw new Error(`ROUNDING_POLICY_BAD_PRICE:${input.pricePerShare}`);
  }
  if (!Number.isInteger(input.minorUnitExponent) || input.minorUnitExponent < 0) {
    throw new Error(`ROUNDING_POLICY_BAD_EXPONENT:${input.minorUnitExponent}`);
  }
  /* BigInt(0) rather than `0n`: the tree targets below ES2020 and a BigInt
     LITERAL adds a TS2737 to the tsc baseline. Same value, no new error. */
  if (input.committedMinor < BigInt(0)) {
    throw new Error(`ROUNDING_POLICY_NEGATIVE_COMMITMENT:${input.committedMinor}`);
  }

  /* The scale is DERIVED from the exponent supplied by the caller — never a
     literal 100. `10 ** e` is exact in Decimal. */
  const scale: Decimal = D(10).pow(input.minorUnitExponent);
  const committedMajor: Decimal = D(input.committedMinor.toString()).div(scale);

  // ROUNDDOWN on shares.
  const shares = decimalToShares(committedMajor.div(price), "floor");

  // ROUNDUP on the subscription amount, in minor units, so shares are fully paid.
  const exactMinor: Decimal = D(shares.toString()).mul(price).mul(scale);
  const subscriptionMinor = BigInt(exactMinor.ceil().toFixed(0));

  /* A ROUNDUP can only ever push the subscription ABOVE the exact product, and
     the exact product is <= committed by construction of the floor. But if the
     ceil lands exactly on committed+1 minor unit (possible only when the floor
     was exact and price*shares == committed), clamp so the residual is never
     negative — an investor is never invoiced more than they committed. */
  const applied = subscriptionMinor > input.committedMinor ? input.committedMinor : subscriptionMinor;
  const residualMinor = input.committedMinor - applied;

  return {
    shares,
    subscriptionMinor: applied,
    residualMinor,
    exactProductMinor: exactMinor.toFixed(),
    disclosures: [
      ROUNDING_DIRECTIONS.investor_shares,
      ROUNDING_DIRECTIONS.subscription_amount,
    ],
  };
}
