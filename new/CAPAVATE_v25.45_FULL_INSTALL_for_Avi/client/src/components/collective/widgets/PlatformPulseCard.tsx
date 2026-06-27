/**
 * v25.44 Surface 2 — Platform Pulse widget.
 * Reads GET /api/collective/platform-pulse (audit_log derived). 6-tile compact
 * strip, auto-refresh every 60s, "as of HH:MM" tooltip per tile. Fail-closed:
 * renders "—" tiles when status=AUDIT_LOG_UNAVAILABLE (NO fake numbers).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Radio } from "lucide-react";

interface PulseResponse {
  status: "OK" | "AUDIT_LOG_UNAVAILABLE";
  counts: {
    membersOnline: number;
    dealUpdatesToday: number;
    softCirclesToday: number;
    screeningsThisWeek: number;
    activeDeals: number;
    openDeals: number;
  } | null;
  asOf: string;
}

export function PlatformPulseCard() {
  const q = useQuery<PulseResponse>({
    queryKey: ["/api/collective/platform-pulse"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/platform-pulse")).json(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data = q.data;
  const unavailable = data?.status === "AUDIT_LOG_UNAVAILABLE" || !data?.counts;
  const asOfTime = data?.asOf ? new Date(data.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  const tiles = [
    { key: "membersOnline", label: "Members online", value: data?.counts?.membersOnline },
    { key: "dealUpdatesToday", label: "Deal updates today", value: data?.counts?.dealUpdatesToday },
    { key: "softCirclesToday", label: "Soft-circles today", value: data?.counts?.softCirclesToday },
    { key: "screeningsThisWeek", label: "Screenings this week", value: data?.counts?.screeningsThisWeek },
    { key: "activeDeals", label: "Active deals", value: data?.counts?.activeDeals },
    { key: "openDeals", label: "Open deals", value: data?.counts?.openDeals },
  ];

  return (
    <Card data-testid="widget-platform-pulse">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Radio className="h-4 w-4 text-[#cc0001]" />
          Platform Pulse
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="grid grid-cols-3 gap-3" data-testid="widget-pulse-loading">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-pulse-error">
            Couldn't load platform pulse.
          </div>
        ) : (
          <TooltipProvider>
            <div className="grid grid-cols-3 gap-3" data-testid="widget-pulse-tiles">
              {tiles.map((t) => (
                <Tooltip key={t.key}>
                  <TooltipTrigger asChild>
                    <div
                      className="rounded-md bg-slate-50 px-2 py-2 text-center cursor-default"
                      data-testid={`widget-pulse-tile-${t.key}`}
                    >
                      <div className="text-lg font-semibold tabular-nums" style={{ color: "#041e41" }}>
                        {unavailable || t.value == null ? "—" : t.value.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{t.label}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    {unavailable ? "Audit log unavailable" : `as of ${asOfTime}`}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

export default PlatformPulseCard;
