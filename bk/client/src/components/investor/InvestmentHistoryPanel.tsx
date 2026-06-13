/**
 * Sprint 21 Wave B — B3: InvestmentHistoryPanel
 *
 * Displays a read-only vertical timeline of this investor's previous engagement
 * with a specific company across all prior rounds.
 *
 * Fetches GET /api/investor/companies/:companyId/my-history
 * Display-only — not interactive.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtUSD } from "@/lib/format";
import { History, TrendingUp, TrendingDown, RefreshCw, Mail, CheckCircle2, XCircle, LogOut } from "lucide-react";

interface HistoryEvent {
  id: string;
  date: string;
  roundName: string;
  action: string;
  amount?: number;
  currency?: string;
  capTablePosition?: string;
}

interface HistoryResponse {
  companyId: string;
  investorId: string;
  events: HistoryEvent[];
}

const ACTION_LABELS: Record<string, string> = {
  invitation_received: "Invitation received",
  soft_circle: "Soft-circled",
  declined: "Declined",
  signed: "Signed",
  funded: "Funded / wired",
  transferred_out: "Transferred out",
  revoked: "Revoked",
  expired: "Expired",
};

function getActionIcon(action: string) {
  switch (action) {
    case "invitation_received": return <Mail className="h-3.5 w-3.5 text-[hsl(184_98%_22%)]" />;
    case "soft_circle": return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
    case "declined": return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
    case "signed": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case "funded": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />;
    case "transferred_out": return <LogOut className="h-3.5 w-3.5 text-amber-600" />;
    case "revoked": return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
    default: return <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

interface Props {
  companyId: string;
  companyName: string;
}

export default function InvestmentHistoryPanel({ companyId, companyName }: Props) {
  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/investor/company-history", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/investor/company-history/${companyId}`);
      if (!res.ok) return { companyId, investorId: "", events: [] };
      return res.json();
    },
    enabled: !!companyId,
  });

  return (
    <Card data-testid="investment-history-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-[hsl(184_98%_22%)]" />
          Previous engagement history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        )}

        {!isLoading && (!data?.events || data.events.length === 0) && (
          <p className="text-sm text-muted-foreground" data-testid="history-empty-state">
            This is your first round invitation from{" "}
            <span className="font-medium text-foreground">{companyName}</span>.
          </p>
        )}

        {!isLoading && data?.events && data.events.length > 0 && (
          <ol className="relative border-l border-border ml-2 space-y-4" data-testid="history-timeline">
            {data.events.map((evt) => (
              <li key={evt.id} className="ml-4" data-testid={`history-event-${evt.id}`}>
                {/* Timeline dot */}
                <div className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(184_98%_22%)]" />
                <div className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                    {getActionIcon(evt.action)}
                    <span>{fmtDate(evt.date)}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">{evt.roundName}</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span className="font-medium">
                      {ACTION_LABELS[evt.action] ?? evt.action}
                    </span>
                    {evt.amount != null && (
                      <span className="ml-1.5 text-[hsl(184_98%_22%)] font-mono text-xs">
                        {fmtUSD(evt.amount, { compact: true })}
                      </span>
                    )}
                  </div>
                </div>
                {evt.capTablePosition && (
                  <div className="mt-0.5 ml-6 text-xs text-muted-foreground">
                    Cap-table: {evt.capTablePosition}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
