/**
 * Foundation Build — Partner Dashboard.
 *
 * Tier-aware landing page summarizing portfolio + pipeline + recent activity.
 * No mock data on any code path. Empty state for new partners.
 */
import { useQuery } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, tierAtLeast } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardSnapshot {
  portfolio: { attributedCompanies: number; totalSpvCommittedMinor: number; totalFundCommittedMinor: number };
  pipeline: { byStage: Record<string, number>; topDeals: Array<{ id: string; dealName: string; estCheckSizeMinor: number | null; currency: string | null }> };
  recentActivity: Array<{ id: string; activityType: string; body: string; occurredAt: string }>;
  team: { activeSeats: number; pendingInvitations: number; seatLimit: number };
  empty: boolean;
}

export default function PartnerDashboard() {
  const role = useRequirePartnerRole();
  const q = useQuery<DashboardSnapshot>({
    queryKey: ["/api/partner/me/dashboard"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/dashboard")).json(),
  });

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  return (
    <PartnerShell title="Dashboard" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {!data && <div className="text-slate-500" data-testid="dashboard-loading">Loading…</div>}
      {data && data.empty && (
        <PartnerEmptyState
          title="Your portfolio is just getting started"
          description="Add your first attributed company to begin. Capavate admin can attribute companies to your partner record, or sign companies up with your referral code."
        />
      )}
      {data && !data.empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-portfolio">
            <CardHeader><CardTitle className="text-sm">Portfolio</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="kpi-companies">{data.portfolio.attributedCompanies}</div>
              <div className="text-xs text-slate-500">attributed companies</div>
              <div className="text-xs mt-3 text-slate-700" data-testid="kpi-spv">
                SPVs committed: {(data.portfolio.totalSpvCommittedMinor / 100).toLocaleString()}
              </div>
              <div className="text-xs text-slate-700" data-testid="kpi-fund">
                Funds committed: {(data.portfolio.totalFundCommittedMinor / 100).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-pipeline">
            <CardHeader><CardTitle className="text-sm">Pipeline</CardTitle></CardHeader>
            <CardContent>
              <ul className="text-xs space-y-1">
                {Object.entries(data.pipeline.byStage).map(([s, n]) => (
                  <li key={s} className="flex justify-between"><span className="text-slate-500">{s}</span><span className="font-medium">{n}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card data-testid="card-team">
            <CardHeader><CardTitle className="text-sm">Team</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="kpi-seats">{data.team.activeSeats} / {data.team.seatLimit === 9999 ? "∞" : data.team.seatLimit}</div>
              <div className="text-xs text-slate-500">active seats</div>
              <div className="text-xs mt-2" data-testid="kpi-pending-invites">{data.team.pendingInvitations} pending invitations</div>
            </CardContent>
          </Card>
          <Card className="md:col-span-3" data-testid="card-recent">
            <CardHeader><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
            <CardContent>
              {data.recentActivity.length === 0 && <div className="text-xs text-slate-500">No activity yet.</div>}
              <ul className="text-xs space-y-2">
                {data.recentActivity.map((a) => (
                  <li key={a.id} className="border-b pb-1">
                    <span className="text-slate-500 mr-2">{a.activityType}</span>
                    <span>{a.body}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {tierAtLeast(role.identity.tier, "nexus") && (
            <Card className="md:col-span-3 border-dashed" data-testid="card-cross-portfolio">
              <CardHeader><CardTitle className="text-sm">Cross-portfolio investor overlap</CardTitle></CardHeader>
              <CardContent>
                <div className="text-xs text-slate-500">Coming with Sprint 32 consent ledger.</div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PartnerShell>
  );
}
