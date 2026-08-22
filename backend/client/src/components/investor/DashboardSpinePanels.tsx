/**
 * Wave 5 (ENH-2) — Full investor Dashboard panels, built ENTIRELY on SPINE-0.
 *
 * The five panels below (in Ozan-locked top-to-bottom order) are pure
 * consumers of `useInvestorSpine()` (client/src/lib/investor/investorSpine.ts):
 *
 *   1. Portfolio standing / holdings  — spine.holdings / spine.hasFundedPosition
 *   2. Recent activity                — spine.recentActivity (decision ladder)
 *   3. Invitations & soft-circle       — spine.pendingInvitations + softCircled
 *   4. Message-channels summary        — spine.channelUnlockState
 *   5. M&A intelligence (LAST)         — REAL intel from the existing
 *      GET /api/investor/ma/intelligence/:companyId (privacy-gated), for the
 *      spine.maCompanyIds set. Fail-closed empty-state on 403/404/empty.
 *
 * NO local re-derivation of any invitation/holding/channel state — every value
 * comes from the single source of truth so this dashboard can never reintroduce
 * the #3/#7/#8 drift. All existing Dashboard widgets/routes/data-testids are
 * preserved by the parent; this component is ADDITIVE.
 *
 * Rule #13: company/contact names render verbatim (full name), never truncated
 * to a first token.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Briefcase, Activity, Inbox, MessageSquare, TrendingUp, Building2,
  ArrowRight, Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtUSD, fmtDate } from "@/lib/format";
import {
  useInvestorSpine,
  LADDER_EVENT_LABEL,
  type SpineActivityEvent,
} from "@/lib/investor/investorSpine";
import {
  useLpVehicleInterests,
  lpOnlyBodyDashboard,
  LP_ONLY_HEADLINE,
  LP_INTERESTS_UNAVAILABLE_COPY,
} from "@/lib/investor/lpVehicleInterests";
import { displayName } from "@shared/investorDisplayLabels"; /* WAVE 90 · ITEM 3 (M-3) */

/* -------------------------------------------------------------------- */
/* Typed views over the spine's raw shapes (render-only, no derivation). */
/* -------------------------------------------------------------------- */

type HoldingView = {
  companyId: string;
  company?: string;
  sector?: string;
  invested?: number;
  currentValue?: number;
};

/**
 * The REAL M&A intelligence response returned by the existing per-company
 * endpoint (server/maIntelligenceStore.ts). Shape is privacy-tiered: AGGREGATE
 * omits buyer names/narrative AND comparableExits/revenueMultipleRange;
 * FULL/DETAIL include buyers (and narrative when authorized) PLUS
 * comparableExits + revenueMultipleRange for all authorized investors. Derived
 * profiles carry no comps, so those two fields arrive as an empty list / zero
 * range — we render an empty-state and never fabricate rows or numbers.
 */
export interface MaIntelResponse {
  companyId: string;
  accessLevel?: "FULL" | "DETAIL" | "AGGREGATE";
  maScore: number;
  acquirerFitScore: number;
  intentSignal: "none" | "inbound" | "outbound" | "active_negotiation";
  productMarketFit: number;
  technologyDifferentiation: number;
  customerConcentration: number;
  growthRate: number;
  marketShare: number;
  managementTeamStrength: number;
  strategicPriorities?: string[];
  transactionInterests?: string[];
  topStrategicBuyers?: Array<{ name: string; rationale?: string; recentActivity?: string }>;
  strategicBuyerCount?: number;
  maReadinessNarrative?: string;
  comparableExits?: Array<{
    target: string;
    acquirer: string;
    date: string;
    valuationUsd: number;
    revenueMultiple: number | null;
  }>;
  revenueMultipleRange?: { low: number; high: number };
}

/* ==================================================================== */
/* PANEL 1 — Portfolio standing / holdings (funded positions ONLY)      */
/* ==================================================================== */

export function PortfolioStandingPanel() {
  const spine = useInvestorSpine();
  const holdings = spine.holdings as HoldingView[];
  const hasFunded = spine.hasFundedPosition;

  // WAVE 35 · ROW 7 — SECOND INSTANCE of "Your portfolio is empty".
  // `spine.hasFundedPosition` is cap-table-only, and unlike the Portfolio page
  // this panel has no <LpPositions /> beneath it, so the sentence stood
  // completely unqualified for an LP who had wired real capital. Same hook,
  // same endpoint, same query key as the Portfolio surface — one answer, so the
  // two screens cannot contradict each other.
  const lp = useLpVehicleInterests();

  const totals = useMemo(() => {
    let invested = 0;
    let currentValue = 0;
    for (const h of holdings) {
      invested += Number(h.invested ?? 0);
      currentValue += Number(h.currentValue ?? 0);
    }
    return { invested, currentValue };
  }, [holdings]);

  return (
    <Card className="mb-6" data-testid="spine-panel-portfolio">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" /> Portfolio standing
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Funded cap-table holdings — the single source of truth (SPINE-0).
          </p>
        </div>
        <Button size="sm" variant="outline" data-testid="spine-portfolio-view-all" asChild>
          <Link href="/investor/portfolio">
            View portfolio <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {!hasFunded && !lp.isResolved ? (
          /* Do not assert "empty" while the LP question is still open. */
          <div className="py-8" data-testid="spine-portfolio-pending-lp">
            <div className="h-5 w-56 bg-muted rounded animate-pulse mx-auto" />
          </div>
        ) : !hasFunded && (lp.count ?? 0) > 0 ? (
          /* WAVE 35 · ROW 7 — no cap-table holding, but a real vehicle interest.
             Honest on both halves, and it points at the surface that lists it. */
          <div
            className="flex flex-col items-center text-center gap-3 py-8"
            data-testid="spine-portfolio-lp-only"
          >
            <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center">
              <Layers className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" data-testid="spine-portfolio-lp-only-headline">
                {LP_ONLY_HEADLINE}
              </h3>
              <p
                className="text-sm text-muted-foreground mt-1 max-w-md"
                data-testid="spine-portfolio-lp-only-body"
              >
                {lpOnlyBodyDashboard(lp.count ?? 0)}
              </p>
            </div>
            <Button size="sm" variant="outline" data-testid="spine-portfolio-lp-only-view" asChild>
              <Link href="/investor/portfolio">
                View vehicle interests <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        ) : !hasFunded ? (
          /* Educational empty-state — reuses the Wave-2 #8 ladder copy so the
             message is byte-consistent with PortfolioCompanySwitcher. */
          <div
            className="flex flex-col items-center text-center gap-3 py-8"
            data-testid="spine-portfolio-empty"
          >
            <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Your portfolio is empty</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                You don't hold any positions yet. Once you soft-circle a round and the founder
                marks your investment funded, it will appear here with its updates, marks, and
                analytics.
              </p>
            </div>
            {/* Appended as the LAST sibling, never spliced into an existing text
                node: an unanswerable LP question is not evidence of emptiness. */}
            {lp.isUnavailable && (
              <p
                className="text-sm max-w-md"
                style={{ color: "#8a5a06" }}
                data-testid="spine-portfolio-lp-unavailable"
              >
                {LP_INTERESTS_UNAVAILABLE_COPY}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <SummaryStat
                label="Holdings"
                value={String(holdings.length)}
                testid="spine-portfolio-count"
              />
              <SummaryStat
                label="Total invested"
                value={fmtUSD(totals.invested, { compact: true })}
                testid="spine-portfolio-invested"
              />
              <SummaryStat
                label="Current value"
                value={fmtUSD(totals.currentValue, { compact: true })}
                testid="spine-portfolio-value"
              />
            </div>
            <ul className="divide-y divide-border" data-testid="spine-portfolio-list">
              {holdings.map((h) => (
                <li
                  key={h.companyId}
                  className="flex items-center justify-between py-2.5"
                  data-testid={`spine-holding-${h.companyId}`}
                >
                  <div className="min-w-0">
                    {/* rule #13 — full company name rendered verbatim */}
                    {/* WAVE 90 · ITEM 3 (M-3) — the `?? h.companyId` fallback printed
                        a raw `co_…` id AS the company name. `displayName` keeps the
                        verbatim name when there is one and DESCRIBES the row when
                        there is not, per Wave 83's precedent. R77: the id stays
                        available as the key and the `data-testid`. */}
                    <div className="text-sm font-medium truncate">{displayName(h.company, "company", h.companyId)}</div>
                    {h.sector && (
                      <div className="text-[11px] text-muted-foreground truncate">{h.sector}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0 pl-3">
                    <div className="text-sm font-mono tabular-nums">
                      {fmtUSD(Number(h.currentValue ?? 0), { compact: true })}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtUSD(Number(h.invested ?? 0), { compact: true })} invested
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {/* WAVE 35 · ROW 7 — the DUAL-POSITION case. This panel is
                cap-table-only by design (SPINE-0), so an investor who holds
                BOTH direct positions and vehicle interests saw only half of
                what they own with nothing saying so. APPENDED as the last
                sibling after the holdings list — never inserted mid-list and
                never spliced into an existing text node — and it does not
                fold vehicle interests into the cap-table totals above, which
                would misstate both. */}
            {(lp.count ?? 0) > 0 && (
              <div
                className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2"
                data-testid="spine-portfolio-also-lp"
              >
                <p className="text-[11px] text-muted-foreground max-w-md">
                  {lpOnlyBodyDashboard(lp.count ?? 0)}
                </p>
                <Button size="sm" variant="outline" data-testid="spine-portfolio-also-lp-view" asChild>
                  <Link href="/investor/portfolio">
                    View vehicle interests <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ==================================================================== */
/* PANEL 2 — Recent activity (decision-ladder events via spine)         */
/* ==================================================================== */

const STAGE_TONE: Record<SpineActivityEvent["stage"], string> = {
  invited: "bg-muted text-muted-foreground border-border",
  viewed: "bg-muted text-muted-foreground border-border",
  /* WAVE 101 - `accepted` is a positive rung of the decision ladder that ends
     at `funded` in emerald; it was painted the brand-red negative anchor.
     Colour only. */
  accepted: "bg-emerald-700/10 text-emerald-700 border-emerald-700/40",
  soft_circled: "bg-amber-500/10 text-amber-700 border-amber-500/40",
  confirmed: "bg-[hsl(333_75%_35%)]/10 text-[hsl(333_75%_35%)] border-[hsl(333_75%_35%)]/40",
  signed: "bg-[hsl(333_75%_35%)]/10 text-[hsl(333_75%_35%)] border-[hsl(333_75%_35%)]/40",
  funded: "bg-emerald-600/10 text-emerald-700 border-emerald-600/40",
};

export function RecentActivityPanel() {
  const spine = useInvestorSpine();
  const events = spine.recentActivity;

  return (
    <Card className="mb-6" data-testid="spine-panel-activity">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Recent activity
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your decision-ladder progress across every invited round (SPINE-0).
        </p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center" data-testid="spine-activity-empty">
            No decision activity yet. Accept an invitation to start your ladder.
          </div>
        ) : (
          <ul className="divide-y divide-border" data-testid="spine-activity-list">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-2.5"
                data-testid={`spine-activity-${e.id}`}
              >
                <div className="min-w-0">
                  {/* rule #13 — full company name rendered verbatim */}
                  <div className="text-sm font-medium truncate">{e.companyName}</div>
                  {e.roundName && (
                    <div className="text-[11px] text-muted-foreground truncate">{e.roundName}</div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${STAGE_TONE[e.stage]}`}
                  data-testid={`spine-activity-stage-${e.id}`}
                >
                  {LADDER_EVENT_LABEL[e.stage]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ==================================================================== */
/* PANEL 3 — Invitations & soft-circle status summary                   */
/* ==================================================================== */

export function InvitationsSummaryPanel() {
  const spine = useInvestorSpine();
  // Count parity: identical to the Dashboard badge AND the Invitations page
  // "Active" tab (all read spine.pendingInvitations).
  const pendingCount = spine.pendingInvitations.length;
  const softCircledCount = spine.softCircledInvitations.length;

  return (
    <Card className="mb-6" data-testid="spine-panel-invitations">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Invitations &amp; soft-circles
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Counts match the Invitations page exactly (shared SPINE-0).
          </p>
        </div>
        <Button size="sm" variant="outline" data-testid="spine-invitations-view-all" asChild>
          <Link href="/investor/invitations">
            Open invitations <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <SummaryStat
            label="Active (pending)"
            value={String(pendingCount)}
            testid="spine-invitations-pending"
          />
          <SummaryStat
            label="Soft-circled"
            value={String(softCircledCount)}
            testid="spine-invitations-softcircled"
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Active = invited + viewed + accepted. Soft-circled = soft-circled, confirmed, or signed.
        </p>
      </CardContent>
    </Card>
  );
}

/* ==================================================================== */
/* PANEL 4 — Message-channels summary                                   */
/* ==================================================================== */

export function ChannelsSummaryPanel() {
  const spine = useInvestorSpine();
  const ch = spine.channelUnlockState;

  return (
    <Card className="mb-6" data-testid="spine-panel-channels">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Message channels
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Channel access follows the ladder (SPINE-0): soft-circle unlocks the soft-circle
            discussion channel; a funded holding unlocks the cap-table channel.
          </p>
        </div>
        <Button size="sm" variant="outline" data-testid="spine-channels-view-all" asChild>
          <Link href="/investor/messages">
            Open messages <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChannelRow
            label="Soft-circle channels"
            count={ch.softCircleRoundIds.length}
            unlocked={ch.hasSoftCircleChannel}
            testid="spine-channels-softcircle"
          />
          <ChannelRow
            label="Cap-table channels"
            count={ch.capTableCompanyIds.length}
            unlocked={ch.hasCapTableChannel}
            testid="spine-channels-captable"
          />
        </div>
        {/* Short pointer to the soft-circle discussion channel. */}
        <p className="text-[11px] text-muted-foreground mt-3" data-testid="spine-channels-pointer">
          {ch.hasSoftCircleChannel
            ? "You're in the soft-circle discussion channel for each round you've soft-circled — open Messages to join the conversation."
            : "Soft-circle a round to unlock its soft-circle discussion channel."}
        </p>
      </CardContent>
    </Card>
  );
}

/* ==================================================================== */
/* PANEL 5 — M&A intelligence (LAST). REAL, privacy-gated, fail-closed.  */
/* ==================================================================== */

const INTENT_LABEL: Record<MaIntelResponse["intentSignal"], string> = {
  none: "No signal",
  inbound: "Inbound interest",
  outbound: "Outbound exploration",
  active_negotiation: "Active negotiation",
};

export function MaIntelligencePanel() {
  const spine = useInvestorSpine();
  // The company set comes ONLY from the spine (holdings + invited companies).
  const companyIds = spine.maCompanyIds;

  // Map companyId -> a display name from spine (holdings first, then invites).
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of spine.holdings as HoldingView[]) {
      if (h.companyId && h.company) m.set(h.companyId, h.company);
    }
    for (const e of spine.recentActivity) {
      if (e.companyId && !m.has(e.companyId)) m.set(e.companyId, e.companyName);
    }
    return m;
  }, [spine.holdings, spine.recentActivity]);

  // One privacy-gated fetch per company. On 403/404/empty the query data is
  // falsy -> we render the per-company empty-state (fail-closed, never fabricate).
  // We reuse the SAME queryKey the existing dashboard M&A table uses so there is
  // no duplicate network fetch, and NO server change is required.
  const intelQueries = useQueries({
    queries: companyIds.map((companyId) => ({
      queryKey: ["/api/investor/ma/intelligence", companyId],
      staleTime: 60_000,
      // retry:false is the client default; a 403/404 resolves to null (dev) or
      // throws ApiError (prod) -> data stays undefined -> empty-state.
    })),
  });

  return (
    <Card className="mb-6" data-testid="spine-panel-ma">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> M&amp;A intelligence
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-0.5">
          Real, privacy-gated M&amp;A readiness for your holdings and invited companies. No data is
          shown unless the company has a stored M&amp;A profile and you're authorized to see it.
        </p>
      </CardHeader>
      <CardContent>
        {companyIds.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center" data-testid="spine-ma-empty-all">
            No holdings or invited companies yet — M&amp;A intelligence appears here once you have a
            position or an invitation.
          </div>
        ) : (
          <div className="space-y-3" data-testid="spine-ma-list">
            {companyIds.map((companyId, idx) => {
              const q = intelQueries[idx];
              const intel = (q?.data as MaIntelResponse | null | undefined) ?? null;
              const loading = q?.isLoading ?? false;
              const name = nameById.get(companyId) ?? companyId;
              return (
                <MaCompanyBlock
                  key={companyId}
                  companyId={companyId}
                  companyName={name}
                  intel={intel}
                  loading={loading}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-company M&A block: real fields when present; clean empty-state when not. */
function MaCompanyBlock({
  companyId, companyName, intel, loading,
}: {
  companyId: string;
  companyName: string;
  intel: MaIntelResponse | null;
  loading: boolean;
}) {
  // Fail-closed: treat missing intel OR an all-zero derived record (endpoint
  // returns zeros when there is no meaningful stored profile) as no-data.
  const hasData =
    !!intel &&
    (intel.maScore > 0 ||
      intel.acquirerFitScore > 0 ||
      (intel.intentSignal && intel.intentSignal !== "none") ||
      (intel.topStrategicBuyers?.length ?? 0) > 0);

  const buyerNames = (intel?.topStrategicBuyers ?? [])
    .map((b) => b?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  return (
    <div
      className="rounded-md border border-border px-4 py-3"
      data-testid={`spine-ma-company-${companyId}`}
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          {/* rule #13 — full company name rendered verbatim */}
          <span className="text-sm font-medium truncate">{companyName}</span>
        </div>
        {hasData && intel && (
          <Badge variant="outline" className="text-[10px] shrink-0" data-testid={`spine-ma-intent-${companyId}`}>
            {INTENT_LABEL[intel.intentSignal]}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-2" data-testid={`spine-ma-loading-${companyId}`}>
          Loading M&amp;A intelligence…
        </div>
      ) : !hasData ? (
        /* Clean per-company empty-state — no fabricated numbers, gate respected. */
        <div className="text-xs text-muted-foreground py-2" data-testid={`spine-ma-empty-${companyId}`}>
          No M&amp;A intelligence available for this company yet.
        </div>
      ) : (
        <div data-testid={`spine-ma-data-${companyId}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            <MaMetric label="Acquirer fit" value={`${intel!.acquirerFitScore}/100`} testid={`spine-ma-fit-${companyId}`} />
            <MaMetric label="M&A score" value={`${intel!.maScore}/100`} testid={`spine-ma-score-${companyId}`} />
            <MaMetric label="Product-market fit" value={`${intel!.productMarketFit}/100`} testid={`spine-ma-pmf-${companyId}`} />
            <MaMetric label="Tech differentiation" value={`${intel!.technologyDifferentiation}/100`} testid={`spine-ma-tech-${companyId}`} />
            <MaMetric label="Customer concentration" value={`${intel!.customerConcentration}/100`} testid={`spine-ma-cust-${companyId}`} />
            <MaMetric label="Growth rate" value={`${intel!.growthRate}`} testid={`spine-ma-growth-${companyId}`} />
            <MaMetric label="Market share" value={`${intel!.marketShare}`} testid={`spine-ma-share-${companyId}`} />
            <MaMetric label="Mgmt strength" value={`${intel!.managementTeamStrength}/100`} testid={`spine-ma-mgmt-${companyId}`} />
          </div>
          {buyerNames.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap" data-testid={`spine-ma-buyers-${companyId}`}>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Layers className="h-3 w-3" /> Top strategic buyers:
              </span>
              {buyerNames.map((n) => (
                <span key={n} className="text-[10px] px-1.5 h-4 rounded-full bg-secondary text-muted-foreground inline-flex items-center">
                  {n}
                </span>
              ))}
            </div>
          )}

          {/* Comparable exits + revenue-multiple range. Rendered for all
              authorized investors. Real when present; honest empty-state when
              the endpoint returns an empty list / zero range — never fabricated. */}
          <div className="mt-3" data-testid={`spine-ma-comps-${companyId}`}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Comparable exits
            </div>
            {(intel!.comparableExits?.length ?? 0) > 0 ? (
              <ul className="space-y-1" data-testid={`spine-ma-comps-list-${companyId}`}>
                {intel!.comparableExits!.map((c) => (
                  <li
                    key={`${c.target}-${c.acquirer}`}
                    className="text-xs text-muted-foreground"
                    data-testid={`spine-ma-comp-${companyId}-${c.target}`}
                  >
                    <span className="font-medium text-foreground">
                      {c.target} → {c.acquirer}
                    </span>{" "}
                    · {fmtDate(c.date)} · {fmtUSD(c.valuationUsd, { compact: true })}
                    {typeof c.revenueMultiple === "number" ? ` · ${c.revenueMultiple.toFixed(1)}x rev` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <div
                className="text-xs text-muted-foreground"
                data-testid={`spine-ma-comps-empty-${companyId}`}
              >
                No qualifying comparable exits in window.
              </div>
            )}
            {intel!.revenueMultipleRange &&
            (intel!.revenueMultipleRange.low > 0 || intel!.revenueMultipleRange.high > 0) ? (
              <div
                className="mt-1 text-[11px] text-muted-foreground"
                data-testid={`spine-ma-range-${companyId}`}
              >
                Revenue multiple range:{" "}
                <span className="font-mono">
                  {intel!.revenueMultipleRange.low.toFixed(1)}x – {intel!.revenueMultipleRange.high.toFixed(1)}x
                </span>
              </div>
            ) : (
              <div
                className="mt-1 text-[11px] text-muted-foreground"
                data-testid={`spine-ma-range-empty-${companyId}`}
              >
                Revenue multiple range not available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- helpers -------------------------------- */

function SummaryStat({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5" data-testid={testid}>{value}</div>
    </div>
  );
}

function ChannelRow({
  label, count, unlocked, testid,
}: { label: string; count: number; unlocked: boolean; testid: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{unlocked ? "Unlocked" : "Locked"}</div>
      </div>
      <span className="text-lg font-semibold tabular-nums" data-testid={testid}>{count}</span>
    </div>
  );
}

function MaMetric({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded-md bg-secondary/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">{label}</div>
      <div className="text-sm font-mono tabular-nums mt-0.5" data-testid={testid}>{value}</div>
    </div>
  );
}

/**
 * Wave 5 (ENH-2) — the full SPINE-0 dashboard section, in Ozan-locked order:
 *   Portfolio → Activity → Invitations → Messages → M&A (last).
 * Rendered additively by Dashboard.tsx; preserves all existing widgets.
 */
export function DashboardSpinePanels() {
  return (
    <div data-testid="spine-panels-section">
      <PortfolioStandingPanel />
      <RecentActivityPanel />
      <InvitationsSummaryPanel />
      <ChannelsSummaryPanel />
      <MaIntelligencePanel />
    </div>
  );
}
