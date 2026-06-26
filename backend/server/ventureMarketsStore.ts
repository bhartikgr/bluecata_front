/**
 * v25.44 Surface 14 — Global Venture & Early-Stage Markets resolver.
 *
 * Replaces the v25.43 Market Watch "PROVIDER_NOT_CONFIGURED" scaffold for the
 * structural-comparison view. The persistent intraday ticker bar (feedsStore)
 * is untouched — this is the lower-churn structural view.
 *
 * Provider architecture (per the developer prompt's swappable ETL design):
 *   - Tier 1 (shipped in v25.44): oecd_baseline — static OECD seed.
 *   - Tier 2/3 (future): official_exchange_scrape, alpha_vantage, finnhub —
 *     each its own module under server/lib/ventureMarketProviders/. NOT wired
 *     in v25.44; setProvider() leaves a clean hook point.
 *
 * HARD RULE: NO fabricated numbers. Pending boards resolve to marketValue:null
 * and render "—". Every record carries asOfDate + source + confidence.
 */
import type { Express, Request, Response } from "express";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { getOecdBaseline, type VentureMarketBaselineRecord } from "./lib/ventureMarketProviders/oecdBaseline";
import type { VentureMetricType } from "../client/src/data/ventureMarketRegistry";
import { log } from "./lib/logger";

export type VentureProviderId =
  | "oecd_baseline"
  | "official_exchange_scrape"
  | "alpha_vantage"
  | "finnhub";

export interface VentureMarketRecord {
  exchangeSymbol: string;
  exchangeName: string;
  displayFlag: string;
  region: string;
  marketValue: number | null;
  marketValueType: VentureMetricType;
  asOfDate: string;
  source: string;
  sourceUrl?: string;
  estimated?: boolean;
  confidence: "high" | "medium" | "low" | "estimated";
}

export interface VentureMarketsResponse {
  asOfDate: string;
  records: VentureMarketRecord[];
  metricType: VentureMetricType;
  status: "OK" | "PROVIDER_NOT_CONFIGURED";
}

/** Active provider. v25.44 ships only oecd_baseline. */
let activeProvider: VentureProviderId = "oecd_baseline";

/** Hook point for future provider wiring (per the spec). */
export function setProvider(provider: VentureProviderId): void {
  activeProvider = provider;
}

export function getActiveProvider(): VentureProviderId {
  return activeProvider;
}

function newestAsOf(records: VentureMarketRecord[]): string {
  let newest = "";
  for (const r of records) {
    if (r.asOfDate && r.asOfDate > newest) newest = r.asOfDate;
  }
  return newest || new Date().toISOString().slice(0, 10);
}

/** Sort DESC by marketValue; nulls sort last (stable by symbol then). */
function sortByMarketValueDesc(records: VentureMarketRecord[]): VentureMarketRecord[] {
  return [...records].sort((a, b) => {
    const av = a.marketValue;
    const bv = b.marketValue;
    if (av == null && bv == null) return a.exchangeSymbol.localeCompare(b.exchangeSymbol);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

export function getVentureMarkets(): VentureMarketsResponse {
  let baseline: VentureMarketBaselineRecord[];
  try {
    if (activeProvider === "oecd_baseline") {
      baseline = getOecdBaseline();
    } else {
      // Future providers are not wired in v25.44.
      return {
        asOfDate: new Date().toISOString().slice(0, 10),
        records: [],
        metricType: "issuer_count",
        status: "PROVIDER_NOT_CONFIGURED",
      };
    }
  } catch (err) {
    log.warn("[ventureMarketsStore] baseline resolve failed:", (err as Error).message);
    return {
      asOfDate: new Date().toISOString().slice(0, 10),
      records: [],
      metricType: "issuer_count",
      status: "PROVIDER_NOT_CONFIGURED",
    };
  }

  const records: VentureMarketRecord[] = baseline.map((r) => ({
    exchangeSymbol: r.exchangeSymbol,
    exchangeName: r.exchangeName,
    displayFlag: r.displayFlag,
    region: r.region,
    marketValue: r.marketValue,
    marketValueType: r.marketValueType,
    asOfDate: r.asOfDate,
    source: r.source,
    sourceUrl: r.sourceUrl,
    estimated: r.estimated,
    confidence: r.confidence,
  }));

  const sorted = sortByMarketValueDesc(records);
  return {
    asOfDate: newestAsOf(sorted),
    records: sorted,
    metricType: "issuer_count",
    status: "OK",
  };
}

export function registerVentureMarketsRoutes(app: Express): void {
  // requireAuth (member or partner) — uses requireCollectiveMember which also
  // admits admins and is mounted behind /api/collective's requireAuthenticated.
  // The /api/feeds path is NOT behind /api/collective, so we attach the
  // membership guard explicitly here.
  app.get(
    "/api/feeds/venture-markets",
    requireCollectiveMember,
    (_req: Request, res: Response) => {
      res.json(getVentureMarkets());
    },
  );
}

export default registerVentureMarketsRoutes;
