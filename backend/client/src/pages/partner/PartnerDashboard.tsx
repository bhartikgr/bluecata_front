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
import { formatMinor } from "@/lib/currency"; /* v25.40 FIX-12 currency sweep */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardSnapshot {
  portfolio: { attributedCompanies: number; totalSpvCommittedMinor: number; totalFundCommittedMinor: number };
  pipeline: { byStage: Record<string, number>; topDeals: Array<{ id: string; dealName: string; estCheckSizeMinor: number | null; currency: string | null }> };
  recentActivity: Array<{ id: string; activityType: string; body: string; occurredAt: string }>;
  team: { activeSeats: number; pendingInvitations: number; seatLimit: number };
  empty: boolean;
}

/* v14 Tier-1 Fix 5 — feature-flag gate. Hides the partner workspace behind a
 * preview banner when FEATURE_PARTNER_WORKSPACE_ENABLED=false. Default is
 * enabled — the banner only renders on preview/staging deploys that opt out. */
interface FeatureFlags {
  PARTNER_WORKSPACE_ENABLED: boolean;
  COLLECTIVE_ADMIN_APPROVAL_ENABLED: boolean;
}

export default function PartnerDashboard() {
  const role = useRequirePartnerRole();
  const flagsQ = useQuery<FeatureFlags>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const q = useQuery<DashboardSnapshot>({
    queryKey: ["/api/partner/me/dashboard"],
    enabled: role.ready && flagsQ.data?.PARTNER_WORKSPACE_ENABLED !== false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/dashboard")).json(),
  });

  if (flagsQ.data && flagsQ.data.PARTNER_WORKSPACE_ENABLED === false) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8" data-testid="partner-workspace-preview-banner">
        <Card className="max-w-lg text-center">
          <CardHeader>
            <CardTitle>🚧 Preview / Coming Soon</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700">
              The Partner Workspace is an invite-only beta. Reach out to{" "}
              <a className="text-blue-600 underline" href="mailto:ops@capavate.com">ops@capavate.com</a>{" "}
              to enable it for your organisation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  return (
    <PartnerShell title="Dashboard" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {/* v25.16 NH1 — explicit error branch; previously a fetch failure left
         the dashboard stuck on "Loading…" with no retry path. */}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="dashboard-error"
        >
          Could not load dashboard. Please refresh and try again.
        </div>
      )}
      {!data && !q.isError && <div className="text-slate-500" data-testid="dashboard-loading">Loading…</div>}
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
              {/* v25.16 NL1 — currency label on committed totals so the
                 number is not bare. (Server-side multi-currency rollup is
                 covered by server NM1.) */}
              {/* v25.40 FIX-12 (consortium P2 #1): the v25.38 currency-formatter
                 sweep missed these two inline `(value / 100).toLocaleString()`
                 calls, which hardcoded a 2-decimal divisor and broke 0-/3-decimal
                 currencies. Use the shared ISO 4217-aware formatMinor instead.
                 The portfolio rollup has no per-currency field yet (server-side
                 multi-currency rollup is tracked separately), so we default to
                 "USD" — matching the prior hardcoded label. */}
              <div className="text-xs mt-3 text-slate-700" data-testid="kpi-spv">
                SPVs committed: {formatMinor(data.portfolio.totalSpvCommittedMinor, "USD", { locale: "en-US" })}{" "}
                <span className="text-slate-400">USD</span>
              </div>
              <div className="text-xs text-slate-700" data-testid="kpi-fund">
                Funds committed: {formatMinor(data.portfolio.totalFundCommittedMinor, "USD", { locale: "en-US" })}{" "}
                <span className="text-slate-400">USD</span>
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
