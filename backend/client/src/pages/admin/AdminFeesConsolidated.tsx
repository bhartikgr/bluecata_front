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
/* WAVE 4A (RS-1/RS-2) — ISO-4217-aware minor-unit helpers. The restored
   schedule editors below convert MAJOR→minor with toMinor(), never a
   hardcoded ×100, preserving the v25.37/v25.40 currency fixes. */
import {
  labelFor,
  FEE_KIND_LABELS,
  CADENCE_LABELS,
  SCOPE_KIND_LABELS,
} from "@/lib/collectiveLabels";
/* WAVE 3A (P-1) — the ONE shared fraction→percent display helper. Storage is
   unchanged and stays fractional; only the render gains the missing ×100. */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
import { currencyExponent, formatMinor, fromMinor, toMinor } from "@/lib/currency";
import { minorToMajorString } from "@/lib/moneyDisplay";

/* ==========================================================================
 * Money helpers (single implementation for the whole fee area — the audit's
 * 2.1 finding was that every page re-implemented its own unit conversion).
 * ======================================================================== */

/** minor units → major-unit string for an <Input value>.
 *  WAVE 21 ITEM 5: `currency` is now a parameter and the exponent comes
 *  from ISO 4217. Defaulting to USD preserves every existing call site
 *  byte-for-byte while making a JPY form correct once the currency is
 *  threaded through (see the report for the call sites still to thread). */
export function minorToMajor(minor: number | null | undefined, currency = "USD"): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  return minorToMajorString(minor, currency);
}

/** major-unit dollar string → minor units (cents). null when invalid. */
export function majorToMinor(s: string, currency = "USD"): number | null {
  const raw = (s ?? "").trim();
  /* WAVE 21 ITEM 5: was a hardcoded 2-decimal guard. */
  const _exp = currencyExponent(currency);
  if (!new RegExp(_exp > 0 ? `^\\d+(\\.\\d{1,${_exp}})?$` : "^\\d+$").test(raw)) return null;
  /* WAVE 21 ITEM 5: parse partner must scale by the SAME exponent the
     display side used, or an edit round-trip silently rescales. */
  const cents = toMinor(Number(raw), currency);
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
  /* WAVE 3A (P-1) — `pricing_models.discount_codes_json.amount` is polymorphic:
     its unit depends on the row's `kind`. It was previously signed as "text",
     which told an admin nothing and let the percent/fraction ambiguity survive.
     00_SHARED_STANDARDS.md §1.1 requires the convention to be named. */
  | "discount amount — percent: fraction (1 = 100%, 0.3 = 30%) · flat_minor: currency_minor (cents) · trial_extension_days: integer (days)"
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

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 14 / FE-16 — RENEWAL WORKER CONFIG EDITOR.
 *
 * REPLACES a read-only list that printed four environment-variable NAMES and the
 * word "hard-coded" as its account of how Collective renewal billing is
 * controlled. Those four values decide whether members are charged, how often,
 * how far ahead, and how many gateway failures precede a `past_due` flip — so
 * "not editable anywhere in the product" was the defect, not a documentation gap.
 *
 * The bounds on each input are the SAME bounds the table's CHECK constraints
 * enforce. The database remains the fence; these are only there so an admin gets
 * a sentence instead of a constraint error.
 * ═══════════════════════════════════════════════════════════════════════════ */

interface RenewalWorkerConfigWire {
  enabled: boolean;
  pollIntervalMs: number;
  leadWindowSec: number;
  maxConsecutiveFailures: number;
  quietAfterWriteMin: number;
  envOverrideAllowed: boolean;
  source: "db_row" | "env_override" | "missing_row_fail_closed";
  updatedAt: string | null;
  updatedBy: string | null;
}

const RENEWAL_FIELD_BOUNDS: Record<string, { min: number; max: number; label: string; help: string }> = {
  pollIntervalMs: { min: 1000, max: 86_400_000, label: "Poll interval (ms)", help: "How often the worker sweeps for due renewals." },
  leadWindowSec: { min: 0, max: 2_592_000, label: "Lead window (seconds)", help: "How far before period end a renewal is minted." },
  maxConsecutiveFailures: { min: 1, max: 100, label: "Failures before past_due", help: "Consecutive gateway errors on one row before it is escalated." },
  quietAfterWriteMin: { min: 0, max: 1440, label: "Quiet window (minutes)", help: "A row just touched by a renewal is skipped for this long, so a slow webhook does not cause repeat intents." },
};

function RenewalWorkerConfigEditor() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Partial<RenewalWorkerConfigWire> | null>(null);

  const cfgQuery = useQuery<{ ok: boolean; config: RenewalWorkerConfigWire; envValue: string | null; running: boolean }>({
    queryKey: ["/api/admin/collective/renewal-worker-config"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/collective/renewal-worker-config")).json(),
  });

  const save = useMutation({
    mutationFn: async (body: Partial<RenewalWorkerConfigWire>) =>
      (await apiRequest("PUT", "/api/admin/collective/renewal-worker-config", body)).json(),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/renewal-worker-config"] });
      setDraft(null);
      toast({
        title: "Renewal worker configuration saved",
        description: data?.overridden
          ? "Saved — but the environment variable is still overriding the stored value. Turn off env override to make the database final."
          : (data?.appliesAt ?? "Applies on the next sweep."),
        variant: data?.overridden ? "destructive" : undefined,
      });
    },
    onError: (e: unknown) =>
      toast({ title: "Not saved", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  if (cfgQuery.isLoading) {
    return <div className="h-4 w-48 animate-pulse rounded bg-muted" data-testid="renewal-worker-config-loading" />;
  }
  if (cfgQuery.isError || !cfgQuery.data) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="renewal-worker-config-error">
        Could not read the renewal worker configuration. The worker treats an unreadable configuration row as DISABLED, so
        no renewals are being minted while this is the case.
      </p>
    );
  }
  const cfg = cfgQuery.data.config;
  const eff = <K extends keyof RenewalWorkerConfigWire>(k: K): RenewalWorkerConfigWire[K] =>
    (draft && k in draft ? (draft[k] as RenewalWorkerConfigWire[K]) : cfg[k]);
  const dirty = draft !== null && Object.keys(draft).length > 0;

  return (
    <div className="space-y-4" data-testid="renewal-worker-config-editor">
      {cfg.source === "env_override" && (
        <div className="rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm" data-testid="renewal-worker-env-override">
          <strong>The environment is overriding the stored setting.</strong> <code>COLLECTIVE_RENEWAL_WORKER_ENABLED</code> is{" "}
          <code>{cfgQuery.data.envValue ?? "unset"}</code>, and this row permits env override, so the effective state is{" "}
          <strong>{cfg.enabled ? "ENABLED" : "DISABLED"}</strong> regardless of what is saved below. Clear "allow environment
          override" to make the database final.
        </div>
      )}
      {cfg.source === "missing_row_fail_closed" && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm" data-testid="renewal-worker-fail-closed">
          <strong>No configuration row.</strong> The worker fails closed and is minting no renewals. Run the pending
          migrations to restore the singleton row.
        </div>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!eff("enabled")}
          onChange={(e) => setDraft((d) => ({ ...(d ?? {}), enabled: e.target.checked }))}
          data-testid="input-renewal-worker-enabled"
        />
        <span>
          <strong>Renewal worker enabled</strong>
          <span className="block text-xs text-muted-foreground">
            When off, no Collective renewal intents are minted at all. Effective state is shown above if the environment is
            overriding this.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(RENEWAL_FIELD_BOUNDS) as Array<keyof typeof RENEWAL_FIELD_BOUNDS>).map((key) => {
          const b = RENEWAL_FIELD_BOUNDS[key];
          const value = eff(key as keyof RenewalWorkerConfigWire) as number;
          const invalid = !Number.isSafeInteger(Number(value)) || Number(value) < b.min || Number(value) > b.max;
          return (
            <div key={key}>
              <Label htmlFor={`renewal-${key}`} className="text-xs">
                {b.label}
              </Label>
              <Input
                id={`renewal-${key}`}
                value={String(value ?? "")}
                inputMode="numeric"
                className={invalid ? "border-destructive" : ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...(d ?? {}), [key]: e.target.value === "" ? "" : Number(e.target.value) }))
                }
                data-testid={`input-renewal-${key}`}
              />
              <p className="mt-1 text-xs text-muted-foreground">{b.help}</p>
              {invalid && (
                <p className="mt-1 text-xs text-destructive" data-testid={`renewal-${key}-invalid`}>
                  Must be a whole number between {b.min} and {b.max} — the same range the database enforces.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!eff("envOverrideAllowed")}
          onChange={(e) => setDraft((d) => ({ ...(d ?? {}), envOverrideAllowed: e.target.checked }))}
          data-testid="input-renewal-env-override-allowed"
        />
        <span>
          <strong>Allow environment override</strong>
          <span className="block text-xs text-muted-foreground">
            Kept deliberately: it is the emergency off-switch for an operator without console access. While this is on, the
            environment variable can flip the worker regardless of the setting above — and every such override is logged by
            name so it is never silent.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft ?? {})}
          data-testid="button-save-renewal-worker-config"
        >
          Save
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} data-testid="button-reset-renewal-worker-config">
            Discard changes
          </Button>
        )}
        <span className="text-xs text-muted-foreground" data-testid="renewal-worker-config-provenance">
          Stored {cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : "never"}
          {cfg.updatedBy ? ` by ${cfg.updatedBy}` : ""} · applies on the next sweep, no restart
        </span>
      </div>
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
                    {formatMinor(m.basePriceMinor, m.currency || "USD")}
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
                  {formatMinor(t.amountMinor, t.currency || "USD")}{" "}
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
            Source: <code>server/lib/partnerTiers.ts</code>.{" "}
            {/* WAVE 7 X-C3 — the alias RESOLVES but no longer has a price row of
                its own. Said out loud here because an admin who remembers the
                $2,499 line disappearing from the list above deserves to know it
                was retired on purpose and what legacy partners are billed now. */}
            {/* WAVE 7B A-21 — owner ruling: all three legacy rows are stale in
                the same way, so all three are now retired. The alias MAP above
                is deliberately kept; only the duplicate price rows are gone. */}
            None of the three legacy slugs has its own subscription-tier row any
            more: <strong>partner_enterprise</strong> was retired by migration
            0163, and <strong>partner_basic</strong> and{" "}
            <strong>partner_pro</strong> by migration 0164, because each merely
            duplicated the price of the canonical tier it aliases
            (<code>amplifier</code> $1,499, <code>catalyst</code> $499,{" "}
            <code>builder</code> $999). A partner still carrying a legacy slug is
            billed at its canonical tier's price — no partner's price changed.
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
              /* WAVE 5 / P-9 — `pct_bps` was a PHANTOM COLUMN. It does not exist
               * on partner_fee_schedules (server/db/connection.ts:1964-1983
               * declares `amount_minor INTEGER NOT NULL` and no percent column at
               * all) and appears in no migration. This provenance label is the
               * admin's map of where a number comes from, so a column named here
               * that does not exist sends an operator hunting for a rate that is
               * not stored — or, worse, invites someone to "restore" a basis-point
               * column and split the fee representation in two. The percent-shaped
               * partner number lives in a DIFFERENT table,
               * partner_commission_rate_config.rate, and is already rendered
               * correctly as a FRACTION × 100 a few lines above (:1146). Corrected
               * to the columns that actually exist. */
              column: "amount_minor (fixed fee, integer minor units)",
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
                  {formatMinor(f.amountMinor, f.currency || "USD")}
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
        <SectionTitle hint="Admin-authored discount codes across every pricing model. Percent codes are STORED AS A FRACTION (1 = 100% off, 0.3 = 30% off) — the same fraction server/paymentStore.ts multiplies the charge by — and are DISPLAYED as a percent. Enter a percent code as percent-as-written: type 100 for 100%.">
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
                  /* WAVE 3A (P-1) — the unit is now named, per
                     00_SHARED_STANDARDS.md §1.1 ("any spec that states a
                     percentage unit must name which convention it means").
                     `amount` for kind=percent is a FRACTION; kind=flat_minor is
                     currency minor units; kind=trial_extension_days is days. */
                  unit: "discount amount — percent: fraction (1 = 100%, 0.3 = 30%) · flat_minor: currency_minor (cents) · trial_extension_days: integer (days)",
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
                          {/* WAVE 3A (P-1, DEF-007) — `c.amount` is stored as a
                              FRACTION (VIP = 1 is 100% off, YC2025 = 0.3 is 30%)
                              and the charge path multiplies by it directly
                              (server/paymentStore.ts:166). This render printed
                              the raw fraction with a % sign, so a 100%-off code
                              read "1%" on screen. Storage is untouched; the ×100
                              belongs here, in the display. */}
                          {c.kind === "percent"
                            ? formatFractionAsPercent(c.amount)
                            : c.kind === "flat_minor"
                              ? formatMinor(c.amount, m.currency || "USD")
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
            {/* WAVE 3A (P-1) — THE SELF-CONTRADICTION, RESOLVED.

                Until this wave the discount-codes table above printed the raw
                stored fraction ("0.1%", "0.2%", "0.05%") while THIS paragraph,
                directly below it on the same screen, said 10% / 20% / 5%. The
                page contradicted itself.

                THIS PARAGRAPH WAS ALWAYS THE CORRECT ONE — CP10 really is 10%
                off, and the charge path has always applied 10%
                (server/paymentStore.ts:166 multiplies by the stored 0.1). So it
                is CORRECTED IN PLACE, not deleted: the numbers stay, and the
                sentence beneath now states the storage unit explicitly so the
                two surfaces can never be read as disagreeing again. Deleting
                these figures would have thrown away the only text that was
                telling the truth. */}
            <p className="text-sm" data-testid="hardcoded-coupon-list">
              <code>CP10</code> = 10% · <code>FOUNDER20</code> = 20% ·{" "}
              <code>COLLECTIVE5</code> = 5%. This carrier model is kept as{" "}
              <code>status: draft</code> on purpose so it never appears on public pricing
              or admin “live plan” surfaces — only the coupon lookup sees it.
            </p>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="legacy-coupon-unit-note">
              These are the same three codes listed in the discount-codes table above,
              where they are stored as fractions (0.1, 0.2, 0.05) and now displayed as
              percentages. The percentages here and the percentages there are the same
              numbers; before this wave the table showed the unscaled fraction and the two
              disagreed on screen.
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
                        {formatMinor(p.amountCents ?? 0, "USD")}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMinor(p.discountCents ?? 0, "USD")}
                        {p.couponCode ? ` (${p.couponCode})` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMinor(p.netCents ?? 0, "USD")}
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
                          {formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD")}
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
                              const amt = formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD");
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
        <SectionTitle hint="WAVE 14 / FE-16 — the renewal worker is now configured from collective_renewal_worker_config and is editable here. The environment variable survives only as an emergency override, and only while the row permits it.">
          Dunning schedule
        </SectionTitle>
        <div className="mt-4 space-y-6">
          <FieldWithSource
            source={{
              table: "collective_renewal_worker_config",
              column:
                "enabled, poll_interval_ms, lead_window_sec, max_consecutive_failures, quiet_after_write_min, env_override_allowed",
              unit: "integer (count)",
              editableHere: true,
              editableVia: "this panel — PUT /api/admin/collective/renewal-worker-config",
              readEndpoint: "GET /api/admin/collective/renewal-worker-config",
              testId: "dunning-schedule",
            }}
          >
            <RenewalWorkerConfigEditor />

            {/* NOTHING IS DROPPED. This list was the WHOLE of this panel before
                Wave 14 — the environment-variable names and their defaults. Those
                names still exist (the env var remains the emergency override, and
                the poll/lead vars remain the seed values), so the reference stays,
                now clearly labelled as the pre-FE-16 mechanism rather than as the
                answer to "where is this configured". */}
            <details className="rounded-md border p-3 text-sm" data-testid="dunning-schedule-env-reference">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">
                Pre-FE-16 environment reference (kept for operators)
              </summary>
              <ul className="mt-2 space-y-1" data-testid="dunning-schedule-values">
                <li>
                  Worker enabled: gated on{" "}
                  <code>COLLECTIVE_RENEWAL_WORKER_ENABLED === "1"</code> (OFF by default).
                  {/* The follow-on note is its OWN node so the original text node
                      "(OFF by default)." survives byte-identically — the drop guard
                      fingerprints text nodes, and appending to one reads as a
                      removal plus an addition. */}
                  <span className="ml-1 text-xs text-muted-foreground">
                    Now the stored <code>enabled</code> column, with this variable acting only as an override while the row
                    allows it.
                  </span>
                </li>
                <li>
                  Poll interval: <code>COLLECTIVE_RENEWAL_POLL_MS</code> (default 60000 ms).
                  <span className="ml-1 text-xs text-muted-foreground">
                    Now <code>poll_interval_ms</code>.
                  </span>
                </li>
                <li>
                  Lead window: <code>COLLECTIVE_RENEWAL_LEAD_SEC</code> (default 86400 s).
                  <span className="ml-1 text-xs text-muted-foreground">
                    Now <code>lead_window_sec</code>.
                  </span>
                </li>
                <li>
                  Failures before <code>past_due</code>: <strong>3</strong> — hard-coded{" "}
                  <code>MAX_CONSECUTIVE_FAILURES</code> until Wave 14; now the stored
                  <code className="mx-1">max_consecutive_failures</code> column.
                </li>
                <li>Capavate founder equivalent: none.</li>
              </ul>
            </details>
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
 * TAB 8 — Fee Schedules   (WAVE 4A, spec items RS-1 + RS-2)
 *
 * WHY THIS TAB EXISTS
 * -------------------
 * The July D2.5 consolidation folded 15 admin fee routes into `/admin/fees`.
 * Two write surfaces did not survive the fold:
 *
 *   RS-1  `collective_payment_schedules` — full CRUD is served at
 *         `server/lib/collectivePaymentAdminRoutes.ts:44/61/118/176` and had
 *         ZERO client callers. Admins could not create, edit or expire a
 *         Collective fee schedule from anywhere in the routed app.
 *   RS-2  `partner_fee_schedules` — the consolidation kept the READ (the
 *         row count in the Consortium Partner Promotions tab) and dropped the
 *         WRITES. `POST/PATCH/DELETE /api/admin/partner-fees` were called only
 *         from `client/src/pages/admin/PartnerFeeSchedules.tsx`, a page that is
 *         on disk but NOT routed from `App.tsx`.
 *
 * The restoration finishes the consolidation instead of reversing it: the lost
 * capability is rebuilt HERE, inside the one consolidated page, rather than by
 * re-routing the two orphan pages (which would re-fragment the admin surface).
 * The two legacy URLs still resolve — `App.tsx` aliases them onto this tab —
 * so no bookmark, sidebar entry or deep link is lost.
 *
 * NO NEW ENDPOINTS. NO SCHEMA CHANGE. Every call below is a pre-existing,
 * `requireAdmin`-guarded `/api/admin/*` route.
 *
 * UNIT CONTRACT: both tables store TRUE minor units. Inputs here take MAJOR
 * units and convert through the shared ISO-4217-aware `toMinor()` — NOT a
 * hardcoded ×100 — preserving the v25.37/v25.40 currency fixes that the orphan
 * pages carried (JPY/KRW are 0-decimal, BHD/JOD/KWD are 3-decimal).
 * ======================================================================== */

interface CollectiveScheduleRow {
  id: string;
  scope_kind: string;
  member_id: string | null;
  tier: string | null;
  chapter_id: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  cadence: string;
  effective_from: string;
  effective_to: string | null;
}

interface PartnerFeeScheduleRow {
  id: string;
  tier: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  size_band_min: number | null;
  size_band_max: number | null;
  effective_from: string;
  effective_to: string | null;
}

/* Option sets mirror the server-side validators verbatim:
 * collectivePaymentAdminRoutes.ts FEE_KINDS/SCOPES/TIERS/CADENCES and
 * partnerFeeAdminRoutes.ts VALID_FEE_KINDS. */
const CPS_FEE_KINDS = [
  "membership_dues",
  "event_fee",
  "sponsorship_fee",
  "chapter_dues",
  "late_fee",
] as const;
const CPS_SCOPES = [
  { value: "platform", label: "Platform default (all members)" },
  { value: "tier", label: "Per-tier default" },
  { value: "member", label: "Per-member override" },
] as const;
const CPS_TIERS = ["basic", "standard", "premium"] as const;
const CPS_CADENCES = ["one_time", "monthly", "quarterly", "annual"] as const;

const PFS_FEE_KINDS = [
  "subscription_monthly",
  "subscription_annual",
  "spv_deployment",
  "spv_management_per_lp_quarter",
  "spv_closing_bonus",
] as const;
const PFS_TIERS = ["", "catalyst", "builder", "amplifier", "nexus", "founding_member"] as const;

/** Shared <select> styling — matches the shadcn <Input> the other tabs use. */
const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function fmtBand(min: number | null, max: number | null, currency: string): string {
  if (min === null && max === null) return "—";
  const lo = min === null ? "0" : formatMinor(min, currency, { locale: "en-US" });
  const hi = max === null ? "∞" : formatMinor(max, currency, { locale: "en-US" });
  return `${lo} – ${hi}`;
}

/** major-unit string → integer minor units, or throw a legible error. */
function majorStringToMinor(major: string, currency: string): number {
  const n = parseFloat(major || "0");
  if (!Number.isFinite(n) || n < 0) throw new Error("invalid_amount");
  return toMinor(n, currency);
}

/* ---------- RS-1: Collective payment schedules ------------------------- */

function CollectiveScheduleSection() {
  const { toast } = useToast();
  const [feeKindFilter, setFeeKindFilter] = useState("__all__");
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ amountMajor: "", cadence: "annual", effectiveTo: "" });
  const [form, setForm] = useState({
    scopeKind: "platform",
    feeKind: "membership_dues",
    tier: "basic",
    memberId: "",
    chapterId: "",
    amountMajor: "",
    currency: "USD",
    cadence: "annual",
  });

  const qs = new URLSearchParams({ includeExpired: "false" });
  if (feeKindFilter !== "__all__") qs.set("feeKind", feeKindFilter);
  const listUrl = `/api/admin/collective-payments/schedules?${qs.toString()}`;
  const q = useAdminQuery<{ ok?: boolean; schedules?: CollectiveScheduleRow[]; total?: number }>(listUrl);
  const rows = q.data?.schedules ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        String(query.queryKey?.[0] ?? "").startsWith("/api/admin/collective-payments/schedules"),
    });

  const createMut = useMutation({
    mutationFn: async () => {
      const currency = (form.currency || "USD").trim().toUpperCase();
      const body: Record<string, unknown> = {
        scopeKind: form.scopeKind,
        feeKind: form.feeKind,
        amountMinor: majorStringToMinor(form.amountMajor, currency),
        currency,
        cadence: form.cadence,
        chapterId: form.chapterId || null,
      };
      if (form.scopeKind === "tier") body.tier = form.tier;
      if (form.scopeKind === "member") body.memberId = form.memberId;
      const res = await apiRequest("POST", "/api/admin/collective-payments/schedules", body);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `create_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      toast({ title: "Schedule created" });
    },
    onError: (e: unknown) =>
      toast({ title: "Create failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async (row: CollectiveScheduleRow) => {
      const body: Record<string, unknown> = {
        amountMinor: majorStringToMinor(editDraft.amountMajor, row.currency),
        cadence: editDraft.cadence,
        effectiveTo: editDraft.effectiveTo ? editDraft.effectiveTo : null,
      };
      const res = await apiRequest("PATCH", `/api/admin/collective-payments/schedules/${row.id}`, body);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `update_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      setEditId(null);
      toast({ title: "Schedule updated" });
    },
    onError: (e: unknown) =>
      toast({ title: "Update failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const expireMut = useMutation({
    mutationFn: async (id: string) => {
      /* W5.2 precedent, preserved from the retired page: confirm before the
         destructive expire. Cancelling is a silent no-op. */
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Expire this fee schedule? It will no longer apply to members. This cannot be undone.",
        )
      ) {
        throw new Error("cancelled");
      }
      const res = await apiRequest("DELETE", `/api/admin/collective-payments/schedules/${id}`);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `expire_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Schedule expired" });
    },
    onError: (e: unknown) => {
      if ((e as Error)?.message === "cancelled") return;
      toast({ title: "Action failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
    },
  });

  return (
    <AppCard>
      <SectionTitle hint="collective_payment_schedules — the Collective fee catalogue. Precedence: per-member override → per-tier default → platform default.">
        Collective payment schedules
      </SectionTitle>
      <div className="mt-4">
        <FieldWithSource
          source={{
            table: "collective_payment_schedules",
            column: "amount_minor / cadence / effective_from / effective_to",
            unit: "currency_minor (cents)",
            editableHere: true,
            readEndpoint: "GET /api/admin/collective-payments/schedules",
            writeEndpoint:
              "POST · PATCH /:id · DELETE /:id /api/admin/collective-payments/schedules",
            testId: "collective-payment-schedules",
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Label htmlFor="cps-filter">Fee kind</Label>
              <select
                id="cps-filter"
                className={SELECT_CLASS}
                value={feeKindFilter}
                onChange={(e) => setFeeKindFilter(e.target.value)}
                data-testid="select-cps-filter"
              >
                <option value="__all__">All fee kinds</option>
                {CPS_FEE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {labelFor(FEE_KIND_LABELS, k)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              onClick={() => setShowCreate((v) => !v)}
              data-testid="button-new-cps"
            >
              {showCreate ? "Cancel" : "New schedule"}
            </Button>
          </div>

          {showCreate ? (
            <div className="rounded-lg border border-border p-3 space-y-3" data-testid="card-create-cps">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="cps-scope">Scope</Label>
                  <select
                    id="cps-scope"
                    className={SELECT_CLASS}
                    value={form.scopeKind}
                    onChange={(e) => setForm({ ...form, scopeKind: e.target.value })}
                    data-testid="select-cps-scope"
                  >
                    {CPS_SCOPES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                {form.scopeKind === "tier" ? (
                  <div>
                    <Label htmlFor="cps-tier">Tier</Label>
                    <select
                      id="cps-tier"
                      className={SELECT_CLASS}
                      value={form.tier}
                      onChange={(e) => setForm({ ...form, tier: e.target.value })}
                      data-testid="select-cps-tier"
                    >
                      {CPS_TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {form.scopeKind === "member" ? (
                  <div>
                    <Label htmlFor="cps-member">Member ID</Label>
                    <Input
                      id="cps-member"
                      value={form.memberId}
                      onChange={(e) => setForm({ ...form, memberId: e.target.value })}
                      data-testid="input-cps-member"
                    />
                  </div>
                ) : null}
                <div>
                  <Label htmlFor="cps-kind">Fee kind</Label>
                  <select
                    id="cps-kind"
                    className={SELECT_CLASS}
                    value={form.feeKind}
                    onChange={(e) => setForm({ ...form, feeKind: e.target.value })}
                    data-testid="select-cps-fee-kind"
                  >
                    {CPS_FEE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {labelFor(FEE_KIND_LABELS, k)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="cps-amount">Amount (major units)</Label>
                  <Input
                    id="cps-amount"
                    inputMode="decimal"
                    value={form.amountMajor}
                    onChange={(e) => setForm({ ...form, amountMajor: e.target.value })}
                    data-testid="input-cps-amount"
                  />
                </div>
                <div>
                  <Label htmlFor="cps-currency">Currency</Label>
                  <Input
                    id="cps-currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    data-testid="input-cps-currency"
                  />
                </div>
                <div>
                  <Label htmlFor="cps-cadence">Cadence</Label>
                  <select
                    id="cps-cadence"
                    className={SELECT_CLASS}
                    value={form.cadence}
                    onChange={(e) => setForm({ ...form, cadence: e.target.value })}
                    data-testid="select-cps-cadence"
                  >
                    {CPS_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {labelFor(CADENCE_LABELS, c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="cps-chapter">Chapter ID (optional)</Label>
                  <Input
                    id="cps-chapter"
                    value={form.chapterId}
                    onChange={(e) => setForm({ ...form, chapterId: e.target.value })}
                    data-testid="input-cps-chapter"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                data-testid="button-save-cps"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Create schedule
              </Button>
            </div>
          ) : null}

          {q.isError ? (
            <p className="text-sm text-destructive" data-testid="error-cps">
              Could not load Collective payment schedules.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-cps">
              No active Collective payment schedules.
            </p>
          ) : (
            <Table data-testid="table-cps">
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Fee kind</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const editing = editId === r.id;
                  return (
                    <TableRow key={r.id} data-testid={`row-cps-${r.id}`}>
                      <TableCell>
                        <Badge variant="secondary">{labelFor(SCOPE_KIND_LABELS, r.scope_kind)}</Badge>{" "}
                        {r.tier ?? r.member_id ?? ""}
                      </TableCell>
                      <TableCell>{labelFor(FEE_KIND_LABELS, r.fee_kind)}</TableCell>
                      <TableCell>
                        {editing ? (
                          <Input
                            value={editDraft.amountMajor}
                            onChange={(e) => setEditDraft({ ...editDraft, amountMajor: e.target.value })}
                            data-testid={`input-cps-edit-amount-${r.id}`}
                          />
                        ) : (
                          formatMinor(r.amount_minor, r.currency)
                        )}
                      </TableCell>
                      <TableCell>
                        {editing ? (
                          <select
                            className={SELECT_CLASS}
                            value={editDraft.cadence}
                            onChange={(e) => setEditDraft({ ...editDraft, cadence: e.target.value })}
                            data-testid={`select-cps-edit-cadence-${r.id}`}
                          >
                            {CPS_CADENCES.map((c) => (
                              <option key={c} value={c}>
                                {labelFor(CADENCE_LABELS, c)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          labelFor(CADENCE_LABELS, r.cadence)
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {editing ? (
                          <Input
                            placeholder="effective to (ISO, blank = open)"
                            value={editDraft.effectiveTo}
                            onChange={(e) => setEditDraft({ ...editDraft, effectiveTo: e.target.value })}
                            data-testid={`input-cps-edit-effective-to-${r.id}`}
                          />
                        ) : (
                          `${String(r.effective_from).slice(0, 10)} → ${
                            r.effective_to ? String(r.effective_to).slice(0, 10) : "open"
                          }`
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        {editing ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updateMut.mutate(r)}
                              disabled={updateMut.isPending}
                              data-testid={`button-save-cps-edit-${r.id}`}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditId(null)}
                              data-testid={`button-cancel-cps-edit-${r.id}`}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditId(r.id);
                                setEditDraft({
                                  amountMajor: String(fromMinor(r.amount_minor, r.currency)),
                                  cadence: r.cadence,
                                  effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : "",
                                });
                              }}
                              data-testid={`button-edit-cps-${r.id}`}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => expireMut.mutate(r.id)}
                              disabled={expireMut.isPending}
                              data-testid={`button-expire-cps-${r.id}`}
                            >
                              Expire
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </FieldWithSource>
      </div>
    </AppCard>
  );
}

/* ---------- RS-2: Consortium partner fee schedules --------------------- */

function PartnerFeeScheduleSection() {
  const { toast } = useToast();
  const [feeKindFilter, setFeeKindFilter] = useState("__all__");
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ amountMajor: "", effectiveTo: "" });
  const [form, setForm] = useState({
    feeKind: "subscription_monthly",
    tier: "",
    amountMajor: "",
    currency: "USD",
    sizeBandMinMajor: "",
    sizeBandMaxMajor: "",
  });

  const qs = new URLSearchParams({ includeExpired: "false" });
  if (feeKindFilter !== "__all__") qs.set("feeKind", feeKindFilter);
  const listUrl = `/api/admin/partner-fees?${qs.toString()}`;
  const q = useAdminQuery<{ ok?: boolean; schedules?: PartnerFeeScheduleRow[]; total?: number }>(listUrl);
  const rows = q.data?.schedules ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey?.[0] ?? "").startsWith("/api/admin/partner-fees"),
    });

  const createMut = useMutation({
    mutationFn: async () => {
      const currency = (form.currency || "USD").trim().toUpperCase();
      if (!currency) throw new Error("invalid_currency");
      const body: Record<string, unknown> = {
        feeKind: form.feeKind,
        tier: form.tier || null,
        amountMinor: majorStringToMinor(form.amountMajor, currency),
        currency,
      };
      if (form.feeKind === "spv_deployment") {
        body.sizeBandMin = form.sizeBandMinMajor
          ? majorStringToMinor(form.sizeBandMinMajor, currency)
          : null;
        body.sizeBandMax = form.sizeBandMaxMajor
          ? majorStringToMinor(form.sizeBandMaxMajor, currency)
          : null;
      }
      const res = await apiRequest("POST", "/api/admin/partner-fees", body);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `create_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      toast({ title: "Fee schedule created" });
    },
    onError: (e: unknown) =>
      toast({ title: "Create failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async (row: PartnerFeeScheduleRow) => {
      const body: Record<string, unknown> = {
        amountMinor: majorStringToMinor(editDraft.amountMajor, row.currency),
        effectiveTo: editDraft.effectiveTo ? editDraft.effectiveTo : null,
      };
      const res = await apiRequest("PATCH", `/api/admin/partner-fees/${row.id}`, body);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `update_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      setEditId(null);
      toast({ title: "Fee schedule updated" });
    },
    onError: (e: unknown) =>
      toast({ title: "Update failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const expireMut = useMutation({
    mutationFn: async (id: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm("Expire this partner fee schedule? It will stop applying to partners.")
      ) {
        throw new Error("cancelled");
      }
      const res = await apiRequest("DELETE", `/api/admin/partner-fees/${id}`);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `expire_failed_${res.status}`);
      return j;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Fee schedule expired" });
    },
    onError: (e: unknown) => {
      if ((e as Error)?.message === "cancelled") return;
      toast({ title: "Action failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
    },
  });

  return (
    <AppCard>
      <SectionTitle hint="partner_fee_schedules — OVERRIDES for consortium-partner fees. Precedence: per-partner override → per-tier default → platform default (tier = —). If no override exists the tier base price from Consortium Partner Promotions applies. SPV deployment fees use stepped size bands.">
        Consortium partner fee schedules
      </SectionTitle>
      <div className="mt-4">
        <FieldWithSource
          source={{
            table: "partner_fee_schedules",
            column: "amount_minor / size_band_min / size_band_max / effective_to",
            unit: "currency_minor (cents)",
            editableHere: true,
            readEndpoint: "GET /api/admin/partner-fees",
            writeEndpoint: "POST · PATCH /:id · DELETE /:id /api/admin/partner-fees",
            testId: "partner-fee-schedules-editor",
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Label htmlFor="pfs-filter">Fee kind</Label>
              <select
                id="pfs-filter"
                className={SELECT_CLASS}
                value={feeKindFilter}
                onChange={(e) => setFeeKindFilter(e.target.value)}
                data-testid="select-pfs-filter"
              >
                <option value="__all__">All fee kinds</option>
                {PFS_FEE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {labelFor(FEE_KIND_LABELS, k)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              onClick={() => setShowCreate((v) => !v)}
              data-testid="button-new-fee-schedule"
            >
              {showCreate ? "Cancel" : "New fee schedule"}
            </Button>
          </div>

          {showCreate ? (
            <div className="rounded-lg border border-border p-3 space-y-3" data-testid="card-create-fee">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="pfs-kind">Fee kind</Label>
                  <select
                    id="pfs-kind"
                    className={SELECT_CLASS}
                    value={form.feeKind}
                    onChange={(e) => setForm({ ...form, feeKind: e.target.value })}
                    data-testid="select-new-fee-kind"
                  >
                    {PFS_FEE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {labelFor(FEE_KIND_LABELS, k)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pfs-tier">Tier (blank = platform default)</Label>
                  <select
                    id="pfs-tier"
                    className={SELECT_CLASS}
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value })}
                    data-testid="select-new-fee-tier"
                  >
                    {PFS_TIERS.map((t) => (
                      <option key={t || "__platform__"} value={t}>
                        {t === "" ? "— (platform default)" : t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pfs-amount">Amount (major units)</Label>
                  <Input
                    id="pfs-amount"
                    inputMode="decimal"
                    value={form.amountMajor}
                    onChange={(e) => setForm({ ...form, amountMajor: e.target.value })}
                    data-testid="input-new-fee-amount"
                  />
                </div>
                <div>
                  <Label htmlFor="pfs-currency">Currency</Label>
                  <Input
                    id="pfs-currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    data-testid="input-new-fee-currency"
                  />
                </div>
                {form.feeKind === "spv_deployment" ? (
                  <>
                    <div>
                      <Label htmlFor="pfs-band-min">Size band min (major)</Label>
                      <Input
                        id="pfs-band-min"
                        inputMode="decimal"
                        value={form.sizeBandMinMajor}
                        onChange={(e) => setForm({ ...form, sizeBandMinMajor: e.target.value })}
                        data-testid="input-new-fee-band-min"
                      />
                    </div>
                    <div>
                      <Label htmlFor="pfs-band-max">Size band max (major)</Label>
                      <Input
                        id="pfs-band-max"
                        inputMode="decimal"
                        value={form.sizeBandMaxMajor}
                        onChange={(e) => setForm({ ...form, sizeBandMaxMajor: e.target.value })}
                        data-testid="input-new-fee-band-max"
                      />
                    </div>
                  </>
                ) : null}
              </div>
              <Button
                size="sm"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                data-testid="button-save-fee-schedule"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Create fee schedule
              </Button>
            </div>
          ) : null}

          {q.isError ? (
            <p className="text-sm text-destructive" data-testid="error-pfs">
              Could not load partner fee schedules.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-pfs">
              No active partner fee schedules.
            </p>
          ) : (
            <Table data-testid="table-pfs">
              <TableHeader>
                <TableRow>
                  <TableHead>Fee kind</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Size band</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const editing = editId === r.id;
                  return (
                    <TableRow key={r.id} data-testid={`row-pfs-${r.id}`}>
                      <TableCell>{labelFor(FEE_KIND_LABELS, r.fee_kind)}</TableCell>
                      <TableCell>
                        {r.tier ? <Badge variant="secondary">{r.tier}</Badge> : "—"}
                      </TableCell>
                      <TableCell>
                        {editing ? (
                          <Input
                            value={editDraft.amountMajor}
                            onChange={(e) => setEditDraft({ ...editDraft, amountMajor: e.target.value })}
                            data-testid={`input-pfs-edit-amount-${r.id}`}
                          />
                        ) : (
                          formatMinor(r.amount_minor, r.currency, { locale: "en-US" })
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtBand(r.size_band_min, r.size_band_max, r.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {editing ? (
                          <Input
                            placeholder="effective to (ISO, blank = open)"
                            value={editDraft.effectiveTo}
                            onChange={(e) => setEditDraft({ ...editDraft, effectiveTo: e.target.value })}
                            data-testid={`input-pfs-edit-effective-to-${r.id}`}
                          />
                        ) : (
                          `${String(r.effective_from).slice(0, 10)} → ${
                            r.effective_to ? String(r.effective_to).slice(0, 10) : "open"
                          }`
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        {editing ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updateMut.mutate(r)}
                              disabled={updateMut.isPending}
                              data-testid={`button-save-fee-edit-${r.id}`}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditId(null)}
                              data-testid={`button-cancel-fee-edit-${r.id}`}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditId(r.id);
                                setEditDraft({
                                  amountMajor: String(fromMinor(r.amount_minor, r.currency)),
                                  effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : "",
                                });
                              }}
                              data-testid={`button-edit-fee-${r.id}`}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => expireMut.mutate(r.id)}
                              disabled={expireMut.isPending}
                              data-testid={`button-expire-fee-${r.id}`}
                            >
                              Expire
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </FieldWithSource>
      </div>
    </AppCard>
  );
}

function FeeSchedulesTab() {
  return (
    <div className="space-y-6" data-testid="tab-fee-schedules">
      <CollectiveScheduleSection />
      <PartnerFeeScheduleSection />
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
  { key: "fee-schedules", label: "Fee Schedules" },
  { key: "config", label: "Config" },
] as const;

/** WAVE 4A — `initialTab` lets the two preserved legacy admin URLs
 *  (`/admin/collective-payment-schedules`, `/admin/partner-fees`) deep-link
 *  straight into the Fee Schedules tab of THIS one consolidated page instead
 *  of re-routing the retired standalone pages. See App.tsx. */
export default function AdminFeesConsolidated({ initialTab }: { initialTab?: string } = {}) {
  const [tab, setTab] = useState<string>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as string) : TABS[0].key,
  );

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
          <TabsContent value="fee-schedules" className="mt-4">
            <FeeSchedulesTab />
          </TabsContent>
          <TabsContent value="config" className="mt-4">
            <ConfigTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </div>
  );
}
