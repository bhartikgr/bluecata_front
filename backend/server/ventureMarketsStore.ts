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
import { getStooqVentureMarkets } from "./lib/ventureMarketProviders/stooq";
import { getCollectiveSettings } from "./collectiveAdminSettingsStore";
import type { VentureMetricType } from "../client/src/data/ventureMarketRegistry";
import { log } from "./lib/logger";

export type VentureProviderId =
  | "oecd_baseline"
  | "stooq" /* GROUP E (1e/E2) — free global index feed, default provider */
  | "official_exchange_scrape"
  | "alpha_vantage"
  | "finnhub";

/** All accepted provider ids (for admin/env validation). */
export const VENTURE_PROVIDER_IDS: VentureProviderId[] = [
  "oecd_baseline",
  "stooq",
  "official_exchange_scrape",
  "alpha_vantage",
  "finnhub",
];

export function isVentureProviderId(v: unknown): v is VentureProviderId {
  return typeof v === "string" && (VENTURE_PROVIDER_IDS as string[]).includes(v);
}

/** GROUP E — default provider is the free Stooq global index feed. */
export const DEFAULT_VENTURE_PROVIDER: VentureProviderId = "stooq";

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

/** In-memory active provider (set via setProvider / admin route). */
let activeProvider: VentureProviderId = DEFAULT_VENTURE_PROVIDER;

/** Swappable hook: set the live provider (used by the admin route). */
export function setProvider(provider: VentureProviderId): void {
  activeProvider = provider;
}

/**
 * Effective provider precedence: env override (VENTURE_MARKET_PROVIDER) wins,
 * else the in-memory provider (default stooq). The admin route persists its
 * choice to collective settings AND calls setProvider so it takes effect live.
 */
export function getActiveProvider(): VentureProviderId {
  const envRaw = process.env.VENTURE_MARKET_PROVIDER;
  if (isVentureProviderId(envRaw)) return envRaw;
  return activeProvider;
}

/* GROUP E (1e/E2) — 60s in-process cache for the async (Stooq) provider, so
   we don't hammer the free feed. Keyed by provider id. */
const CACHE_TTL_MS = 60_000;
let _cache: { at: number; provider: VentureProviderId; response: VentureMarketsResponse } | null = null;

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

function providerNotConfigured(): VentureMarketsResponse {
  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    records: [],
    metricType: "issuer_count",
    status: "PROVIDER_NOT_CONFIGURED",
  };
}

/** Synchronous OECD baseline response (the always-available fallback provider). */
function buildOecdResponse(): VentureMarketsResponse {
  let baseline: VentureMarketBaselineRecord[];
  try {
    baseline = getOecdBaseline();
  } catch (err) {
    log.warn("[ventureMarketsStore] baseline resolve failed:", (err as Error).message);
    return providerNotConfigured();
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

/**
 * Synchronous OECD baseline response. Kept for existing synchronous callers
 * (e.g. /api/markets/quote). Provider-independent so it never returns empty
 * when the async default (stooq) is active.
 */
export function getVentureMarkets(): VentureMarketsResponse {
  return buildOecdResponse();
}

/** Build a sorted OK response for a provider's records + metric. */
function buildResponse(
  records: VentureMarketRecord[],
  metricType: VentureMetricType,
): VentureMarketsResponse {
  const sorted = sortByMarketValueDesc(records);
  return {
    asOfDate: newestAsOf(sorted),
    records: sorted,
    metricType,
    status: "OK",
  };
}

/**
 * GROUP E (1e/E2) — async provider resolver used by the venture-markets feed.
 * Honours the active provider (env > setProvider > default stooq), applies the
 * 60s cache, and FAILS CLOSED (the stooq provider yields null levels on error;
 * unknown providers → PROVIDER_NOT_CONFIGURED).
 */
export async function resolveVentureMarkets(): Promise<VentureMarketsResponse> {
  const provider = getActiveProvider();
  const now = Date.now();
  if (_cache && _cache.provider === provider && now - _cache.at < CACHE_TTL_MS) {
    return _cache.response;
  }

  let response: VentureMarketsResponse;
  try {
    if (provider === "stooq") {
      const records = await getStooqVentureMarkets();
      response = buildResponse(records, "index_level");
    } else if (provider === "oecd_baseline") {
      response = buildOecdResponse();
    } else {
      response = providerNotConfigured();
    }
  } catch (err) {
    log.warn("[ventureMarketsStore] resolve failed:", (err as Error).message);
    response = providerNotConfigured();
  }

  _cache = { at: now, provider, response };
  return response;
}

/** Test-only hook to clear the async provider cache. */
export function _invalidateVentureMarketsCache(): void {
  _cache = null;
}

export function registerVentureMarketsRoutes(app: Express): void {
  // GROUP E — initialise the live provider from persisted collective settings
  // (best-effort; env still wins in getActiveProvider, default stays stooq).
  try {
    const persisted = getCollectiveSettings().ventureProvider;
    if (isVentureProviderId(persisted)) setProvider(persisted);
  } catch {
    // DB not ready / settings absent — keep the default provider.
  }

  // requireAuth (member or partner) — uses requireCollectiveMember which also
  // admits admins and is mounted behind /api/collective's requireAuthenticated.
  // The /api/feeds path is NOT behind /api/collective, so we attach the
  // membership guard explicitly here.
  app.get(
    "/api/feeds/venture-markets",
    requireCollectiveMember,
    async (_req: Request, res: Response) => {
      res.json(await resolveVentureMarkets());
    },
  );
}

export default registerVentureMarketsRoutes;
