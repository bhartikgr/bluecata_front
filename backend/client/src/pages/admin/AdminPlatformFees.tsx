/* v25.46.1 — Admin "Platform Fees" page, rebuilt as a 3-tab, multi-section editor.
 *
 * /admin/platform-fees — REPLACES the v25.46 single-list panel (which listed all
 * 5 fee rows undifferentiated). Per the founder request (APD-017), the Capavate
 * fee structure was reverted byte-for-byte to its pre-v25.46 working state and is
 * managed in its ORIGINAL locations; this page now has three tab-isolated
 * sections (Sacred Tier 9 / UPDATED Rule 77 — multi-section-aware, but NO
 * cross-tab coupling):
 *
 *   Tab 1 — Capavate   : READ-ONLY info card pointing to the original Capavate
 *                        fee admin routes. NO editable controls, NO platform_fees
 *                        rows referenced.
 *   Tab 2 — Collective : TWO sections.
 *                        A) Founder Application Fee — existing flat
 *                           collective_application_fee, read/write via the
 *                           EXISTING /api/admin/collective/application-fee routes
 *                           (adminCollectiveFeeRoutes.ts — key/routes UNCHANGED).
 *                        B) Cap Table Investor Membership Subscription — NEW
 *                           multi-tier recurring table, CRUD via
 *                           /api/admin/collective/member-subscription-tiers[/:slug].
 *   Tab 3 — Consortium Partners : TWO sections.
 *                        A) Partner Subscription Tiers — NEW multi-tier recurring
 *                           table, CRUD via
 *                           /api/admin/consortium/subscription-tiers[/:slug].
 *                        B) SPV Deployment Flat Fee — NEW flat fee, read/write via
 *                           GET/PUT /api/admin/consortium/spv-deployment-fee.
 *
 * Wrapper pattern (Tier 9 rule 73): uses the canonical AppCard + FilterChip
 * primitives. The FilterChip strip at the top controls the active tab.
 *
 * UNIT NOTE: platform_fees / collective_application_fee_config amounts are TRUE
 * minor units (cents): $2,500.00 == 250000; $99.00 == 9900. The editable controls
 * accept a MAJOR-unit dollar amount and convert to/from cents (×100 / ÷100).
 *
 * SEPARATE / PARALLEL to the Capavate founder/investor subscription flow (Sacred
 * Rule 76): every editor here writes ONLY platform_fees /
 * collective_application_fee_config rows. Nothing here touches
 * capavate_subscriptions, the pricing-tiers tables, paymentGatewayAdapter, or
 * canonicalPlanResolver.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { fmtUSD } from "@/lib/format";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { AppCard } from "@/components/ui/app-card";
import { FilterChip } from "@/components/ui/filter-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Info, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type TabKey = "capavate" | "collective" | "consortium";

/** Convert minor units (cents) to a major-unit string for display. */
function minorToMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Parse a major-unit dollar string to minor units (cents). Returns null on invalid. */
function majorToMinor(s: string): number | null {
  const raw = (s ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/** Slug validation mirrors server/subscriptionTierStore.isValidTierSlug. */
function isValidSlug(s: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(s);
}

/* ============================================================================
 * Tab 1 — Capavate (read-only info card)
 * ========================================================================== */
function CapavateTab() {
  return (
    <div className="space-y-4" data-testid="capavate-fees-tab">
      <AppCard>
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 mt-0.5 text-muted-foreground" />
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Capavate fees</h3>
            <p className="text-sm text-muted-foreground">
              The Capavate fee structure (founder subscription plans, partner
              commission rates, and the partner fee catalogue) is managed in its
              original, dedicated admin locations. It is fully dynamic and
              DB-driven — there are no Capavate fee controls on this page.
            </p>
            <div className="text-sm">
              <div className="font-medium mb-1.5">Manage Capavate fees here:</div>
              <ul className="space-y-1.5">
                <li>
                  <Link
                    href="/admin/application-fee"
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    data-testid="link-capavate-application-fee"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Application Fee — <code>/admin/application-fee</code>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/commission-rates"
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    data-testid="link-capavate-commission-rates"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Partner Commission Rates — <code>/admin/commission-rates</code>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/partner-fees"
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    data-testid="link-capavate-partner-fees"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Partner Fee Schedules — <code>/admin/partner-fees</code>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/collective-payment-schedules"
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    data-testid="link-capavate-collective-payment-schedules"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Collective Payment Schedules — <code>/admin/collective-payment-schedules</code>
                  </Link>
                </li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Founder subscription pricing is read from the Admin pricing area and
              applied through the existing subscription flow — never hardcoded.
            </p>
          </div>
        </div>
      </AppCard>
    </div>
  );
}

/* ============================================================================
 * Reusable — Flat single-row fee card (Collective Application Fee + SPV fee)
 * ========================================================================== */
interface FlatFee {
  amountMinor: number;
  currency: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  source?: "db" | "default";
}

function FlatFeeCard(props: {
  title: string;
  helper: string;
  /** The live fee object (shape may vary by endpoint; normalized by caller). */
  fee: FlatFee | undefined;
  isLoading: boolean;
  /** PUT endpoint. Body: { amountMinor, currency }. */
  endpoint: string;
  /** Query keys to invalidate after a successful save. */
  invalidateKeys: string[];
  testid: string;
}) {
  const { toast } = useToast();
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty && props.fee) {
      setAmountMajor(minorToMajor(props.fee.amountMinor));
      setCurrency(props.fee.currency || "USD");
    }
  }, [props.fee, dirty]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const cents = majorToMinor(amountMajor);
      if (cents === null)
        throw new Error("Amount must be a non-negative dollar value (e.g. 2500.00).");
      const r = await apiRequest("PUT", props.endpoint, {
        amountMinor: cents,
        currency: currency || "USD",
      });
      const j = await r.json();
      if (j && j.ok === false) throw new Error(j.error || "update_failed");
      return j;
    },
    onSuccess: () => {
      props.invalidateKeys.forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
      setDirty(false);
      toast({ title: `${props.title} updated` });
    },
    onError: (e: any) =>
      toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const preview = (() => {
    const c = majorToMinor(amountMajor);
    return c === null ? "—" : fmtUSD(c / 100, { fractionDigits: 2 });
  })();

  return (
    <AppCard data-testid={props.testid}>
      <h3 className="text-base font-semibold mb-1">{props.title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{props.helper}</p>
      {props.isLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`text-${props.testid}-loading`}
        >
          Loading…
        </p>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Amount (USD, dollars)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amountMajor}
              onChange={(e) => {
                setAmountMajor(e.target.value);
                setDirty(true);
              }}
              placeholder="e.g. 2500.00"
              data-testid={`input-${props.testid}-amount`}
            />
            <div className="text-[10px] text-muted-foreground">
              Preview:{" "}
              <span className="font-medium" data-testid={`text-${props.testid}-preview`}>
                {preview}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Currency</Label>
            <Input
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value.toUpperCase());
                setDirty(true);
              }}
              data-testid={`input-${props.testid}-currency`}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Current (live)</Label>
            <div
              className="h-9 flex items-center text-sm font-medium"
              data-testid={`text-${props.testid}-current`}
            >
              {props.fee ? fmtUSD(props.fee.amountMinor / 100, { fractionDigits: 2 }) : "—"}
            </div>
          </div>
          <div className="md:col-span-3 flex items-center gap-3">
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !dirty}
              data-testid={`button-save-${props.testid}`}
            >
              Save
            </Button>
            {dirty && <span className="text-xs text-amber-700">Modified — not yet saved</span>}
            <span className="text-[10px] text-muted-foreground ml-auto">
              Last updated:{" "}
              {props.fee?.updatedAt ? new Date(props.fee.updatedAt).toLocaleString() : "—"}
              {props.fee?.updatedBy ? ` · by ${props.fee.updatedBy}` : ""}
            </span>
          </div>
        </div>
      )}
    </AppCard>
  );
}

/* ============================================================================
 * Reusable — Multi-tier subscription table (recurring tiers, full CRUD)
 * ========================================================================== */
interface SubscriptionTier {
  key: string;
  slug: string;
  amountMinor: number;
  currency: string;
  billingPeriod: string;
  updatedAt?: string;
  updatedByUserId?: string | null;
}

const BILLING_PERIODS = ["monthly", "quarterly", "annual"] as const;

function TierTableSection(props: {
  title: string;
  helper: string;
  /** Collection endpoint, e.g. "/api/admin/consortium/subscription-tiers". */
  baseEndpoint: string;
  testid: string;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ ok: boolean; tiers: SubscriptionTier[] }>({
    queryKey: [props.baseEndpoint],
    queryFn: async () => (await apiRequest("GET", props.baseEndpoint)).json(),
    retry: false,
  });
  const tiers = data?.tiers ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [props.baseEndpoint] });

  // ── Add-tier form state ────────────────────────────────────────────────
  const [newSlug, setNewSlug] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newPeriod, setNewPeriod] = useState<string>("monthly");

  const createMut = useMutation({
    mutationFn: async () => {
      const slug = newSlug.trim().toLowerCase();
      if (!isValidSlug(slug))
        throw new Error("Slug must be lowercase letters, numbers, or underscores.");
      const cents = majorToMinor(newAmount);
      if (cents === null)
        throw new Error("Amount must be a non-negative dollar value (e.g. 99.00).");
      const r = await apiRequest("POST", props.baseEndpoint, {
        slug,
        amountMinor: cents,
        currency: newCurrency || "USD",
        billingPeriod: newPeriod,
      });
      const j = await r.json();
      if (j && j.ok === false) throw new Error(j.error || "create_failed");
      return j;
    },
    onSuccess: () => {
      invalidate();
      setNewSlug("");
      setNewAmount("");
      setNewCurrency("USD");
      setNewPeriod("monthly");
      toast({ title: "Tier added" });
    },
    onError: (e: any) =>
      toast({ title: "Add failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <AppCard data-testid={props.testid}>
      <h3 className="text-base font-semibold mb-1">{props.title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{props.helper}</p>

      {isLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`text-${props.testid}-loading`}
        >
          Loading…
        </p>
      ) : (
        <div className="space-y-3" data-testid={`table-${props.testid}`}>
          {tiers.length === 0 && (
            <p
              className="text-sm text-muted-foreground"
              data-testid={`text-${props.testid}-empty`}
            >
              No tiers configured yet. Add one below.
            </p>
          )}
          {tiers.map((t) => (
            <TierRow
              key={t.key}
              tier={t}
              baseEndpoint={props.baseEndpoint}
              testid={props.testid}
              onChanged={invalidate}
            />
          ))}

          {/* Add-tier row */}
          <div
            className="grid md:grid-cols-5 gap-3 items-end border-t pt-4 mt-2"
            data-testid={`add-${props.testid}`}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">New tier slug</Label>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="e.g. pro"
                data-testid={`input-${props.testid}-new-slug`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (USD)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="e.g. 99.00"
                data-testid={`input-${props.testid}-new-amount`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Input
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
                data-testid={`input-${props.testid}-new-currency`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Billing period</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                data-testid={`select-${props.testid}-new-period`}
              >
                {BILLING_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              data-testid={`button-add-${props.testid}`}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add tier
            </Button>
          </div>
        </div>
      )}
    </AppCard>
  );
}

/** One editable tier row (PUT amount/currency/period; DELETE soft-delete). */
function TierRow(props: {
  tier: SubscriptionTier;
  baseEndpoint: string;
  testid: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [amountMajor, setAmountMajor] = useState(minorToMajor(props.tier.amountMinor));
  const [currency, setCurrency] = useState(props.tier.currency || "USD");
  const [period, setPeriod] = useState(props.tier.billingPeriod || "monthly");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setAmountMajor(minorToMajor(props.tier.amountMinor));
      setCurrency(props.tier.currency || "USD");
      setPeriod(props.tier.billingPeriod || "monthly");
    }
  }, [props.tier, dirty]);

  const rowTestid = `${props.testid}-${props.tier.slug}`;
  const itemEndpoint = `${props.baseEndpoint}/${encodeURIComponent(props.tier.slug)}`;

  const saveMut = useMutation({
    mutationFn: async () => {
      const cents = majorToMinor(amountMajor);
      if (cents === null)
        throw new Error("Amount must be a non-negative dollar value.");
      const r = await apiRequest("PUT", itemEndpoint, {
        amountMinor: cents,
        currency: currency || "USD",
        billingPeriod: period,
      });
      const j = await r.json();
      if (j && j.ok === false) throw new Error(j.error || "update_failed");
      return j;
    },
    onSuccess: () => {
      setDirty(false);
      props.onChanged();
      toast({ title: `Tier "${props.tier.slug}" updated` });
    },
    onError: (e: any) =>
      toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("DELETE", itemEndpoint);
      const j = await r.json();
      if (j && j.ok === false) throw new Error(j.error || "delete_failed");
      return j;
    },
    onSuccess: () => {
      props.onChanged();
      toast({ title: `Tier "${props.tier.slug}" removed` });
    },
    onError: (e: any) =>
      toast({ title: "Remove failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div
      className="grid md:grid-cols-5 gap-3 items-end"
      data-testid={`row-${rowTestid}`}
    >
      <div className="space-y-1.5">
        <Label className="text-xs">Tier</Label>
        <div className="h-9 flex items-center text-sm font-medium" data-testid={`text-${rowTestid}-slug`}>
          {props.tier.slug}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Amount (USD)</Label>
        <Input
          type="text"
          inputMode="decimal"
          value={amountMajor}
          onChange={(e) => {
            setAmountMajor(e.target.value);
            setDirty(true);
          }}
          data-testid={`input-${rowTestid}-amount`}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Currency</Label>
        <Input
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value.toUpperCase());
            setDirty(true);
          }}
          data-testid={`input-${rowTestid}-currency`}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Billing period</Label>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setDirty(true);
          }}
          data-testid={`select-${rowTestid}-period`}
        >
          {BILLING_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {!BILLING_PERIODS.includes(period as (typeof BILLING_PERIODS)[number]) && (
            <option value={period}>{period}</option>
          )}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !dirty}
          data-testid={`button-save-${rowTestid}`}
        >
          Save
        </Button>
        <Button
          variant="outline"
          onClick={() => deleteMut.mutate()}
          disabled={deleteMut.isPending}
          aria-label={`Remove tier ${props.tier.slug}`}
          data-testid={`button-delete-${rowTestid}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tab 2 — Collective (Section A flat fee + Section B subscription tiers)
 * ========================================================================== */
interface CollectiveFeeConfig {
  ok?: boolean;
  amountMinor: number;
  currency: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  source?: "db" | "default";
}

function CollectiveTab() {
  const { data, isLoading } = useQuery<CollectiveFeeConfig>({
    queryKey: ["/api/admin/collective/application-fee"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/collective/application-fee")).json(),
    retry: false,
  });

  return (
    <div className="space-y-4" data-testid="collective-fees-tab">
      {/* Section A — existing flat Founder Application Fee (key/routes UNCHANGED). */}
      <FlatFeeCard
        title="Founder Application Fee"
        helper="One-time flat fee paid by founders when they apply to present to the Collective."
        fee={data}
        isLoading={isLoading}
        endpoint="/api/admin/collective/application-fee"
        invalidateKeys={[
          "/api/admin/collective/application-fee",
          "/api/collective/application-fee",
        ]}
        testid="collective-application-fee"
      />

      {/* Section B — NEW Cap Table Investor Membership Subscription tiers. */}
      <TierTableSection
        title="Cap Table Investor Membership Subscription"
        helper="Recurring membership tiers for cap-table investors in the Collective. Add, edit, or remove tiers — each is stored as a platform_fees row (collective.member_subscription.*)."
        baseEndpoint="/api/admin/collective/member-subscription-tiers"
        testid="collective-member-subscription-tiers"
      />
    </div>
  );
}

/* ============================================================================
 * Tab 3 — Consortium Partners (Section A subscription tiers + Section B SPV fee)
 * ========================================================================== */
interface SpvFeeResponse {
  ok?: boolean;
  spvDeploymentFee?: FlatFee;
}

function ConsortiumTab() {
  const { data, isLoading } = useQuery<SpvFeeResponse>({
    queryKey: ["/api/admin/consortium/spv-deployment-fee"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/consortium/spv-deployment-fee")).json(),
    retry: false,
  });

  return (
    <div className="space-y-4" data-testid="consortium-fees-tab">
      {/* Section A — NEW Partner Subscription Tiers. */}
      <TierTableSection
        title="Partner Subscription Tiers"
        helper="Recurring subscription tiers for Consortium Partners. Add, edit, or remove tiers — each is stored as a platform_fees row (consortium.subscription.*)."
        baseEndpoint="/api/admin/consortium/subscription-tiers"
        testid="consortium-subscription-tiers"
      />

      {/* Section B — NEW flat SPV Deployment fee. */}
      <FlatFeeCard
        title="SPV Deployment Flat Fee"
        helper="Flat fee charged per SPV deployment by a Consortium Partner."
        fee={data?.spvDeploymentFee}
        isLoading={isLoading}
        endpoint="/api/admin/consortium/spv-deployment-fee"
        invalidateKeys={["/api/admin/consortium/spv-deployment-fee"]}
        testid="consortium-spv-deployment-fee"
      />
    </div>
  );
}

/* ============================================================================
 * Page shell — FilterChip tab strip + one section per tab.
 * ========================================================================== */
export default function AdminPlatformFees() {
  const [tab, setTab] = useState<TabKey>("capavate");

  return (
    <>
      <PageHeader
        title="Platform Fees"
        description="Admin-configurable platform fees, isolated by section. Capavate fees are managed in their original locations; the Collective and Consortium Partners fees are edited here."
      />
      <PageBody>
        <div className="flex flex-wrap gap-2 mb-6" data-testid="platform-fees-tabs">
          <FilterChip
            active={tab === "capavate"}
            onClick={() => setTab("capavate")}
            data-testid="tab-capavate"
          >
            Capavate
          </FilterChip>
          <FilterChip
            active={tab === "collective"}
            onClick={() => setTab("collective")}
            data-testid="tab-collective"
          >
            Collective
          </FilterChip>
          <FilterChip
            active={tab === "consortium"}
            onClick={() => setTab("consortium")}
            data-testid="tab-consortium"
          >
            Consortium Partners
          </FilterChip>
        </div>

        {tab === "capavate" && <CapavateTab />}
        {tab === "collective" && <CollectiveTab />}
        {tab === "consortium" && <ConsortiumTab />}
      </PageBody>
    </>
  );
}
