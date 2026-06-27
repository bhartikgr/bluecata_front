/**
 * Wave C-3 — Collective Soft Circles
 * Aggregate view per round — no per-investor amounts (founder privacy).
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Circle } from "lucide-react";

interface SoftCircleAggregate {
  roundId: string;
  roundName: string;
  companyId: string | null;
  companyName: string;
  targetUsd: number;
  softCircledTotal: number;
  softCircledCount: number;
  fillPct: number | null;
  note: string;
}

function fmtUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toLocaleString()}`;
}

export default function CollectiveSoftCircles() {
  const { data, isLoading, error } = useQuery<{ aggregates: SoftCircleAggregate[]; total: number }>({
    queryKey: ["/api/collective/soft-circles"],
    queryFn: () => apiRequest("GET", "/api/collective/soft-circles").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-soft-circles"
          >
            <Circle className="h-5 w-5 text-[#cc0001]" />
            Soft Circles
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Aggregate soft-circle commitments per round. Per-investor amounts are not disclosed.
          </p>
        </div>
        {data && (
          <Badge className="bg-[#cc0001]/10 text-[#cc0001] border-0" data-testid="badge-total-rounds">
            {data.total} round{data.total !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700" data-testid="notice-privacy">
        Founder privacy: amounts are shown as round aggregates only. Individual investor amounts are not visible on the Collective side.
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-soft-circles">
          Failed to load soft-circle data. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : !data?.aggregates?.length ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500" data-testid="empty-soft-circles">
            <Circle className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">No soft circles yet</p>
            <p className="text-xs mt-1">
              Soft-circle commitments will appear here once investors engage with open rounds.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.aggregates.map((agg) => (
            <Card key={agg.roundId} data-testid={`card-softcircle-${agg.roundId}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                  {agg.roundName}
                </CardTitle>
                <p className="text-xs text-slate-500">{agg.companyName}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Soft-circled</span>
                  <span className="font-semibold" style={{ color: "#cc0001" }} data-testid={`total-${agg.roundId}`}>
                    {fmtUsd(agg.softCircledTotal)}
                  </span>
                </div>
                {agg.targetUsd > 0 && (
                  <>
                    <Progress
                      value={agg.fillPct ?? 0}
                      className="h-2"
                      data-testid={`progress-${agg.roundId}`}
                    />
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Target: {fmtUsd(agg.targetUsd)}</span>
                      <span className="font-medium text-slate-700" data-testid={`fill-pct-${agg.roundId}`}>
                        {agg.fillPct !== null ? `${agg.fillPct}%` : "—"}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <Badge className="bg-slate-100 text-slate-600 text-[10px]" data-testid={`count-${agg.roundId}`}>
                    {agg.softCircledCount} commitment{agg.softCircledCount !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
