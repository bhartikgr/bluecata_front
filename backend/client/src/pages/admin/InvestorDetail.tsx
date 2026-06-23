/**
 * Sprint 28 Wave 4 — Admin Contact CRM Editor
 *
 * Replaces the 189-line legacy InvestorDetail with a full CRM editor.
 *
 * Tabs:
 *   Overview | Investor Profile* | Founder Links* | Partner Settings* | Tags & Notes | History
 *   (* shown only for the relevant kind)
 *
 * Every Save requires explicit confirmation dialog (double-verify).
 * Hash chain and revision history displayed in History tab.
 */

import { useState, useEffect } from "react";
import { fromMinor, toMinor } from "@/lib/currency"; /* v25.38 currency sweep */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  PageBody,
  PageHeader,
} from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldOff,
  Archive,
  RotateCcw,
  Save,
  X,
  Hash,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
} from "lucide-react";

/* ============================================================
 * Types
 * ============================================================ */

type ContactKind = "investor" | "founder" | "consortium_partner";
type ContactType =
  | "institutional"
  | "family_office"
  | "angel"
  | "syndicate"
  | "founder"
  | "partner_org";
type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
type ContactStatus = "active" | "inactive" | "suspended" | "archived";

interface AdminContact {
  id: string;
  kind: ContactKind;
  legalName: string;
  displayName: string;
  email: string;
  type: ContactType;
  status: ContactStatus;
  verification: VerificationStatus;
  hqCity: string;
  hqCountry: string;
  region: string;
  aumMinor: number | null;
  aumCurrency: string;
  checkSizeMinMinor: number | null;
  checkSizeMaxMinor: number | null;
  industries: string[];
  stages: string[];
  companyIds: string[];
  partnerWeight: number | null;
  partnerSince: string | null;
  phone: string | null;
  website: string | null;
  linkedinUrl: string | null;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  revisionHash: string;
  prevRevisionHash: string;
}

interface ContactRevision {
  contactId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  action: string;
}

interface ChainResult {
  ok: boolean;
  brokenAtVersion?: number;
  totalRevisions: number;
}

/* ============================================================
 * Helpers
 * ============================================================ */

function formatMinorUsd(minor: number | null, currency = "USD"): string {
  if (minor == null) return "";
  return String(minor / 100);
}

// v25.38 round-2 (per Opus): the parse partner of `fromMinor` must scale by the
// SAME currency exponent the display side used, or edit round-trips silently
// inflate the value 100x for non-2-decimal currencies (e.g. JPY/KRW where the
// display divides by 1 but the legacy parse multiplied by 100). Hardcoded
// `* 100` here was a v25.38 regression introduced when the display moved to
// `fromMinor`; this restores the v25.37 round-trip invariant for USD and
// extends correctness to JPY/KRW/BHD/etc. via the shared ISO-4217 helper.
function parseToMinor(val: string, currency: string = "USD"): number | null {
  const n = parseFloat(val.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return null;
  return toMinor(n, currency);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function VerificationBadge({ v }: { v: VerificationStatus }) {
  const map: Record<VerificationStatus, { label: string; className: string }> = {
    verified: { label: "Verified", className: "bg-emerald-100 text-emerald-900 border-0" },
    pending: { label: "Pending", className: "bg-amber-100 text-amber-900 border-0" },
    unverified: { label: "Unverified", className: "bg-muted text-muted-foreground" },
    rejected: { label: "Rejected", className: "bg-red-100 text-red-900 border-0" },
  };
  const { label, className } = map[v] ?? map.unverified;
  return <Badge className={`${className}`}>{label}</Badge>;
}

function StatusBadge({ s }: { s: ContactStatus }) {
  const map: Record<ContactStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-50 text-emerald-800 border-0" },
    inactive: { label: "Inactive", className: "bg-muted text-muted-foreground" },
    suspended: { label: "Suspended", className: "bg-orange-100 text-orange-900 border-0" },
    archived: { label: "Archived", className: "bg-muted text-muted-foreground/60" },
  };
  const { label, className } = map[s] ?? map.inactive;
  return <Badge className={`${className}`}>{label}</Badge>;
}

function KindBadge({ kind }: { kind: ContactKind }) {
  const labels: Record<ContactKind, string> = {
    investor: "Investor",
    founder: "Founder",
    consortium_partner: "Consortium Partner",
  };
  return <Badge variant="outline">{labels[kind]}</Badge>;
}

/* ============================================================
 * Tag chip input
 * ============================================================ */

function TagInput({
  tags,
  onChange,
  testId,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  testId?: string;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      onChange([...tags, t]);
    }
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-secondary text-foreground"
            data-testid={`tag-chip-${tag}`}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="hover:text-destructive"
              data-testid={`btn-remove-tag-${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          data-testid={testId ?? "input-tag"}
          className="h-8 text-sm"
          placeholder="Add tag…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={addTag} data-testid="btn-add-tag">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * Multi-select chip input (industries, stages)
 * ============================================================ */

function ChipSelectInput({
  label,
  items,
  options,
  onChange,
  testId,
}: {
  label: string;
  items: string[];
  options: string[];
  onChange: (items: string[]) => void;
  testId?: string;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]"
            data-testid={`chip-${label.toLowerCase().replace(/\s/g, "-")}-${item}`}
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(items.filter((i) => i !== item))}
              className="hover:opacity-70"
              data-testid={`btn-remove-chip-${item}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Select
          value={input}
          onValueChange={(v) => {
            if (v && !items.includes(v)) {
              onChange([...items, v]);
            }
            setInput("");
          }}
        >
          <SelectTrigger className="h-8 text-sm" data-testid={testId ?? `select-${label.toLowerCase()}`}>
            <SelectValue placeholder={`Add ${label.toLowerCase()}…`} />
          </SelectTrigger>
          <SelectContent>
            {options.filter((o) => !items.includes(o)).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

const INDUSTRY_OPTIONS = [
  "fintech", "ai", "saas", "b2b-saas", "consumer", "crypto", "biotech",
  "healthtech", "medtech", "climate", "energy", "deeptech", "robotics",
  "logistics", "infrastructure", "marketplace", "enterprise-saas",
];

const STAGE_OPTIONS = [
  "pre-seed", "seed", "series_a", "series_b", "series_c", "growth", "late-stage",
];

const REGION_OPTIONS = ["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"];

/* ============================================================
 * Quick action button
 * ============================================================ */

function ActionButton({
  label,
  icon: Icon,
  onClick,
  variant = "outline",
  testId,
  disabled,
}: {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  variant?: "outline" | "default" | "destructive";
  testId: string;
  disabled?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      className="gap-1.5"
      onClick={onClick}
      data-testid={testId}
      disabled={disabled}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

/* ============================================================
 * Main component
 * ============================================================ */

export default function AdminInvestorDetail() {
  const [, params] = useRoute("/admin/investors/:id");
  const id = params?.id;
  const { toast } = useToast();

  // ── Server state ─────────────────────────────────────────
  const contactQuery = useQuery<{ ok: boolean; contact: AdminContact }>({
    queryKey: ["/api/admin/contacts", id],
    queryFn: () => apiRequest("GET", `/api/admin/contacts/${id}`).then((r) => r.json()),
    enabled: !!id,
  });

  const historyQuery = useQuery<{
    ok: boolean;
    history: ContactRevision[];
    chain: ChainResult;
  }>({
    queryKey: ["/api/admin/contacts", id, "history"],
    queryFn: () => apiRequest("GET", `/api/admin/contacts/${id}/history`).then((r) => r.json()),
    enabled: !!id,
  });

  const contact = contactQuery.data?.contact;

  // ── Local edit state ─────────────────────────────────────
  const [draft, setDraft] = useState<Partial<AdminContact>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<null | "verify" | "suspend" | "archive" | "restore">(null);
  const [suspendReason, setSuspendReason] = useState("");

  // Sync draft when contact loads
  useEffect(() => {
    if (contact) {
      setDraft({});
      setHasChanges(false);
    }
  }, [contact?.id, contact?.version]);

  function updateDraft(patch: Partial<AdminContact>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  }

  function discardChanges() {
    setDraft({});
    setHasChanges(false);
  }

  // Merged view (draft on top of server state)
  const merged = contact ? { ...contact, ...draft } : null;

  // Count dirty fields
  const dirtyCount = Object.keys(draft).length;

  // ── Mutations ────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!id || !draft) return;
      const res = await apiRequest("PATCH", `/api/admin/contacts/${id}`, draft, { "x-confirm": "true" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts", id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts/stats"] });
      toast({
        title: "Contact saved",
        description: `Updated to v${data?.contact?.version}. Audit log appended, bridge event emitted.`,
      });
      setDraft({});
      setHasChanges(false);
      setConfirmSaveOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: "Please try again. If this continues, contact support.", variant: "destructive" });
      setConfirmSaveOpen(false);
    },
  });

  function doAction(action: "verify" | "suspend" | "archive" | "restore") {
    if (!id) return;
    const endpoint = `/api/admin/contacts/${id}/${action}`;
    const body = action === "suspend" ? { reason: suspendReason } : {};
    apiRequest("POST", endpoint, body, { "x-confirm": "true" })
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json();
          throw new Error(b.error ?? `${action} failed`);
        }
        return res.json();
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts", id] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts", id, "history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts/stats"] });
        toast({ title: `Contact ${action}d` });
        setActionDialog(null);
        setSuspendReason("");
      })
      .catch((err: Error) => {
        toast({ title: `Action failed`, description: "Please try again. If this continues, contact support.", variant: "destructive" });
        setActionDialog(null);
      });
  }

  // ── Loading / not found ──────────────────────────────────
  if (!id || contactQuery.isError) {
    return (
      <>
        <PageHeader title="Contact not found" breadcrumbs={[{ label: "Admin" }, { label: "Contacts CRM", href: "/admin/investors" }]} />
        <PageBody>
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              Contact not found or you don't have permission to view it.
            </CardContent>
          </Card>
        </PageBody>
      </>
    );
  }

  if (contactQuery.isLoading || !merged) {
    return (
      <>
        <PageHeader title="Loading…" breadcrumbs={[{ label: "Admin" }, { label: "Contacts CRM", href: "/admin/investors" }]} />
        <PageBody>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={merged.legalName}
        description={`${merged.kind.replace("_", " ")} · ${merged.type.replace("_", " ")} · ${merged.region} · v${merged.version}`}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Contacts CRM", href: "/admin/investors" },
          { label: merged.legalName },
        ]}
        actions={
          <Link
            href="/admin/investors"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid="link-back-contacts"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Contacts CRM
          </Link>
        }
      />

      <PageBody>
        {/* ── Unsaved-changes banner ────────────────────────── */}
        {hasChanges && (
          <div
            className="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg"
            data-testid="banner-unsaved-changes"
          >
            <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-sm text-amber-900 flex-1">
              <strong>{dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}.</strong> Saving will bump to v
              {merged.version + 1}, extend the hash chain, append audit, and emit bridge event.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100"
              onClick={discardChanges}
              data-testid="btn-discard-changes"
            >
              <X className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => setConfirmSaveOpen(true)}
              data-testid="btn-save-changes"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────── */}
        <Tabs defaultValue="overview">
          <TabsList className="mb-5" data-testid="tabs-contact-detail">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            {merged.kind === "investor" && (
              <TabsTrigger value="investor_profile" data-testid="tab-investor-profile">
                Investor Profile
              </TabsTrigger>
            )}
            {merged.kind === "founder" && (
              <TabsTrigger value="founder_links" data-testid="tab-founder-links">
                Founder Links
              </TabsTrigger>
            )}
            {merged.kind === "consortium_partner" && (
              <TabsTrigger value="partner_settings" data-testid="tab-partner-settings">
                Partner Settings
              </TabsTrigger>
            )}
            <TabsTrigger value="tags_notes" data-testid="tab-tags-notes">Tags & Notes</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          {/* ── Overview tab ─────────────────────────────── */}
          <TabsContent value="overview">
            <div className="grid lg:grid-cols-2 gap-5">
              {/* Identity card */}
              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="bg-[hsl(184_98%_22%)]/15 text-[hsl(184_98%_22%)] font-semibold text-base">
                        {initials(merged.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold mb-1">{merged.legalName}</div>
                      <div className="text-xs text-muted-foreground mb-2">{merged.email}</div>
                      <div className="flex flex-wrap gap-2">
                        <KindBadge kind={merged.kind} />
                        <StatusBadge s={merged.status} />
                        <VerificationBadge v={merged.verification} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm pt-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Display name</div>
                      <Input
                        data-testid="input-displayname"
                        className="h-8 mt-1 text-sm"
                        value={merged.displayName}
                        onChange={(e) => updateDraft({ displayName: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Email</div>
                      <Input
                        data-testid="input-email"
                        type="email"
                        className="h-8 mt-1 text-sm"
                        value={merged.email}
                        onChange={(e) => updateDraft({ email: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Phone</div>
                      <Input
                        data-testid="input-phone"
                        className="h-8 mt-1 text-sm"
                        value={merged.phone ?? ""}
                        onChange={(e) => updateDraft({ phone: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Website</div>
                      <Input
                        data-testid="input-website"
                        className="h-8 mt-1 text-sm"
                        value={merged.website ?? ""}
                        onChange={(e) => updateDraft({ website: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">LinkedIn URL</div>
                      <Input
                        data-testid="input-linkedin"
                        className="h-8 mt-1 text-sm"
                        value={merged.linkedinUrl ?? ""}
                        onChange={(e) => updateDraft({ linkedinUrl: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <Select
                        value={merged.status}
                        onValueChange={(v) => updateDraft({ status: v as ContactStatus })}
                      >
                        <SelectTrigger className="h-8 mt-1 text-sm" data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Geography card */}
              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div className="text-sm font-semibold">Geography</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">HQ City</div>
                      <Input
                        data-testid="input-hqcity"
                        className="h-8 mt-1 text-sm"
                        value={merged.hqCity}
                        onChange={(e) => updateDraft({ hqCity: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">HQ Country (ISO)</div>
                      <Input
                        data-testid="input-hqcountry"
                        className="h-8 mt-1 text-sm"
                        placeholder="US"
                        maxLength={2}
                        value={merged.hqCountry}
                        onChange={(e) => updateDraft({ hqCountry: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Region</div>
                      <Select
                        value={merged.region}
                        onValueChange={(v) => updateDraft({ region: v })}
                      >
                        <SelectTrigger className="h-8 mt-1 text-sm" data-testid="select-region">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REGION_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="pt-4 border-t border-border/60">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                      Quick Actions
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        label="Verify"
                        icon={ShieldCheck}
                        onClick={() => setActionDialog("verify")}
                        testId="btn-action-verify"
                        disabled={merged.verification === "verified"}
                      />
                      <ActionButton
                        label="Suspend"
                        icon={ShieldOff}
                        onClick={() => setActionDialog("suspend")}
                        testId="btn-action-suspend"
                        disabled={merged.status === "suspended"}
                      />
                      {merged.status !== "archived" ? (
                        <ActionButton
                          label="Archive"
                          icon={Archive}
                          onClick={() => setActionDialog("archive")}
                          testId="btn-action-archive"
                        />
                      ) : (
                        <ActionButton
                          label="Restore"
                          icon={RotateCcw}
                          onClick={() => setActionDialog("restore")}
                          testId="btn-action-restore"
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Investor Profile tab ──────────────────────── */}
          {merged.kind === "investor" && (
            <TabsContent value="investor_profile">
              <Card>
                <CardContent className="pt-5 space-y-6">
                  <div className="text-sm font-semibold">Investor Profile</div>
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">AUM (USD, whole dollars)</div>
                      <Input
                        data-testid="input-aum"
                        type="number"
                        className="h-8 mt-1 text-sm font-mono"
                        placeholder="e.g. 85000000000"
                        value={merged.aumMinor != null ? String(fromMinor(merged.aumMinor, merged.aumCurrency || "USD")) : ""}
                        onChange={(e) => updateDraft({ aumMinor: parseToMinor(e.target.value, merged.aumCurrency || "USD") })}
                      />
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Stored as integer minor units (cents). Enter whole dollars.
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Check Size Min (USD)</div>
                      <Input
                        data-testid="input-check-min"
                        type="number"
                        className="h-8 mt-1 text-sm font-mono"
                        placeholder="e.g. 500000"
                        value={merged.checkSizeMinMinor != null ? String(fromMinor(merged.checkSizeMinMinor, merged.aumCurrency || "USD")) : ""}
                        onChange={(e) => updateDraft({ checkSizeMinMinor: parseToMinor(e.target.value, merged.aumCurrency || "USD") })}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Check Size Max (USD)</div>
                      <Input
                        data-testid="input-check-max"
                        type="number"
                        className="h-8 mt-1 text-sm font-mono"
                        placeholder="e.g. 20000000"
                        value={merged.checkSizeMaxMinor != null ? String(fromMinor(merged.checkSizeMaxMinor, merged.aumCurrency || "USD")) : ""}
                        onChange={(e) => updateDraft({ checkSizeMaxMinor: parseToMinor(e.target.value, merged.aumCurrency || "USD") })}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">AUM Currency (ISO 4217)</div>
                    <Input
                      data-testid="input-aum-currency"
                      className="h-8 w-24 text-sm font-mono"
                      maxLength={3}
                      value={merged.aumCurrency}
                      onChange={(e) => updateDraft({ aumCurrency: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <ChipSelectInput
                    label="Industries"
                    items={merged.industries}
                    options={INDUSTRY_OPTIONS}
                    onChange={(v) => updateDraft({ industries: v })}
                    testId="select-industries"
                  />
                  <ChipSelectInput
                    label="Stages"
                    items={merged.stages}
                    options={STAGE_OPTIONS}
                    onChange={(v) => updateDraft({ stages: v })}
                    testId="select-stages"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Founder Links tab ─────────────────────────── */}
          {merged.kind === "founder" && (
            <TabsContent value="founder_links">
              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div className="text-sm font-semibold">Linked Companies</div>
                  <div className="text-xs text-muted-foreground">
                    Company IDs linked to this founder account. Sourced from multiCompanyStore.
                  </div>
                  <div className="space-y-2">
                    {merged.companyIds.map((cid) => (
                      <div
                        key={cid}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-secondary/50"
                        data-testid={`row-company-${cid}`}
                      >
                        <span className="font-mono text-xs text-[hsl(184_98%_22%)]">{cid}</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() =>
                            updateDraft({
                              companyIds: merged.companyIds.filter((c) => c !== cid),
                            })
                          }
                          className="text-muted-foreground hover:text-destructive"
                          data-testid={`btn-remove-company-${cid}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {merged.companyIds.length === 0 && (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        No companies linked yet.
                      </div>
                    )}
                  </div>
                  <AddCompanyLink
                    onAdd={(cid) => {
                      if (!merged.companyIds.includes(cid)) {
                        updateDraft({ companyIds: [...merged.companyIds, cid] });
                      }
                    }}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Partner Settings tab ──────────────────────── */}
          {merged.kind === "consortium_partner" && (
            <TabsContent value="partner_settings">
              <Card>
                <CardContent className="pt-5 space-y-6">
                  <div className="text-sm font-semibold">Partner Settings</div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Vouch Weight: <span className="font-mono font-semibold text-foreground" data-testid="text-partner-weight">{merged.partnerWeight ?? 0}</span>
                        <span className="ml-2 text-muted-foreground">(0 = no authority, 3 = full authority)</span>
                      </div>
                      <Slider
                        data-testid="slider-partner-weight"
                        min={0}
                        max={3}
                        step={1}
                        value={[merged.partnerWeight ?? 0]}
                        onValueChange={([v]) => updateDraft({ partnerWeight: v })}
                        className="w-64"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Partner Since (ISO date)</div>
                      <Input
                        data-testid="input-partner-since"
                        type="date"
                        className="h-8 w-48 text-sm"
                        value={merged.partnerSince ?? ""}
                        onChange={(e) => updateDraft({ partnerSince: e.target.value || null })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Tags & Notes tab ──────────────────────────── */}
          <TabsContent value="tags_notes">
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <div className="text-sm font-semibold">Tags</div>
                  <TagInput
                    tags={merged.tags}
                    onChange={(v) => updateDraft({ tags: v })}
                    testId="input-tag-new"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <div className="text-sm font-semibold">Notes (Markdown)</div>
                  <Textarea
                    data-testid="textarea-notes"
                    rows={10}
                    className="font-mono text-sm"
                    placeholder="Free-form notes in Markdown…"
                    value={merged.notes}
                    onChange={(e) => updateDraft({ notes: e.target.value })}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── History tab ───────────────────────────────── */}
          <TabsContent value="history">
            <div className="space-y-4">
              {/* Chain verify banner */}
              {historyQuery.data && (
                <div
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                    historyQuery.data.chain.ok
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-red-50 border-red-200"
                  }`}
                  data-testid="banner-chain-verify"
                >
                  {historyQuery.data.chain.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${historyQuery.data.chain.ok ? "text-emerald-900" : "text-red-900"}`}>
                    Hash chain{" "}
                    {historyQuery.data.chain.ok ? (
                      <strong>verified intact</strong>
                    ) : (
                      <strong>BROKEN at v{historyQuery.data.chain.brokenAtVersion}</strong>
                    )}{" "}
                    — {historyQuery.data.chain.totalRevisions} revision{historyQuery.data.chain.totalRevisions !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Current hash */}
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    Current revision
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Version</div>
                      <div className="font-mono tabular-nums" data-testid="text-version">v{merged.version}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last updated by</div>
                      <div className="font-mono">{merged.updatedBy}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-muted-foreground">Revision hash</div>
                      <div className="font-mono text-[10px] break-all" data-testid="text-revision-hash">
                        {merged.revisionHash}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-muted-foreground">Previous revision hash</div>
                      <div className="font-mono text-[10px] break-all" data-testid="text-prev-hash">
                        {merged.prevRevisionHash}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Revision list */}
              <Card>
                <CardContent className="px-0">
                  <div className="px-6 py-4 text-sm font-semibold border-b border-border/60">
                    Revision history
                  </div>
                  {historyQuery.isLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                  ) : (
                    <table className="w-full text-xs" data-testid="table-history">
                      <thead>
                        <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/50">
                          <th className="text-left font-medium px-6 py-2">Version</th>
                          <th className="text-left font-medium px-3 py-2">Action</th>
                          <th className="text-left font-medium px-3 py-2">By</th>
                          <th className="text-left font-medium px-3 py-2">At</th>
                          <th className="text-left font-medium px-3 py-2">Hash (8)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(historyQuery.data?.history ?? [])
                          .slice()
                          .reverse()
                          .map((rev) => (
                            <tr
                              key={rev.version}
                              className="border-b border-border/40"
                              data-testid={`row-revision-${rev.version}`}
                            >
                              <td className="px-6 py-2 font-mono">v{rev.version}</td>
                              <td className="px-3 py-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {rev.action}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{rev.updatedBy}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {new Date(rev.updatedAt).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">
                                {rev.revisionHash.slice(0, 8)}…
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </PageBody>

      {/* ── Save confirmation dialog ──────────────────────── */}
      <AlertDialog open={confirmSaveOpen} onOpenChange={setConfirmSaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Save Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to save <strong>{dirtyCount} change{dirtyCount !== 1 ? "s" : ""}</strong> to{" "}
              <strong>{merged.legalName}</strong>. This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Bump version from v{merged.version} to v{merged.version + 1}</li>
                <li>Extend the SHA-256 hash chain</li>
                <li>Append an entry to the admin audit log</li>
                <li>Emit a <code>contact.updated</code> bridge event</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-save-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-save-confirm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Confirm Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Action dialogs ─────────────────────────────────── */}
      <AlertDialog open={actionDialog === "verify"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verify Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Mark <strong>{merged.legalName}</strong> as verified. This will audit-log the action and emit
              a <code>contact.verified</code> bridge event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-verify-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-verify-confirm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => doAction("verify")}
            >
              Confirm Verify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={actionDialog === "suspend"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Suspend <strong>{merged.legalName}</strong>. Provide a reason for the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Input
              data-testid="input-suspend-reason"
              placeholder="Reason for suspension…"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-suspend-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-suspend-confirm"
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => doAction("suspend")}
            >
              Confirm Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={actionDialog === "archive"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Archive <strong>{merged.legalName}</strong> (soft delete). The contact can be restored.
              A <code>contact.archived</code> bridge event will be emitted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-archive-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-archive-confirm"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => doAction("archive")}
            >
              Confirm Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={actionDialog === "restore"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Restore <strong>{merged.legalName}</strong> from archived status to active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-restore-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-restore-confirm"
              onClick={() => doAction("restore")}
            >
              Confirm Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ============================================================
 * Helper sub-component: AddCompanyLink
 * ============================================================ */

function AddCompanyLink({ onAdd }: { onAdd: (cid: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="flex gap-2 pt-2">
      <Input
        data-testid="input-add-company"
        className="h-8 text-sm font-mono"
        placeholder="co_companyid…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            onAdd(input.trim());
            setInput("");
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          if (input.trim()) {
            onAdd(input.trim());
            setInput("");
          }
        }}
        data-testid="btn-add-company"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
