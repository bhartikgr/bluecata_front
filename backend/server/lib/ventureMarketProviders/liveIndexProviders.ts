/**
 * W-V44 FIX K — live, key-gated global index providers.
 *
 * Implements REAL HTTP adapters for the four admin-selectable market-data
 * providers (Polygon.io, Finnhub, Alpha Vantage, Twelve Data). Each resolves
 * the latest closing LEVEL for the eight benchmark indices in
 * STOOQ_INDEX_REGISTRY and shapes them into VentureMarketRecord rows —
 * identical output contract to the Stooq provider so the resolver/UI need no
 * changes.
 *
 * HARD RULES (mirroring stooq.ts):
 *   - NO fabricated numbers. English display names come from the registry; only
 *     the numeric LEVEL comes from the live feed. Any symbol the provider does
 *     not return fails closed to `marketValue: null` → renders "—".
 *   - KEY-GATED. The API key is read DB-first via getMarketDataApiKey(); if it
 *     is absent the caller (ventureMarketsStore) falls back to stooq/OECD and
 *     this module is never invoked. As a second guard, a missing key here
 *     yields all-null records (never throws).
 *   - Injectable fetch for tests (no network), ~5s timeout per request, and the
 *     caller applies the existing 60s cache.
 *
 * Index-ticker coverage differs per provider and some index endpoints are
 * paid-only; every per-symbol lookup independently fails closed to null so a
 * partial provider still returns the full eight-row set (some "—").
 */
import type { VentureMarketRecord, VentureProviderId } from "../../ventureMarketsStore";
import {
  STOOQ_INDEX_REGISTRY,
  type StooqIndexRegistryEntry,
} from "../../../client/src/data/ventureMarketRegistry";
import { getMarketDataApiKey } from "../../collectiveAdminSettingsStore";
import { log } from "../logger";

/** Injectable JSON fetch: given a URL, resolve the parsed JSON body. */
export type JsonFetch = (url: string) => Promise<unknown>;

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Per-provider ticker map keyed by the registry's stooqSymbol (our stable
 * cross-provider index id). A `null`/absent entry means "this provider has no
 * reliable free ticker for this index" → that row fails closed to null.
 */
const PROVIDER_SYMBOLS: Record<
  Exclude<VentureProviderId, "oecd_baseline" | "stooq" | "official_exchange_scrape">,
  Partial<Record<string, string>>
> = {
  // Polygon.io index tickers use an "I:" prefix.
  polygon: {
    "^spx": "I:SPX",
    "^ndq": "I:COMP",
    "^dji": "I:DJI",
  },
  // Twelve Data accepts common index symbols directly.
  twelve_data: {
    "^spx": "SPX",
    "^ndq": "IXIC",
    "^dji": "DJI",
    "^ukx": "UKX",
    "^nkx": "N225",
    "^hsi": "HSI",
  },
  // Finnhub index symbols use a caret prefix on the /quote endpoint.
  finnhub: {
    "^spx": "^GSPC",
    "^ndq": "^IXIC",
    "^dji": "^DJI",
  },
  // Alpha Vantage free tier does not expose index levels reliably; ETF proxies
  // are intentionally NOT used (would misrepresent the index). Left empty →
  // all-null (honest "—") until a premium index endpoint is wired.
  alpha_vantage: {},
};

const PROVIDER_SOURCE_LABEL: Record<string, string> = {
  polygon: "Polygon.io (live index feed)",
  twelve_data: "Twelve Data (live index feed)",
  finnhub: "Finnhub (live index feed)",
  alpha_vantage: "Alpha Vantage (live index feed)",
};

/** Default network JSON fetch — global fetch + AbortController timeout. */
const defaultJsonFetch: JsonFetch = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "capavate-venture-markets/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Round to two decimals for display stability. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the per-provider request URL for a single index ticker. */
function buildUrl(provider: string, ticker: string, apiKey: string): string {
  const k = encodeURIComponent(apiKey);
  const t = encodeURIComponent(ticker);
  switch (provider) {
    case "polygon":
      // Previous close aggregate for an index ticker.
      return `https://api.polygon.io/v2/aggs/ticker/${t}/prev?adjusted=true&apiKey=${k}`;
    case "twelve_data":
      return `https://api.twelvedata.com/quote?symbol=${t}&apikey=${k}`;
    case "finnhub":
      return `https://finnhub.io/api/v1/quote?symbol=${t}&token=${k}`;
    case "alpha_vantage":
      return `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${t}&apikey=${k}`;
    default:
      return "";
  }
}

/** Extract the latest close level from a provider's JSON payload (null-safe). */
function extractLevel(provider: string, body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, any>;
  try {
    switch (provider) {
      case "polygon": {
        const c = obj?.results?.[0]?.c;
        return Number.isFinite(Number(c)) ? Number(c) : null;
      }
      case "twelve_data": {
        const c = obj?.close ?? obj?.price;
        return Number.isFinite(Number(c)) ? Number(c) : null;
      }
      case "finnhub": {
        // { c: current, pc: prevClose } — prefer current, fall back to prev.
        const c = obj?.c && Number(obj.c) !== 0 ? obj.c : obj?.pc;
        return Number.isFinite(Number(c)) ? Number(c) : null;
      }
      case "alpha_vantage": {
        const c = obj?.["Global Quote"]?.["05. price"];
        return Number.isFinite(Number(c)) ? Number(c) : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function recordFor(
  entry: StooqIndexRegistryEntry,
  level: number | null,
  asOfDate: string,
  provider: string,
): VentureMarketRecord {
  return {
    exchangeSymbol: entry.exchangeSymbol,
    exchangeName: entry.exchangeName,
    displayFlag: entry.displayFlag,
    region: entry.region,
    marketValue: level == null ? null : round2(level),
    marketValueType: "index_level",
    asOfDate,
    source: PROVIDER_SOURCE_LABEL[provider] ?? provider,
    confidence: level == null ? "estimated" : "high",
  };
}

/**
 * Resolve the eight index records from a live key-gated provider. Always
 * returns one record per registry index; any missing/failed symbol fails
 * closed to `marketValue: null`. Never throws.
 */
export async function getLiveIndexVentureMarkets(
  provider: Exclude<VentureProviderId, "oecd_baseline" | "stooq" | "official_exchange_scrape">,
  fetchImpl: JsonFetch = defaultJsonFetch,
  apiKeyOverride?: string,
): Promise<VentureMarketRecord[]> {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const apiKey = apiKeyOverride ?? getMarketDataApiKey(provider);
  const symbolMap = PROVIDER_SYMBOLS[provider] ?? {};

  // No key → all-null (honest). The caller normally falls back before here.
  if (!apiKey) {
    log.warn(`[liveIndexProviders] ${provider} has no API key; failing closed to null`);
    return STOOQ_INDEX_REGISTRY.map((e) => recordFor(e, null, asOfDate, provider));
  }

  const results = await Promise.all(
    STOOQ_INDEX_REGISTRY.map(async (entry) => {
      const ticker = symbolMap[entry.stooqSymbol];
      if (!ticker) return recordFor(entry, null, asOfDate, provider);
      try {
        const body = await fetchImpl(buildUrl(provider, ticker, apiKey));
        return recordFor(entry, extractLevel(provider, body), asOfDate, provider);
      } catch (err) {
        log.warn(
          `[liveIndexProviders] ${provider}:${ticker} failed, null:`,
          (err as Error).message,
        );
        return recordFor(entry, null, asOfDate, provider);
      }
    }),
  );
  return results;
}

export default getLiveIndexVentureMarkets;
