/**
 * Capavate number / date formatting helpers.
 *
 * Patch v4 — added `safeNumber`, `safeToFixed`, `safeFormatNumber`,
 * `safeFormatCurrency`, `safeFormatPercent` that gracefully handle
 * null / undefined / non-numeric server values so the UI never crashes
 * on fresh-user state.
 */

/* ============================================================== *
 *  Legacy formatters (pre-existing API — keep signatures stable)  *
 * ============================================================== */

export interface FmtUSDOptions {
  /** Use compact notation: 1_234_567 → "$1.2M". */
  compact?: boolean;
  /** Override the currency code (default USD). */
  currency?: string;
  /** Override fractional digits. */
  fractionDigits?: number;
}

export function fmtUSD(value: unknown, opts: FmtUSDOptions = {}): string {
  const n = safeNumber(value);
  if (n === null) return "—";
  const { compact = false, currency = "USD", fractionDigits } = opts;
  try {
    if (compact) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: fractionDigits ?? 1,
      }).format(n);
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits ?? 0,
      maximumFractionDigits: fractionDigits ?? 0,
    }).format(n);
  } catch {
    return `$${n.toFixed(fractionDigits ?? 0)}`;
  }
}

/**
 * Format a percentage. `value` is the percent number (e.g. 41 for 41%),
 * NOT a fraction. Returns "41.0%".
 */
export function fmtPct(value: unknown, digits: number = 1): string {
  const n = safeNumber(value);
  if (n === null) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Thousands-separated integer formatter. */
export function fmtNum(value: unknown, digits: number = 0): string {
  const n = safeNumber(value);
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Render an ISO date as "Jan 5, 2026".
 *
 * WAVE 83 · ITEM 2.2 — A DATE-ONLY VALUE IS NOT A MOMENT IN TIME.
 * `new Date("2026-07-21")` is defined to parse as UTC midnight; rendering that
 * through `toLocaleDateString` in any zone west of UTC printed **20 July** for
 * a value the founder typed as **21 July**. That is the one-day shift reported
 * on the round's target close date, and it was never a storage defect — the
 * stored value was right the whole time. A `YYYY-MM-DD` string is now formatted
 * from its OWN parts, so it cannot cross a timezone. A full datetime (anything
 * carrying a time or an offset) still goes through `Date` exactly as before. */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dateOnly = DATE_ONLY_RE.exec(String(iso).trim());
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
    }
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Render an ISO datetime as "Jan 5, 2026, 3:04 PM". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human-friendly byte size: 1024 → "1.0 KB", 1_048_576 → "1.0 MB". */
export function fmtBytes(value: unknown): string {
  const n = safeNumber(value);
  if (n === null || n < 0) return "—";
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "3 minutes ago", "2 days ago", etc. Returns "—" for invalid input. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) {
    // Future date — "in 3 days"
    const future = -seconds;
    if (future < 60) return "in a moment";
    if (future < 3600) return `in ${Math.floor(future / 60)} min`;
    if (future < 86400) return `in ${Math.floor(future / 3600)} h`;
    return `in ${Math.floor(future / 86400)} d`;
  }
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400 / 7)}w ago`;
  if (seconds < 86400 * 365) return `${Math.floor(seconds / 86400 / 30)}mo ago`;
  return `${Math.floor(seconds / 86400 / 365)}y ago`;
}

/* ============================================================== *
 *  Patch v4 — defensive number helpers                            *
 * ============================================================== */

/**
 * Coerce an unknown value to a finite number, or return null.
 * Accepts: number, numeric string. Rejects: null, undefined, NaN, "—",
 * empty string, non-numeric string, Infinity.
 */
export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "—" || trimmed === "-") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Format a value with `.toFixed(digits)` safely. Returns `fallback`
 * (default "—") when the value cannot be coerced to a finite number.
 */
export function safeToFixed(
  value: unknown,
  digits: number,
  fallback: string = "—",
): string {
  const n = safeNumber(value);
  if (n === null) return fallback;
  return n.toFixed(digits);
}

/** Thousands-separated number formatter with safe-null fallback. */
export function safeFormatNumber(
  value: unknown,
  digits: number = 0,
  fallback: string = "—",
): string {
  const n = safeNumber(value);
  if (n === null) return fallback;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Currency formatter with safe-null fallback. */
export function safeFormatCurrency(
  value: unknown,
  currency: string = "USD",
  fallback: string = "—",
): string {
  const n = safeNumber(value);
  if (n === null) return fallback;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return fallback;
  }
}

/**
 * Percentage formatter — accepts either fraction (0.41) or percent (41).
 *
 * @param value     the number to format
 * @param digits    fractional digits (default 2)
 * @param asPercent if true, value is already in percent (41 → "41.00%");
 *                  if false, value is a fraction (0.41 → "41.00%")
 */
export function safeFormatPercent(
  value: unknown,
  digits: number = 2,
  asPercent: boolean = true,
  fallback: string = "—",
): string {
  const n = safeNumber(value);
  if (n === null) return fallback;
  const pct = asPercent ? n : n * 100;
  return `${pct.toFixed(digits)}%`;
}
/* ============================================================== *
 *  WAVE 87 · ITEM 1 — DATE-ONLY VALUES MUST NOT CROSS A TIMEZONE  *
 * ============================================================== */

/**
 * WAVE 87 · ITEM 1 — THE SHIFT WAVE 83 FIXED IN ONE PLACE, FIXED EVERYWHERE.
 *
 * Wave 83 added `fmtDate` above and applied it to the round's target close date.
 * Reviewer 1 then found the SAME defect still live on other date-only fields:
 * `new Date("2026-06-15")` is DEFINED by the language to parse as UTC midnight,
 * so `toLocaleDateString()` in New York (UTC-4/-5) prints **Jun 14** for a value
 * the customer entered as **15 June**. A subscription renewal date, a fee
 * effective date and a last-raise date are all dates a customer acts on.
 *
 * `fmtDate` could not be dropped into those sites without also changing their
 * FORMAT ("6/15/2026" → "Jun 15, 2026"), and this wave is forbidden from
 * restyling. `fmtLocaleDate` is therefore the drop-in replacement for
 * `new Date(v).toLocaleDateString(locales, options)`:
 *
 *   • a DATE-ONLY string (`YYYY-MM-DD`) is rebuilt at LOCAL midnight, so the
 *     calendar day it prints is the calendar day that was entered — in every
 *     timezone, east or west of UTC;
 *   • anything carrying a time or an offset is a genuine INSTANT and is handed
 *     to `Date` unchanged, because localising an instant is correct and is not
 *     this wave's business;
 *   • the caller's `locales`/`options` are passed through untouched, so the
 *     rendered format is byte-identical to what the site printed before.
 *
 * A UTC-only test suite cannot see the difference between the old and new code.
 * That is why the bug survived, and why the tests for this run under
 * TZ=America/New_York and TZ=Pacific/Auckland as well as TZ=UTC.
 */
const DATE_ONLY_PARSE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a schema date value into a `Date` that is safe to render in local time.
 * Returns `null` when the value is absent or unparseable. A `YYYY-MM-DD` string
 * becomes LOCAL midnight of that calendar day; every other value is parsed by
 * `Date` exactly as before.
 */
export function toCalendarDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "" || s === "—") return null;
  const m = DATE_ONLY_PARSE_RE.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const local = new Date(y, mo - 1, d);
    /* Reject impossible calendar dates (2026-02-31 would roll to 3 March). */
    if (local.getFullYear() !== y || local.getMonth() !== mo - 1 || local.getDate() !== d) {
      return null;
    }
    return local;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Timezone-safe replacement for `new Date(v).toLocaleDateString(l, o)`.
 * Format is the caller's; only the one-day shift is removed.
 */
export function fmtLocaleDate(
  value: string | null | undefined,
  locales?: string | string[] | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback: string = "—",
): string {
  const d = toCalendarDate(value);
  if (d === null) return fallback;
  try {
    return d.toLocaleDateString(locales, options);
  } catch {
    return fallback;
  }
}

/**
 * Timezone-safe replacement for `new Date(v).toLocaleString(l, o)`.
 *
 * For a genuine timestamp this is exactly `toLocaleString` and prints the time
 * as before. For a DATE-ONLY value there is no time to print, so the date part
 * is rendered from the calendar day and no spurious "00:00" is invented in the
 * wrong day's column — the value never had a time, and pretending it did is how
 * the shift happened.
 */
export function fmtLocaleDateTime(
  value: string | null | undefined,
  locales?: string | string[] | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback: string = "—",
): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  const d = toCalendarDate(s);
  if (d === null) return fallback;
  try {
    if (DATE_ONLY_PARSE_RE.test(s)) return d.toLocaleDateString(locales, options);
    return d.toLocaleString(locales, options);
  } catch {
    return fallback;
  }
}
