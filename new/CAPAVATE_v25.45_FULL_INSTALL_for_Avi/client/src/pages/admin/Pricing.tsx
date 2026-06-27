/**
 * Sprint 28 Billing — Admin Pricing & Billing page (consolidated).
 *
 * URL: /admin/pricing
 *
 * Tab 1: Pricing Models      — list from /api/admin/pricing-models (from PricingModels.tsx)
 * Tab 2: Subscriptions       — list all company subscriptions with history drawer
 * Tab 3: Invoices            — platform-wide invoice list with download + refund
 * Tab 4: Billing Metrics     — live MRR/ARR/churn from subscriptionsStore + paymentStore
 * Tab 5: Payment Gateway     — gateway config, mode, recent webhook events
 */
import { useState } from "react";
import { formatMinor } from "@/lib/currency"; /* v25.38 currency sweep */
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, RefreshCw, CheckCircle2, Plus, Copy, Trash2, Eye,
  ArrowUpRight, Sparkles, Building2, FileText, Download, AlertTriangle,
  Activity, CreditCard, Webhook, Settings2, TrendingUp, TrendingDown,
  BarChart3, ShieldCheck, Clock, ExternalLink,
} from "lucide-react";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { HelpTip } from "@/components/HelpTip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/* ---------- Shared types ---------- */
type Status = "draft" | "preview" | "live" | "deprecated";
type ProductLine = "founder" | "collective" | "consortium_partner" | "add_on";
type Cadence = "monthly" | "annual" | "biennial" | "one_time" | "perpetual";

interface PricingModel {
  id: string;
  productLine: ProductLine;
  slug: string;
  name: string;
  description: string;
  status: Status;
  currency: string;
  basePriceMinor: number;
  cadence: Cadence;
  version: number;
  features: Array<{ key: string; included: boolean }>;
  metering: Array<unknown>;
  volumeBrackets: Array<unknown>;
  discountCodes: Array<unknown>;
  trial: unknown;
  updatedAt: string;
  updatedBy: string;
}

interface Subscription {
  companyId: string;
  status: string;
  plan: string;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  invoicesCount: number;
  pastDueMinor?: number;
  trialEndsOn?: string;
  version: number;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  companyId: string;
  planLabel: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  taxMinor: number;
  totalMinor: number;
  status: string;
  issuedAt: string;
  paidAt?: string;
  refundedAt?: string;
  lineItems: Array<{ label: string; amountMinor: number }>;
  cardLast4?: string;
  hash: string;
}

/* ---------- Formatters ---------- */
function fmtMoney(minor: number, currency = "USD"): string {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinor(minor, currency);
}
function fmtDate(iso: string): string {
  if (!iso || iso === "—") return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

/* ---------- Status chips ---------- */
const STATUS_TONE: Record<string, { bg: string; text: string; label: string }> = {
  draft:       { bg: "bg-slate-100",   text: "text-slate-700",    label: "Draft" },
  preview:     { bg: "bg-sky-100",     text: "text-sky-900",      label: "Preview" },
  live:        { bg: "bg-emerald-100", text: "text-emerald-900",  label: "Live" },
  deprecated:  { bg: "bg-amber-100",  text: "text-amber-900",    label: "Deprecated" },
  active:      { bg: "bg-emerald-100", text: "text-emerald-900",  label: "Active" },
  trialing:    { bg: "bg-sky-100",     text: "text-sky-900",      label: "Trialing" },
  past_due:    { bg: "bg-rose-100",    text: "text-rose-800",     label: "Past Due" },
  unpaid:      { bg: "bg-red-100",     text: "text-red-900",      label: "Unpaid" },
  cancelled:   { bg: "bg-slate-100",   text: "text-slate-700",    label: "Cancelled" },
  pending_payment: { bg: "bg-amber-100", text: "text-amber-900",  label: "Pending Payment" },
  cancel_at_period_end: { bg: "bg-orange-100", text: "text-orange-900", label: "Cancelling" },
  issued:      { bg: "bg-sky-100",     text: "text-sky-900",      label: "Issued" },
  paid:        { bg: "bg-emerald-100", text: "text-emerald-900",  label: "Paid" },
  refunded:    { bg: "bg-amber-100",   text: "text-amber-900",    label: "Refunded" },
  void:        { bg: "bg-slate-100",   text: "text-slate-700",    label: "Void" },
};
function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { bg: "bg-slate-100", text: "text-slate-700", label: status };
  return <Badge className={`text-[10px] border-0 ${t.bg} ${t.text}`}>{t.label}</Badge>;
}

/* =========================================================================== */
/* Tab 1 — Pricing Models (from PricingModels.tsx)                              */
/* =========================================================================== */
function PricingModelsTab() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ models: PricingModel[] }>({
    queryKey: ["/api/admin/pricing-models"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/pricing-models")).json(),
    refetchInterval: 30_000,
  });
  const all = data?.models ?? [];
  const filtered = all.filter(m => {
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    if (lineFilter !== "all" && m.productLine !== lineFilter) return false;
    return true;
  });

  const cloneMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/pricing-models/${id}/clone`)).json(),
    onSuccess: (d: { ok: true; model: PricingModel }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      toast({ title: "Model cloned", description: `Draft '${d.model.name}' created.` });
      navigate(`/admin/pricing-models/${d.model.id}`);
    },
    onError: (e: Error) => toast({ title: "Clone failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/admin/pricing-models/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      toast({ title: "Draft deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const PRODUCT_LINE_LABEL: Record<ProductLine, string> = {
    founder: "Founder SaaS", collective: "Collective",
    consortium_partner: "Consortium Partner", add_on: "Add-on",
  };

  const agg = { total: all.length, live: all.filter(m => m.status === "live").length, draft: all.filter(m => m.status === "draft").length, preview: all.filter(m => m.status === "preview").length, deprecated: all.filter(m => m.status === "deprecated").length };

  return (
    <div>
      <AdminPageIntro
        guidance={{
          eyebrow: "Commercial authoring",
          title: "Pricing models — every plan, every currency, every region",
          description: "Each model is a complete commercial offer. Every save bumps a version and chains a SHA-256 hash. Bridge event emitted when a model goes live.",
          warning: "Editing a 'live' model affects existing customers unless grandfatherOnChange is true. Always promote draft → preview → live.",
          positive: "Use the price preview tool inside any model to quote any (currency, region, cadence, qty, discount) combination.",
        }}
        stats={[
          { label: "Total models", value: agg.total },
          { label: "Live", value: agg.live, tone: "positive" },
          { label: "Preview", value: agg.preview },
          { label: "Draft", value: agg.draft, hint: "Iterating" },
          { label: "Deprecated", value: agg.deprecated, tone: agg.deprecated > 0 ? "warning" : "neutral" },
        ]}
      />
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-models">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <CreatePricingModelDialog open={createOpen} setOpen={setCreateOpen} onCreated={(id) => navigate(`/admin/pricing-models/${id}`)} />
        </div>
      </div>
      <Card className="mb-5">
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-3 items-center">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Filter:</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="preview">Preview</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="deprecated">Deprecated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={lineFilter} onValueChange={setLineFilter}>
              <SelectTrigger className="w-48" data-testid="select-line-filter"><SelectValue placeholder="Product line" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All product lines</SelectItem>
                <SelectItem value="founder">Founder SaaS</SelectItem>
                <SelectItem value="collective">Collective</SelectItem>
                <SelectItem value="consortium_partner">Consortium Partner</SelectItem>
                <SelectItem value="add_on">Add-on</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground ml-auto">{filtered.length} of {all.length} models</span>
          </div>
        </CardContent>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4">
        {filtered.map(m => (
          <Card key={m.id} className="hover:border-[hsl(0_100%_40%)]/40 transition-colors" data-testid={`card-pm-${m.id}`}>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={m.status} />
                    <Badge variant="outline" className="text-[10px]">{PRODUCT_LINE_LABEL[m.productLine]}</Badge>
                    <Badge variant="outline" className="text-[10px]">v{m.version}</Badge>
                  </div>
                  <Link href={`/admin/pricing-models/${m.id}`} className="font-semibold hover:underline">{m.name}</Link>
                  <div className="text-[11px] text-muted-foreground font-mono">{m.slug}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold font-mono tabular-nums" style={{ color: "hsl(0 100% 40%)" }}>
                    {m.basePriceMinor === 0 ? "Free" : fmtMoney(m.basePriceMinor, m.currency)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">/ {m.cadence}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{m.description}</p>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3 flex-wrap">
                <span><CheckCircle2 className="inline h-3 w-3 mr-1" />{m.features.filter(f => f.included).length}/{m.features.length} features</span>
                <span>·</span><span>{m.metering.length} metering</span>
                <span>·</span><span>{m.volumeBrackets.length} brackets</span>
              </div>
              <div className="flex gap-2">
                <Link href={`/admin/pricing-models/${m.id}`}>
                  <Button size="sm" variant="default" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid={`button-edit-${m.id}`}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" />Open
                  </Button>
                </Link>
                <Button size="sm" variant="outline" onClick={() => cloneMut.mutate(m.id)} disabled={cloneMut.isPending} data-testid={`button-clone-${m.id}`}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" />Clone
                </Button>
                {m.status === "draft" && (
                  <Button size="sm" variant="outline" className="text-rose-700 hover:bg-rose-50" onClick={() => {
                    if (window.confirm(`Delete draft '${m.name}'?`)) deleteMut.mutate(m.id);
                  }} data-testid={`button-delete-${m.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground self-center">
                  Updated {fmtDate(m.updatedAt)} by {m.updatedBy}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && filtered.length === 0 && (
          <Card className="col-span-full"><CardContent className="py-10 text-center text-muted-foreground">No models match filters.</CardContent></Card>
        )}
      </div>
    </div>
  );
}

/* =========================================================================== */
/* Tab 2 — Subscriptions                                                        */
/* =========================================================================== */
function SubscriptionsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [historyCompanyId, setHistoryCompanyId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/subscriptions")).json(),
    refetchInterval: 30_000,
  });
  const all = data?.subscriptions ?? [];
  const filtered = statusFilter === "all" ? all : all.filter(s => s.status === statusFilter);

  const { data: historyData } = useQuery<{ history: Subscription[]; chain: { ok: boolean; length: number } }>({
    queryKey: ["/api/admin/subscriptions", historyCompanyId, "history"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/subscriptions/${historyCompanyId}/history`)).json(),
    enabled: !!historyCompanyId,
  });

  const annualMrr = (sub: Subscription) => {
    // Annual MRR contribution: treat annual amount as 12 monthly contributions
    return sub.annualAmountMinor / 12;
  };

  const totalMrrMinor = filtered.filter(s => s.status === "active" || s.status === "trialing")
    .reduce((sum, s) => sum + annualMrr(s), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground mb-1">Total MRR (shown)</div><div className="text-xl font-semibold font-mono tabular-nums">{fmtMoney(Math.round(totalMrrMinor), "USD")}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground mb-1">Active subscriptions</div><div className="text-xl font-semibold">{all.filter(s => s.status === "active").length}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground mb-1">Trialing</div><div className="text-xl font-semibold">{all.filter(s => s.status === "trialing").length}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground mb-1">Past due</div><div className="text-xl font-semibold text-rose-600">{all.filter(s => s.status === "past_due").length}</div></CardContent></Card>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="select-sub-status"><SelectValue placeholder="Filter by status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
            <SelectItem value="past_due">Past Due</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-subs">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />Refresh
        </Button>
        <span className="text-[11px] text-muted-foreground ml-auto">{filtered.length} subscriptions</span>
      </div>

      <Card>
        <Table data-testid="table-subscriptions">
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Renewal</TableHead>
              <TableHead className="text-right">Annual MRR</TableHead>
              <TableHead>Card</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(s => (
              <TableRow key={s.companyId} data-testid={`row-sub-${s.companyId}`} className="cursor-pointer hover:bg-muted/30">
                <TableCell className="font-mono text-[12px]">{s.companyId}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{s.plan.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="text-[12px]">{fmtDate(s.renewsOn)}</TableCell>
                <TableCell className="text-right font-mono text-[12px]">{fmtMoney(Math.round(annualMrr(s)), s.currency)}/mo</TableCell>
                <TableCell className="text-[12px]">{s.cardLast4 ? `•••• ${s.cardLast4}` : "—"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={() => setHistoryCompanyId(s.companyId)} data-testid={`button-history-${s.companyId}`}>
                    History
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* History drawer */}
      <Sheet open={!!historyCompanyId} onOpenChange={(o) => !o && setHistoryCompanyId(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Subscription history — {historyCompanyId}</SheetTitle>
          </SheetHeader>
          {historyData && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className={`h-4 w-4 ${historyData.chain.ok ? "text-emerald-600" : "text-rose-600"}`} />
                <span>Chain integrity: {historyData.chain.ok ? "✓ Valid" : "✗ Broken"}</span>
                <span className="text-muted-foreground">· {historyData.chain.length} revisions</span>
              </div>
              {historyData.history.map((h, i) => (
                <Card key={i} className="bg-muted/30">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={h.status} />
                      <Badge variant="outline" className="text-[10px]">{h.plan}</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">v{h.version}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtDate(h.updatedAt)} · by {h.updatedBy}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate">{h.revisionHash}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* =========================================================================== */
/* Tab 3 — Invoices                                                              */
/* =========================================================================== */
function InvoicesTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [refundReason, setRefundReason] = useState("");

  const { data, isLoading, refetch } = useQuery<{ invoices: Invoice[]; total: number }>({
    queryKey: ["/api/admin/invoices", statusFilter, companyFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (companyFilter) params.set("companyId", companyFilter);
      return (await apiRequest("GET", `/api/admin/invoices?${params.toString()}`)).json();
    },
    refetchInterval: 30_000,
  });
  const invoices = data?.invoices ?? [];

  const refundMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await apiRequest("POST", `/api/admin/invoices/${id}/refund`, { reason })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      toast({ title: "Refund issued" });
      setRefundOpen(false);
      setSelectedInvoice(null);
    },
    onError: (e: Error) => toast({ title: "Refund failed", description: e.message, variant: "destructive" }),
  });

  const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-invoice-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by company ID…"
          value={companyFilter}
          onChange={e => setCompanyFilter(e.target.value)}
          className="w-52 h-9 text-sm"
          data-testid="input-company-filter"
        />
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-invoices">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />Refresh
        </Button>
        <span className="text-[11px] text-muted-foreground ml-auto">{invoices.length} invoices</span>
      </div>

      <Card>
        <Table data-testid="table-invoices">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id} data-testid={`row-inv-${inv.id}`}>
                <TableCell className="font-mono text-[11px]">{inv.invoiceNumber}</TableCell>
                <TableCell className="text-[11px]"><Link href={`/admin/companies/${inv.companyId}`} data-testid={`link-company-${inv.companyId}`} className="hover:underline text-primary">{inv.companyId}</Link></TableCell>
                <TableCell className="text-[11px]">{inv.planLabel}</TableCell>
                <TableCell className="text-[11px]">{inv.periodStart} → {inv.periodEnd}</TableCell>
                <TableCell className="text-right font-mono text-[12px]">{fmtMoney(inv.totalMinor, inv.currency)}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-[11px]">{fmtDate(inv.issuedAt)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <a href={`${API_BASE}/api/admin/invoices/${inv.id}/pdf`} download data-testid={`button-download-${inv.id}`}>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]">
                        <Download className="h-3 w-3 mr-1" />PDF
                      </Button>
                    </a>
                    {inv.status === "paid" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-rose-700 hover:bg-rose-50"
                        onClick={() => { setSelectedInvoice(inv); setRefundOpen(true); }}
                        data-testid={`button-refund-${inv.id}`}>
                        Refund
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && invoices.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No invoices found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Refund dialog */}
      <Dialog open={refundOpen} onOpenChange={(o) => !o && setRefundOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manual refund</DialogTitle>
            <DialogDescription>Refund invoice {selectedInvoice?.invoiceNumber}. This creates a negative-amount invoice for accounting.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">Amount: <strong>{selectedInvoice ? fmtMoney(selectedInvoice.totalMinor, selectedInvoice.currency) : "—"}</strong></div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Input value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="e.g. Customer request" data-testid="input-refund-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>Cancel</Button>
            <Button className="bg-rose-700 hover:bg-rose-800 text-white"
              disabled={!refundReason || refundMut.isPending}
              onClick={() => selectedInvoice && refundMut.mutate({ id: selectedInvoice.id, reason: refundReason })}
              data-testid="button-confirm-refund">
              Issue refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* =========================================================================== */
/* Tab 4 — Billing Metrics                                                       */
/* =========================================================================== */
function BillingMetricsTab() {
  const { data, isLoading } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/subscriptions")).json(),
  });
  const subs = data?.subscriptions ?? [];

  const active = subs.filter(s => s.status === "active");
  const trialing = subs.filter(s => s.status === "trialing");
  const pastDue = subs.filter(s => s.status === "past_due");
  const cancelled = subs.filter(s => s.status === "cancelled");

  // ARR = sum of active annual amounts
  const arrMinor = active.reduce((sum, s) => sum + s.annualAmountMinor, 0);
  // MRR = ARR / 12
  const mrrMinor = Math.round(arrMinor / 12);
  // Churn rate placeholder (would compute from status transitions in production)
  const churnRate = subs.length > 0 ? ((cancelled.length / subs.length) * 100).toFixed(1) : "0.0";
  // Expansion revenue = scale + enterprise vs prior month (static demo)
  const expansionMinor = active.filter(s => s.plan === "founder_scale" || s.plan === "founder_enterprise").reduce((sum, s) => sum + s.annualAmountMinor / 12, 0);
  // New revenue this month (trialing converted)
  const newRevMinor = trialing.reduce((sum, s) => sum + s.annualAmountMinor / 12, 0);

  const metrics = [
    { label: "MRR", value: fmtMoney(mrrMinor, "USD"), icon: TrendingUp, color: "text-emerald-600" },
    { label: "ARR", value: fmtMoney(arrMinor, "USD"), icon: BarChart3, color: "text-emerald-600" },
    { label: "Expansion MRR", value: fmtMoney(Math.round(expansionMinor), "USD"), icon: ArrowUpRight, color: "text-sky-600" },
    { label: "New Revenue (trial)", value: fmtMoney(Math.round(newRevMinor), "USD"), icon: Sparkles, color: "text-sky-600" },
    { label: "Churn rate", value: `${churnRate}%`, icon: TrendingDown, color: "text-rose-600" },
    { label: "Past due", value: `${pastDue.length}`, icon: AlertTriangle, color: "text-amber-600" },
  ];

  const planBreakdown = ["founder_free", "founder_pro", "founder_scale", "founder_enterprise"].map(p => ({
    plan: p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    count: active.filter(s => s.plan === p).length,
    arrMinor: active.filter(s => s.plan === p).reduce((sum, s) => sum + s.annualAmountMinor, 0),
  }));

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {metrics.map(m => (
          <Card key={m.label} data-testid={`card-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <m.icon className={`h-4 w-4 ${m.color}`} />
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              <div className="text-xl font-semibold font-mono tabular-nums">{isLoading ? "—" : m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Plan breakdown (active subscriptions)</CardTitle></CardHeader>
        <Table data-testid="table-plan-breakdown">
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">ARR contribution</TableHead>
              <TableHead className="text-right">MRR contribution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {planBreakdown.map(p => (
              <TableRow key={p.plan} data-testid={`row-plan-${p.plan}`}>
                <TableCell>{p.plan}</TableCell>
                <TableCell className="text-right">{p.count}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(p.arrMinor, "USD")}</TableCell>
                <TableCell className="text-right font-mono">{fmtMoney(Math.round(p.arrMinor / 12), "USD")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* =========================================================================== */
/* Tab 5 — Payment Gateway                                                       */
/* =========================================================================== */
function PaymentGatewayTab() {
  const { data, isLoading } = useQuery<{ ok: boolean; gateway: { name: string; mode: string; supportedMethods: string[]; webhookUrl: string; version: string } }>({
    queryKey: ["/api/admin/payment-gateway/config"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/payment-gateway/config")).json(),
  });

  const { data: eventsData } = useQuery<{ ok: boolean; events: Array<{ id: string; type: string; intentId: string; status: string; receivedAt: string }> }>({
    queryKey: ["/api/admin/payment-gateway/webhook-events"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/payment-gateway/webhook-events")).json(),
    refetchInterval: 15_000,
  });

  const gw = data?.gateway;
  const events = eventsData?.events ?? [];

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card data-testid="card-gateway-config">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings2 className="h-4 w-4" />Gateway configuration</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
            ) : gw ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Name</span>
                  <span className="text-sm font-medium">{gw.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Mode</span>
                  <Badge className={`text-[10px] border-0 ${gw.mode === "live" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                    {gw.mode.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Supported methods</span>
                  <div className="flex gap-1">
                    {gw.supportedMethods.map(m => (
                      <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Webhook endpoint</span>
                  <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{gw.webhookUrl}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Adapter version</span>
                  <span className="text-sm">{gw.version}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Gateway config unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Security</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-[12px]">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Idempotent payment intents</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />HMAC-signed webhook payloads</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />3DS challenge support</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />All amounts in integer minor units</div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-webhook-events">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Webhook className="h-4 w-4" />Recent webhook events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No webhook events yet.</div>
          ) : (
            <div className="divide-y">
              {events.slice(0, 20).map(e => (
                <div key={e.id} className="px-4 py-3 flex items-center gap-3" data-testid={`webhook-event-${e.id}`}>
                  <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium">{e.type}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{e.intentId}</div>
                  </div>
                  <div className="text-right">
                    <Badge className="text-[10px] border-0 bg-slate-100 text-slate-700">{e.status}</Badge>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(e.receivedAt)}</div>
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

/* =========================================================================== */
/* Main page shell                                                               */
/* =========================================================================== */
export default function AdminPricing() {
  const [activeTab, setActiveTab] = useState("pricing-models");

  return (
    <>
      <PageHeader
        title="Pricing & Billing"
        description="Pricing models, subscriptions, invoices, billing metrics, and payment gateway."
        breadcrumbs={[{ label: "Admin" }, { label: "Pricing & Billing" }]}
      />
      <PageBody>
        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-pricing-billing">
          <TabsList className="mb-6">
            <TabsTrigger value="pricing-models" data-testid="tab-pricing-models">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />Pricing Models
            </TabsTrigger>
            <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />Subscriptions
            </TabsTrigger>
            <TabsTrigger value="invoices" data-testid="tab-invoices">
              <FileText className="h-3.5 w-3.5 mr-1.5" />Invoices
            </TabsTrigger>
            <TabsTrigger value="billing-metrics" data-testid="tab-billing-metrics">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Billing Metrics
            </TabsTrigger>
            <TabsTrigger value="payment-gateway" data-testid="tab-payment-gateway">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />Payment Gateway
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pricing-models"><PricingModelsTab /></TabsContent>
          <TabsContent value="subscriptions"><SubscriptionsTab /></TabsContent>
          <TabsContent value="invoices"><InvoicesTab /></TabsContent>
          <TabsContent value="billing-metrics"><BillingMetricsTab /></TabsContent>
          <TabsContent value="payment-gateway"><PaymentGatewayTab /></TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

/* ---------- Create pricing model dialog (reused from PricingModels.tsx) ---------- */
function CreatePricingModelDialog({ open, setOpen, onCreated }: { open: boolean; setOpen: (b: boolean) => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [productLine, setProductLine] = useState<ProductLine>("founder");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [basePriceMinor, setBasePriceMinor] = useState(0);

  const createMut = useMutation({
    mutationFn: async () => {
      const body = { productLine, slug, name, description: "", currency, basePriceMinor, cadence, cadenceOptions: [{ cadence, priceMinor: basePriceMinor }], currencyOverrides: [], regionalMultipliers: [], features: [], metering: [], volumeBrackets: [], discountCodes: [], trial: null, effectiveFrom: null, effectiveTo: null, grandfatherOnChange: true, taxInclusive: false, status: "draft" };
      return (await apiRequest("POST", "/api/admin/pricing-models", body)).json();
    },
    onSuccess: (data: { ok: true; model: PricingModel }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      setOpen(false);
      onCreated(data.model.id);
      toast({ title: "Draft created", description: `'${data.model.name}' created.` });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" onClick={() => setOpen(true)} data-testid="button-new-pricing-model">
        <Plus className="h-3.5 w-3.5 mr-1.5" />New model
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create pricing model</DialogTitle>
          <DialogDescription>Drafts can be edited freely. Promote draft → preview → live.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Product line</Label>
            <Select value={productLine} onValueChange={(v) => setProductLine(v as ProductLine)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="founder"><Building2 className="h-3 w-3 inline mr-1.5" />Founder SaaS</SelectItem>
                <SelectItem value="collective"><Sparkles className="h-3 w-3 inline mr-1.5" />Collective</SelectItem>
                <SelectItem value="consortium_partner"><FileText className="h-3 w-3 inline mr-1.5" />Consortium Partner</SelectItem>
                <SelectItem value="add_on"><ArrowUpRight className="h-3 w-3 inline mr-1.5" />Add-on</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Display name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Founder Scale" data-testid="input-new-name" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">Slug <HelpTip>Immutable URL-safe identifier. Lowercase, alphanumeric, dashes only.</HelpTip></Label>
            <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="e.g. founder-scale" data-testid="input-new-slug" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} data-testid="input-new-currency" />
            </div>
            <div>
              <Label className="text-xs">Cadence</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="biennial">Biennial</SelectItem>
                  <SelectItem value="one_time">One-time</SelectItem>
                  <SelectItem value="perpetual">Perpetual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              Base price <HelpTip>Integer minor units. e.g. 24900 = $249.00. Set 0 for free plans.</HelpTip>
            </Label>
            <Input type="number" value={basePriceMinor} onChange={e => setBasePriceMinor(parseInt(e.target.value) || 0)} data-testid="input-new-price" />
            <div className="text-[10px] text-muted-foreground mt-1">{fmtMoney(basePriceMinor, currency)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name || !slug || createMut.isPending} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-create-pm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
