/**
 * WAVE 21 · ITEM 2 / ITEM 5 — client money display helpers.
 *
 * NEW FILE (not an edit to the shared `client/src/lib/currency.ts`, which is
 * left byte-identical so Wave 20 can work in the same tree).
 *
 * Two rules encoded here, both from Review A:
 *
 *  1. A monetary scalar that the server could not produce (because the data
 *     spans currencies and no FX source exists) must RENDER AS UNAVAILABLE.
 *     It must never fall back to `0`, and never to a currency label that was
 *     not the source currency. `formatMinor(null, "USD")` would print "$0.00",
 *     which is a lie; `formatMinorOrUnavailable(null, null)` prints "—".
 *
 *  2. Everything monetary goes through `formatMinor`, which is ISO-4217
 *     exponent aware. A hardcoded `/ 100` misstates JPY (exponent 0) by 100×
 *     and BHD/KWD/JOD (exponent 3) by 10×.
 */
import { formatMinor, currencyExponent } from "./currency";

/** Rendered in place of a number that does not exist. */
export const MONEY_UNAVAILABLE = "—";

/**
 * Format an integer minor-unit amount, or render an explicit unavailable
 * marker when the amount or its currency is absent.
 *
 * `minor === null | undefined`  → the server said "no single-currency value".
 * `currency === null | undefined` → we do not know the denomination, so we
 * must not pick one. Both cases render `MONEY_UNAVAILABLE`, never `$0.00`.
 */
export function formatMinorOrUnavailable(
  minor: number | null | undefined,
  currency: string | null | undefined,
  opts: { locale?: string; placeholder?: string } = {},
): string {
  const placeholder = opts.placeholder ?? MONEY_UNAVAILABLE;
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return placeholder;
  const cur = String(currency ?? "").trim().toUpperCase();
  if (!cur) return placeholder;
  return formatMinor(Number(minor), cur, { locale: opts.locale });
}

/**
 * ITEM 5 replacement for the `(minor / 100).toFixed(2)` idiom that Review A
 * found across ~15 client surfaces. Returns the MAJOR-unit numeric string with
 * the currency's own number of fraction digits — `12345` JPY → `"12345"`, not
 * `"123.45"`. Use `formatMinor` when you want a symbol; use this only where a
 * bare number is required (inputs, CSV cells, chart axes).
 */
export function minorToMajorString(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return "";
  const exp = currencyExponent(currency ?? "USD");
  return (Number(minor) / Math.pow(10, exp)).toFixed(exp);
}
