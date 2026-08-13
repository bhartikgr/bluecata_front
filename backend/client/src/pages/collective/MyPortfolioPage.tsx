/**
 * v25.44 Surface 3 — /collective/me/portfolio full page.
 * Reads GET /api/collective/me/portfolio. Full list of positions.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase } from "lucide-react";
/* WAVE 8 / ORP-051 — the investor-context LP roster caller. */
import { InvestorSpvLpRosterPanel } from "@/components/partner/SpvOperationsPanels";

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

export default function MyPortfolioPage() {
  const q = useQuery<PortfolioResponse>({
    queryKey: ["/api/collective/me/portfolio", "page"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/me/portfolio")).json(),
    staleTime: 30_000,
  });
  const data = q.data;

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="page-my-portfolio">
      <div className="flex items-center gap-2 mb-6">
        <Briefcase className="h-6 w-6 text-[#cc0001]" />
        <h1 className="text-2xl font-semibold" style={{ color: "#041e41" }}>My Capavate Portfolio</h1>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-500">
            {data ? `${data.count} position${data.count === 1 ? "" : "s"}` : ""}
            {data?.totalValueUsd != null ? ` · $${data.totalValueUsd.toLocaleString()} total` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : q.error ? (
            <div className="text-sm text-red-700">Couldn't load your portfolio.</div>
          ) : (data?.count ?? 0) === 0 ? (
            <div className="text-center py-10 text-slate-500" data-testid="page-portfolio-empty">
              <p className="text-sm">You're not on any cap tables yet.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="page-portfolio-list">
              {data!.positions.map((p) => (
                <div key={p.companyId} className="flex items-center justify-between py-3 px-3 rounded-md bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{p.companyName}</p>
                    <p className="text-xs text-slate-400">{p.sector ?? "—"} · {p.region ?? "—"} · {p.round}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.presentingNext && <Badge className="bg-[#cc0001] text-white text-[10px]">Presenting next</Badge>}
                    <span className="text-sm text-slate-600 tabular-nums">
                      {p.positionValueUsd != null ? `$${p.positionValueUsd.toLocaleString()}` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── WAVE 8 / ORP-051 — investor-context SPV positions + co-investor roster ──
          GET /api/spv/:spvId/lp-roster (server/spvEngineRoutes.ts:648) existed,
          was session-gated on subscriber membership, and had NO client caller —
          so an LP had no way at all to see who else was in their own vehicle.
          It is NOT a duplicate of the GP roster route: that one is
          requirePartnerAuth and returns every LP, while this one is fail-closed
          on the viewer's own subscription and omits co-investors server-side
          unless the GP set lp_visibility='co_investors'. WIRED, not retired.
          The SPV list comes from /api/capavate/spvs (the investor visibility
          context, which already excludes collective_only vehicles); the roster
          itself remains the server's decision, never this page's filter. */}
      <SpvPositionsSection />
    </div>
  );
}

function SpvPositionsSection() {
  const [openSpvId, setOpenSpvId] = useState<string | null>(null);
  const q = useQuery<{ spvs: Array<{ id: string; name: string; currency: string; status?: string }> }>({
    queryKey: ["/api/capavate/spvs", "portfolio"],
    queryFn: async () => (await apiRequest("GET", "/api/capavate/spvs")).json(),
    staleTime: 30_000,
  });
  const spvs = q.data?.spvs ?? [];

  return (
    <Card className="mt-6" data-testid="portfolio-spv-positions">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-500">SPVs &amp; syndicates</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : q.error ? (
          <div className="text-sm text-red-700" data-testid="portfolio-spv-error">Couldn't load SPVs.</div>
        ) : spvs.length === 0 ? (
          <div className="text-sm text-slate-500" data-testid="portfolio-spv-empty">No SPVs are visible to you yet.</div>
        ) : (
          <div className="space-y-2" data-testid="portfolio-spv-list">
            {spvs.map((s) => (
              <div key={s.id} className="rounded-md bg-slate-50 px-3 py-2" data-testid={`portfolio-spv-${s.id}`}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => setOpenSpvId((cur) => (cur === s.id ? null : s.id))}
                  data-testid={`portfolio-spv-toggle-${s.id}`}
                >
                  <span className="text-sm font-medium text-slate-700">{s.name}</span>
                  <span className="text-xs text-slate-400">{openSpvId === s.id ? "Hide co-investors" : "Show co-investors"}</span>
                </button>
                {openSpvId === s.id ? (
                  <InvestorSpvLpRosterPanel spvId={s.id} currency={s.currency ?? "USD"} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
