/**
 * server/feedsStore.ts — v25.43 R3-4 — Live data feeds (market + crypto + macro
 * + Capavate-internal).
 *
 * Exposes `GET /api/feeds/ticker` returning:
 *   {
 *     status: "OK" | "PROVIDER_NOT_CONFIGURED",
 *     market:  [{ symbol, label, last, changePct } ...] | [],
 *     crypto:  [{ symbol, label, last, changePct } ...] | [],
 *     macro:   [{ symbol, label, last, changePct } ...] | [],
 *     capavate: { applicationsToday, roundsOpenedToday, connectionsToday, asOf }
 *   }
 *
 * HARD RULE (Ozan): "100% DB driven, no in-memory mocks." For EXTERNAL feeds
 * (market/crypto/macro) we either pull from a REAL provider or return
 * PROVIDER_NOT_CONFIGURED. We NEVER fabricate prices.
 *
 *   - External provider is OPT-IN via the `FEEDS_PROVIDER` env var:
 *       FEEDS_PROVIDER=yahoo_coingecko   → live fetch (CoinGecko crypto +
 *                                           Yahoo unofficial chart API stocks/
 *                                           macro), no API key required, with a
 *                                           60s in-process cache so we don't get
 *                                           rate-limited.
 *       (unset / anything else)          → status PROVIDER_NOT_CONFIGURED and
 *                                           empty market/crypto/macro arrays.
 *     This default-off design keeps CI / offline builds deterministic (no
 *     network dependency in tests) while letting Ozan flip on a real provider
 *     by setting one env var — no fake numbers ever ship.
 *
 *   - The Capavate-internal block is ALWAYS real: live drizzle queries against
 *     `founder_collective_applications` (applications), `rounds` (rounds opened
 *     today), and `intro_requests` (connections made today).
 */
import type { Express, Request, Response } from "express";
import https from "node:https";
import { getDb } from "./db/connection";
import {
  founderCollectiveApplications as founderCollectiveApplicationsTable,
  rounds as roundsTable,
} from "../shared/schema";
import { log } from "./lib/logger";

/* ---------- External-provider config ---------- */
const PROVIDER = (process.env.FEEDS_PROVIDER ?? "").trim();
const PROVIDER_ENABLED = PROVIDER === "yahoo_coingecko";

/* ---------- Types ---------- */
interface Quote {
  symbol: string;
  label: string;
  last: number | null;
  changePct: number | null;
}
interface CapavatePulse {
  applicationsToday: number;
  roundsOpenedToday: number;
  connectionsToday: number;
  asOf: string;
}
export interface TickerPayload {
  status: "OK" | "PROVIDER_NOT_CONFIGURED";
  market: Quote[];
  crypto: Quote[];
  macro: Quote[];
  capavate: CapavatePulse;
}

/* ---------- Symbol catalogs ---------- */
const MARKET_SYMBOLS: Array<{ yahoo: string; symbol: string; label: string }> = [
  { yahoo: "^GSPC", symbol: "SPX", label: "S&P 500" },
  { yahoo: "^IXIC", symbol: "IXIC", label: "Nasdaq" },
  { yahoo: "^DJI", symbol: "DJI", label: "Dow" },
  { yahoo: "^VIX", symbol: "VIX", label: "VIX" },
];
const MACRO_SYMBOLS: Array<{ yahoo: string; symbol: string; label: string }> = [
  { yahoo: "^TNX", symbol: "US10Y", label: "US 10Y" },
  { yahoo: "DX-Y.NYB", symbol: "DXY", label: "USD Index" },
  { yahoo: "GC=F", symbol: "GOLD", label: "Gold" },
];
const CRYPTO_IDS: Array<{ id: string; symbol: string; label: string }> = [
  { id: "bitcoin", symbol: "BTC", label: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", label: "Ethereum" },
  { id: "solana", symbol: "SOL", label: "Solana" },
];

/* ---------- 60s in-process cache (avoid provider rate limits) ---------- */
let _cache: { at: number; market: Quote[]; crypto: Quote[]; macro: Quote[] } | null = null;
const CACHE_TTL_MS = 60_000;

/* ---------- HTTPS GET helper (resolves null on any failure) ---------- */
function httpsGetJson(url: string, timeoutMs = 4000): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        url,
        { headers: { "User-Agent": "capavate-feeds/1.0", Accept: "application/json" } },
        (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return resolve(null);
          }
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("error", () => resolve(null));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/* ---------- Yahoo unofficial chart quote (no API key) ---------- */
async function fetchYahooQuote(yahooSymbol: string): Promise<{ last: number | null; changePct: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  const j = await httpsGetJson(url);
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta) return { last: null, changePct: null };
  const last = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const prevClose =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
      ? meta.previousClose
      : null;
  const changePct =
    last != null && prevClose != null && prevClose !== 0
      ? ((last - prevClose) / prevClose) * 100
      : null;
  return { last, changePct };
}

/* ---------- CoinGecko crypto (no API key) ---------- */
async function fetchCrypto(): Promise<Quote[]> {
  const ids = CRYPTO_IDS.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const j = await httpsGetJson(url);
  return CRYPTO_IDS.map((c) => {
    const row = j?.[c.id];
    return {
      symbol: c.symbol,
      label: c.label,
      last: typeof row?.usd === "number" ? row.usd : null,
      changePct: typeof row?.usd_24h_change === "number" ? row.usd_24h_change : null,
    };
  });
}

async function fetchYahooGroup(
  list: Array<{ yahoo: string; symbol: string; label: string }>,
): Promise<Quote[]> {
  const out: Quote[] = [];
  for (const s of list) {
    const q = await fetchYahooQuote(s.yahoo);
    out.push({ symbol: s.symbol, label: s.label, last: q.last, changePct: q.changePct });
  }
  return out;
}

/* ---------- External feeds (cached) ---------- */
async function getExternalFeeds(): Promise<{ market: Quote[]; crypto: Quote[]; macro: Quote[] }> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) {
    return { market: _cache.market, crypto: _cache.crypto, macro: _cache.macro };
  }
  const [market, macro, crypto] = await Promise.all([
    fetchYahooGroup(MARKET_SYMBOLS),
    fetchYahooGroup(MACRO_SYMBOLS),
    fetchCrypto(),
  ]);
  _cache = { at: now, market, crypto, macro };
  return { market, crypto, macro };
}

/* ---------- Capavate-internal DB queries (ALWAYS real) ---------- */
function todayPrefix(): string {
  // ISO date prefix "YYYY-MM-DD" — createdAt columns store ISO timestamps.
  return new Date().toISOString().slice(0, 10);
}

function startsWithToday(v: unknown, prefix: string): boolean {
  return typeof v === "string" && v.slice(0, 10) === prefix;
}

export function getCapavatePulse(): CapavatePulse {
  const prefix = todayPrefix();
  let applicationsToday = 0;
  let roundsOpenedToday = 0;
  let connectionsToday = 0;

  try {
    const db: any = getDb();

    // Applications submitted today — founder_collective_applications.
    try {
      const rows = db.select().from(founderCollectiveApplicationsTable).all() as any[];
      applicationsToday = rows.filter((r) =>
        startsWithToday(r.created_at ?? r.createdAt ?? r.submitted_at ?? r.submittedAt, prefix),
      ).length;
    } catch (e) {
      log.warn("[feedsStore] applications count failed:", (e as Error).message);
    }

    // Rounds opened today — rounds.openDate (fallback createdAt).
    try {
      const rows = db.select().from(roundsTable).all() as any[];
      roundsOpenedToday = rows.filter((r) =>
        startsWithToday(r.open_date ?? r.openDate ?? r.created_at ?? r.createdAt, prefix),
      ).length;
    } catch (e) {
      log.warn("[feedsStore] rounds count failed:", (e as Error).message);
    }

    // Connections made today — intro_requests (intro = a connection between
    // companies). Queried via the raw handle so we don't depend on a drizzle
    // table model for this admin-provisioned table.
    void db;
    try {
      // Use the shared raw sqlite handle when available for intro_requests.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rawDb } = require("./db/connection");
      const rows = rawDb()
        .prepare(`SELECT created_at FROM intro_requests`)
        .all() as Array<{ created_at: string }>;
      connectionsToday = rows.filter((r) => startsWithToday(r.created_at, prefix)).length;
    } catch (e) {
      // Postgres or table-missing path — leave at 0 rather than fabricate.
      log.warn("[feedsStore] connections count unavailable:", (e as Error).message);
    }
  } catch (e) {
    log.warn("[feedsStore] getCapavatePulse failed:", (e as Error).message);
  }

  return {
    applicationsToday,
    roundsOpenedToday,
    connectionsToday,
    asOf: new Date().toISOString(),
  };
}

/* ---------- Build full payload ---------- */
export async function buildTickerPayload(): Promise<TickerPayload> {
  const capavate = getCapavatePulse();

  if (!PROVIDER_ENABLED) {
    // No external market-data provider configured — clearly marked, no fakes.
    return { status: "PROVIDER_NOT_CONFIGURED", market: [], crypto: [], macro: [], capavate };
  }

  try {
    const { market, crypto, macro } = await getExternalFeeds();
    return { status: "OK", market, crypto, macro, capavate };
  } catch (e) {
    log.warn("[feedsStore] external feeds failed, returning PROVIDER_NOT_CONFIGURED:", (e as Error).message);
    return { status: "PROVIDER_NOT_CONFIGURED", market: [], crypto: [], macro: [], capavate };
  }
}

/* ---------- Route registration ---------- */
export function registerFeedsRoutes(app: Express): void {
  app.get("/api/feeds/ticker", async (_req: Request, res: Response) => {
    try {
      const payload = await buildTickerPayload();
      res.json(payload);
    } catch (e) {
      log.warn("[feedsStore] /api/feeds/ticker error:", (e as Error).message);
      // Even on error the Capavate-internal counts must come from the DB.
      res.json({
        status: "PROVIDER_NOT_CONFIGURED",
        market: [],
        crypto: [],
        macro: [],
        capavate: getCapavatePulse(),
      } satisfies TickerPayload);
    }
  });
}
