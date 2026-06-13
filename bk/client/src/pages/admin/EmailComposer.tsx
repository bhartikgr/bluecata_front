/**
 * Sprint 28 Wave 7 — Admin Email Composer
 *
 * Four tabs:
 *   1. Compose  — name/description, template picker, subject, HTML body, variables, live preview
 *   2. Audience — audience kind + filters, preview count
 *   3. Schedule — send now vs later, test-send, typed confirmation
 *   4. History  — revision list + hash chain verify banner
 */

import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Mail, ChevronLeft, Save, Send, Clock, History, Users,
  Eye, EyeOff, AlertTriangle, CheckCircle2, RefreshCw, Monitor, Smartphone,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/* ============================================================
 * Types
 * ============================================================ */

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";
type AudienceKind =
  | "all_founders" | "all_investors" | "all_consortium_partners" | "all_admins"
  | "cap_table_members" | "founders_of_company" | "investors_by_industry"
  | "investors_by_region" | "investors_by_industry_and_region"
  | "companies_by_industry" | "companies_by_region" | "specific_users";

interface EmailCampaign {
  id: string; name: string; description: string;
  audience: {
    kind: AudienceKind;
    companyId?: string;
    industries?: string[];
    regions?: string[];
    userIds?: string[];
  };
  content: {
    templateSlug: string | null;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    variables: Record<string, string>;
    replyTo: string | null;
  };
  scheduledAt: string | null; timezone: string; status: CampaignStatus;
  resolvedAudiencePreview: number; actualSentCount: number;
  testRecipients: string[]; testSentAt: string | null;
  sentAt: string | null; createdAt: string; updatedAt: string;
  version: number; prevRevisionHash: string; revisionHash: string;
}

interface EmailTemplate {
  id: string; slug: string; subject: string; bodyHtml: string;
  bodyText: string; variables: string[]; category: string;
}

interface RevisionEntry {
  version: number; action: string; updatedAt: string; updatedBy: string;
  prevRevisionHash: string; revisionHash: string;
}

const AUDIENCE_KINDS: AudienceKind[] = [
  "all_founders", "all_investors", "all_consortium_partners", "all_admins",
  "cap_table_members", "founders_of_company", "investors_by_industry",
  "investors_by_region", "investors_by_industry_and_region",
  "companies_by_industry", "companies_by_region", "specific_users",
];

const INDUSTRIES = [
  "fintech", "healthtech", "edtech", "deeptech", "climate", "consumer",
  "enterprise_saas", "infrastructure", "marketplace", "gaming", "crypto", "biotech",
];

const REGIONS = ["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"];

/* ============================================================
 * Helpers
 * ============================================================ */

function UnsavedBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-2 text-xs text-amber-800 flex items-center gap-2 mb-4"
      data-testid="banner-unsaved-changes">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      You have unsaved changes.
    </div>
  );
}

/* ============================================================
 * Compose Tab
 * ============================================================ */

function ComposeTab({
  campaign, templates, onChange, onSave, isSaving, hasChanges,
}: {
  campaign: Partial<EmailCampaign>;
  templates: EmailTemplate[];
  onChange: (patch: Partial<EmailCampaign>) => void;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}) {
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const [livePreview, setLivePreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewDebounce = useRef<NodeJS.Timeout | null>(null);

  const content = campaign.content ?? {
    templateSlug: null, subject: "", bodyHtml: "", bodyText: "",
    variables: {}, replyTo: null,
  };
  const selectedTemplate = templates.find((t) => t.slug === content.templateSlug);

  // Debounced preview refresh
  useEffect(() => {
    if (previewDebounce.current) clearTimeout(previewDebounce.current);
    previewDebounce.current = setTimeout(async () => {
      if (!content.subject && !content.bodyHtml) return;
      setIsPreviewLoading(true);
      try {
        const res = await fetch("/api/admin/email/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slug: content.templateSlug ?? "__freeform__",
            subject: content.subject,
            bodyHtml: content.bodyHtml,
            variables: content.variables,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          setLivePreview({ subject: d.subject, html: d.bodyHtml, text: d.bodyText });
        }
      } finally {
        setIsPreviewLoading(false);
      }
    }, 600);
  }, [content.subject, content.bodyHtml, content.variables, content.templateSlug]);

  const handleContentChange = (patch: Partial<typeof content>) => {
    onChange({ content: { ...content, ...patch } });
  };

  return (
    <div className="space-y-4">
      <UnsavedBanner show={hasChanges} />

      {/* Name + Description */}
      <Card className="p-4 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign identity</div>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Campaign name *</span>
          <Input
            data-testid="input-campaign-name"
            value={campaign.name ?? ""}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-8 text-xs"
            placeholder="e.g. Q3 investor update"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Description</span>
          <Textarea
            data-testid="input-campaign-description"
            value={campaign.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value })}
            className="text-xs resize-none"
            rows={2}
            placeholder="Internal notes about this campaign…"
          />
        </label>
      </Card>

      {/* Content + Live Preview side-by-side */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Left: editor */}
        <div className="space-y-3">
          {/* Template picker */}
          <Card className="p-4 space-y-3">
            <div className="text-xs font-semibold">Template</div>
            <Select
              value={content.templateSlug ?? "freeform"}
              onValueChange={(v) =>
                handleContentChange({
                  templateSlug: v === "freeform" ? null : v,
                  // Pre-fill subject from template
                  subject: v !== "freeform"
                    ? (templates.find((t) => t.slug === v)?.subject ?? content.subject)
                    : content.subject,
                })
              }
            >
              <SelectTrigger className="h-8 text-xs" data-testid="select-template">
                <SelectValue placeholder="Select template or freeform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="freeform">Custom (freeform)</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.slug} value={t.slug}>{t.slug} — {t.category}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedTemplate && (
              <div className="text-[10px] text-muted-foreground">
                Variables: {selectedTemplate.variables.join(", ")}
              </div>
            )}
          </Card>

          {/* Subject */}
          <Card className="p-4 space-y-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold">Subject line *</span>
              <Input
                data-testid="input-email-subject"
                value={content.subject}
                onChange={(e) => handleContentChange({ subject: e.target.value })}
                className="h-8 text-xs"
                placeholder="{{company_name}} — {{round_name}} invitation"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold">Reply-To</span>
              <Input
                data-testid="input-reply-to"
                value={content.replyTo ?? ""}
                onChange={(e) => handleContentChange({ replyTo: e.target.value || null })}
                className="h-8 text-xs"
                placeholder="replies@yourdomain.com"
              />
            </label>
          </Card>

          {/* HTML body */}
          <Card className="p-4 space-y-2">
            <div className="text-xs font-semibold">HTML Body</div>
            <Textarea
              data-testid="input-email-html"
              value={content.bodyHtml}
              onChange={(e) => handleContentChange({ bodyHtml: e.target.value })}
              className="font-mono text-xs resize-y"
              rows={10}
              placeholder="<p>Hi {{recipient_name}},</p>"
            />
          </Card>

          {/* Text body */}
          <Card className="p-4 space-y-2">
            <div className="text-xs font-semibold">Text Body <span className="text-muted-foreground font-normal">(fallback)</span></div>
            <Textarea
              data-testid="input-email-text"
              value={content.bodyText}
              onChange={(e) => handleContentChange({ bodyText: e.target.value })}
              className="text-xs resize-y"
              rows={4}
              placeholder="Plain-text version…"
            />
          </Card>

          {/* Variables */}
          <Card className="p-4 space-y-2">
            <div className="text-xs font-semibold">Variables</div>
            <div className="grid grid-cols-2 gap-2">
              {(selectedTemplate?.variables ?? Object.keys(content.variables)).map((v) => (
                <label key={v} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[10px] text-muted-foreground w-24 shrink-0">{v}</span>
                  <Input
                    data-testid={`input-var-${v}`}
                    value={content.variables[v] ?? ""}
                    onChange={(e) =>
                      handleContentChange({
                        variables: { ...content.variables, [v]: e.target.value },
                      })
                    }
                    className="h-6 text-xs px-2"
                  />
                </label>
              ))}
              {!selectedTemplate && (
                <div className="col-span-2 text-[10px] text-muted-foreground">
                  Use {"{{variable_name}}"} in HTML/subject to define variables.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right: live preview */}
        <div className="space-y-3">
          <Card className="p-4 h-full flex flex-col" data-testid="card-live-preview">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold flex items-center gap-2">
                <Eye className="h-3.5 w-3.5" />
                Live Preview
                {isPreviewLoading && <span className="text-muted-foreground text-[10px]">rendering…</span>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant={previewWidth === "desktop" ? "default" : "ghost"}
                  className="h-6 px-2 text-[10px]"
                  data-testid="button-preview-desktop"
                  onClick={() => setPreviewWidth("desktop")}>
                  <Monitor className="h-3 w-3 mr-1" />Desktop
                </Button>
                <Button size="sm" variant={previewWidth === "mobile" ? "default" : "ghost"}
                  className="h-6 px-2 text-[10px]"
                  data-testid="button-preview-mobile"
                  onClick={() => setPreviewWidth("mobile")}>
                  <Smartphone className="h-3 w-3 mr-1" />Mobile
                </Button>
              </div>
            </div>

            {livePreview ? (
              <div className={`flex-1 overflow-auto transition-all ${previewWidth === "mobile" ? "max-w-[375px] mx-auto" : "w-full"}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Subject</div>
                <div className="text-sm font-medium mb-3 border-b border-border pb-2"
                  data-testid="text-live-preview-subject">
                  {livePreview.subject}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Body</div>
                <iframe
                  data-testid="iframe-live-preview"
                  srcDoc={livePreview.html}
                  className="w-full border border-border rounded min-h-[300px]"
                  sandbox="allow-same-origin"
                  title="Email preview"
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                Start typing to see a live preview.
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={onSave} disabled={isSaving}
          data-testid="button-save-draft">
          <Save className="h-3.5 w-3.5 mr-1" />
          {isSaving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * Audience Tab
 * ============================================================ */

function AudienceTab({
  campaign, onChange, onSave, isSaving, hasChanges,
}: {
  campaign: Partial<EmailCampaign>;
  onChange: (patch: Partial<EmailCampaign>) => void;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}) {
  const [audiencePreview, setAudiencePreview] = useState<{ totalMatches: number; resolvedEmailCount: number } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const audience = campaign.audience ?? { kind: "all_founders" as AudienceKind };

  const handleAudienceChange = (patch: Partial<typeof audience>) => {
    onChange({ audience: { ...audience, ...patch } });
  };

  const fetchPreview = async () => {
    setIsPreviewLoading(true);
    try {
      const res = await fetch("/api/admin/email-campaigns/audience-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience }),
      });
      if (res.ok) {
        const d = await res.json();
        setAudiencePreview({ totalMatches: d.preview?.totalMatches ?? 0, resolvedEmailCount: d.resolvedEmailCount ?? 0 });
      }
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const needsCompany = ["cap_table_members", "founders_of_company"].includes(audience.kind);
  const needsIndustry = ["investors_by_industry", "investors_by_industry_and_region", "companies_by_industry"].includes(audience.kind);
  const needsRegion = ["investors_by_region", "investors_by_industry_and_region", "companies_by_region"].includes(audience.kind);
  const needsUserIds = audience.kind === "specific_users";

  return (
    <div className="space-y-4 max-w-2xl">
      <UnsavedBanner show={hasChanges} />

      <Card className="p-4 space-y-4">
        <div className="text-xs font-semibold">Audience targeting</div>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Audience kind *</span>
          <Select value={audience.kind} onValueChange={(v) => handleAudienceChange({ kind: v as AudienceKind })}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-audience-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {needsCompany && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">Company ID</span>
            <Input
              data-testid="input-audience-company-id"
              value={audience.companyId ?? ""}
              onChange={(e) => handleAudienceChange({ companyId: e.target.value })}
              className="h-8 text-xs"
              placeholder="e.g. co_<id>"
            />
          </label>
        )}

        {needsIndustry && (
          <div className="space-y-1">
            <span className="text-xs font-medium">Industries</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {INDUSTRIES.map((ind) => {
                const selected = (audience.industries ?? []).includes(ind);
                return (
                  <button
                    key={ind}
                    type="button"
                    data-testid={`button-industry-${ind}`}
                    onClick={() => {
                      const current = audience.industries ?? [];
                      handleAudienceChange({
                        industries: selected ? current.filter((x) => x !== ind) : [...current, ind],
                      });
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    {ind}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {needsRegion && (
          <div className="space-y-1">
            <span className="text-xs font-medium">Regions</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {REGIONS.map((r) => {
                const selected = (audience.regions ?? []).includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    data-testid={`button-region-${r}`}
                    onClick={() => {
                      const current = audience.regions ?? [];
                      handleAudienceChange({
                        regions: selected ? current.filter((x) => x !== r) : [...current, r],
                      });
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {needsUserIds && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">User IDs (one per line)</span>
            <Textarea
              data-testid="input-audience-user-ids"
              value={(audience.userIds ?? []).join("\n")}
              onChange={(e) =>
                handleAudienceChange({
                  userIds: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                })
              }
              className="text-xs font-mono resize-none"
              rows={4}
              placeholder="u_user1&#10;u_user2"
            />
          </label>
        )}

        <Button size="sm" variant="outline" onClick={fetchPreview} disabled={isPreviewLoading}
          data-testid="button-preview-audience">
          <Users className="h-3.5 w-3.5 mr-1" />
          {isPreviewLoading ? "Loading…" : "Preview audience"}
        </Button>

        {audiencePreview && (
          <div className="bg-muted/40 rounded p-3 text-xs space-y-1" data-testid="card-audience-preview">
            <div className="font-semibold">{audiencePreview.totalMatches} matched</div>
            <div className="text-muted-foreground">{audiencePreview.resolvedEmailCount} email addresses resolved</div>
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={onSave} disabled={isSaving} data-testid="button-save-audience">
          <Save className="h-3.5 w-3.5 mr-1" />{isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * Schedule Tab
 * ============================================================ */

function ScheduleTab({
  campaign, campaignId, onSave, isSaving, hasChanges, onSent,
}: {
  campaign: Partial<EmailCampaign>;
  campaignId: string | null;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [sendMode, setSendMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [testEmails, setTestEmails] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  const isTerminal = campaign.status === "sent" || campaign.status === "canceled" || campaign.status === "sending";

  const testSendMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error("Campaign not saved yet");
      const recipients = testEmails.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
      if (recipients.length === 0) throw new Error("No recipients");
      const res = await fetch(`/api/admin/email-campaigns/${campaignId}/test-send`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
        body: JSON.stringify({ recipients }),
      });
      return res.json();
    },
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: `Test send queued for ${d.enqueued} recipients.` });
        qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns", campaignId] });
      } else {
        toast({ title: "Test send failed", description: d.error, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error("Campaign not saved yet");
      if (isSaving) await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(`/api/admin/email-campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
        body: JSON.stringify({ scheduledAt, timezone }),
      });
      return res.json();
    },
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: "Campaign scheduled." });
        qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns", campaignId] });
        onSent();
      } else {
        toast({ title: "Schedule failed", description: d.error, variant: "destructive" });
      }
    },
  });

  const sendNowMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error("Campaign not saved yet");
      const res = await fetch(`/api/admin/email-campaigns/${campaignId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
        body: JSON.stringify({ confirmName }),
      });
      return res.json();
    },
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: `Campaign sent to ${d.campaign?.actualSentCount ?? 0} recipients.` });
        qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns", campaignId] });
        setShowSendConfirm(false);
        onSent();
      } else {
        toast({ title: "Send failed", description: d.error ?? JSON.stringify(d), variant: "destructive" });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error("Campaign not saved yet");
      const res = await fetch(`/api/admin/email-campaigns/${campaignId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-confirm": "true" },
        body: JSON.stringify({}),
      });
      return res.json();
    },
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: "Campaign canceled." });
        qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns", campaignId] });
        onSent();
      } else {
        toast({ title: "Cancel failed", description: d.error, variant: "destructive" });
      }
    },
  });

  return (
    <div className="space-y-4 max-w-xl">
      <UnsavedBanner show={hasChanges} />

      {/* Status */}
      {campaign.status && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          Status: <span className="font-semibold text-foreground capitalize">{campaign.status}</span>
          {campaign.sentAt && <span>· Sent {new Date(campaign.sentAt).toLocaleString()}</span>}
        </div>
      )}

      {!isTerminal && (
        <>
          {/* Test send */}
          <Card className="p-4 space-y-3">
            <div className="text-xs font-semibold">Test send</div>
            <Textarea
              data-testid="input-test-emails"
              value={testEmails}
              onChange={(e) => setTestEmails(e.target.value)}
              className="text-xs font-mono resize-none"
              rows={3}
              placeholder="test@example.com&#10;another@example.com&#10;(max 5)"
            />
            {campaign.testSentAt && (
              <div className="text-[10px] text-muted-foreground">
                Last test: {new Date(campaign.testSentAt).toLocaleString()}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => testSendMutation.mutate()}
              disabled={testSendMutation.isPending || !campaignId}
              data-testid="button-test-send">
              <Send className="h-3.5 w-3.5 mr-1" />
              {testSendMutation.isPending ? "Sending…" : "Send test"}
            </Button>
          </Card>

          {/* Schedule mode toggle */}
          <Card className="p-4 space-y-3">
            <div className="text-xs font-semibold">Delivery</div>
            <div className="flex gap-2">
              <Button size="sm" variant={sendMode === "now" ? "default" : "outline"}
                data-testid="button-send-mode-now"
                onClick={() => setSendMode("now")}>
                Send now
              </Button>
              <Button size="sm" variant={sendMode === "scheduled" ? "default" : "outline"}
                data-testid="button-send-mode-scheduled"
                onClick={() => setSendMode("scheduled")}>
                <Clock className="h-3.5 w-3.5 mr-1" />Schedule for later
              </Button>
            </div>

            {sendMode === "scheduled" && (
              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Scheduled at (ISO)</span>
                  <Input
                    data-testid="input-scheduled-at"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="2026-12-01T09:00:00.000Z"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Timezone</span>
                  <Input
                    data-testid="input-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="America/New_York"
                  />
                </label>
                <Button size="sm" onClick={() => scheduleMutation.mutate()}
                  disabled={scheduleMutation.isPending || !scheduledAt}
                  data-testid="button-schedule-campaign">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  {scheduleMutation.isPending ? "Scheduling…" : "Schedule campaign"}
                </Button>
              </div>
            )}

            {sendMode === "now" && !showSendConfirm && (
              <Button size="sm" variant="destructive"
                data-testid="button-send-now-initiate"
                onClick={() => { setConfirmName(""); setShowSendConfirm(true); }}
                disabled={!campaignId}>
                <Send className="h-3.5 w-3.5 mr-1" />Send now
              </Button>
            )}

            {sendMode === "now" && showSendConfirm && (
              <div className="bg-rose-50 border border-rose-200 rounded-md p-3 space-y-2" data-testid="card-send-confirm">
                <div className="text-xs font-semibold text-rose-800">Confirm send</div>
                <div className="text-xs text-rose-700">
                  Type <span className="font-mono font-semibold">{campaign.name}</span> exactly to confirm.
                </div>
                <Input
                  data-testid="input-confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Campaign name…"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive"
                    data-testid="button-send-now-confirm"
                    disabled={confirmName !== campaign.name || sendNowMutation.isPending}
                    onClick={() => sendNowMutation.mutate()}>
                    {sendNowMutation.isPending ? "Sending…" : "Confirm send"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowSendConfirm(false)}
                    data-testid="button-send-now-cancel">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Cancel */}
          {(campaign.status === "draft" || campaign.status === "scheduled") && (
            <Card className="p-4 space-y-2">
              <div className="text-xs font-semibold text-rose-700">Danger zone</div>
              <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50"
                data-testid="button-cancel-campaign"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? "Canceling…" : "Cancel campaign"}
              </Button>
            </Card>
          )}
        </>
      )}

      {isTerminal && (
        <Card className="p-4 text-xs text-muted-foreground">
          This campaign is in terminal state ({campaign.status}) and cannot be modified.
          {campaign.actualSentCount != null && (
            <div className="mt-1 font-medium text-foreground">
              Total sent: {campaign.actualSentCount}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ============================================================
 * History Tab
 * ============================================================ */

function HistoryTab({ campaignId }: { campaignId: string | null }) {
  const { data } = useQuery<{
    ok: boolean; campaignId: string;
    history: RevisionEntry[];
    chain: { ok: boolean; totalRevisions: number; brokenAtVersion?: number };
  }>({
    queryKey: ["/api/admin/email-campaigns", campaignId, "history"],
    queryFn: async () => {
      if (!campaignId) return { ok: false, campaignId: "", history: [], chain: { ok: false, totalRevisions: 0 } };
      const res = await apiRequest("GET", `/api/admin/email-campaigns/${campaignId}/history`);
      return res.json();
    },
    enabled: !!campaignId,
  });

  const chain = data?.chain;
  const history = data?.history ?? [];

  return (
    <div className="space-y-4">
      {chain && (
        <div className={`rounded-md px-4 py-2 text-xs flex items-center gap-2 ${chain.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-rose-50 border border-rose-200 text-rose-800"}`}
          data-testid="banner-chain-verify">
          {chain.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          Hash chain {chain.ok ? "verified" : `broken at version ${chain.brokenAtVersion}`}
          {" · "}{chain.totalRevisions} revisions
        </div>
      )}

      {!campaignId ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">Save the campaign first to see history.</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left">Ver.</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">By</th>
                <th className="px-3 py-2 text-left">At</th>
                <th className="px-3 py-2 text-left">Hash</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.version} className="border-t border-border" data-testid={`row-history-${r.version}`}>
                  <td className="px-3 py-1.5 font-mono">v{r.version}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">{r.action}</td>
                  <td className="px-3 py-1.5">{r.updatedBy}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                    {r.revisionHash.slice(0, 16)}…
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">No history yet.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
 * Main Composer
 * ============================================================ */

export default function AdminEmailComposer() {
  const [, matchNew] = useRoute("/admin/email/new");
  const [matchEdit, params] = useRoute("/admin/email/:id");
  const campaignId = matchEdit ? params?.id ?? null : null;
  const isNew = !!matchNew;

  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [localState, setLocalState] = useState<Partial<EmailCampaign>>({
    name: "",
    description: "",
    audience: { kind: "all_founders" },
    content: {
      templateSlug: null, subject: "", bodyHtml: "", bodyText: "",
      variables: {}, replyTo: null,
    },
    timezone: "UTC",
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(campaignId);

  // Fetch templates
  const { data: tplData } = useQuery<{ templates: EmailTemplate[] }>({
    queryKey: ["/api/admin/email/templates"],
  });

  // Fetch existing campaign (edit mode)
  const { data: campaignData } = useQuery<{ ok: boolean; campaign: EmailCampaign }>({
    queryKey: ["/api/admin/email-campaigns", savedId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/email-campaigns/${savedId}`);
      return res.json();
    },
    enabled: !!savedId,
  });

  // Sync server state to local
  useEffect(() => {
    if (campaignData?.campaign && !hasChanges) {
      setLocalState(campaignData.campaign);
    }
  }, [campaignData?.campaign]);

  const handleChange = (patch: Partial<EmailCampaign>) => {
    setLocalState((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  };

  // Create or update
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: localState.name,
        description: localState.description ?? "",
        audience: localState.audience,
        content: localState.content,
        timezone: localState.timezone ?? "UTC",
      };
      if (savedId) {
        // PATCH
        const res = await fetch(`/api/admin/email-campaigns/${savedId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-confirm": "true" },
          body: JSON.stringify(body),
        });
        return res.json();
      } else {
        // POST
        const res = await fetch("/api/admin/email-campaigns", {
          method: "POST",
          headers: { "content-type": "application/json", "x-confirm": "true" },
          body: JSON.stringify(body),
        });
        return res.json();
      }
    },
    onSuccess: (d) => {
      if (d.ok) {
        toast({ description: savedId ? "Draft saved." : "Campaign created." });
        if (!savedId) {
          setSavedId(d.campaign.id);
          navigate(`/admin/email/${d.campaign.id}`);
        }
        setHasChanges(false);
        qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns"] });
        if (savedId) {
          qc.invalidateQueries({ queryKey: ["/api/admin/email-campaigns", savedId] });
        }
      } else {
        toast({ title: "Save failed", description: d.error, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const effectiveCampaignId = savedId ?? campaignId;
  const campaign = { ...localState, ...(campaignData?.campaign ?? {}) };

  return (
    <>
      <PageHeader
        title={isNew ? "New email campaign" : (localState.name || "Email campaign")}
        description={effectiveCampaignId ? `ID: ${effectiveCampaignId} · v${(campaignData?.campaign?.version ?? localState.version) ?? "—"}` : "New draft"}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/admin/email")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-back-to-email"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        }
      />
      <PageBody>
        <Tabs defaultValue="compose">
          <TabsList className="mb-4">
            <TabsTrigger value="compose" data-testid="tab-compose">
              <Mail className="h-3.5 w-3.5 mr-1.5" />Compose
            </TabsTrigger>
            <TabsTrigger value="audience" data-testid="tab-audience">
              <Users className="h-3.5 w-3.5 mr-1.5" />Audience
            </TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">
              <Clock className="h-3.5 w-3.5 mr-1.5" />Schedule
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-3.5 w-3.5 mr-1.5" />History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose">
            <ComposeTab
              campaign={localState}
              templates={tplData?.templates ?? []}
              onChange={handleChange}
              onSave={() => saveMutation.mutate()}
              isSaving={saveMutation.isPending}
              hasChanges={hasChanges}
            />
          </TabsContent>

          <TabsContent value="audience">
            <AudienceTab
              campaign={localState}
              onChange={handleChange}
              onSave={() => saveMutation.mutate()}
              isSaving={saveMutation.isPending}
              hasChanges={hasChanges}
            />
          </TabsContent>

          <TabsContent value="schedule">
            <ScheduleTab
              campaign={{ ...campaign, ...localState }}
              campaignId={effectiveCampaignId}
              onSave={() => saveMutation.mutate()}
              isSaving={saveMutation.isPending}
              hasChanges={hasChanges}
              onSent={() => navigate("/admin/email")}
            />
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab campaignId={effectiveCampaignId} />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
