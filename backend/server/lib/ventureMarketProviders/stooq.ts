/**
 * GROUP E (1e/E2) — Stooq global INDEX provider.
 *
 * Fetches free, no-API-key INDEX quotes from Stooq's CSV endpoint for eight
 * global benchmarks (^spx ^ndq ^dji ^stx ^ukx ^nkx ^hsi ^shc) and shapes them
 * into VentureMarketRecord rows.
 *
 * HARD RULES honoured:
 *   - NO fabricated numbers. Stooq's CSV is numeric/symbol-only, so the ENGLISH
 *     display names come from our registry (STOOQ_INDEX_REGISTRY); only the
 *     numeric LEVEL comes from the feed.
 *   - FAIL-CLOSED. On any fetch error / timeout / unpar. seable row the record's
 *     marketValue is `null` (renders "—" client-side). We never invent a level.
 *   - Injectable fetch (for tests, no network), ~4s timeout, and the caller
 *     (ventureMarketsStore) applies the existing 60s cache.
 */
import type { VentureMarketRecord } from "../../ventureMarketsStore";
import {
  STOOQ_INDEX_REGISTRY,
  type StooqIndexRegistryEntry,
} from "../../../client/src/data/ventureMarketRegistry";
import { log } from "../logger";

/** Injectable fetch: given the request URL, resolve the raw CSV body text. */
export type StooqCsvFetch = (url: string) => Promise<string>;

const STOOQ_TIMEOUT_MS = 4000;
const STOOQ_SOURCE = "Stooq (free index feed)";

/** Build the multi-symbol Stooq CSV request URL for the registry indices. */
export function buildStooqUrl(symbols: string[]): string {
  const s = symbols.join(",");
  // f=sd2t2ohlcv → Symbol,Date,Time,Open,High,Low,Close,Volume; h → header row.
  return `https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`;
}

/** Default network fetch — global fetch + AbortController timeout. No key. */
const defaultFetch: StooqCsvFetch = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STOOQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "capavate-venture-markets/1.0", Accept: "text/csv" },
    });
    if (!res.ok) throw new Error(`stooq_http_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

/** Parse a Stooq CSV body into a symbol→closing-level map (null when absent). */
export function parseStooqCsv(csv: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!csv) return out;
  const lines = csv.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return out;

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const symIdx = header.indexOf("symbol");
  const closeIdx = header.indexOf("close");
  if (symIdx === -1 || closeIdx === -1) return out;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const sym = (cols[symIdx] ?? "").trim().toLowerCase();
    if (!sym) continue;
    const rawClose = (cols[closeIdx] ?? "").trim();
    const n = Number(rawClose);
    // "N/D" (or any non-finite) → null. NEVER fabricate.
    out.set(sym, rawClose !== "" && Number.isFinite(n) ? n : null);
  }
  return out;
}

/** Round to two decimals for display stability (levels are points values). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function recordFor(
  entry: StooqIndexRegistryEntry,
  level: number | null,
  asOfDate: string,
): VentureMarketRecord {
  return {
    exchangeSymbol: entry.exchangeSymbol,
    exchangeName: entry.exchangeName,
    displayFlag: entry.displayFlag,
    region: entry.region,
    marketValue: level == null ? null : round2(level),
    marketValueType: "index_level",
    asOfDate,
    source: STOOQ_SOURCE,
    sourceUrl: "https://stooq.com/",
    confidence: level == null ? "estimated" : "high",
  };
}

/**
 * Resolve the eight index records. Always returns one record per registry
 * index; on any failure every record fails closed to `marketValue: null`.
 */
export async function getStooqVentureMarkets(
  fetchImpl: StooqCsvFetch = defaultFetch,
): Promise<VentureMarketRecord[]> {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const symbols = STOOQ_INDEX_REGISTRY.map((e) => e.stooqSymbol);

  let levels = new Map<string, number | null>();
  try {
    const csv = await fetchImpl(buildStooqUrl(symbols));
    levels = parseStooqCsv(csv);
  } catch (err) {
    // Fail closed — return English-named records with null levels ("—").
    log.warn("[stooq] fetch/parse failed, failing closed to null:", (err as Error).message);
  }

  return STOOQ_INDEX_REGISTRY.map((entry) =>
    recordFor(entry, levels.get(entry.stooqSymbol) ?? null, asOfDate),
  );
}

export default getStooqVentureMarkets;
