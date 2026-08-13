/**
 * WAVE 9 — M-1c/M-1d display layer.
 *
 * spec/OQ8_OQ9_INDUSTRY_STANDARDS.md A.10#6, binding:
 *   "Display layer driven purely by `status`; no formatting of raw floats in
 *    components."
 *
 * Every reporting component imports from here and NEVER calls `.toFixed()` on
 * a metric itself. That is the whole point: a component that formats a raw
 * float has no way to distinguish "0.00x, truly zero" from "unavailable", and
 * the version of the investor dashboard this replaces printed `1.00x` for
 * every unmarked portfolio on the platform.
 *
 * UNITS (see packages/math-fns/src/ilpa.ts):
 *   multiples  — PLAIN multiples. 1.42 renders "1.42x". NOT percentDisplay.
 *   rates      — FRACTIONS. 0.185 renders "18.5%", via
 *                client/src/lib/percentDisplay.ts. There is no loose `* 100`
 *                anywhere in this file.
 */
import { formatFractionAsPercent } from "./percentDisplay";

export type MetricStatus =
  | "COMPUTED"
  | "NO_FLOWS"
  | "NO_MARKS"
  | "STALE_MARKS"
  | "NOT_MEANINGFUL"
  | "INSUFFICIENT_FLOWS"
  | "NOT_APPLICABLE";

export interface ReportedMetric {
  value: number | null;
  status: MetricStatus;
  note?: string;
}

export type MarkBadge = "fresh" | "stale" | "expired" | "unmarked" | "gp_override";

/** What a component actually renders. `text` is always safe to print. */
export interface MetricDisplay {
  text: string;
  /** True only when a real, current number is being shown. */
  isValue: boolean;
  tone: "normal" | "muted" | "warning";
  /** Tooltip / helper copy explaining an absent or qualified number. */
  title: string;
}

/** The em-dash is the ONLY placeholder. It never stands in for a number. */
export const NO_VALUE = "—";

const STATUS_COPY: Record<MetricStatus, string> = {
  COMPUTED: "Computed from recorded cash flows and valuations.",
  NO_FLOWS: "No cash-flow rows exist for this portfolio yet.",
  NO_MARKS: "Not available — no valuation event, so there is no current value to report.",
  STALE_MARKS: "Based on a valuation that is past the freshness window.",
  NOT_MEANINGFUL: "Not meaningful — the denominator is zero.",
  INSUFFICIENT_FLOWS: "Not computable — the cash-flow series cannot produce a rate of return.",
  NOT_APPLICABLE: "Does not apply to this portfolio.",
};

export function statusCopy(status: MetricStatus): string {
  return STATUS_COPY[status] ?? "Unavailable.";
}

function toneFor(status: MetricStatus): MetricDisplay["tone"] {
  if (status === "COMPUTED") return "normal";
  if (status === "STALE_MARKS") return "warning";
  return "muted";
}

/** Render a MULTIPLE (DPI/RVPI/TVPI/PIC/MOIC). Never a percent. */
export function displayMultiple(m: ReportedMetric | undefined | null, digits = 2): MetricDisplay {
  if (!m || m.value === null || m.status === "NO_FLOWS" || m.status === "NO_MARKS" ||
      m.status === "NOT_MEANINGFUL" || m.status === "INSUFFICIENT_FLOWS" ||
      m.status === "NOT_APPLICABLE") {
    const status = m?.status ?? "NO_FLOWS";
    return { text: NO_VALUE, isValue: false, tone: toneFor(status), title: m?.note ?? statusCopy(status) };
  }
  return {
    text: `${m.value.toFixed(digits)}x`,
    isValue: true,
    tone: toneFor(m.status),
    title: m.note ?? statusCopy(m.status),
  };
}

/**
 * Render a RATE stored as a fraction. `basis` decides the label, because a
 * sub-year period return must never be presented as if it were annualised
 * (A.10 fixture #7 — a 90-day vehicle up 3% prints "3.0%", not "12.5% IRR").
 */
export function displayRate(
  m: ReportedMetric | undefined | null,
  basis: "annualised" | "period" | "none" = "annualised",
  digits = 1,
): MetricDisplay {
  if (!m || m.value === null || m.status === "NO_FLOWS" || m.status === "NO_MARKS" ||
      m.status === "INSUFFICIENT_FLOWS" || m.status === "NOT_APPLICABLE" ||
      m.status === "NOT_MEANINGFUL") {
    const status = m?.status ?? "NO_FLOWS";
    return { text: NO_VALUE, isValue: false, tone: toneFor(status), title: m?.note ?? statusCopy(status) };
  }
  const pct = formatFractionAsPercent(m.value, { digits });
  return {
    text: basis === "period" ? `${pct} (period)` : pct,
    isValue: true,
    tone: toneFor(m.status),
    title:
      m.note ??
      (basis === "period"
        ? "Period return over a holding period shorter than one year. Deliberately not annualised."
        : statusCopy(m.status)),
  };
}

/** Render a money figure that may legitimately be unavailable. */
export function displayMoney(
  value: number | null | undefined,
  fmt: (n: number) => string,
  absentTitle: string,
): MetricDisplay {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { text: NO_VALUE, isValue: false, tone: "muted", title: absentTitle };
  }
  return { text: fmt(value), isValue: true, tone: "normal", title: "" };
}

/** Render a YoY delta. Absent means absent — there is no "+0.00 YoY". */
export function displayDelta(
  delta: number | null | undefined,
  kind: "multiple" | "rate",
  digits = 2,
): MetricDisplay {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return {
      text: "",
      isValue: false,
      tone: "muted",
      title: "No year-earlier snapshot exists, so there is no year-on-year change to report.",
    };
  }
  const sign = delta >= 0 ? "+" : "";
  const body =
    kind === "rate"
      ? `${formatFractionAsPercent(delta, { digits, suffix: false })} pp`
      : `${sign}${delta.toFixed(digits)}`;
  return {
    text: kind === "rate" ? `${sign}${body} YoY` : `${body} YoY`,
    isValue: true,
    tone: delta >= 0 ? "normal" : "warning",
    title: "Change against the snapshot from twelve months earlier.",
  };
}

/* ==========================================================================
 * Valuation badges — owner ruling Q5 made visible.
 * ======================================================================== */

export interface BadgeDisplay {
  label: string;
  title: string;
  tone: "normal" | "muted" | "warning" | "danger";
}

export function displayMarkBadge(badge: MarkBadge, staleDays = 180, expiredDays = 365): BadgeDisplay {
  switch (badge) {
    case "fresh":
      return { label: "Marked", title: "Valued from the last priced round, within the freshness window.", tone: "normal" };
    case "stale":
      return {
        label: "Stale mark",
        title: `The latest valuation is older than ${staleDays} days. Figures are still shown, flagged.`,
        tone: "warning",
      };
    case "expired":
      return {
        label: "Mark expired",
        title: `The latest valuation is older than ${expiredDays} days and no longer counts as a mark. Value-dependent figures are withheld.`,
        tone: "danger",
      };
    case "gp_override":
      return { label: "GP override", title: "A GP has overridden the derived mark. The reason is recorded on the valuation record.", tone: "warning" };
    case "unmarked":
    default:
      return {
        label: "Unmarked",
        title: "No priced round exists for this holding, so it has no current value. It is NOT valued at cost.",
        tone: "muted",
      };
  }
}

/** Portfolio-level coverage line, e.g. "3 of 7 holdings unmarked". */
export function displayCoverage(v: {
  totalPositions: number;
  markedPositions: number;
  unmarkedPositions: number;
  staleMarks: number;
  expiredMarks: number;
}): string | null {
  if (v.totalPositions === 0) return null;
  const bits: string[] = [];
  if (v.unmarkedPositions > 0) bits.push(`${v.unmarkedPositions} of ${v.totalPositions} unmarked`);
  if (v.expiredMarks > 0) bits.push(`${v.expiredMarks} expired`);
  if (v.staleMarks > 0) bits.push(`${v.staleMarks} stale`);
  if (bits.length === 0) return null;
  return `Valuation coverage: ${bits.join(", ")}. Value-dependent figures are withheld until every holding is marked.`;
}

/* ==========================================================================
 * Series — ruling Q9. A chart draws only at >= minPoints REAL points.
 * ======================================================================== */

export interface SeriesLike {
  points: Array<{ periodStart: string; value: number | null }>;
  renderable: boolean;
  minPoints: number;
  reason?: string;
}

/**
 * Returns the numbers a sparkline may draw, or `null` to withhold the chart.
 * `null` must be rendered as blank space, not as a flat line at zero.
 */
export function chartablePoints(s: SeriesLike | undefined | null): number[] | null {
  if (!s || !s.renderable) return null;
  const vals = s.points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < s.minPoints) return null;
  return vals;
}

export function seriesEmptyCopy(s: SeriesLike | undefined | null): string {
  return s?.reason ?? "Not enough history yet to draw a trend.";
}
