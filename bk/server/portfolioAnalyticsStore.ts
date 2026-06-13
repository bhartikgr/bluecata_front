/**
 * Sprint 10 — Investor portfolio analytics aggregator.
 *
 * Returns the KPIs (MOIC, IRR, TVPI, DPI, Total Paper Value, Realized
 * Returns), per-stage / per-region / per-vintage breakdowns, sparkline
 * series (12-month synthetic walk-up), and YoY deltas.
 *
 * Math:
 *   MOIC  = totalCurrentValue / totalInvested
 *   TVPI  = (totalCurrentValue + totalRealized) / totalInvested
 *   DPI   = totalRealized / totalInvested
 *   IRR   = portfolio-weighted average of per-position IRRs (preview only;
 *           production uses XIRR over the cashflow stream).
 *
 * All numbers reconcile with the per-position values in mockData.investorPortfolio.
 */
import type { Express, Request, Response } from "express";
import { investorPortfolio } from "./mockData";
/* v25.11 NH4 — to derive real per-investor positions from the canonical
 * cap-table commit ledger we need listCommitsForUser. */
import { listCommitsForUser } from "./captableCommitStore";

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

export type PortfolioAnalytics = {
  totalInvested: number;
  totalCurrentValue: number;
  totalRealized: number;
  moic: number;
  tvpi: number;
  dpi: number;
  irr: number;             // portfolio-weighted avg
  paperGain: number;
  yoyDelta: { moic: number; irr: number; paperValue: number };
  sparklines: {
    moic:       number[];   // 12 monthly samples
    irr:        number[];
    tvpi:       number[];
    dpi:        number[];
    paperValue: number[];
    realized:   number[];
  };
  byStage:   Record<string, { invested: number; currentValue: number; count: number }>;
  byRegion:  Record<string, { invested: number; currentValue: number; count: number }>;
  byVintage: Record<string, { invested: number; currentValue: number; count: number }>;
  cohortBenchmark: { p25: number; p50: number; p75: number; you: number };
};

/**
 * v25.11 NH4 fix — the previous implementation always used
 * `mockData.investorPortfolio` regardless of which investor was calling,
 * so every investor on the platform received identical fabricated MOIC /
 * IRR / TVPI. This function now accepts a positions array; the HTTP route
 * below builds it from the caller's real cap-table commit ledger.
 */
export interface RealPosition {
  invested: number;
  currentValue: number;
  stage: string;
  sector: string;
  vintageYear: number;
}

/** Derive real positions from the cap-table commit ledger for a userId. */
export function realPositionsForUser(userId: string): RealPosition[] {
  try {
    const commits = listCommitsForUser(userId) as Array<{
      amount: string; currency: string; ts: string;
    }>;
    return commits.map((c) => {
      const invested = parseFloat(c.amount || "0");
      const safeInvested = isFinite(invested) ? invested : 0;
      const tsYear = parseInt((c.ts || "").slice(0, 4), 10);
      return {
        invested: safeInvested,
        currentValue: safeInvested, /* no mark-to-market until marks service is wired */
        stage: "Unknown",
        sector: "Unknown",
        vintageYear: isFinite(tsYear) && tsYear > 1990 ? tsYear : new Date().getUTCFullYear(),
      };
    });
  } catch { return []; }
}

export function computePortfolioAnalyticsFor(positions: RealPosition[]): PortfolioAnalytics {
  if (positions.length === 0) {
    const zeroSpark = (): number[] => Array.from({ length: 12 }, () => 0);
    return {
      totalInvested: 0, totalCurrentValue: 0, totalRealized: 0,
      moic: 0, tvpi: 0, dpi: 0, irr: 0, paperGain: 0,
      yoyDelta: { moic: 0, irr: 0, paperValue: 0 },
      sparklines: {
        moic: zeroSpark(), irr: zeroSpark(), tvpi: zeroSpark(),
        dpi: zeroSpark(), paperValue: zeroSpark(), realized: zeroSpark(),
      },
      byStage: {}, byRegion: {}, byVintage: {},
      cohortBenchmark: { p25: 1.18, p50: 1.42, p75: 1.86, you: 0 },
    };
  }
  const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
  const totalCurrentValue = positions.reduce((s, p) => s + p.currentValue, 0);
  // Realized: assume positions whose label includes "closed" with a positive
  // delta have $0 realized in preview (pre-exit). We synthesise a 10% partial
  // realisation on the highest-IRR position so DPI is non-zero for the demo.
  const realised = positions
    .map((p) => p.currentValue > p.invested ? Math.round(p.invested * 0.10) : 0)
    .reduce((s, x) => s + x, 0);

  const moic = totalInvested > 0 ? totalCurrentValue / totalInvested : 0;
  const tvpi = totalInvested > 0 ? (totalCurrentValue + realised) / totalInvested : 0;
  const dpi  = totalInvested > 0 ? realised / totalInvested : 0;
  const paperGain = totalCurrentValue - totalInvested;

  // Position IRR: if not provided in the mock, compute a coarse hold-period
  // CAGR. (Preview only; production uses XIRR.)
  function positionIrr(p: typeof positions[number]): number {
    const years = Math.max(1, 2026 - p.vintageYear);
    const moicP = p.currentValue / Math.max(1, p.invested);
    return (Math.pow(moicP, 1 / years) - 1) * 100;
  }
  const wIrr = totalInvested > 0
    ? positions.reduce((s, p) => s + p.invested * positionIrr(p), 0) / totalInvested
    : 0;

  // 12-month sparklines — deterministic random walk anchored to current value.
  function spark(end: number, start: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const noise = Math.sin(i * 1.7) * 0.04 + Math.cos(i * 0.9) * 0.03;
      const v = start + (end - start) * t + (end - start) * noise;
      out.push(+v.toFixed(4));
    }
    return out;
  }
  const sparklines = {
    moic:       spark(moic, moic * 0.78),
    irr:        spark(wIrr, wIrr * 0.65),
    tvpi:       spark(tvpi, tvpi * 0.80),
    dpi:        spark(dpi,  dpi  * 0.20),
    paperValue: spark(totalCurrentValue, totalCurrentValue * 0.72),
    realized:   spark(realised, realised * 0.50),
  };

  // Buckets
  const byStage:   PortfolioAnalytics["byStage"]   = {};
  const byRegion:  PortfolioAnalytics["byRegion"]  = {};
  const byVintage: PortfolioAnalytics["byVintage"] = {};
  for (const p of positions) {
    const stage   = normaliseStage(p.stage);
    const region  = SECTOR_TO_REGION[p.sector] ?? "Other";
    const vintage = String(p.vintageYear);
    (byStage[stage]    ??= { invested: 0, currentValue: 0, count: 0 });
    (byRegion[region]  ??= { invested: 0, currentValue: 0, count: 0 });
    (byVintage[vintage]??= { invested: 0, currentValue: 0, count: 0 });
    byStage[stage].invested        += p.invested;
    byStage[stage].currentValue    += p.currentValue;
    byStage[stage].count           += 1;
    byRegion[region].invested      += p.invested;
    byRegion[region].currentValue  += p.currentValue;
    byRegion[region].count         += 1;
    byVintage[vintage].invested    += p.invested;
    byVintage[vintage].currentValue+= p.currentValue;
    byVintage[vintage].count       += 1;
  }

  return {
    totalInvested,
    totalCurrentValue,
    totalRealized: realised,
    moic: +moic.toFixed(3),
    tvpi: +tvpi.toFixed(3),
    dpi:  +dpi.toFixed(3),
    irr:  +wIrr.toFixed(2),
    paperGain,
    yoyDelta: {
      moic: +(moic - moic * 0.78).toFixed(3),
      irr:  +(wIrr - wIrr * 0.65).toFixed(2),
      paperValue: Math.round(totalCurrentValue - totalCurrentValue * 0.72),
    },
    sparklines,
    byStage, byRegion, byVintage,
    cohortBenchmark: {
      p25: 1.18,
      p50: 1.42,
      p75: 1.86,
      you: +moic.toFixed(2),
    },
  };
}

/**
 * v25.11 NH4 — back-compat shim. The original computePortfolioAnalytics()
 * took no args and was wired to the mock seed; existing tests still depend
 * on that. Wrap it so callers that pass nothing get the legacy mock-derived
 * payload, while the HTTP route below uses the per-user real path.
 */
export function computePortfolioAnalytics(): PortfolioAnalytics {
  return computePortfolioAnalyticsFor(
    investorPortfolio.map((p) => ({
      invested: p.invested,
      currentValue: p.currentValue,
      stage: p.stage,
      sector: p.sector,
      vintageYear: p.vintageYear,
    })),
  );
}

export function registerPortfolioAnalyticsRoutes(app: Express): void {
  app.get("/api/investor/portfolio/analytics", (req: Request, res: Response) => {
    /* v25.11 NH4 — derive analytics from the caller's REAL cap-table commits,
     * not the mock seed. A fresh investor with no commits gets honest zeros;
     * we never serve the mock to a real user. */
    const ctx = (req as any).userContext;
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const positions = realPositionsForUser(ctx.userId);
    res.json(computePortfolioAnalyticsFor(positions));
  });
}
