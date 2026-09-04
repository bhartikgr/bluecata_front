/**
 * Sprint 28 Wave 2 — Admin Dashboard rebuild.
 *
 * Two surfaces (Capavate ⇄ Collective) selectable via a prominent toggle at
 * the top of the page. The toggle drives a `?surface=` query param that the
 * KPI + activity endpoints honour, so the same UI renders either view.
 *
 * Surface meanings:
 *   - Capavate (default): platform operations — companies, rounds, cap tables,
 *     soft circles, dataroom, founder workflows. The metrics here are the ones
 *     ops uses to monitor the day-to-day health of the SaaS platform.
 *   - Collective: member-facing accredited-investor community — members,
 *     tiers, applications, KYC, syndicates, deal-room sharing. The metrics here
 *     are the ones the partnership ops team uses to track community health.
 *
 * Every panel carries a HelpTip with the precise definition of what's being
 * measured, why it matters, and what good/bad looks like — so a new admin
 * can pick this page up and act on it without separate documentation.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, Users, Building2, DollarSign, ShieldCheck, Activity, Globe,
  Sparkles, ArrowLeftRight, AlertCircle, Clock, Mail, Network, Inbox, Send,
  Zap, BarChart3, FileText, CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/HelpTip";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { BuildVersionMarker } from "@/components/BuildVersionMarker";
import { apiRequest } from "@/lib/queryClient";
/* WAVE 34 · TASK 2 — ISO-4217 exponent for the per-currency SPV money tiles. */
/* WAVE 161 · ITEM A (A3) — "Not on record", the platform's existing words for an
   absent money figure. A bare em-dash is not copy (R77). */
import { fromMinor, MONEY_NOT_ON_RECORD } from "@/lib/currency";
/* WAVE 230D — the admin control for test-data exclusion (R230.3: none existed).
   Appended as the LAST child of the page body below; nothing above it moves. */
import { AdminTestDataExclusionPanel } from "@/components/admin/AdminTestDataExclusionPanel";

/* WAVE 163 - BLOCKER 3: a committed-only number was described as non-withdrawn.
 * Wave 161 corrected the SPV Committed tile's BASIS to `status = 'committed'`
 * only, but left the tile's FIRST tooltip reading "Sum of active (non-withdrawn)
 * SPV commitments" and added the correction as a SECOND tip beside it. The
 * post-build review is blunt about the result: the first sentence an operator
 * reads still describes an all-stages population, so the tile explains itself
 * wrongly and the second tip only contradicts the first. R137.3 and the brief
 * both require the wording to match WHAT THE NUMBER NOW IS.
 *
 * WHAT CHANGED, AND WHAT DID NOT.
 *   - The committed heading's FIRST tip is now ADMIN_SPV_COMMITTED_TOOLTIP,
 *     which states the committed-only basis in the first clause a reader meets.
 *   - The baselined sentence is NOT DELETED. It was, and remains, a TRUE
 *     description of the pipeline line at the foot of this tile, so it is
 *     RELOCATED there verbatim rather than dropped - silent-drop rule #8 and the
 *     copy guard are both satisfied because the string still exists in this file,
 *     now beside the figure it actually describes.
 *   - No figure, no query, no read and no server field is touched. The backing
 *     reads (server/lib/adminKpiDbReads.ts:298-315 committed-only, :317-337
 *     pipeline) were already correct; only the words were wrong. */
/* BOTH SENTENCES STAY AS LITERAL JSX TEXT, NOT CONSTANTS. The silent-drop guard
 * indexes copy by the literal text node it finds in the file: hoisting the wave 161
 * sentence into a `const` made the guard report it as a REMOVED copy string and
 * blocked the build, exactly as the brief warns happened to an earlier builder. It
 * is therefore restored verbatim, in place, as text. */

// v25.42h round-2 — the backend now returns `null` (never a fabricated number)
// for any metric without a defensible source. Reflect that in the type so the
// consuming UI is forced to null-check before calling .toFixed()/.toLocaleString().
type Kpis = {
  summary: {
    totalCompanies: number;
    totalInvestors: number;
    totalCommittedSoftCircle: number | null;
    totalFunded: number | null;
    momGrowthPct: number | null;
    churnPct: number | null;
    nrr: number | null;
    // v26.4.0-fix2 (unanimous reviewer BLOCK) — Wave B SPV tiles wired to UI.
    // Per-currency maps (Record<currency, minor_units>) render one tile per
    // currency. On PG (Wave B.5 lands schema): server returns {} — UI shows "—".
    // v26.4.0-fix3 (GPT NEW-2): totalActiveSpvs is nullable — on PG the server
    // returns null, which renders as "—" (honest "unavailable"), NOT a fake 0.
    totalSpvCommittedMinor?: Record<string, number>;
    /* WAVE 161 · BATCH 3 ITEM A (A3) — `totalSpvCommittedMinor` now means
       `status = 'committed'` only; this is the all-stages pipeline figure it used
       to contain, served alongside so nothing is lost and each is labelled. */
    totalSpvSubscribedAllStagesMinor?: Record<string, number>;
    totalSpvWiredMinor?: Record<string, number>;
    totalActiveSpvs?: number | null;
  };
  queues: Record<string, number | null>;
  health: { capTableReconcile: { runs: number; success: number; successRatePct: number | null }; closeGateFailures: number | null; dataroomUploadErrors: number | null; messageDelivery: { sent: number | null; delivered: number | null; deliveryRatePct: number | null }; emailSlaSec: number | null };
  funnels: { onboarding: { step: string; count: number }[]; investor: { step: string; count: number }[] };
  topCompanies: { id: string; name: string; traction: number; raised: number | null }[];
  topInvestors: { id: string; name: string; activity: number; committed: number | null }[];
  regions: { code: string; companies: number; raised: number | null }[];
};

type Surface = "capavate" | "collective";

// v25.42h round-2 — null-safe currency formatters. Backend metrics can now be
// null; show an em-dash placeholder instead of crashing on .toLocaleString()/.toFixed().
const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString());
const fmtUsdShort = (n: number | null | undefined) =>
  n == null ? "—" :
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` :
  `$${n}`;

/* ---------- Surface-aware copy ---------- */
const SURFACE_COPY: Record<Surface, {
  introTitle: string;
  introDesc: string;
  introWarning: string;
  introPositive: string;
  kpi1Label: string; kpi1Help: string;
  kpi2Label: string; kpi2Help: string;
  kpi3Label: string; kpi3Help: string; kpi3Badge: string;
  kpi4Label: string; kpi4Help: string;
  funnelOnboardingTitle: string; funnelOnboardingHelp: string;
  funnelInvestorTitle: string; funnelInvestorHelp: string;
  topListTitle: string; topListHelp: string;
}> = {
  capavate: {
    introTitle: "Capavate operations — platform health, fundraising flow, top performers",
    introDesc: "This view shows the operational state of the Capavate SaaS platform: how many founder companies are active, how soft-circles convert to funded rounds, where reconciliation has caught issues, and which tenants are most active. Metrics refresh every 15 seconds.",
    introWarning: "Treat the Health row as live SLO trackers. Reconcile success below 99%, message delivery below 99.5%, or close-gate failures above 5/day all warrant investigation — escalate to engineering before the next round closes.",
    introPositive: "Top companies and investors are ranked by a composite traction score (frequency × magnitude × recency). Use this to brief partnerships ops on who to engage proactively.",
    kpi1Label: "Companies", kpi1Help: "Total active founder workspaces on Capavate. Includes seed, Series A+, and Pre-Seed tenants regardless of round state. Trailing 30-day net new is shown as the MoM% badge.",
    kpi2Label: "Investors", kpi2Help: "Total invited-or-active investor user accounts. NRR x is the Net Revenue Retention multiple (active investor billing this quarter ÷ active investor billing prior quarter on the same cohort).",
    /* WAVE 123 · FINDING 3 — THE BADGE SAID "Committed" WHILE THE LABEL SAID
       "Soft-circled", AND THE READER HAD NO WAY TO KNOW WHICH THE NUMBER WAS.
       ESTABLISHED FROM THE WRITER, NOT FROM THE OTHER PIECE OF COPY:
       `server/adminPlatformStore.ts` fills this field from
       `dbTotalCommittedSoftCircle()` in `server/lib/adminKpiDbReads.ts`, which
       sums `amount` over EVERY non-deleted row of `soft_circles` for every
       company — the query filters on `deleted_at IS NULL` and nothing else. So
       the arithmetic is soft-circle INDICATIONS OF INTEREST in every state; it is
       not committed capital, and it is not a live "currently outstanding"
       balance. The LABEL was right and the BADGE was wrong, so the badge is
       corrected to the non-binding wording and one sentence is APPENDED to the
       help text recording what the sum actually covers. THE ARITHMETIC IS NOT
       TOUCHED: restricting the sum to open soft-circles changes a published
       platform number and is its own wave. */
    kpi3Label: "Soft-circled", kpi3Badge: "Non-binding", kpi3Help: "Sum of every non-binding investor commitment currently outstanding across all active rounds. A high ratio of soft-circled : funded suggests pipeline conversion friction worth investigating. Read the figure as the total of every soft-circle indication on record — the sum includes soft-circles in every state and is filtered only by deletion, so it is an indication of interest and not committed or wired capital.",
    /* WAVE 61a · R51 — the clause "in the last 30 days" was DEMONSTRABLY FALSE and
       is replaced (R44 row 1). server/adminPlatformStore.ts computes
       `churnPct = cancelled / everCount * 100`, where `everCount` is a UNION over
       the whole of `subscriptions` and `subscriptions_history` — there is no date
       predicate, no window and no period of any kind in that query. One sentence
       is APPENDED recording the consequence the owner asked for. THE ARITHMETIC IS
       NOT TOUCHED: a real 30-day window needs a transition timestamp on
       `subscriptions_history` and is its own wave. */
    kpi4Label: "Funded", kpi4Help: "Sum of cash that has actually wired into companies and been committed to the cap table. Churn% is the percentage of paying founder accounts that downgraded or cancelled since the account was created. Because the denominator is every account that has ever subscribed, this figure can never decrease over time.",
    funnelOnboardingTitle: "Founder onboarding funnel",
    funnelOnboardingHelp: "Drop-off between (1) creating a company on Capavate, (2) opening their first round, (3) closing their first round. Steep drop from create→round indicates onboarding friction; steep drop from round→close indicates deal-flow friction.",
    funnelInvestorTitle: "Investor commitment funnel",
    funnelInvestorHelp: "Drop-off from invitation sent → soft-circle indicated → funds wired. The invited→soft-circled rate is your invite-quality signal; the soft-circled→funded rate is your closing-tools signal.",
    topListTitle: "Top companies by traction",
    topListHelp: "Composite score combining round velocity, investor engagement, dataroom views, and report read-through. Use to identify both bright spots to amplify and at-risk tenants to retain.",
  },
  collective: {
    introTitle: "Collective community — membership, applications, syndication, deal flow",
    introDesc: "This view shows the state of the member-facing accredited-investor community that sits on top of Capavate. Members apply through KYC, are vetted by ops, then gain access to syndicated deal flow, network features, and the Collective deal room. Metrics refresh every 15 seconds.",
    introWarning: "The Pending Applications queue must clear within 5 business days per the member SLA. Sustained pending counts above 15 or KYC-stuck applicants above 7 require partnerships ops attention before reputation damage compounds.",
    introPositive: "Member tier composition drives the platform's commercial flywheel: Standard members fund the operations, Lead/Syndicate members drive deal velocity, and Consortium Partners (law firms etc.) drive credibility. Watch the mix.",
    kpi1Label: "Members", kpi1Help: "Total Collective members across all statuses (active, lapsed, suspended, applied, pending). Use this as the top-of-funnel metric; the Active count below is the engaged subset.",
    kpi2Label: "Active members", kpi2Help: "Members with status=active (paid renewal current + KYC current). NRR is computed on this cohort only and reflects upgrades from Standard → Syndicate Lead tier.",
    kpi3Label: "Committed via syndicates", kpi3Badge: "Committed", kpi3Help: "Sum of every member-side commitment to a Collective-syndicated round in the last 12 months. Includes both deployed and pending allocations.",
    kpi4Label: "Deployed via syndicates", kpi4Help: "Sum of capital that has actually closed through Collective syndication. Committed÷Deployed gives you the syndication conversion rate — target above 65% for a healthy community.",
    funnelOnboardingTitle: "Application → activation funnel",
    funnelOnboardingHelp: "Started → submitted → KYC completed → activated. KYC is the most common drop-off — partner with the KYC vendor's CSM if completed/submitted ratio falls below 70%.",
    funnelInvestorTitle: "Deal-flow conversion funnel",
    funnelInvestorHelp: "Deals shared with members → deals viewed → soft-circled → joined the syndicate. View rate above 75% indicates the deal-room is delivering relevant flow; soft-circle rate above 35% indicates strong member intent.",
    topListTitle: "Membership tiers by activity",
    topListHelp: "Member count per tier and the cumulative committed capital from each tier. Helps you spot tier-mix imbalance (e.g. too many Standard, too few Lead) and price the next year's tier ladder.",
  },
};

export default function AdminDashboard() {
  const [surface, setSurface] = useState<Surface>("capavate");
  const copy = SURFACE_COPY[surface];

  // v25.42h round-2 — the KPI endpoint now returns 503 (ok:false) on a hard DB
  // read failure instead of a fabricated payload. apiRequest() throws on non-2xx,
  // so `isError` surfaces that here and we render an explicit banner (not zeros,
  // not a crash).
  const { data, isLoading, isError } = useQuery<Kpis>({
    queryKey: ["/api/admin/dashboard/kpis", surface],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/admin/dashboard/kpis?surface=${surface}`);
      return r.json();
    },
    refetchInterval: 15_000,
    retry: false,
  });

  const activity = useQuery<{ items: { id: string; ts: string; actor: string; entity: string; kind: string; text: string }[] }>({
    queryKey: ["/api/admin/dashboard/activity", surface],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/admin/dashboard/activity?surface=${surface}`);
      return r.json();
    },
    refetchInterval: 10_000,
  });

  // Sprint 28 — derived analytics for the new "Conversion" panel.
  const conversions = useMemo(() => {
    if (!data) return null;
    const onb = data.funnels.onboarding;
    const inv = data.funnels.investor;
    const topToBottom = (arr: { count: number }[]) =>
      arr.length >= 2 ? ((arr[arr.length - 1].count / (arr[0].count || 1)) * 100).toFixed(1) : "—";
    // v25.42h round-2 — totalFunded/totalCommittedSoftCircle are now nullable.
    // Only compute the ratio when BOTH are real, positive numbers.
    const sc = data.summary.totalCommittedSoftCircle;
    const funded = data.summary.totalFunded;
    const softCircleToFunded =
      sc != null && funded != null && sc > 0
        ? ((funded / sc) * 100).toFixed(1)
        : "—";
    return {
      onboardingEndToEnd: topToBottom(onb) + "%",
      investorEndToEnd: topToBottom(inv) + "%",
      softCircleToFunded: softCircleToFunded + "%",
    };
  }, [data]);

  // Sprint 28 — micro analytics: per-region density (capital ÷ companies).
  const regionDensity = useMemo(() => {
    if (!data) return [];
    // v25.42h round-2 — r.raised is now nullable (collective surface has no
    // per-region raised aggregate).
    /* WAVE 123 · FINDING 3, third site — found while enumerating every money
       figure on this screen, and it is the same defect one step removed: an
       unknown regional capital was turned into a density of `$0`, which reads on
       the heatmap as a region with companies and no money rather than a region
       that is not measured. An unknown density is now `null` and renders as the
       em-dash `fmtUsdShort` already produces; regions whose density cannot be
       computed sort last rather than sorting as if they were the weakest. */
    return [...data.regions]
      .map(r => ({ ...r, density: r.companies > 0 && r.raised != null ? r.raised / r.companies : null }))
      .sort((a, b) => (b.density ?? -1) - (a.density ?? -1));
  }, [data]);

  // Sprint 28 — pull queue keys dynamically so Capavate and Collective both render their own queues.
  const queueEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.queues);
  }, [data]);

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        description={surface === "capavate"
          ? "Platform-wide health, fundraising flow, top performers, region heatmap, real-time activity."
          : "Collective community: applications, KYC queue, member tiers, syndicate commitments, partner activity."}
        actions={<Badge variant="outline" className="text-[10px] gap-1"><Clock className="h-3 w-3" />Auto-refresh 15s</Badge>}
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: surface === "capavate" ? "Platform operations" : "Community operations",
            title: copy.introTitle,
            description: copy.introDesc,
            warning: copy.introWarning,
            positive: copy.introPositive,
          }}
        />

        {/* v25.42h round-2 — DB-unavailable banner. When the KPI endpoint returns
            503 (ok:false), surface an explicit "temporarily unavailable" message
            instead of rendering fabricated zeros or letting the page crash. */}
        {isError && (
          <Card className="p-4 mb-5 bg-amber-50 border-amber-300" data-testid="banner-kpis-unavailable">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Health data temporarily unavailable</span>
            </div>
            <p className="text-xs text-amber-800 mt-1">
              The platform metrics service could not reach the database. Figures are
              not shown rather than displaying stale or fabricated numbers. This view
              auto-retries every 15 seconds.
            </p>
          </Card>
        )}

        {/* Surface toggle — prominent, distinct from header nav. */}
        <div
          className="mb-6 inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm"
          role="tablist"
          aria-label="Dashboard surface"
          data-testid="dashboard-surface-toggle"
        >
          <Button
            size="sm"
            variant={surface === "capavate" ? "default" : "ghost"}
            onClick={() => setSurface("capavate")}
            className={surface === "capavate"
              ? "bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] border-[hsl(219_45%_20%)] hover:border-[hsl(219_45%_15%)] text-white"
              : "text-foreground"}
            data-testid="button-surface-capavate"
            aria-selected={surface === "capavate"}
            role="tab"
          >
            <Building2 className="h-3.5 w-3.5 mr-1.5" />
            Capavate
          </Button>
          <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground mx-0.5" aria-hidden />
          <Button
            size="sm"
            variant={surface === "collective" ? "default" : "ghost"}
            onClick={() => setSurface("collective")}
            className={surface === "collective"
              ? "bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
              : "text-foreground"}
            data-testid="button-surface-collective"
            aria-selected={surface === "collective"}
            role="tab"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Collective
          </Button>
          <span className="text-[11px] text-muted-foreground ml-2 mr-2 hidden sm:inline-flex items-center gap-1">
            {isLoading ? <Activity className="h-3 w-3 animate-pulse" /> : <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
            {isLoading ? "Loading…" : `Showing ${surface === "capavate" ? "Capavate operations" : "Collective community"}`}
          </span>
        </div>

        {/* Top KPIs — surface-aware */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Card className="p-4" data-testid="stat-kpi-1">
            <div className="flex items-center justify-between mb-1">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-[10px]">{data?.summary.momGrowthPct != null ? `+${data.summary.momGrowthPct.toFixed(1)}% MoM` : "MoM —"}</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi1Label}
              <HelpTip>{copy.kpi1Help}</HelpTip>
            </div>
            <div className="text-2xl font-semibold mt-1">{data?.summary.totalCompanies ?? 0}</div>
          </Card>
          <Card className="p-4" data-testid="stat-kpi-2">
            <div className="flex items-center justify-between mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-[10px]">{data?.summary.nrr != null ? `NRR ${data.summary.nrr.toFixed(2)}x` : "NRR —"}</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi2Label}
              <HelpTip>{copy.kpi2Help}</HelpTip>
            </div>
            <div className="text-2xl font-semibold mt-1">{data?.summary.totalInvestors ?? 0}</div>
          </Card>
          <Card className="p-4" data-testid="stat-kpi-3">
            <div className="flex items-center justify-between mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-[10px] text-emerald-700">{copy.kpi3Badge}</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi3Label}
              <HelpTip>{copy.kpi3Help}</HelpTip>
            </div>
            {/* WAVE 123 · FINDING 3 — `?? 0` turned a deliberate `null` into a
                confident `$0`. `fmtUsd` already renders `null` as an em-dash;
                the coalesce was the whole defect. A `$0` that means "unknown" is
                a false statement about money (R6), and the Collective surface
                returns a LITERAL `null` for this field, so the tile was reading
                "no soft-circles" where the truth was "not measured here". */}
            <div className="text-2xl font-semibold mt-1">{fmtUsd(data?.summary.totalCommittedSoftCircle ?? null)}</div>
          </Card>
          <Card className="p-4" data-testid="stat-kpi-4">
            <div className="flex items-center justify-between mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-[10px]">{data?.summary.churnPct != null ? `Churn ${data.summary.churnPct.toFixed(1)}%` : "Churn —"}</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi4Label}
              <HelpTip>{copy.kpi4Help}</HelpTip>
            </div>
            {/* WAVE 123 · FINDING 3 — the same defect on funded capital. Wave 116
                made `dbTotalFunded()` return `null` when the platform total is
                not determinable from the money on record; this line converted
                that refusal straight back into `$0`. */}
            <div className="text-2xl font-semibold mt-1">{fmtUsd(data?.summary.totalFunded ?? null)}</div>
          </Card>
        </div>

        {/* v26.4.0-fix2 (Wave B UI wire — unanimous reviewer BLOCK) — SPV KPI
            tiles. Owner Q3-C: WIRE not drop. Multi-currency by construction:
            renders one column per currency present in the map, plus a scalar
            "Active SPVs" count. On Postgres the map is empty and the tiles
            show "—" (deferred to Wave B.5 schema wiring). */}
        {(() => {
          const committed = data?.summary.totalSpvCommittedMinor ?? {};
          /* WAVE 161 · ITEM A (A3) — the pipeline figure, rendered as its OWN
             labelled line rather than added into the committed one. */
          const allStages = data?.summary.totalSpvSubscribedAllStagesMinor ?? {};
          const allStagesCurrencies = Object.keys(allStages).sort();
          const wired = data?.summary.totalSpvWiredMinor ?? {};
          const activeSpvs = data?.summary.totalActiveSpvs ?? null;
          const committedCurrencies = Object.keys(committed).sort();
          const wiredCurrencies = Object.keys(wired).sort();
          /* WAVE 34 · TASK 2 — was:
           *   (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " " + ccy
           * The currency was not merely in scope, it was the parameter `ccy`,
           * and the divisor was still a hardcoded exponent-2 assumption. These
           * tiles are multi-currency BY CONSTRUCTION (one row per currency in
           * the map), so the defect was maximally exposed here: a ¥250,000,000
           * commitment rendered as "2,500,000 JPY" — wrong by 100. `fromMinor`
           * reads the exponent from the ISO-4217 table (JPY/KRW = 0). The
           * rendered SHAPE is unchanged (grouped number + " " + code), so no
           * other tile or copy assertion moves — these tiles have always been
           * whole-unit (maximumFractionDigits: 0), which is retained. */
          const fmtCurrencyMinor = (m: number, ccy: string) =>
            fromMinor(m, ccy).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " " + ccy;
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <Card className="p-4" data-testid="stat-spv-active">
                <div className="flex items-center justify-between mb-1">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-[10px] text-emerald-700">SPV</Badge>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Active SPVs
                  <HelpTip>Distinct active SPVs (excludes drafts and wound-down). Reads directly from the engine's spv table.</HelpTip>
                </div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-spv-active-value">
                  {activeSpvs != null ? activeSpvs : "—"}
                </div>
              </Card>
              <Card className="p-4" data-testid="stat-spv-committed">
                <div className="flex items-center justify-between mb-1">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-[10px] text-emerald-700">Committed</Badge>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  SPV Committed
                  {/* WAVE 161 · BATCH 3 ITEM A (A3) — the ORIGINAL sentence is kept
                      verbatim as the first line, and the new sentence stating this
                      tile's corrected basis was ADDED after it. WAVE 163 BLOCKER 3
                      reverses that order: leaving an all-stages sentence as the first
                      thing a reader meets on a committed-only tile made the tile
                      explain itself wrongly. The wave 161 sentence is not deleted -
                      it moved verbatim to the pipeline heading below. */}
                  {/* WAVE 163 - BLOCKER 3: the FIRST tip now states this tile's own
                      committed-only basis. */}
                  <HelpTip testid="admin-spv-committed-tooltip">Committed capital ONLY — subscriptions that reached committed, summed PER CURRENCY. Never a scalar sum across mixed currencies. Soft-circled, GP-confirmed and under-review subscriptions are NOT in this figure, and neither are funds received without a committed subscription; all of them are in the pipeline line at the foot of this tile.</HelpTip>
                  {/* WAVE 161 · BATCH 3 ITEM A (A3) — the sentence above is BASELINED
                      COPY and is kept byte-for-byte: it is a true description of the
                      pipeline line further down this tile, which is where the
                      non-withdrawn sum now lives. The corrected basis of THIS figure
                      is stated in a SECOND tip beside it rather than by rewriting the
                      first, so no copy is dropped (silent-drop rule #8). */}
                  <HelpTip>Wave 161 correction: the figure below counts ONLY subscriptions that reached committed. Soft-circled, GP-confirmed and under-review subscriptions are indications of interest rather than capital, and funds received without a committed subscription are not capital either — every one of them is counted in the pipeline line at the foot of this tile instead.</HelpTip>
                </div>
                <div className="mt-1 space-y-0.5" data-testid="stat-spv-committed-values">
                  {committedCurrencies.length === 0 ? (
                    <div className="text-2xl font-semibold">{MONEY_NOT_ON_RECORD}</div>
                  ) : (
                    committedCurrencies.map((ccy) => (
                      <div key={ccy} className="text-lg font-semibold">
                        {fmtCurrencyMinor(committed[ccy], ccy)}
                      </div>
                    ))
                  )}
                </div>
                {/* WAVE 161 · BATCH 3 ITEM A (A3) — THE PIPELINE, SAID SEPARATELY.
                    This figure is what the tile above used to print: every
                    non-withdrawn subscription at any stage. It is kept, because an
                    operator watching the platform genuinely wants it — but it is
                    kept UNDER ITS OWN WORDS, beneath a heading that does not claim
                    the money is committed. */}
                <div className="mt-2 pt-2 border-t text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Incl. pipeline (all stages)
                  {/* WAVE 163 - BLOCKER 3: the baselined wave 161 sentence, RELOCATED
                      here verbatim from the committed heading. This is the figure it
                      genuinely describes, so no copy is dropped and no reader is told
                      that a committed-only number is a non-withdrawn one. */}
                  <HelpTip testid="admin-spv-pipeline-legacy-tooltip">Sum of active (non-withdrawn) SPV commitments, PER CURRENCY. Never a scalar sum across mixed currencies.</HelpTip>
                  <HelpTip>Every non-withdrawn SPV subscription at ANY stage — under review, soft-circled, GP-confirmed, funds received and committed — summed per currency. This is a pipeline indicator, NOT raised capital: most of it is not binding.</HelpTip>
                </div>
                <div className="mt-0.5 space-y-0.5" data-testid="stat-spv-all-stages-values">
                  {allStagesCurrencies.length === 0 ? (
                    <div className="text-sm font-medium text-muted-foreground">{MONEY_NOT_ON_RECORD}</div>
                  ) : (
                    allStagesCurrencies.map((ccy) => (
                      <div key={ccy} className="text-sm font-medium text-muted-foreground">
                        {fmtCurrencyMinor(allStages[ccy], ccy)}
                      </div>
                    ))
                  )}
                </div>
              </Card>
              <Card className="p-4" data-testid="stat-spv-wired">
                <div className="flex items-center justify-between mb-1">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-[10px] text-emerald-700">Wired</Badge>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  SPV Wired
                  {/* WAVE 117 · FINDING 4 — was "(wired_minor field)": a storage
                      column named to a human. The two facts that decide how this
                      figure is read — PER CURRENCY, and real deposits rather than
                      soft-circles — are kept verbatim. The word "soft-circles" is
                      left exactly as it stands: owner ruling R91 forbids
                      harmonising that vocabulary. */}
                  <HelpTip>Sum of the amounts actually wired against SPV subscriptions, PER CURRENCY. Reflects real deposits, not soft-circles.</HelpTip>
                </div>
                <div className="mt-1 space-y-0.5" data-testid="stat-spv-wired-values">
                  {wiredCurrencies.length === 0 ? (
                    <div className="text-2xl font-semibold">—</div>
                  ) : (
                    wiredCurrencies.map((ccy) => (
                      <div key={ccy} className="text-lg font-semibold">
                        {fmtCurrencyMinor(wired[ccy], ccy)}
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          );
        })()}

        {/* Sprint 28 — Conversion analytics row (new). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <Card className="p-4 bg-[hsl(0_100%_97%)] border-[hsl(0_100%_40%)]/30" data-testid="card-conv-onboarding">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {surface === "capavate" ? "Founder end-to-end" : "Application end-to-end"}
              <HelpTip>Percentage of those who entered the top of the onboarding funnel that completed the bottom step. Investor-grade benchmark: 40–55% for founder onboarding, 50–65% for member onboarding.</HelpTip>
            </div>
            <div className="text-xl font-semibold mt-1">{conversions?.onboardingEndToEnd ?? "—"}</div>
          </Card>
          <Card className="p-4 bg-[hsl(0_100%_97%)] border-[hsl(0_100%_40%)]/30" data-testid="card-conv-investor">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {surface === "capavate" ? "Invited → Funded" : "Shared → Joined"}
              <HelpTip>{surface === "capavate"
                ? "Investors who eventually funded out of those originally invited. The single most important platform health metric. Healthy is 30–40%; below 20% indicates pipeline quality issues."
                : "Members who joined a syndicate out of those originally shown the deal. Healthy is 20–30%; below 12% indicates a deal-flow quality issue."}</HelpTip>
            </div>
            <div className="text-xl font-semibold mt-1">{conversions?.investorEndToEnd ?? "—"}</div>
          </Card>
          <Card className="p-4 bg-[hsl(0_100%_97%)] border-[hsl(0_100%_40%)]/30" data-testid="card-conv-softcircle">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              {surface === "capavate" ? "Soft-circle → Funded ($)" : "Committed → Deployed ($)"}
              <HelpTip>{surface === "capavate"
                ? "Funded dollars ÷ outstanding soft-circle dollars. Soft circles routinely vapourise — anything above 60% conversion is exceptional. Track week-over-week to spot deteriorating deals."
                : "Deployed syndicate dollars ÷ committed syndicate dollars. Healthy syndication is 70–85%; below 50% indicates ops friction (wire failures, allocation pull-backs)."}</HelpTip>
            </div>
            <div className="text-xl font-semibold mt-1">{conversions?.softCircleToFunded ?? "—"}</div>
          </Card>
        </div>

        {/* Health row */}
        <Card className="p-4 mb-5" data-testid="card-health-row">
          <div className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Platform health
            <HelpTip>{surface === "capavate"
              ? "Live SLO trackers for the critical paths: cap-table reconciliation accuracy, close-gate enforcement, dataroom upload reliability, message delivery, and email SLA. Any number in alert tone should be investigated within the SLO window."
              : "Live SLO trackers for the Collective surface: reconciliation against shared cap tables, deal-room close-gate, dataroom uploads from members and partners, member message delivery, and email SLA on member comms."}</HelpTip>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <HealthTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Reconcile success" value={data?.health.capTableReconcile.successRatePct != null ? `${data.health.capTableReconcile.successRatePct.toFixed(2)}%` : "—"} hint={`${data?.health.capTableReconcile.runs ?? 0} runs`} tone={data?.health.capTableReconcile.successRatePct == null ? "unknown" : data.health.capTableReconcile.successRatePct < 99 ? "warn" : "ok"} testId="card-health-reconcile" />
            <HealthTile icon={<AlertCircle className="h-3.5 w-3.5" />} label="Close-gate fails" value={data?.health.closeGateFailures != null ? String(data.health.closeGateFailures) : "—"} tone={data?.health.closeGateFailures == null ? "unknown" : data.health.closeGateFailures > 5 ? "warn" : "ok"} testId="card-health-closegate" />
            <HealthTile icon={<FileText className="h-3.5 w-3.5" />} label="Dataroom errors" value={data?.health.dataroomUploadErrors != null ? String(data.health.dataroomUploadErrors) : "—"} tone={data?.health.dataroomUploadErrors == null ? "unknown" : data.health.dataroomUploadErrors > 3 ? "warn" : "ok"} testId="card-health-dataroom" />
            <HealthTile icon={<Send className="h-3.5 w-3.5" />} label="Message delivery" value={data?.health.messageDelivery.deliveryRatePct != null ? `${data.health.messageDelivery.deliveryRatePct.toFixed(2)}%` : "—"} tone={data?.health.messageDelivery.deliveryRatePct == null ? "unknown" : data.health.messageDelivery.deliveryRatePct < 99.5 ? "warn" : "ok"} testId="card-health-msgs" />
            <HealthTile icon={<Mail className="h-3.5 w-3.5" />} label="Email SLA" value={data?.health.emailSlaSec != null ? `${data.health.emailSlaSec}s` : "—"} hint="P95 send time" tone={data?.health.emailSlaSec == null ? "unknown" : data.health.emailSlaSec > 60 ? "warn" : "ok"} testId="card-health-email" />
          </div>
          {/* WAVE 240 — APPENDED AS THE LAST CHILD OF THIS CARD, after the tile grid, so no
              existing tile changes sibling index. Nothing above is removed.
              Provenance, stated unconditionally rather than only when the number is
              missing: the sole writer of the `recon_runs` table this figure counts is
              POST /api/admin/reconciliation/run (server/adminPlatformStore.ts:3503),
              which invokes neither engine and inserts a hardcoded `ok: true`
              (`:3509`). Wave 240 stopped that write, but stopping a fabricating writer
              does not make rows it already wrote honest — so any non-zero rate here must
              be read as a count of those rows, not as evidence a reconciliation ran. */}
          <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3" data-testid="health-row-provenance">
            <div className="text-[11px] font-semibold text-slate-900">How to read these five figures</div>
            <ul className="mt-1.5 space-y-1 text-[11px] text-slate-700 list-disc pl-4">
              <li>A tile marked &ldquo;Not reported&rdquo; has received no figure at all. It is not a pass, and it is not a measurement of zero.</li>
              <li>Close-gate failures, dataroom errors, message delivery and email SLA have no source in this build, so they report nothing rather than report a number nobody measured.</li>
              <li>Reconcile success counts rows in the reconciliation table. The only endpoint that ever wrote to that table did not run either cap-table engine and recorded a fixed &ldquo;matched&rdquo; result, so a percentage here is not evidence that a cap table was reconciled.</li>
            </ul>
          </div>
        </Card>

        {/* Queues — fully dynamic per surface */}
        <Card className="p-4 mb-5" data-testid="card-queues">
          <div className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
            Operations queues
            <HelpTip>Backlogged work waiting on the platform (Capavate) or partnerships ops (Collective). High counts indicate either a process bottleneck or a downstream consumer outage. Dead-letter is always critical.</HelpTip>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {queueEntries.map(([key, value]) => {
              const isDead = key.toLowerCase().includes("dead");
              return (
                <Card key={key} className="p-3" data-testid={`card-queue-${key}`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{prettyQueueLabel(key)}</div>
                  <div className={`text-base font-semibold ${isDead && (value ?? 0) > 0 ? "text-rose-700" : ""}`}>{value ?? "—"}</div>
                </Card>
              );
            })}
          </div>
        </Card>

        {/* Funnels + region heatmap */}
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          <Card className="p-4" data-testid="card-funnel-onboarding">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1">
              {copy.funnelOnboardingTitle}
              <HelpTip>{copy.funnelOnboardingHelp}</HelpTip>
            </div>
            <Funnel
              steps={data?.funnels.onboarding ?? []}
              colorClass="bg-primary"
              testIdPrefix="funnel-onboarding"
            />
          </Card>
          <Card className="p-4" data-testid="card-funnel-investor">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1">
              {copy.funnelInvestorTitle}
              <HelpTip>{copy.funnelInvestorHelp}</HelpTip>
            </div>
            <Funnel
              steps={data?.funnels.investor ?? []}
              colorClass="bg-[hsl(0_100%_40%)]"
              testIdPrefix="funnel-investor"
            />
          </Card>
          <Card className="p-4" data-testid="card-region-heatmap">
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Region heatmap ({data?.regions.length ?? 0})
              <HelpTip>Geographic distribution of {surface === "capavate" ? "tenant companies" : "Collective members"} and their {surface === "capavate" ? "capital raised" : "syndicate commitments"}. Use to spot expansion opportunities and partnership gaps.</HelpTip>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {(data?.regions ?? []).map(r => (
                <div key={r.code} data-testid={`region-${r.code}`} className="px-2 py-1.5 bg-muted/40 rounded text-center">
                  <div className="font-medium">{r.code}</div>
                  <div className="text-[10px] text-muted-foreground">{r.companies} {surface === "capavate" ? "co" : "mb"} · {fmtUsdShort(r.raised)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Region density (new, micro) */}
        <Card className="p-4 mb-5" data-testid="card-region-density">
          <div className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5 text-muted-foreground" />
            Region density (capital per {surface === "capavate" ? "company" : "member"})
            <HelpTip>Average dollars raised per {surface === "capavate" ? "tenant company" : "Collective member"} in each region. Sorted descending. A region with high density but low count is an expansion target; a region with high count but low density is a maturity opportunity.</HelpTip>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
            {regionDensity.slice(0, 9).map((r, i) => (
              <div key={r.code} className="rounded border px-3 py-2" data-testid={`density-${r.code}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                  <span className="font-medium">{r.code}</span>
                </div>
                <div className="font-semibold text-sm mt-1">{fmtUsdShort(r.density)}</div>
                <div className="text-[10px] text-muted-foreground">avg / {surface === "capavate" ? "co" : "mb"} · {r.companies} total</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Top + activity */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="overflow-hidden" data-testid="card-top-companies">
            <div className="px-4 py-3 border-b border-border bg-card/50 text-sm font-semibold flex items-center gap-1.5">
              {copy.topListTitle}
              <HelpTip>{copy.topListHelp}</HelpTip>
            </div>
            <ul className="divide-y divide-border">
              {(data?.topCompanies ?? []).map(c => (
                <li key={c.id} className="px-4 py-2 flex items-center text-xs" data-testid={`row-top-co-${c.id}`}>
                  {surface === "capavate" ? (
                    <Link href={`/admin/companies/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  ) : (
                    <span className="font-medium">{c.name}</span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {surface === "capavate" ? `Traction ${c.traction}` : `${c.traction} ${c.id === "tier_partner" || c.id === "tier_observer" ? "members" : "members"}`} · {fmtUsdShort(c.raised)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="overflow-hidden" data-testid="card-activity-feed">
            <div className="px-4 py-3 border-b border-border bg-card/50 text-sm font-semibold flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Real-time activity
              <HelpTip>Most recent events from the {surface === "capavate" ? "Capavate platform" : "Collective community"}. Auto-refreshes every 10 seconds. Click an entity hash to drill into its detail page.</HelpTip>
            </div>
            <ul className="divide-y divide-border max-h-[40vh] overflow-y-auto">
              {(activity.data?.items ?? []).map(a => (
                <li key={a.id} className="px-4 py-2 text-xs" data-testid={`row-activity-${a.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{a.kind}</Badge>
                    <span className="text-muted-foreground">{new Date(a.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-0.5">{a.text}</div>
                </li>
              ))}
              {(activity.data?.items ?? []).length === 0 && (
                <li className="px-4 py-6 text-xs text-center text-muted-foreground">No recent activity on this surface.</li>
              )}
            </ul>
          </Card>
        </div>

        {/* Top investors / members */}
        <Card className="overflow-hidden mt-4" data-testid="card-top-investors">
          <div className="px-4 py-3 border-b border-border bg-card/50 text-sm font-semibold flex items-center gap-1.5">
            {surface === "capavate" ? "Top investors by activity" : "Top members by activity"}
            <HelpTip>{surface === "capavate"
              ? "Investor accounts ranked by composite activity (logins × soft-circles × messages × dataroom views) and cumulative committed capital. Use to identify your power users for retention outreach."
              : "Members ranked by composite community activity (deal views × syndicate joins × network posts) and cumulative commitments. Use to identify advocates for case studies and tier upgrades."}</HelpTip>
          </div>
          <ul className="divide-y divide-border">
            {(data?.topInvestors ?? []).map(i => (
              <li key={i.id} className="px-4 py-2 flex items-center text-xs" data-testid={`row-top-investor-${i.id}`}>
                <span className="font-medium">{i.name}</span>
                <span className="ml-auto text-muted-foreground">Activity {i.activity} · committed {fmtUsdShort(i.committed)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <BuildVersionMarker />
        <AdminTestDataExclusionPanel />
      </PageBody>
    </>
  );
}

/* ---------- helpers ---------- */
function prettyQueueLabel(key: string): string {
  // Convert "eligibilityRecompute" → "Eligibility recompute".
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

/* WAVE 240 — `tone` gains a THIRD member, "unknown". Both existing members are kept
   and neither changes behaviour. The reason it is needed: every call site below used
   to read `X != null && <threshold> ? "warn" : "ok"`, so when `X` was null the `&&`
   short-circuited and the ABSENT case took the same branch as the HEALTHY case. The
   value was already honest ("—"); the tone was not, and on the Reconcile tile a
   hardcoded `text-emerald-600` shield sat above that dash. Four of the five figures
   are hardcoded `null` on the server (server/adminPlatformStore.ts:165-168), so the
   absent branch is not an edge case on this card — it is the only branch it takes.
   "unknown" therefore renders a neutral dashed card, greys the icon it was handed so a
   green shield cannot survive into a no-data tile, and appends an explicit line saying
   the check has not reported. The line is the LAST child, so no existing sibling
   changes index. */
function HealthTile({ icon, label, value, hint, tone, testId }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: "ok" | "warn" | "unknown";
  testId: string;
}) {
  return (
    <Card className={`p-3 ${tone === "warn" ? "bg-amber-50 border-amber-200" : tone === "unknown" ? "bg-slate-50 border-slate-200 border-dashed" : ""}`} data-testid={testId}>
      <div className="flex items-center gap-1.5"><span className={tone === "unknown" ? "grayscale opacity-50" : ""} data-testid={`${testId}-icon`}>{icon}</span><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span></div>
      <div className={`text-base font-semibold mt-0.5 ${tone === "warn" ? "text-amber-900" : ""} ${tone === "unknown" ? "text-slate-500" : ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      {tone === "unknown" && <div className="text-[10px] text-slate-600 mt-0.5" data-testid={`${testId}-nodata`}>Not reported — no figure was received for this check, so nothing here is a pass.</div>}
    </Card>
  );
}

function Funnel({ steps, colorClass, testIdPrefix }: {
  steps: { step: string; count: number }[];
  colorClass: string;
  testIdPrefix: string;
}) {
  return (
    <ul className="space-y-1.5 text-xs">
      {steps.map((s, i, arr) => {
        const pct = (s.count / (arr[0]?.count || 1)) * 100;
        return (
          <li key={s.step} className="flex items-center gap-2" data-testid={`${testIdPrefix}-${s.step}`}>
            <span className="font-mono text-[10px] w-36 truncate">{s.step}</span>
            <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
              <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="font-medium w-10 text-right">{s.count}</span>
            {i > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground w-12 text-right">
                {((s.count / (arr[i - 1].count || 1)) * 100).toFixed(0)}%
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
