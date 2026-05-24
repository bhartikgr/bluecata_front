/**
 * Sprint 28 Wave 4 — Admin Contacts CRM
 *
 * Replaces the 60-line hardcoded mock with a production live-data CRM UI.
 * All data comes from /api/admin/contacts (adminContactsStore.ts).
 *
 * Features:
 *   - Stats bar (totals by kind/verification)
 *   - Tabs: All / Investors / Founders / Consortium Partners
 *   - Filters: search, status, verification, region, type, industry
 *   - Context-aware table columns per tab
 *   - + New Contact dialog (kind selector + required fields)
 *   - Bulk-select with bulk-verify / bulk-archive (each with confirm dialog)
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  PageBody,
  PageHeader,
} from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Archive,
  Users,
  TrendingUp,
  Building2,
  Handshake,
  AlertCircle,
  ChevronRight,
  Upload,
} from "lucide-react";

/* ============================================================
 * Types (mirrored from server)
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
  version: number;
}

interface ContactStats {
  total: number;
  byKind: { investor: number; founder: number; consortium_partner: number };
  byVerification: { verified: number; pending: number; unverified: number; rejected: number };
  byStatus: { active: number; inactive: number; suspended: number; archived: number };
  byRegion: Record<string, number>;
}

/* ============================================================
 * Helpers
 * ============================================================ */

function formatMinorUsd(minor: number | null, currency = "USD"): string {
  if (minor == null) return "—";
  const major = minor / 100;
  if (major >= 1_000_000_000) return `${(major / 1_000_000_000).toFixed(1)}B ${currency}`;
  if (major >= 1_000_000) return `${(major / 1_000_000).toFixed(1)}M ${currency}`;
  if (major >= 1_000) return `${(major / 1_000).toFixed(0)}K ${currency}`;
  return `${major.toLocaleString()} ${currency}`;
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
  return <Badge className={`text-[10px] ${className}`}>{label}</Badge>;
}

function StatusBadge({ s }: { s: ContactStatus }) {
  const map: Record<ContactStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-50 text-emerald-800 border-0" },
    inactive: { label: "Inactive", className: "bg-muted text-muted-foreground" },
    suspended: { label: "Suspended", className: "bg-orange-100 text-orange-900 border-0" },
    archived: { label: "Archived", className: "bg-muted text-muted-foreground/60" },
  };
  const { label, className } = map[s] ?? map.inactive;
  return <Badge className={`text-[10px] ${className}`}>{label}</Badge>;
}

function KindBadge({ kind }: { kind: ContactKind }) {
  const map: Record<ContactKind, { label: string; className: string }> = {
    investor: { label: "Investor", className: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]" },
    founder: { label: "Founder", className: "bg-[hsl(327_77%_30%)]/10 text-[hsl(327_77%_30%)]" },
    consortium_partner: { label: "Partner", className: "bg-violet-100 text-violet-900 border-0" },
  };
  const { label, className } = map[kind];
  return <Badge variant="outline" className={`text-[10px] ${className}`}>{label}</Badge>;
}

/* ============================================================
 * Stat card
 * ============================================================ */

function StatCard({
  label,
  value,
  icon: Icon,
  testId,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  testId: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accent ?? "bg-[hsl(184_98%_22%)]/10"}`}>
            <Icon className={`h-4 w-4 ${accent ? "text-white" : "text-[hsl(184_98%_22%)]"}`} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
            <div className="text-xl font-semibold tabular-nums" data-testid={testId}>
              {value}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * New Contact Dialog
 * ============================================================ */

interface NewContactDialogProps {
  open: boolean;
  onClose: () => void;
}

function NewContactDialog({ open, onClose }: NewContactDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    legalName: "",
    email: "",
    kind: "" as ContactKind | "",
    type: "" as ContactType | "",
    hqCity: "",
    hqCountry: "US",
    region: "US",
  });
  const [confirming, setConfirming] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      // First probe without confirm
      const probe = await apiRequest("POST", "/api/admin/contacts", data);
      const probeBody = await probe.json();
      if (probe.status === 409 && probeBody.error === "confirmation_required") {
        setConfirming(true);
        return null;
      }
      throw new Error(probeBody.error ?? "Create failed");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/contacts", data, { "x-confirm": "true" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Create failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts/stats"] });
      toast({ title: "Contact created", description: `${form.legalName} added to Contacts CRM.` });
      onClose();
      setForm({ legalName: "", email: "", kind: "", type: "", hqCity: "", hqCountry: "US", region: "US" });
      setConfirming(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error creating contact", description: err.message, variant: "destructive" });
    },
  });

  const typeOptions: Record<ContactKind, ContactType[]> = {
    investor: ["institutional", "family_office", "angel", "syndicate"],
    founder: ["founder"],
    consortium_partner: ["partner_org"],
  };

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Contact</DialogTitle>
            <DialogDescription>
              Add a new investor, founder, or consortium partner to the Contacts CRM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Legal Name *</label>
              <Input
                data-testid="input-new-legalname"
                placeholder="Company legal name"
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email *</label>
              <Input
                data-testid="input-new-email"
                type="email"
                placeholder="contact@firm.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Kind *</label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm({ ...form, kind: v as ContactKind, type: "" })}
                >
                  <SelectTrigger data-testid="select-new-kind">
                    <SelectValue placeholder="Select kind" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="investor">Investor</SelectItem>
                    <SelectItem value="founder">Founder</SelectItem>
                    <SelectItem value="consortium_partner">Consortium Partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type *</label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v as ContactType })}
                  disabled={!form.kind}
                >
                  <SelectTrigger data-testid="select-new-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(form.kind ? typeOptions[form.kind] : []).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">HQ City</label>
                <Input
                  data-testid="input-new-city"
                  placeholder="San Francisco"
                  value={form.hqCity}
                  onChange={(e) => setForm({ ...form, hqCity: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Region</label>
                <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                  <SelectTrigger data-testid="select-new-region">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} data-testid="btn-new-cancel">
              Cancel
            </Button>
            <Button
              data-testid="btn-new-submit"
              disabled={!form.legalName || !form.email || !form.kind || !form.type || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? "Checking…" : "Review & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={confirming} onOpenChange={(o) => { if (!o) setConfirming(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm: Create Contact</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to create a new {form.kind} contact: <strong>{form.legalName}</strong> ({form.email}).
              This action will be audit-logged and a bridge event will be emitted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirming(false)} data-testid="btn-confirm-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-confirm-apply"
              onClick={() => confirmMutation.mutate(form)}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? "Creating…" : "Confirm Create"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ============================================================
 * Contacts table
 * ============================================================ */

interface ContactsTableProps {
  contacts: AdminContact[];
  tab: string;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
}

function ContactsTable({ contacts, tab, selected, onToggleSelect, onToggleAll }: ContactsTableProps) {
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  return (
    <table className="w-full text-sm" data-testid={`table-contacts-${tab}`}>
      <thead>
        <tr className="text-xs uppercase text-muted-foreground border-b border-border">
          <th className="px-4 py-2.5 w-8">
            <Checkbox
              data-testid={`checkbox-select-all-${tab}`}
              checked={allSelected}
              onCheckedChange={() => onToggleAll(contacts.map((c) => c.id))}
            />
          </th>
          <th className="text-left font-medium px-4 py-2.5">Contact</th>
          {tab === "all" && <th className="text-left font-medium px-3 py-2.5">Kind</th>}
          <th className="text-left font-medium px-3 py-2.5">Type</th>
          <th className="text-left font-medium px-3 py-2.5">Region</th>
          <th className="text-left font-medium px-3 py-2.5">Status</th>
          <th className="text-left font-medium px-3 py-2.5">Verification</th>
          {tab === "investors" && (
            <>
              <th className="text-right font-medium px-3 py-2.5">AUM</th>
              <th className="text-right font-medium px-3 py-2.5">Check Size</th>
            </>
          )}
          {tab === "founders" && (
            <th className="text-right font-medium px-3 py-2.5">Companies</th>
          )}
          {tab === "consortium_partners" && (
            <>
              <th className="text-right font-medium px-3 py-2.5">Weight</th>
              <th className="text-right font-medium px-3 py-2.5">Partner Since</th>
            </>
          )}
          <th className="text-left font-medium px-3 py-2.5">Updated</th>
          <th className="px-3 py-2.5 w-8" />
        </tr>
      </thead>
      <tbody>
        {contacts.map((c) => (
          <tr
            key={c.id}
            className={`border-b border-border/60 hover:bg-secondary/40 transition-colors ${
              selected.has(c.id) ? "bg-secondary/20" : ""
            }`}
            data-testid={`row-contact-${c.id}`}
          >
            <td className="px-4 py-3">
              <Checkbox
                data-testid={`checkbox-contact-${c.id}`}
                checked={selected.has(c.id)}
                onCheckedChange={() => onToggleSelect(c.id)}
              />
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[hsl(184_98%_22%)]/15 text-[hsl(184_98%_22%)] text-xs font-semibold">
                    {initials(c.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium leading-tight">{c.legalName}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
              </div>
            </td>
            {tab === "all" && (
              <td className="px-3 py-3">
                <KindBadge kind={c.kind} />
              </td>
            )}
            <td className="px-3 py-3 text-muted-foreground capitalize">
              {c.type.replace("_", " ")}
            </td>
            <td className="px-3 py-3">
              <Badge variant="outline" className="text-[10px]">
                {c.region}
              </Badge>
            </td>
            <td className="px-3 py-3">
              <StatusBadge s={c.status} />
            </td>
            <td className="px-3 py-3">
              <VerificationBadge v={c.verification} />
            </td>
            {tab === "investors" && (
              <>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-xs">
                  {formatMinorUsd(c.aumMinor, c.aumCurrency)}
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-xs">
                  {c.checkSizeMinMinor != null
                    ? `${formatMinorUsd(c.checkSizeMinMinor)} – ${formatMinorUsd(c.checkSizeMaxMinor)}`
                    : "—"}
                </td>
              </>
            )}
            {tab === "founders" && (
              <td className="px-3 py-3 text-right font-mono tabular-nums" data-testid={`text-companies-${c.id}`}>
                {c.companyIds.length}
              </td>
            )}
            {tab === "consortium_partners" && (
              <>
                <td className="px-3 py-3 text-right font-mono tabular-nums" data-testid={`text-weight-${c.id}`}>
                  {c.partnerWeight ?? "—"}
                </td>
                <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                  {c.partnerSince ?? "—"}
                </td>
              </>
            )}
            <td className="px-3 py-3 text-xs text-muted-foreground">
              {new Date(c.updatedAt).toLocaleDateString()}
            </td>
            <td className="px-3 py-3">
              <Link
                href={`/admin/investors/${c.id}`}
                data-testid={`link-detail-${c.id}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </td>
          </tr>
        ))}
        {contacts.length === 0 && (
          <tr>
            <td colSpan={99} className="px-6 py-12 text-center text-sm text-muted-foreground">
              No contacts match your filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/* ============================================================
 * Main page
 * ============================================================ */

export default function AdminInvestors() {
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");

  // Tab
  const [activeTab, setActiveTab] = useState<"all" | "investors" | "founders" | "consortium_partners">("all");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dialogs
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [bulkVerifyOpen, setBulkVerifyOpen] = useState(false);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────
  const statsQuery = useQuery<ContactStats>({
    queryKey: ["/api/admin/contacts/stats"],
    queryFn: () => apiRequest("GET", "/api/admin/contacts/stats").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const contactsQuery = useQuery<{ total: number; contacts: AdminContact[] }>({
    queryKey: [
      "/api/admin/contacts",
      activeTab === "all" ? undefined : activeTab === "consortium_partners" ? "consortium_partner" : activeTab.slice(0, -1),
      statusFilter !== "all" ? statusFilter : undefined,
      verificationFilter !== "all" ? verificationFilter : undefined,
      regionFilter !== "all" ? regionFilter : undefined,
      search || undefined,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeTab !== "all") {
        const k = activeTab === "consortium_partners" ? "consortium_partner" : activeTab.slice(0, -1);
        params.set("kind", k);
      }
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (verificationFilter !== "all") params.set("verification", verificationFilter);
      if (regionFilter !== "all") params.set("region", regionFilter);
      if (search) params.set("search", search);
      return apiRequest("GET", `/api/admin/contacts?${params}`).then((r) => r.json());
    },
  });

  const contacts = contactsQuery.data?.contacts ?? [];
  const stats = statsQuery.data;

  // ── Bulk mutations ────────────────────────────────────────
  const bulkVerifyMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          apiRequest("POST", `/api/admin/contacts/${id}/verify`, {}, { "x-confirm": "true" })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts/stats"] });
      toast({ title: `${selected.size} contact(s) verified` });
      setSelected(new Set());
      setBulkVerifyOpen(false);
    },
    onError: () => {
      toast({ title: "Bulk verify failed", variant: "destructive" });
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          apiRequest("POST", `/api/admin/contacts/${id}/archive`, {}, { "x-confirm": "true" })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts/stats"] });
      toast({ title: `${selected.size} contact(s) archived` });
      setSelected(new Set());
      setBulkArchiveOpen(false);
    },
    onError: () => {
      toast({ title: "Bulk archive failed", variant: "destructive" });
    },
  });

  // ── Bulk select helpers ────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[]) {
    const allSelected = ids.every((id) => selected.has(id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...ids]));
    }
  }

  const selectedArray = Array.from(selected);
  const hasSelection = selectedArray.length > 0;

  return (
    <>
      <PageHeader
        title="Contacts CRM"
        description="Unified admin CRM for all investors, founders, and consortium partners. Every mutation is audit-logged, hash-chained, and emits a bridge event."
        breadcrumbs={[{ label: "Admin" }, { label: "Contacts CRM" }]}
        actions={
          <div className="flex gap-2">
            <Link href="/admin/investors/import">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="btn-bulk-import"
              >
                <Upload className="h-3.5 w-3.5" />
                Bulk import
              </Button>
            </Link>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setNewContactOpen(true)}
              data-testid="btn-new-contact"
            >
              <Plus className="h-3.5 w-3.5" />
              New contact
            </Button>
          </div>
        }
      />

      <PageBody>
        {/* ── Stats bar ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {statsQuery.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
            ))
          ) : (
            <>
              <StatCard label="Total contacts" value={stats?.total ?? 0} icon={Users} testId="stat-total" />
              <StatCard label="Verified investors" value={stats?.byVerification.verified ?? 0} icon={ShieldCheck} testId="stat-verified" accent="bg-emerald-500" />
              <StatCard label="Founders" value={stats?.byKind.founder ?? 0} icon={Building2} testId="stat-founders" />
              <StatCard label="Consortium partners" value={stats?.byKind.consortium_partner ?? 0} icon={Handshake} testId="stat-partners" />
              <StatCard label="Pending verification" value={stats?.byVerification.pending ?? 0} icon={AlertCircle} testId="stat-pending" accent="bg-amber-500" />
            </>
          )}
        </div>

        {/* ── Bulk action bar ───────────────────────────────── */}
        {hasSelection && (
          <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-secondary/60 rounded-lg border border-border">
            <span className="text-sm font-medium" data-testid="text-selection-count">
              {selectedArray.length} selected
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              onClick={() => setBulkVerifyOpen(true)}
              data-testid="btn-bulk-verify"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Verify selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => setBulkArchiveOpen(true)}
              data-testid="btn-bulk-archive"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive selected
            </Button>
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-testid="input-search"
              placeholder="Search by name, email, tag…"
              className="pl-8 h-9 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] h-9 text-sm" data-testid="select-filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={verificationFilter} onValueChange={setVerificationFilter}>
            <SelectTrigger className="w-[140px] h-9 text-sm" data-testid="select-filter-verification">
              <SelectValue placeholder="Verification" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verifications</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-[110px] h-9 text-sm" data-testid="select-filter-region">
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"].map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Tabs + Table ─────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as typeof activeTab);
            setSelected(new Set());
          }}
        >
          <TabsList className="mb-4" data-testid="tabs-kind">
            <TabsTrigger value="all" data-testid="tab-all">
              All ({stats?.total ?? "…"})
            </TabsTrigger>
            <TabsTrigger value="investors" data-testid="tab-investors">
              Investors ({stats?.byKind.investor ?? "…"})
            </TabsTrigger>
            <TabsTrigger value="founders" data-testid="tab-founders">
              Founders ({stats?.byKind.founder ?? "…"})
            </TabsTrigger>
            <TabsTrigger value="consortium_partners" data-testid="tab-partners">
              Partners ({stats?.byKind.consortium_partner ?? "…"})
            </TabsTrigger>
          </TabsList>

          {(["all", "investors", "founders", "consortium_partners"] as const).map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Card>
                <CardContent className="px-0">
                  {contactsQuery.isLoading ? (
                    <div className="p-6 space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : (
                    <ContactsTable
                      contacts={contacts}
                      tab={tab}
                      selected={selected}
                      onToggleSelect={toggleSelect}
                      onToggleAll={toggleAll}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </PageBody>

      {/* New contact dialog */}
      <NewContactDialog open={newContactOpen} onClose={() => setNewContactOpen(false)} />

      {/* Bulk verify confirm */}
      <AlertDialog open={bulkVerifyOpen} onOpenChange={setBulkVerifyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bulk Verify</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to verify <strong>{selectedArray.length}</strong> contact(s). This will audit-log
              and emit bridge events for each.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-bulk-verify-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-bulk-verify-confirm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => bulkVerifyMutation.mutate(selectedArray)}
              disabled={bulkVerifyMutation.isPending}
            >
              {bulkVerifyMutation.isPending ? "Verifying…" : `Verify ${selectedArray.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk archive confirm */}
      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bulk Archive</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to archive <strong>{selectedArray.length}</strong> contact(s). They will be
              soft-deleted and can be restored later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-bulk-archive-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-bulk-archive-confirm"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => bulkArchiveMutation.mutate(selectedArray)}
              disabled={bulkArchiveMutation.isPending}
            >
              {bulkArchiveMutation.isPending ? "Archiving…" : `Archive ${selectedArray.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
