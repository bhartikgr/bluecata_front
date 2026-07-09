/**
 * GROUP E (1e/E2) — Stooq global-index provider tests.
 *
 * Network is MOCKED throughout (injectable fetch); nothing here touches the
 * real Stooq endpoint. Proves:
 *   - CSV parses to English-named records (names come from our registry, not
 *     the feed, which is symbol/numeric only);
 *   - all eight indices are always present;
 *   - "N/D" / unparseable / missing rows → marketValue null (never fabricated);
 *   - fetch error / timeout → every record fails closed to null.
 */
import { describe, it, expect } from "vitest";
import {
  getStooqVentureMarkets,
  parseStooqCsv,
  buildStooqUrl,
  type StooqCsvFetch,
} from "../lib/ventureMarketProviders/stooq";
import { STOOQ_INDEX_REGISTRY } from "../../client/src/data/ventureMarketRegistry";

const SAMPLE_CSV = [
  "Symbol,Date,Time,Open,High,Low,Close,Volume",
  "^SPX,2026-07-09,22:00:00,5000,5060,4990,5042.18,0",
  "^NDQ,2026-07-09,22:00:00,17000,17200,16950,17155.5,0",
  "^DJI,2026-07-09,22:00:00,39000,39300,38900,39210.42,0",
  "^STX,2026-07-09,22:00:00,4900,4950,4880,4933.7,0",
  "^UKX,2026-07-09,22:00:00,8100,8150,8080,8123.9,0",
  "^NKX,2026-07-09,22:00:00,39000,39500,38800,39400.12,0",
  "^HSI,2026-07-09,22:00:00,18000,18200,17900,18150.6,0",
  "^SHC,2026-07-09,22:00:00,3200,3250,3180,3233.55,0",
].join("\n");

function mockFetch(csv: string): StooqCsvFetch {
  return async () => csv;
}

describe("stooq provider (GROUP E 1e/E2)", () => {
  it("builds a CSV URL for the requested symbols (csv, no api key)", () => {
    const url = buildStooqUrl(["^spx", "^ndq"]);
    expect(url).toContain("stooq.com");
    expect(url).toContain("e=csv");
    expect(decodeURIComponent(url)).toContain("^spx,^ndq");
    expect(url).not.toContain("apikey");
  });

  it("parses a sample CSV into a symbol→close map", () => {
    const map = parseStooqCsv(SAMPLE_CSV);
    expect(map.get("^spx")).toBe(5042.18);
    expect(map.get("^shc")).toBe(3233.55);
    expect(map.size).toBe(8);
  });

  it("maps parsed levels onto ENGLISH registry records (names not from the feed)", async () => {
    const recs = await getStooqVentureMarkets(mockFetch(SAMPLE_CSV));
    const spx = recs.find((r) => r.exchangeSymbol === "S&P 500");
    expect(spx).toBeTruthy();
    expect(spx!.marketValue).toBe(5042.18);
    expect(spx!.marketValueType).toBe("index_level");
    expect(spx!.region).toBe("United States");
    // Every record carries an English name from the registry, never a raw ^sym.
    for (const r of recs) {
      expect(r.exchangeSymbol.startsWith("^")).toBe(false);
      expect(r.exchangeName.length).toBeGreaterThan(0);
    }
  });

  it("always returns exactly the eight registry indices", async () => {
    const recs = await getStooqVentureMarkets(mockFetch(SAMPLE_CSV));
    expect(recs.length).toBe(STOOQ_INDEX_REGISTRY.length);
    expect(recs.length).toBe(8);
  });

  it("treats 'N/D' close as null (never fabricated)", async () => {
    const csv = [
      "Symbol,Date,Time,Open,High,Low,Close,Volume",
      "^SPX,2026-07-09,22:00:00,5000,5060,4990,N/D,0",
    ].join("\n");
    const recs = await getStooqVentureMarkets(mockFetch(csv));
    const spx = recs.find((r) => r.exchangeSymbol === "S&P 500");
    expect(spx!.marketValue).toBeNull();
    expect(spx!.confidence).toBe("estimated");
  });

  it("missing symbols in the feed resolve to null, not omitted", async () => {
    // Only one row present → the other seven fail closed to null.
    const csv = [
      "Symbol,Date,Time,Open,High,Low,Close,Volume",
      "^UKX,2026-07-09,22:00:00,8100,8150,8080,8123.9,0",
    ].join("\n");
    const recs = await getStooqVentureMarkets(mockFetch(csv));
    expect(recs.length).toBe(8);
    const ukx = recs.find((r) => r.exchangeSymbol === "FTSE 100");
    expect(ukx!.marketValue).toBe(8123.9);
    const nulls = recs.filter((r) => r.marketValue == null);
    expect(nulls.length).toBe(7);
  });

  it("FAILS CLOSED on fetch error — every level null, still eight English records", async () => {
    const failing: StooqCsvFetch = async () => {
      throw new Error("network_down");
    };
    const recs = await getStooqVentureMarkets(failing);
    expect(recs.length).toBe(8);
    expect(recs.every((r) => r.marketValue === null)).toBe(true);
    // Names still resolve from the registry even with no data.
    expect(recs.find((r) => r.exchangeSymbol === "Nikkei 225")).toBeTruthy();
  });

  it("FAILS CLOSED on empty/garbage CSV", async () => {
    const recs = await getStooqVentureMarkets(mockFetch("not,a,valid\nfeed"));
    expect(recs.length).toBe(8);
    expect(recs.every((r) => r.marketValue === null)).toBe(true);
    expect(parseStooqCsv("").size).toBe(0);
  });
});
