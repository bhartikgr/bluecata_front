/**
 * v25.44 Surface 14 — OECD baseline provider (the ONLY provider shipped in
 * v25.44). Static seed derived from the OECD "Equity markets for growth
 * companies" dataset + the developer-prompt seed table.
 *
 * HARD RULE: NO fabricated numbers. Boards whose issuer count requires an
 * official extraction from exchange sources are seeded `marketValue: null`
 * (confidence "estimated") and render "—" client-side until a real provider is
 * wired. Ecosystem-level totals are flagged `estimated: true`.
 *
 * Other providers (official_exchange_scrape, alpha_vantage, finnhub) are
 * out-of-scope for v25.44 — they get their own modules in this directory in
 * later releases (per the spec's "Future: real provider wiring").
 */

import type { VentureMetricType, VentureConfidence } from "../../../client/src/data/ventureMarketRegistry";

export interface VentureMarketBaselineRecord {
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
  confidence: VentureConfidence;
}

const OECD_AS_OF = "2025-12-31";
const OECD_SOURCE = "OECD growth markets dataset";
const OECD_URL = "https://www.oecd.org/corporate/equity-markets-growth-companies.htm";

/**
 * Baseline seed. Values that the OECD reports cleanly per-board are seeded with
 * high confidence; ecosystem-level totals are flagged estimated=true with the
 * combined ecosystem symbol; per-board breakouts pending official extraction
 * are seeded marketValue:null.
 */
export const OECD_BASELINE_SEED: VentureMarketBaselineRecord[] = [
  {
    exchangeSymbol: "TSXV",
    exchangeName: "TSX Venture Exchange",
    displayFlag: "🇨🇦",
    region: "Canada",
    marketValue: 2418,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: OECD_SOURCE,
    sourceUrl: OECD_URL,
    confidence: "high",
  },
  {
    exchangeSymbol: "KOSDAQ",
    exchangeName: "KOSDAQ",
    displayFlag: "🇰🇷",
    region: "South Korea",
    // KOSDAQ + KONEX ecosystem total (1742) is reported at ecosystem level by
    // OECD; attributed to the KOSDAQ row as an ecosystem estimate.
    marketValue: 1742,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: `${OECD_SOURCE} (KOSDAQ + KONEX ecosystem)`,
    sourceUrl: OECD_URL,
    estimated: true,
    confidence: "medium",
  },
  {
    exchangeSymbol: "KONEX",
    exchangeName: "KONEX",
    displayFlag: "🇰🇷",
    region: "South Korea",
    // Board-level breakout pending official extraction (counted in the KOSDAQ
    // ecosystem total above). NO fabricated number.
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
  {
    exchangeSymbol: "NCM",
    exchangeName: "Nasdaq Capital Market",
    displayFlag: "🇺🇸",
    region: "United States",
    // NCM + NYSE American combined US growth ecosystem (1376) reported at
    // ecosystem level; per-board breakout pending → null here, ecosystem total
    // is not attributed to a single board to avoid fabrication.
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
  {
    exchangeSymbol: "NYSE American",
    exchangeName: "NYSE American",
    displayFlag: "🇺🇸",
    region: "United States",
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
  {
    exchangeSymbol: "AIM",
    exchangeName: "AIM (London Stock Exchange)",
    displayFlag: "🇬🇧",
    region: "United Kingdom",
    marketValue: 787,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: `${OECD_SOURCE} / LSE`,
    sourceUrl: "https://www.londonstockexchange.com/raise-finance/equity/aim",
    confidence: "high",
  },
  {
    exchangeSymbol: "Euronext Growth",
    exchangeName: "Euronext Growth",
    displayFlag: "🇪🇺",
    region: "Europe",
    marketValue: 800,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: `${OECD_SOURCE} / Euronext (ecosystem)`,
    sourceUrl: "https://www.euronext.com/en/raise-capital/euronext-growth",
    estimated: true,
    confidence: "medium",
  },
  {
    exchangeSymbol: "First North",
    exchangeName: "Nasdaq First North Growth Market",
    displayFlag: "🇸🇪",
    region: "Nordics / Baltics",
    marketValue: 500,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: `${OECD_SOURCE} / Nasdaq Nordic (ecosystem)`,
    sourceUrl: "https://www.nasdaq.com/european-markets/first-north-growth-market",
    estimated: true,
    confidence: "medium",
  },
  {
    exchangeSymbol: "ChiNext",
    exchangeName: "Shenzhen ChiNext",
    displayFlag: "🇨🇳",
    region: "China",
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
  {
    exchangeSymbol: "STAR",
    exchangeName: "Shanghai STAR Market",
    displayFlag: "🇨🇳",
    region: "China",
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
  {
    exchangeSymbol: "BSE",
    exchangeName: "Beijing Stock Exchange",
    displayFlag: "🇨🇳",
    region: "China",
    marketValue: null,
    marketValueType: "issuer_count",
    asOfDate: OECD_AS_OF,
    source: "pending official extraction",
    confidence: "estimated",
  },
];

export function getOecdBaseline(): VentureMarketBaselineRecord[] {
  // Return a defensive copy so callers cannot mutate the seed.
  return OECD_BASELINE_SEED.map((r) => ({ ...r }));
}
