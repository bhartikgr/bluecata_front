import { asArray } from "@/lib/safeArray";
/**
 * Sprint 11 Phase 2 — Founder Dashboard v2 rebuild.
 *
 * Sections:
 *   1. Header KPI strip (founder ownership, ESOP %, fully-diluted holders)
 *   2. Active raise + round-health funnel (invited → … → funded)
 *   3. Cap-table communication center: open thread to entire cap-table + per-round threads
 *   4. M&A Intelligence INBOUND panel
 *   5. Dataroom engagement preview (top-5 viewed docs + unique viewers)
 *   6. Report read-rate chip
 *   7. Activity log preview (5 most recent)
 *   8. Sprint 9 Messages + Posts widgets (preserved)
 */
import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Stat, StateBadge } from "@/components/common";
import {
  Briefcase, Users, FileText, Send, ArrowUpRight, TrendingUp, Eye, Clock,
  GitBranch, MailPlus, FolderOpen, ShieldCheck, Activity as ActivityIcon, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUSD, fmtPct, timeAgo } from "@/lib/format";
import CapitalizationJourney from "@/components/CapitalizationJourney";
import { GlossaryLink } from "@/components/Glossary";
import { MessagesWidget } from "@/components/comms/MessagesWidget";
import { PostsFeed } from "@/components/comms/PostsFeed";
import { TransactionPrepPanel } from "@/components/TransactionPrepPanel";
import { DscSummaryCard } from "@/components/DscSummaryCard";
import { CapavateGuidanceBox } from "@/components/CapavateGuidanceBox";
import { DscFeedbackBox } from "@/components/DscFeedbackBox";
import { MnaReadinessCard } from "@/components/MnaReadinessCard";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveCompany } from "@/lib/useActiveCompany";
import { CheckCircle2, TrendingUp as TrendUp } from "lucide-react";

/* ============================================================
 * ProfileCompletionCard — Wave C-1
 * ============================================================ */
type CompletionSection = { name: string; complete: number; total: number; pct: number };
type CompletionData = {
  completionPct: number;
  weightedScore: number;
  totalWeight: number;
  sections: CompletionSection[];
};

function ProfileCompletionCard({ companyId }: { companyId: string }) {
  const completion = useQuery<CompletionData>({
    queryKey: ["/api/founder/profile/completion", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/profile/completion?companyId=${companyId}`)).json(),
    enabled: !!companyId,
  });

  const data = completion.data;
  const pct = data?.completionPct ?? 0;
  const total = data?.sections?.reduce((s, c) => s + c.total, 0) ?? 0;
  const complete = data?.sections?.reduce((s, c) => s + c.complete, 0) ?? 0;

  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (pct / 100) * circumference;
  const isBoost = pct >= 80;

  return (
    <Card className="mb-6" data-testid="card-profile-completion">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Profile Completion</CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Collective discovery boosted at 80%
          </p>
        </div>
        {isBoost && (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-discovery-boost">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Discovery boosted
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-6">
          {/* Circle progress */}
          <div className="flex-shrink-0 flex flex-col items-center">
            <svg width="96" height="96" viewBox="0 0 96 96" data-testid="circle-completion-progress">
              <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
              <circle
                cx="48" cy="48" r="40" fill="none"
                stroke={isBoost ? "hsl(142 72% 29%)" : "hsl(var(--primary))"}
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(-90 48 48)"
                style={{ transition: "stroke-dashoffset 0.5s ease" }}
              />
              <text x="48" y="52" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor">{pct}%</text>
            </svg>
            <div className="text-xs text-muted-foreground text-center mt-1" data-testid="text-completion-fields">
              {complete} of {total} pts
            </div>
          </div>

          {/* Section bars */}
          <div className="flex-1 space-y-2 min-w-0">
            {(data?.sections ?? []).map(section => (
              <div key={section.name} data-testid={`row-section-${section.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-medium">{section.name}</span>
                  <span className="text-muted-foreground">{section.pct}%</span>
                </div>
                <Progress value={section.pct} className="h-1.5" />
              </div>
            ))}
            {completion.isLoading && <Skeleton className="h-24 w-full" />}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Link href="/founder/profile/wizard">
            <Button size="sm" data-testid="button-complete-profile">
              {pct < 100 ? "Complete profile" : "Review profile"}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
          <span className="text-xs text-muted-foreground" data-testid="text-boost-hint">
            {isBoost
              ? "Your profile is highly visible to Collective investors."
              : `${80 - pct}% more to unlock Collective discovery boost.`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

type Round = { id: string; companyId: string; name: string; type: string; state: string; targetAmount: number; raisedAmount: number; closeDate: string };
type Activity = { id: string; ts: string; actor: string; action: string; target: string };
type DREngagement = {
  topDocs: Array<{ fileId: string; name: string; uniqueViewers: number; totalViews: number; avgTimeSeconds: number; lastViewedAt: string | null }>;
  investors: Array<{ investorId: string; docsViewed: number; totalSeconds: number }>;
};
type Report = { id: string; title: string; status: string; sentAt: string | null; recipients: string[]; readReceipts: Array<{ investorId: string; openedAt: string; reads: number }> };
type MaInitiative = { id: string; companyId: string; topic: string; rationale: string; investorUserId: string; buyerShortlist?: string[]; createdAt: string; threadId: string };

/** Funnel state -> friendly label + width fraction. */
const FUNNEL_STAGES: Array<{ key: string; label: string }> = [
  { key: "invited",      label: "Invited" },
  { key: "viewed",       label: "Viewed" },
  { key: "soft_circled", label: "Soft-circled" },
  { key: "confirmed",    label: "Confirmed" },
  { key: "signed",       label: "Signed" },
  { key: "funded",       label: "Funded" },
];

export default function FounderDashboard() {
  const { toast } = useToast();
  const active = useActiveCompany();
  const companyId = active.data?.activeCompanyId ?? "co_novapay";
  const company = active.data?.company;

  const rounds = useQuery<Round[]>({ queryKey: ["/api/rounds"] });
  const activity = useQuery<Activity[]>({ queryKey: ["/api/activity"] });
  const engagement = useQuery<DREngagement>({ queryKey: ["/api/founder/dataroom/engagement", companyId], queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/engagement?companyId=${companyId}`)).json() });
  const reports = useQuery<Report[]>({ queryKey: ["/api/founder/reports2", companyId], queryFn: async () => (await apiRequest("GET", `/api/founder/reports2?companyId=${companyId}`)).json() });
  const maAll = useQuery<MaInitiative[]>({ queryKey: ["/api/investor/ma/initiatives"] });

  const companyRounds = useMemo(() => asArray(rounds.data).filter(r => r.companyId === companyId), [rounds.data, companyId]);
  const activeRound = companyRounds.find(r => r.state === "soft_circle_open" || r.state === "signing_open");
  const totalRaised = companyRounds.reduce((s, r) => s + r.raisedAmount, 0);
  const totalTarget = companyRounds.reduce((s, r) => s + r.targetAmount, 0);

  // Round-health funnel — synthesized from the active round
  const funnel = useMemo(() => {
    if (!activeRound) return null;
    const t = activeRound.targetAmount || 1;
    const r = activeRound.raisedAmount;
    const pct = Math.min(1, r / t);
    // approximate funnel counts that respect monotonic decrease
    const seed = Math.max(8, Math.round(20 * 1));
    return [
      { ...FUNNEL_STAGES[0], count: seed },
      { ...FUNNEL_STAGES[1], count: Math.round(seed * 0.85) },
      { ...FUNNEL_STAGES[2], count: Math.round(seed * 0.55) },
      { ...FUNNEL_STAGES[3], count: Math.round(seed * 0.40 * (0.5 + pct / 2)) },
      { ...FUNNEL_STAGES[4], count: Math.round(seed * 0.28 * (0.5 + pct / 2)) },
      { ...FUNNEL_STAGES[5], count: Math.round(seed * 0.20 * pct) },
    ];
  }, [activeRound]);

  // M&A inbound — initiatives tied to active company
  const inbound = useMemo(() => asArray(maAll.data).filter(m => m.companyId === companyId), [maAll.data, companyId]);

  // Report read-rate
  const readRate = useMemo(() => {
    const r = reports.data?.[0];
    if (!r) return null;
    const sent = r.recipients?.length ?? 0;
    const opened = r.readReceipts?.length ?? 0;
    return { title: r.title, sent, opened, pct: sent ? opened / sent : 0 };
  }, [reports.data]);

  // Cap-table broadcast (defect 21/E — also invalidate channels)
  const [, navigate] = useLocation();
  const broadcastAll = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/investor-crm/broadcast", { companyId, filter: { stage: "invested" }, message: "Quick update from the team — see latest dashboard." })).json(),
    onSuccess: (data: { recipientCount: number }) => {
      toast({ title: "Cap-table thread opened", description: `Sent to ${data.recipientCount} holders.` });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/investor-crm"] });
      queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] });
    },
  });

  // M&A mutations (defect 14)
  const respondMaMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/investor/ma/initiatives/${id}/respond`, { companyId })).json(),
    onSuccess: () => { toast({ title: "Response sent" }); queryClient.invalidateQueries({ queryKey: ["/api/investor/ma/initiatives"] }); },
  });
  const declineMaMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/investor/ma/initiatives/${id}/decline`, { companyId })).json(),
    onSuccess: () => { toast({ title: "Declined", variant: "destructive" }); queryClient.invalidateQueries({ queryKey: ["/api/investor/ma/initiatives"] }); },
  });

  return (
    <>
      <PageHeader
        title={company ? `${company.companyName}` : "Founder workspace"}
        description={`${company?.role ?? "founder"} · ${company?.sector ?? ""} · ${company?.hq ?? ""}`}
        breadcrumbs={[{ label: "Workspace" }]}
        actions={
          <>
            <GlossaryLink />
            <Link href="/founder/rounds/new"><Button variant="outline" data-testid="button-new-round"><Briefcase className="h-4 w-4 mr-2" /> New round</Button></Link>
            <Link href="/founder/reports/new"><Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-new-report"><FileText className="h-4 w-4 mr-2" /> Send investor update</Button></Link>
          </>
        }
      />
      <PageBody>
        {/* Wave C-1 — Profile Completion Card */}
        <ProfileCompletionCard companyId={companyId} />

        {/* Sprint 18 Phase 2 — T2 guidance info-box (dismissible) */}
        <CapavateGuidanceBox variant="founder" />

        {/* Sprint 18 Phase 2 — T2 hoisted comms (Messages + Posts above Capitalization Journey) */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6" data-testid="section-comms-hoisted">
          <div className="lg:col-span-1"><MessagesWidget basePath="/founder/messages" /></div>
          <div className="lg:col-span-2"><PostsFeed role="founder" maxPosts={5} viewAllHref="/founder/network-posts" /></div>
        </div>

        {/* Sprint 18 Phase 2 — T2 DSC review fallback when no DSC review yet */}
        <DscFeedbackBox companyDscState={(company as any)?.dscState ?? null} />

        <CapitalizationJourney />

        {/* Sprint 18 Phase 2 — T3.4 M&A Readiness card */}
        <div className="mb-6">
          <MnaReadinessCard companyId={companyId} />
        </div>

        {/* Founder KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Founder ownership" value={fmtPct((company?.kpi?.ownershipPct ?? 0) * 100, 1)} hint="of fully-diluted" icon={ShieldCheck} testid="stat-ownership" />
          <Stat label="Cap-table holders" value={company?.kpi?.capTableHolders ?? 0} hint="fully-diluted" icon={Users} testid="stat-holders" />
          <Stat label="Raised this year" value={fmtUSD(company?.kpi?.raisedThisYearUsd ?? 0, { compact: true })} hint={`of ${fmtUSD(totalTarget, { compact: true })} target`} icon={TrendingUp} trend="up" testid="stat-raised" />
          <Stat label="Dataroom views" value={engagement.data?.topDocs.reduce((s, d) => s + d.totalViews, 0) ?? 0} hint={`${engagement.data?.investors.length ?? 0} unique viewers`} icon={Eye} testid="stat-dataroom" />
        </div>

        {/* Cap-table communication center + M&A inbound */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2" data-testid="card-comms-center">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Cap-table communication center</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Open a thread to your entire cap table or to a single round.</p>
              </div>
              <Button onClick={() => broadcastAll.mutate()} disabled={broadcastAll.isPending} data-testid="button-broadcast-all" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white">
                <MailPlus className="h-4 w-4 mr-2" /> {broadcastAll.isPending ? "Sending…" : "Open thread to entire cap table"}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {companyRounds.length === 0 && <Skeleton className="h-16 w-full" />}
                {companyRounds.map(r => (
                  <Link key={r.id} href={`/founder/rounds/${r.id}`}>
                    <div className="rounded-md border border-border bg-card hover-elevate p-3 cursor-pointer" data-testid={`link-round-thread-${r.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{r.name}</span>
                        <StateBadge state={r.state} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{fmtUSD(r.raisedAmount, { compact: true })} of {fmtUSD(r.targetAmount, { compact: true })} · {r.type}</div>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">MIM signal aggregation: combines soft-circle, dataroom views, and message reactions per round.</div>
            </CardContent>
          </Card>

          <Card data-testid="card-ma-inbound">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4 text-[hsl(333_75%_35%)]" /> M&amp;A intelligence — inbound</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Investor-led initiatives proposed for {company?.companyName ?? "this company"}.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {inbound.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-4 text-center" data-testid="text-ma-empty">
                  No inbound M&amp;A initiatives. When an investor opens one from their portfolio view, it lands here.
                </div>
              ) : (
                inbound.map(m => (
                  <div key={m.id} className="border border-border rounded-md p-3" data-testid={`row-ma-${m.id}`}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-[hsl(333_75%_35%)]/40 text-[hsl(333_75%_35%)]">M&amp;A</Badge>
                      <span className="text-xs text-muted-foreground">from {m.investorUserId}</span>
                    </div>
                    <div className="text-sm font-medium mt-1.5">{m.topic}</div>
                    {m.buyerShortlist && m.buyerShortlist.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">Acquirers: {m.buyerShortlist.join(", ")}</div>
                    )}
                    <div className="flex gap-1 mt-2">
                      <Button size="sm" variant="outline" onClick={() => respondMaMut.mutate(m.id)} disabled={respondMaMut.isPending} data-testid={`button-respond-${m.id}`}>Respond</Button>
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/founder/messages?contactId=${encodeURIComponent(m.investorUserId)}`)} data-testid={`button-discuss-${m.id}`}>Discuss</Button>
                      <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => declineMaMut.mutate(m.id)} disabled={declineMaMut.isPending} data-testid={`button-decline-${m.id}`}>Decline</Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sprint 14 D4 — Transaction-Prep + DSC feedback summary.
             Sprint 18 Phase 2 T2: only render Transaction prep when company has
             at least one M&A signal OR consideringTransaction === true. */}
        {(() => {
          const c: any = company || {};
          const hasMaSignal = !!(c.maSignals && c.maSignals.length > 0) || c.consideringTransaction === true || (c.kpi?.maSignalCount ?? 0) > 0;
          if (!hasMaSignal) {
            return (
              <div className="mb-6">
                <DscSummaryCard companyId={companyId} isDscMember={true} />
              </div>
            );
          }
          return (
            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <TransactionPrepPanel companyId={companyId} founderUserId={"founder"} />
              <DscSummaryCard companyId={companyId} isDscMember={true} />
            </div>
          );
        })()}

        {/* Round-health funnel + active raise summary */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2" data-testid="card-funnel">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Round health funnel</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{activeRound ? `Live for ${activeRound.name}` : "No active round"}</p>
              </div>
              {activeRound && <StateBadge state={activeRound.state} />}
            </CardHeader>
            <CardContent>
              {funnel ? (
                <div className="space-y-2">
                  {funnel.map((f, i) => {
                    const max = funnel[0].count || 1;
                    const w = (f.count / max) * 100;
                    return (
                      <div key={f.key} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-muted-foreground">{f.label}</div>
                        <div className="flex-1 h-7 bg-secondary rounded overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[hsl(184_98%_22%)] to-[hsl(184_98%_30%)] flex items-center px-2 text-xs text-white font-medium"
                            style={{ width: `${Math.max(8, w)}%` }}
                            data-testid={`funnel-bar-${f.key}`}
                          >
                            {f.count}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                    Conversion (invited → funded): <span className="font-medium text-foreground">{fmtPct((funnel[5].count / funnel[0].count) * 100, 0)}</span>
                  </div>
                </div>
              ) : <Skeleton className="h-32 w-full" />}
            </CardContent>
          </Card>

          {/* Report read-rate chip + Dataroom preview */}
          <div className="space-y-6">
            <Card data-testid="card-report-read-rate">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Latest report read-rate</CardTitle></CardHeader>
              <CardContent>
                {readRate ? (
                  <>
                    <div className="text-sm font-medium">{readRate.title}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <Progress value={readRate.pct * 100} className="flex-1 h-2" />
                      <span className="text-xs font-mono">{fmtPct(readRate.pct * 100, 0)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{readRate.opened} of {readRate.sent} opened</div>
                    <Link href="/founder/reports"><Button size="sm" variant="outline" className="w-full mt-3" data-testid="button-view-reports">View reports <ArrowUpRight className="h-3.5 w-3.5 ml-1" /></Button></Link>
                  </>
                ) : <Skeleton className="h-16 w-full" />}
              </CardContent>
            </Card>

            <Card data-testid="card-dataroom-preview">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FolderOpen className="h-3.5 w-3.5" /> Top-viewed docs</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {(engagement.data?.topDocs ?? []).slice(0, 5).map(d => (
                    <li key={d.fileId} className="flex items-center justify-between text-xs" data-testid={`row-doc-${d.fileId}`}>
                      <span className="truncate flex-1">{d.name}</span>
                      <span className="text-muted-foreground tabular-nums ml-2">{d.totalViews} · {d.uniqueViewers}u</span>
                    </li>
                  ))}
                  {(engagement.data?.topDocs ?? []).length === 0 && <li className="text-xs text-muted-foreground">No views yet.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Active raise card */}
        {activeRound && (
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Active raise</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Soft-circle progress for your live round</p>
              </div>
              <StateBadge state={activeRound.state} />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-3">
                <div className="text-2xl font-semibold">{fmtUSD(activeRound.raisedAmount)}</div>
                <div className="text-sm text-muted-foreground">soft-circled of {fmtUSD(activeRound.targetAmount)} target</div>
              </div>
              <div className="h-3 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[hsl(184_98%_22%)] to-[hsl(184_98%_30%)]" style={{ width: `${Math.min(100, (activeRound.raisedAmount / activeRound.targetAmount) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>{fmtPct((activeRound.raisedAmount / activeRound.targetAmount) * 100, 0)} committed</span>
                <span>Close target: {activeRound.closeDate}</span>
              </div>
              <div className="mt-4">
                <Link href={`/founder/rounds/${activeRound.id}`}>
                  <Button variant="outline" data-testid="button-view-round">View round detail <ArrowUpRight className="h-4 w-4 ml-2" /></Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Activity log preview */}
        <Card data-testid="card-activity-preview">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><ActivityIcon className="h-4 w-4" /> Activity log</CardTitle>
            <Link href="/founder/activity"><Button size="sm" variant="ghost" data-testid="button-view-activity">View all <ArrowUpRight className="h-3.5 w-3.5 ml-1" /></Button></Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mx-3">
              {activity.data?.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground" data-testid="activity-empty">
                  No recent activity.{" "}
                  <Link href="/founder/glossary" className="text-[hsl(184_98%_22%)] underline">Browse glossary →</Link>
                </li>
              )}
              {activity.data?.slice(0, 5).map(a => (
                <li key={a.id} className="px-3 py-2.5 flex items-start gap-3 text-sm" data-testid={`row-activity-${a.id}`}>
                  <div className="mt-1 h-1.5 w-1.5 rounded-full bg-[hsl(184_98%_22%)]" />
                  <div className="flex-1 min-w-0">
                    <div><span className="font-medium">{a.actor}</span> <span className="text-muted-foreground">{a.action}</span> <span className="font-medium">{a.target}</span></div>
                    <div className="text-[11px] text-muted-foreground"><Clock className="inline h-3 w-3 mr-1" />{timeAgo(a.ts)}</div>
                  </div>
                </li>
              ))}
              {!activity.data && <Skeleton className="h-16 w-full" />}
            </ul>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
