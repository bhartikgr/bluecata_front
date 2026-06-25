/**
 * Sprint 14 D4 — DSC (Decision Score Card) feedback summary.
 *
 * Shows the latest DSC review packet: top 3 / bottom 3 dimensions plus aggregate.
 * Backed by `/api/founder/ma/dsc-feedback?companyId=...`.
 *
 * Per harvest §3 Conflict 3 — non-DSC member sees only `auto_tier`, never raw scores.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, ScrollText, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";

export interface DscSummaryCardProps {
  companyId: string;
  /** When false, only `auto_tier` is shown; raw dimensions are hidden. */
  isDscMember: boolean;
}

interface DscDimension {
  key: string;
  label: string;
  score: number;
}

interface DscFeedback {
  id: string;
  companyId: string;
  receivedAt: string;
  aggregate: number;
  autoTier: "watch" | "qualified" | "featured" | "priority";
  topThree: DscDimension[];
  bottomThree: DscDimension[];
}

export function DscSummaryCard({ companyId, isDscMember }: DscSummaryCardProps) {
  const dscQ = useQuery<{ feedback: DscFeedback | null }>({
    queryKey: ["/api/founder/ma/dsc-feedback", companyId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/founder/ma/dsc-feedback?companyId=${companyId}`)).json(),
    enabled: !!companyId,
  });

  if (dscQ.isLoading) {
    return (
      <Card data-testid="card-dsc-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> DSC review feedback
          </CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }

  const fb = dscQ.data?.feedback ?? null;

  return (
    <Card data-testid="card-dsc-summary">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-[hsl(0_100%_40%)]" /> DSC review feedback
          {!isDscMember && (
            <Badge variant="outline" className="text-[10px] flex items-center gap-1">
              <Lock className="h-3 w-3" /> Tier only
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Aggregated review-card scoring across the Collective decision panel.
        </p>
      </CardHeader>
      <CardContent>
        {!fb ? (
          <EmptyState
            density="compact"
            icon={<ScrollText className="h-8 w-8" />}
            title="No DSC packet yet"
            description="When the decision panel completes a review, the consolidated feedback packet will appear here."
          />
        ) : !isDscMember ? (
          // Non-member view: tier-only per harvest §3 Conflict 3
          <div className="rounded-md border border-border bg-muted/30 p-4 flex items-center justify-between" data-testid="dsc-tier-only">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Auto-tier</div>
              <div className="text-lg font-semibold mt-0.5 capitalize">{fb.autoTier}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Updated {new Date(fb.receivedAt).toLocaleDateString()}
            </div>
          </div>
        ) : (
          // Full member view
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Aggregate</div>
                <div className="text-2xl font-semibold">{fb.aggregate.toFixed(1)}</div>
              </div>
              <Badge className="bg-[hsl(0_100%_40%)] text-white capitalize">{fb.autoTier}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div data-testid="dsc-top-three">
                <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1 mb-1.5">
                  <ChevronUp className="h-3 w-3" /> Top 3
                </div>
                <ul className="space-y-1">
                  {fb.topThree.map((d) => (
                    <li key={d.key} className="text-xs flex justify-between border-b border-dashed border-border pb-1" data-testid={`dsc-top-${d.key}`}>
                      <span>{d.label}</span>
                      <span className="font-mono font-medium">{d.score.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div data-testid="dsc-bottom-three">
                <div className="text-xs font-semibold text-rose-700 flex items-center gap-1 mb-1.5">
                  <ChevronDown className="h-3 w-3" /> Bottom 3
                </div>
                <ul className="space-y-1">
                  {fb.bottomThree.map((d) => (
                    <li key={d.key} className="text-xs flex justify-between border-b border-dashed border-border pb-1" data-testid={`dsc-bottom-${d.key}`}>
                      <span>{d.label}</span>
                      <span className="font-mono font-medium">{d.score.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Received {new Date(fb.receivedAt).toLocaleString()}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
