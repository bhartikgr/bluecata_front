/**
 * WAVE 231 · R221.x — THE PLATFORM FEE WAS WITHHELD AT THE MOMENT OF AGREEMENT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS ON SCREEN. Step 3 of the SPV creation wizard — the screen on which a
 * general partner commits to launching a vehicle — said, in full:
 *
 *     "The platform fee layer is set by Capavate and is read-only to you. Its
 *      exact percentage is shown on this SPV's Fees tab once applied."
 *
 * Both sentences are true. Together they withhold a PRICE TERM at the moment of
 * agreement: the partner is asked to proceed while being told, in as many words,
 * that they will find out the price afterwards.
 *
 * WHY NO OWNER DECISION WAS NEEDED. The fee is not confidential. It is NOT SET.
 * `server/lib/spvFeeScheduleStore.ts` seeds `sfs_platform_carry_platform` with
 * `rate_scaled = 0, scale = 1000000000, active = 0` and the comment
 * "CP-SPV-10 platform layer. Seeded INACTIVE at 0." There was never a percentage
 * to disclose. The screen was apologising for withholding something that does
 * not exist, which is worse than either disclosing it or saying so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: NEVER RENDER A FABRICATED 0%
 * ─────────────────────────────────────────────────────────────────────────────
 * Eleven displayed prices on this platform have already been found to be
 * fabricated zeros. The trap is specific and it is worth naming precisely,
 * because a guard against MISSING data does not guard against INVENTED data:
 *
 *   `tryResolveFee` returns `null` when no ACTIVE row applies. The seeded row
 *   also happens to hold `rate_scaled = 0`. So the naive derivation — read the
 *   row, format `rate_scaled / scale` as a percentage — produces the string
 *   "0%", which reads as A DECIDED PRICE OF ZERO. It is not. It is the absence
 *   of a decision. A partner who is told "the platform fee is 0%" has been given
 *   a price term that nobody set and that nobody is bound by.
 *
 * So no state in this module reports a figure unless a figure was actually
 * decided — meaning an ACTIVE, in-window row with a NON-ZERO rate. Every other
 * state says, in words, that no platform fee layer is currently applied, and
 * that if one is applied it appears on the Fees tab.
 *
 * `set_to_zero` and `not_set` deliberately produce THE SAME STATEMENT but are
 * KEPT AS DIFFERENT STATES. Substantively they are the same fact for the partner
 * — nothing is being charged — so telling them apart on screen would be noise.
 * But an active row deliberately set to zero and a row nobody has activated are
 * different administrative facts, and collapsing them in the DATA would destroy
 * an auditor's ability to tell "we decided the fee is nil" from "we never
 * decided". The distinction is preserved where it is useful and hidden where it
 * is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS HARDCODED
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no percentage, no price, no currency and no exponent literal in this
 * file. `BIG_PERCENT` and `PERCENT_MAX_DECIMALS` are UNIT CONVERSIONS — the definition
 * of "per cent" and the display precision — not prices, and neither can encode
 * a fee. The only fee facts in play arrive as arguments.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MONEY / RATE ARITHMETIC
 * ─────────────────────────────────────────────────────────────────────────────
 * `rateScaled` is an integer on `scale` (1e9 in the schedule, per
 * server/lib/money.ts `CARRY_FRACTION_SCALE`). This module:
 *
 *   · converts through `BigInt(...)`, which THROWS on a non-integer rather than
 *     silently truncating — the failure this platform's money rule is written to
 *     prevent;
 *   · gates both inputs against `Number.MAX_SAFE_INTEGER` BEFORE conversion, so
 *     a value that was already corrupted upstream refuses instead of arriving
 *     as a plausible-looking percentage;
 *   · uses `Number()`, `parseInt` and `parseFloat` NOWHERE;
 *   · performs no currency conversion — indeed it emits no currency at all;
 *   · does not round. If the rate is not exactly representable at
 *     `PERCENT_MAX_DECIMALS`, it REFUSES TO STATE A FIGURE rather than showing a
 *     rounded price. A price rounded without a rule is a price nobody agreed to,
 *     and this surface is the moment of agreement.
 *
 * PURE. No reads, no writes, no throws that escape (every conversion is guarded),
 * no formatting of anything but the derived percentage. It is unit-testable
 * without a database, which is the point: the rule can be exercised across every
 * state including the ones the seeded database cannot currently produce.
 */

/** Display precision for the derived percentage. A UNIT, not a price. */
const PERCENT_MAX_DECIMALS = 6;

/* THE PROJECT'S BIGINT CONVENTION, NOT A STYLE CHOICE.
   `0n` / `10n` / `100n` bigint LITERALS do not compile under this tree's
   TypeScript target: they raise TS2737 ("BigInt literals are not available when
   targeting lower than ES2020"). My first version used them and added five new
   `tsc` errors. `BigInt(0)` is the form the rest of the codebase uses
   (`shared/roundMathEngineAdapter.ts` passim) and it is exactly equivalent at
   runtime. Hoisted to module constants so the conversion happens once. */
const BIG_ZERO = BigInt(0);
const BIG_TEN = BigInt(10);
/** Per-cent: parts per hundred. A UNIT DEFINITION, not a price or a rate. */
const BIG_PERCENT = BigInt(100);

export const SPV_PLATFORM_FEE_DISCLOSURE_STATES = [
  /** An active, in-window row with a non-zero rate. A figure IS disclosed. */
  "applied_rate",
  /** No active, in-window row resolved. Nobody has set a platform fee. */
  "not_set",
  /** An active row whose rate is exactly zero — a decided nil, not a price. */
  "set_to_zero",
  /** An active row priced as a flat amount rather than a rate. No figure here. */
  "applied_not_a_rate",
  /** Active and non-zero, but not exactly representable. Refuses the figure. */
  "rate_not_exactly_displayable",
  /** The fee schedule could not be read. Refuses to claim EITHER way. */
  "unreadable",
] as const;
export type SpvPlatformFeeDisclosureState =
  (typeof SPV_PLATFORM_FEE_DISCLOSURE_STATES)[number];

/**
 * The narrow shape a resolved schedule row must expose to be classified.
 *
 * Deliberately narrower than `SpvFeeScheduleRow` so this module carries no
 * dependency on the server store and can be exercised on states the seeded
 * database cannot currently reach. `active` is not a field here: a row only
 * reaches this module if the resolver already considered it active and in-window,
 * and re-deciding that here would be a second resolver — which is exactly what
 * this wave was told not to build.
 */
export interface SpvPlatformFeeRowInput {
  /** Integer on `scale`, or null when the row is priced as a flat amount. */
  rateScaled: number | null;
  /** The divisor `rateScaled` is expressed on. */
  scale: number | null;
  /** True when the row prices a rate; false when it prices a flat amount. */
  pricesARate: boolean;
}

export interface SpvPlatformFeeDisclosure {
  state: SpvPlatformFeeDisclosureState;
  /**
   * The disclosed percentage, as an exact decimal string WITHOUT a `%` sign —
   * e.g. `"20"`, `"2.5"`. Non-null ONLY in state `applied_rate`. Never `"0"`.
   */
  percentDisplay: string | null;
  /** Plain-language statement. Never a machine code, never a bare number. */
  statement: string;
}

/** Shared tail: where the figure lives once there is one. Not a promise that one exists. */
const FEES_TAB_TAIL =
  "If Capavate applies one, its exact terms appear on this SPV's Fees tab.";

/**
 * Exactly convert `rateScaled / scale` to a percentage decimal string, or return
 * `null` when it cannot be done exactly within `PERCENT_MAX_DECIMALS`.
 *
 * Integer arithmetic throughout. `BigInt()` throws on a non-integer input, which
 * is caught and reported as "cannot be displayed exactly" rather than allowed to
 * become a truncated price.
 */
function exactPercentString(rateScaled: number, scale: number): string | null {
  // Gate BEFORE conversion. A value already past MAX_SAFE_INTEGER cannot be
  // trusted to be the integer it appears to be.
  if (!Number.isSafeInteger(rateScaled) || !Number.isSafeInteger(scale)) return null;
  if (rateScaled < 0 || scale <= 0) return null;

  let numerator: bigint;
  let denominator: bigint;
  try {
    numerator = BigInt(rateScaled) * BIG_PERCENT;
    denominator = BigInt(scale);
  } catch {
    return null;
  }

  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder === BIG_ZERO) return whole.toString();

  let fraction = "";
  for (let i = 0; i < PERCENT_MAX_DECIMALS && remainder !== BIG_ZERO; i += 1) {
    remainder *= BIG_TEN;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  // Still something left over: the rate is finer than we are willing to display,
  // and displaying a rounded price is not an option on this screen.
  if (remainder !== BIG_ZERO) return null;
  return `${whole.toString()}.${fraction}`;
}

/**
 * Classify the platform fee layer for disclosure.
 *
 * `readable` is passed in rather than inferred from `row === null`, because
 * "no active row" and "the fee table could not be read" look identical from the
 * outside and must NOT be reported the same way. Reporting an unreadable fee
 * schedule as "no platform fee applies" is how a database failure becomes a
 * price term.
 */
export function spvPlatformFeeDisclosure(args: {
  row: SpvPlatformFeeRowInput | null;
  readable: boolean;
}): SpvPlatformFeeDisclosure {
  if (!args.readable) {
    return {
      state: "unreadable",
      percentDisplay: null,
      statement:
        "The platform fee schedule could not be read, so whether a platform fee layer applies " +
        "is not shown here. This is not a statement that there is no platform fee — " +
        "check this SPV's Fees tab before relying on it.",
    };
  }

  if (args.row === null) {
    return {
      state: "not_set",
      percentDisplay: null,
      statement:
        `No platform fee layer is currently applied to SPVs you create. ${FEES_TAB_TAIL}`,
    };
  }

  if (!args.row.pricesARate || args.row.rateScaled === null || args.row.scale === null) {
    return {
      state: "applied_not_a_rate",
      percentDisplay: null,
      statement:
        "A platform fee layer applies to SPVs you create, and it is not a percentage. " +
        "Its exact amount is shown on this SPV's Fees tab.",
    };
  }

  if (args.row.rateScaled === 0) {
    // A DECIDED NIL. Reported with the same words as `not_set` — nothing is
    // charged either way — and NEVER as the figure "0%", which would read as a
    // price term that was agreed.
    return {
      state: "set_to_zero",
      percentDisplay: null,
      statement:
        `No platform fee layer is currently applied to SPVs you create. ${FEES_TAB_TAIL}`,
    };
  }

  const percent = exactPercentString(args.row.rateScaled, args.row.scale);
  if (percent === null) {
    return {
      state: "rate_not_exactly_displayable",
      percentDisplay: null,
      statement:
        "A platform fee layer applies to SPVs you create, but its recorded rate cannot be " +
        "shown here exactly. Its exact terms are on this SPV's Fees tab — do not rely on a " +
        "figure from this screen.",
    };
  }

  return {
    state: "applied_rate",
    percentDisplay: percent,
    statement:
      `Capavate's platform fee layer is currently set at ${percent}% and is read-only to you. ` +
      "It appears on this SPV's Fees tab once applied.",
  };
}
