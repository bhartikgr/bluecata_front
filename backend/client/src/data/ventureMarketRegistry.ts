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
  | "capacity_score";

export type VentureConfidence = "high" | "medium" | "low" | "estimated";

export type VentureSourcePriority =
  | "oecd"
  | "tmx"
  | "lse"
  | "euronext"
  | "nasdaq_nordic"
  | "official_exchange"
  | "alpha_vantage"
  | "finnhub";

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
