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
import { apiRequest } from "@/lib/queryClient";

type Kpis = {
  summary: { totalCompanies: number; totalInvestors: number; totalCommittedSoftCircle: number; totalFunded: number; momGrowthPct: number; churnPct: number; nrr: number };
  queues: Record<string, number>;
  health: { capTableReconcile: { runs: number; success: number; successRatePct: number }; closeGateFailures: number; dataroomUploadErrors: number; messageDelivery: { sent: number; delivered: number; deliveryRatePct: number }; emailSlaSec: number };
  funnels: { onboarding: { step: string; count: number }[]; investor: { step: string; count: number }[] };
  topCompanies: { id: string; name: string; traction: number; raised: number }[];
  topInvestors: { id: string; name: string; activity: number; committed: number }[];
  regions: { code: string; companies: number; raised: number }[];
};

type Surface = "capavate" | "collective";

const fmtUsd = (n: number) => "$" + n.toLocaleString();
const fmtUsdShort = (n: number) =>
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
  kpi3Label: string; kpi3Help: string;
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
    kpi3Label: "Soft-circled", kpi3Help: "Sum of every non-binding investor commitment currently outstanding across all active rounds. A high ratio of soft-circled : funded suggests pipeline conversion friction worth investigating.",
    kpi4Label: "Funded", kpi4Help: "Sum of cash that has actually wired into companies and been committed to the cap table. Churn% is the percentage of paying founder accounts that downgraded or cancelled in the last 30 days.",
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
    kpi3Label: "Committed via syndicates", kpi3Help: "Sum of every member-side commitment to a Collective-syndicated round in the last 12 months. Includes both deployed and pending allocations.",
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

  const { data, isLoading } = useQuery<Kpis>({
    queryKey: ["/api/admin/dashboard/kpis", surface],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/admin/dashboard/kpis?surface=${surface}`);
      return r.json();
    },
    refetchInterval: 15_000,
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
    const softCircleToFunded =
      data.summary.totalCommittedSoftCircle > 0
        ? ((data.summary.totalFunded / data.summary.totalCommittedSoftCircle) * 100).toFixed(1)
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
    return [...data.regions]
      .map(r => ({ ...r, density: r.companies > 0 ? r.raised / r.companies : 0 }))
      .sort((a, b) => b.density - a.density);
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
              ? "bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white"
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
              ? "bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
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
              <Badge variant="outline" className="text-[10px]">+{(data?.summary.momGrowthPct ?? 0).toFixed(1)}% MoM</Badge>
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
              <Badge variant="outline" className="text-[10px]">NRR {(data?.summary.nrr ?? 1).toFixed(2)}x</Badge>
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
              <Badge variant="outline" className="text-[10px] text-emerald-700">Committed</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi3Label}
              <HelpTip>{copy.kpi3Help}</HelpTip>
            </div>
            <div className="text-2xl font-semibold mt-1">{fmtUsd(data?.summary.totalCommittedSoftCircle ?? 0)}</div>
          </Card>
          <Card className="p-4" data-testid="stat-kpi-4">
            <div className="flex items-center justify-between mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-[10px]">Churn {(data?.summary.churnPct ?? 0).toFixed(1)}%</Badge>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {copy.kpi4Label}
              <HelpTip>{copy.kpi4Help}</HelpTip>
            </div>
            <div className="text-2xl font-semibold mt-1">{fmtUsd(data?.summary.totalFunded ?? 0)}</div>
          </Card>
        </div>

        {/* Sprint 28 — Conversion analytics row (new). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <Card className="p-4 bg-[hsl(184_98%_97%)] border-[hsl(184_98%_22%)]/30" data-testid="card-conv-onboarding">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {surface === "capavate" ? "Founder end-to-end" : "Application end-to-end"}
              <HelpTip>Percentage of those who entered the top of the onboarding funnel that completed the bottom step. Investor-grade benchmark: 40–55% for founder onboarding, 50–65% for member onboarding.</HelpTip>
            </div>
            <div className="text-xl font-semibold mt-1">{conversions?.onboardingEndToEnd ?? "—"}</div>
          </Card>
          <Card className="p-4 bg-[hsl(184_98%_97%)] border-[hsl(184_98%_22%)]/30" data-testid="card-conv-investor">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {surface === "capavate" ? "Invited → Funded" : "Shared → Joined"}
              <HelpTip>{surface === "capavate"
                ? "Investors who eventually funded out of those originally invited. The single most important platform health metric. Healthy is 30–40%; below 20% indicates pipeline quality issues."
                : "Members who joined a syndicate out of those originally shown the deal. Healthy is 20–30%; below 12% indicates a deal-flow quality issue."}</HelpTip>
            </div>
            <div className="text-xl font-semibold mt-1">{conversions?.investorEndToEnd ?? "—"}</div>
          </Card>
          <Card className="p-4 bg-[hsl(184_98%_97%)] border-[hsl(184_98%_22%)]/30" data-testid="card-conv-softcircle">
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
            <HealthTile icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />} label="Reconcile success" value={`${data?.health.capTableReconcile.successRatePct.toFixed(2) ?? "—"}%`} hint={`${data?.health.capTableReconcile.runs ?? 0} runs`} tone={(data?.health.capTableReconcile.successRatePct ?? 0) < 99 ? "warn" : "ok"} testId="card-health-reconcile" />
            <HealthTile icon={<AlertCircle className="h-3.5 w-3.5" />} label="Close-gate fails" value={String(data?.health.closeGateFailures ?? 0)} tone={(data?.health.closeGateFailures ?? 0) > 5 ? "warn" : "ok"} testId="card-health-closegate" />
            <HealthTile icon={<FileText className="h-3.5 w-3.5" />} label="Dataroom errors" value={String(data?.health.dataroomUploadErrors ?? 0)} tone={(data?.health.dataroomUploadErrors ?? 0) > 3 ? "warn" : "ok"} testId="card-health-dataroom" />
            <HealthTile icon={<Send className="h-3.5 w-3.5" />} label="Message delivery" value={`${data?.health.messageDelivery.deliveryRatePct.toFixed(2) ?? "—"}%`} tone={(data?.health.messageDelivery.deliveryRatePct ?? 0) < 99.5 ? "warn" : "ok"} testId="card-health-msgs" />
            <HealthTile icon={<Mail className="h-3.5 w-3.5" />} label="Email SLA" value={`${data?.health.emailSlaSec ?? "—"}s`} hint="P95 send time" tone={(data?.health.emailSlaSec ?? 0) > 60 ? "warn" : "ok"} testId="card-health-email" />
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
                  <div className={`text-base font-semibold ${isDead && value > 0 ? "text-rose-700" : ""}`}>{value}</div>
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
              colorClass="bg-[hsl(184_98%_22%)]"
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

function HealthTile({ icon, label, value, hint, tone, testId }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: "ok" | "warn";
  testId: string;
}) {
  return (
    <Card className={`p-3 ${tone === "warn" ? "bg-amber-50 border-amber-200" : ""}`} data-testid={testId}>
      <div className="flex items-center gap-1.5">{icon}<span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span></div>
      <div className={`text-base font-semibold mt-0.5 ${tone === "warn" ? "text-amber-900" : ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
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
