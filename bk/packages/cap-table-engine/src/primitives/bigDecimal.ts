/**
 * BigDecimal — thin wrapper around decimal.js configured with 38 significant digits.
 * Used for prices, ownership percentages, FX rates, and any intermediate fractional math.
 */
import Decimal from "decimal.js";

// Lock precision and rounding once at module load
Decimal.set({ precision: 38, rounding: Decimal.ROUND_HALF_EVEN });

export type DecimalLike = Decimal | string | number;

export function D(v: DecimalLike): Decimal {
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

export function decToString(d: Decimal, dp = 12): string {
  return d.toFixed(dp);
}

export { Decimal };
