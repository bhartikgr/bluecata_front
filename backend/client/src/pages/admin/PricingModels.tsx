/**
 * Sprint 28 — Pricing Models index page.
 *
 * Rich admin authoring surface for every commercial pricing model.
 * Lists all models with status / product line / version, with quick actions:
 *   - Create new (blank or clone)
 *   - Promote (draft → preview → live → deprecated)
 *   - Delete (only when draft)
 *
 * Editor lives at /admin/pricing-models/:id
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DollarSign, Plus, Copy, Trash2, Eye, ArrowUpRight, Sparkles, Building2,
  FileText, RefreshCw, CheckCircle2,
} from "lucide-react";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { HelpTip } from "@/components/HelpTip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

const STATUS_TONE: Record<Status, { bg: string; text: string; label: string }> = {
  draft:      { bg: "bg-slate-100",  text: "text-slate-700", label: "Draft" },
  preview:    { bg: "bg-sky-100",    text: "text-sky-900",   label: "Preview" },
  live:       { bg: "bg-emerald-100", text: "text-emerald-900", label: "Live" },
  deprecated: { bg: "bg-amber-100",  text: "text-amber-900", label: "Deprecated" },
};

const PRODUCT_LINE_LABEL: Record<ProductLine, string> = {
  founder: "Founder SaaS",
  collective: "Collective",
  consortium_partner: "Consortium Partner",
  add_on: "Add-on",
};

function fmtMoney(minor: number, currency: string): string {
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function AdminPricingModels() {
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

  /* v25.27 — Bootstrap + legacy migration mutations.
   * Per the standing rule "pricing plans are determined from the Admin area,
   * never hardcoded," Capavate ships with zero source-baked tiers. These two
   * one-click admin actions get a fresh install (bootstrap) or legacy prod
   * (migrate) into a working admin-driven pricing state. */
  const bootstrapMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/pricing-models/bootstrap-founder-tiers")).json(),
    onSuccess: (data: { ok: true; created: Array<{ id: string; slug: string; name: string; status: string }>; message: string } | { ok: false; error: string; message?: string }) => {
      if ((data as { ok: true }).ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
        const d = data as { created: Array<{ id: string }>; message: string };
        toast({ title: `${d.created.length} draft tier(s) created`, description: d.message });
      } else {
        const d = data as { error: string; message?: string };
        toast({ title: "Bootstrap not applied", description: d.message ?? d.error, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Bootstrap failed", description: e.message, variant: "destructive" }),
  });

  const migrateMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/pricing-models/migrate-legacy")).json(),
    onSuccess: (data: { ok: true; created: Array<{ id: string }>; skipped: Array<{ plan: string; reason: string }>; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      toast({
        title: `${data.created.length} legacy tier(s) migrated`,
        description: `${data.message} Skipped: ${data.skipped.length}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Migration failed", description: e.message, variant: "destructive" }),
  });

  const cloneMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/pricing-models/${id}/clone`)).json(),
    onSuccess: (data: { ok: true; model: PricingModel }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      toast({ title: "Model cloned", description: `New draft '${data.model.name}' created.` });
      navigate(`/admin/pricing-models/${data.model.id}`);
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

  const aggregates = {
    total: all.length,
    live: all.filter(m => m.status === "live").length,
    draft: all.filter(m => m.status === "draft").length,
    preview: all.filter(m => m.status === "preview").length,
    deprecated: all.filter(m => m.status === "deprecated").length,
  };

  return (
    <>
      <PageHeader
        title="Pricing models"
        description="Author every commercial pricing model — Founder SaaS, Collective membership, Consortium Partner, add-ons."
        breadcrumbs={[{ label: "Admin" }, { label: "Pricing models" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <CreatePricingModelDialog open={createOpen} setOpen={setCreateOpen} onCreated={(id) => navigate(`/admin/pricing-models/${id}`)} />
          </div>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Commercial authoring",
            title: "Pricing models — every plan, every currency, every region, every feature gate",
            description:
              "Each model is a complete commercial offer with: base price (integer minor units + ISO currency), per-currency overrides, per-region multipliers, multiple cadences (monthly/annual/biennial/one-time/perpetual), feature gates with numeric quotas, usage-based metering rules with overage pricing, volume discount brackets, discount codes, trial config, scheduled effective-dating, and grandfather flags. Every save bumps a version, chains a SHA-256 hash to the previous revision for tamper-evident audit, and emits a bridge event when a model goes live.",
            warning:
              "Editing a 'live' model affects every existing customer unless grandfatherOnChange is true. Always promote draft → preview first to QA, then live. Status transitions are one-way except preview → draft. Deletion is only allowed for drafts; live/preview/deprecated models must be deprecated instead so the audit trail is preserved.",
            positive:
              "Use the price preview tool inside any model to quote a price for any combination of (currency, region, cadence, qty, discountCode) before committing. The breakdown shows every multiplier applied so commercial decisions are fully transparent.",
          }}
          stats={[
            { label: "Total models", value: aggregates.total },
            { label: "Live", value: aggregates.live, tone: "positive" },
            { label: "Preview", value: aggregates.preview },
            { label: "Draft", value: aggregates.draft, hint: "Iterating" },
            { label: "Deprecated", value: aggregates.deprecated, tone: aggregates.deprecated > 0 ? "warning" : "neutral" },
          ]}
        />

        {/* v25.27 — admin bootstrap + legacy migration card */}
        <Card className="mb-5 border-[hsl(184_98%_22%)]/30 bg-[hsl(184_98%_22%)]/5">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-1">Admin bootstrap · source of truth</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Capavate ships with zero source-baked tiers. Use these actions to set up pricing for a fresh install or migrate legacy subscriptions. Created tiers come in as DRAFTS with $0 placeholders — set real prices, then promote to <strong>live</strong>.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => bootstrapMut.mutate()}
                    disabled={bootstrapMut.isPending || aggregates.total > 0}
                    data-testid="button-bootstrap-founder-tiers"
                  >
                    {bootstrapMut.isPending ? "Creating…" : aggregates.total > 0 ? "Bootstrap not needed (tiers exist)" : "Create starter founder tiers ($0 drafts)"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => migrateMut.mutate()}
                    disabled={migrateMut.isPending}
                    data-testid="button-migrate-legacy-tiers"
                  >
                    {migrateMut.isPending ? "Migrating…" : "Migrate legacy subscriptions → tier rows"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-5">
          <CardContent className="pt-5">
            <div className="flex flex-wrap gap-3 items-center">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Filter:</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="preview">Preview</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="deprecated">Deprecated</SelectItem>
                </SelectContent>
              </Select>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Product line" /></SelectTrigger>
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
            <Card key={m.id} className="hover:border-[hsl(184_98%_22%)]/40 transition-colors" data-testid={`card-pm-${m.id}`}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={`text-[10px] border-0 ${STATUS_TONE[m.status].bg} ${STATUS_TONE[m.status].text}`}>{STATUS_TONE[m.status].label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{PRODUCT_LINE_LABEL[m.productLine]}</Badge>
                      <Badge variant="outline" className="text-[10px]">v{m.version}</Badge>
                    </div>
                    <Link href={`/admin/pricing-models/${m.id}`} className="font-semibold hover:underline">{m.name}</Link>
                    <div className="text-[11px] text-muted-foreground font-mono">{m.slug}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold font-mono tabular-nums" style={{ color: "hsl(184 98% 22%)" }}>
                      {m.basePriceMinor === 0 ? "Free" : fmtMoney(m.basePriceMinor, m.currency)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">/ {m.cadence}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{m.description}</p>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3 flex-wrap">
                  <span><CheckCircle2 className="inline h-3 w-3 mr-1" />{m.features.filter(f => f.included).length}/{m.features.length} features</span>
                  <span>·</span>
                  <span>{m.metering.length} metering rules</span>
                  <span>·</span>
                  <span>{m.volumeBrackets.length} volume brackets</span>
                  <span>·</span>
                  <span>{m.discountCodes.length} discount codes</span>
                  <span>·</span>
                  <span>{m.trial ? "trial" : "no trial"}</span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/admin/pricing-models/${m.id}`}>
                    <Button size="sm" variant="default" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white" data-testid={`button-edit-${m.id}`}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />Open
                    </Button>
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => cloneMut.mutate(m.id)} disabled={cloneMut.isPending} data-testid={`button-clone-${m.id}`}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" />Clone
                  </Button>
                  {m.status === "draft" && (
                    <Button size="sm" variant="outline" className="text-rose-700 hover:bg-rose-50" onClick={() => {
                      if (window.confirm(`Delete draft '${m.name}'? This cannot be undone.`)) deleteMut.mutate(m.id);
                    }} data-testid={`button-delete-${m.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground self-center">
                    Updated {new Date(m.updatedAt).toLocaleDateString()} by {m.updatedBy}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
          {!isLoading && filtered.length === 0 && (
            <Card className="col-span-full"><CardContent className="py-10 text-center text-muted-foreground">No pricing models match these filters.</CardContent></Card>
          )}
        </div>
      </PageBody>
    </>
  );
}

/* ---------- Create dialog ---------- */
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
      const body = {
        productLine,
        slug,
        name,
        description: "",
        currency,
        basePriceMinor,
        cadence,
        cadenceOptions: [{ cadence, priceMinor: basePriceMinor }],
        currencyOverrides: [],
        regionalMultipliers: [],
        features: [],
        metering: [],
        volumeBrackets: [],
        discountCodes: [],
        trial: null,
        effectiveFrom: null,
        effectiveTo: null,
        grandfatherOnChange: true,
        taxInclusive: false,
        status: "draft",
      };
      return (await apiRequest("POST", "/api/admin/pricing-models", body)).json();
    },
    onSuccess: (data: { ok: true; model: PricingModel }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      setOpen(false);
      onCreated(data.model.id);
      toast({ title: "Draft created", description: `New pricing model '${data.model.name}' created in draft status.` });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white" data-testid="button-new-pricing-model">
          <Plus className="h-3.5 w-3.5 mr-1.5" />New model
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create pricing model</DialogTitle>
          <DialogDescription>Drafts can be edited freely. Promote to preview when ready for QA, then live.</DialogDescription>
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
            <Label className="text-xs flex items-center gap-1">
              Slug <HelpTip>Immutable URL-safe identifier. Lowercase, alphanumeric, dashes only.</HelpTip>
            </Label>
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
              Base price <HelpTip>Integer minor units. e.g. 24900 = $249.00 in USD. Set 0 for free plans.</HelpTip>
            </Label>
            <Input type="number" value={basePriceMinor} onChange={e => setBasePriceMinor(parseInt(e.target.value) || 0)} data-testid="input-new-price" />
            <div className="text-[10px] text-muted-foreground mt-1">{fmtMoney(basePriceMinor, currency)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name || !slug || createMut.isPending} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white" data-testid="button-create-pm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
