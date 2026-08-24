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
 * WAVE 105 — PROVIDER RESOLUTION IS NOW DB-DRIVEN AND PER REQUEST.
 *
 * Before this wave the provider was read ONCE at module load into a `const`,
 * so (a) the admin Integrations screen (which persists its selection and its
 * API keys into `collective_admin_settings`) could never reach this feed, and
 * (b) even setting the env var required a restart. Both are fixed here:
 * `resolveTickerProvider()` runs on EVERY request.
 *
 * PRECEDENCE (highest first):
 *   1. `FEEDS_PROVIDER` env var, when set and non-empty, WINS OUTRIGHT.
 *        - "yahoo_coingecko"          → live keyless feed (historical behaviour,
 *                                        byte-identical outcome).
 *        - any other KNOWN provider id (stooq, oecd_baseline,
 *          official_exchange_scrape, alpha_vantage, finnhub, polygon,
 *          twelve_data)               → live feed, same key-gate rule as below.
 *        - an unrecognised value      → PROVIDER_NOT_CONFIGURED (historical
 *                                        behaviour) plus a server-side warning.
 *   2. Otherwise THE DATABASE DECIDES: the administrator's persisted
 *      `ventureProvider` in `collective_admin_settings`, read live via
 *      `getCollectiveSettings()`. Only a genuinely PERSISTED selection counts —
 *      `getCollectiveSettings()` also returns a library default for a database
 *      that was never configured, and a never-configured deployment must keep
 *      the honest "not configured" state rather than silently claim a provider.
 *   3. Nothing resolvable → status PROVIDER_NOT_CONFIGURED with EMPTY
 *      market/crypto/macro arrays. We never fabricate a price, a zero or a dash.
 *
 * KEY GATE / DOCUMENTED FREE-FEED FALLBACK: for the key-gated providers
 * (alpha_vantage, finnhub, polygon, twelve_data) the resolver reads the
 * DB-stored key. A key-gated provider selected WITHOUT a key falls back to the
 * free keyless feed (`freeFeedFallback: true`) instead of erroring — exactly
 * what the admin screen promises and what `resolveVentureMarkets()` already does.
 *
 * ATTRIBUTION, HONESTLY: this ticker's adapters are keyless (Yahoo chart API +
 * CoinGecko) and cover THIS symbol catalog. The keyed vendor adapters that exist
 * on the platform return venture INDEX LEVELS, not this catalog. So the admin
 * selection decides WHETHER live intraday feeds are on and is reported as
 * `provider.configured`, while `provider.feed` truthfully reports the upstream
 * that produced the numbers. Real prices from a real provider, always.
 *
 * NO SECRET EVER LEAVES THIS FILE: `/api/feeds/ticker` is polled by the browser.
 * The resolver returns provider ids, an enum and a boolean — never a key.
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
import { rawDb } from "./db/connection";
import { getCollectiveSettings, getMarketDataApiKey } from "./collectiveAdminSettingsStore";
import { isVentureProviderId, KEY_GATED_PROVIDER_IDS } from "./ventureMarketsStore";

/* ---------- External-provider config (WAVE 105: resolved per request) ---------- */

/** The one intraday upstream this file can actually serve (keyless). */
const FREE_FEED_ID = "yahoo_coingecko" as const;

/** Row key used by collectiveAdminSettingsStore for the settings object. */
const ADMIN_SETTINGS_ROW_KEY = "collective";

/**
 * Provider resolution result. Contains ONLY non-secret metadata: it is part of
 * the browser-facing payload.
 */
export interface TickerProviderInfo {
  /** Upstream that produced the quotes, or null when nothing is configured. */
  feed: typeof FREE_FEED_ID | null;
  /** Provider id chosen by the env var or by the administrator. Never a key. */
  configured: string | null;
  /** Where the decision came from. */
  source: "environment" | "admin" | "none";
  /** True when a key-gated selection had no key and fell back to the free feed. */
  freeFeedFallback: boolean;
}

const PROVIDER_NONE: TickerProviderInfo = {
  feed: null,
  configured: null,
  source: "none",
  freeFeedFallback: false,
};

function isKeyGated(providerId: string): boolean {
  return (KEY_GATED_PROVIDER_IDS as string[]).includes(providerId);
}

/**
 * Resolve a known provider id to a feed descriptor, applying the key gate.
 * A key-gated provider with no stored key falls back to the free feed.
 */
function describeProvider(
  providerId: string,
  source: "environment" | "admin",
): TickerProviderInfo {
  let freeFeedFallback = false;
  if (isKeyGated(providerId)) {
    let key = "";
    try {
      key = getMarketDataApiKey(providerId);
    } catch (e) {
      log.warn("[feedsStore] market-data key lookup failed:", (e as Error).message);
    }
    if (!key) {
      freeFeedFallback = true;
      log.warn(
        `[feedsStore] ${providerId} selected but no API key configured; serving the free feed`,
      );
    }
    // The key is intentionally consumed here and NEVER returned or logged.
    key = "";
    void key;
  }
  return { feed: FREE_FEED_ID, configured: providerId, source, freeFeedFallback };
}

/**
 * Has an administrator actually persisted a settings row with a provider?
 * `getCollectiveSettings()` falls back to library defaults for a database that
 * was never configured, so the raw row is what tells "configured" apart from
 * "never touched". Read-only; any failure means "not configured".
 */
function hasPersistedProviderSelection(): boolean {
  try {
    const row = rawDb()
      .prepare(`SELECT value_json FROM collective_admin_settings WHERE key = ?`)
      .get(ADMIN_SETTINGS_ROW_KEY) as { value_json: string | null } | undefined;
    if (!row || !row.value_json) return false;
    const parsed = JSON.parse(row.value_json) as Record<string, unknown>;
    const v = parsed?.ventureProvider;
    return typeof v === "string" && v.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * WAVE 105 — the live, per-request provider resolver. See the file header for
 * the precedence rules. Pure read: never writes, never throws.
 */
export function resolveTickerProvider(): TickerProviderInfo {
  // 1. Environment override (kept working for existing deployments).
  const envValue = (process.env.FEEDS_PROVIDER ?? "").trim();
  if (envValue.length > 0) {
    if (envValue === FREE_FEED_ID) {
      return { feed: FREE_FEED_ID, configured: envValue, source: "environment", freeFeedFallback: false };
    }
    if (isVentureProviderId(envValue)) {
      return describeProvider(envValue, "environment");
    }
    log.warn("[feedsStore] configured market data provider is not recognised; feeds stay off");
    return PROVIDER_NONE;
  }

  // 2. The database decides — the administrator's persisted selection.
  try {
    if (!hasPersistedProviderSelection()) return PROVIDER_NONE;
    const selected = getCollectiveSettings().ventureProvider;
    if (typeof selected === "string" && isVentureProviderId(selected.trim())) {
      return describeProvider(selected.trim(), "admin");
    }
  } catch (e) {
    log.warn("[feedsStore] provider resolution from settings failed:", (e as Error).message);
  }

  // 3. Nothing configured anywhere — honest empty state.
  return PROVIDER_NONE;
}

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
  /** WAVE 105 — non-secret provider status so the UI can be honest. */
  provider: TickerProviderInfo;
  /**
   * WAVE 105 — true only for an authenticated administrator, so the empty state
   * can tell an admin that a provider needs configuring while a member simply
   * sees that live pricing is unavailable. Never affects the numbers.
   */
  viewerCanConfigure?: boolean;
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

/* ---------- 60s in-process cache (avoid provider rate limits) ----------
   WAVE 105: keyed by the resolved feed id so a live provider change can never
   be served the previous provider's rows. */
let _cache: { at: number; feed: string; market: Quote[]; crypto: Quote[]; macro: Quote[] } | null = null;
const CACHE_TTL_MS = 60_000;

/** Test-only hook — drop the quote cache (mirrors _invalidateVentureMarketsCache). */
export function _invalidateFeedsCache(): void {
  _cache = null;
}

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
async function getExternalFeeds(feed: string): Promise<{ market: Quote[]; crypto: Quote[]; macro: Quote[] }> {
  const now = Date.now();
  if (_cache && _cache.feed === feed && now - _cache.at < CACHE_TTL_MS) {
    return { market: _cache.market, crypto: _cache.crypto, macro: _cache.macro };
  }
  const [market, macro, crypto] = await Promise.all([
    fetchYahooGroup(MARKET_SYMBOLS),
    fetchYahooGroup(MACRO_SYMBOLS),
    fetchCrypto(),
  ]);
  _cache = { at: now, feed, market, crypto, macro };
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
  // WAVE 105 — resolved per call: an admin change applies live, no restart.
  const provider = resolveTickerProvider();

  if (provider.feed == null) {
    // No external market-data provider configured — clearly marked, no fakes.
    return {
      status: "PROVIDER_NOT_CONFIGURED",
      market: [],
      crypto: [],
      macro: [],
      capavate,
      provider,
    };
  }

  try {
    const { market, crypto, macro } = await getExternalFeeds(provider.feed);
    return { status: "OK", market, crypto, macro, capavate, provider };
  } catch (e) {
    log.warn("[feedsStore] external feeds failed, returning PROVIDER_NOT_CONFIGURED:", (e as Error).message);
    return {
      status: "PROVIDER_NOT_CONFIGURED",
      market: [],
      crypto: [],
      macro: [],
      capavate,
      provider: PROVIDER_NONE,
    };
  }
}

/* ---------- Route registration ---------- */
export function registerFeedsRoutes(app: Express): void {
  app.get("/api/feeds/ticker", async (req: Request, res: Response) => {
    // WAVE 105 — best-effort, read-only viewer check so the empty state can be
    // admin-aware. Never gates the data; never returns identity details.
    let viewerCanConfigure = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getUserContext } = require("./lib/userContext");
      const ctx = getUserContext(req);
      viewerCanConfigure = Boolean(ctx?.isAuthed && ctx?.isAdmin);
    } catch (e) {
      log.warn("[feedsStore] viewer role lookup unavailable:", (e as Error).message);
    }

    try {
      const payload = await buildTickerPayload();
      res.json({ ...payload, viewerCanConfigure });
    } catch (e) {
      log.warn("[feedsStore] /api/feeds/ticker error:", (e as Error).message);
      // Even on error the Capavate-internal counts must come from the DB.
      res.json({
        status: "PROVIDER_NOT_CONFIGURED",
        market: [],
        crypto: [],
        macro: [],
        capavate: getCapavatePulse(),
        provider: PROVIDER_NONE,
        viewerCanConfigure,
      } satisfies TickerPayload);
    }
  });
}
