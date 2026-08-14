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
import { collectiveWidgetErrorText } from "@/lib/collectiveGateError";

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
            {collectiveWidgetErrorText(q.error, 'Couldn\'t load M&A intelligence.')}
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
            {/* WAVE 41 · REACHABILITY RULE R3 — REAL DEFECT, REPAIRED (not allowlisted).
                R3 flagged an interactive <a> nested inside <Link>. It was right, and
                this is not a stylistic quibble. wouter is pinned at 3.9.0, whose
                Link (node_modules/wouter/src/index.js:308-318) clones its child
                ONLY when `asChild` is passed; otherwise it renders its OWN <a> and
                places `children` inside it. Without `asChild` this emitted
                  <a href="/ma-intel"><a class="…" data-testid="…">…</a></a>
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
              <Link asChild href="/ma-intel">
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
