/**
 * client/src/components/feeds/MarketWatchWidget.tsx — v25.43 R3-4 (B)
 *
 * Market Watch widget for the Collective Dashboard, mounted above the existing
 * stat cards. Two-column card:
 *   - LEFT:  Market & macro snapshot (SPX, Nasdaq, VIX, 10Y, DXY, Gold) with
 *            last + day-change. (No sparkline — no charting lib is installed.)
 *   - RIGHT: Crypto snapshot (BTC, ETH, SOL).
 * Beneath: a "Capavate Pulse" row with today's real DB-backed internal stats.
 *
 * Polls `GET /api/feeds/ticker` every 60s. Follows the R3-2 brand re-skin:
 * white card, slate border, brand-red (#cc0001) accents, navy (#041e41) text.
 *
 * HARD RULE: when the provider isn't configured the market/crypto cells show
 * an em-dash and a hint — never fabricated numbers. The Capavate Pulse row
 * always shows real DB numbers.
 *
 * WAVE 105 — the empty state no longer names any deployment or configuration
 * mechanics to a customer. It is viewer-aware: an administrator is told that a
 * market data provider needs selecting and is linked to the market data
 * settings screen; a member simply learns that live pricing is unavailable.
 * "Provider selected but it returned no quotes" is shown as its own state so
 * nobody is sent to change a setting that is already correct.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

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
interface TickerProviderInfo {
  feed: string | null;
  configured: string | null;
  source: "environment" | "admin" | "none";
  freeFeedFallback: boolean;
}
interface TickerPayload {
  status: "OK" | "PROVIDER_NOT_CONFIGURED";
  market: Quote[];
  crypto: Quote[];
  macro: Quote[];
  capavate: CapavatePulse;
  /** WAVE 105 — non-secret provider status (never carries an API key). */
  provider?: TickerProviderInfo;
  /** WAVE 105 — true only for an administrator, drives the admin-only hint. */
  viewerCanConfigure?: boolean;
}

function fmtNum(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function QuoteRow({ q }: { q: Quote }) {
  const up = (q.changePct ?? 0) >= 0;
  const pct = fmtPct(q.changePct);
  return (
    <div
      className="flex items-center justify-between py-1.5 text-sm"
      data-testid={`marketwatch-row-${q.symbol}`}
    >
      <span className="text-slate-600">{q.label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono tabular-nums text-[#041e41]">{fmtNum(q.last)}</span>
        {pct && (
          <span className={`text-xs ${up ? "text-[#2d8b4e]" : "text-[#cc0001]"}`}>{pct}</span>
        )}
      </span>
    </div>
  );
}

export function MarketWatchWidget() {
  const [data, setData] = useState<TickerPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await apiRequest("GET", "/api/feeds/ticker");
        const json = (await res.json()) as TickerPayload;
        if (mounted) setData(json);
      } catch {
        /* non-critical */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const providerOff = !data || data.status === "PROVIDER_NOT_CONFIGURED";
  // Defensive: tolerate a partial payload rather than crashing the dashboard.
  const marketRows: Quote[] = Array.isArray(data?.market) ? data!.market : [];
  const cryptoRows: Quote[] = Array.isArray(data?.crypto) ? data!.crypto : [];
  const macroRows: Quote[] = Array.isArray(data?.macro) ? data!.macro : [];
  const marketAndMacro = [...marketRows, ...macroRows];
  const pulse = data?.capavate;
  // A server that predates WAVE 105 sends no `viewerCanConfigure` field; in that
  // case keep the historical hint rather than hiding it from administrators.
  const canConfigure = data?.viewerCanConfigure !== false;
  const quotes: Quote[] = [...marketRows, ...cryptoRows, ...macroRows];
  const feedSilent = !providerOff && quotes.length > 0 && quotes.every((q) => q.last == null);

  return (
    <Card
      className="bg-white border border-slate-200 rounded-2xl shadow-sm"
      data-testid="market-watch-widget"
    >
      <CardHeader className="pb-2">
        <CardTitle className="font-serif text-lg text-[#041e41]">Market Watch</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {providerOff ? (
          <div
            className="rounded-xl border border-slate-200 bg-[#faf6f1] p-4 text-sm text-slate-600"
            data-testid="marketwatch-provider-unavailable"
          >
            {canConfigure ? (
              <>
                Select a market data provider to enable live pricing.{" "}
                <a
                  href="/admin/integrations"
                  className="underline text-[#cc0001] hover:text-[#a30001]"
                  data-testid="marketwatch-configure-link"
                >
                  Open market data settings
                </a>
              </>
            ) : (
              <span data-testid="marketwatch-provider-unavailable-member">
                Live market pricing is unavailable right now.
              </span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div data-testid="marketwatch-market">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#cc0001] mb-1">
                Market &amp; Macro
              </div>
              <div className="divide-y divide-slate-100">
                {marketAndMacro.map((q) => (
                  <QuoteRow key={`mm-${q.symbol}`} q={q} />
                ))}
              </div>
            </div>
            <div data-testid="marketwatch-crypto">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#cc0001] mb-1">
                Crypto
              </div>
              <div className="divide-y divide-slate-100">
                {cryptoRows.map((q) => (
                  <QuoteRow key={`cr-${q.symbol}`} q={q} />
                ))}
              </div>
            </div>
          </div>
        )}

        {feedSilent ? (
          <div
            className="rounded-xl border border-slate-200 bg-[#faf6f1] p-3 text-xs text-slate-600"
            data-testid="marketwatch-feed-silent"
          >
            The selected market data provider returned no quotes just now. Live
            pricing will resume automatically.
          </div>
        ) : null}

        {/* Capavate Pulse — ALWAYS real DB numbers. */}
        <div
          className="rounded-xl bg-[#041e41] text-white px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm"
          data-testid="marketwatch-capavate-pulse"
        >
          <span className="font-semibold text-[#6fcf97]">Capavate Pulse</span>
          <span>
            <strong className="font-mono">{pulse ? pulse.applicationsToday : "—"}</strong> applications today
          </span>
          <span>
            <strong className="font-mono">{pulse ? pulse.roundsOpenedToday : "—"}</strong> rounds opened
          </span>
          <span>
            <strong className="font-mono">{pulse ? pulse.connectionsToday : "—"}</strong> connections made
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default MarketWatchWidget;
