/**
 * Sprint 28 Wave 7 — Admin Email System Dashboard
 *
 * Five tabs:
 *   1. Campaigns  — email campaign list + stats bar
 *   2. Templates  — 15 system templates read-only viewer
 *   3. Outbox     — live paginated send queue
 *   4. Transport  — SMTP config viewer/editor + test-connection
 *   5. Deliverability — delivery/bounce/open rates + trends
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Mail, Send, Eye, RefreshCw, Settings, BarChart3, Inbox,
  PlayCircle, XCircle, Plus, Search, CheckCircle2, AlertTriangle,
  Clock, Ban, TrendingUp,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/* ============================================================
 * Types
 * ============================================================ */

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";
type DeliveryStatus = "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained";
type TransportMode = "smtp" | "console" | "dry_run";

interface EmailCampaign {
  id: string; name: string; description: string; status: CampaignStatus;
  resolvedAudiencePreview: number; actualSentCount: number;
  scheduledAt: string | null; sentAt: string | null;
  createdAt: string; updatedAt: string; audience: { kind: string };
  content: { subject: string; templateSlug: string | null };
}

interface OutboxItem {
  id: string; templateSlug: string; recipient: string; subject: string;
  status: DeliveryStatus; attempts: number; queuedAt: string;
  sentAt: string | null; deliveredAt: string | null; error: string | null;
  campaignId?: string;
}

interface EmailTemplate {
  id: string; slug: string; subject: string; bodyHtml: string;
  bodyText: string; variables: string[]; category: string;
}

interface TransportConfig {
  host: string; port: number; secure: boolean; user: string;
  pass: string; fromAddress: string; replyTo: string | null; mode: TransportMode;
}

/* ============================================================
 * Helpers
 * ============================================================ */

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-slate-100 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  sending:   "bg-amber-100 text-amber-700",
  sent:      "bg-emerald-100 text-emerald-700",
  canceled:  "bg-slate-100 text-slate-600",
  failed:    "bg-rose-100 text-rose-700",
  queued:    "bg-amber-100 text-amber-700",
  delivered: "bg-emerald-100 text-emerald-700",
  opened:    "bg-sky-100 text-sky-700",
  clicked:   "bg-violet-100 text-violet-700",
  bounced:   "bg-rose-100 text-rose-700",
  complained: "bg-rose-200 text-rose-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${STATUS_COLORS[status] ?? "bg-muted text-foreground"} border-0 text-[10px]`}
      data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/* ============================================================
 * Tab 1: Campaigns
 * ============================================================ */

function CampaignsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: statsData } = useQuery<ReturnType<() => {
    byStatus: Record<string, number>; sentToday: number; sentThisWeek: number; cancelationRate: number;
  }>>({
    queryKey: ["/api/admin/email-campaigns/stats"],
    refetchInterval: 10_000,
  });

  const { data: campaignsData } = useQuery<{ total: number; campaigns: EmailCampaign[] }>({
    queryKey: ["/api/admin/email-campaigns", statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await apiRequest("GET", `/api/admin/email-campaigns?${params}`);
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const stats = (statsData as any) ?? {};
  const byStatus = stats.byStatus ?? {};

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Drafts", value: byStatus.draft ?? 0, color: "text-slate-600" },
          { label: "Scheduled", value: byStatus.scheduled ?? 0, color: "text-blue-600" },
          { label: "Sent Today", value: stats.sentToday ?? 0, color: "text-emerald-600" },
          { label: "Sent This Week", value: stats.sentThisWeek ?? 0, color: "text-emerald-600" },
          { label: "Total Campaigns", value: stats.totalCampaigns ?? 0, color: "text-foreground" },
          { label: "Cancel Rate", value: stats.cancelationRate != null ? `${(stats.cancelationRate * 100).toFixed(1)}%` : "—", color: "text-amber-600" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3" data-testid={`stat-campaign-${label.toLowerCase().replace(/\s/g, "-")}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-lg font-semibold mt-1 ${color}`}>{value}</div>
          </Card>
        ))}
      </div>

      {/* Filters + CTA */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            data-testid="input-campaign-search"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-campaign-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["draft","scheduled","sending","sent","canceled","failed"].map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link href="/admin/email/new">
          <Button size="sm" data-testid="button-new-email-campaign">
            <Plus className="h-3.5 w-3.5 mr-1" /> New email campaign
          </Button>
        </Link>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Audience</th>
              <th className="px-3 py-2 text-left font-medium">Subject</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Sent</th>
              <th className="px-3 py-2 text-left font-medium">Updated</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(campaignsData?.campaigns ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/20"
                data-testid={`row-campaign-${c.id}`}>
                <td className="px-3 py-2 font-medium max-w-[180px] truncate">
                  <Link href={`/admin/email/${c.id}`} className="hover:underline text-foreground">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.audience.kind}</td>
                <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{c.content.subject}</td>
                <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                <td className="px-3 py-2">{c.actualSentCount}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(c.updatedAt)}</td>
                <td className="px-3 py-2">
                  <Link href={`/admin/email/${c.id}`}>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                      data-testid={`button-edit-campaign-${c.id}`}>
                      Edit
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
            {(campaignsData?.campaigns ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  No email campaigns yet.{" "}
                  <Link href="/admin/email/new" className="underline">Create one.</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================================================
 * Tab 2: Templates
 * ============================================================ */

function TemplatesTab() {
  const [selected, setSelected] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});

  const { data } = useQuery<{ count: number; templates: EmailTemplate[] }>({
    queryKey: ["/api/admin/email/templates"],
  });

  const previewQuery = useQuery<{ subject: string; bodyHtml: string; bodyText: string }>({
    queryKey: ["/api/admin/email/preview", selected, vars],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/admin/email/preview", { slug: selected, variables: vars });
      return res.json();
    },
    enabled: !!selected,
  });

  const tpl = data?.templates.find((t) => t.slug === selected);

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* Template list */}
      <Card className="p-3 md:col-span-1 h-fit">
        <div className="text-xs font-semibold mb-3 flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" />
          System Templates ({data?.count ?? 0})
        </div>
        <ul className="space-y-1">
          {(data?.templates ?? []).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => { setSelected(t.slug); setVars({}); }}
                data-testid={`button-template-${t.slug}`}
                className={`w-full text-left px-2 py-2 rounded text-xs transition-colors ${
                  selected === t.slug
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/40"
                }`}
              >
                <div className="font-mono text-[11px]">{t.slug}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{t.category}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Preview pane */}
      <div className="md:col-span-2 space-y-4">
        {tpl ? (
          <>
            <Card className="p-4" data-testid="card-template-variables">
              <div className="text-xs font-semibold mb-2 flex items-center gap-2">
                <Eye className="h-3.5 w-3.5" /> Variables
                <Badge variant="outline" className="text-[10px]">{tpl.variables.length}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {tpl.variables.map((v) => (
                  <label key={v} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-[10px] text-muted-foreground w-32 shrink-0">{v}</span>
                    <Input
                      data-testid={`input-var-${v}`}
                      value={vars[v] ?? ""}
                      onChange={(e) => setVars((p) => ({ ...p, [v]: e.target.value }))}
                      className="h-6 text-xs px-2"
                    />
                  </label>
                ))}
              </div>
            </Card>
            <Card className="p-4" data-testid="card-template-preview">
              <div className="text-xs font-semibold mb-2">Preview</div>
              <div className="space-y-2 border-l-2 border-border pl-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subject</div>
                  <div className="text-sm font-medium mt-0.5" data-testid="text-preview-subject">
                    {previewQuery.data?.subject ?? tpl.subject}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Body (HTML)</div>
                  {/* v25.17 Lane D NC1 — render template HTML in sandboxed iframe to prevent XSS. The iframe has no allow-scripts in sandbox so any <script> or javascript: URL is neutralised. */}
                  <iframe
                    className="w-full min-h-[200px] mt-0.5 border border-border rounded"
                    data-testid="text-preview-body"
                    sandbox=""
                    title="Email body preview"
                    srcDoc={previewQuery.data?.bodyHtml ?? tpl.bodyHtml ?? ""}
                  />
                </div>
              </div>
            </Card>
          </>
        ) : (
          <Card className="p-8 text-center text-xs text-muted-foreground">
            Select a template to preview it.
          </Card>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * Tab 3: Outbox
 * ============================================================ */

function OutboxTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data } = useQuery<{ ok: boolean; total: number; items: OutboxItem[]; stats: Record<string, number> }>({
    queryKey: ["/api/admin/email/transport/outbox", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "100");
      const res = await apiRequest("GET", `/api/admin/email/transport/outbox?${params}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/email/transport/outbox/${id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/email/transport/outbox"] });
      toast({ description: "Item requeued for retry." });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/email/transport/outbox/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/email/transport/outbox"] });
      toast({ description: "Item canceled." });
    },
  });

  const stats = data?.stats ?? {};

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {(["queued", "delivered", "bounced", "sent"] as const).map((k) => (
          <Card key={k} className="p-3" data-testid={`stat-outbox-${k}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="text-lg font-semibold mt-1">{stats[k] ?? 0}</div>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-outbox-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["queued","sent","delivered","opened","clicked","bounced"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{data?.total ?? 0} items</span>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Recipient</th>
              <th className="px-3 py-2 text-left font-medium">Subject</th>
              <th className="px-3 py-2 text-left font-medium">Template</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Attempts</th>
              <th className="px-3 py-2 text-left font-medium">Queued</th>
              <th className="px-3 py-2 text-left font-medium">Delivered</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).slice().reverse().map((e) => (
              <tr key={e.id} className="border-t border-border" data-testid={`row-outbox-${e.id}`}>
                <td className="px-3 py-1.5">{e.recipient}</td>
                <td className="px-3 py-1.5 max-w-[200px] truncate">{e.subject}</td>
                <td className="px-3 py-1.5 font-mono text-[10px]">{e.templateSlug}</td>
                <td className="px-3 py-1.5">
                  <StatusBadge status={e.status} />
                  {e.error && <div className="text-[10px] text-rose-600 mt-0.5 truncate max-w-[120px]">{e.error}</div>}
                </td>
                <td className="px-3 py-1.5">{e.attempts}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(e.queuedAt)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(e.deliveredAt)}</td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    {(e.status === "bounced" || e.error === "canceled_by_admin") && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        data-testid={`button-retry-outbox-${e.id}`}
                        onClick={() => retryMutation.mutate(e.id)}>
                        <RefreshCw className="h-3 w-3 mr-1" />Retry
                      </Button>
                    )}
                    {e.status === "queued" && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-rose-600"
                        data-testid={`button-cancel-outbox-${e.id}`}
                        onClick={() => cancelMutation.mutate(e.id)}>
                        <XCircle className="h-3 w-3 mr-1" />Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================================================
 * Tab 4: Transport
 * ============================================================ */

function TransportTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [fromAddress, setFromAddress] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [mode, setMode] = useState<TransportMode>("console");
  const [editMode, setEditMode] = useState(false);
  const [confirmPatch, setConfirmPatch] = useState(false);

  const { data } = useQuery<{ ok: boolean; config: TransportConfig }>({
    queryKey: ["/api/admin/email/transport/config"],
    onSuccess: (d) => {
      if (!editMode) {
        setFromAddress(d.config.fromAddress);
        setReplyTo(d.config.replyTo ?? "");
        setMode(d.config.mode);
      }
    },
  } as any);

  const testMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/email/transport/test-connection", { method: "POST" }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: `Connection OK — ${d.latencyMs ?? 0}ms` });
      } else {
        toast({ title: "Connection failed", description: d.error, variant: "destructive" });
      }
    },
  });

  const patchMutation = useMutation({
    mutationFn: (patch: { fromAddress?: string; replyTo?: string | null; mode?: TransportMode }) =>
      fetch("/api/admin/email/transport/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-confirm": "true" },
        body: JSON.stringify(patch),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: "Transport config updated." });
        qc.invalidateQueries({ queryKey: ["/api/admin/email/transport/config"] });
        setEditMode(false);
        setConfirmPatch(false);
      } else {
        toast({ title: "Failed", description: d.error, variant: "destructive" });
      }
    },
  });

  const cfg = data?.config;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Settings className="h-4 w-4" /> SMTP Configuration
          </div>
          <Button size="sm" variant="outline" data-testid="button-test-connection"
            onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </Button>
        </div>

        {/* Read-only env fields */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            { label: "Host", value: cfg?.host || "(env)" },
            { label: "Port", value: String(cfg?.port ?? "") },
            { label: "Secure (TLS)", value: cfg?.secure ? "yes" : "no" },
            { label: "User", value: cfg?.user || "(env)" },
            { label: "Pass", value: "***" },
          ].map(({ label, value }) => (
            <div key={label} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="font-mono text-muted-foreground" data-testid={`cfg-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Editable fields */}
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Editable fields</span>
            <Button size="sm" variant="ghost" className="text-xs h-7"
              data-testid="button-edit-transport-config"
              onClick={() => setEditMode(!editMode)}>
              {editMode ? "Cancel" : "Edit"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</span>
              {editMode ? (
                <Select value={mode} onValueChange={(v) => setMode(v as TransportMode)}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-transport-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">smtp (production)</SelectItem>
                    <SelectItem value="console">console (sandbox)</SelectItem>
                    <SelectItem value="dry_run">dry_run (test)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="font-mono" data-testid="cfg-mode">{cfg?.mode ?? "—"}</div>
              )}
            </label>

            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">From Address</span>
              {editMode ? (
                <Input data-testid="input-from-address" value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)} className="h-8 text-xs" />
              ) : (
                <div data-testid="cfg-from-address">{cfg?.fromAddress ?? "—"}</div>
              )}
            </label>

            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reply-To</span>
              {editMode ? (
                <Input data-testid="input-reply-to" value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)} className="h-8 text-xs"
                  placeholder="Leave blank to clear" />
              ) : (
                <div data-testid="cfg-reply-to">{cfg?.replyTo ?? "—"}</div>
              )}
            </label>
          </div>

          {editMode && (
            <div className="pt-2 space-y-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" data-testid="checkbox-confirm-patch"
                  checked={confirmPatch} onChange={(e) => setConfirmPatch(e.target.checked)} />
                I confirm I want to update the transport config.
              </label>
              <Button size="sm" data-testid="button-save-transport-config"
                disabled={!confirmPatch || patchMutation.isPending}
                onClick={() => patchMutation.mutate({
                  fromAddress: fromAddress || undefined,
                  replyTo: replyTo || null,
                  mode,
                })}>
                {patchMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
 * Tab 5: Deliverability
 * ============================================================ */

function DeliverabilityTab() {
  const { data } = useQuery<{
    ok: boolean; total: number;
    stats: { queued: number; sent: number; delivered: number; bounced: number; opened?: number; clicked?: number };
    items: OutboxItem[];
  }>({
    queryKey: ["/api/admin/email/transport/outbox-deliverability"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/email/transport/outbox?limit=200");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const items = (data as any)?.items ?? [] as OutboxItem[];
  const total = items.length;
  const delivered = items.filter((e: OutboxItem) => e.status === "delivered" || e.status === "opened" || e.status === "clicked").length;
  const bounced = items.filter((e: OutboxItem) => e.status === "bounced").length;
  const opened = items.filter((e: OutboxItem) => e.status === "opened" || e.status === "clicked").length;
  const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0";
  const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(1) : "0.0";
  const openRate = delivered > 0 ? ((opened / delivered) * 100).toFixed(1) : "0.0";

  const recentBounces = items.filter((e: OutboxItem) => e.status === "bounced").slice(-10).reverse();

  return (
    <div className="space-y-4">
      {/* Rate cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Delivery Rate", value: `${deliveryRate}%`, icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Bounce Rate", value: `${bounceRate}%`, icon: AlertTriangle, color: "text-rose-600" },
          { label: "Open Rate", value: `${openRate}%`, icon: Eye, color: "text-sky-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4 flex items-start gap-3" data-testid={`stat-deliverability-${label.toLowerCase().replace(/\s/g, "-")}`}>
            <Icon className={`h-5 w-5 mt-0.5 ${color}`} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {total} total emails
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Recent bounces */}
      {recentBounces.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-card/50 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
            <h3 className="text-sm font-semibold">Recent bounces</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left">Recipient</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Error</th>
                <th className="px-3 py-2 text-left">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {recentBounces.map((e: OutboxItem) => (
                <tr key={e.id} className="border-t border-border" data-testid={`row-bounce-${e.id}`}>
                  <td className="px-3 py-1.5">{e.recipient}</td>
                  <td className="px-3 py-1.5 max-w-[200px] truncate">{e.subject}</td>
                  <td className="px-3 py-1.5 text-rose-600">{e.error ?? "unknown"}</td>
                  <td className="px-3 py-1.5">{e.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {total === 0 && (
        <Card className="p-8 text-center text-xs text-muted-foreground">
          No outbox data available yet.
        </Card>
      )}
    </div>
  );
}

/* ============================================================
 * Main component
 * ============================================================ */

export default function AdminEmail() {
  return (
    <>
      <PageHeader
        title="Email System"
        description="Production email campaigns · 15 system templates · SMTP transport · delivery analytics."
        actions={
          <Link href="/admin/email/new">
            <Button size="sm" data-testid="button-new-email-campaign-header">
              <Plus className="h-3.5 w-3.5 mr-1" /> New campaign
            </Button>
          </Link>
        }
      />
      <PageBody>
        <Tabs defaultValue="campaigns">
          <TabsList className="mb-4" data-testid="tabs-email-system">
            <TabsTrigger value="campaigns" data-testid="tab-campaigns">
              <Mail className="h-3.5 w-3.5 mr-1.5" />Campaigns
            </TabsTrigger>
            <TabsTrigger value="templates" data-testid="tab-templates">
              <Eye className="h-3.5 w-3.5 mr-1.5" />Templates
            </TabsTrigger>
            <TabsTrigger value="outbox" data-testid="tab-outbox">
              <Inbox className="h-3.5 w-3.5 mr-1.5" />Outbox
            </TabsTrigger>
            <TabsTrigger value="transport" data-testid="tab-transport">
              <Settings className="h-3.5 w-3.5 mr-1.5" />Transport
            </TabsTrigger>
            <TabsTrigger value="deliverability" data-testid="tab-deliverability">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Deliverability
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns">
            <CampaignsTab />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
          <TabsContent value="outbox">
            <OutboxTab />
          </TabsContent>
          <TabsContent value="transport">
            <TransportTab />
          </TabsContent>
          <TabsContent value="deliverability">
            <DeliverabilityTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
