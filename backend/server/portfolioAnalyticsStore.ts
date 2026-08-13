/**
 * Investor portfolio analytics aggregator.
 *
 * ===========================================================================
 * WAVE 9 — RP-1, RP-2, RP-3, RP-4, RP-5. WHAT WAS DELETED AND WHY.
 * ===========================================================================
 * This file was the single largest source of fabricated numbers on the
 * platform. `spec/ENGINE_REGISTRY.md` C-4 records it verbatim: "Investors are
 * shown fabricated MOIC/IRR/TVPI/DPI curves today." Five fabrications lived
 * here and all five are now GONE AT THE PRODUCER, not hidden at the consumer:
 *
 *   RP-1  `realised = invested * 0.10` (was :129-131) — a synthetic 10%
 *         realisation invented so DPI would look non-zero in a demo. DELETED.
 *         Realised proceeds now come only from recorded distribution rows in
 *         `vehicle_cashflow`. No rows means DPI 0.00x, which is TRUE.
 *
 *   RP-2  `currentValue: safeInvested` (was :100) — every holding pinned to
 *         cost, which forced MOIC to exactly 1.0 forever and presented an
 *         UNMARKED holding as if it had been valued. DELETED. A holding is now
 *         marked (from the last priced round, M-2) or it is `null` and counted
 *         in `unmarkedPositions`. Unmarked is a LABEL, never a value.
 *
 *   RP-3  `positionIrr()` (was :140-144) — a hold-period CAGR mislabelled IRR,
 *         with the current year HARDCODED to 2026. DELETED. IRR is now XIRR
 *         (ACT/365F, bracket + Brent) from `@capavate/math-fns`, and it is
 *         SUPPRESSED with a status whenever there are no marks.
 *
 *   RP-4  `spark()` (was :150-166) — twelve monthly points generated from a
 *         sin/cos walk and drawn as if they were history, plus three YoY
 *         subtitles on the dashboard. DELETED. Series now come from real
 *         monthly snapshots (M-3) and render only at >= 3 points (ruling Q9).
 *
 *   RP-5  `cohortBenchmark` literals 1.18 / 1.42 / 1.86 (was :121 AND :207-212
 *         — TWO sites) and the `yoyDelta` fabrications built from *0.78 /
 *         *0.65 / *0.72 (was :200-204). DELETED AT THE PRODUCER FIRST, which
 *         is why RP-4 is sequenced after RP-5. Benchmarks are now computed
 *         from platform snapshots at or above the configured minimum cohort
 *         size (ruling Q10, M-4), and YoY is a real 12-month snapshot delta or
 *         it is absent.
 *
 * THE RULE THIS FILE NOW OBEYS: every figure traces to a real DB-derived row.
 * Where one cannot, the payload carries `null` plus a `MetricStatus`, and the
 * dashboard renders an explicit empty state. A blank is not a failure; a
 * fabricated figure in front of an investment bank is.
 *
 * SINK: `GET /api/investor/portfolio/analytics` (registered at the bottom of
 * this file, mounted from server/routes.ts) → consumed by
 * client/src/pages/investor/Dashboard.tsx, routed at client/src/App.tsx:722
 * under RequireAuth.
 */
import type { Express, Request, Response } from "express";
/* v25.11 NH4 — to derive real per-investor positions from the canonical
 * cap-table commit ledger we need listCommitsForUser. */
import { listCommitsForUser } from "./captableCommitStore";
import {
  buildInvestorMetrics,
  computeCohortBenchmark,
  getChartSeries,
  monthStart,
  type InvestorMetricBundle,
  type MarkBadge,
} from "./wave9ReportingStore";
import type { MetricStatus } from "@capavate/math-fns";
import { fromMinor } from "./lib/currency"; /* WAVE 33 OQ-33-2 — ISO 4217 exponent, never a hardcoded /100 */

const STAGE_NORMALIZE: Record<string, string> = {
  "pre-seed": "Pre-Seed",
  "preseed": "Pre-Seed",
  "seed": "Seed",
  "seed extension": "Seed",
  "series a": "Series A",
  "series b": "Series B",
  "series c": "Series C+",
  "series c+": "Series C+",
  "series d": "Series C+",
  "growth": "Series C+",
};

function normaliseStage(s: string): string {
  return STAGE_NORMALIZE[s.toLowerCase()] ?? s;
}

const SECTOR_TO_REGION: Record<string, string> = {
  "Fintech / AI Payments": "North America",
  "Digital Health":        "North America",
  "Industrial Automation": "North America",
  "Climate / Grid":        "North America",
  "AI Infrastructure":     "Europe",
  "Biotech":               "Europe",
};

/**
 * A reportable number and the reason it is or is not available.
 * `value === null` whenever `status !== "COMPUTED"`. There is no third state
 * and there is no default; a consumer that writes `?? 0` re-introduces exactly
 * the defect this wave removed.
 */
export type ReportedMetric = {
  value: number | null;
  status: MetricStatus;
  note?: string;
};

export type PortfolioSeries = {
  /** Monthly snapshot points, oldest first. */
  points: Array<{ periodStart: string; value: number | null }>;
  /** Ruling Q9 — false until there are at least `minPoints` real points. */
  renderable: boolean;
  minPoints: number;
  reason?: string;
};

export type PortfolioAnalytics = {
  /** MAJOR units, real, from the cap-table commit ledger. */
  totalInvested: number;
  /** MAJOR units. `null` when ANY holding is unmarked — never cost-as-value. */
  totalCurrentValue: number | null;
  /** MAJOR units, from recorded distribution rows only. */
  totalRealized: number;
  /** Multiples: PLAIN multiples (1.42 == 1.42x). Not percents. */
  moic: ReportedMetric;
  tvpi: ReportedMetric;
  dpi: ReportedMetric;
  rvpi: ReportedMetric;
  /** IRR: a FRACTION (0.185 == 18.5%). percentDisplay multiplies for display. */
  irr: ReportedMetric;
  /** Whether `irr` is an annualised rate or a sub-year period return. */
  irrBasis: "annualised" | "period" | "none";
  paperGain: number | null;
  /** The valuation coverage that every figure above depends on. */
  valuation: {
    totalPositions: number;
    markedPositions: number;
    unmarkedPositions: number;
    staleMarks: number;
    expiredMarks: number;
    /** Worst badge across the portfolio; drives the dashboard banner. */
    worstBadge: MarkBadge;
    asOf: string;
  };
  /** Real 12-month snapshot deltas, or null. NEVER a synthetic ratio. */
  yoyDelta: { moic: number | null; irr: number | null; paperValue: number | null };
  /** Real monthly snapshot series, or an explicit not-renderable state. */
  series: {
    moic: PortfolioSeries;
    irr: PortfolioSeries;
    tvpi: PortfolioSeries;
    dpi: PortfolioSeries;
    paperValue: PortfolioSeries;
    realized: PortfolioSeries;
  };
  byStage:   Record<string, { invested: number; currentValue: number | null; count: number }>;
  byRegion:  Record<string, { invested: number; currentValue: number | null; count: number }>;
  byVintage: Record<string, { invested: number; currentValue: number | null; count: number }>;
  /** Ruling Q10 — computed from platform snapshots, or null with a reason. */
  cohortBenchmark: {
    p25: number; p50: number; p75: number; you: number | null; n: number;
    source: "platform_snapshots";
  } | null;
  cohortStatus: "COMPUTED" | "INSUFFICIENT_COHORT" | "NO_DATA";
  cohortReason?: string;
};

export interface RealPosition {
  invested: number;
  /** `null` for an UNMARKED holding. RP-2: never silently equal to cost. */
  currentValue: number | null;
  stage: string;
  sector: string;
  vintageYear: number;
  companyId: string;
  roundId: string;
  shares: number;
  currency: string;
  ts: string;
  markBadge: MarkBadge;
}

/** The raw commit rows an investor's analytics are derived from. */
export function commitsForUser(userId: string): Array<{
  companyId: string; roundId: string; amount: string; shares: string; currency: string; ts: string;
}> {
  try {
    return (listCommitsForUser(userId) as unknown as Array<Record<string, any>>).map((c) => ({
      companyId: String(c.companyId ?? ""),
      roundId: String(c.roundId ?? ""),
      amount: String(c.amount ?? "0"),
      shares: String(c.shares ?? "0"),
      currency: String(c.currency ?? "USD"),
      ts: String(c.ts ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Derive real positions for a userId, WITH marks.
 *
 * RP-2 lands here: `currentValue` is the derived mark times the share count, or
 * `null`. It is never the invested amount. The old line
 *   `currentValue: safeInvested, /* no mark-to-market until marks service is wired *​/`
 * is gone — the marks service (M-2) is now wired, and where it has nothing to
 * say the position is reported as unmarked rather than as valued-at-cost.
 */
export function realPositionsForUser(userId: string, asOf?: string): RealPosition[] {
  const commits = commitsForUser(userId);
  if (commits.length === 0) return [];
  const bundle = buildInvestorMetrics(commits, { asOf, lpId: userId });
  return bundle.positions.map((p) => {
    const tsYear = Number.parseInt((p.ts || "").slice(0, 4), 10);
    return {
      invested: p.invested,
      currentValue: p.currentValue,
      stage: "Unknown",
      sector: "Unknown",
      vintageYear: Number.isFinite(tsYear) && tsYear > 1990 ? tsYear : new Date().getUTCFullYear(),
      companyId: p.companyId,
      roundId: p.roundId,
      shares: p.shares,
      currency: p.currency,
      ts: p.ts,
      markBadge: (p.mark?.badge ?? "unmarked") as MarkBadge,
    };
  });
}

function emptySeries(reason: string, minPoints: number): PortfolioSeries {
  return { points: [], renderable: false, minPoints, reason };
}

function seriesFrom(
  points: Array<{ periodStart: string; value: number | null }>,
  renderable: boolean,
  minPoints: number,
  reason?: string,
): PortfolioSeries {
  return { points, renderable, minPoints, reason };
}

/**
 * The honest empty payload. Every metric carries NO_FLOWS, every series is
 * not-renderable, the cohort is absent. Compare with the deleted version, which
 * returned `cohortBenchmark: {p25: 1.18, p50: 1.42, p75: 1.86, you: 0}` to an
 * investor who had made no investments at all (RP-5, first of two literal sites).
 */
function emptyAnalytics(asOf: string): PortfolioAnalytics {
  const none: ReportedMetric = {
    value: null,
    status: "NO_FLOWS",
    note: "No holdings on the cap-table ledger yet.",
  };
  const s = emptySeries("No snapshot history yet.", 3);
  return {
    totalInvested: 0,
    totalCurrentValue: null,
    totalRealized: 0,
    moic: none, tvpi: none, dpi: none, rvpi: none, irr: none,
    irrBasis: "none",
    paperGain: null,
    valuation: {
      totalPositions: 0, markedPositions: 0, unmarkedPositions: 0,
      staleMarks: 0, expiredMarks: 0, worstBadge: "unmarked", asOf,
    },
    yoyDelta: { moic: null, irr: null, paperValue: null },
    series: { moic: s, irr: s, tvpi: s, dpi: s, paperValue: s, realized: s },
    byStage: {}, byRegion: {}, byVintage: {},
    cohortBenchmark: null,
    cohortStatus: "NO_DATA",
    cohortReason: "No holdings, so there is nothing to benchmark.",
  };
}

function worstBadgeOf(b: InvestorMetricBundle): MarkBadge {
  if (b.positions.length === 0) return "unmarked";
  if (b.unmarkedPositions > 0) return "unmarked";
  if (b.expiredMarks > 0) return "expired";
  if (b.staleMarks > 0) return "stale";
  if (b.positions.some((p) => p.mark?.badge === "gp_override")) return "gp_override";
  return "fresh";
}

export function computePortfolioAnalyticsFor(
  positions: RealPosition[],
  opts?: { userId?: string; asOf?: string },
): PortfolioAnalytics {
  const asOf = (opts?.asOf ?? new Date().toISOString()).slice(0, 10);
  if (positions.length === 0) return emptyAnalytics(asOf);

  const commits = positions.map((p) => ({
    companyId: p.companyId, roundId: p.roundId,
    amount: String(p.invested), shares: String(p.shares),
    currency: p.currency, ts: p.ts,
  }));
  const bundle = buildInvestorMetrics(commits, { asOf, lpId: opts?.userId });
  const m = bundle.metrics;

  const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
  /* WAVE 33 OQ-33-2 sink 6 — both lines below were `x / 100`, a hardcoded ISO
   * 4217 exponent of 2, applied to figures produced by
   * `buildInvestorMetrics` (sink 1). This is sink 1's SECOND PATH: correcting
   * the producer alone would have left the investor-facing analytics surface
   * dividing a correct JPY minor figure by 100 anyway. `bundle.currency` is
   * the currency those very figures are denominated in. */
  const bundleCurrency = bundle.currency;
  const totalCurrentValue =
    bundle.residualValueMinor === null ? null : fromMinor(bundle.residualValueMinor, bundleCurrency);
  const totalRealized = fromMinor(m.inputs.distributedMinor, bundleCurrency);
  const paperGain = totalCurrentValue === null ? null : totalCurrentValue - totalInvested;

  // MOIC on this platform means total value over cost. With no marks there is
  // no total value, so MOIC inherits TVPI's status rather than printing 1.0x.
  const moic: ReportedMetric = { value: m.TVPI.value, status: m.TVPI.status, note: m.TVPI.note };

  /* ---- Series and YoY: REAL monthly snapshots only (M-3, ruling Q9) ------ */
  let series: PortfolioAnalytics["series"];
  let yoyDelta: PortfolioAnalytics["yoyDelta"] = { moic: null, irr: null, paperValue: null };
  try {
    const sr = getChartSeries("investor", opts?.userId ?? "");
    const pick = (fn: (p: (typeof sr.points)[number]) => number | null): PortfolioSeries =>
      seriesFrom(
        sr.points.map((p) => ({ periodStart: p.periodStart, value: fn(p) })),
        sr.renderable,
        sr.minPoints,
        sr.reason,
      );
    series = {
      moic: pick((p) => p.tvpi),
      irr: pick((p) => p.netIrr),
      tvpi: pick((p) => p.tvpi),
      dpi: pick((p) => p.dpi),
      paperValue: pick((p) => p.rvpi),
      realized: pick((p) => p.dpi),
    };
    // YoY is the delta against the snapshot 12 months back — a real
    // measurement or nothing at all.
    const target = monthStart(
      new Date(Date.UTC(Number(asOf.slice(0, 4)) - 1, Number(asOf.slice(5, 7)) - 1, 1)).toISOString(),
    );
    const prior = sr.points.find((p) => p.periodStart === target);
    if (prior) {
      yoyDelta = {
        moic: prior.tvpi !== null && m.TVPI.value !== null ? +(m.TVPI.value - prior.tvpi).toFixed(4) : null,
        irr: prior.netIrr !== null && m.net_IRR.value !== null ? +(m.net_IRR.value - prior.netIrr).toFixed(6) : null,
        paperValue: null,
      };
    }
  } catch {
    const s = emptySeries("Snapshot history is unavailable.", 3);
    series = { moic: s, irr: s, tvpi: s, dpi: s, paperValue: s, realized: s };
  }

  /* ---- Cohort benchmark: PLATFORM DATA at or above min N (M-4, Q10) ------ */
  let cohortBenchmark: PortfolioAnalytics["cohortBenchmark"] = null;
  let cohortStatus: PortfolioAnalytics["cohortStatus"] = "NO_DATA";
  let cohortReason: string | undefined;
  try {
    const cb = computeCohortBenchmark({
      metric: "tvpi",
      periodStart: asOf,
      subjectKind: "investor",
      youSubjectId: opts?.userId,
    });
    cohortStatus = cb.status;
    cohortReason = cb.reason;
    if (cb.benchmark) {
      cohortBenchmark = {
        p25: cb.benchmark.p25, p50: cb.benchmark.p50, p75: cb.benchmark.p75,
        you: cb.benchmark.you ?? m.TVPI.value, n: cb.benchmark.n,
        source: "platform_snapshots",
      };
    }
  } catch (err) {
    cohortStatus = "NO_DATA";
    cohortReason = "Benchmark data is unavailable.";
    void err;
  }

  /* ---- Buckets ----------------------------------------------------------- */
  const byStage:   PortfolioAnalytics["byStage"]   = {};
  const byRegion:  PortfolioAnalytics["byRegion"]  = {};
  const byVintage: PortfolioAnalytics["byVintage"] = {};
  /* SINGLE SOURCE OF TRUTH. Bucket money comes from `bundle.positions`, the
   * same DB-derived marks that produced `totalCurrentValue`, NOT from the
   * caller-supplied `RealPosition.currentValue`. Reading two different sources
   * for the same quantity is how a breakdown ends up not summing to its own
   * total, and a breakdown that disagrees with its total is a fabrication even
   * when both halves were computed honestly. `buildInvestorMetrics` maps
   * commits 1:1 in order, so index i corresponds to positions[i]. */
  const markedValueAt = (i: number): number | null => bundle.positions[i]?.currentValue ?? null;
  const bump = (
    bucket: Record<string, { invested: number; currentValue: number | null; count: number }>,
    key: string,
    p: RealPosition & { _markedValue: number | null },
  ): void => {
    bucket[key] ??= { invested: 0, currentValue: null, count: 0 };
    bucket[key].invested += p.invested;
    bucket[key].count += 1;
    // A bucket total is reported only when every holding in it is marked.
    if (p._markedValue === null) bucket[key].currentValue = null;
    else if (bucket[key].currentValue !== null || bucket[key].count === 1) {
      bucket[key].currentValue = (bucket[key].currentValue ?? 0) + p._markedValue;
    }
  };
  positions.forEach((p, i) => {
    const withMark = { ...p, _markedValue: markedValueAt(i) };
    bump(byStage, normaliseStage(p.stage), withMark);
    bump(byRegion, SECTOR_TO_REGION[p.sector] ?? "Other", withMark);
    bump(byVintage, String(p.vintageYear), withMark);
  });

  return {
    totalInvested,
    totalCurrentValue,
    totalRealized,
    moic,
    tvpi: { value: m.TVPI.value, status: m.TVPI.status, note: m.TVPI.note },
    dpi:  { value: m.DPI.value,  status: m.DPI.status,  note: m.DPI.note },
    rvpi: { value: m.RVPI.value, status: m.RVPI.status, note: m.RVPI.note },
    irr:  { value: m.net_IRR.value, status: m.net_IRR.status, note: m.net_IRR.note },
    irrBasis: m.inputs.irrBasis,
    paperGain,
    valuation: {
      totalPositions: positions.length,
      markedPositions: bundle.markedPositions,
      unmarkedPositions: bundle.unmarkedPositions,
      staleMarks: bundle.staleMarks,
      expiredMarks: bundle.expiredMarks,
      worstBadge: worstBadgeOf(bundle),
      asOf,
    },
    yoyDelta,
    series,
    byStage, byRegion, byVintage,
    cohortBenchmark,
    cohortStatus,
    cohortReason,
  };
}

/**
 * Back-compat shim. It NO LONGER reads `./mockData`.
 *
 * The previous body mapped `investorPortfolio` — the demo seed — into the
 * analytics engine. Keeping that import alive in a reporting surface is exactly
 * the "no sample data in a reporting surface" prohibition, so the seed path is
 * removed and the shim returns the honest empty payload. Callers that want real
 * numbers must pass real positions.
 */
export function computePortfolioAnalytics(): PortfolioAnalytics {
  return computePortfolioAnalyticsFor([]);
}

export function registerPortfolioAnalyticsRoutes(app: Express): void {
  app.get("/api/investor/portfolio/analytics", (req: Request, res: Response) => {
    /* Derive analytics from the caller's REAL cap-table commits. A fresh
     * investor with no commits gets an honest empty payload with statuses; we
     * never serve a seed, and we never serve another investor's numbers. */
    const ctx = (req as any).userContext;
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const positions = realPositionsForUser(ctx.userId);
    res.json(computePortfolioAnalyticsFor(positions, { userId: ctx.userId }));
  });
}
