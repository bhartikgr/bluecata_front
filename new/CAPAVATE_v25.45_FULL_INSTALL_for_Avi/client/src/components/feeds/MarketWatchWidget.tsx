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
 * an em-dash and a configure hint — never fabricated numbers. The Capavate
 * Pulse row always shows real DB numbers.
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
interface TickerPayload {
  status: "OK" | "PROVIDER_NOT_CONFIGURED";
  market: Quote[];
  crypto: Quote[];
  macro: Quote[];
  capavate: CapavatePulse;
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
  const marketAndMacro = data ? [...data.market, ...data.macro] : [];
  const pulse = data?.capavate;

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
            Configure a market data provider in <code>.env</code> to enable live
            feeds.{" "}
            <a
              href="/admin/integrations"
              className="underline text-[#cc0001] hover:text-[#a30001]"
              data-testid="marketwatch-configure-link"
            >
              Open integrations
            </a>
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
                {data!.crypto.map((q) => (
                  <QuoteRow key={`cr-${q.symbol}`} q={q} />
                ))}
              </div>
            </div>
          </div>
        )}

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
