/**
 * Wave C-3 — Collective Dashboard
 * KPI cards + recent activity feed. All data live-fetched.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Briefcase, BarChart3, Clock, FileText, TrendingUp } from "lucide-react";

interface DashboardData {
  kpis: {
    totalMembers: number;
    activeSubscriptions: number;
    companiesInDealRoom: number;
    dscPipelineDepth: number;
    pendingApps: number;
  };
  recentActivity: Array<{
    eventId: string;
    eventType: string;
    aggregateId: string;
    occurredAt: string;
    status: string;
  }>;
}

function KpiCard({
  title, value, icon: Icon, description, loading,
}: {
  title: string;
  value: number | undefined;
  icon: typeof Users;
  description?: string;
  loading: boolean;
}) {
  return (
    <Card data-testid={`card-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
          <Icon className="h-4 w-4 text-[#8E2A4E]" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <div
              className="text-2xl font-bold"
              style={{ color: "#1A1A2E" }}
              data-testid={`value-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {value ?? 0}
            </div>
            {description && (
              <p className="text-xs text-slate-500 mt-1">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function eventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "company.profile.updated": "Company profile updated",
    "company.ma_intelligence.updated": "M&A intelligence updated",
    "transaction_prep.updated": "Transaction prep updated",
    "dsc.score.recomputed": "DSC score recomputed",
    "collective.member.updated": "Member settings updated",
    "collective.deal_room.opened": "Deal room opened",
    "profile.completion_changed": "Profile completion changed",
  };
  return labels[eventType] ?? eventType;
}

function statusColor(status: string) {
  if (status === "delivered") return "bg-emerald-100 text-emerald-700";
  if (status === "dead_letter") return "bg-red-100 text-red-700";
  if (status === "queued") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export default function CollectiveDashboard() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/collective/dashboard"],
    queryFn: () => apiRequest("GET", "/api/collective/dashboard").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  // v25.32 P0'' / P0'''' — diagnose the "Failed to load dashboard data" case.
  // The endpoint 403s for non-collective sessions. apiRequest throws an
  // ApiError carrying the server payload. When the server flags this caller
  // as a partner-only session (`partnerWorkspace: true`), redirect them to
  // their partner workspace instead of stranding them on a zeroed-out
  // Collective dashboard. This is the wrong-landing self-heal for Ozan.
  const apiErr = error instanceof ApiError ? error : null;
  const errPayload = (apiErr && typeof apiErr.payload === "object" && apiErr.payload !== null
    ? (apiErr.payload as { partnerWorkspace?: boolean; redirectTo?: string; message?: string })
    : null);
  const isPartnerWorkspaceCase = errPayload?.partnerWorkspace === true;
  const redirectTo = errPayload?.redirectTo ?? "/collective/partner/dashboard";

  useEffect(() => {
    if (isPartnerWorkspaceCase) {
      navigate(redirectTo);
    }
  }, [isPartnerWorkspaceCase, redirectTo, navigate]);

  // While the redirect is in flight, render an explicit partner panel rather
  // than the generic "Failed to load" banner (which misled the user into
  // thinking the platform was broken).
  if (isPartnerWorkspaceCase) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="collective-partner-redirect">
        <Card>
          <CardHeader>
            <CardTitle style={{ color: "#1A1A2E" }}>You're a consortium partner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              {errPayload?.message ??
                "Switch to your partner workspace to continue."}
            </p>
            <Button
              onClick={() => navigate(redirectTo)}
              data-testid="button-go-partner-workspace"
            >
              Go to partner workspace →
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1
          className="text-xl font-semibold"
          style={{ color: "#1A1A2E" }}
          data-testid="heading-dashboard"
        >
          Collective Dashboard
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Live overview of the Capavate Collective ecosystem.
        </p>
      </div>

      {error && (
        <div
          className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700"
          data-testid="error-dashboard"
        >
          {/* v25.32 P0'' — surface the server's friendly message when present
              (e.g. "membership pending admin approval") instead of a blanket
              "Failed to load". Falls back to the generic copy for opaque
              5xx / network errors. */}
          {errPayload?.message ?? "Failed to load dashboard data. Please refresh."}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Total Members"
          value={data?.kpis.totalMembers}
          icon={Users}
          description="Investors + partners"
          loading={isLoading}
        />
        <KpiCard
          title="Active Subscriptions"
          value={data?.kpis.activeSubscriptions}
          icon={TrendingUp}
          description="Collective-tier"
          loading={isLoading}
        />
        <KpiCard
          title="Companies in Deal Room"
          value={data?.kpis.companiesInDealRoom}
          icon={Briefcase}
          description="Exploring, active, or closing"
          loading={isLoading}
        />
        <KpiCard
          title="DSC Pipeline Depth"
          value={data?.kpis.dscPipelineDepth}
          icon={BarChart3}
          description="Active feedback entries"
          loading={isLoading}
        />
        <KpiCard
          title="Pending Applications"
          value={data?.kpis.pendingApps}
          icon={FileText}
          description="Awaiting review"
          loading={isLoading}
        />
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
            <Clock className="h-4 w-4 text-[#8E2A4E]" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : !data?.recentActivity?.length ? (
            <div className="text-center py-8 text-slate-500" data-testid="empty-activity">
              <p className="text-sm">No activity yet.</p>
              <p className="text-xs mt-1">Activity will appear here as Collective events occur.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="list-activity">
              {data.recentActivity.map((event) => (
                <div
                  key={event.eventId}
                  className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50"
                  data-testid={`row-activity-${event.eventId}`}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-700">
                        {eventTypeLabel(event.eventType)}
                      </p>
                      <p className="text-xs text-slate-400">{event.aggregateId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      className={`text-[10px] px-1.5 py-0.5 ${statusColor(event.status)}`}
                      data-testid={`badge-status-${event.eventId}`}
                    >
                      {event.status}
                    </Badge>
                    <span className="text-[10px] text-slate-400">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
