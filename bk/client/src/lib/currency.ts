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
