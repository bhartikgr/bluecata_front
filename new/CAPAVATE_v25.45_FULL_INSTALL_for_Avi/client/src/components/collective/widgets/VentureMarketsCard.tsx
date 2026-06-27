/**
 * v25.44 Surface 14 — Global Venture & Early-Stage Markets widget.
 * Reads GET /api/feeds/venture-markets. Two columns ONLY: Exchange Symbol +
 * Market Value. Sort DESC by marketValue. `Est.` badge for estimated rows.
 * Pending boards render "—" (NO fabricated numbers). Dark-mode + a11y aware.
 * Institutional, data-first styling (per the developer prompt).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Globe, Info } from "lucide-react";

interface VentureRecord {
  exchangeSymbol: string;
  exchangeName: string;
  displayFlag: string;
  region: string;
  marketValue: number | null;
  marketValueType: string;
  asOfDate: string;
  source: string;
  sourceUrl?: string;
  estimated?: boolean;
  confidence: string;
}
interface VentureResponse {
  asOfDate: string;
  records: VentureRecord[];
  metricType: string;
  status: "OK" | "PROVIDER_NOT_CONFIGURED";
}

const METRIC_TOOLTIP = "Issuer count = number of listed companies on the venture/growth market.";

export function VentureMarketsCard() {
  const q = useQuery<VentureResponse>({
    queryKey: ["/api/feeds/venture-markets"],
    queryFn: async () => (await apiRequest("GET", "/api/feeds/venture-markets")).json(),
    staleTime: 5 * 60_000,
  });

  const data = q.data;
  const notConfigured = data?.status === "PROVIDER_NOT_CONFIGURED";
  const records = data?.records ?? [];

  return (
    <Card data-testid="widget-venture-markets">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Globe className="h-4 w-4 text-[#cc0001]" />
          Global Venture &amp; Early-Stage Markets
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2" data-testid="widget-venture-loading">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-venture-error">
            Couldn't load venture markets.
          </div>
        ) : notConfigured || records.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-venture-empty">
            <p className="text-sm">Configure a market data provider to populate venture markets.</p>
          </div>
        ) : (
          <TooltipProvider>
            <table className="w-full text-left" data-testid="widget-venture-table">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
                  <th className="py-1.5 font-medium">Exchange Symbol</th>
                  <th className="py-1.5 font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      Market Value
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-xs">{METRIC_TOOLTIP}</TooltipContent>
                      </Tooltip>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.exchangeSymbol}
                    className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    data-testid={`widget-venture-row-${r.exchangeSymbol}`}
                  >
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base" role="img" aria-label={`${r.region} flag`}>
                          {r.displayFlag}
                        </span>
                        <div className="leading-tight">
                          <div className="font-semibold text-sm" style={{ color: "#041e41" }}>
                            {r.exchangeSymbol}
                            {r.estimated && (
                              <Badge className="ml-1.5 bg-slate-200 text-slate-600 text-[9px] px-1 py-0">Est.</Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">{r.exchangeName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 text-right align-top">
                      {r.marketValue == null ? (
                        <span className="text-slate-400" aria-label="No value available">—</span>
                      ) : (
                        <div className="leading-tight">
                          <div
                            className="font-semibold tabular-nums text-sm"
                            style={{ color: "#041e41" }}
                            aria-label={`${r.marketValue.toLocaleString()} issuers`}
                          >
                            {r.marketValue.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-slate-400">issuers</div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-400 mt-2" data-testid="widget-venture-provenance">
              Metric: issuer count · Source: OECD / official exchanges
              {data?.asOfDate ? ` · as of ${data.asOfDate}` : ""}
            </p>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

export default VentureMarketsCard;
