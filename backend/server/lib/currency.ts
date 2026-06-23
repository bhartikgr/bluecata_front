/**
 * server/lib/currency.ts — v25.37 (BLOCKER B-Currency, server mirror).
 *
 * Server-side ISO 4217 minor-unit exponent table + shared `formatMinor` /
 * `toMinor` helpers. Mirrors client/src/lib/currency.ts EXACTLY so server and
 * client agree on minor-unit math for every currency.
 *
 * WHY: historically `server/softCircleStore.ts` (toAmountMinor) and various
 * client formatters hardcoded a `* 100` / `/ 100` (2-decimal) minor-units
 * conversion. That is WRONG for zero-decimal currencies (JPY, KRW, …) and
 * three-decimal currencies (BHD, JOD, KWD, …). Per Ozan's standing rule
 * ("Nothing in memory. All DB driven and fully dynamic.") the exponent is
 * derived from the currency code, never assumed.
 *
 * v25.37 scope: only server/softCircleStore.ts toAmountMinor is migrated to
 * `toMinor` in this wave. Other server-side minor-unit math is catalogued for
 * the v25.38 sweep.
 */

/** ISO 4217 minor-unit exponents that differ from the default of 2.
 * 0-decimal (no minor unit) and 3-decimal currencies. Codes are upper-case. */
const CURRENCY_EXPONENT_OVERRIDES: Record<string, number> = {
  // --- 0-decimal currencies (no minor unit) ---
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0,
  XPF: 0, HUF: 0, TWD: 0,
  // --- 3-decimal currencies ---
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3, CLF: 3,
};

/** ISO 4217 minor-unit exponent for a currency code. Defaults to 2 for any
 * unknown / unlisted code (the common 2-decimal case: USD, EUR, GBP, …). */
export function currencyExponent(code: string | null | undefined): number {
  if (!code) return 2;
  const c = String(code).toUpperCase();
  const e = CURRENCY_EXPONENT_OVERRIDES[c];
  return e === undefined ? 2 : e;
}

/** Format an integer minor-unit amount for display, using the correct number
 * of fraction digits for the currency's ISO 4217 exponent (NOT a hardcoded
 * `/100`). Falls back to a plain `CODE 1.23` string if Intl throws on an
 * unknown currency. */
export function formatMinor(
  minor: number,
  currency: string,
  opts: { locale?: string } = {},
): string {
  const exp = currencyExponent(currency);
  const major = (Number(minor) || 0) / Math.pow(10, exp);
  // v25.38 round-2 (per GPT-5.5): default to undefined (runtime locale) so this
  // is a drop-in replacement for legacy `new Intl.NumberFormat(undefined, ...)`.
  const locale = opts.locale;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(exp)}`;
  }
}

/** Convert a major-unit amount to integer minor units using the currency's
 * ISO 4217 exponent (mirror of `formatMinor`; NOT a hardcoded `* 100`). */
export function toMinor(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const exp = currencyExponent(currency);
  return Math.round(amount * Math.pow(10, exp));
}

/** v25.38 round-2: mirror of `client/src/lib/currency.ts` fromMinor. Converts
 * integer minor units to a major-unit NUMBER using the currency's ISO 4217
 * exponent (the inverse of `toMinor`; NOT a hardcoded `/ 100`). For display
 * use `formatMinor` instead. */
export function fromMinor(minor: number, currency: string): number {
  const exp = currencyExponent(currency);
  return (Number(minor) || 0) / Math.pow(10, exp);
}
