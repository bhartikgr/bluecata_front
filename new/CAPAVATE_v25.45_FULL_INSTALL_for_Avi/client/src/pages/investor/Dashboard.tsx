import { asArray } from "@/lib/safeArray";
/**
 * Sprint 10 — Investor Dashboard (rebuild).
 * Sprint 21 Wave A — Restructured layout:
 *   PageHeader → GuidanceBox → Messages+Posts → KPIs → Analytics+Cohort → M&A (with MaIntelligenceCard + DiscussDialog) → Round activity → MemberValueIntelligence
 *
 * A1: CapavateGuidanceBox at top
 * A2: Messages + Posts hoisted to top, two-column grid
 * A4: MemberValueIntelligenceInvestor added below round activity
 * A5: Lead button removed; Discuss wired to DiscussWithCapTableDialog; MaIntelligenceCard added above M&A table
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, TrendingUp, PieChart, Target, Inbox, Sparkles, FileText,
  MessageSquare, ArrowUpRight, Activity, Building2, Zap, Layers,
  ArrowRight, Megaphone,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/Sparkline";
import { fmtUSD, fmtPct, fmtDate, fmtNum } from "@/lib/format";
import { MessagesWidget } from "@/components/comms/MessagesWidget";
import { PostsFeed } from "@/components/comms/PostsFeed";
import { CapavateGuidanceBox } from "@/components/CapavateGuidanceBox";
import { MaIntelligenceCard } from "@/components/investor/MaIntelligenceCard";
import { DiscussWithCapTableDialog } from "@/components/investor/DiscussWithCapTableDialog";
import { MemberValueIntelligenceInvestor } from "@/components/investor/MemberValueIntelligenceInvestor";
import { HOVER_LIFT } from "@/lib/microInteractions";
// v25.38 Phase 4 — removed dead `apiRequest` import (zero call sites in this
// file; audit-confirmed truly-dead). No call site removed.
import { useToast } from "@/hooks/use-toast";
import type { PortfolioAnalytics } from "../../../../server/portfolioAnalyticsStore";
import type { MaIntelligence } from "@shared/schema";
import { useEntitlement, hasCapTable } from "@/lib/entitlement";
import { useRealtimeSync } from "@/lib/realtimeSync";
import { InvestorState1Nudge } from "@/components/investor/InvestorState1Nudge";

type Position = {
  id: string; companyId: string; company: string; sector: string; stage: string;
  role: string; instrument: string; series: string; shares: number; ownershipPct: number;
  invested: number; currentValue: number; vintageYear: number; lastRoundLabel: string;
  lastRoundDate: string; logoColor: string;
  maFlag: { strength: "high" | "medium" | "low"; note: string } | null;
};

type RoundActivity = {
  id: string; ts: string; kind: "new_round" | "soft_circle" | "term_sheet" | "close_gate";
  companyId: string; company: string; text: string; href: string; roundId: string;
};

const ACTIVITY_ICON: Record<RoundActivity["kind"], typeof Sparkles> = {
  new_round: Sparkles,
  soft_circle: TrendingUp,
  term_sheet: FileText,
  close_gate: Zap,
};
const ACTIVITY_LABEL: Record<RoundActivity["kind"], string> = {
  new_round: "New round",
  soft_circle: "Soft-circle activity",
  term_sheet: "Term sheet drop",
  close_gate: "Closing soon",
};

export default function InvestorDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Sprint 15 D7 — always call hooks in the same order.
  const entitlement = useEntitlement();
  const ctx = entitlement.data;

  const portfolio = useQuery<Position[]>({ queryKey: ["/api/investor/portfolio2"] });
  const analytics = useQuery<PortfolioAnalytics>({ queryKey: ["/api/investor/portfolio/analytics"] });
  const activity = useQuery<RoundActivity[]>({ queryKey: ["/api/investor/round-activity"] });

  const [analyticsView, setAnalyticsView] = useState<"stage" | "region" | "vintage">("stage");

  const a = analytics.data;

  // DEF-045: SSE subscription for invitation badge refresh
  useRealtimeSync();

  // Hooks are all settled — short-circuit to the State 1 nudge.
  if (ctx && ctx.isAuthed && (ctx.investor.state === "INVITED_ONLY" || !hasCapTable(ctx))) {
    return <InvestorState1Nudge ctx={ctx} />;
  }

  return (
    <>
      <PageHeader
        title="Investor workspace"
        description="Portfolio analytics, M&A intelligence, round activity, and the companies that have invited you onto their cap table."
        actions={
          <div className="flex gap-2">
            <Link href="/investor/crm">
              <Button variant="outline" data-testid="button-go-crm"><Building2 className="h-4 w-4 mr-2" /> CRM</Button>
            </Link>
            <Link href="/investor/invitations">
              <Button className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-invitations">
                <Inbox className="h-4 w-4 mr-2" /> Invitations
              </Button>
            </Link>
          </div>
        }
      />
      <PageBody>
        {/* Sprint 15 D8 — lapsed renewal banner. */}
        {ctx && ctx.collective.status === "lapsed" && (
          <div
            className="mb-4 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/40 px-4 py-3 flex items-start justify-between gap-4"
            data-testid="banner-collective-lapsed"
          >
            <div className="text-sm">
              <div className="font-medium text-amber-900 dark:text-amber-200">Capavate Collective — membership lapsed</div>
              <div className="text-amber-800/80 dark:text-amber-200/80 text-xs mt-0.5">
                Renew to re-enable the Capavate ↔ Collective toggle and Collective deal-room access. Cap-table access on Capavate is unaffected.
              </div>
            </div>
            <Link href="/investor/apply-to-collective">
              <Button size="sm" variant="outline" className="shrink-0" data-testid="button-renew-collective">
                Renew membership
              </Button>
            </Link>
          </div>
        )}

        {/* Wave G Track 2 — G3: investor bento header.
            Lives above the existing dashboard sections (which are preserved).
            Portfolio overview hero + 4 KPIs + activity tile + quick-actions tile. */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[minmax(110px,auto)] mb-6"
          data-testid="bento-grid-investor-dashboard"
        >
          {/* Hero — Portfolio overview */}
          <Card
            className="col-span-1 md:col-span-2 lg:col-span-4 bg-gradient-to-br from-[hsl(0_100%_40%/0.06)] to-[hsl(0_100%_40%/0.02)] border-[hsl(0_100%_40%/0.15)]"
            data-testid="bento-tile-investor-hero"
          >
            <CardContent className="p-6 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wide text-[hsl(0_100%_40%)] font-medium">Portfolio overview</div>
                <div className="text-xl font-semibold mt-1">{a ? fmtUSD(a.totalCurrentValue, { compact: true }) : "—"} current value</div>
                <div className="text-sm text-muted-foreground mt-0.5">{a ? `MOIC ${a.moic.toFixed(2)}x · IRR ${a.irr.toFixed(1)}%` : "Loading analytics…"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/investor/portfolio"><Button size="sm" variant="outline" data-testid="bento-action-portfolio"><Briefcase className="h-3.5 w-3.5 mr-1.5" /> View portfolio</Button></Link>
              </div>
            </CardContent>
          </Card>

          {/* KPI 1 — Total committed */}
          <Card interactive className={`col-span-1 ${HOVER_LIFT}`} data-testid="bento-tile-investor-kpi-committed">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Total committed</div>
                <Target className="h-4 w-4 text-[hsl(0_100%_40%)]" />
              </div>
              <div className="text-2xl font-semibold tracking-tight mt-2 tabular-nums">{a ? fmtUSD(a.totalInvested, { compact: true }) : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">across portfolio</div>
            </CardContent>
          </Card>

          {/* KPI 2 — Companies in portfolio */}
          <Card interactive className={`col-span-1 ${HOVER_LIFT}`} data-testid="bento-tile-investor-kpi-companies">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Companies</div>
                <Building2 className="h-4 w-4 text-[hsl(0_100%_40%)]" />
              </div>
              <div className="text-2xl font-semibold tracking-tight mt-2 tabular-nums">{portfolio.data?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">in your cap tables</div>
            </CardContent>
          </Card>

          {/* KPI 3 — Soft circles open */}
          <Card interactive className={`col-span-1 ${HOVER_LIFT}`} data-testid="bento-tile-investor-kpi-softcircles">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Soft circles open</div>
                <Megaphone className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-semibold tracking-tight mt-2 tabular-nums">{activity.data?.filter(x => x.kind === "soft_circle").length ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">live opportunities</div>
            </CardContent>
          </Card>

          {/* KPI 4 — Funded */}
          <Card interactive className={`col-span-1 ${HOVER_LIFT}`} data-testid="bento-tile-investor-kpi-funded">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Funded</div>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-semibold tracking-tight mt-2 tabular-nums">{a ? `${a.tvpi.toFixed(2)}x` : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">TVPI multiple</div>
            </CardContent>
          </Card>

          {/* Medium tile — Recent activity (col-span-2) */}
          <Card interactive className={`col-span-1 md:col-span-2 lg:col-span-2 ${HOVER_LIFT}`} data-testid="bento-tile-investor-activity">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Recent round activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {(activity.data ?? []).slice(0, 3).map(act => (
                  <li key={`bento-${act.id}`} className="flex items-start gap-2 text-xs" data-testid={`bento-activity-${act.id}`}>
                    <div className="mt-1 h-1.5 w-1.5 rounded-full bg-[hsl(0_100%_40%)] shrink-0" />
                    <div className="flex-1 min-w-0 truncate">
                      <span className="font-medium">{act.company}</span>
                      <span className="text-muted-foreground"> · {act.text}</span>
                    </div>
                  </li>
                ))}
                {(activity.data?.length ?? 0) === 0 && <li className="text-xs text-muted-foreground">No recent activity.</li>}
              </ul>
            </CardContent>
          </Card>

          {/* Medium tile — Upcoming events / quick actions (col-span-2) */}
          <Card interactive className={`col-span-1 md:col-span-2 lg:col-span-2 ${HOVER_LIFT}`} data-testid="bento-tile-investor-quick">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/investor/invitations"><Button size="sm" variant="outline" data-testid="bento-action-invitations"><Inbox className="h-3.5 w-3.5 mr-1.5" /> Invitations</Button></Link>
              <Link href="/investor/crm"><Button size="sm" variant="outline" data-testid="bento-action-crm"><Building2 className="h-3.5 w-3.5 mr-1.5" /> CRM</Button></Link>
              <Link href="/investor/profile"><Button size="sm" variant="outline" data-testid="bento-action-profile"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Update profile</Button></Link>
            </CardContent>
          </Card>
        </div>

        {/* A1 — Capavate guidance info-box */}
        <CapavateGuidanceBox variant="investor" />

        {/* A2 — Messages + Posts hoisted to top, two-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <MessagesWidget basePath="/investor/messages" />
          <PostsFeed role="investor" maxPosts={3} viewAllHref="/investor/network-posts" />
        </div>

        {/* KPI strip — 6 cards with sparklines + YoY chips */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <KpiSpark label="MOIC" value={a ? `${a.moic.toFixed(2)}x` : "—"}
            sub={a ? `${a.yoyDelta.moic >= 0 ? "+" : ""}${a.yoyDelta.moic.toFixed(2)} YoY` : ""}
            data={a?.sparklines.moic ?? []} positive={(a?.yoyDelta.moic ?? 0) >= 0}
            icon={Target} testid="kpi-moic" />
          <KpiSpark label="IRR" value={a ? `${a.irr.toFixed(1)}%` : "—"}
            sub={a ? `${a.yoyDelta.irr >= 0 ? "+" : ""}${a.yoyDelta.irr.toFixed(1)} pp YoY` : ""}
            data={a?.sparklines.irr ?? []} positive={(a?.yoyDelta.irr ?? 0) >= 0}
            icon={TrendingUp} testid="kpi-irr" />
          <KpiSpark label="TVPI" value={a ? `${a.tvpi.toFixed(2)}x` : "—"}
            sub="Total value to paid-in"
            data={a?.sparklines.tvpi ?? []} positive
            icon={PieChart} testid="kpi-tvpi" />
          <KpiSpark label="DPI" value={a ? `${a.dpi.toFixed(2)}x` : "—"}
            sub="Distributed to paid-in"
            data={a?.sparklines.dpi ?? []} positive
            icon={Briefcase} testid="kpi-dpi" />
          <KpiSpark label="Paper value" value={a ? fmtUSD(a.totalCurrentValue, { compact: true }) : "—"}
            sub={a ? `+${fmtUSD(a.yoyDelta.paperValue, { compact: true })} YoY` : ""}
            data={a?.sparklines.paperValue ?? []} positive
            icon={Layers} testid="kpi-paper" />
          <KpiSpark label="Realised" value={a ? fmtUSD(a.totalRealized, { compact: true }) : "—"}
            sub={a ? `${a.totalInvested ? fmtPct((a.totalRealized / a.totalInvested) * 100, 1) : "—"} of cost` : ""}
            data={a?.sparklines.realized ?? []} positive
            icon={Sparkles} testid="kpi-realised" />
        </div>

        {/* Analytics + Cohort */}
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Portfolio analytics</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Diversification across stage, region, and vintage.</p>
              </div>
              <div className="inline-flex rounded-md border border-border p-0.5">
                {(["stage", "region", "vintage"] as const).map(k => (
                  <button key={k}
                    className={`text-xs px-2.5 py-1 rounded-sm capitalize ${analyticsView === k ? "bg-[hsl(0_100%_40%)] text-white" : "text-muted-foreground hover:bg-secondary"}`}
                    onClick={() => setAnalyticsView(k)}
                    data-testid={`button-view-${k}`}>{k}</button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {a ? (
                <AnalyticsBlock
                  buckets={analyticsView === "stage" ? a.byStage : analyticsView === "region" ? a.byRegion : a.byVintage}
                />
              ) : <SkeletonRows n={5} />}
            </CardContent>
          </Card>

          <Card data-testid="card-cohort">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cohort benchmark</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Where you sit vs. peer angels (MOIC).</p>
            </CardHeader>
            <CardContent>
              {a ? <CohortBar p25={a.cohortBenchmark.p25} p50={a.cohortBenchmark.p50} p75={a.cohortBenchmark.p75} you={a.cohortBenchmark.you} /> : <SkeletonRows n={4} />}
            </CardContent>
          </Card>
        </div>

        {/* A5 — M&A Intelligence panel with MaIntelligenceCard + Discuss dialog (Lead removed) */}
        <Card className="mb-6" data-testid="card-ma-panel">
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> M&amp;A Intelligence</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Acquirer-fit scores and strategic-buyer signals across your portfolio.</p>
            </div>
          </CardHeader>
          <CardContent>
            {/* MaIntelligenceCard — top 3 readiness rollup */}
            <MaIntelligenceCard positions={asArray(portfolio.data)} />

            {/* M&A table — Lead button removed per spec */}
            <table className="w-full text-sm" data-testid="table-ma">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-2 py-2.5 text-xs uppercase text-muted-foreground">Company</th>
                  <th className="text-right font-medium px-3 py-2.5 text-xs uppercase text-muted-foreground">Acquirer fit</th>
                  <th className="text-right font-medium px-3 py-2.5 text-xs uppercase text-muted-foreground">M&amp;A score</th>
                  <th className="text-left font-medium px-3 py-2.5 text-xs uppercase text-muted-foreground">Intent signal</th>
                  <th className="text-left font-medium px-3 py-2.5 text-xs uppercase text-muted-foreground">Top buyer</th>
                  <th className="text-right font-medium px-3 py-2.5 text-xs uppercase text-muted-foreground">Discuss</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.isLoading && (
                  <tr><td colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-[hsl(0_100%_40%)] mr-2 align-middle" />
                    Loading portfolio…
                  </td></tr>
                )}
                {!portfolio.isLoading && (portfolio.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                    No portfolio companies yet. Accept an invitation to build your cap-table.
                  </td></tr>
                )}
                {!portfolio.isLoading && asArray(portfolio.data).map(p => (
                  <MaRow key={p.companyId} pos={p} navigate={navigate} toast={toast} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Round activity stream */}
        <Card className="mb-6" data-testid="card-round-activity">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Round activity across your portfolio</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">New rounds opening, soft-circle progress, term sheets, and closes.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mx-2" data-testid="list-round-activity">
              {asArray(activity.data).map(act => {
                const Icon = ACTIVITY_ICON[act.kind];
                return (
                  <li key={act.id} className="px-2 py-3" data-testid={`row-ra-${act.id}`}>
                    <Link href={act.href}>
                      <div className="flex items-start gap-3 hover:bg-secondary/40 -mx-2 px-2 py-1.5 rounded cursor-pointer">
                        <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{act.company}</span>
                            <Badge variant="outline" className="text-[10px]">{ACTIVITY_LABEL[act.kind]}</Badge>
                          </div>
                          <div className="text-sm text-muted-foreground mt-0.5">{act.text}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(act.ts)}</div>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/60 mt-1" />
                      </div>
                    </Link>
                  </li>
                );
              })}
              {activity.isLoading && (
                <li className="text-center py-12 text-sm text-muted-foreground">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-[hsl(0_100%_40%)] mr-2 align-middle" />
                  Loading activity…
                </li>
              )}
              {!activity.isLoading && (activity.data?.length ?? 0) === 0 && (
                <li className="text-center py-12 text-sm text-muted-foreground">
                  No recent round activity. Join a round to see live updates here.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        {/* A4 — Member Value & Intelligence */}
        <div className="mb-6">
          <MemberValueIntelligenceInvestor />
        </div>
      </PageBody>
    </>
  );
}

/* -------- M&A row — Lead button removed, Discuss wired to dialog -------- */
function MaRow({ pos, navigate, toast }: { pos: Position; navigate: (to: string) => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const intel = useQuery<MaIntelligence>({ queryKey: ["/api/investor/ma/intelligence", pos.companyId] });
  const [discussOpen, setDiscussOpen] = useState(false);
  const i = intel.data;
  const intentColor = i?.intentSignal === "active_negotiation" ? "bg-[hsl(7_61%_43%)]/10 text-[hsl(7_61%_43%)] border-[hsl(7_61%_43%)]/40"
    : i?.intentSignal === "inbound" ? "bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] border-[hsl(0_100%_40%)]/40"
    : i?.intentSignal === "outbound" ? "bg-[hsl(333_75%_35%)]/10 text-[hsl(333_75%_35%)] border-[hsl(333_75%_35%)]/40"
    : "bg-muted text-muted-foreground border-border";

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-ma-${pos.companyId}`}>
        <td className="px-2 py-3">
          <button className="flex items-center gap-2.5 text-left" onClick={() => navigate(`/investor/companies/${pos.companyId}`)} data-testid={`button-ma-company-${pos.companyId}`}>
            <div className="h-7 w-7 rounded-md flex items-center justify-center text-white text-[11px] font-semibold shrink-0" style={{ backgroundColor: pos.logoColor }}>
              {pos.company.slice(0, 1)}
            </div>
            <div>
              <div className="font-medium">{pos.company}</div>
              <div className="text-[11px] text-muted-foreground">{pos.sector}</div>
            </div>
          </button>
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums" data-testid={`text-fit-${pos.companyId}`}>
          {i ? `${i.acquirerFitScore}/100` : "—"}
        </td>
        <td className="px-3 py-3 text-right font-mono tabular-nums" data-testid={`text-mascore-${pos.companyId}`}>
          {i ? `${i.maScore}/100` : "—"}
        </td>
        <td className="px-3 py-3">
          {i ? <Badge variant="outline" className={`text-[10px] capitalize ${intentColor}`}>{i.intentSignal.replace("_", " ")}</Badge> : "—"}
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground">
          {i?.topStrategicBuyers[0]?.name ?? "—"}
        </td>
        <td className="px-3 py-3 text-right">
          <Button size="sm" variant="outline"
            onClick={() => setDiscussOpen(true)}
            data-testid={`button-discuss-${pos.companyId}`}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> Discuss
          </Button>
        </td>
      </tr>

      {/* A5 — DiscussWithCapTableDialog (replaces old mutationFn) */}
      <DiscussWithCapTableDialog
        open={discussOpen}
        onOpenChange={setDiscussOpen}
        companyId={pos.companyId}
        companyName={pos.company}
        topBuyer={i?.topStrategicBuyers[0]?.name ?? ""}
        maScore={i?.maScore ?? 0}
      />
    </>
  );
}

/* -------- presentational helpers -------- */

function KpiSpark({
  icon: Icon, label, value, sub, data, positive, testid,
}: {
  icon: typeof Briefcase; label: string; value: string; sub?: string;
  data: number[]; positive: boolean; testid: string;
}) {
  return (
    <Card data-testid={testid}>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <div className="text-lg font-semibold mt-1" data-testid={`${testid}-value`}>{value}</div>
        <div className="mt-1.5">
          <Sparkline data={data.length ? data : [0, 0]} stroke={positive ? "hsl(0 100% 40%)" : "hsl(7 61% 43%)"} />
        </div>
        {sub && <div className={`text-[11px] mt-1 ${positive ? "text-emerald-700 " : "text-rose-700 "}`}>{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AnalyticsBlock({ buckets }: { buckets: Record<string, { invested: number; currentValue: number; count: number }> }) {
  const entries = Object.entries(buckets).sort((a, b) => b[1].invested - a[1].invested);
  const max = Math.max(1, ...entries.map(([, v]) => v.invested));
  if (entries.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">No diversification data.</div>;
  return (
    <div className="space-y-3">
      {entries.map(([k, v]) => {
        const moic = v.invested ? v.currentValue / v.invested : 0;
        return (
          <div key={k} data-testid={`row-bucket-${k}`}>
            <div className="flex items-baseline justify-between text-sm mb-1">
              <span className="font-medium">{k}</span>
              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                {fmtUSD(v.invested, { compact: true })} invested · {moic.toFixed(2)}x · {v.count} {v.count === 1 ? "co" : "cos"}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-[hsl(0_100%_40%)]" style={{ width: `${(v.invested / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CohortBar({ p25, p50, p75, you }: { p25: number; p50: number; p75: number; you: number }) {
  const max = Math.max(p75 * 1.2, you * 1.1, 2);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="space-y-3 pt-2">
      <div className="relative h-12 bg-secondary rounded-md">
        <div className="absolute inset-y-0 left-0 bg-[hsl(0_100%_40%)]/20 rounded-l-md" style={{ width: pct(p25) }} />
        <div className="absolute inset-y-0 left-0 bg-[hsl(0_100%_40%)]/40" style={{ width: pct(p50) }} />
        <div className="absolute inset-y-0 left-0 bg-[hsl(0_100%_40%)]/60" style={{ width: pct(p75) }} />
        <div className="absolute inset-y-0 w-0.5 bg-[hsl(333_75%_35%)]" style={{ left: pct(you) }} title="You" data-testid="marker-you" />
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat n="P25" v={`${p25.toFixed(2)}x`} />
        <Stat n="P50" v={`${p50.toFixed(2)}x`} />
        <Stat n="P75" v={`${p75.toFixed(2)}x`} />
        <Stat n="You" v={`${you.toFixed(2)}x`} highlight />
      </div>
    </div>
  );
}

function Stat({ n, v, highlight }: { n: string; v: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-xs uppercase ${highlight ? "text-[hsl(333_75%_35%)] font-semibold" : "text-muted-foreground"}`}>{n}</div>
      <div className="font-mono tabular-nums">{v}</div>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-3 bg-secondary rounded animate-pulse" />
      ))}
    </div>
  );
}

