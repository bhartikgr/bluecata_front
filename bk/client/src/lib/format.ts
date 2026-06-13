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

/** Render an ISO date as "Jan 5, 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
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
