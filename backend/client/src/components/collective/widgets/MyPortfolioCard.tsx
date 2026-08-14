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
import { collectiveWidgetErrorText } from "@/lib/collectiveGateError";

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
            {collectiveWidgetErrorText(q.error, 'Couldn\'t load your portfolio.')}
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
            {/* WAVE 41 · REACHABILITY RULE R3 — REAL DEFECT, REPAIRED (not allowlisted).
                R3 flagged an interactive <a> nested inside <Link>. It was right, and
                this is not a stylistic quibble. wouter is pinned at 3.9.0, whose
                Link (node_modules/wouter/src/index.js:308-318) clones its child
                ONLY when `asChild` is passed; otherwise it renders its OWN <a> and
                places `children` inside it. Without `asChild` this emitted
                  <a href="/collective/me/portfolio"><a class="…" data-testid="…">…</a></a>
                — nested anchors, which is invalid HTML, and the INNER anchor (the
                one carrying the class and the testid, i.e. the one the user sees
                and clicks) had NO href. So keyboard focus, middle-click,
                open-in-new-tab, "copy link address" and the status-bar preview all
                behaved wrongly on the visible element, while a plain left-click
                still worked because it bubbled to the outer anchor's onClick.
                That is why no test caught it: the testid is on the inner anchor and
                clicking it navigates. `asChild` makes wouter clone this anchor and
                give it the href, producing ONE correct <a>. No element, class,
                testid or copy string is added or removed. */}
              <Link asChild href="/collective/me/portfolio">
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
