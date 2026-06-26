/**
 * v25.44 Surface 13 — M&A Intelligence dashboard card.
 * Reads GET /api/collective/ma-intel?view=dashboard_card. Total opted-in count
 * + active negotiations + top-3 mini-list. Link to /ma-intel.
 * Privacy-gated server-side (default opt-OUT of Collective-wide aggregation).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake } from "lucide-react";

interface DashboardCard {
  asOfDate: string;
  totalCompaniesInScope: number;
  activeNegotiations: number;
  topThree: Array<{
    companyId: string;
    companyName: string;
    sector: string;
    maScore: number;
    leadBuyer: string | null;
  }>;
  status: "OK" | "INSUFFICIENT_DATA";
}

function scoreBadgeColor(score: number): string {
  if (score > 70) return "bg-[#cc0001] text-white";
  if (score >= 40) return "bg-amber-500 text-white";
  return "bg-slate-300 text-slate-700";
}

export function MaIntelCard() {
  const q = useQuery<DashboardCard>({
    queryKey: ["/api/collective/ma-intel", "dashboard_card"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/collective/ma-intel?view=dashboard_card")).json(),
    staleTime: 30_000,
  });

  const data = q.data;
  const empty = !!data && data.totalCompaniesInScope === 0;

  return (
    <Card data-testid="widget-ma-intel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Handshake className="h-4 w-4 text-[#cc0001]" />
          M&amp;A Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" data-testid="widget-ma-intel-loading" />
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-ma-intel-error">
            Couldn't load M&amp;A intelligence.
          </div>
        ) : empty ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-ma-intel-empty">
            <p className="text-sm">No companies have opted into M&amp;A intelligence sharing yet.</p>
          </div>
        ) : (
          <div data-testid="widget-ma-intel-content">
            <div className="flex items-center gap-6 mb-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums" style={{ color: "#041e41" }}>
                  {data?.totalCompaniesInScope ?? 0}
                </div>
                <div className="text-[10px] text-slate-500">In scope</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums text-[#cc0001]">
                  {data?.activeNegotiations ?? 0}
                </div>
                <div className="text-[10px] text-slate-500">Active negotiations</div>
              </div>
            </div>
            <div className="space-y-1">
              {(data?.topThree ?? []).map((t) => (
                <div
                  key={t.companyId}
                  className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-50"
                  data-testid={`widget-ma-intel-top-${t.companyId}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 truncate">{t.companyName}</p>
                    <p className="text-[10px] text-slate-400 truncate">{t.leadBuyer ?? "—"}</p>
                  </div>
                  <Badge className={`text-[10px] px-1.5 py-0.5 ${scoreBadgeColor(t.maScore)}`}>{t.maScore}</Badge>
                </div>
              ))}
            </div>
            <Link href="/ma-intel">
              <a className="block text-xs text-[#cc0001] hover:underline pt-2" data-testid="widget-ma-intel-viewall">
                View full M&amp;A Intelligence
              </a>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MaIntelCard;
