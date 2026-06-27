/**
 * v25.44 Surface 1 — Engagement Score widget.
 * Reads GET /api/collective/me/engagement. Big score (Instrument Serif),
 * color-graded (<40 muted, 40-70 amber, 70+ red #cc0001), 4 breakdown rows,
 * formula tooltip, empty state. DB-driven; renders "—" while loading.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, Info } from "lucide-react";

interface EngagementResponse {
  score: number;
  components: {
    softCircles: { count: number; weight: number };
    screeningsVoted: { count: number; weight: number };
    inquiriesSent: { count: number; weight: number };
    dealsListed: { count: number; weight: number };
  };
  asOf: string;
}

function scoreColor(score: number): string {
  if (score >= 70) return "#cc0001";
  if (score >= 40) return "#b45309";
  return "#94a3b8";
}

export function EngagementScoreCard() {
  const q = useQuery<EngagementResponse>({
    queryKey: ["/api/collective/me/engagement"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/engagement")).json(),
    staleTime: 30_000,
  });

  const data = q.data;
  const score = data?.score ?? 0;
  const isEmpty = !!data && score === 0;

  const rows = data
    ? [
        { label: "Soft circles", count: data.components.softCircles.count, weight: data.components.softCircles.weight },
        { label: "Screenings voted", count: data.components.screeningsVoted.count, weight: data.components.screeningsVoted.weight },
        { label: "Inquiries sent", count: data.components.inquiriesSent.count, weight: data.components.inquiriesSent.weight },
        { label: "Deals listed", count: data.components.dealsListed.count, weight: data.components.dealsListed.weight },
      ]
    : [];

  return (
    <Card data-testid="widget-engagement-score">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Activity className="h-4 w-4 text-[#cc0001]" />
          Engagement Score
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Score = min(100, soft circles ×25 + screenings voted ×15 + inquiries sent ×10 + deals listed ×5).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" data-testid="widget-engagement-loading" />
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-engagement-error">
            Couldn't load your engagement score.
          </div>
        ) : isEmpty ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-engagement-empty">
            <p className="text-sm">Start engaging with the Collective to build your score.</p>
          </div>
        ) : (
          <div className="flex items-center gap-6" data-testid="widget-engagement-content">
            <div
              className="text-5xl leading-none"
              style={{ fontFamily: "'Instrument Serif', serif", color: scoreColor(score) }}
              data-testid="widget-engagement-number"
              aria-label={`Engagement score ${score} out of 100`}
            >
              {score}
            </div>
            <div className="flex-1 space-y-1">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{r.label}</span>
                  <span className="text-slate-500 tabular-nums">
                    {r.count} × {r.weight}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default EngagementScoreCard;
