/**
 * Sprint 18 Phase 2 — T3.4 M&A Readiness Score card.
 *
 * Reads the M&A intelligence ranking for the company. Renders:
 *   - Current score / 100
 *   - 30-day trend sparkline (synthesized from ranking history when available)
 *   - Top 3 dimensions improving/declining
 *   - CTA to CompanyProfile Step 4
 *   - Fallback "Get a DSC review by applying to Collective" if no score
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Sparkline } from "@/components/Sparkline";
import { apiRequest } from "@/lib/queryClient";

type Ranking = {
  companyId: string;
  score: number;
  history?: Array<{ ts: string; score: number }>;
  dimensions?: Array<{ name: string; score: number; deltaPct: number }>;
};

export function MnaReadinessCard({ companyId }: { companyId: string }) {
  const ranking = useQuery<Ranking | null>({
    queryKey: ["/api/companies", companyId, "ma-readiness"],
    queryFn: async () => {
      /* v25.32 burndown — item 15: apiRequest throws ApiError on non-2xx, so the
         prior `if (res.status === 404) return null` was dead. Behavior was
         already correct via the outer catch (any error → null); the dead line is
         removed for clarity. Source:
         v25_32_apiRequest_dead_code_sites_gpt55.txt (MnaReadinessCard.tsx:32). */
      try {
        const res = await apiRequest("GET", `/api/companies/${companyId}/ma-readiness`);
        return res.json();
      } catch {
        return null;
      }
    },
    enabled: !!companyId,
    retry: false,
  });

  const hasScore = !!ranking.data && ranking.data.score >= 0;

  if (!hasScore) {
    return (
      <Card className="border-amber-200/70 bg-amber-50/40" data-testid="card-mna-readiness-empty">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="h-10 w-10 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">M&amp;A Readiness — not yet reviewed</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Get a DSC review by applying to Collective. The Deal Sourcing Committee will score your company across the 30-field intelligence model.
            </div>
          </div>
          <Link href="/founder/apply-to-collective">
            <Button size="sm" data-testid="button-mna-apply">
              Apply for DSC review
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const r = ranking.data!;
  const sparkData = (r.history || []).slice(-30).map(h => h.score);
  const dims = r.dimensions || [];
  const improving = dims.filter(d => d.deltaPct > 0).sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 3);
  const declining = dims.filter(d => d.deltaPct < 0).sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 3);

  return (
    <Card data-testid="card-mna-readiness">
      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">M&amp;A Readiness</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">30-day trend across all 5 dimensions</p>
        </div>
        <Link href="/founder/company?step=ma">
          <Button size="sm" variant="ghost" data-testid="button-mna-detail">
            View detail
            <ArrowUpRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-3xl font-semibold tabular-nums" data-testid="text-mna-score">{r.score}<span className="text-sm text-muted-foreground font-normal"> / 100</span></div>
          </div>
          {sparkData.length > 1 && (
            <div className="flex-1 min-w-[120px] max-w-[280px]">
              <Sparkline data={sparkData} />
            </div>
          )}
        </div>

        {(improving.length > 0 || declining.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {improving.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Improving
                </div>
                <ul className="text-xs space-y-1">
                  {improving.map(d => (
                    <li key={d.name} className="flex items-center justify-between">
                      <span>{d.name}</span>
                      <Badge variant="outline" className="text-[10px] border-emerald-300/60 text-emerald-700">+{d.deltaPct.toFixed(1)}%</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {declining.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-rose-700 mb-1.5 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Declining
                </div>
                <ul className="text-xs space-y-1">
                  {declining.map(d => (
                    <li key={d.name} className="flex items-center justify-between">
                      <span>{d.name}</span>
                      <Badge variant="outline" className="text-[10px] border-rose-300/60 text-rose-700">{d.deltaPct.toFixed(1)}%</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
