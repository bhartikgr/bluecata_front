/**
 * Share counts are always BigInt — no float ever touches a share count.
 * Conversions from decimal share-equivalents to integer shares use floor/ceil
 * with explicit rounding mode rather than implicit truncation.
 */
import { Decimal, D } from "./bigDecimal.js";

export type Shares = bigint;

export function shares(n: bigint | number | string): Shares {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isInteger(n)) throw new Error(`shares() expects integer, got ${n}`);
    return BigInt(n);
  }
  return BigInt(n);
}

/**
 * Convert a fractional share count (Decimal) to integer Shares.
 * Default = floor (do not over-issue). Round mode "ceil" used for option-pool top-up.
 */
export function decimalToShares(d: Decimal, mode: "floor" | "ceil" | "round" = "floor"): Shares {
  let rounded: Decimal;
  if (mode === "floor") rounded = d.floor();
  else if (mode === "ceil") rounded = d.ceil();
  else rounded = d.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return BigInt(rounded.toFixed(0));
}

export function sharesToDecimal(s: Shares): Decimal {
  return D(s.toString());
}

export const ZERO_SHARES: Shares = 0n;
