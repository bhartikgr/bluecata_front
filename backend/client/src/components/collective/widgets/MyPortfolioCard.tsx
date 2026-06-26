/**
 * v25.44 Surface 3 — My Capavate Portfolio widget.
 * Reads GET /api/collective/me/portfolio. Top 5 positions, "Presenting next"
 * red badge, "View all (N)" link to /collective/me/portfolio. Empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase } from "lucide-react";

interface Position {
  companyId: string;
  companyName: string;
  sector: string | null;
  region: string | null;
  role: string;
  round: string;
  positionValueUsd: number | null;
  presentingNext: boolean;
}
interface PortfolioResponse {
  positions: Position[];
  totalValueUsd: number | null;
  count: number;
}

export function MyPortfolioCard() {
  const q = useQuery<PortfolioResponse>({
    queryKey: ["/api/collective/me/portfolio"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/portfolio")).json(),
    staleTime: 30_000,
  });

  const data = q.data;
  const top5 = (data?.positions ?? [])
    .slice()
    .sort((a, b) => (b.positionValueUsd ?? 0) - (a.positionValueUsd ?? 0))
    .slice(0, 5);

  return (
    <Card data-testid="widget-my-portfolio">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Briefcase className="h-4 w-4 text-[#cc0001]" />
          My Capavate Portfolio
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2" data-testid="widget-portfolio-loading">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="widget-portfolio-error">
            Couldn't load your portfolio.
          </div>
        ) : (data?.count ?? 0) === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-portfolio-empty">
            <p className="text-sm">You're not on any cap tables yet.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="widget-portfolio-list">
            {top5.map((p) => (
              <div
                key={p.companyId}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50"
                data-testid={`widget-portfolio-row-${p.companyId}`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{p.companyName}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {p.sector ?? "—"} · {p.round}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.presentingNext && (
                    <Badge className="bg-[#cc0001] text-white text-[10px] px-1.5 py-0.5">Presenting next</Badge>
                  )}
                  <span className="text-xs text-slate-500 tabular-nums">
                    {p.positionValueUsd != null ? `$${p.positionValueUsd.toLocaleString()}` : "—"}
                  </span>
                </div>
              </div>
            ))}
            <Link href="/collective/me/portfolio">
              <a className="block text-xs text-[#cc0001] hover:underline pt-1" data-testid="widget-portfolio-viewall">
                View all ({data?.count ?? 0})
              </a>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MyPortfolioCard;
