/**
 * Sprint 5 — institutional-grade currency utilities.
 *
 * Region → currency-symbol mapping (matches the formula-region set in
 * `@capavate/cap-table-engine` types.ts) and a thin formatter so every cap-table
 * surface, round screen, and admin page renders the right symbol.
 *
 * Display contract (R200 §10):
 *   • instrument-native amount (whatever the security was issued in)
 *   • tenant-base (rendered as $/£/€/¥/₹/A$/C$/HK$ depending on region)
 *   • USD reference (always shown alongside non-USD values for institutional comparability)
 */
import type { Region } from "@capavate/cap-table-engine";

export function currencySymbol(region: Region | string | undefined | null): string {
  switch (region) {
    case "US":
    case "SG":
      return "$";
    case "HK":
      return "HK$";
    case "CA":
      return "C$";
    case "AU":
      return "A$";
    case "UK":
      return "£";
    case "JP":
      return "¥";
    case "IN":
      return "₹";
    case "CN":
      return "¥"; // CNY uses ¥ sign — distinct context from JPY
    default:
      return "$";
  }
}

export function currencyCode(region: Region | string | undefined | null): string {
  switch (region) {
    case "US": return "USD";
    case "SG": return "SGD";
    case "HK": return "HKD";
    case "CA": return "CAD";
    case "AU": return "AUD";
    case "UK": return "GBP";
    case "JP": return "JPY";
    case "IN": return "INR";
    case "CN": return "CNY";
    default:   return "USD";
  }
}

/* ===========================================================================
 * v25.37 — ISO 4217 minor-unit exponent awareness.
 *
 * BLOCKER B-Currency: every client formatter historically assumed a `/100`
 * (2-decimal) minor-units conversion. That is WRONG for zero-decimal
 * currencies (JPY, KRW, …) and three-decimal currencies (BHD, JOD, KWD, …).
 * This block introduces an ISO 4217 exponent table + a shared `formatMinor` /
 * `toMinor` so display + math derive the divisor from the currency, never a
 * hardcoded 100. `fmtCurrency` above is intentionally LEFT UNCHANGED for
 * backward compatibility.
 *
 * SCOPE NOTE (v25.37): only ONE high-impact client surface
 * (admin/CollectivePaymentSchedules.tsx) is migrated to `formatMinor` in this
 * wave. The ~20+ remaining inline `minor / 100` formatters are catalogued for
 * the v25.38 sweep — see v25_37_implementation_report.md.
 * ========================================================================= */

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
  // v25.38 round-2 (per GPT-5.5): default `locale` to `undefined` (caller's
  // runtime locale via Intl) so this drop-in replacement preserves prior
  // `new Intl.NumberFormat(undefined, ...)` behavior across browsers. Callers
  // that need a pinned locale can still pass `opts.locale: "en-US"`.
  const exp = currencyExponent(currency);
  const major = (Number(minor) || 0) / Math.pow(10, exp);
  const locale = opts.locale; // undefined => runtime default (matches legacy)
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

/** v25.38 — convert integer minor units to a major-unit NUMBER using the
 * currency's ISO 4217 exponent (the inverse of `toMinor`; NOT a hardcoded
 * `/ 100`). Use this for editable input fields that need the raw numeric major
 * value (e.g. `String(fromMinor(aumMinor, currency))`) rather than a formatted
 * currency string. For DISPLAY use `formatMinor` instead. */
export function fromMinor(minor: number, currency: string): number {
  const exp = currencyExponent(currency);
  return (Number(minor) || 0) / Math.pow(10, exp);
}

/** Format a value with the region's currency symbol. */
export function fmtCurrency(n: number | null | undefined, region: Region | string | undefined | null = "US", opts: { compact?: boolean; digits?: number } = {}): string {
  if (n == null || isNaN(n as number)) return "—";
  const symbol = currencySymbol(region);
  if (opts.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${symbol}${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000)     return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)         return `${symbol}${(n / 1_000).toFixed(1)}K`;
    return `${symbol}${n.toFixed(opts.digits ?? 0)}`;
  }
  const digits = opts.digits ?? 0;
  return `${symbol}${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}
