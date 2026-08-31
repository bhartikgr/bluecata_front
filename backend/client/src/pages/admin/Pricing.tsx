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
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal"; /* WAVE 22 · ITEM 4 */
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
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */
/* WAVE 180 · ITEM A SITE 4 — the client mirror of the platform's cross-currency
 * contract. Minor units accumulate in bigint, within one ISO code only; a mixed
 * set produces a stated refusal, never a converted number. No FX rate exists on
 * this platform and none is invented here. */
import {
  newBuckets,
  addMinor,
  singleScalar,
  bucketRows,
  dividedBuckets,
  type CurrencyBucketRow,
} from "@/lib/money/currencyBuckets";

/* WAVE 180 · ITEM A SITE 4 — the stated scope sentence for a money tile whose
   inputs span currencies. The owner's rule: wherever a total is shown, say what
   is included, what is excluded and in which currency; where a figure cannot be
   derived, name why. A fabricated zero and a bare blank are both forbidden. */
export function billingMetricScope(
  rows: CurrencyBucketRow[],
  excludedNoCurrency: number,
): string {
  const excl = excludedNoCurrency > 0
    ? ` ${excludedNoCurrency} subscription${excludedNoCurrency === 1 ? "" : "s"} excluded: no ISO currency on record.`
    : "";
  if (rows.length === 0) return `No subscription amounts on record.${excl}`;
  if (rows.length === 1) return `All figures above are in ${rows[0]!.currency}, over every subscription with an amount on record.${excl}`;
  return `Subscriptions on this platform are recorded in ${rows.length} currencies (${rows.map(r => r.currency).join(", ")}). No combined figure is shown — this platform holds no exchange rate, so the per-currency breakdown below is the whole truth.${excl}`;
}

/* WAVE 180 · ITEM A SITE 4 — what a single money tile prints. Single currency ⇒
   the figure, formatted in ITS OWN code rather than a hardcoded "USD". Mixed ⇒
   a stated refusal naming the currencies. Over-range ⇒ says so. */
export function billingMetricValue(
  rows: CurrencyBucketRow[],
  fmt: (minor: number, currency: string) => string,
): string {
  if (rows.length === 0) return "Not on record";
  if (rows.length > 1) return `${rows.map(r => r.currency).join(" + ")} — not added`;
  const r = rows[0]!;
  if (r.minor === null) return `${r.currency} — exceeds exact range`;
  return fmt(r.minor, r.currency);
}

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
/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
function fmtDate(iso: string): string {
  if (!iso || iso === "—") return "—";
  try { return fmtLocaleDate(iso, undefined, undefined, iso); } catch { return iso; }
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

  /* WAVE 22 · ITEM 4 (REVIEW B F-4) — consume isError/isSuccess. */
  const { data, isLoading, isError, isSuccess, isFetching, refetch } = useQuery<{ models: PricingModel[] }>({
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
                <Button size="sm" variant="default" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid={`button-edit-${m.id}`} asChild>
                  <Link href={`/admin/pricing-models/${m.id}`}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" />Open
                  </Link>
                </Button>
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
        {/* WAVE 22 · ITEM 4 (REVIEW B F-4) — a failed load is not "no models".
            `all = data?.models ?? []`, so a 403/500 collapsed to zero rows and
            the line below stated, as fact, that nothing matched. The empty
            line is re-gated on isSuccess; the refusal is appended AFTER it.
            The ordering is not cosmetic: the guard identifies panel bodies by
            positional path (Card#2 here), so inserting a Card AHEAD of this one
            renumbers it and registers as a DROP. Append, never insert. */}
        {!isLoading && isSuccess && filtered.length === 0 && (
          <Card className="col-span-full"><CardContent className="py-10 text-center text-muted-foreground">No models match filters.</CardContent></Card>
        )}
        {isError && (
          <div className="col-span-full">
            <LoadFailedRefusal
              what="pricing models"
              testId="admin-pricing-models-error"
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          </div>
        )}
        {!isLoading && !isError && !isSuccess && (
          <div className="col-span-full py-10 text-center text-muted-foreground text-sm" data-testid="admin-pricing-models-not-loaded">Pricing models have not loaded. Check your connection.</div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================== */
/* Tab 2 — Subscriptions                                                        */
/* =========================================================================== */
/* WAVE 201 — exported so the MRR tiles can be proven on RENDERED DOM rather
   than by reading this file's source, as waves 193/196/197 did. Export only;
   no behaviour, copy or markup changed by this line. */
export function SubscriptionsTab() {
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

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 184 · ITEM A · R156.1 — THE 8th CROSS-CURRENCY SITE, NAMED BY THE OWNER.

     WHAT WAS WRONG. The line that used to stand here was:

         const totalMrrMinor = filtered.filter(active|trialing)
           .reduce((sum, s) => sum + annualMrr(s), 0);

     and the tile below printed `fmtMoney(Math.round(totalMrrMinor), "USD")`. It
     added `annualAmountMinor / 12` across EVERY filtered subscription regardless
     of `s.currency` and then labelled the result "USD". The row cell further down
     this same table formats each row with `s.currency` — which is the proof that
     the rows are mixed. A CAD subscription was being added to a USD one and the
     sum was called dollars.

     It also did float arithmetic on money: `/ 12` on doubles over an unbounded
     row count with a single trailing Math.round.

     WHAT IT DOES NOW. Minor units accumulate in bigint, per ISO code, using the
     same helpers wave 180 already shipped and exported in this very file. A
     single-currency platform prints the SAME number as before, formatted in its
     own code instead of a hardcoded "USD". A mixed-currency platform REFUSES and
     NAMES the currencies — never a fabricated zero, never a blank, and never a
     converted number, because this platform holds no exchange rate.

     `dividedBuckets(b, 12)` reproduces `Math.round(total / 12)` exactly for a
     non-negative total (sum-then-divide is also the more correct order; the old
     code rounded per row before adding).
     ═══════════════════════════════════════════════════════════════════════════ */
  const mrrScope = filtered.filter(s => s.status === "active" || s.status === "trialing");
  const mrrAnnualBuckets = newBuckets();
  let mrrExcludedNoCurrency = 0;
  for (const s of mrrScope) {
    if (!addMinor(mrrAnnualBuckets, s.currency, s.annualAmountMinor)) mrrExcludedNoCurrency += 1;
  }
  const mrrRows = bucketRows(dividedBuckets(mrrAnnualBuckets, 12));
  const mrrValueText = billingMetricValue(mrrRows, fmtMoney);
  const mrrScopeText = billingMetricScope(bucketRows(mrrAnnualBuckets), mrrExcludedNoCurrency);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground mb-1">Total MRR (shown)</div><div className="text-xl font-semibold font-mono tabular-nums" data-testid="text-total-mrr-shown">{mrrValueText}</div><div className="text-[10px] leading-snug text-muted-foreground mt-1" data-testid="text-total-mrr-scope">{mrrScopeText}</div><div className="text-[10px] leading-snug text-muted-foreground mt-1" data-testid="text-total-mrr-population">Counts ACTIVE and TRIALING subscriptions in the list as currently filtered, annual amount divided by 12. The Billing Metrics tab counts ACTIVE only, across all subscriptions, so the two figures are not expected to agree.</div>{/* WAVE 202 · ITEM C · R178.2 — this tile is NOT the headline; the Billing
          Metrics tab's active-only, unfiltered MRR is. The owner ruled on that this
          wave. This tile keeps its number, its scope line and wave 201's population
          disclosure immediately above, byte for byte — nothing is regressed and no
          number changes. All that is added is the sentence saying which of the two
          figures the platform quotes, so a reader landing here first is not left to
          guess. ADDED as a new sibling <div> at the END of this CardContent, after
          the population disclosure; no existing node, attribute or <Card> ordinal is
          touched (R143.1). */}
        <div className="text-[10px] leading-snug text-muted-foreground mt-1" data-testid="text-total-mrr-not-headline">This is the filtered view, not the platform's headline figure. The headline MRR is on the Billing Metrics tab: active subscriptions only, unfiltered.</div>{mrrRows.length > 1 ? (
          <div className="mt-1 space-y-0.5" data-testid="list-total-mrr-by-currency">
            {mrrRows.map(r => (
              <div key={r.currency} className="flex items-center justify-between text-[11px] font-mono tabular-nums" data-testid={`row-total-mrr-${r.currency}`}>
                <span>{r.currency}</span><span>{r.minor === null ? "exceeds exact range" : fmtMoney(r.minor, r.currency)}</span>
              </div>
            ))}
          </div>
        ) : null}</CardContent></Card>
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

  /* WAVE 22 · ITEM 4 (REVIEW B F-4) — consume isError/isSuccess; an invoice
     list that failed to load must never read as "No invoices found." */
  const { data, isLoading, isError, isSuccess, isFetching, refetch } = useQuery<{ invoices: Invoice[]; total: number }>({
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
            {/* WAVE 22 · ITEM 4 — empty state re-gated on isSuccess; the
                refusal rows are APPENDED after it so no existing TableRow
                ordinal shifts (see the guard note in the models tab above). */}
            {!isLoading && isSuccess && invoices.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No invoices found.</TableCell></TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={8} className="py-6">
                  <LoadFailedRefusal
                    what="invoices"
                    testId="admin-invoices-error"
                    onRetry={() => void refetch()}
                    isRetrying={isFetching}
                  />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && !isSuccess && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8" data-testid="admin-invoices-not-loaded">Invoices have not loaded. Check your connection.</TableCell></TableRow>
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
/* WAVE 201 — exported for the same reason as SubscriptionsTab above. */
export function BillingMetricsTab() {
  /* WAVE 60 · L-6 — this tab destructured only { data, isLoading }. With no
     isError branch, a failed GET /api/admin/subscriptions left `subs = []` and
     the six tiles below printed MRR $0.00 / ARR $0.00 / Expansion MRR $0.00 /
     New Revenue (trial) $0.00 / Churn rate 0.0% / Past due 0 — six fabricated
     figures, four of them money, on an admin screen, indistinguishable from
     "this platform has no subscriptions". Three other tabs in THIS FILE already
     consume isError and mount LoadFailedRefusal (:151/:303, :460/:561,
     :703/:775); this follows them. The six computations below are untouched. */
  const { data, isLoading, isError, isSuccess, isFetching, refetch } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/subscriptions")).json(),
  });
  const subs = data?.subscriptions ?? [];

  const active = subs.filter(s => s.status === "active");
  const trialing = subs.filter(s => s.status === "trialing");
  const pastDue = subs.filter(s => s.status === "past_due");
  const cancelled = subs.filter(s => s.status === "cancelled");

  /* WAVE 180 · ITEM A SITE 4 — TWO DEFECTS IN ONE EXPRESSION, BOTH CLOSED HERE.

     (a) CROSS-CURRENCY. `arrMinor` was
         `active.reduce((sum, s) => sum + s.annualAmountMinor, 0)`. The
         `Subscription` interface being reduced DECLARES `currency: string`, and
         every reduce in this tab ignored it; the tiles then labelled the result
         with a hardcoded literal. A subscription's currency is not a constant:
         it comes from the admin-published pricing model for its plan
         (server/subscriptionsStore.ts getPlanPriceStrict), so two plans can
         carry two codes and `active` can span them.

     (b) FLOAT ON MONEY. `Math.round(arrMinor / 12)` divided minor units in
         floating point, and the expansion / new-revenue reduces below accumulated
         `annualAmountMinor / 12` as doubles across an unbounded row count before
         one trailing Math.round — losing cents at scale and hiding the loss.

     Both are fixed by bucketing per ISO code in bigint and dividing ONCE, at the
     bucket, with half-up integer rounding. Sum-then-divide also happens to be the
     more correct order: the old code rounded each row before adding.
     `dividedBuckets(b, 12)` reproduces `Math.round(total / 12)` exactly for a
     non-negative total. NO EXCHANGE RATE IS APPLIED ANYWHERE. */
  const arrBuckets = newBuckets();
  let excludedNoCurrency = 0;
  for (const s of active) {
    if (!addMinor(arrBuckets, s.currency, s.annualAmountMinor)) excludedNoCurrency += 1;
  }
  const arrRows = bucketRows(arrBuckets);
  const arrScalar = singleScalar(arrBuckets);
  const mrrRows = bucketRows(dividedBuckets(arrBuckets, 12));
  const metricScopeText = billingMetricScope(arrRows, excludedNoCurrency);
  /* WAVE 61a · R51 — THE ARITHMETIC BELOW IS UNCHANGED; ONLY THE TWO LABELS IN
     the `metrics` array MOVED, because they named quantities this code does not
     compute. `cancelled.length / subs.length` is the CANCELLED SHARE of every
     subscription in the current payload. It is not a churn rate: a churn rate is
     cancellations WITHIN A PERIOD over the base at the start of that period, and
     there is no period, no date and no prior-month term anywhere below. The
     author's own note said it would compute from status transitions in
     production. Implementing a real churn rate needs status-transition history
     and is its own wave — so the tile is relabelled to what it computes, which is
     the first of the two options R51 allows (label it, or refuse). Relabelling
     was chosen over refusing because the number is REAL arithmetic on REAL data:
     refusing would delete a working metric to fix a name, which is a silent
     drop. */
  const churnRate = subs.length > 0 ? ((cancelled.length / subs.length) * 100).toFixed(1) : "0.0";
  /* WAVE 61a · R51 — the previous comment here claimed `vs prior month`. There is
     NO prior-month term, no date and no second period in the expression below:
     it sums the CURRENT monthly amount of every active founder_scale and
     founder_enterprise subscription. Expansion MRR has a specific meaning in
     SaaS finance (new recurring revenue from EXISTING customers — upgrades, seat
     growth); this figure includes brand-new customers and excludes upgrades
     within other tiers, so it is not expansion MRR by any definition. Real
     expansion MRR needs prior-period snapshots the tree does not have (the same
     reason server/adminPlatformStore.ts honestly returns `nrr: null`).
     Arithmetic untouched; only the label moved. */
  /* WAVE 180 · ITEM A SITE 4 — the SELECTION and the MEANING of both figures are
     unchanged (same filters, same plans, same monthly basis, and wave 61a's
     labels are untouched). Only the arithmetic moved off floating point and into
     per-currency bigint buckets. */
  const expansionBuckets = newBuckets();
  for (const s of active.filter(s => s.plan === "founder_scale" || s.plan === "founder_enterprise")) {
    addMinor(expansionBuckets, s.currency, s.annualAmountMinor);
  }
  const expansionRows = bucketRows(dividedBuckets(expansionBuckets, 12));
  // New revenue this month (trialing converted)
  const newRevBuckets = newBuckets();
  for (const s of trialing) addMinor(newRevBuckets, s.currency, s.annualAmountMinor);
  const newRevRows = bucketRows(dividedBuckets(newRevBuckets, 12));

  const metrics = [
    { label: "MRR", value: billingMetricValue(mrrRows, fmtMoney), icon: TrendingUp, color: "text-emerald-600" },
    { label: "ARR", value: billingMetricValue(arrRows, fmtMoney), icon: BarChart3, color: "text-emerald-600" },
    { label: "Scale + Enterprise MRR", value: billingMetricValue(expansionRows, fmtMoney), icon: ArrowUpRight, color: "text-sky-600" },
    { label: "New Revenue (trial)", value: billingMetricValue(newRevRows, fmtMoney), icon: Sparkles, color: "text-sky-600" },
    { label: "Cancelled share (all-time)", value: `${churnRate}%`, icon: TrendingDown, color: "text-rose-600" },
    { label: "Past due", value: `${pastDue.length}`, icon: AlertTriangle, color: "text-amber-600" },
  ];

  /* WAVE 180 · ITEM A SITE 4 — the per-plan row had the same un-keyed reduce and
     was rendered with the same hardcoded currency literal. Plans are exactly
     where a second currency enters (each plan's code comes from its own published
     pricing model), so this is the row most likely to be mixed in practice. */
  const planBreakdown = ["founder_free", "founder_pro", "founder_scale", "founder_enterprise"].map(p => {
    const inPlan = active.filter(s => s.plan === p);
    const b = newBuckets();
    for (const s of inPlan) addMinor(b, s.currency, s.annualAmountMinor);
    return {
      plan: p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      count: inPlan.length,
      arrRows: bucketRows(b),
      mrrRows: bucketRows(dividedBuckets(b, 12)),
    };
  });

  return (
    <div>
      {/* WAVE 60 · L-6 — the refusal is a PRECEDING SIBLING of the tile grid, in
          its own <div>. `div` is not a PANEL_TAG (extract-inventory.ts:151-181),
          so this does not renumber the grid or any of the six ordinal-addressed
          <Card>s inside it. NO SILENT DROP: all six tiles and the plan-breakdown
          table still mount on the failure path — they show the em-dash this file
          already uses for an unknown value. */}
      {isError && (
        <div className="mb-6">
          <LoadFailedRefusal
            what="the billing metrics"
            testId="w60-billing-metrics-error"
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        </div>
      )}
      {/* WAVE 180 · ITEM A SITE 4 — THE SCOPE STATEMENT. An unexplained total is
          the defect, so the tiles below are preceded by a sentence naming what is
          included, what is excluded and in which currency. Like wave 60's refusal
          it is a PRECEDING SIBLING in its own <div>, and `div` is not a PANEL_TAG
          (extract-inventory.ts), so no ordinal-addressed <Card> inside the grid is
          renumbered and nothing is dropped. This is a NEW static sibling: no
          existing text node or attribute anywhere in this file was reworded,
          replaced or removed. */}
      {isSuccess && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground" data-testid="text-billing-metrics-scope">{metricScopeText}</p>
          {/* WAVE 201 — TWO SURFACES, TWO POPULATIONS, ONE WORD.

              This tab's MRR tile and the Subscriptions tab's "Total MRR (shown)"
              tile printed different numbers for the same platform, both labelled
              only "MRR". The arithmetic is not in dispute and is NOT touched here:
              this tab reduces `active` (status === "active") over every row in the
              payload, while the Subscriptions tab reduces `filtered` restricted to
              "active" OR "trialing". Different populations, both defensible, so
              neither number is changed and neither is declared the right one —
              which of the two is the platform's headline MRR is the owner's
              choice, not this wave's. What IS a defect is presenting either as a
              bare "MRR", because a reader comparing the two tabs cannot tell a
              definition difference from a data fault. So each tile now states its
              own population beside its own number.

              ADDED as a new sibling <p> inside the wave 193 scope div: no existing
              text node, attribute or ordinal-addressed <Card> is touched (R143.1;
              wave 182 — a new cell renumbers its siblings). */}
          <p className="text-xs text-muted-foreground" data-testid="text-billing-metrics-mrr-population">
            MRR and ARR here count ACTIVE subscriptions only, across all subscriptions,
            not just those matching a filter. The Subscriptions tab's "Total MRR (shown)"
            also counts TRIALING and honours the filter on that screen, so the two
            figures are measuring different populations and are not expected to agree.
          </p>
          {/* WAVE 202 · ITEM C · R178.2 — THE OWNER HAS NOW CHOSEN.

              Wave 201 deliberately declined to name a headline: "which of the two is
              the platform's headline MRR is the owner's choice, not this wave's."
              The ruling is in — active-only, unfiltered, is the headline. This is the
              active-only, unfiltered tile, so this is the headline.

              LABELLING AND PROMINENCE ONLY. Not one number changes: no arithmetic,
              no population, no filter and no rounding is altered anywhere in this
              file by wave 202. Both figures stay visible on their own tabs and BOTH
              population disclosures above and on the Subscriptions tab are kept
              exactly as wave 201 wrote them (that work is not regressed).

              ADDED as a further sibling <p> inside the same wave 193 scope div,
              immediately after wave 201's disclosure. No existing text node,
              attribute or ordinal-addressed <Card> is touched (R143.1; wave 182 — a
              new cell renumbers its siblings). */}
          <p className="text-xs font-medium text-foreground" data-testid="text-mrr-headline-designation">
            This is the platform's headline MRR. When a single monthly recurring revenue
            figure is quoted for Capavate, it is this one: active subscriptions only,
            every subscription counted, no filter applied.
          </p>
        </div>
      )}
      {isSuccess && !arrScalar.available && arrScalar.reason === "needs_fx_conversion" && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="panel-billing-metrics-by-currency">
          <p className="text-xs font-medium text-amber-900">Annual recurring revenue, per currency</p>
          <ul className="mt-1 space-y-0.5">
            {arrRows.map(r => (
              <li key={r.currency} className="text-xs font-mono text-amber-900" data-testid={`text-arr-ccy-${r.currency}`}>
                {r.currency}: {r.minor === null ? "exceeds exact range" : fmtMoney(r.minor, r.currency)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-amber-800">These are not added together. Converting them would need an exchange rate, an as-of date and an audit trail, none of which this platform holds.</p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {metrics.map(m => (
          <Card key={m.label} data-testid={`card-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <m.icon className={`h-4 w-4 ${m.color}`} />
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              {/* WAVE 60 · L-6 — was `{isLoading ? "—" : m.value}`, which printed a
                  computed zero on ERROR and on PAUSED. `!isSuccess` is the
                  PAUSED-safe form and subsumes isLoading; isLoading is kept in the
                  expression so the loading behaviour is visibly identical and the
                  destructured binding is still consumed. A genuinely EMPTY but
                  SUCCESSFUL load still prints today's honest $0.00 / 0.0% / 0. */}
              <div className="text-xl font-semibold font-mono tabular-nums">{isLoading || !isSuccess ? "—" : m.value}</div>
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
                <TableCell className="text-right font-mono">{billingMetricValue(p.arrRows, fmtMoney)}</TableCell>
                <TableCell className="text-right font-mono">{billingMetricValue(p.mrrRows, fmtMoney)}</TableCell>
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

  /* WAVE 22 · ITEM 4 (REVIEW B F-4) — consume isError/isSuccess. */
  const { data: eventsData, isError: eventsIsError, isSuccess: eventsIsSuccess, isFetching: eventsIsFetching, refetch: eventsRefetch } = useQuery<{ ok: boolean; events: Array<{ id: string; type: string; intentId: string; status: string; receivedAt: string }> }>({
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
          {eventsIsError ? (
            /* WAVE 22 · ITEM 4 — "No webhook events yet." on a failed load would
               tell an admin the gateway is silent when it may be very loud. */
            <div className="p-4">
              <LoadFailedRefusal
                what="recent webhook events"
                testId="admin-webhook-events-error"
                onRetry={() => void eventsRefetch()}
                isRetrying={eventsIsFetching}
              />
            </div>
          ) : !eventsIsSuccess ? (
            <div className="py-8 text-center text-sm text-muted-foreground" data-testid="admin-webhook-events-not-loaded">Webhook events have not loaded. Check your connection.</div>
          ) : events.length === 0 ? (
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
