/**
 * Sprint 28 Wave 6 — Admin Notification Composer Dashboard.
 *
 * Replaces the old Sprint 12 broadcast-only surface with a full
 * campaign management view: stats bar, filtered table, and "+ New campaign" CTA.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Plus, Clock, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  audience: { kind: string; industries?: string[]; regions?: string[]; companyId?: string };
  content: { notificationKind: string; title: string; severity: string };
  scheduledAt: string | null;
  sentAt: string | null;
  actualSentCount: number;
  resolvedAudiencePreview: number;
  createdAt: string;
  updatedAt: string;
}

interface CampaignStats {
  byStatus: Record<CampaignStatus, number>;
  sentToday: number;
  sentThisWeek: number;
  sentThisMonth: number;
  totalCampaigns: number;
  cancelationRate: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function statusBadge(status: CampaignStatus) {
  switch (status) {
    case "draft": return <Badge variant="outline" className="gap-1 text-[10px]"><AlertCircle className="h-3 w-3" />Draft</Badge>;
    case "scheduled": return <Badge variant="outline" className="gap-1 text-[10px] border-blue-300 text-blue-700"><Clock className="h-3 w-3" />Scheduled</Badge>;
    case "sending": return <Badge variant="outline" className="gap-1 text-[10px] border-yellow-400 text-yellow-700"><Loader2 className="h-3 w-3 animate-spin" />Sending</Badge>;
    case "sent": return <Badge variant="outline" className="gap-1 text-[10px] border-green-400 text-green-700"><CheckCircle2 className="h-3 w-3" />Sent</Badge>;
    case "canceled": return <Badge variant="outline" className="gap-1 text-[10px] border-gray-300 text-gray-500"><XCircle className="h-3 w-3" />Canceled</Badge>;
    case "failed": return <Badge variant="outline" className="gap-1 text-[10px] border-red-400 text-red-700"><XCircle className="h-3 w-3" />Failed</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function audienceSummary(c: Campaign): string {
  const aud = c.audience;
  switch (aud.kind) {
    case "all_founders": return "All founders";
    case "all_investors": return "All investors";
    case "all_consortium_partners": return "All consortium partners";
    case "all_admins": return "All admins";
    case "cap_table_members": return `Cap-table · ${aud.companyId ?? ""}`;
    case "founders_of_company": return `Founders of ${aud.companyId ?? ""}`;
    case "investors_by_industry": return `Investors · ${(aud.industries ?? []).join(", ")}`;
    case "investors_by_region": return `Investors in ${(aud.regions ?? []).join(", ")}`;
    case "investors_by_industry_and_region":
      return `Investors in ${(aud.industries ?? []).join(", ")} · ${(aud.regions ?? []).join(", ")}`;
    case "companies_by_industry": return `Companies in ${(aud.industries ?? []).join(", ")}`;
    case "companies_by_region": return `Companies in ${(aud.regions ?? []).join(", ")}`;
    case "specific_users": return "Specific users";
    default: return aud.kind;
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function AdminNotifications() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [audienceFilter, setAudienceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const statsQuery = useQuery<CampaignStats>({
    queryKey: ["/api/admin/notification-campaigns/stats"],
    refetchInterval: 15_000,
  });

  const listQuery = useQuery<{ total: number; campaigns: Campaign[] }>({
    queryKey: [
      "/api/admin/notification-campaigns",
      statusFilter,
      audienceFilter,
      search,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (audienceFilter !== "all") params.set("audienceKind", audienceFilter);
      if (search.trim()) params.set("search", search.trim());
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/admin/notification-campaigns?${params}`);
      if (!res.ok) throw new Error("Failed to load campaigns");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const stats = statsQuery.data;
  const campaigns = listQuery.data?.campaigns ?? [];
  const total = listQuery.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Notification Campaigns"
        description="Author, target, schedule, and monitor platform notification campaigns."
        breadcrumbs={[{ label: "Admin" }, { label: "Notifications" }]}
        actions={
          <Link href="/admin/notifications/new">
            <Button size="sm" className="gap-2" data-testid="button-new-campaign">
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </Link>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Sprint 28 Wave 6",
            title: "Notification Composer",
            description: "Campaigns let admins author rich notifications, target specific audiences (all investors, investors by industry/region, founders of a company, specific users, etc.), and schedule delivery — all with SHA-256 hash chain, audit log, and bridge event tracking.",
            positive: "27 notification kinds · 12 audience targeting modes · scheduled or immediate send · double-verify on all mutations.",
          }}
          stats={[
            { label: "Drafts", value: stats?.byStatus.draft ?? 0, tone: "neutral" },
            { label: "Scheduled", value: stats?.byStatus.scheduled ?? 0, tone: "neutral" },
            { label: "Sent this month", value: stats?.sentThisMonth ?? 0, tone: "positive" },
            { label: "Total campaigns", value: stats?.totalCampaigns ?? 0, tone: "neutral" },
          ]}
        />

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4" data-testid="stats-bar">
            <StatCard label="Drafts" value={stats.byStatus.draft} testid="stat-drafts" />
            <StatCard label="Scheduled" value={stats.byStatus.scheduled} testid="stat-scheduled" />
            <StatCard label="Sent today" value={stats.sentToday} testid="stat-sent-today" />
            <StatCard label="Sent this week" value={stats.sentThisWeek} testid="stat-sent-week" />
            <StatCard label="Sent this month" value={stats.sentThisMonth} testid="stat-sent-month" />
            <StatCard label="Total campaigns" value={stats.totalCampaigns} testid="stat-total" />
            <StatCard
              label="Cancellation rate"
              value={`${(stats.cancelationRate * 100).toFixed(1)}%`}
              testid="stat-cancel-rate"
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mt-4">
          <Input
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
            data-testid="input-search-campaigns"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
            <SelectTrigger className="w-40" data-testid="select-status-trigger">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="sending">Sending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={audienceFilter} onValueChange={setAudienceFilter} data-testid="select-audience-filter">
            <SelectTrigger className="w-52" data-testid="select-audience-trigger">
              <SelectValue placeholder="Audience type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All audience types</SelectItem>
              <SelectItem value="all_founders">All founders</SelectItem>
              <SelectItem value="all_investors">All investors</SelectItem>
              <SelectItem value="all_consortium_partners">All partners</SelectItem>
              <SelectItem value="all_admins">All admins</SelectItem>
              <SelectItem value="cap_table_members">Cap-table members</SelectItem>
              <SelectItem value="founders_of_company">Founders of company</SelectItem>
              <SelectItem value="investors_by_industry">Investors by industry</SelectItem>
              <SelectItem value="investors_by_region">Investors by region</SelectItem>
              <SelectItem value="investors_by_industry_and_region">Investors by industry & region</SelectItem>
              <SelectItem value="companies_by_industry">Companies by industry</SelectItem>
              <SelectItem value="companies_by_region">Companies by region</SelectItem>
              <SelectItem value="specific_users">Specific users</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="mt-4">
          <CardContent className="p-0">
            {listQuery.isLoading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
              </div>
            ) : campaigns.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm" data-testid="empty-campaigns">
                {total === 0
                  ? "No campaigns yet. Click \"+ New campaign\" to get started."
                  : "No campaigns match the current filters."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Sent at</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="table-campaigns">
                  {campaigns.map((c) => (
                    <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                      <TableCell>
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>
                        )}
                      </TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-[11px] text-muted-foreground">{c.content.notificationKind}</span>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {audienceSummary(c)}
                          <span className="ml-1 text-muted-foreground">· {c.resolvedAudiencePreview} preview</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.sentAt ? new Date(c.sentAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.status === "sent" ? (
                          <span className="font-semibold text-sm" data-testid={`sent-count-${c.id}`}>{c.actualSentCount}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/notifications/${c.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-edit-${c.id}`}>Edit</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="mt-2 text-xs text-muted-foreground" data-testid="campaigns-count">
          {total} campaign{total !== 1 ? "s" : ""} total
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card sub-component                                              */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, testid }: { label: string; value: number | string; testid: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-lg font-semibold tabular-nums" data-testid={testid}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}
