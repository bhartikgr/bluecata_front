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
import { getLiveIndexVentureMarkets } from "./lib/ventureMarketProviders/liveIndexProviders"; /* W-V44 FIX K */
import { getCollectiveSettings, getMarketDataApiKey } from "./collectiveAdminSettingsStore"; /* getMarketDataApiKey: W-V44 FIX K */
import type { VentureMetricType } from "../client/src/data/ventureMarketRegistry";
import { log } from "./lib/logger";

export type VentureProviderId =
  | "oecd_baseline"
  | "stooq" /* GROUP E (1e/E2) — free global index feed, default provider */
  | "official_exchange_scrape"
  | "alpha_vantage"
  | "finnhub"
  | "polygon" /* W-V44 FIX K — Polygon.io (key-gated live adapter) */
  | "twelve_data"; /* W-V44 FIX K — Twelve Data (key-gated live adapter) */

/** All accepted provider ids (for admin/env validation). */
export const VENTURE_PROVIDER_IDS: VentureProviderId[] = [
  "oecd_baseline",
  "stooq",
  "official_exchange_scrape",
  "alpha_vantage",
  "finnhub",
  "polygon",
  "twelve_data",
];

/**
 * W-V44 FIX K — providers that require an admin-configured API key to operate.
 * When one of these is the active provider but no key is set, the resolver
 * transparently falls back to the free stooq/OECD baseline (never errors).
 */
export const KEY_GATED_PROVIDER_IDS: VentureProviderId[] = [
  "alpha_vantage",
  "finnhub",
  "polygon",
  "twelve_data",
];

/** Human-readable provider metadata for the admin Integrations UI. */
export const VENTURE_PROVIDER_META: Record<
  VentureProviderId,
  { label: string; requiresKey: boolean; docsUrl: string; blurb: string }
> = {
  oecd_baseline: {
    label: "OECD Baseline (built-in)",
    requiresKey: false,
    docsUrl: "https://data.oecd.org",
    blurb: "Always-available synchronous baseline. No key required; used as the ultimate fallback.",
  },
  stooq: {
    label: "Stooq (free, default)",
    requiresKey: false,
    docsUrl: "https://stooq.com",
    blurb: "Free global index feed. Default provider; no API key required.",
  },
  official_exchange_scrape: {
    label: "Official Exchange (built-in)",
    requiresKey: false,
    docsUrl: "",
    blurb: "Reserved built-in provider hook. No key required.",
  },
  alpha_vantage: {
    label: "Alpha Vantage",
    requiresKey: true,
    docsUrl: "https://www.alphavantage.co/support/#api-key",
    blurb: "Global equities/indices. Free tier ~25 req/day; premium keys lift the limit.",
  },
  finnhub: {
    label: "Finnhub",
    requiresKey: true,
    docsUrl: "https://finnhub.io/dashboard",
    blurb: "Real-time global market data. Free tier ~60 req/min with an API key.",
  },
  polygon: {
    label: "Polygon.io",
    requiresKey: true,
    docsUrl: "https://polygon.io/dashboard/api-keys",
    blurb: "US + global market data. Requires an API key; generous paid tiers.",
  },
  twelve_data: {
    label: "Twelve Data",
    requiresKey: true,
    docsUrl: "https://twelvedata.com/account/api-keys",
    blurb: "Global stocks, forex, indices. Free tier ~800 req/day with an API key.",
  },
};

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
 * W-V44 FIX K (Option A) — the ADMIN PANEL is the single source of truth.
 * Effective provider = the DB-persisted admin selection (mirrored live into the
 * in-memory `activeProvider`, re-hydrated from collective settings on boot).
 * The VENTURE_MARKET_PROVIDER env var is NO LONGER an override — it is used only
 * as the initial default when seeding a fresh (empty) database (see
 * collectiveAdminSettingsStore.defaultVentureProvider). This guarantees the
 * admin choice always wins and can never be silently overridden by deploy env.
 */
export function getActiveProvider(): VentureProviderId {
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
    } else if (
      // W-V44 FIX K — live key-gated providers. Read the DB-configured key; if
      // it's missing, transparently FALL BACK to the free stooq feed so the
      // widget never errors or blanks out. When a key IS present, use the real
      // live adapter (per-symbol fail-closed to null inside the adapter).
      provider === "polygon" ||
      provider === "twelve_data" ||
      provider === "finnhub" ||
      provider === "alpha_vantage"
    ) {
      const key = getMarketDataApiKey(provider);
      if (!key) {
        log.warn(
          `[ventureMarketsStore] ${provider} selected but no API key configured; falling back to stooq`,
        );
        const records = await getStooqVentureMarkets();
        response = buildResponse(records, "index_level");
      } else {
        const records = await getLiveIndexVentureMarkets(provider);
        response = buildResponse(records, "index_level");
      }
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
  // W-V44 FIX K (Option A) — hydrate the live provider from the DB-persisted
  // admin selection on boot. The admin panel is the single source of truth
  // (getActiveProvider no longer honours an env override); env only seeds the
  // initial default on a fresh DB via collectiveAdminSettingsStore.
  try {
    const persisted = getCollectiveSettings().ventureProvider;
    if (isVentureProviderId(persisted)) setProvider(persisted);
  } catch {
    // DB not ready / settings absent — keep the default provider (stooq).
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
