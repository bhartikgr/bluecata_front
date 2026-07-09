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
// v25.46 BLOCKER FIX #4 (Tier 9 #73) — dashboard cards now use the canonical
// AppCard primitive instead of shadcn Card. Widgets/data-testids unchanged.
import { AppCard } from "@/components/ui/app-card";
// v25.49 Phase-3B — surface the shared comms Messages + Posts on the partner
// dashboard. Reuses the same session-scoped feeds (fail-closed server-side);
// no parallel backend.
import { MessagesWidget } from "@/components/comms/MessagesWidget";
import { PostsFeed } from "@/components/comms/PostsFeed";

/* GROUP C (C5) — the dynamic effective plan the server composes for THIS
   partner (price incl. per-partner override, commission, report-only quota,
   fixed rev-share). Drives the quota tracker + rev-share status cards below. */
interface EffectivePlan {
  effectivePrice: { amountMinor: number; currency: string; source: string };
  advertisedPrice: { amountMinor: number; currency: string } | null;
  commission: { rate: number; via: string };
  arrangement: {
    subscriptionModel?: string | null;
    revShare?: { enabled?: boolean; fixedAmountMinor?: number; currency?: string; source?: string } | null;
  } | null;
  quotaProgress: {
    metric: string;
    registeredThisPeriod: number;
    threshold: number | null;
    period: string;
    enforcement: string;
    met: boolean;
  };
}
interface PartnerMeResp {
  partnerId: string;
  tier: string;
  effectivePlan: EffectivePlan | null;
  /* GROUP F3 — additive, DISPLAY-only reconciliation fields. */
  status?: "active" | "inactive" | "suspended" | "archived" | null;
  commissionPct?: number | null;
  partnerType?: string | null;
  region?: string | null;
}

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
  /* GROUP C (C5) — dynamic effective plan for the quota tracker + rev-share status. */
  const planQ = useQuery<PartnerMeResp>({
    queryKey: ["/api/partner/me"],
    enabled: role.ready && flagsQ.data?.PARTNER_WORKSPACE_ENABLED !== false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me")).json(),
  });

  if (flagsQ.data && flagsQ.data.PARTNER_WORKSPACE_ENABLED === false) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8" data-testid="partner-workspace-preview-banner">
        <AppCard className="max-w-lg text-center">
          <div className="cv-card-title text-base font-semibold mb-2">🚧 Preview / Coming Soon</div>
          <p className="text-[var(--cv-color-text)]">
            The Partner Workspace is an invite-only beta. Reach out to{" "}
            <a className="text-[var(--cv-color-primary)] underline" href="mailto:ops@capavate.com">ops@capavate.com</a>{" "}
            to enable it for your organisation.
          </p>
        </AppCard>
      </div>
    );
  }

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  /* GROUP F3 — admin-set status from the /me payload drives the non-blocking
   * PartnerShell banner (DISPLAY only; server still gates all data/writes). */
  const partnerStatus = planQ.data?.status ?? role.identity.status ?? null;
  return (
    <PartnerShell title="Dashboard" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name} status={partnerStatus}>
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
      {!data && !q.isError && <div className="text-[var(--cv-color-text-muted)]" data-testid="dashboard-loading">Loading…</div>}
      {data && data.empty && (
        <PartnerEmptyState
          title="Your portfolio is just getting started"
          description="Add your first attributed company to begin. Capavate admin can attribute companies to your partner record, or sign companies up with your referral code."
        />
      )}
      {data && !data.empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AppCard data-testid="card-portfolio">
            <div className="cv-card-title text-sm font-semibold mb-3">Portfolio</div>
            <div>
              <div className="text-3xl font-bold" data-testid="kpi-companies">{data.portfolio.attributedCompanies}</div>
              <div className="text-xs text-[var(--cv-color-text-muted)]">attributed companies</div>
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
              <div className="text-xs mt-3 text-[var(--cv-color-text-secondary)]" data-testid="kpi-spv">
                SPVs committed: {formatMinor(data.portfolio.totalSpvCommittedMinor, "USD", { locale: "en-US" })}{" "}
                <span className="text-[var(--cv-color-text-faint)]">USD</span>
              </div>
              <div className="text-xs text-[var(--cv-color-text-secondary)]" data-testid="kpi-fund">
                Funds committed: {formatMinor(data.portfolio.totalFundCommittedMinor, "USD", { locale: "en-US" })}{" "}
                <span className="text-[var(--cv-color-text-faint)]">USD</span>
              </div>
            </div>
          </AppCard>
          <AppCard data-testid="card-pipeline">
            <div className="cv-card-title text-sm font-semibold mb-3">Pipeline</div>
            <div>
              <ul className="text-xs space-y-1">
                {Object.entries(data.pipeline.byStage).map(([s, n]) => (
                  <li key={s} className="flex justify-between"><span className="text-[var(--cv-color-text-muted)]">{s}</span><span className="font-medium">{n}</span></li>
                ))}
              </ul>
            </div>
          </AppCard>
          <AppCard data-testid="card-team">
            <div className="cv-card-title text-sm font-semibold mb-3">Team</div>
            <div>
              <div className="text-3xl font-bold" data-testid="kpi-seats">{data.team.activeSeats} / {data.team.seatLimit === 9999 ? "∞" : data.team.seatLimit}</div>
              <div className="text-xs text-[var(--cv-color-text-muted)]">active seats</div>
              <div className="text-xs mt-2" data-testid="kpi-pending-invites">{data.team.pendingInvitations} pending invitations</div>
            </div>
          </AppCard>
          {/* GROUP C (C5) — dynamic plan: quota tracker (report-only) + rev-share
             status. Rendered only when the server resolved an effective plan. */}
          {planQ.data?.effectivePlan && (
            <AppCard className="md:col-span-3" data-testid="card-plan">
              <div className="cv-card-title text-sm font-semibold mb-3">Plan &amp; quota</div>
              {/* GROUP F3 — DISPLAY-only commission %. Renders the server-derived
                 commissionPct (percent form of the EXISTING commission rate).
                 It NEVER drives any calculation, ledger or payment path. */}
              {planQ.data.commissionPct != null && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mb-3" data-testid="plan-commission">
                  Commission:{" "}
                  <span className="font-semibold text-[var(--cv-color-text)]" data-testid="kpi-commission-pct">
                    {Number.isInteger(planQ.data.commissionPct)
                      ? planQ.data.commissionPct
                      : planQ.data.commissionPct.toFixed(2)}%
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div data-testid="plan-quota">
                  <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">
                    Registered this month
                    {planQ.data.effectivePlan.quotaProgress.threshold != null && (
                      <span> (quota {planQ.data.effectivePlan.quotaProgress.threshold})</span>
                    )}
                    {/* GROUP F3 — DISPLAY-only quota enforcement mode (report|warn). */}
                    <span data-testid="quota-enforcement-mode" className="text-[var(--cv-color-text-faint)]">
                      {" · "}{planQ.data.effectivePlan.quotaProgress.enforcement}
                    </span>
                  </div>
                  <div className="text-3xl font-bold" data-testid="kpi-quota-registered">
                    {planQ.data.effectivePlan.quotaProgress.registeredThisPeriod}
                    {planQ.data.effectivePlan.quotaProgress.threshold != null && (
                      <span className="text-base text-[var(--cv-color-text-faint)]"> / {planQ.data.effectivePlan.quotaProgress.threshold}</span>
                    )}
                  </div>
                  {planQ.data.effectivePlan.quotaProgress.threshold != null &&
                    planQ.data.effectivePlan.quotaProgress.met && (
                      <div className="text-xs mt-1 text-amber-600" data-testid="quota-met-warning">
                        Monthly quota reached (report-only — no change to price or access).
                      </div>
                    )}
                </div>
                <div data-testid="plan-price">
                  <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Your subscription</div>
                  <div className="text-xl font-semibold" data-testid="kpi-plan-price">
                    {formatMinor(
                      planQ.data.effectivePlan.effectivePrice.amountMinor,
                      planQ.data.effectivePlan.effectivePrice.currency,
                      { locale: "en-US" },
                    )}{" "}
                    <span className="text-[var(--cv-color-text-faint)] text-xs">{planQ.data.effectivePlan.effectivePrice.currency} / mo</span>
                  </div>
                  {planQ.data.effectivePlan.effectivePrice.source === "partner_override" && (
                    <div className="text-xs mt-1 text-emerald-600" data-testid="price-custom-badge">Custom partner price</div>
                  )}
                </div>
                <div data-testid="plan-revshare">
                  <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Rev-share</div>
                  {planQ.data.effectivePlan.arrangement?.revShare?.enabled ? (
                    <div className="text-xl font-semibold" data-testid="kpi-revshare">
                      {formatMinor(
                        planQ.data.effectivePlan.arrangement.revShare.fixedAmountMinor ?? 0,
                        planQ.data.effectivePlan.arrangement.revShare.currency ?? "USD",
                        { locale: "en-US" },
                      )}{" "}
                      <span className="text-[var(--cv-color-text-faint)] text-xs">per paying company</span>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="revshare-disabled">Not enabled</div>
                  )}
                </div>
              </div>
            </AppCard>
          )}
          <AppCard className="md:col-span-3" data-testid="card-recent">
            <div className="cv-card-title text-sm font-semibold mb-3">Recent activity</div>
            <div>
              {data.recentActivity.length === 0 && <div className="text-xs text-[var(--cv-color-text-muted)]">No activity yet.</div>}
              <ul className="text-xs space-y-2">
                {data.recentActivity.map((a) => (
                  <li key={a.id} className="border-b pb-1">
                    <span className="text-[var(--cv-color-text-muted)] mr-2">{a.activityType}</span>
                    <span>{a.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AppCard>
          {/* v25.49 Phase-3B — compact NETWORK cards: Messages + Posts. Reuse
             the shared comms widgets; feeds are session-scoped/fail-closed. */}
          <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="card-network">
            <MessagesWidget basePath="/collective/partner/messages" title="Messages" />
            <AppCard data-testid="card-posts">
              <div className="cv-card-title text-sm font-semibold mb-3">Network posts</div>
              <PostsFeed role="investor" basePath="/collective/partner" maxPosts={3} viewAllHref="/collective/partner/posts" />
            </AppCard>
          </div>
          {tierAtLeast(role.identity.tier, "nexus") && (
            <AppCard className="md:col-span-3 border-dashed" data-testid="card-cross-portfolio">
              <div className="cv-card-title text-sm font-semibold mb-3">Cross-portfolio investor overlap</div>
              <div>
                <div className="text-xs text-[var(--cv-color-text-muted)]">Coming with Sprint 32 consent ledger.</div>
              </div>
            </AppCard>
          )}
        </div>
      )}
    </PartnerShell>
  );
}
