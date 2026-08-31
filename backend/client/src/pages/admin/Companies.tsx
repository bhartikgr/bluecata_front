/**
 * Sprint 28 Wave 3 — Admin Companies page.
 *
 * 100% PRODUCTION-READY. Zero mock data. Every row, every number, every
 * subscription status is derived from a real platform store via
 * GET /api/admin/companies/full which JOINs:
 *   - canonical companies store        (tenant directory)
 *   - canonical rounds store           (raised / round counts)
 *   - canonical softCircles store      (30d activity)
 *   - canonical dataroomFiles store    (document counts)
 *   - canonical reports store          (investor reports)
 *   - sprint10 telemetry events store  (event counts, last activity)
 *   - subscriptionsStore               (production-grade billing state)
 *
 * Money is sent in integer minor units (cents) + ISO currency code,
 * formatted client-side with Intl.NumberFormat per locale.
 *
 * Inline expandable row reveals the full subscription + activity strip.
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Building, ExternalLink, Search, Filter, ChevronDown, ChevronRight,
  CreditCard, MessageSquare, FileText, Activity as ActivityIcon, Sparkles,
  DollarSign, AlertCircle, Clock, CheckCircle2, RefreshCw,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { HelpTip } from "@/components/HelpTip";
import { apiRequest } from "@/lib/queryClient";
import { minorToMajorString } from "@/lib/moneyDisplay";
import { humanizeMachineKey } from "@/lib/partnerDisplay"; /* WAVE 124 · FINDING 1 — the platform's existing key-humanising helper. */
/* WAVE 180 · ITEM A SITE 5 — the client mirror of the platform's cross-currency
 * contract (client/src/lib/money/currencyBuckets.ts). Minor units are added
 * only within one ISO code; a mixed set yields a stated refusal, never a
 * converted figure, because this platform holds no exchange rate. */
import {
  newBuckets,
  addMinor,
  singleScalar,
  bucketRows,
  type CurrencyBucketRow,
} from "@/lib/money/currencyBuckets";

/* ---------- types matching server payload ---------- */
type SubscriptionStatus = "active" | "trialing" | "past_due" | "unpaid" | "cancelled";
type Plan = "founder_free" | "founder_pro" | "founder_scale" | "founder_enterprise";

interface Subscription {
  companyId: string;
  status: SubscriptionStatus;
  plan: Plan;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  invoicesCount: number;
  pastDueMinor?: number;
  trialEndsOn?: string;
  version: number;
}

interface CompanyRow {
  id: string;
  name: string;
  legalName: string;
  region: string;
  sector: string;
  stage: string;
  hq: string;
  maScore: number;
  /* WAVE 180 · ITEM A SITE 6→5 — the producer (server/routes.ts admin company
   * aggregate) no longer stamps the FIRST round's currency onto a sum taken
   * across every round. When a company's closed rounds span more than one ISO
   * code the scalar is null and the breakdown carries the truth. */
  totalRaisedMinor: number | null;
  currency: string | null;
  raisedCurrencies?: string[];
  totalRaisedUnavailableReason?: "needs_fx_conversion" | "no_data" | null;
  totalRaisedByCurrency?: CurrencyBucketRow[];
  activeRoundsCount: number;
  totalRoundsCount: number;
  softCircles30d: number;
  softCircle30dAmountMinor: number | null;
  softCircle30dCurrency?: string | null;
  softCircle30dCurrencies?: string[];
  softCircle30dUnavailableReason?: "needs_fx_conversion" | "no_data" | null;
  softCircle30dByCurrency?: CurrencyBucketRow[];
  dataroomFiles: number;
  reportsPublished: number;
  events30d: number;
  lastActivityAt: string | null;
  subscription: Subscription | null;
}

const PLAN_LABEL: Record<Plan, string> = {
  founder_free: "Free",
  founder_pro: "Pro",
  founder_scale: "Scale",
  founder_enterprise: "Enterprise",
};

const STATUS_TONE: Record<SubscriptionStatus, { label: string; bg: string; text: string }> = {
  active:    { label: "Active",    bg: "bg-emerald-100", text: "text-emerald-900" },
  trialing:  { label: "Trialing",  bg: "bg-sky-100",     text: "text-sky-900" },
  past_due:  { label: "Past due",  bg: "bg-amber-100",   text: "text-amber-900" },
  unpaid:    { label: "Unpaid",    bg: "bg-rose-100",    text: "text-rose-900" },
  cancelled: { label: "Cancelled", bg: "bg-slate-100",   text: "text-slate-700" },
};

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 124 · FINDING 2 — THE ONE SENTENCE THE PAST-DUE TILE IS ALLOWED TO SAY.
   ════════════════════════════════════════════════════════════════════════════
   Exported and pure so the rule can be EXECUTED by a test instead of inferred
   from the JSX: the defect was a disagreement between two numbers on one row,
   and the only way to prove it cannot recur is to run the sentence for the
   count/figure combinations that produced it. `outstandingMinor` must already be
   summed over past-due subscriptions that carry a recorded figure — an absent
   register contributes nothing, it does not contribute zero. */
export function pastDueOutstandingHint(
  pastDueCount: number,
  figuresOnRecord: number,
  outstandingMinor: number,
): string {
  if (pastDueCount === 0) return "0 outstanding";
  if (figuresOnRecord === 0) return "Outstanding amount not on record";
  if (figuresOnRecord === pastDueCount) return `${fmtMoney(outstandingMinor)} outstanding`;
  return `${fmtMoney(outstandingMinor)} outstanding on ${figuresOnRecord} of ${pastDueCount}`;
}

/** Format integer minor units as a localised currency string. */
function fmtMoney(minor: number, currency = "USD"): string {
  /* WAVE 21 ITEM 5: hardcoded /100 ignored the `currency` argument. */
  const amount = Number(minorToMajorString(minor, currency));
  try {
    if (amount >= 1_000_000) {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 1 }).format(amount / 1_000_000) + "M";
    }
    if (amount >= 1_000) {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 1 }).format(amount / 1_000) + "K";
    }
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 180 · ITEM A SITE 5 — THE ONE SENTENCE THE ACTIVE-SUBS TILE MAY SAY.
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT. `annualArrMinor` reduced `annualAmountMinor` across every active
   subscription while `Subscription.currency` — declared on the very interface
   being reduced — went unread, and the tile then printed the result through
   `fmtMoney(minor)` whose currency argument DEFAULTS to USD. A tenant billed in
   CAD contributed its minor units to a figure labelled in dollars. The per-row
   render three hundred lines below was already correct
   (`fmtMoney(sub.pastDueMinor, sub.currency)`), which is the proof the code had
   the currency in hand and dropped it on the way into the aggregate.

   Exported and pure for the same reason wave 124 exported its neighbour: the
   rule is EXECUTED by a test rather than inferred from JSX. It states the scope
   the brief requires — what is included, what is excluded, in which currency —
   and where no single figure exists it names why instead of printing a zero or
   a bare dash. NO EXCHANGE RATE IS APPLIED; this platform has none. */
export function annualArrHint(
  subjectCount: number,
  rows: CurrencyBucketRow[],
  excludedNoCurrency: number,
  noun = "annual ARR",
): string {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const excl = excludedNoCurrency > 0
    ? ` ${excludedNoCurrency} row${excludedNoCurrency === 1 ? "" : "s"} excluded: no ISO currency on record.`
    : "";
  if (subjectCount === 0) return `No rows in scope.${excl}`;
  if (rows.length === 0) return `${Noun} not on record.${excl}`;
  if (rows.length === 1) {
    const r = rows[0]!;
    if (r.minor === null) return `${Noun} in ${r.currency} is too large to report exactly.${excl}`;
    return `${fmtMoney(r.minor, r.currency)} ${noun}${excl}`;
  }
  const parts = rows.map((r) => (r.minor === null ? `${r.currency} not reportable` : fmtMoney(r.minor, r.currency)));
  return `${Noun} by currency: ${parts.join(" + ")}. Not added together — this platform holds no exchange rate.${excl}`;
}

/* WAVE 180 · ITEM A SITE 6→5 — the stated fallback for a figure that genuinely
   cannot be derived. It names the currencies involved and the reason, per the
   owner's rule that an unexplained total is itself the defect and that a
   fabricated zero or a bare blank is never acceptable. */
export function raisedMixedText(currencies: string[] | undefined): string {
  const list = (currencies ?? []).filter(Boolean);
  if (list.length === 0) return "—";
  return `Recorded in ${list.join(" and ")} — no single total (no exchange rate on this platform)`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminCompanies() {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [subStatus, setSubStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ rows: CompanyRow[] }>({
    queryKey: ["/api/admin/companies/full"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/companies/full")).json(),
    refetchInterval: 30_000,
  });

  const allRows = data?.rows ?? [];

  // Build region + stage option lists from real data (no hardcoded enums).
  const regionOptions = useMemo(() => {
    const set = new Set(allRows.map((r) => r.region).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [allRows]);
  const stageOptions = useMemo(() => {
    const set = new Set(allRows.map((r) => r.stage).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [allRows]);

  const filtered = useMemo(() => allRows.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q.toLowerCase()) && !c.legalName.toLowerCase().includes(q.toLowerCase())) return false;
    if (region !== "all" && c.region !== region) return false;
    if (stage !== "all" && c.stage !== stage) return false;
    if (subStatus !== "all" && c.subscription?.status !== subStatus) return false;
    return true;
  }), [allRows, q, region, stage, subStatus]);

  /** Aggregate analytics computed across ALL rows (filter-independent). */
  const aggregates = useMemo(() => {
    const total = allRows.length;
    const subs = allRows.map((r) => r.subscription).filter((s): s is Subscription => s !== null);
    const active = subs.filter(s => s.status === "active").length;
    const trialing = subs.filter(s => s.status === "trialing").length;
    const pastDue = subs.filter(s => s.status === "past_due").length;
    const unpaid = subs.filter(s => s.status === "unpaid").length;
    const cancelled = subs.filter(s => s.status === "cancelled").length;
    /* WAVE 180 · ITEM A SITE 5 — was
       `subs.filter(...).reduce((sum, s) => sum + s.annualAmountMinor, 0)`, which
       added minor units across currencies and handed the result to a formatter
       defaulting to USD. Each currency now accumulates in its own bucket; a row
       whose code is not ISO 4217 is COUNTED AND EXCLUDED rather than defaulted
       into an arbitrary bucket, and the count is stated on screen. */
    const activeSubs = subs.filter(s => s.status === "active");
    const arrBuckets = newBuckets();
    let arrExcludedNoCurrency = 0;
    for (const s of activeSubs) {
      if (!addMinor(arrBuckets, s.currency, s.annualAmountMinor)) arrExcludedNoCurrency += 1;
    }
    const arrScalar = singleScalar(arrBuckets);
    const annualArrMinor = arrScalar.available ? arrScalar.minor : null;
    const annualArrCurrency = arrScalar.available ? arrScalar.currency : null;
    const annualArrByCurrency = bucketRows(arrBuckets);
    const annualArrHintText = annualArrHint(activeSubs.length, annualArrByCurrency, arrExcludedNoCurrency);
    /* WAVE 124 · FINDING 2 — A CONFIDENT $0 THAT MEANS "UNKNOWN".
       `subscriptions.past_due_minor` is the SEVENTH unfed money register on this
       platform: the only writer in the tree is the `co_quanta` seed constant
       (server/subscriptionsStore.ts:258). `updateSubscription` (:414) lists the
       key as mutable but NO caller ever passes it — not the payment-gateway
       adapter, not the partner portfolio route, not the store's own helpers. So
       for every past-due tenant except the one seeded row, `pastDueMinor` is
       absent, this sum collapsed to 0, and the tile printed "0 outstanding"
       directly beside a NON-ZERO past-due count. The two numbers on one row
       contradicted each other, and the $0 was not a measurement — it was a
       missing measurement wearing a number.
       The sum is now taken ONLY over past-due subscriptions that actually carry
       a recorded figure, and the count of those is carried out so the hint can
       state what is and is not on record. No figure is invented and no register
       is back-filled here: feeding the register is a server change outside this
       wave's ownership and is reported, not faked. */
    const pastDueSubs = subs.filter(s => s.status === "past_due");
    const pastDueWithFigure = pastDueSubs.filter(s => typeof s.pastDueMinor === "number" && s.pastDueMinor > 0);
    /* WAVE 180 · ITEM A SITE 5 — the same cross-currency defect sat on the
       past-due sum. Wave 124's sentence is UNCHANGED and still governs the
       single-currency case (its test executes it directly); the mixed case can
       no longer reach it with a bogus number, because `pastDueMinor` becomes
       null and the clarifier below states the breakdown instead. */
    const pastDueBuckets = newBuckets();
    let pastDueExcludedNoCurrency = 0;
    for (const s of pastDueWithFigure) {
      if (!addMinor(pastDueBuckets, s.currency, s.pastDueMinor ?? 0)) pastDueExcludedNoCurrency += 1;
    }
    const pastDueScalar = singleScalar(pastDueBuckets);
    const pastDueMinor = pastDueScalar.available ? pastDueScalar.minor : null;
    const pastDueByCurrency = bucketRows(pastDueBuckets);
    const pastDueFiguresOnRecord = pastDueWithFigure.length;
    const stale = allRows.filter(r => {
      const d = daysSince(r.lastActivityAt);
      return d !== null && d > 14;
    }).length;
    const avgMaScore = total > 0 ? Math.round(allRows.reduce((sum, r) => sum + r.maScore, 0) / total) : 0;
    /* WAVE 124 · FINDING 2 — the hint is resolved HERE, inside the memo, and the
       tile below reads ONE value. The stats array keeps its five static entries
       and its static shape, so the silent-drop guard's positional child identity
       for this panel is untouched (build_log/wave116/W116_TESTS.md §3.1). */
    /* WAVE 180 · ITEM A SITE 5 — when the outstanding figures span currencies
       there is no single `outstandingMinor` to hand wave 124's sentence, so the
       tile states the per-currency scope instead. Wave 124's function is called
       with exactly its old argument in exactly its old case. */
    const pastDueHint = pastDueScalar.available
      ? pastDueOutstandingHint(pastDue, pastDueFiguresOnRecord, pastDueScalar.minor)
      : annualArrHint(pastDue, pastDueByCurrency, pastDueExcludedNoCurrency, "outstanding");
    return { total, active, trialing, pastDue, unpaid, cancelled, annualArrMinor, annualArrCurrency, annualArrByCurrency, annualArrHintText, arrExcludedNoCurrency, pastDueMinor, pastDueByCurrency, pastDueFiguresOnRecord, pastDueHint, stale, avgMaScore };
  }, [allRows]);

  return (
    <>
      <PageHeader
        title="Companies"
        description="Tenant directory across all regions. Click into a company for the full Profile + M&A intelligence view."
        breadcrumbs={[{ label: "Admin" }, { label: "Companies" }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-companies">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Tenant inventory",
            title: "Companies — every founder workspace, every subscription, every activity signal",
            description:
              "Every Capavate tenant rolls up here with three live dimensions overlaid: (1) fundraising posture — stage, total raised, M&A score, active and total rounds; (2) subscription health — plan, billing status, annual ARR contribution, past-due dollars, version-tracked revision history; (3) activity signal — last platform event, soft-circles in the last 30 days, dataroom files, investor reports published, telemetry event volume. Use the filters to find at-risk tenants quickly, and click any row's chevron to expand the inline subscription + activity stats strip.",
            warning:
              "Past-due tenants without billing follow-up within 5 business days enter the dunning ladder and risk a churn event under the Lifecycle Policy `gracePeriodDays` setting. Cancelled tenants are read-only — preserve the dataroom per the regional archival retention rule before any export.",
            positive:
              "An M&A score above 80 combined with active subscription and 5+ soft-circles in the last 30 days is the platform's strongest acquisition / Series-B readiness signal. Forward those tenants to the partnership ops queue for high-touch engagement. Every row is derived from live platform stores — soft circles, dataroom uploads, and event counts update in real time.",
          }}
          stats={[
            { label: "Total tenants", value: aggregates.total, hint: "Across all stages" },
            /* WAVE 180 · ITEM A SITE 5 — the tile keeps its five static entries
               and its static shape (wave 124's positional-identity note above
               still applies). Only the hint EXPRESSION changed: it is now
               resolved in the memo and states the currency scope. */
            { label: "Active subs", value: aggregates.active, hint: aggregates.annualArrHintText, tone: "positive" },
            { label: "Trialing", value: aggregates.trialing, hint: "Convert within trial" },
            { label: "Past-due", value: aggregates.pastDue, hint: aggregates.pastDueHint, tone: aggregates.pastDue > 0 ? "warning" : "neutral" },
            { label: "Stale (>14d)", value: aggregates.stale, hint: "No activity", tone: aggregates.stale > 1 ? "warning" : "neutral" },
          ]}
        />

        <Card className="mb-6">
          <CardContent className="pt-5">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex items-center gap-2 px-3 rounded-md border border-border flex-1 bg-background">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input className="border-0 px-0 focus-visible:ring-0" placeholder="Search by name or legal name…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-companies" />
              </div>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="w-40" data-testid="select-region">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent>
                  {regionOptions.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt === "all" ? "All regions" : opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="w-40" data-testid="select-stage">
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  {stageOptions.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt === "all" ? "All stages" : opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={subStatus} onValueChange={setSubStatus}>
                <SelectTrigger className="w-44" data-testid="select-sub-status">
                  <CreditCard className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Subscription" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All subscriptions</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="past_due">Past due</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
              Showing {filtered.length} of {allRows.length} tenants
              <HelpTip>Filters compound. The aggregate stats above are computed across ALL tenants regardless of filter so they reflect the platform truth, not the filtered view.</HelpTip>
              {isLoading && <span className="ml-2 inline-flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" />Loading…</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0">
            <div className="max-h-[65vh] overflow-y-auto">
              <table className="w-full text-sm" data-testid="table-companies">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                    <th className="text-left font-medium px-6 py-2.5">Company</th>
                    <th className="text-left font-medium px-3 py-2.5">Region</th>
                    <th className="text-left font-medium px-3 py-2.5">Stage</th>
                    <th className="text-right font-medium px-3 py-2.5">
                      <span className="inline-flex items-center gap-1">
                        M&A <HelpTip>Composite acquisition-readiness score (0-100). Combines round velocity, dataroom maturity, investor engagement, financial signals.</HelpTip>
                      </span>
                    </th>
                    <th className="text-right font-medium px-3 py-2.5">Raised</th>
                    <th className="text-right font-medium px-3 py-2.5">Active rounds</th>
                    <th className="text-left font-medium px-3 py-2.5">Subscription</th>
                    <th className="text-left font-medium px-3 py-2.5">Last activity</th>
                    <th className="px-3 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const sub = c.subscription;
                    const tone = sub ? STATUS_TONE[sub.status] : null;
                    const isExpanded = expandedId === c.id;
                    const activityDays = daysSince(c.lastActivityAt);
                    return (
                      <CompanyRowComponent
                        key={c.id}
                        c={c}
                        sub={sub}
                        tone={tone}
                        isExpanded={isExpanded}
                        activityDays={activityDays}
                        onToggle={() => setExpandedId(isExpanded ? null : c.id)}
                      />
                    );
                  })}
                  {!isLoading && filtered.length === 0 && (
                    <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No companies match these filters.</td></tr>
                  )}
                  {isLoading && allRows.length === 0 && (
                    <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground inline-flex items-center gap-2 justify-center">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading live company data…
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

function CompanyRowComponent({
  c, sub, tone, isExpanded, activityDays, onToggle,
}: {
  c: CompanyRow;
  sub: Subscription | null;
  tone: { label: string; bg: string; text: string } | null;
  isExpanded: boolean;
  activityDays: number | null;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-company-${c.id}`}>
        <td className="px-6 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={isExpanded ? "Collapse details" : "Expand details"}
              aria-expanded={isExpanded}
              className="text-muted-foreground hover:text-foreground"
              data-testid={`button-expand-${c.id}`}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <Link href={`/admin/companies/${c.id}`} className="font-medium hover:underline flex items-center gap-2">
              <div className="h-7 w-7 rounded bg-[hsl(0_100%_40%)]/10 flex items-center justify-center">
                <Building className="h-3.5 w-3.5 text-[hsl(0_100%_40%)]" />
              </div>
              <span>
                {c.name}
                <span className="block text-[10px] text-muted-foreground font-normal">{c.legalName}</span>
              </span>
            </Link>
          </div>
        </td>
        <td className="px-3 py-3"><Badge variant="outline" className="text-[10px]">{c.region}</Badge></td>
        {/* WAVE 124 · FINDING 1 — the tenant table printed the raw fundraising
            stage key and leaned on CSS `capitalize`, which turns `series_a` into
            "Series_a" and `pre_seed` into "Pre_seed" — the underscore is still on
            screen. Humanised in the data, not in the stylesheet. R91: this ladder
            is NOT remapped onto the CRM or partner ladders. */}
        <td className="px-3 py-3 capitalize text-muted-foreground">{humanizeMachineKey(c.stage, "—")}</td>
        <td className="px-3 py-3 text-right">
          <span className={`font-mono tabular-nums ${c.maScore >= 80 ? "text-emerald-600" : c.maScore >= 60 ? "text-amber-600" : "text-muted-foreground"}`}>
            {c.maScore || "—"}
          </span>
        </td>
        {/* WAVE 180 · ITEM A SITE 6→5 — `totalRaisedMinor` is now null when this
            company's closed rounds span currencies. A bare "—" would read as
            "nothing raised", so the mixed case says WHICH currencies were found
            and why they are not added. The single-currency branch is
            byte-identical to what shipped. */}
        <td className="px-3 py-3 text-right font-mono tabular-nums">
          {c.totalRaisedMinor !== null && c.totalRaisedMinor > 0 && c.currency
            ? fmtMoney(c.totalRaisedMinor, c.currency)
            : c.totalRaisedUnavailableReason === "needs_fx_conversion"
              ? <span className="text-[11px] font-sans text-amber-700" data-testid={`text-raised-mixed-${c.id}`}>{raisedMixedText(c.raisedCurrencies)}</span>
              : "—"}
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground" data-testid={`text-rounds-${c.id}`}>
          {c.activeRoundsCount} / {c.totalRoundsCount}
        </td>
        <td className="px-3 py-3">
          {sub && tone ? (
            <>
              <Badge className={`text-[10px] border-0 ${tone.bg} ${tone.text}`} data-testid={`badge-sub-${c.id}`}>
                {tone.label}
              </Badge>
              <div className="text-[10px] text-muted-foreground mt-0.5">{PLAN_LABEL[sub.plan]}</div>
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-muted-foreground text-xs" data-testid={`text-lastactivity-${c.id}`}>
          {activityDays === null ? "—" :
           activityDays === 0 ? "today" :
           activityDays === 1 ? "yesterday" :
           `${activityDays}d ago`}
        </td>
        <td className="px-3 py-3">
          <Button variant="ghost" size="icon" data-testid={`button-open-${c.id}`} asChild>
            <Link href={`/admin/companies/${c.id}`}><ExternalLink className="h-4 w-4" /></Link>
          </Button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30 border-b border-border" data-testid={`row-detail-${c.id}`}>
          <td colSpan={9} className="px-6 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CreditCard className="h-3 w-3" />
                  Subscription
                  <HelpTip>Snapshot of the tenant's billing state from the production subscriptionsStore. Past-due means the most recent invoice failed; the dunning ladder retries 1d, 3d, 7d before downgrade to Free.</HelpTip>
                </div>
                {sub ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <Stat label="Status" value={STATUS_TONE[sub.status].label} />
                    <Stat label="Plan" value={PLAN_LABEL[sub.plan]} />
                    <Stat label="Annual" value={sub.annualAmountMinor > 0 ? fmtMoney(sub.annualAmountMinor, sub.currency) : "—"} />
                    <Stat label="Renews" value={sub.renewsOn} />
                    <Stat label="Card" value={sub.cardLast4 ? `•••• ${sub.cardLast4}` : "—"} />
                    <Stat label="Invoices" value={String(sub.invoicesCount)} />
                    {typeof sub.pastDueMinor === "number" && sub.pastDueMinor > 0 && (
                      <Stat label="Past-due" value={fmtMoney(sub.pastDueMinor, sub.currency)} tone="warn" />
                    )}
                    {sub.trialEndsOn && (
                      <Stat label="Trial ends" value={sub.trialEndsOn} />
                    )}
                    <Stat label="Rev. version" value={`v${sub.version}`} />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No subscription record on file.</div>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ActivityIcon className="h-3 w-3" />
                  Activity (last 30 days)
                  <HelpTip>Behavioural signals from the live platform stores: soft-circles, dataroom uploads, reports, telemetry events. Low values together is the classic at-risk pattern.</HelpTip>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Stat icon={<Clock className="h-3 w-3" />} label="Last activity" value={c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString() : "—"} tone={activityDays !== null && activityDays > 14 ? "warn" : undefined} />
                  {/* WAVE 180 · ITEM A SITE 6→5 — soft circles carry their own
                      `soft_circles.currency`; the aggregate used to borrow the
                      first ROUND's code for all of them. Mixed ⇒ the scope is
                      stated in place of a number. */}
                  <Stat icon={<DollarSign className="h-3 w-3" />} label="Soft circles" value={`${c.softCircles30d} (${c.softCircle30dAmountMinor !== null && c.softCircle30dCurrency ? fmtMoney(c.softCircle30dAmountMinor, c.softCircle30dCurrency) : raisedMixedText(c.softCircle30dCurrencies)})`} />
                  <Stat icon={<Building className="h-3 w-3" />} label="Rounds" value={`${c.activeRoundsCount} active / ${c.totalRoundsCount} total`} />
                  <Stat icon={<FileText className="h-3 w-3" />} label="Dataroom files" value={String(c.dataroomFiles)} />
                  <Stat icon={<MessageSquare className="h-3 w-3" />} label="Reports published" value={String(c.reportsPublished)} />
                  <Stat icon={<Sparkles className="h-3 w-3" />} label="Events 30d" value={String(c.events30d)} />
                  <Stat icon={<CheckCircle2 className="h-3 w-3" />} label="Total raised" value={c.totalRaisedMinor !== null && c.totalRaisedMinor > 0 && c.currency ? fmtMoney(c.totalRaisedMinor, c.currency) : c.totalRaisedUnavailableReason === "needs_fx_conversion" ? raisedMixedText(c.raisedCurrencies) : "—"} />
                  <Stat icon={<AlertCircle className="h-3 w-3" />} label="M&A score" value={c.maScore ? String(c.maScore) : "—"} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ icon, label, value, tone }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground flex items-center gap-1 min-w-[7rem]">
        {icon}
        {label}
      </span>
      <span className={`font-medium ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</span>
    </div>
  );
}
