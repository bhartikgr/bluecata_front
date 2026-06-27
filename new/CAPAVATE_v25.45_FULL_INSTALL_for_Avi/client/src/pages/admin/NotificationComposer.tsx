/**
 * Sprint 28 Wave 6 — Notification Campaign Composer
 *
 * Single-page authoring with 4 tabs:
 *   1. Compose  – kind, severity, title, body, link, live preview
 *   2. Audience – targeting kind + conditional fields
 *   3. Schedule – send-now vs schedule, datetime picker, draft/schedule/send/cancel
 *   4. History  – revision chain (edit mode only)
 *
 * Double-verify on all mutations.
 * "Send now" requires typed confirmation (campaign name).
 * Unsaved-changes banner (amber) shown when form differs from saved state.
 */

import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRegions } from "@/lib/regionsRuntime";
import {
  Bell, Send, Clock, Save, XCircle, CheckCircle2, AlertTriangle,
  Eye, Hash, Loader2, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

/* ------------------------------------------------------------------ */
/* Constants / data                                                     */
/* ------------------------------------------------------------------ */

const NOTIFICATION_KINDS = [
  // round.*
  "round.invitation_received",
  "round.invitation_accepted",
  "round.invitation_declined",
  "round.soft_circle_received",
  "round.document_ready_to_sign",
  "round.document_signed",
  "round.closed",
  // dataroom.*
  "dataroom.access_granted",
  "dataroom.document_uploaded",
  // investor_report.*
  "investor_report.published",
  // message.*
  "message.received",
  // collective.*
  "collective.eligibility_gained",
  "collective.membership_approved",
  // spv.*
  "spv.launched",
  "spv.subscription_countersigned",
  // dsc.*
  "dsc.company_assigned",
  "dsc.review_received",
  "dsc.feedback_summary",
  // cap_table.*
  "cap_table.drift_detected",
  "cap_table.broadcast",
  // compliance.*
  "compliance.hold_placed",
  // kyc.*
  "kyc.status_changed",
  // membership.*
  "membership.renewal_due",
  "membership.lapsed",
  // payment.*
  "payment.failure",
  // soft_circle.*
  "soft_circle.lapsed",
  // crm.*
  "crm.intro_request",
] as const;

const KIND_GROUPS: Record<string, string[]> = {
  "round.*": NOTIFICATION_KINDS.filter(k => k.startsWith("round.")),
  "dataroom.*": NOTIFICATION_KINDS.filter(k => k.startsWith("dataroom.")),
  "investor_report.*": NOTIFICATION_KINDS.filter(k => k.startsWith("investor_report.")),
  "message.*": NOTIFICATION_KINDS.filter(k => k.startsWith("message.")),
  "collective.*": NOTIFICATION_KINDS.filter(k => k.startsWith("collective.")),
  "spv.*": NOTIFICATION_KINDS.filter(k => k.startsWith("spv.")),
  "dsc.*": NOTIFICATION_KINDS.filter(k => k.startsWith("dsc.")),
  "cap_table.*": NOTIFICATION_KINDS.filter(k => k.startsWith("cap_table.")),
  "compliance.*": NOTIFICATION_KINDS.filter(k => k.startsWith("compliance.")),
  "kyc.*": NOTIFICATION_KINDS.filter(k => k.startsWith("kyc.")),
  "membership.*": NOTIFICATION_KINDS.filter(k => k.startsWith("membership.")),
  "payment.*": NOTIFICATION_KINDS.filter(k => k.startsWith("payment.")),
  "soft_circle.*": NOTIFICATION_KINDS.filter(k => k.startsWith("soft_circle.")),
  "crm.*": NOTIFICATION_KINDS.filter(k => k.startsWith("crm.")),
};

const AUDIENCE_KINDS = [
  { value: "all_founders", label: "All founders" },
  { value: "all_investors", label: "All investors" },
  { value: "all_consortium_partners", label: "All consortium partners" },
  { value: "all_admins", label: "All admins" },
  { value: "cap_table_members", label: "Cap-table members of a company" },
  { value: "founders_of_company", label: "Founders of a company" },
  { value: "investors_by_industry", label: "Investors by industry" },
  { value: "investors_by_region", label: "Investors by region" },
  { value: "investors_by_industry_and_region", label: "Investors by industry & region" },
  { value: "companies_by_industry", label: "Companies by industry" },
  { value: "companies_by_region", label: "Companies by region" },
  { value: "specific_users", label: "Specific users" },
];

const INDUSTRIES = [
  "fintech", "ai", "biotech", "climate", "saas", "healthtech",
  "edtech", "deeptech", "consumer", "marketplaces", "web3",
];

// Companies loaded from /api/admin/companies at runtime.
type CompanyOption = { id: string; name: string };

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type AudienceKind =
  | "all_founders" | "all_investors" | "all_consortium_partners" | "all_admins"
  | "cap_table_members" | "founders_of_company" | "investors_by_industry"
  | "investors_by_region" | "investors_by_industry_and_region"
  | "companies_by_industry" | "companies_by_region" | "specific_users";

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  audience: {
    kind: AudienceKind;
    companyId?: string;
    industries?: string[];
    regions?: string[];
    userIds?: string[];
  };
  content: {
    notificationKind: string;
    title: string;
    body: string;
    link: string | null;
    severity: string;
  };
  scheduledAt: string | null;
  timezone: string;
  resolvedAudiencePreview: number;
  actualSentCount: number;
  errors: Array<{ userId: string; error: string }>;
  sentAt: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  description: string;
  audienceKind: AudienceKind;
  companyId: string;
  industries: string[];
  regions: string[];
  specificUsers: string;
  notificationKind: string;
  severity: string;
  title: string;
  body: string;
  link: string;
  scheduledAt: string;
  timezone: string;
  sendMode: "now" | "scheduled";
}

/* ------------------------------------------------------------------ */
/* API helper                                                           */
/* ------------------------------------------------------------------ */

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function apiConfirmedRequest(method: string, url: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-confirm": "true",
      "x-actor": "u_admin",
    },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export default function AdminNotificationComposer() {
  const [, params] = useRoute("/admin/notifications/:id");
  const [, navigate] = useLocation();
  const isEditMode = !!params?.id;
  const campaignId = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { regions: allRegions } = useRegions();

  const companiesQuery = useQuery<CompanyOption[]>({
    queryKey: ["/api/companies"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/companies`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })) : [];
    },
  });
  const COMPANIES: CompanyOption[] = companiesQuery.data ?? [];

  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    audienceKind: "all_founders",
    companyId: "",
    industries: [],
    regions: [],
    specificUsers: "",
    notificationKind: "round.invitation_received",
    severity: "info",
    title: "",
    body: "",
    link: "",
    scheduledAt: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sendMode: "now",
  });

  const [savedForm, setSavedForm] = useState<FormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [audiencePreview, setAudiencePreview] = useState<{ totalMatches: number; byKind: Record<string, unknown> } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [sendConfirmText, setSendConfirmText] = useState("");
  const [tab, setTab] = useState("compose");

  // Load campaign in edit mode
  const campaignQuery = useQuery<{ ok: boolean; campaign: Campaign }>({
    queryKey: ["/api/admin/notification-campaigns", campaignId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/notification-campaigns/${campaignId}`);
      if (!res.ok) throw new Error("Failed to load campaign");
      return res.json();
    },
    enabled: isEditMode,
  });

  const campaign = campaignQuery.data?.campaign;

  // Populate form when campaign loads
  useEffect(() => {
    if (!campaign) return;
    const f: FormState = {
      name: campaign.name,
      description: campaign.description,
      audienceKind: campaign.audience.kind as AudienceKind,
      companyId: campaign.audience.companyId ?? "",
      industries: campaign.audience.industries ?? [],
      regions: campaign.audience.regions ?? [],
      specificUsers: (campaign.audience.userIds ?? []).join("\n"),
      notificationKind: campaign.content.notificationKind,
      severity: campaign.content.severity,
      title: campaign.content.title,
      body: campaign.content.body,
      link: campaign.content.link ?? "",
      scheduledAt: campaign.scheduledAt
        ? new Date(campaign.scheduledAt).toISOString().slice(0, 16)
        : "",
      timezone: campaign.timezone,
      sendMode: campaign.scheduledAt ? "scheduled" : "now",
    };
    setForm(f);
    setSavedForm(f);
  }, [campaign]);

  const hasUnsaved = savedForm !== null && JSON.stringify(form) !== JSON.stringify(savedForm);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleIndustry(ind: string) {
    setForm(prev => ({
      ...prev,
      industries: prev.industries.includes(ind)
        ? prev.industries.filter(i => i !== ind)
        : [...prev.industries, ind],
    }));
  }

  function toggleRegion(code: string) {
    setForm(prev => ({
      ...prev,
      regions: prev.regions.includes(code)
        ? prev.regions.filter(r => r !== code)
        : [...prev.regions, code],
    }));
  }

  function buildAudienceTarget() {
    const aud: Record<string, unknown> = { kind: form.audienceKind };
    if (form.audienceKind === "cap_table_members" || form.audienceKind === "founders_of_company") {
      aud.companyId = form.companyId;
    }
    if (["investors_by_industry", "investors_by_industry_and_region", "companies_by_industry"].includes(form.audienceKind)) {
      aud.industries = form.industries;
    }
    if (["investors_by_region", "investors_by_industry_and_region", "companies_by_region"].includes(form.audienceKind)) {
      aud.regions = form.regions;
    }
    if (form.audienceKind === "specific_users") {
      aud.userIds = form.specificUsers.split("\n").map(s => s.trim()).filter(Boolean);
    }
    return aud;
  }

  function buildContent() {
    return {
      notificationKind: form.notificationKind,
      title: form.title,
      body: form.body,
      link: form.link.trim() || null,
      severity: form.severity,
    };
  }

  async function previewAudience() {
    setIsPreviewLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notification-campaigns/audience-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience: buildAudienceTarget() }),
      });
      const data = await res.json();
      setAudiencePreview(data.preview);
    } catch {
      toast({ title: "Preview failed", description: "Could not resolve audience." });
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function saveDraft() {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Please enter a campaign name." });
      return;
    }
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Content required", description: "Title and body are required." });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        audience: buildAudienceTarget(),
        content: buildContent(),
        scheduledAt: null,
        timezone: form.timezone,
      };

      let res: Response;
      if (isEditMode && campaignId) {
        res = await apiConfirmedRequest("PATCH", `/api/admin/notification-campaigns/${campaignId}`, payload);
      } else {
        res = await apiConfirmedRequest("POST", "/api/admin/notification-campaigns", payload);
      }

      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Save failed", description: data.error ?? "Unknown error" });
        return;
      }

      toast({ title: "Draft saved", description: `Campaign "${form.name}" saved.` });
      setSavedForm({ ...form });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns/stats"] });

      if (!isEditMode && data.campaign?.id) {
        navigate(`/admin/notifications/${data.campaign.id}`);
      }
    } catch (e: unknown) {
      toast({ title: "Save failed", description: (e as Error)?.message ?? "Unknown error" });
    } finally {
      setIsSaving(false);
    }
  }

  async function scheduleCampaign() {
    if (!campaignId) {
      toast({ title: "Save first", description: "Save as draft before scheduling." });
      return;
    }
    if (!form.scheduledAt) {
      toast({ title: "Scheduled time required", description: "Pick a future date/time." });
      return;
    }
    const schedDate = new Date(form.scheduledAt);
    if (schedDate.getTime() <= Date.now()) {
      toast({ title: "Invalid time", description: "Scheduled time must be in the future." });
      return;
    }
    setIsScheduling(true);
    try {
      const res = await apiConfirmedRequest("POST", `/api/admin/notification-campaigns/${campaignId}/schedule`, {
        scheduledAt: schedDate.toISOString(),
        timezone: form.timezone,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Schedule failed", description: data.error ?? "Unknown error" });
        return;
      }
      toast({ title: "Campaign scheduled", description: `Delivery set for ${schedDate.toLocaleString()}.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns", campaignId] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns/stats"] });
    } catch (e: unknown) {
      toast({ title: "Schedule failed", description: (e as Error)?.message ?? "Unknown error" });
    } finally {
      setIsScheduling(false);
    }
  }

  async function sendNow() {
    if (!campaignId) {
      toast({ title: "Save first", description: "Save as draft before sending." });
      return;
    }
    if (sendConfirmText !== form.name) {
      toast({ title: "Confirmation mismatch", description: "Type the campaign name exactly." });
      return;
    }
    setIsSending(true);
    setSendConfirmOpen(false);
    try {
      const res = await apiConfirmedRequest("POST", `/api/admin/notification-campaigns/${campaignId}/send`, {});
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Send failed", description: data.error ?? "Unknown error" });
        return;
      }
      toast({ title: "Sent!", description: `Delivered to ${data.campaign?.actualSentCount ?? 0} recipients.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns", campaignId] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns/stats"] });
    } catch (e: unknown) {
      toast({ title: "Send failed", description: (e as Error)?.message ?? "Unknown error" });
    } finally {
      setIsSending(false);
      setSendConfirmText("");
    }
  }

  async function cancelCampaign() {
    if (!campaignId) return;
    setIsCanceling(true);
    try {
      const res = await apiConfirmedRequest("POST", `/api/admin/notification-campaigns/${campaignId}/cancel`, {});
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Cancel failed", description: data.error ?? "Unknown error" });
        return;
      }
      toast({ title: "Campaign canceled" });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns", campaignId] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/notification-campaigns/stats"] });
    } catch (e: unknown) {
      toast({ title: "Cancel failed", description: (e as Error)?.message ?? "Unknown error" });
    } finally {
      setIsCanceling(false);
    }
  }

  const isSent = campaign?.status === "sent" || campaign?.status === "failed";
  const isCanceled = campaign?.status === "canceled";
  const isTerminal = isSent || isCanceled || campaign?.status === "sending";

  return (
    <>
      <PageHeader
        title={isEditMode ? (campaign?.name ?? "Campaign") : "New Campaign"}
        description={isEditMode ? `ID: ${campaignId}` : "Compose a new notification campaign."}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Notifications", href: "/admin/notifications" },
          { label: isEditMode ? "Edit" : "New" },
        ]}
        actions={
          <Link href="/admin/notifications">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />

      <PageBody>
        {/* Campaign status badge */}
        {campaign && (
          <div className="flex items-center gap-3 mb-4">
            <Badge
              variant="outline"
              className={
                campaign.status === "sent" ? "border-green-400 text-green-700" :
                campaign.status === "scheduled" ? "border-blue-300 text-blue-700" :
                campaign.status === "canceled" ? "text-gray-500" :
                campaign.status === "failed" ? "border-red-400 text-red-700" :
                ""
              }
              data-testid="badge-campaign-status"
            >
              {campaign.status.toUpperCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">v{campaign.version}</span>
            <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]" title={campaign.revisionHash}>
              #{campaign.revisionHash.slice(0, 12)}…
            </span>
          </div>
        )}

        {/* Unsaved changes banner */}
        {hasUnsaved && !isTerminal && (
          <div
            className="flex items-center justify-between p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg"
            data-testid="banner-unsaved-changes"
          >
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="font-semibold text-amber-800">Unsaved changes.</span>
              <span className="text-amber-700">Save as draft to persist edits.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-100"
              onClick={saveDraft}
              disabled={isSaving}
              data-testid="button-save-from-banner"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              <span className="ml-1">Save</span>
            </Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} data-testid="tabs-composer">
          <TabsList className="mb-4">
            <TabsTrigger value="compose" data-testid="tab-compose">Compose</TabsTrigger>
            <TabsTrigger value="audience" data-testid="tab-audience">Audience</TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">Schedule</TabsTrigger>
            {isEditMode && (
              <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
            )}
          </TabsList>

          {/* ═══════════════════════════════════════ COMPOSE ════════════════════ */}
          <TabsContent value="compose">
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="space-y-4">
                {/* Campaign meta */}
                <Card>
                  <CardHeader><CardTitle className="text-sm">Campaign details</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label htmlFor="campaign-name" className="text-xs font-medium">Campaign name (admin-only)</Label>
                      <Input
                        id="campaign-name"
                        value={form.name}
                        onChange={e => setField("name", e.target.value)}
                        placeholder="e.g. Q2 Renewal Reminder"
                        className="mt-1"
                        disabled={isTerminal}
                        data-testid="input-campaign-name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="campaign-desc" className="text-xs font-medium">Admin notes (optional)</Label>
                      <Textarea
                        id="campaign-desc"
                        value={form.description}
                        onChange={e => setField("description", e.target.value)}
                        placeholder="Internal context for this campaign…"
                        rows={2}
                        className="mt-1"
                        disabled={isTerminal}
                        data-testid="input-campaign-description"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Notification kind */}
                <Card>
                  <CardHeader><CardTitle className="text-sm">Notification kind & severity</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium">Kind</Label>
                      <select
                        className="w-full mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm"
                        value={form.notificationKind}
                        onChange={e => setField("notificationKind", e.target.value)}
                        disabled={isTerminal}
                        data-testid="select-notification-kind"
                      >
                        {Object.entries(KIND_GROUPS).map(([group, kinds]) => (
                          <optgroup key={group} label={group}>
                            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Severity</Label>
                      <div className="flex gap-2 mt-1">
                        {(["info", "warning", "critical"] as const).map(sev => (
                          <button
                            key={sev}
                            type="button"
                            className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                              form.severity === sev
                                ? sev === "info" ? "bg-blue-100 border-blue-400 text-blue-800"
                                  : sev === "warning" ? "bg-amber-100 border-amber-400 text-amber-800"
                                  : "bg-red-100 border-red-400 text-red-800"
                                : "border-border text-muted-foreground hover:bg-muted/50"
                            }`}
                            onClick={() => setField("severity", sev)}
                            disabled={isTerminal}
                            data-testid={`button-severity-${sev}`}
                          >
                            {sev.charAt(0).toUpperCase() + sev.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Content */}
                <Card>
                  <CardHeader><CardTitle className="text-sm">Content</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label htmlFor="notif-title" className="text-xs font-medium">
                        Title <span className="text-muted-foreground">({form.title.length}/120)</span>
                      </Label>
                      <Input
                        id="notif-title"
                        value={form.title}
                        onChange={e => setField("title", e.target.value.slice(0, 120))}
                        placeholder="Notification title"
                        className="mt-1"
                        disabled={isTerminal}
                        data-testid="input-notification-title"
                      />
                    </div>
                    <div>
                      <Label htmlFor="notif-body" className="text-xs font-medium">
                        Body <span className="text-muted-foreground">({form.body.length}/600)</span>
                      </Label>
                      <Textarea
                        id="notif-body"
                        value={form.body}
                        onChange={e => setField("body", e.target.value.slice(0, 600))}
                        rows={4}
                        placeholder="Notification body text…"
                        className="mt-1"
                        disabled={isTerminal}
                        data-testid="input-notification-body"
                      />
                    </div>
                    <div>
                      <Label htmlFor="notif-link" className="text-xs font-medium">Link target (optional)</Label>
                      <Input
                        id="notif-link"
                        value={form.link}
                        onChange={e => setField("link", e.target.value)}
                        placeholder="/admin/companies/<companyId>"
                        className="mt-1"
                        disabled={isTerminal}
                        data-testid="input-notification-link"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Live preview */}
              <div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" /> Live preview
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`rounded-lg border p-4 space-y-2 ${
                        form.severity === "critical" ? "border-red-300 bg-red-50" :
                        form.severity === "warning" ? "border-amber-300 bg-amber-50" :
                        "border-blue-200 bg-blue-50"
                      }`}
                      data-testid="notification-preview"
                    >
                      <div className="flex items-center gap-2">
                        <Bell className={`h-4 w-4 ${
                          form.severity === "critical" ? "text-red-600" :
                          form.severity === "warning" ? "text-amber-600" :
                          "text-blue-600"
                        }`} />
                        <span className="font-mono text-[10px] text-muted-foreground">{form.notificationKind}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            form.severity === "critical" ? "border-red-400 text-red-700" :
                            form.severity === "warning" ? "border-amber-400 text-amber-700" :
                            "border-blue-400 text-blue-700"
                          }`}
                          data-testid="preview-severity-badge"
                        >
                          {form.severity}
                        </Badge>
                      </div>
                      <div className="font-semibold text-sm" data-testid="preview-title">
                        {form.title || <span className="text-muted-foreground italic">No title</span>}
                      </div>
                      <div className="text-sm text-muted-foreground" data-testid="preview-body">
                        {form.body || <span className="italic">No body</span>}
                      </div>
                      {form.link && (
                        <div className="text-xs text-blue-600 underline truncate" data-testid="preview-link">{form.link}</div>
                      )}
                    </div>

                    {audiencePreview && (
                      <div className="mt-4 p-3 rounded-lg border bg-muted/30 text-xs space-y-1" data-testid="audience-preview-result">
                        <div className="font-semibold">Audience preview</div>
                        <div>{String(audiencePreview.byKind?.description ?? "—")}</div>
                        <div className="text-muted-foreground">
                          {audiencePreview.totalMatches} contacts · {String((audiencePreview.byKind as Record<string, unknown>)?.userIdsMapped ?? 0)} mapped to user IDs
                        </div>
                        {(audiencePreview.byKind as Record<string, unknown>)?.limitation && (
                          <div className="text-amber-700 italic">{String((audiencePreview.byKind as Record<string, unknown>).limitation)}</div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════ AUDIENCE ═══════════════════ */}
          <TabsContent value="audience">
            <Card>
              <CardHeader><CardTitle className="text-sm">Audience targeting</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium">Audience kind</Label>
                  <select
                    className="w-full mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm"
                    value={form.audienceKind}
                    onChange={e => setField("audienceKind", e.target.value as AudienceKind)}
                    disabled={isTerminal}
                    data-testid="select-audience-kind"
                  >
                    {AUDIENCE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>

                {/* Company picker */}
                {(form.audienceKind === "cap_table_members" || form.audienceKind === "founders_of_company") && (
                  <div data-testid="field-company-picker">
                    <Label className="text-xs font-medium">Company</Label>
                    <select
                      className="w-full mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm"
                      value={form.companyId}
                      onChange={e => setField("companyId", e.target.value)}
                      disabled={isTerminal}
                      data-testid="select-company"
                    >
                      <option value="" disabled>{COMPANIES.length === 0 ? "No companies available" : "Select a company…"}</option>
                      {COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                    </select>
                  </div>
                )}

                {/* Industries */}
                {["investors_by_industry", "investors_by_industry_and_region", "companies_by_industry"].includes(form.audienceKind) && (
                  <div data-testid="field-industries">
                    <Label className="text-xs font-medium">Industries</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {INDUSTRIES.map(ind => (
                        <button
                          key={ind}
                          type="button"
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            form.industries.includes(ind)
                              ? "bg-[hsl(0_100%_40%)] text-white border-[hsl(0_100%_40%)]"
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          }`}
                          onClick={() => !isTerminal && toggleIndustry(ind)}
                          data-testid={`toggle-industry-${ind}`}
                        >
                          {ind}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Regions */}
                {["investors_by_region", "investors_by_industry_and_region", "companies_by_region"].includes(form.audienceKind) && (
                  <div data-testid="field-regions">
                    <Label className="text-xs font-medium">Regions</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {allRegions.map(r => (
                        <button
                          key={r.code}
                          type="button"
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            form.regions.includes(r.code)
                              ? "bg-[hsl(0_100%_40%)] text-white border-[hsl(0_100%_40%)]"
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          }`}
                          onClick={() => !isTerminal && toggleRegion(r.code)}
                          data-testid={`toggle-region-${r.code}`}
                        >
                          {r.flag} {r.code}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Specific users */}
                {form.audienceKind === "specific_users" && (
                  <div data-testid="field-specific-users">
                    <Label htmlFor="specific-users" className="text-xs font-medium">User IDs (one per line)</Label>
                    <Textarea
                      id="specific-users"
                      value={form.specificUsers}
                      onChange={e => setField("specificUsers", e.target.value)}
                      rows={5}
                      placeholder={"u_user_id_1\nu_user_id_2"}
                      className="mt-1 font-mono text-xs"
                      disabled={isTerminal}
                      data-testid="textarea-specific-users"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {form.specificUsers.split("\n").filter(s => s.trim()).length} user(s) entered
                    </div>
                  </div>
                )}

                {/* Preview button */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={previewAudience}
                    disabled={isPreviewLoading}
                    data-testid="button-preview-audience"
                  >
                    {isPreviewLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                    Preview audience
                  </Button>
                  {audiencePreview && (
                    <span className="text-sm text-muted-foreground" data-testid="audience-preview-count">
                      ~{audiencePreview.totalMatches} contact(s) resolved
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════════════════════════════════ SCHEDULE ═══════════════════ */}
          <TabsContent value="schedule">
            <Card>
              <CardHeader><CardTitle className="text-sm">Schedule & send</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {/* Send mode toggle */}
                <div>
                  <Label className="text-xs font-medium">Delivery mode</Label>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className={`flex-1 py-2 rounded-md border text-sm transition-colors ${
                        form.sendMode === "now" ? "bg-[hsl(0_100%_40%)] text-white border-[hsl(0_100%_40%)]" : "border-border text-muted-foreground"
                      }`}
                      onClick={() => !isTerminal && setField("sendMode", "now")}
                      disabled={isTerminal}
                      data-testid="button-send-mode-now"
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      className={`flex-1 py-2 rounded-md border text-sm transition-colors ${
                        form.sendMode === "scheduled" ? "bg-[hsl(0_100%_40%)] text-white border-[hsl(0_100%_40%)]" : "border-border text-muted-foreground"
                      }`}
                      onClick={() => !isTerminal && setField("sendMode", "scheduled")}
                      disabled={isTerminal}
                      data-testid="button-send-mode-scheduled"
                    >
                      Schedule for later
                    </button>
                  </div>
                </div>

                {/* Scheduled datetime */}
                {form.sendMode === "scheduled" && (
                  <div data-testid="field-scheduled-at">
                    <Label htmlFor="scheduled-at" className="text-xs font-medium">Delivery date & time</Label>
                    <input
                      id="scheduled-at"
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={e => setField("scheduledAt", e.target.value)}
                      className="w-full mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm"
                      disabled={isTerminal}
                      data-testid="input-scheduled-at"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      Timezone: {form.timezone}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                {!isTerminal && (
                  <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={saveDraft}
                      disabled={isSaving}
                      data-testid="button-save-draft"
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                      Save draft
                    </Button>

                    {form.sendMode === "scheduled" && isEditMode && campaign?.status === "draft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={scheduleCampaign}
                        disabled={isScheduling}
                        className="gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                        data-testid="button-schedule-send"
                      >
                        {isScheduling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                        Schedule send
                      </Button>
                    )}

                    {isEditMode && (campaign?.status === "draft" || campaign?.status === "scheduled") && (
                      <Button
                        size="sm"
                        onClick={() => { setSendConfirmText(""); setSendConfirmOpen(true); }}
                        disabled={isSending}
                        className="gap-1"
                        data-testid="button-send-now"
                      >
                        {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Send now
                      </Button>
                    )}

                    {isEditMode && (campaign?.status === "draft" || campaign?.status === "scheduled") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelCampaign}
                        disabled={isCanceling}
                        className="gap-1 text-destructive hover:text-destructive"
                        data-testid="button-cancel-campaign"
                      >
                        {isCanceling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        Cancel
                      </Button>
                    )}
                  </div>
                )}

                {/* Terminal state display */}
                {isSent && campaign && (
                  <div className="p-3 rounded-lg border border-green-300 bg-green-50 text-sm" data-testid="sent-summary">
                    <div className="flex items-center gap-2 font-semibold text-green-800">
                      <CheckCircle2 className="h-4 w-4" /> Sent
                    </div>
                    <div className="mt-1 text-green-700">
                      Delivered to {campaign.actualSentCount} recipient(s).
                      {campaign.sentAt && <span className="ml-2">{new Date(campaign.sentAt).toLocaleString()}</span>}
                    </div>
                    {campaign.errors.length > 0 && (
                      <div className="mt-2 text-xs text-amber-700">
                        {campaign.errors.length} unmapped contact(s) — notifications not delivered.
                      </div>
                    )}
                  </div>
                )}

                {isCanceled && (
                  <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-muted-foreground" data-testid="canceled-summary">
                    This campaign was canceled.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════════════════════════════════ HISTORY ════════════════════ */}
          {isEditMode && (
            <TabsContent value="history">
              <HistoryTab campaignId={campaignId!} />
            </TabsContent>
          )}
        </Tabs>
      </PageBody>

      {/* Send-now typed confirmation dialog */}
      <AlertDialog open={sendConfirmOpen} onOpenChange={setSendConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm immediate send</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  This will immediately deliver notifications to all resolved recipients. Type the campaign name to confirm:
                </p>
                <p className="mb-2 font-mono text-sm bg-muted px-2 py-1 rounded">{form.name}</p>
                <Input
                  value={sendConfirmText}
                  onChange={e => setSendConfirmText(e.target.value)}
                  placeholder="Type campaign name here"
                  data-testid="input-send-confirm"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-send-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={sendNow}
              disabled={sendConfirmText !== form.name}
              data-testid="button-send-confirm-ok"
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* History tab sub-component                                            */
/* ------------------------------------------------------------------ */

function HistoryTab({ campaignId }: { campaignId: string }) {
  const historyQuery = useQuery<{
    ok: boolean;
    history: Array<{
      version: number;
      action: string;
      updatedAt: string;
      updatedBy: string;
      prevRevisionHash: string;
      revisionHash: string;
    }>;
    chain: { ok: boolean; brokenAtVersion?: number; totalRevisions: number };
  }>({
    queryKey: ["/api/admin/notification-campaigns", campaignId, "history"],
    queryFn: async () => {
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/admin/notification-campaigns/${campaignId}/history`);
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  const history = historyQuery.data?.history ?? [];
  const chain = historyQuery.data?.chain;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" /> Revision history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Chain integrity banner */}
        {chain && (
          <div
            className={`flex items-center gap-2 p-2.5 rounded-lg mb-4 text-sm ${
              chain.ok
                ? "border border-green-300 bg-green-50 text-green-800"
                : "border border-red-300 bg-red-50 text-red-800"
            }`}
            data-testid="chain-verify-banner"
          >
            {chain.ok
              ? <><CheckCircle2 className="h-4 w-4" /> Hash chain intact — {chain.totalRevisions} revision(s) verified.</>
              : <><XCircle className="h-4 w-4" /> Chain broken at version {chain.brokenAtVersion}.</>
            }
          </div>
        )}

        {/* Revisions */}
        {historyQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : history.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="empty-history">No revisions yet.</div>
        ) : (
          <div className="space-y-2" data-testid="list-revisions">
            {[...history].reverse().map((rev) => (
              <div
                key={rev.version}
                className="border border-border/60 rounded-md p-3 text-sm"
                data-testid={`revision-v${rev.version}`}
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[10px]">v{rev.version}</Badge>
                  <span className="font-medium">{rev.action}</span>
                  <span className="text-muted-foreground text-xs ml-auto">{new Date(rev.updatedAt).toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">by {rev.updatedBy}</div>
                <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate">
                  #{rev.revisionHash.slice(0, 16)}…
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
