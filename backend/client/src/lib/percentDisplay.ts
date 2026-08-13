/* ==========================================================================
 * client/src/lib/percentDisplay.ts — WAVE 3A (spec items P-1, P-3)
 *
 * THE ONE PLACE where a stored FRACTION becomes a displayed PERCENT, and where
 * an admin-typed PERCENT becomes a stored FRACTION.
 *
 * ---------------------------------------------------------------------------
 * BINDING RULING (owner, 2026-08-09) — read before editing this file
 * ---------------------------------------------------------------------------
 *   • STORAGE stays FRACTIONAL. `VIP = 1` genuinely IS 100% off. `YC2025 = 0.3`
 *     genuinely IS 30%. There is NO data migration and NO storage change.
 *     The charge path (server/paymentStore.ts calcCouponDiscountCents:159-167,
 *     `amountCents * discount.amount`) already reads the fraction correctly and
 *     is NOT touched by this wave.
 *   • ADMIN INPUT is percent-as-written: the owner types `100`, the system
 *     stores `1.0`. That conversion happens in `parsePercentInputToFraction`.
 *   • THE DISPLAY was the defect: renders omitted the ×100, so a 100%-off code
 *     printed as "1%". That is fixed by `formatFractionAsPercent`.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ DOUBLE-CONVERSION HAZARD — a double ×100 charges a partner 100× the
 * intended amount, and a missing one charges 1/100×. Before wiring a new call
 * site, VERIFY what the value already holds:
 *
 *   fraction (0.02 = 2%)  → formatFractionAsPercent(v)      ✅
 *   percent  (2    = 2%)  → formatPercentValue(v)  or fmtPct — do NOT use
 *                            formatFractionAsPercent, it would print "0.02%".
 *
 * Sites that were ALREADY correct are deliberately left alone. See
 * build_log/WAVE3A_REPORT.md for the full audited sweep table.
 *
 * ---------------------------------------------------------------------------
 * EXEMPTION — `partner_commission_rate_config.rate` (00_SHARED_STANDARDS.md:39)
 * is exempt from ANY storage conversion. Its storage is untouched. Its display
 * (AdminFeesConsolidated.tsx:1128, AdminCommissionRates.tsx:39) was already
 * correct and is likewise untouched.
 * ======================================================================== */

/** Percent values are stored/normalised on a 4-decimal grid (PERCENT_POLICY_v2
 *  §0). 4 percent-decimals == 6 fraction-decimals. */
export const PERCENT_DECIMALS = 4;
const FRACTION_DECIMALS = PERCENT_DECIMALS + 2;

/** Strip binary-float dust: 0.3 * 100 === 30.000000000000004 → 30. */
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function coerce(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Trim trailing zeros so 100 → "100", 12.5 → "12.5", 2 → "2". */
function trim(n: number): string {
  return String(n);
}

export interface PercentFormatOptions {
  /** Fixed number of fractional digits. Omit for "as many as needed, trimmed". */
  digits?: number;
  /** Rendered when the value is null/undefined/NaN. Default "—". */
  fallback?: string;
  /** Append the "%" sign. Default true. */
  suffix?: boolean;
}

/**
 * Format a value that is STORED AS A FRACTION for display as a percent.
 * This is the ×100 that the defective render sites were missing.
 *
 *   formatFractionAsPercent(1)      → "100%"
 *   formatFractionAsPercent(0.3)    → "30%"
 *   formatFractionAsPercent(0.125)  → "12.5%"
 *   formatFractionAsPercent(0.02)   → "2%"
 *   formatFractionAsPercent(0.02, { digits: 2 }) → "2.00%"
 *   formatFractionAsPercent(null)   → "—"
 */
export function formatFractionAsPercent(
  value: unknown,
  options: PercentFormatOptions = {},
): string {
  const { digits, fallback = "—", suffix = true } = options;
  const n = coerce(value);
  if (n === null) return fallback;
  const pct = roundTo(n * 100, PERCENT_DECIMALS);
  const body = digits === undefined ? trim(pct) : pct.toFixed(digits);
  return suffix ? `${body}%` : body;
}

/**
 * Format a value that is ALREADY IN PERCENT UNITS (2 = 2%). Provided so that
 * a call site can state its unit explicitly instead of interpolating a bare
 * `${v}%` and leaving the next reader to guess which convention it is.
 *
 *   formatPercentValue(30) → "30%"
 */
export function formatPercentValue(
  value: unknown,
  options: PercentFormatOptions = {},
): string {
  const { digits, fallback = "—", suffix = true } = options;
  const n = coerce(value);
  if (n === null) return fallback;
  const pct = roundTo(n, PERCENT_DECIMALS);
  const body = digits === undefined ? trim(pct) : pct.toFixed(digits);
  return suffix ? `${body}%` : body;
}

/**
 * Seed an admin percent INPUT from fractional storage — the inverse of
 * `parsePercentInputToFraction`. Returns "" for null so a blank field means
 * "no override" rather than "0%".
 *
 *   fractionToPercentInput(1)     → "100"
 *   fractionToPercentInput(0.125) → "12.5"
 *   fractionToPercentInput(null)  → ""
 */
export function fractionToPercentInput(value: unknown): string {
  const n = coerce(value);
  if (n === null) return "";
  return trim(roundTo(n * 100, PERCENT_DECIMALS));
}

export type PercentParseResult =
  | { ok: true; fraction: number; percent: number }
  | { ok: false; error: string };

export interface PercentParseOptions {
  /** Inclusive lower bound in PERCENT units. Default 0. */
  minPercent?: number;
  /** Inclusive upper bound in PERCENT units. Default 100. */
  maxPercent?: number;
  /** Field name used in the error message. Default "Percentage". */
  label?: string;
}

/**
 * Parse an admin-typed PERCENT-AS-WRITTEN value into the FRACTION that gets
 * stored. This is the input half of the owner's ruling: type 100 → store 1.0.
 *
 *   parsePercentInputToFraction("100")  → { ok: true, fraction: 1,     percent: 100 }
 *   parsePercentInputToFraction("30")   → { ok: true, fraction: 0.3,   percent: 30 }
 *   parsePercentInputToFraction("12.5") → { ok: true, fraction: 0.125, percent: 12.5 }
 *   parsePercentInputToFraction("101")  → { ok: false, error: "..." }
 */
export function parsePercentInputToFraction(
  raw: unknown,
  options: PercentParseOptions = {},
): PercentParseResult {
  const { minPercent = 0, maxPercent = 100, label = "Percentage" } = options;
  const n = coerce(typeof raw === "string" ? raw.trim() : raw);
  if (n === null) return { ok: false, error: `${label} must be a number` };
  if (n < minPercent || n > maxPercent) {
    return {
      ok: false,
      error: `${label} must be between ${minPercent} and ${maxPercent} (percent as written — type 100 for 100%)`,
    };
  }
  const percent = roundTo(n, PERCENT_DECIMALS);
  return { ok: true, percent, fraction: roundTo(percent / 100, FRACTION_DECIMALS) };
}
