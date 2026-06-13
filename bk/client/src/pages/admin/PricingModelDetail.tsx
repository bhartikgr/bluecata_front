/**
 * Sprint 28 — Pricing Model Detail / Editor.
 *
 * Production-grade authoring surface for a single pricing model.
 * Tabs: Overview · Pricing & Cadences · Currency Overrides · Regional Multipliers ·
 *       Features · Metering · Volume Brackets · Discount Codes · Trial ·
 *       Effective Dates · Price Preview · History.
 *
 * Every edit is double-verified (a Save banner shows "X unsaved changes" with
 * a Save / Discard pair). Save calls PATCH /api/admin/pricing-models/:id, which
 * bumps version, chains SHA-256 hash, appends audit, and (if status=live) emits
 * a bridge event so the Collective stays in sync.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Save, RotateCcw, Trash2, Copy, ArrowUpRight, ShieldCheck,
  Plus, X, CheckCircle2, AlertTriangle, Calculator, History as HistoryIcon,
  FileText, Globe, MapPin, Sparkles, DollarSign, Boxes, Tag, Clock,
} from "lucide-react";
import { HelpTip } from "@/components/HelpTip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Status = "draft" | "preview" | "live" | "deprecated";
type ProductLine = "founder" | "collective" | "consortium_partner" | "add_on";
type Cadence = "monthly" | "annual" | "biennial" | "one_time" | "perpetual";

interface FeatureGate { key: string; label: string; included: boolean; quota: number | null; quotaUnit?: string; }
interface MeteringRule { meterKey: string; label: string; includedQty: number; overageMinor: number; unit: string; }
interface VolumeBracket { fromQty: number; toQty: number | null; pricePerUnitMinor: number; }
interface CurrencyOverride { currency: string; basePriceMinor: number; }
interface RegionalMultiplier { region: string; multiplier: number; notes?: string; }
interface DiscountCode { code: string; kind: "percent" | "flat_minor" | "trial_extension_days"; amount: number; expiresOn: string | null; maxRedemptions: number | null; active: boolean; }
interface TrialConfig { lengthDays: number; requiresCard: boolean; autoConvertToPlanId: string | null; }

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
  cadenceOptions: Array<{ cadence: Cadence; priceMinor: number }>;
  currencyOverrides: CurrencyOverride[];
  regionalMultipliers: RegionalMultiplier[];
  features: FeatureGate[];
  metering: MeteringRule[];
  volumeBrackets: VolumeBracket[];
  discountCodes: DiscountCode[];
  trial: TrialConfig | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  grandfatherOnChange: boolean;
  taxInclusive: boolean;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

const STATUS_COLORS: Record<Status, string> = {
  draft: "bg-zinc-100 text-zinc-700 border-zinc-300",
  preview: "bg-amber-50 text-amber-800 border-amber-300",
  live: "bg-emerald-50 text-emerald-800 border-emerald-300",
  deprecated: "bg-rose-50 text-rose-800 border-rose-300",
};

const PROMOTE_TARGETS: Record<Status, Status[]> = {
  draft: ["preview", "deprecated"],
  preview: ["live", "draft", "deprecated"],
  live: ["deprecated"],
  deprecated: [],
};

function fmtMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }
function shallowEq(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export default function PricingModelDetail() {
  const [, params] = useRoute<{ id: string }>("/admin/pricing-models/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ ok: boolean; model: PricingModel }>({
    queryKey: ["/api/admin/pricing-models", id],
    queryFn: async () => (await apiRequest("GET", `/api/admin/pricing-models/${id}`)).json(),
    enabled: !!id,
  });

  const server = data?.model;
  const [draft, setDraft] = useState<PricingModel | null>(null);
  const [confirmPromote, setConfirmPromote] = useState<Status | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync server -> draft whenever fresh data arrives and no unsaved edits
  useEffect(() => {
    if (server && (!draft || draft.id !== server.id || shallowEq(draft, server))) {
      setDraft(deepClone(server));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, server?.revisionHash]);

  const dirty = useMemo(() => server && draft ? !shallowEq(draft, server) : false, [draft, server]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("no draft");
      return (await apiRequest("PATCH", `/api/admin/pricing-models/${id}`, {
        productLine: draft.productLine,
        name: draft.name,
        description: draft.description,
        currency: draft.currency,
        basePriceMinor: draft.basePriceMinor,
        cadence: draft.cadence,
        cadenceOptions: draft.cadenceOptions,
        currencyOverrides: draft.currencyOverrides,
        regionalMultipliers: draft.regionalMultipliers,
        features: draft.features,
        metering: draft.metering,
        volumeBrackets: draft.volumeBrackets,
        discountCodes: draft.discountCodes,
        trial: draft.trial,
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo,
        grandfatherOnChange: draft.grandfatherOnChange,
        taxInclusive: draft.taxInclusive,
      })).json();
    },
    onSuccess: () => {
      toast({ title: "Pricing model saved", description: "Revision chain extended; audit appended." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const promoteMut = useMutation({
    mutationFn: async (to: Status) =>
      (await apiRequest("POST", `/api/admin/pricing-models/${id}/promote`, { to })).json(),
    onSuccess: (resp) => {
      if ((resp as { ok?: boolean }).ok === false) {
        toast({ title: "Promotion blocked", description: (resp as { error?: string }).error ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Status updated", description: "Bridge event emitted if now live." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
    },
    onError: (e: Error) => toast({ title: "Promotion failed", description: e.message, variant: "destructive" }),
  });

  const cloneMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/pricing-models/${id}/clone`)).json(),
    onSuccess: (resp) => {
      const newId = (resp as { model?: { id?: string } }).model?.id;
      toast({ title: "Cloned to draft", description: newId ? `New id: ${newId}` : "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      if (newId) window.location.hash = `#/admin/pricing-models/${newId}`;
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/pricing-models/${id}`)).json(),
    onSuccess: (resp) => {
      if ((resp as { ok?: boolean }).ok === false) {
        toast({ title: "Delete blocked", description: (resp as { error?: string }).error ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Model deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing-models"] });
      window.location.hash = "#/admin/pricing-models";
    },
  });

  if (isLoading || !draft || !server) {
    return (
      <>
        <PageHeader title="Pricing Model" />
        <PageBody><div className="p-6 text-sm text-zinc-500">Loading…</div></PageBody>
      </>
    );
  }

  const update = (patch: Partial<PricingModel>) => setDraft(prev => prev ? { ...prev, ...patch } : prev);

  return (
    <>
      <PageHeader
        title={draft.name}
        subtitle={`${draft.productLine} · v${draft.version} · ${draft.slug}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/pricing-models">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-1" /> All models
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => cloneMut.mutate()} data-testid="button-clone">
              <Copy className="h-4 w-4 mr-1" /> Clone
            </Button>
            {draft.status === "draft" && (
              <Button variant="outline" size="sm" className="text-rose-700" onClick={() => setConfirmDelete(true)} data-testid="button-delete">
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="p-6 space-y-6 max-w-7xl">
          {/* Status + promote */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-zinc-600">Status</span>
              <Badge variant="outline" className={STATUS_COLORS[draft.status]}>{draft.status.toUpperCase()}</Badge>
              <span className="text-sm text-zinc-400">·</span>
              <span className="text-sm text-zinc-600">Version <span className="font-semibold text-zinc-900">{draft.version}</span></span>
              <span className="text-sm text-zinc-400">·</span>
              <span className="text-sm text-zinc-600">Last hash <span className="font-mono text-xs">{draft.revisionHash.slice(0, 12)}…</span></span>
              <div className="ml-auto flex items-center gap-2">
                {PROMOTE_TARGETS[draft.status].map(t => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === "live" ? "default" : "outline"}
                    onClick={() => setConfirmPromote(t)}
                    data-testid={`button-promote-${t}`}
                  >
                    <ArrowUpRight className="h-4 w-4 mr-1" />
                    {draft.status} → {t}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Unsaved banner */}
          {dirty && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center gap-3" data-testid="banner-unsaved">
              <AlertTriangle className="h-5 w-5 text-amber-700 flex-shrink-0" />
              <div className="flex-1 text-sm text-amber-900">
                <span className="font-semibold">You have unsaved changes.</span> Saving will bump version to v{draft.version + 1}, extend the SHA-256 revision chain, append an audit entry, and (if status is LIVE) emit a bridge event to the Collective.
              </div>
              <Button size="sm" variant="outline" onClick={() => setDraft(deepClone(server))} data-testid="button-discard">
                <RotateCcw className="h-4 w-4 mr-1" /> Discard
              </Button>
              <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save">
                <Save className="h-4 w-4 mr-1" /> {saveMut.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="overview" data-testid="tab-overview"><FileText className="h-4 w-4 mr-1" />Overview</TabsTrigger>
              <TabsTrigger value="pricing" data-testid="tab-pricing"><DollarSign className="h-4 w-4 mr-1" />Pricing</TabsTrigger>
              <TabsTrigger value="currencies" data-testid="tab-currencies"><Globe className="h-4 w-4 mr-1" />Currencies</TabsTrigger>
              <TabsTrigger value="regions" data-testid="tab-regions"><MapPin className="h-4 w-4 mr-1" />Regions</TabsTrigger>
              <TabsTrigger value="features" data-testid="tab-features"><Sparkles className="h-4 w-4 mr-1" />Features</TabsTrigger>
              <TabsTrigger value="metering" data-testid="tab-metering"><Boxes className="h-4 w-4 mr-1" />Metering</TabsTrigger>
              <TabsTrigger value="brackets" data-testid="tab-brackets">Volume</TabsTrigger>
              <TabsTrigger value="discounts" data-testid="tab-discounts"><Tag className="h-4 w-4 mr-1" />Discounts</TabsTrigger>
              <TabsTrigger value="trial" data-testid="tab-trial">Trial</TabsTrigger>
              <TabsTrigger value="effective" data-testid="tab-effective"><Clock className="h-4 w-4 mr-1" />Effective</TabsTrigger>
              <TabsTrigger value="preview" data-testid="tab-preview"><Calculator className="h-4 w-4 mr-1" />Preview</TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history"><HistoryIcon className="h-4 w-4 mr-1" />History</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <OverviewTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="pricing" className="mt-4">
              <PricingTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="currencies" className="mt-4">
              <CurrenciesTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="regions" className="mt-4">
              <RegionsTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="features" className="mt-4">
              <FeaturesTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="metering" className="mt-4">
              <MeteringTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="brackets" className="mt-4">
              <BracketsTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="discounts" className="mt-4">
              <DiscountsTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="trial" className="mt-4">
              <TrialTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="effective" className="mt-4">
              <EffectiveTab draft={draft} update={update} />
            </TabsContent>
            <TabsContent value="preview" className="mt-4">
              <PreviewTab modelId={id} draft={draft} />
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <HistoryTab modelId={id} />
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>

      {/* Promote double-confirm */}
      <Dialog open={!!confirmPromote} onOpenChange={(o) => !o && setConfirmPromote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm status change</DialogTitle>
            <DialogDescription>
              You are about to move <span className="font-semibold">{draft.name}</span> from <span className="font-mono">{draft.status}</span> to <span className="font-mono">{confirmPromote}</span>.
              {confirmPromote === "live" && (
                <span className="block mt-2 text-emerald-700">This will emit a <span className="font-mono">pricing_model.published</span> bridge event to the Collective and make this model billable.</span>
              )}
              {confirmPromote === "deprecated" && (
                <span className="block mt-2 text-rose-700">Deprecated models cannot be undeprecated. Existing subscribers can be grandfathered if that flag is set.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPromote(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (confirmPromote) { promoteMut.mutate(confirmPromote); setConfirmPromote(null); }
              }}
              data-testid="button-confirm-promote"
            >
              <ShieldCheck className="h-4 w-4 mr-1" /> Yes, change status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete double-confirm */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete draft model?</DialogTitle>
            <DialogDescription>
              <span className="font-semibold">{draft.name}</span> will be permanently removed. This action cannot be undone. (Only draft models can be deleted; live ones must be deprecated.)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { deleteMut.mutate(); setConfirmDelete(false); }}
              data-testid="button-confirm-delete"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------- Tab: Overview ---------- */
function OverviewTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Display name <HelpTip>Shown to customers in checkout and billing pages.</HelpTip></Label>
            <Input value={draft.name} onChange={e => update({ name: e.target.value })} data-testid="input-name" />
          </div>
          <div>
            <Label>Slug <HelpTip>URL-safe identifier; cannot be changed once set.</HelpTip></Label>
            <Input value={draft.slug} disabled className="bg-zinc-50" data-testid="input-slug" />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Textarea
            rows={3}
            value={draft.description}
            onChange={e => update({ description: e.target.value })}
            data-testid="input-description"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Product line</Label>
            <Select value={draft.productLine} onValueChange={(v) => update({ productLine: v as ProductLine })}>
              <SelectTrigger data-testid="select-productLine"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="founder">Founder SaaS</SelectItem>
                <SelectItem value="collective">Collective membership</SelectItem>
                <SelectItem value="consortium_partner">Consortium partner</SelectItem>
                <SelectItem value="add_on">Add-on</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-7">
            <Switch checked={draft.taxInclusive} onCheckedChange={(v) => update({ taxInclusive: v })} data-testid="switch-taxInclusive" />
            <Label className="cursor-pointer">Tax-inclusive pricing <HelpTip>Tick if displayed price already includes local VAT/GST (e.g. EU/AU).</HelpTip></Label>
          </div>
          <div className="flex items-center gap-2 pt-7">
            <Switch checked={draft.grandfatherOnChange} onCheckedChange={(v) => update({ grandfatherOnChange: v })} data-testid="switch-grandfather" />
            <Label className="cursor-pointer">Grandfather existing subs <HelpTip>If a price change happens, existing subscribers keep their old price forever.</HelpTip></Label>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-xs text-zinc-500 font-mono border-t pt-4">
          <div>Created: {new Date(draft.createdAt).toLocaleString()}</div>
          <div>Updated: {new Date(draft.updatedAt).toLocaleString()}</div>
          <div>By: {draft.updatedBy}</div>
          <div>Hash: {draft.revisionHash.slice(0, 16)}…</div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Pricing & Cadences ---------- */
function PricingTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const addCadence = () => {
    update({ cadenceOptions: [...draft.cadenceOptions, { cadence: "annual", priceMinor: 0 }] });
  };
  const setCad = (i: number, patch: Partial<{ cadence: Cadence; priceMinor: number }>) => {
    const next = [...draft.cadenceOptions];
    next[i] = { ...next[i], ...patch };
    update({ cadenceOptions: next });
  };
  const rmCad = (i: number) => update({ cadenceOptions: draft.cadenceOptions.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Base currency (ISO 4217)</Label>
            <Input value={draft.currency} onChange={e => update({ currency: e.target.value.toUpperCase().slice(0, 3) })} data-testid="input-currency" />
          </div>
          <div>
            <Label>Base price (minor units) <HelpTip>Integer cents/pence. e.g. $24.90 = 2490.</HelpTip></Label>
            <Input
              type="number"
              value={draft.basePriceMinor}
              onChange={e => update({ basePriceMinor: Math.max(0, Number(e.target.value || 0)) })}
              data-testid="input-basePriceMinor"
            />
            <div className="text-xs text-zinc-500 mt-1">{fmtMoney(draft.basePriceMinor, draft.currency)}</div>
          </div>
          <div>
            <Label>Default cadence</Label>
            <Select value={draft.cadence} onValueChange={(v) => update({ cadence: v as Cadence })}>
              <SelectTrigger data-testid="select-cadence"><SelectValue /></SelectTrigger>
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
          <div className="flex items-center justify-between mb-2">
            <Label>Alternative cadence prices</Label>
            <Button size="sm" variant="outline" onClick={addCadence} data-testid="button-addCadence"><Plus className="h-4 w-4 mr-1" /> Add cadence</Button>
          </div>
          <div className="space-y-2">
            {draft.cadenceOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 border rounded-md p-2">
                <Select value={opt.cadence} onValueChange={(v) => setCad(i, { cadence: v as Cadence })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="biennial">Biennial</SelectItem>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="perpetual">Perpetual</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="w-40"
                  value={opt.priceMinor}
                  onChange={e => setCad(i, { priceMinor: Math.max(0, Number(e.target.value || 0)) })}
                  data-testid={`input-cadenceOption-${i}`}
                />
                <span className="text-xs text-zinc-500">{fmtMoney(opt.priceMinor, draft.currency)}</span>
                <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => rmCad(i)}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            {draft.cadenceOptions.length === 0 && <div className="text-sm text-zinc-500 italic">No alternative cadences.</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Currencies ---------- */
function CurrenciesTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ currencyOverrides: [...draft.currencyOverrides, { currency: "EUR", basePriceMinor: 0 }] });
  const set = (i: number, patch: Partial<CurrencyOverride>) => {
    const n = [...draft.currencyOverrides]; n[i] = { ...n[i], ...patch }; update({ currencyOverrides: n });
  };
  const rm = (i: number) => update({ currencyOverrides: draft.currencyOverrides.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Per-currency price overrides</Label>
            <p className="text-xs text-zinc-500 mt-1">Customer's currency wins over the base price. Each row stores an integer minor-units amount in that currency.</p>
          </div>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addCurrency"><Plus className="h-4 w-4 mr-1" /> Add currency</Button>
        </div>
        <div className="space-y-2">
          {draft.currencyOverrides.map((o, i) => (
            <div key={i} className="flex items-center gap-2 border rounded-md p-2">
              <Input
                className="w-24"
                placeholder="USD"
                value={o.currency}
                onChange={e => set(i, { currency: e.target.value.toUpperCase().slice(0, 3) })}
                data-testid={`input-currency-${i}`}
              />
              <Input
                type="number"
                className="w-40"
                value={o.basePriceMinor}
                onChange={e => set(i, { basePriceMinor: Math.max(0, Number(e.target.value || 0)) })}
                data-testid={`input-currencyPrice-${i}`}
              />
              <span className="text-xs text-zinc-500">{fmtMoney(o.basePriceMinor, o.currency)}</span>
              <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.currencyOverrides.length === 0 && <div className="text-sm text-zinc-500 italic">No currency overrides — base currency will be used everywhere.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Regions ---------- */
function RegionsTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ regionalMultipliers: [...draft.regionalMultipliers, { region: "XX", multiplier: 1.0, notes: "" }] });
  const set = (i: number, patch: Partial<RegionalMultiplier>) => {
    const n = [...draft.regionalMultipliers]; n[i] = { ...n[i], ...patch }; update({ regionalMultipliers: n });
  };
  const rm = (i: number) => update({ regionalMultipliers: draft.regionalMultipliers.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Regional multipliers (PPP-adjusted)</Label>
            <p className="text-xs text-zinc-500 mt-1">Applied on top of base or currency-overridden price. e.g. IN x0.50 halves the price in India.</p>
          </div>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addRegion"><Plus className="h-4 w-4 mr-1" /> Add region</Button>
        </div>
        <div className="space-y-2">
          {draft.regionalMultipliers.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
              <Input className="w-20" placeholder="US" value={r.region} onChange={e => set(i, { region: e.target.value.toUpperCase().slice(0, 4) })} data-testid={`input-region-${i}`} />
              <Input className="w-24" type="number" step={0.01} value={r.multiplier} onChange={e => set(i, { multiplier: Number(e.target.value || 0) })} data-testid={`input-mult-${i}`} />
              <Input className="flex-1 min-w-40" placeholder="Notes (e.g. PPP-adjusted)" value={r.notes ?? ""} onChange={e => set(i, { notes: e.target.value })} data-testid={`input-regionNotes-${i}`} />
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.regionalMultipliers.length === 0 && <div className="text-sm text-zinc-500 italic">No regional multipliers.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Features ---------- */
function FeaturesTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ features: [...draft.features, { key: "new_feature", label: "New feature", included: false, quota: null }] });
  const set = (i: number, patch: Partial<FeatureGate>) => {
    const n = [...draft.features]; n[i] = { ...n[i], ...patch }; update({ features: n });
  };
  const rm = (i: number) => update({ features: draft.features.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Label>Feature gates</Label>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addFeature"><Plus className="h-4 w-4 mr-1" /> Add feature</Button>
        </div>
        <div className="space-y-2">
          {draft.features.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
              <Switch checked={f.included} onCheckedChange={(v) => set(i, { included: v })} data-testid={`switch-featureIncluded-${i}`} />
              <Input className="w-40" placeholder="key" value={f.key} onChange={e => set(i, { key: e.target.value })} />
              <Input className="flex-1 min-w-40" placeholder="Label" value={f.label} onChange={e => set(i, { label: e.target.value })} />
              <Input
                className="w-24"
                type="number"
                placeholder="quota"
                value={f.quota ?? ""}
                onChange={e => set(i, { quota: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <Input className="w-24" placeholder="unit" value={f.quotaUnit ?? ""} onChange={e => set(i, { quotaUnit: e.target.value || undefined })} />
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.features.length === 0 && <div className="text-sm text-zinc-500 italic">No feature gates.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Metering ---------- */
function MeteringTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ metering: [...draft.metering, { meterKey: "new_meter", label: "New meter", includedQty: 0, overageMinor: 0, unit: "unit" }] });
  const set = (i: number, patch: Partial<MeteringRule>) => {
    const n = [...draft.metering]; n[i] = { ...n[i], ...patch }; update({ metering: n });
  };
  const rm = (i: number) => update({ metering: draft.metering.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Usage metering</Label>
            <p className="text-xs text-zinc-500 mt-1">Included quota plus per-unit overage in minor units (e.g. 500 = $5.00 per investor seat).</p>
          </div>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addMeter"><Plus className="h-4 w-4 mr-1" /> Add meter</Button>
        </div>
        <div className="space-y-2">
          {draft.metering.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
              <Input className="w-32" placeholder="key" value={m.meterKey} onChange={e => set(i, { meterKey: e.target.value })} />
              <Input className="flex-1 min-w-32" placeholder="Label" value={m.label} onChange={e => set(i, { label: e.target.value })} />
              <Input className="w-24" type="number" placeholder="included" value={m.includedQty} onChange={e => set(i, { includedQty: Number(e.target.value || 0) })} />
              <Input className="w-32" type="number" placeholder="overage minor" value={m.overageMinor} onChange={e => set(i, { overageMinor: Number(e.target.value || 0) })} />
              <Input className="w-24" placeholder="unit" value={m.unit} onChange={e => set(i, { unit: e.target.value })} />
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.metering.length === 0 && <div className="text-sm text-zinc-500 italic">No usage meters.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Volume Brackets ---------- */
function BracketsTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ volumeBrackets: [...draft.volumeBrackets, { fromQty: 1, toQty: null, pricePerUnitMinor: 0 }] });
  const set = (i: number, patch: Partial<VolumeBracket>) => {
    const n = [...draft.volumeBrackets]; n[i] = { ...n[i], ...patch }; update({ volumeBrackets: n });
  };
  const rm = (i: number) => update({ volumeBrackets: draft.volumeBrackets.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Volume discount brackets</Label>
            <p className="text-xs text-zinc-500 mt-1">When qty falls in a bracket, the total becomes <span className="font-mono">qty × pricePerUnitMinor</span>.</p>
          </div>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addBracket"><Plus className="h-4 w-4 mr-1" /> Add bracket</Button>
        </div>
        <div className="space-y-2">
          {draft.volumeBrackets.map((b, i) => (
            <div key={i} className="flex items-center gap-2 border rounded-md p-2">
              <Label className="text-xs text-zinc-500">From</Label>
              <Input className="w-20" type="number" value={b.fromQty} onChange={e => set(i, { fromQty: Number(e.target.value || 1) })} />
              <Label className="text-xs text-zinc-500">To</Label>
              <Input className="w-20" type="number" placeholder="∞" value={b.toQty ?? ""} onChange={e => set(i, { toQty: e.target.value === "" ? null : Number(e.target.value) })} />
              <Label className="text-xs text-zinc-500">Price/u (minor)</Label>
              <Input className="w-32" type="number" value={b.pricePerUnitMinor} onChange={e => set(i, { pricePerUnitMinor: Number(e.target.value || 0) })} />
              <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.volumeBrackets.length === 0 && <div className="text-sm text-zinc-500 italic">No volume brackets — linear pricing applies.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Discount Codes ---------- */
function DiscountsTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const add = () => update({ discountCodes: [...draft.discountCodes, { code: "NEWCODE", kind: "percent", amount: 0.1, expiresOn: null, maxRedemptions: null, active: true }] });
  const set = (i: number, patch: Partial<DiscountCode>) => {
    const n = [...draft.discountCodes]; n[i] = { ...n[i], ...patch }; update({ discountCodes: n });
  };
  const rm = (i: number) => update({ discountCodes: draft.discountCodes.filter((_, idx) => idx !== i) });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Label>Discount codes</Label>
          <Button size="sm" variant="outline" onClick={add} data-testid="button-addDiscount"><Plus className="h-4 w-4 mr-1" /> Add code</Button>
        </div>
        <div className="space-y-2">
          {draft.discountCodes.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
              <Switch checked={c.active} onCheckedChange={(v) => set(i, { active: v })} />
              <Input className="w-32" placeholder="CODE" value={c.code} onChange={e => set(i, { code: e.target.value.toUpperCase() })} />
              <Select value={c.kind} onValueChange={(v) => set(i, { kind: v as DiscountCode["kind"] })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent (0.10 = 10%)</SelectItem>
                  <SelectItem value="flat_minor">Flat (minor units)</SelectItem>
                  <SelectItem value="trial_extension_days">Trial extension (days)</SelectItem>
                </SelectContent>
              </Select>
              <Input className="w-28" type="number" step={0.01} value={c.amount} onChange={e => set(i, { amount: Number(e.target.value || 0) })} />
              <Input className="w-40" type="date" value={c.expiresOn ?? ""} onChange={e => set(i, { expiresOn: e.target.value || null })} />
              <Input className="w-28" type="number" placeholder="max" value={c.maxRedemptions ?? ""} onChange={e => set(i, { maxRedemptions: e.target.value === "" ? null : Number(e.target.value) })} />
              <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => rm(i)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          {draft.discountCodes.length === 0 && <div className="text-sm text-zinc-500 italic">No discount codes.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Trial ---------- */
function TrialTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  const enabled = !!draft.trial;
  const t = draft.trial ?? { lengthDays: 14, requiresCard: false, autoConvertToPlanId: null };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => update({ trial: v ? { lengthDays: 14, requiresCard: false, autoConvertToPlanId: null } : null })}
            data-testid="switch-trialEnabled"
          />
          <Label className="cursor-pointer">Offer free trial</Label>
        </div>
        {enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Trial length (days)</Label>
              <Input type="number" value={t.lengthDays} onChange={e => update({ trial: { ...t, lengthDays: Number(e.target.value || 0) } })} data-testid="input-trialDays" />
            </div>
            <div className="flex items-center gap-2 pt-7">
              <Switch checked={t.requiresCard} onCheckedChange={(v) => update({ trial: { ...t, requiresCard: v } })} data-testid="switch-trialCard" />
              <Label className="cursor-pointer">Requires card on file</Label>
            </div>
            <div>
              <Label>Auto-convert to plan id (optional)</Label>
              <Input value={t.autoConvertToPlanId ?? ""} onChange={e => update({ trial: { ...t, autoConvertToPlanId: e.target.value || null } })} data-testid="input-trialPlan" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Effective ---------- */
function EffectiveTab({ draft, update }: { draft: PricingModel; update: (p: Partial<PricingModel>) => void }) {
  return (
    <Card>
      <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Effective from <HelpTip>Plan only becomes selectable after this date. Leave blank for immediate.</HelpTip></Label>
          <Input type="date" value={draft.effectiveFrom ?? ""} onChange={e => update({ effectiveFrom: e.target.value || null })} data-testid="input-effectiveFrom" />
        </div>
        <div>
          <Label>Effective to <HelpTip>Plan stops accepting new subscribers after this date. Existing subs continue unless deprecated.</HelpTip></Label>
          <Input type="date" value={draft.effectiveTo ?? ""} onChange={e => update({ effectiveTo: e.target.value || null })} data-testid="input-effectiveTo" />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: Price Preview ---------- */
function PreviewTab({ modelId, draft }: { modelId: string; draft: PricingModel }) {
  const [currency, setCurrency] = useState(draft.currency);
  const [region, setRegion] = useState<string>(draft.regionalMultipliers[0]?.region ?? "");
  const [cadence, setCadence] = useState<Cadence>(draft.cadence);
  const [qty, setQty] = useState(1);
  const [discountCode, setDiscountCode] = useState("");
  const [result, setResult] = useState<{ currency: string; finalMinor: number; breakdown: Array<{ stage: string; amountMinor: number; note?: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null); setResult(null);
    const params = new URLSearchParams();
    if (currency) params.set("currency", currency);
    if (region) params.set("region", region);
    if (cadence) params.set("cadence", cadence);
    if (qty) params.set("qty", String(qty));
    if (discountCode) params.set("discountCode", discountCode);
    const resp = await apiRequest("GET", `/api/admin/pricing-models/${modelId}/price-preview?${params.toString()}`);
    const j = await resp.json() as { ok: boolean; preview?: typeof result; error?: string };
    if (!j.ok) { setError(j.error ?? "preview failed"); return; }
    setResult(j.preview ?? null);
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>Currency</Label><Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 3))} data-testid="preview-currency" /></div>
          <div><Label>Region</Label><Input value={region} onChange={e => setRegion(e.target.value.toUpperCase().slice(0, 4))} data-testid="preview-region" /></div>
          <div>
            <Label>Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
              <SelectTrigger data-testid="preview-cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="biennial">Biennial</SelectItem>
                <SelectItem value="one_time">One-time</SelectItem>
                <SelectItem value="perpetual">Perpetual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Quantity</Label><Input type="number" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value || 1)))} data-testid="preview-qty" /></div>
          <div><Label>Discount code</Label><Input value={discountCode} onChange={e => setDiscountCode(e.target.value.toUpperCase())} data-testid="preview-discount" /></div>
        </div>
        <Button onClick={run} data-testid="button-preview-run"><Calculator className="h-4 w-4 mr-1" /> Calculate price</Button>
        {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2" data-testid="preview-error">{error}</div>}
        {result && (
          <div className="space-y-2 border-t pt-4" data-testid="preview-result">
            <div className="text-lg font-semibold">
              Final: <span className="text-emerald-700">{fmtMoney(result.finalMinor, result.currency)}</span>
              <span className="text-xs text-zinc-500 ml-2 font-mono">({result.finalMinor} minor)</span>
            </div>
            <div className="space-y-1">
              {result.breakdown.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-sm font-mono">
                  <Badge variant="outline" className="text-xs">{b.stage}</Badge>
                  <span>{b.amountMinor >= 0 ? "+" : ""}{b.amountMinor}</span>
                  {b.note && <span className="text-zinc-500">— {b.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Tab: History ---------- */
function HistoryTab({ modelId }: { modelId: string }) {
  const { data } = useQuery<{ ok: boolean; history: PricingModel[]; chain: { ok: boolean; brokenAt?: number; error?: string } }>({
    queryKey: ["/api/admin/pricing-models", modelId, "history"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/pricing-models/${modelId}/history`)).json(),
  });
  const h = data?.history ?? [];
  const chain = data?.chain;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        {chain && (
          <div className={`text-sm flex items-center gap-2 rounded p-2 ${chain.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-rose-50 border border-rose-200 text-rose-800"}`}>
            {chain.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {chain.ok ? `Revision chain verified — ${h.length} revision${h.length === 1 ? "" : "s"}.` : `Chain broken at version ${chain.brokenAt}: ${chain.error}`}
          </div>
        )}
        <div className="space-y-2">
          {h.map(rev => (
            <div key={`${rev.version}-${rev.revisionHash}`} className="border rounded-md p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STATUS_COLORS[rev.status]}>v{rev.version} · {rev.status}</Badge>
                <span className="text-zinc-500">{new Date(rev.updatedAt).toLocaleString()}</span>
                <span className="ml-auto font-mono text-xs text-zinc-500">{rev.revisionHash.slice(0, 16)}…</span>
              </div>
              <div className="text-zinc-600 mt-1">
                Base {fmtMoney(rev.basePriceMinor, rev.currency)} · {rev.features.filter(f => f.included).length} features · by {rev.updatedBy}
              </div>
            </div>
          ))}
          {h.length === 0 && <div className="text-sm text-zinc-500 italic">No history yet.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
