/**
 * client/src/components/feeds/MarketTicker.tsx — v25.43 R3-4
 *
 * A thin persistent ticker strip mounted directly under the top app header in
 * the Collective + Consortium Partner shells (CollectiveShell). It polls
 * `GET /api/feeds/ticker` every 60s and renders STATIC ROTATING TILES (the
 * simpler of the two options in the brief) covering:
 *   - market (SPX, IXIC, DJI, VIX)
 *   - crypto (BTC, ETH, SOL)
 *   - macro  (US10Y, DXY, GOLD)
 *   - Capavate Pulse: "New on Capavate: X applications today · Y rounds opened
 *     · Z connections made" (ALWAYS real DB-backed numbers).
 *
 * HARD RULE: this component NEVER fabricates a market price. When the server
 * returns `status: "PROVIDER_NOT_CONFIGURED"`, the market/crypto/macro tiles
 * render an em-dash ("—") placeholder and a single "Configure a market data
 * provider" hint links to /admin/integrations. The Capavate Pulse tile still
 * renders its real DB numbers.
 *
 * Brand: capavate.com red (#cc0001) accents on a navy (#041e41) strip.
 */
import { useEffect, useState } from "react";
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

function QuoteTile({ q }: { q: Quote }) {
  const up = (q.changePct ?? 0) >= 0;
  const pct = fmtPct(q.changePct);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 whitespace-nowrap"
      data-testid={`ticker-tile-${q.symbol}`}
    >
      <span className="font-semibold text-white/90">{q.symbol}</span>
      <span className="font-mono tabular-nums text-white/80">{fmtNum(q.last)}</span>
      {pct && (
        <span className={up ? "text-[#6fcf97]" : "text-[#ff6b6b]"}>{pct}</span>
      )}
    </span>
  );
}

export function MarketTicker() {
  const [data, setData] = useState<TickerPayload | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await apiRequest("GET", "/api/feeds/ticker");
        const json = (await res.json()) as TickerPayload;
        if (mounted) setData(json);
      } catch {
        /* leave previous data; ticker is non-critical chrome */
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
  const pulse = data?.capavate;

  return (
    <div
      className="h-8 flex items-center overflow-x-auto bg-[#041e41] text-white text-[11px] border-b border-[#0c2d55]"
      data-testid="market-ticker"
      aria-label="Market and Capavate activity ticker"
    >
      <div className="flex items-center divide-x divide-white/10 min-w-max">
        {/* Capavate Pulse — ALWAYS real DB numbers. */}
        <span
          className="inline-flex items-center gap-1.5 px-3 whitespace-nowrap"
          data-testid="ticker-capavate-pulse"
        >
          <span className="inline-flex items-center gap-1 font-semibold text-[#cc0001] bg-white rounded-full px-2 py-0.5 text-[10px]">
            ● Capavate
          </span>
          <span className="text-white/85">
            {pulse ? pulse.applicationsToday : "—"} applications today
            {" · "}
            {pulse ? pulse.roundsOpenedToday : "—"} rounds opened
            {" · "}
            {pulse ? pulse.connectionsToday : "—"} connections made
          </span>
        </span>

        {providerOff ? (
          <span
            className="inline-flex items-center gap-2 px-3 whitespace-nowrap text-white/60"
            data-testid="ticker-provider-unavailable"
          >
            <span className="font-mono">— — —</span>
            <a
              href="/admin/integrations"
              className="underline text-[#6fcf97] hover:text-white"
              data-testid="ticker-configure-link"
            >
              Configure a market data provider to enable live feeds
            </a>
          </span>
        ) : (
          <>
            {data!.market.map((q) => (
              <QuoteTile key={`m-${q.symbol}`} q={q} />
            ))}
            {data!.crypto.map((q) => (
              <QuoteTile key={`c-${q.symbol}`} q={q} />
            ))}
            {data!.macro.map((q) => (
              <QuoteTile key={`x-${q.symbol}`} q={q} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default MarketTicker;
