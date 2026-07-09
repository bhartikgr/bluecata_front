/**
 * v25.44 Surface 14 — Global Venture & Early-Stage Markets registry.
 *
 * Canonical, swappable registry of the 11 venture/growth public markets the
 * widget tracks. The data layer (server/ventureMarketsStore.ts) resolves
 * marketValue per `sourcePriority`. NO fabricated numbers — boards whose
 * issuer count requires an official extraction are seeded `marketValue: null`
 * and render as "—" until a real provider is wired.
 *
 * Per the developer prompt: default metric is issuer_count (most universal +
 * stable comparator). Architecture allows switching to market_cap / ipo_count /
 * capital_raised / capacity_score without a UI redesign.
 */

export type VentureMetricType =
  | "issuer_count"
  | "market_cap"
  | "ipo_count"
  | "capital_raised"
  | "capacity_score"
  // GROUP E (1e/E2) — Stooq provider surfaces the latest closing LEVEL of a
  // benchmark equity index (points), not an issuer count.
  | "index_level";

export type VentureConfidence = "high" | "medium" | "low" | "estimated";

export type VentureSourcePriority =
  | "oecd"
  | "tmx"
  | "lse"
  | "euronext"
  | "nasdaq_nordic"
  | "official_exchange"
  | "alpha_vantage"
  | "finnhub"
  | "stooq"; // GROUP E (1e/E2)

export interface VentureMarketRegistryEntry {
  exchangeSymbol: string;
  exchangeName: string;
  displayFlag: string;
  region: string;
  canonicalMetric: VentureMetricType;
  sourcePriority: VentureSourcePriority[];
}

/**
 * The 11 required markets (per developer prompt §Required markets).
 * First North uses a Sweden visual proxy flag but is classified Nordic/Baltic.
 * Euronext Growth uses the EU flag because it spans multiple European venues.
 */
export const ventureMarketRegistry: VentureMarketRegistryEntry[] = [
  {
    exchangeSymbol: "ChiNext",
    exchangeName: "Shenzhen ChiNext",
    displayFlag: "🇨🇳",
    region: "China",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "STAR",
    exchangeName: "Shanghai STAR Market",
    displayFlag: "🇨🇳",
    region: "China",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "BSE",
    exchangeName: "Beijing Stock Exchange",
    displayFlag: "🇨🇳",
    region: "China",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "KOSDAQ",
    exchangeName: "KOSDAQ",
    displayFlag: "🇰🇷",
    region: "South Korea",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "KONEX",
    exchangeName: "KONEX",
    displayFlag: "🇰🇷",
    region: "South Korea",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "TSXV",
    exchangeName: "TSX Venture Exchange",
    displayFlag: "🇨🇦",
    region: "Canada",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "tmx"],
  },
  {
    exchangeSymbol: "NCM",
    exchangeName: "Nasdaq Capital Market",
    displayFlag: "🇺🇸",
    region: "United States",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "NYSE American",
    exchangeName: "NYSE American",
    displayFlag: "🇺🇸",
    region: "United States",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "official_exchange"],
  },
  {
    exchangeSymbol: "AIM",
    exchangeName: "AIM (London Stock Exchange)",
    displayFlag: "🇬🇧",
    region: "United Kingdom",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "lse"],
  },
  {
    exchangeSymbol: "First North",
    exchangeName: "Nasdaq First North Growth Market",
    displayFlag: "🇸🇪",
    region: "Nordics / Baltics",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "nasdaq_nordic"],
  },
  {
    exchangeSymbol: "Euronext Growth",
    exchangeName: "Euronext Growth",
    displayFlag: "🇪🇺",
    region: "Europe",
    canonicalMetric: "issuer_count",
    sourcePriority: ["oecd", "euronext"],
  },
];

/* ------------------------------------------------------------------ */
/* GROUP E (1e/E2) — Stooq global INDEX registry.                      */
/*                                                                     */
/* Stooq's free CSV feed is numeric/symbol-only (it carries no English */
/* names). This registry is the single source of ENGLISH display names */
/* + flags/regions the Stooq provider maps each raw symbol onto, so the */
/* widget never shows a bare ticker. Levels come from the live feed;    */
/* names come from here.                                                */
/* ------------------------------------------------------------------ */
export interface StooqIndexRegistryEntry {
  /** Raw Stooq symbol (lower-case, e.g. "^spx"). */
  stooqSymbol: string;
  /** English index name shown as the primary label. */
  exchangeSymbol: string;
  /** English descriptor shown as the secondary label. */
  exchangeName: string;
  displayFlag: string;
  region: string;
}

export const STOOQ_INDEX_REGISTRY: StooqIndexRegistryEntry[] = [
  { stooqSymbol: "^spx", exchangeSymbol: "S&P 500", exchangeName: "United States · large-cap equity index", displayFlag: "🇺🇸", region: "United States" },
  { stooqSymbol: "^ndq", exchangeSymbol: "Nasdaq Composite", exchangeName: "United States · technology-weighted index", displayFlag: "🇺🇸", region: "United States" },
  { stooqSymbol: "^dji", exchangeSymbol: "Dow Jones Industrial Average", exchangeName: "United States · blue-chip index", displayFlag: "🇺🇸", region: "United States" },
  { stooqSymbol: "^stx", exchangeSymbol: "Euro Stoxx 50", exchangeName: "Eurozone · blue-chip equity index", displayFlag: "🇪🇺", region: "Europe" },
  { stooqSymbol: "^ukx", exchangeSymbol: "FTSE 100", exchangeName: "United Kingdom · large-cap equity index", displayFlag: "🇬🇧", region: "United Kingdom" },
  { stooqSymbol: "^nkx", exchangeSymbol: "Nikkei 225", exchangeName: "Japan · large-cap equity index", displayFlag: "🇯🇵", region: "Japan" },
  { stooqSymbol: "^hsi", exchangeSymbol: "Hang Seng Index", exchangeName: "Hong Kong · large-cap equity index", displayFlag: "🇭🇰", region: "Hong Kong" },
  { stooqSymbol: "^shc", exchangeSymbol: "Shanghai Composite", exchangeName: "China · Shanghai all-share index", displayFlag: "🇨🇳", region: "China" },
];

/** Metric-aware English unit shown under each value (e.g. "issuers", "index level"). */
export function metricUnitLabel(metric: VentureMetricType | string): string {
  switch (metric) {
    case "issuer_count": return "issuers";
    case "index_level": return "index level";
    case "market_cap": return "market cap";
    case "ipo_count": return "IPOs";
    case "capital_raised": return "capital raised";
    case "capacity_score": return "capacity score";
    default: return "value";
  }
}

/** Metric-aware English description used for the header tooltip. */
export function metricDescription(metric: VentureMetricType | string): string {
  switch (metric) {
    case "issuer_count":
      return "Issuer count = number of listed companies on the venture/growth market.";
    case "index_level":
      return "Index level = latest closing level of the benchmark equity index (points).";
    case "market_cap":
      return "Market cap = aggregate market capitalisation of listed companies.";
    case "ipo_count":
      return "IPO count = number of initial public offerings in the period.";
    case "capital_raised":
      return "Capital raised = total capital raised by listed companies in the period.";
    case "capacity_score":
      return "Capacity score = composite measure of the market's capacity.";
    default:
      return "Market value for the tracked exchanges.";
  }
}

/** Short human label for the provenance line's metric (e.g. "issuer count"). */
export function metricDisplayName(metric: VentureMetricType | string): string {
  switch (metric) {
    case "issuer_count": return "issuer count";
    case "index_level": return "index level";
    case "market_cap": return "market cap";
    case "ipo_count": return "IPO count";
    case "capital_raised": return "capital raised";
    case "capacity_score": return "capacity score";
    default: return "market value";
  }
}
