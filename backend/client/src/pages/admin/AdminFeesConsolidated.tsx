/* D2.5 Slice 1 — `/admin/fees`: the ONE consolidated admin fee page.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The D2.5 audit (`D25_ADMIN_FEE_AUDIT.md`) found 15 sidebar routes / 19 admin
 * pages editing the same fees through different tables in different money
 * units, plus 3 W-V44 "hub" pages that were added without retiring anything.
 * The independent verification (`D25_DYNAMIC_VS_HARDCODED_VERIFICATION.md`)
 * then established that the BACKEND IS ALREADY DYNAMIC AND ADMIN-DRIVEN — the
 * problem is "too many doors into a working room, and no signage on any of
 * them."
 *
 * So this page is PURE UI CONSOLIDATION:
 *   • ONE route (`/admin/fees`) replaces 15.
 *   • NO new schema. Every tab reads an EXISTING table through an EXISTING
 *     `/api/admin/*` endpoint (all of which keep their `requireAdmin` guard;
 *     `server/routes.ts` also blanket-mounts `app.use("/api/admin", requireAdmin)`).
 *   • EVERY editable field carries a <SourceOfTruth> panel naming the table,
 *     the column, the money unit, who last edited it, and whether it is
 *     editable from this page. That panel is the direct antidote to the
 *     audit's #1 confusion source: admins could not tell which of several
 *     tables/pages was authoritative.
 *
 * OUT OF SCOPE HERE (do not duplicate — owned by other slices):
 *   • Slice 2 — public homepage dynamic pricing.
 *   • Slice 3 — coupon map migration (H-8), 14-day trial wiring (item 7),
 *     Collective env-var charge boundary (item 5), paywall / fail-open fix.
 *   Fields those slices own are rendered here READ-ONLY with a source panel
 *   that says exactly where the value comes from and why it is not editable.
 *
 * SACRED BOUNDARY: this page never WRITES gateway config and never imports
 * `paymentGatewayAdapter.ts`. It does render one READ-ONLY mirror of
 * `GET /api/admin/payment-gateway/config` in the Config tab, because retiring
 * `/admin/pricing` deleted the only client consumer of that endpoint and
 * losing the display would have been a regression rather than a
 * consolidation. Provider credentials remain at `/admin/integrations`, which
 * this page merely links to. Zero Airwallex code touched — where an amount is
 * env-gated we surface the ENV VAR NAME, read-only, and say so.
 *
 * UNIT CONTRACT: `platform_fees`, `pricing_models.*PriceMinor`,
 * `collective_subscription_configs.amount_minor` are all TRUE minor units
 * (cents). `collective_application_fee_config.amount_minor` stores DISPLAY
 * dollars (documented legacy quirk; see the Application Fee tab panel).
 * Inputs on this page accept MAJOR units and convert.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  Info,
  Lock,
  Save,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtUSD } from "@/lib/format";

/* ==========================================================================
 * Money helpers (single implementation for the whole fee area — the audit's
 * 2.1 finding was that every page re-implemented its own unit conversion).
 * ======================================================================== */

/** minor units (cents) → major-unit string for an <Input value>. */
export function minorToMajor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  return (minor / 100).toFixed(2);
}

/** major-unit dollar string → minor units (cents). null when invalid. */
export function majorToMinor(s: string): number | null {
  const raw = (s ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/* ==========================================================================
 * <SourceOfTruth> — the signage.
 * ======================================================================== */

export type SourceOfTruthUnit =
  | "currency_minor (cents)"
  | "currency_major (display dollars)"
  | "fraction (0.10 = 10%)"
  | "integer (days)"
  | "integer (count)"
  | "text";

export interface SourceOfTruthProps {
  /** Physical table the value lives in, e.g. `pricing_models`. */
  table: string;
  /** Physical column, e.g. `annual_price_minor`. */
  column: string;
  /** Money / value unit — stated explicitly because the audit found mixed units. */
  unit: SourceOfTruthUnit;
  /** ISO timestamp of the last write, when the API returns one. */
  lastEditedAt?: string | null;
  /** Actor id/name of the last write, when the API returns one. */
  lastEditedBy?: string | null;
  /** True when this page can write the field. */
  editableHere: boolean;
  /** When not editable here, say exactly where/why (env var, other slice, …). */
  editableVia?: string;
  /** Read endpoint, for reviewers. */
  readEndpoint?: string;
  /** Write endpoint, for reviewers. */
  writeEndpoint?: string;
  /** Server-reported provenance (`admin` | `platform_fees` | `env_fallback` | …). */
  provenance?: string | null;
  /** Render a deprecation warning strip. */
  deprecated?: boolean;
  /** Stable test id suffix. */
  testId: string;
}

export function SourceOfTruth(props: SourceOfTruthProps) {
  const {
    table,
    column,
    unit,
    lastEditedAt,
    lastEditedBy,
    editableHere,
    editableVia,
    readEndpoint,
    writeEndpoint,
    provenance,
    deprecated,
    testId,
  } = props;

  return (
    <aside
      className="rounded-lg border border-border bg-muted/40 p-4 text-xs space-y-2"
      data-testid={`source-of-truth-${testId}`}
      data-sot-table={table}
      data-sot-column={column}
      data-sot-unit={unit}
      aria-label={`Source of truth for ${table}.${column}`}
    >
      <div className="flex items-center gap-1.5 font-semibold text-foreground">
        <Database className="h-3.5 w-3.5" />
        Source of truth
      </div>
      <dl className="space-y-1">
        <Row label="Table" value={<code>{table}</code>} testId={`${testId}-table`} />
        <Row label="Column" value={<code>{column}</code>} testId={`${testId}-column`} />
        <Row label="Type" value={unit} testId={`${testId}-unit`} />
        <Row
          label="Last edited"
          value={
            lastEditedAt
              ? `${String(lastEditedAt).slice(0, 19).replace("T", " ")}${
                  lastEditedBy ? ` by ${lastEditedBy}` : ""
                }`
              : "— (no audit row yet)"
          }
          testId={`${testId}-lastedited`}
        />
        <Row
          label="Editable via"
          value={
            editableHere ? (
              <span className="text-foreground">this page</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                {editableVia ?? "not editable"}
              </span>
            )
          }
          testId={`${testId}-editable`}
        />
        {provenance ? (
          <Row
            label="Resolved from"
            value={<Badge variant="secondary">{provenance}</Badge>}
            testId={`${testId}-provenance`}
          />
        ) : null}
        {readEndpoint ? (
          <Row label="GET" value={<code>{readEndpoint}</code>} testId={`${testId}-get`} />
        ) : null}
        {writeEndpoint ? (
          <Row label="WRITE" value={<code>{writeEndpoint}</code>} testId={`${testId}-write`} />
        ) : null}
      </dl>
      {deprecated ? (
        <div
          className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900"
          data-testid={`sot-deprecated-${testId}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            DEPRECATED row — kept for back-compat display only. Editing it does not
            change what a customer is charged.
          </span>
        </div>
      ) : null}
    </aside>
  );
}

function Row({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="flex gap-2" data-testid={testId}>
      <dt className="w-24 shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

/** Two-column field + source-panel layout used by every tab. */
function FieldWithSource({
  children,
  source,
}: {
  children: React.ReactNode;
  source: SourceOfTruthProps;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">{children}</div>
      <SourceOfTruth {...source} />
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold">{children}</h3>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ==========================================================================
 * Wire types — mirror the EXISTING endpoint payloads. No new endpoints.
 * ======================================================================== */

interface PlatformFeeRow {
  key: string;
  amountMinor: number;
  currency: string;
  billingPeriod?: string | null;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
}

interface DiscountCodeRow {
  code: string;
  kind: "percent" | "flat_minor" | "trial_extension_days";
  amount: number;
  expiresOn: string | null;
  maxRedemptions: number | null;
  active: boolean;
}

interface PricingModelRow {
  id: string;
  productLine: string;
  slug: string;
  name: string;
  status: string;
  currency: string;
  basePriceMinor: number;
  cadence: string;
  cadenceOptions: Array<{ cadence: string; priceMinor: number }>;
  discountCodes: DiscountCodeRow[];
  trial: { lengthDays: number; requiresCard: boolean; autoConvertToPlanId: string | null } | null;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

interface CollectiveConfigRow {
  id: string;
  slug: string;
  label: string;
  amountMinor: number;
  currency: string;
  interval: string;
  airwallexTier: string;
  airwallexPriceId: string;
  status: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

// D2.5 R1 fix (B-5 / FIX 5) — collective_subscription_configs.use_env_fallback is
// read by airwallexCollective.ts per airwallex_tier (basic|standard|premium), NOT
// per package id, and is fetched from its own admin route (below), not from
// /api/admin/collective-subscriptions.
interface EnvFallbackRow {
  tier: string;
  useEnvFallback: boolean;
  packageId: string;
  status: string;
}

interface TierRow {
  key?: string;
  slug: string;
  label?: string;
  amountMinor: number;
  currency: string;
  billingPeriod?: string | null;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  deprecated?: boolean;
}

interface InvoiceRow {
  id: string;
  companyId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  status?: string | null;
  issuedAt?: string | null;
}

interface PaymentRow {
  id: string;
  amountCents?: number | null;
  netCents?: number | null;
  discountCents?: number | null;
  couponCode?: string | null;
  state?: string | null;
  createdAt?: string | null;
}

/* Shared fetcher — every read goes through the existing admin API. */
function useAdminQuery<T>(url: string, enabled = true) {
  return useQuery<T>({
    queryKey: [url],
    enabled,
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return (await res.json()) as T;
    },
  });
}

/* ==========================================================================
 * TAB 1 — Capavate Annual Plan   (pricing_models, productLine=founder)
 * ======================================================================== */

/** The consolidated page manages exactly ONE live Capavate annual SKU. The
 *  audit's `product='capavate_annual'` framing maps onto the real column
 *  `pricing_models.product_line = 'founder'` with the canonical annual slug —
 *  see ASSUMPTIONS_SLICE_1.md #1. */
const CAPAVATE_ANNUAL_PRODUCT_LINE = "founder";

function CapavateAnnualTab() {
  const { toast } = useToast();
  const q = useAdminQuery<{ models: PricingModelRow[] }>(
    `/api/admin/pricing-models?productLine=${CAPAVATE_ANNUAL_PRODUCT_LINE}`,
  );
  const models = q.data?.models ?? [];
  const live = models.find((m) => m.status === "live") ?? models[0] ?? null;
  const [draftAnnual, setDraftAnnual] = useState<string | null>(null);
  // D2.5 R1 fix (D-1 / FIX 4) — "Create annual plan" draft form state. Slice 1
  // deleted PricingModels.tsx / PricingModelDetail.tsx, which were the ONLY
  // client UI that could call POST /api/admin/pricing-models or .../promote.
  // Without this, there was no product path to create the $840/year Capavate
  // annual plan Ozan approved on a fresh install (models.length === 0).
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState("capavate-annual");
  const [newName, setNewName] = useState("Capavate Annual");
  const [newPriceDraft, setNewPriceDraft] = useState("840.00");

  const annualMinor = useMemo(() => {
    if (!live) return null;
    const annual = live.cadenceOptions?.find((c) => c.cadence === "annual");
    return annual?.priceMinor ?? live.basePriceMinor ?? null;
  }, [live]);

  const save = useMutation({
    mutationFn: async (minor: number) => {
      if (!live) throw new Error("no_live_model");
      const res = await apiRequest("PATCH", `/api/admin/pricing-models/${live.id}`, {
        basePriceMinor: minor,
        cadenceOptions: [{ cadence: "annual", priceMinor: minor }],
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Capavate annual price updated" });
      setDraftAnnual(null);
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/pricing-models?productLine=${CAPAVATE_ANNUAL_PRODUCT_LINE}`],
      });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  // D2.5 R1 fix (D-1 / FIX 4) — restores POST /api/admin/pricing-models, the
  // pricing-model create endpoint Slice 1 orphaned. Creates a DRAFT model;
  // promote (below) is a separate explicit action so a new plan never goes
  // live by accident.
  const create = useMutation({
    mutationFn: async () => {
      const minor = majorToMinor(newPriceDraft);
      if (minor === null) throw new Error("Invalid amount — use a non-negative amount with at most 2 decimals.");
      if (!/^[a-z0-9-]+$/.test(newSlug)) throw new Error("Slug must be lowercase alphanumeric with dashes.");
      const res = await apiRequest("POST", "/api/admin/pricing-models", {
        productLine: CAPAVATE_ANNUAL_PRODUCT_LINE,
        slug: newSlug,
        name: newName,
        description: "Created from /admin/fees (D2.5 R1).",
        status: "draft",
        currency: "USD",
        basePriceMinor: minor,
        cadence: "annual",
        cadenceOptions: [{ cadence: "annual", priceMinor: minor }],
        currencyOverrides: [],
        regionalMultipliers: [],
        features: [],
        metering: [],
        volumeBrackets: [],
        discountCodes: [],
        trial: null,
        effectiveFrom: null,
        effectiveTo: null,
        grandfatherOnChange: false,
        taxInclusive: false,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Draft annual plan created", description: "Promote it to live when ready." });
      setShowCreate(false);
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/pricing-models?productLine=${CAPAVATE_ANNUAL_PRODUCT_LINE}`],
      });
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  // D2.5 R1 fix (D-1 / FIX 4) — restores POST /api/admin/pricing-models/:id/promote.
  const promote = useMutation({
    mutationFn: async (args: { id: string; to: string }) => {
      const res = await apiRequest("POST", `/api/admin/pricing-models/${args.id}/promote`, { to: args.to });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_data, args) => {
      toast({ title: `Promoted to ${args.to}` });
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/pricing-models?productLine=${CAPAVATE_ANNUAL_PRODUCT_LINE}`],
      });
    },
    onError: (e: Error) =>
      toast({ title: "Promote failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="tab-capavate-annual">
      <AppCard>
        <SectionTitle hint="The single Capavate founder annual SKU. Billing resolves this row through getPlanPriceStrict() and FAILS CLOSED (TierNotConfiguredError) when no live model exists — it never invents a price.">
          Capavate Annual Plan
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "pricing_models",
              column: "base_price_minor / cadence_options[annual].priceMinor",
              unit: "currency_minor (cents)",
              lastEditedAt: live?.updatedAt ?? null,
              lastEditedBy: live?.updatedBy ?? null,
              editableHere: true,
              readEndpoint: "GET /api/admin/pricing-models?productLine=founder",
              writeEndpoint: "PATCH /api/admin/pricing-models/:id",
              provenance: live ? `pricing_models v${live.version} (${live.status})` : null,
              testId: "capavate-annual-price",
            }}
          >
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !live ? (
              <div
                className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                data-testid="capavate-annual-not-configured"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  No live founder pricing model. Checkout will fail closed with{" "}
                  <code>TierNotConfiguredError</code> until one is published.
                </span>
              </div>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{live.name}</span>{" "}
                  <code>{live.slug}</code> · <Badge variant="secondary">{live.status}</Badge>
                </div>
                <div className="space-y-1.5 max-w-xs">
                  <Label htmlFor="capavate-annual-input">Annual price ({live.currency})</Label>
                  <Input
                    id="capavate-annual-input"
                    data-testid="input-capavate-annual"
                    inputMode="decimal"
                    value={draftAnnual ?? minorToMajor(annualMinor)}
                    onChange={(e) => setDraftAnnual(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored as {annualMinor ?? "—"} cents.
                  </p>
                </div>
                <Button
                  size="sm"
                  data-testid="button-save-capavate-annual"
                  disabled={save.isPending || draftAnnual === null}
                  onClick={() => {
                    const minor = majorToMinor(draftAnnual ?? "");
                    if (minor === null) {
                      toast({
                        title: "Invalid amount",
                        description: "Use a non-negative amount with at most 2 decimals.",
                        variant: "destructive",
                      });
                      return;
                    }
                    save.mutate(minor);
                  }}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </>
            )}
          </FieldWithSource>
        </div>
      </AppCard>

      <AppCard>
        <div className="flex items-start justify-between gap-4">
          <SectionTitle hint="Every founder pricing model row, including drafts and deprecated revisions. Create/promote/clone/delete keep their existing endpoints.">
            All founder pricing models
          </SectionTitle>
          <Button
            size="sm"
            variant="outline"
            data-testid="button-create-annual-plan"
            onClick={() => setShowCreate((s) => !s)}
          >
            {showCreate ? "Cancel" : "Create annual plan"}
          </Button>
        </div>

        {showCreate ? (
          <div
            className="mt-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3"
            data-testid="create-annual-plan-form"
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-plan-slug">Slug</Label>
              <Input
                id="new-plan-slug"
                data-testid="input-new-plan-slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-plan-name">Name</Label>
              <Input
                id="new-plan-name"
                data-testid="input-new-plan-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-plan-price">Annual price (USD)</Label>
              <Input
                id="new-plan-price"
                data-testid="input-new-plan-price"
                inputMode="decimal"
                value={newPriceDraft}
                onChange={(e) => setNewPriceDraft(e.target.value)}
              />
            </div>
            <div className="sm:col-span-3">
              <Button
                size="sm"
                data-testid="button-submit-create-annual-plan"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                Create as draft
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Creates a <code>draft</code> model. Use “Promote to live” below once it looks right — a
                new plan never goes live automatically.
              </p>
            </div>
          </div>
        ) : null}

        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Base price</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last edited</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  No pricing models.
                </TableCell>
              </TableRow>
            ) : (
              models.map((m) => (
                <TableRow key={m.id} data-testid={`row-pricing-model-${m.slug}`}>
                  <TableCell>
                    <code>{m.slug}</code>
                  </TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Badge variant={m.status === "live" ? "default" : "secondary"}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtUSD(m.basePriceMinor / 100, { currency: m.currency })}
                  </TableCell>
                  <TableCell>v{m.version}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(m.updatedAt ?? "").slice(0, 19).replace("T", " ")}
                    {m.updatedBy ? ` · ${m.updatedBy}` : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    {m.status === "draft" || m.status === "preview" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`button-promote-${m.slug}`}
                        disabled={promote.isPending}
                        onClick={() =>
                          promote.mutate({ id: m.id, to: m.status === "draft" ? "preview" : "live" })
                        }
                      >
                        Promote to {m.status === "draft" ? "preview" : "live"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * TAB 2 — Collective Tiers   (collective_subscription_configs)
 * ======================================================================== */

function CollectiveTiersTab() {
  const { toast } = useToast();
  const q = useAdminQuery<{ ok?: boolean; configs?: CollectiveConfigRow[]; packages?: CollectiveConfigRow[] }>(
    "/api/admin/collective-subscriptions",
  );
  const rows = q.data?.configs ?? q.data?.packages ?? [];

  const legacy = useAdminQuery<{ ok?: boolean; tiers?: TierRow[] }>(
    "/api/admin/collective/member-subscription-tiers",
  );
  const legacyTiers = legacy.data?.tiers ?? [];

  // D2.5 R1 fix (B-5 / FIX 5) — read side for the use_env_fallback toggle.
  const envFallbackQ = useAdminQuery<{ ok?: boolean; rows?: EnvFallbackRow[] }>(
    "/api/admin/collective-configs/env-fallback",
  );
  const envFallbackByTier = useMemo(() => {
    const map: Record<string, EnvFallbackRow> = {};
    for (const r of envFallbackQ.data?.rows ?? []) map[r.tier] = r;
    return map;
  }, [envFallbackQ.data]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (args: { id: string; amountMinor: number }) => {
      const res = await apiRequest("PATCH", `/api/admin/collective-subscriptions/${args.id}`, {
        amountMinor: args.amountMinor,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Collective tier updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-subscriptions"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  // D2.5 R1 fix (B-5 / FIX 5) — write side: PATCH /api/admin/collective-configs/:tier/env-fallback.
  // Zero Airwallex code touched — this only flips a plain SQLite column that
  // airwallexCollective.ts already knows how to read.
  const toggleEnvFallback = useMutation({
    mutationFn: async (args: { tier: string; useEnvFallback: boolean }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/collective-configs/${args.tier}/env-fallback`,
        { useEnvFallback: args.useEnvFallback },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_data, args) => {
      toast({
        title: args.useEnvFallback
          ? `${args.tier}: reverted to env-authoritative pricing`
          : `${args.tier}: switched to DB-authoritative pricing`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-configs/env-fallback"] });
    },
    onError: (e: Error) =>
      toast({ title: "Toggle failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="tab-collective-tiers">
      <AppCard>
        <SectionTitle hint="Admin-authored Collective membership packages. This is the CANONICAL Collective tier store — it is the only one carrying gateway price refs, and MembershipPage.tsx prefers it (source: 'admin').">
          Collective member tiers
        </SectionTitle>

        <div className="mt-4 space-y-6">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin-authored packages yet.</p>
          ) : (
            rows.map((r) => (
              <FieldWithSource
                key={r.id}
                source={{
                  table: "collective_subscription_configs",
                  column: "amount_minor",
                  unit: "currency_minor (cents)",
                  lastEditedAt: r.updatedAt ?? null,
                  lastEditedBy: r.updatedBy ?? null,
                  editableHere: true,
                  readEndpoint: "GET /api/admin/collective-subscriptions",
                  writeEndpoint: "PATCH /api/admin/collective-subscriptions/:id",
                  provenance: `admin (status: ${r.status})`,
                  testId: `collective-tier-${r.slug}`,
                }}
              >
                <div className="text-sm">
                  <span className="font-medium">{r.label}</span> <code>{r.slug}</code> ·{" "}
                  <Badge variant="secondary">{r.interval}</Badge>
                </div>
                <div className="space-y-1.5 max-w-xs">
                  <Label htmlFor={`ct-${r.id}`}>Amount ({r.currency})</Label>
                  <Input
                    id={`ct-${r.id}`}
                    data-testid={`input-collective-tier-${r.slug}`}
                    inputMode="decimal"
                    value={drafts[r.id] ?? minorToMajor(r.amountMinor)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  />
                </div>
                <div
                  className="flex items-start gap-2 rounded border border-border bg-muted/40 p-2 text-xs"
                  data-testid={`collective-tier-envnote-${r.slug}`}
                >
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Publishing is deploy-gated: the package amount must equal the
                    gateway tier amount resolved from{" "}
                    <code>AIRWALLEX_COLLECTIVE_{String(r.airwallexTier).toUpperCase()}_AMOUNT_MINOR</code>.
                    Changing the charged amount at the gateway boundary is Slice 3 / M14 —
                    not this page. Zero Airwallex code touched here.
                  </span>
                </div>

                {/* D2.5 R1 fix (B-5 / FIX 5) — use_env_fallback toggle. Off (unchecked) means
                   "trust the DB row above, ignore the AIRWALLEX_COLLECTIVE_*_AMOUNT_MINOR env var";
                   On (checked, the pre-Slice-3 default) means "env still wins". See
                   airwallexCollective.ts priceConfigForTier() for the read side. */}
                <div
                  className="flex items-center justify-between gap-3 rounded border border-border p-2"
                  data-testid={`collective-tier-envfallback-${r.slug}`}
                >
                  <div className="text-xs">
                    <div className="font-medium">Use env var as price fallback</div>
                    <div className="text-muted-foreground">
                      {envFallbackByTier[r.airwallexTier]?.useEnvFallback ?? true
                        ? "ON — checkout still prices from AIRWALLEX_COLLECTIVE_*_AMOUNT_MINOR, not the row above."
                        : "OFF — checkout prices from the admin row above (DB-authoritative)."}
                    </div>
                  </div>
                  <Switch
                    data-testid={`switch-envfallback-${r.slug}`}
                    checked={envFallbackByTier[r.airwallexTier]?.useEnvFallback ?? true}
                    disabled={toggleEnvFallback.isPending || envFallbackQ.isLoading}
                    onCheckedChange={(checked) =>
                      toggleEnvFallback.mutate({ tier: r.airwallexTier, useEnvFallback: checked })
                    }
                  />
                </div>

                <Button
                  size="sm"
                  data-testid={`button-save-collective-tier-${r.slug}`}
                  disabled={save.isPending || drafts[r.id] === undefined}
                  onClick={() => {
                    const minor = majorToMinor(drafts[r.id] ?? "");
                    if (minor === null) {
                      toast({ title: "Invalid amount", variant: "destructive" });
                      return;
                    }
                    save.mutate({ id: r.id, amountMinor: minor });
                  }}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </FieldWithSource>
            ))
          )}
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Legacy platform_fees rows for the same concept. Kept visible so admins understand why they exist — but they are NOT the tier a member is charged from.">
          Legacy <code>platform_fees</code> member-subscription rows
        </SectionTitle>
        <div className="mt-4 space-y-6">
          {legacyTiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">None configured.</p>
          ) : (
            legacyTiers.map((t) => (
              <FieldWithSource
                key={t.slug}
                source={{
                  table: "platform_fees",
                  column: "amount_minor",
                  unit: "currency_minor (cents)",
                  lastEditedAt: t.updatedAt ?? null,
                  lastEditedBy: t.updatedByUserId ?? null,
                  editableHere: false,
                  editableVia:
                    "read-only here — legacy row, superseded by collective_subscription_configs",
                  readEndpoint: "GET /api/admin/collective/member-subscription-tiers",
                  provenance: "platform_fees (legacy)",
                  deprecated: true,
                  testId: `collective-legacy-${t.slug}`,
                }}
              >
                <div className="text-sm">
                  <code>collective.member_subscription.{t.slug}</code> —{" "}
                  {fmtUSD(t.amountMinor / 100, { currency: t.currency })}{" "}
                  <Badge variant="outline">deprecated</Badge>
                </div>
              </FieldWithSource>
            ))
          )}
        </div>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * TAB 3 — Consortium Partner Promotions
 *   (platform_fees consortium.* tiers + partner_commission_rate_config +
 *    partner_fee_schedules + the tier-promotion action)
 * ======================================================================== */

function ConsortiumPromotionsTab() {
  const { toast } = useToast();
  const tiersQ = useAdminQuery<{ ok?: boolean; tiers?: TierRow[] }>(
    "/api/admin/consortium/subscription-tiers",
  );
  const spvQ = useAdminQuery<{ ok?: boolean; spvDeploymentFee?: TierRow }>(
    "/api/admin/consortium/spv-deployment-fee",
  );
  const ratesQ = useAdminQuery<{ ok?: boolean; rates?: Array<{ tier: string; rate: number; updatedAt?: string | null; updatedByUserId?: string | null }> }>(
    "/api/admin/partner/commission-rates",
  );
  const schedQ = useAdminQuery<{ ok?: boolean; schedules?: Array<Record<string, unknown>> }>(
    "/api/admin/partner-fees",
  );

  const tiers = tiersQ.data?.tiers ?? [];
  const spv = spvQ.data?.spvDeploymentFee ?? null;
  const rates = ratesQ.data?.rates ?? [];
  const schedules = schedQ.data?.schedules ?? [];

  const [tierDrafts, setTierDrafts] = useState<Record<string, string>>({});
  const [spvDraft, setSpvDraft] = useState<string | null>(null);

  const saveTier = useMutation({
    mutationFn: async (args: { slug: string; amountMinor: number }) => {
      const res = await apiRequest(
        "PUT",
        `/api/admin/consortium/subscription-tiers/${args.slug}`,
        { amountMinor: args.amountMinor },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Partner tier updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consortium/subscription-tiers"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const saveSpv = useMutation({
    mutationFn: async (amountMinor: number) => {
      const res = await apiRequest("PUT", "/api/admin/consortium/spv-deployment-fee", {
        amountMinor,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "SPV deployment fee updated" });
      setSpvDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consortium/spv-deployment-fee"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="tab-consortium-promotions">
      <AppCard>
        <SectionTitle hint="The canonical 5-tier partner ladder. A partner is 'promoted' onto one of these tiers via POST /api/admin/partners/:id/promote-tier from the partner detail page; the PRICE of each tier is edited here.">
          Partner subscription tiers (promotion ladder)
        </SectionTitle>
        <div className="mt-4 space-y-6">
          {tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tiers configured.</p>
          ) : (
            tiers.map((t) => (
              <FieldWithSource
                key={t.slug}
                source={{
                  table: "platform_fees",
                  column: "amount_minor",
                  unit: "currency_minor (cents)",
                  lastEditedAt: t.updatedAt ?? null,
                  lastEditedBy: t.updatedByUserId ?? null,
                  editableHere: true,
                  readEndpoint: "GET /api/admin/consortium/subscription-tiers",
                  writeEndpoint: "PUT /api/admin/consortium/subscription-tiers/:slug",
                  provenance: `platform_fees key consortium.subscription.${t.slug}`,
                  testId: `partner-tier-${t.slug}`,
                }}
              >
                <div className="text-sm">
                  <span className="font-medium">{t.label ?? t.slug}</span> <code>{t.slug}</code>
                </div>
                <div className="space-y-1.5 max-w-xs">
                  <Label htmlFor={`pt-${t.slug}`}>Amount ({t.currency})</Label>
                  <Input
                    id={`pt-${t.slug}`}
                    data-testid={`input-partner-tier-${t.slug}`}
                    inputMode="decimal"
                    value={tierDrafts[t.slug] ?? minorToMajor(t.amountMinor)}
                    onChange={(e) =>
                      setTierDrafts((d) => ({ ...d, [t.slug]: e.target.value }))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  data-testid={`button-save-partner-tier-${t.slug}`}
                  disabled={saveTier.isPending || tierDrafts[t.slug] === undefined}
                  onClick={() => {
                    const minor = majorToMinor(tierDrafts[t.slug] ?? "");
                    if (minor === null) {
                      toast({ title: "Invalid amount", variant: "destructive" });
                      return;
                    }
                    saveTier.mutate({ slug: t.slug, amountMinor: minor });
                  }}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </FieldWithSource>
            ))
          )}
        </div>
        <div
          className="mt-4 flex items-start gap-2 rounded border border-border bg-muted/40 p-3 text-xs"
          data-testid="partner-legacy-slug-map"
        >
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Legacy slug aliases still resolve for back-compat:{" "}
            <code>partner_basic → catalyst</code>, <code>partner_pro → builder</code>,{" "}
            <code>partner_enterprise → amplifier</code>. Unknown slugs fail closed.
            Source: <code>server/lib/partnerTiers.ts</code>.
          </span>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Flat fee charged when an SPV is deployed. The only fee-waiver capability on the platform applies to SPV fee obligations.">
          SPV deployment fee
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "platform_fees",
              column: "amount_minor",
              unit: "currency_minor (cents)",
              lastEditedAt: spv?.updatedAt ?? null,
              lastEditedBy: spv?.updatedByUserId ?? null,
              editableHere: true,
              readEndpoint: "GET /api/admin/consortium/spv-deployment-fee",
              writeEndpoint: "PUT /api/admin/consortium/spv-deployment-fee",
              provenance: "platform_fees key consortium.spv_deployment_fee",
              testId: "spv-deployment-fee",
            }}
          >
            <div className="space-y-1.5 max-w-xs">
              <Label htmlFor="spv-fee-input">Amount ({spv?.currency ?? "USD"})</Label>
              <Input
                id="spv-fee-input"
                data-testid="input-spv-deployment-fee"
                inputMode="decimal"
                value={spvDraft ?? minorToMajor(spv?.amountMinor)}
                onChange={(e) => setSpvDraft(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              data-testid="button-save-spv-deployment-fee"
              disabled={saveSpv.isPending || spvDraft === null}
              onClick={() => {
                const minor = majorToMinor(spvDraft ?? "");
                if (minor === null) {
                  toast({ title: "Invalid amount", variant: "destructive" });
                  return;
                }
                saveSpv.mutate(minor);
              }}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </FieldWithSource>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Per-tier partner commission. Stored as a FRACTION (0.10 = 10%) — the unit is stated because the audit found a percent/fraction mismatch across pages.">
          Partner commission rates
        </SectionTitle>
        <div className="mt-4 space-y-6">
          {rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rates configured.</p>
          ) : (
            rates.map((r) => (
              <FieldWithSource
                key={r.tier}
                source={{
                  table: "partner_commission_rate_config",
                  column: "rate",
                  unit: "fraction (0.10 = 10%)",
                  lastEditedAt: r.updatedAt ?? null,
                  lastEditedBy: r.updatedByUserId ?? null,
                  editableHere: false,
                  editableVia:
                    "PUT /api/admin/partner/commission-rates/:tier (endpoint preserved; editor lands with the partner-override component)",
                  readEndpoint: "GET /api/admin/partner/commission-rates",
                  testId: `commission-rate-${r.tier}`,
                }}
              >
                <div className="text-sm" data-testid={`commission-rate-value-${r.tier}`}>
                  <code>{r.tier}</code> — {(r.rate * 100).toFixed(2)}%{" "}
                  <span className="text-muted-foreground">(stored as {r.rate})</span>
                </div>
              </FieldWithSource>
            ))
          )}
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="partner_fee_schedules rows (fee_kind, tier or platform default, size bands, effective windows).">
          Partner fee schedules
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "partner_fee_schedules",
              column: "amount_minor / pct_bps",
              unit: "currency_minor (cents)",
              editableHere: false,
              editableVia:
                "POST/PATCH/DELETE /api/admin/partner-fees (endpoints preserved)",
              readEndpoint: "GET /api/admin/partner-fees",
              testId: "partner-fee-schedules",
            }}
          >
            <p className="text-sm" data-testid="partner-fee-schedule-count">
              {schedules.length} schedule row(s).
            </p>
          </FieldWithSource>
        </div>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * TAB 4 — Application Fee   (platform_fees['collective_application_fee'])
 * ======================================================================== */

const COLLECTIVE_APPLICATION_FEE_KEY = "collective_application_fee";

function ApplicationFeeTab() {
  const { toast } = useToast();
  const q = useAdminQuery<{ ok?: boolean; fees?: PlatformFeeRow[] }>(
    "/api/admin/platform-fees",
  );
  const row =
    (q.data?.fees ?? []).find((f) => f.key === COLLECTIVE_APPLICATION_FEE_KEY) ?? null;
  const [draft, setDraft] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (amountMinor: number) => {
      const res = await apiRequest(
        "PUT",
        `/api/admin/platform-fees/${COLLECTIVE_APPLICATION_FEE_KEY}`,
        { amountMinor },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Application fee updated" });
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-fees"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="tab-application-fee">
      <AppCard>
        <SectionTitle hint="ONE editor for the Collective founder application fee. The duplicate editor on the retired Application Fee page (which wrote display dollars into collective_application_fee_config) is DELETED in this slice.">
          Collective application fee
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "platform_fees",
              column: "amount_minor",
              unit: "currency_minor (cents)",
              lastEditedAt: row?.updatedAt ?? null,
              lastEditedBy: row?.updatedByUserId ?? null,
              editableHere: true,
              readEndpoint: "GET /api/admin/platform-fees",
              writeEndpoint: `PUT /api/admin/platform-fees/${COLLECTIVE_APPLICATION_FEE_KEY}`,
              provenance: `platform_fees key ${COLLECTIVE_APPLICATION_FEE_KEY}`,
              testId: "application-fee",
            }}
          >
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="space-y-1.5 max-w-xs">
                  <Label htmlFor="app-fee-input">Amount ({row?.currency ?? "USD"})</Label>
                  <Input
                    id="app-fee-input"
                    data-testid="input-application-fee"
                    inputMode="decimal"
                    value={draft ?? minorToMajor(row?.amountMinor)}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored as {row?.amountMinor ?? "—"} cents. Founders read it from{" "}
                    <code>GET /api/collective/application-fee</code>.
                  </p>
                </div>
                <Button
                  size="sm"
                  data-testid="button-save-application-fee"
                  disabled={save.isPending || draft === null}
                  onClick={() => {
                    const minor = majorToMinor(draft ?? "");
                    if (minor === null) {
                      toast({ title: "Invalid amount", variant: "destructive" });
                      return;
                    }
                    save.mutate(minor);
                  }}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </>
            )}
          </FieldWithSource>
        </div>
        <div
          className="mt-4 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="application-fee-mirror-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Known unit quirk (unchanged by this slice):{" "}
            <code>server/adminPlatformFeesRoutes.ts</code> mirror-writes this value into{" "}
            <code>collective_application_fee_config.amount_minor</code> as{" "}
            <code>Math.round(amountMinor / 100)</code> because that legacy table stores
            DISPLAY dollars. Lossy on non-round-dollar amounts. Reconciling the two
            tables needs a live-DB check (M2) and is not part of a UI-only slice.
          </span>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Every other platform_fees row, read-only, so admins can see the whole registry from one place.">
          Full <code>platform_fees</code> registry
        </SectionTitle>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Last edited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data?.fees ?? []).map((f) => (
              <TableRow key={f.key} data-testid={`row-platform-fee-${f.key}`}>
                <TableCell>
                  <code>{f.key}</code>
                </TableCell>
                <TableCell className="text-right">
                  {fmtUSD(f.amountMinor / 100, { currency: f.currency })}
                </TableCell>
                <TableCell>{f.currency}</TableCell>
                <TableCell>{f.billingPeriod ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {(f.updatedAt ?? "").slice(0, 19).replace("T", " ")}
                  {f.updatedByUserId ? ` · ${f.updatedByUserId}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * TAB 5 — Discount Codes   (pricing_models.discountCodes)
 * ======================================================================== */

function DiscountCodesTab() {
  const q = useAdminQuery<{ models: PricingModelRow[] }>("/api/admin/pricing-models");
  const models = q.data?.models ?? [];
  const withCodes = models.filter((m) => (m.discountCodes ?? []).length > 0);

  return (
    <div className="space-y-6" data-testid="tab-discount-codes">
      <AppCard>
        <div
          className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="discount-codes-orphan-warning"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            {/* D2.5 R1 fix (B-4 / FIX 6) — this copy was written for the pre-Slice-3
               world, where discount codes here were cosmetic. Slice 3 rewired
               server/paymentStore.ts's calcCouponDiscountCents() to call
               findDiscountCodeByCode() against THIS table (pricing_models.discountCodes)
               for every charge — the old hardcoded CP10/FOUNDER20/COLLECTIVE5 map is gone.
               Editing here now changes what a real checkout charges, immediately. */}
            <div className="font-semibold">These codes are LIVE — creating one applies immediately.</div>
            <p className="mt-1">
              <code>pricing_models.discountCodes</code> is read directly by{" "}
              <code>calcCouponDiscountCents</code> in <code>server/paymentStore.ts</code> on every
              charge (via <code>findDiscountCodeByCode</code>) — there is no separate
              hardcoded map anymore. A code you add, deactivate, or expire here takes effect
              on the very next checkout that uses it, across every pricing model and product line.
            </p>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Admin-authored discount codes across every pricing model.">
          Discount codes
        </SectionTitle>
        <div className="mt-4 space-y-6">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : withCodes.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="discount-codes-empty">
              No discount codes on any pricing model.
            </p>
          ) : (
            withCodes.map((m) => (
              <FieldWithSource
                key={m.id}
                source={{
                  table: "pricing_models",
                  column: "discount_codes_json",
                  unit: "text",
                  lastEditedAt: m.updatedAt ?? null,
                  lastEditedBy: m.updatedBy ?? null,
                  editableHere: true,
                  readEndpoint: "GET /api/admin/pricing-models",
                  writeEndpoint: "PATCH /api/admin/pricing-models/:id",
                  provenance: `pricing_models ${m.slug} v${m.version}`,
                  testId: `discount-codes-${m.slug}`,
                }}
              >
                <div className="text-sm font-medium">
                  {m.name} <code>{m.slug}</code>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Max redemptions</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(m.discountCodes ?? []).map((c) => (
                      <TableRow key={c.code} data-testid={`row-discount-code-${c.code}`}>
                        <TableCell>
                          <code>{c.code}</code>
                        </TableCell>
                        <TableCell>{c.kind}</TableCell>
                        <TableCell className="text-right">
                          {c.kind === "percent"
                            ? `${c.amount}%`
                            : c.kind === "flat_minor"
                              ? fmtUSD(c.amount / 100, { currency: m.currency })
                              : `${c.amount} days`}
                        </TableCell>
                        <TableCell>{c.expiresOn ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {c.maxRedemptions ?? "∞"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.active ? "default" : "secondary"}>
                            {c.active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </FieldWithSource>
            ))
          )}
        </div>
      </AppCard>

      <AppCard>
        {/* D2.5 R1 fix (B-4 / FIX 6) — this card described a hardcoded map in
           server/paymentStore.ts that Slice 3 removed; calcCouponDiscountCents now
           delegates to findDiscountCodeByCode() over the admin-authored table above,
           so a separate "hardcoded coupon map" card would be actively misleading.
           CP10 / FOUNDER20 / COLLECTIVE5 still resolve identically today only because
           Slice 3 seeded them as real rows on a draft carrier model — see the note below. */}
        <SectionTitle hint="The legacy CP10/FOUNDER20/COLLECTIVE5 codes still work — not because of source code anymore, but because Slice 3 seeded them as real rows on a draft carrier pricing model so their public behavior wouldn't change.">
          Legacy code compatibility
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "pricing_models (draft carrier row, seedLegacyCouponCodesIfMissing)",
              column: "discount_codes_json",
              unit: "text",
              editableHere: false,
              editableVia: "same table as above — edit via the pricing model that owns each code",
              readEndpoint: "GET /api/admin/pricing-models",
              testId: "legacy-coupon-compat",
            }}
          >
            <p className="text-sm" data-testid="hardcoded-coupon-list">
              <code>CP10</code> = 10% · <code>FOUNDER20</code> = 20% ·{" "}
              <code>COLLECTIVE5</code> = 5%. This carrier model is kept as{" "}
              <code>status: draft</code> on purpose so it never appears on public pricing
              or admin “live plan” surfaces — only the coupon lookup sees it.
            </p>
          </FieldWithSource>
        </div>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * TAB 6 — Ledger & Invoices   (invoices + payment_ledger + P&L views)
 * ======================================================================== */

function LedgerInvoicesTab() {
  const { toast } = useToast();
  const invQ = useAdminQuery<{ ok?: boolean; invoices?: InvoiceRow[] }>(
    "/api/admin/invoices",
  );
  const payQ = useAdminQuery<{ ok?: boolean; payments?: PaymentRow[]; entries?: PaymentRow[] }>(
    "/api/admin/payments",
  );
  const partnerPlQ = useAdminQuery<{ ok?: boolean; entries?: Array<Record<string, unknown> & { id?: string; status?: string }> }>(
    "/api/admin/partner-pl",
  );
  const collPlQ = useAdminQuery<{ ok?: boolean; entries?: Array<Record<string, unknown> & { id?: string; status?: string }> }>(
    "/api/admin/collective-payments/pl",
  );

  const invoices = invQ.data?.invoices ?? [];
  const payments = payQ.data?.payments ?? payQ.data?.entries ?? [];
  const partnerPlEntries = partnerPlQ.data?.entries ?? [];
  const collPlEntries = collPlQ.data?.entries ?? [];

  // D2.5 R1 fix (D-1 / FIX 4) — restores POST /api/admin/invoices/:id/refund,
  // orphaned when Pricing.tsx was deleted. Always confirms before POSTing
  // since this is a money-moving action (per this tab's own section hint).
  const refund = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${invoiceId}/refund`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice refunded" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
    },
    onError: (e: Error) =>
      toast({ title: "Refund failed", description: e.message, variant: "destructive" }),
  });

  // D2.5 R1 fix (D-1 / FIX 4) — restores the two mark-paid money actions
  // orphaned when PartnerPL.tsx / CollectivePaymentPL.tsx were deleted.
  const markPartnerPaid = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await apiRequest("POST", `/api/admin/partner-pl/${entryId}/mark-paid`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Partner entry marked paid" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-pl"] });
    },
    onError: (e: Error) =>
      toast({ title: "Mark-paid failed", description: e.message, variant: "destructive" }),
  });

  const markCollectivePaid = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await apiRequest("POST", `/api/admin/collective-payments/pl/${entryId}/mark-paid`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Collective entry marked paid" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective-payments/pl"] });
    },
    onError: (e: Error) =>
      toast({ title: "Mark-paid failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="tab-ledger-invoices">
      <AppCard>
        <SectionTitle hint="Cross-product ledger. Replaces the standalone Payments, Partner P&L and Collective P&L pages — same endpoints, one screen.">
          Ledger
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Stat label="Payment ledger entries" value={payments.length} testId="stat-payments" />
          <Stat
            label="Partner billing entries"
            value={(partnerPlQ.data?.entries ?? []).length}
            testId="stat-partner-pl"
          />
          <Stat
            label="Collective payment entries"
            value={(collPlQ.data?.entries ?? []).length}
            testId="stat-collective-pl"
          />
        </div>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "payment_ledger / partner_billing_entries / collective_payment_entries",
              column: "amount_cents, net_cents, state",
              unit: "currency_minor (cents)",
              editableHere: true,
              editableVia:
                "row actions below — POST /api/admin/partner-pl/:id/mark-paid, POST /api/admin/collective-payments/pl/:id/mark-paid",
              readEndpoint:
                "GET /api/admin/payments · /api/admin/partner-pl · /api/admin/collective-payments/pl",
              writeEndpoint:
                "POST /api/admin/partner-pl/:id/mark-paid · POST /api/admin/collective-payments/pl/:id/mark-paid",
              testId: "ledger",
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      No ledger entries.
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.slice(0, 50).map((p) => (
                    <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                      <TableCell>
                        <code>{p.id}</code>
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtUSD((p.amountCents ?? 0) / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtUSD((p.discountCents ?? 0) / 100)}
                        {p.couponCode ? ` (${p.couponCode})` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtUSD((p.netCents ?? 0) / 100)}
                      </TableCell>
                      <TableCell>{p.state ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </FieldWithSource>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium mb-2">Partner billing entries</p>
            <Table data-testid="table-partner-pl">
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partnerPlEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      No partner billing entries.
                    </TableCell>
                  </TableRow>
                ) : (
                  partnerPlEntries.slice(0, 25).map((e) => {
                    const id = String(e.id ?? "");
                    const status = String(e.status ?? "—");
                    const isPaid = status === "paid";
                    return (
                      <TableRow key={id} data-testid={`row-partner-pl-${id}`}>
                        <TableCell>
                          <code>{id}</code>
                        </TableCell>
                        <TableCell>{status}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPaid || markPartnerPaid.isPending}
                            data-testid={`button-mark-paid-partner-${id}`}
                            onClick={() => markPartnerPaid.mutate(id)}
                          >
                            {isPaid ? "Paid" : "Mark paid"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Collective payment entries</p>
            <Table data-testid="table-collective-pl">
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collPlEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      No collective payment entries.
                    </TableCell>
                  </TableRow>
                ) : (
                  collPlEntries.slice(0, 25).map((e) => {
                    const id = String(e.id ?? "");
                    const status = String(e.status ?? "—");
                    const isPaid = status === "paid";
                    return (
                      <TableRow key={id} data-testid={`row-collective-pl-${id}`}>
                        <TableCell>
                          <code>{id}</code>
                        </TableCell>
                        <TableCell>{status}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPaid || markCollectivePaid.isPending}
                            data-testid={`button-mark-paid-collective-${id}`}
                            onClick={() => markCollectivePaid.mutate(id)}
                          >
                            {isPaid ? "Paid" : "Mark paid"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Refund is a money-moving action and always asks for confirmation before POSTing.">
          Invoices
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "invoices",
              column: "amount_minor, status",
              unit: "currency_minor (cents)",
              editableHere: true,
              editableVia:
                "row actions below — GET /api/admin/invoices/:id/pdf, POST /api/admin/invoices/:id/refund",
              readEndpoint: "GET /api/admin/invoices",
              writeEndpoint: "POST /api/admin/invoices/:id/refund",
              testId: "invoices",
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No invoices.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.slice(0, 50).map((inv) => {
                    const isPaid = inv.status === "paid";
                    return (
                      <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                        <TableCell>
                          <code>{inv.id}</code>
                        </TableCell>
                        <TableCell>
                          {inv.companyId ? (
                            <Link
                              href={`/admin/companies/${inv.companyId}`}
                              className="text-primary hover:underline"
                              data-testid={`link-company-${inv.companyId}`}
                            >
                              {inv.companyId}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtUSD((inv.amountMinor ?? 0) / 100, {
                            currency: inv.currency ?? "USD",
                          })}
                        </TableCell>
                        <TableCell>{inv.status ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {(inv.issuedAt ?? "").slice(0, 10)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isPaid || refund.isPending}
                            data-testid={`button-refund-invoice-${inv.id}`}
                            onClick={() => {
                              const amt = fmtUSD((inv.amountMinor ?? 0) / 100, {
                                currency: inv.currency ?? "USD",
                              });
                              if (
                                window.confirm(
                                  `Refund invoice ${inv.id} for ${amt}? This moves real money and cannot be undone from this screen.`,
                                )
                              ) {
                                refund.mutate(inv.id);
                              }
                            }}
                          >
                            {isPaid ? "Refund" : "Refund (not paid)"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </FieldWithSource>
        </div>
      </AppCard>
    </div>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

/* ==========================================================================
 * TAB 7 — Config   (trial · grace · dunning schedule)
 * ======================================================================== */

function ConfigTab() {
  const q = useAdminQuery<{ models: PricingModelRow[] }>(
    `/api/admin/pricing-models?productLine=${CAPAVATE_ANNUAL_PRODUCT_LINE}`,
  );
  const models = q.data?.models ?? [];
  const live = models.find((m) => m.status === "live") ?? models[0] ?? null;

  /* READ-ONLY. Retiring /admin/pricing removed the only client consumer of
   * this endpoint; mirroring it here keeps the capability without touching
   * the sacred adapter. GET only — there is no mutation for gateway config
   * anywhere on this page. */
  const gwQuery = useAdminQuery<{
    ok: boolean;
    gateway: {
      name: string;
      mode: string;
      supportedMethods: string[];
      webhookUrl: string;
      version: string;
    };
  }>("/api/admin/payment-gateway/config");
  const gw = gwQuery.data?.gateway ?? null;
  const gwLoading = gwQuery.isLoading;

  return (
    <div className="space-y-6" data-testid="tab-config">
      <AppCard>
        <SectionTitle hint="Trial length is read live by startSubscription() for the founder plan (Slice 3 Fix 2). Editing it here changes new founder signups immediately — the managed-founder path is a separate ?? 90 default not yet wired to this field.">
          Trial
        </SectionTitle>
        <div className="mt-4 space-y-6">
          <FieldWithSource
            source={{
              table: "pricing_models",
              column: "trial_json.lengthDays",
              unit: "integer (days)",
              lastEditedAt: live?.updatedAt ?? null,
              lastEditedBy: live?.updatedBy ?? null,
              editableHere: true,
              readEndpoint: "GET /api/admin/pricing-models?productLine=founder",
              writeEndpoint: "PATCH /api/admin/pricing-models/:id",
              provenance: live ? `pricing_models ${live.slug}` : null,
              testId: "trial-length",
            }}
          >
            <p className="text-sm" data-testid="trial-length-value">
              Configured trial length:{" "}
              <strong>{live?.trial?.lengthDays ?? "not set"}</strong>{" "}
              {live?.trial ? "day(s)" : ""}
            </p>
            {/* D2.5 R1 fix (B-4.3 / FIX 6) — the old copy said trial length was
               "not yet consumed by billing" for BOTH paths. That stopped being true for
               the founder path when Slice 3 Fix 2 added resolvePlanTrialDaysOrNull() to
               subscriptionsStore.ts — startSubscription() now reads this field first and
               only falls back to ?? 14 if no live model / no trial is configured. The
               managed-founder ?? 90 default (managedFounderStore.ts) is still NOT wired
               to this field, so that half of the old warning is kept, narrowed to just it. */}
            <div
              className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
              data-testid="trial-not-wired-warning"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Editing the trial length affects new founder signups immediately —{" "}
                <code>server/subscriptionsStore.ts</code>'s <code>startSubscription()</code>{" "}
                reads this field first and only falls back to <code>?? 14</code> if no live
                model or no trial is configured. The separate managed-founder path
                (<code>server/managedFounderStore.ts</code>, <code>?? 90</code>) is not wired
                to this field yet.
              </span>
            </div>
          </FieldWithSource>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="Stated honestly: there is no grace-period column, constant, or worker for Capavate founder fees anywhere in the tree.">
          Grace period
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "— none (not implemented)",
              column: "—",
              unit: "integer (days)",
              editableHere: false,
              editableVia:
                "nothing to edit — no grace logic exists. Blocked on Ozan's policy decision (M17).",
              testId: "grace-period",
            }}
          >
            <p className="text-sm" data-testid="grace-period-value">
              <strong>Not configured.</strong> No <code>grace_period_days</code> field, no
              worker, and no server-side non-payment enforcement for Capavate founder
              annual fees exists today. Shipping an editable knob here would wire a
              control to nothing — deliberately deferred.
            </p>
          </FieldWithSource>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="The only dunning worker on the platform is Collective-only and env-gated OFF by default.">
          Dunning schedule
        </SectionTitle>
        <div className="mt-4 space-y-6">
          <FieldWithSource
            source={{
              table: "— none (environment variables)",
              column:
                "COLLECTIVE_RENEWAL_WORKER_ENABLED, COLLECTIVE_RENEWAL_POLL_MS, COLLECTIVE_RENEWAL_LEAD_SEC",
              unit: "integer (count)",
              editableHere: false,
              editableVia: "deploy environment — server/lib/collectiveRenewalWorker.ts",
              testId: "dunning-schedule",
            }}
          >
            <ul className="text-sm space-y-1" data-testid="dunning-schedule-values">
              <li>
                Worker enabled: gated on{" "}
                <code>COLLECTIVE_RENEWAL_WORKER_ENABLED === "1"</code> (OFF by default).
              </li>
              <li>
                Poll interval: <code>COLLECTIVE_RENEWAL_POLL_MS</code> (default 60000 ms).
              </li>
              <li>
                Lead window: <code>COLLECTIVE_RENEWAL_LEAD_SEC</code> (default 86400 s).
              </li>
              <li>
                Failures before <code>past_due</code>:{" "}
                <strong>3</strong> — hard-coded{" "}
                <code>MAX_CONSECUTIVE_FAILURES</code>.
              </li>
              <li>Capavate founder equivalent: none.</li>
            </ul>
          </FieldWithSource>
        </div>
      </AppCard>

      <AppCard>
        <SectionTitle hint="STRICTLY READ-ONLY mirror of the gateway adapter's own two GET endpoints. This panel exists because retiring the old Pricing &amp; Billing page removed the ONLY client consumer of GET /api/admin/payment-gateway/config and /webhook-events; dropping it would have been a silent functional regression, not a consolidation. Nothing here writes, and the gateway adapter is untouched (sacred).">
          Payment gateway (read-only)
        </SectionTitle>
        <div className="mt-4">
          <FieldWithSource
            source={{
              table: "(none — in-process adapter state, not a table)",
              column: "gatewayConfig()",
              unit: "text",
              editableHere: false,
              editableVia:
                "NOT editable anywhere in the fee area — shown only so an admin reconciling a fee against a charge can see which gateway and which mode (test/live) that charge went through. Gateway selection/mode is owned by server/paymentGatewayAdapter.ts (SACRED FILE) and its env vars; provider credentials live under /admin/integrations.",
              readEndpoint: "GET /api/admin/payment-gateway/config",
              testId: "payment-gateway-config",
            }}
          >
            {gwLoading ? (
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            ) : gw ? (
              <dl
                className="grid gap-2 text-sm sm:grid-cols-[160px_minmax(0,1fr)]"
                data-testid="gateway-config-values"
              >
                <dt className="text-muted-foreground">Gateway</dt>
                <dd className="font-medium" data-testid="gateway-name">{gw.name}</dd>
                <dt className="text-muted-foreground">Mode</dt>
                <dd>
                  <Badge
                    variant={gw.mode === "live" ? "default" : "secondary"}
                    data-testid="gateway-mode"
                  >
                    {String(gw.mode).toUpperCase()}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Supported methods</dt>
                <dd className="flex flex-wrap gap-1">
                  {(gw.supportedMethods ?? []).map((m) => (
                    <Badge key={m} variant="outline" className="text-[10px]">
                      {m}
                    </Badge>
                  ))}
                </dd>
                <dt className="text-muted-foreground">Webhook endpoint</dt>
                <dd>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{gw.webhookUrl}</code>
                </dd>
                <dt className="text-muted-foreground">Adapter version</dt>
                <dd>{gw.version}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="gateway-config-unavailable">
                Gateway config unavailable.
              </p>
            )}
            <Link
              href="/admin/integrations"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              data-testid="link-admin-integrations"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Configure providers — <code>/admin/integrations</code>
            </Link>
          </FieldWithSource>
        </div>
      </AppCard>
    </div>
  );
}

/* ==========================================================================
 * Shell
 * ======================================================================== */

const TABS = [
  { key: "capavate-annual", label: "Capavate Annual Plan" },
  { key: "collective-tiers", label: "Collective Tiers" },
  { key: "consortium-promotions", label: "Consortium Partner Promotions" },
  { key: "application-fee", label: "Application Fee" },
  { key: "discount-codes", label: "Discount Codes" },
  { key: "ledger-invoices", label: "Ledger & Invoices" },
  { key: "config", label: "Config" },
] as const;

export default function AdminFeesConsolidated() {
  const [tab, setTab] = useState<string>(TABS[0].key);

  return (
    <div data-testid="admin-fees-consolidated">
      <PageHeader
        title="Fees & Billing"
        description="One page for every fee on the platform. All amounts are stored in TRUE minor units (cents) and displayed in dollars. Every editable field names its own source table, column and unit."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Fees" }]}
      />
      <PageBody>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto" data-testid="admin-fees-tablist">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`tab-trigger-${t.key}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="capavate-annual" className="mt-4">
            <CapavateAnnualTab />
          </TabsContent>
          <TabsContent value="collective-tiers" className="mt-4">
            <CollectiveTiersTab />
          </TabsContent>
          <TabsContent value="consortium-promotions" className="mt-4">
            <ConsortiumPromotionsTab />
          </TabsContent>
          <TabsContent value="application-fee" className="mt-4">
            <ApplicationFeeTab />
          </TabsContent>
          <TabsContent value="discount-codes" className="mt-4">
            <DiscountCodesTab />
          </TabsContent>
          <TabsContent value="ledger-invoices" className="mt-4">
            <LedgerInvoicesTab />
          </TabsContent>
          <TabsContent value="config" className="mt-4">
            <ConfigTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </div>
  );
}
