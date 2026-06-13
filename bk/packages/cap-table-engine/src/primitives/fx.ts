/**
 * FX rate snapshots. Every transaction has a native currency and a snapshot
 * rate to the tenant base currency at round-close. USD column is computed from
 * the same snapshot.
 */
import { Decimal, D } from "./bigDecimal.js";

export type Currency = "USD" | "CAD" | "GBP" | "SGD" | "EUR" | "INR" | "AUD";

export type FxSnapshot = {
  base: Currency;            // tenant base
  asOf: string;              // ISO date
  rates: Record<Currency, string>; // amount in `base` per 1 unit of currency
};

export function convert(amount: Decimal | string | number, from: Currency, to: Currency, fx: FxSnapshot): Decimal {
  const a = D(amount);
  if (from === to) return a;
  const rateFrom = fx.rates[from];
  const rateTo = fx.rates[to];
  if (!rateFrom) throw new Error(`FX missing for ${from}`);
  if (!rateTo) throw new Error(`FX missing for ${to}`);
  // amount * rateFrom (-> base) / rateTo (-> to)
  return a.mul(D(rateFrom)).div(D(rateTo));
}
