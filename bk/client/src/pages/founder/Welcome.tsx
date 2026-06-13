/**
 * Sprint 18 Phase 2 — T1.2 Founder Welcome page.
 * Wave G Track 2 — G3: bento-grid redesign.
 *
 * Post-signup landing page. Previously a flat 3-column card grid; now a
 * varied bento layout that communicates hierarchy:
 *   - Large hero tile (col-span-4)         — "Welcome back, {firstName}"
 *   - 4 KPI tiles                          — companies, rounds, committed, investors
 *   - Medium "Onboarding checklist" tile   — col-span-2 row-span-2 (5 steps + progress)
 *   - Medium "Recent activity" tile        — col-span-2 row-span-1
 *   - Small "Quick actions" tile           — col-span-1
 *   - Small "Tips" carousel tile           — col-span-1 (cycles every 8s)
 *
 * SANDBOX-SAFE: ack flag persisted via server (Sprint 17 auth_users.welcome_ack).
 * Wave G2.G3: micro-interactions wired (HOVER_LIFT on tiles).
 */
import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Building2, Users, PieChart, FileText, Briefcase, Sparkles,
  ArrowRight, Rocket, Activity as ActivityIcon, Clock, Lightbulb, Send, Plus, Upload,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompany } from "@/lib/useActiveCompany";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { HOVER_LIFT } from "@/lib/microInteractions";

type CompanyProfile = {
  name?: string;
  legalName?: string;
  sector?: string;
  hqCountry?: string;
  hqCity?: string;
  registrationNumber?: string;
  entityType?: string;
  publicExchange?: boolean;
  description?: string;
};

type WelcomeState = { welcomeAck: boolean; firstName: string };

type ActivityRow = { id: string; ts: string; actor?: string; action?: string; target?: string };

const fields: Array<keyof CompanyProfile> = [
  "name", "legalName", "sector", "hqCountry", "hqCity", "entityType", "description",
];

const TIPS: { icon: typeof Sparkles; title: string; body: string }[] = [
  { icon: Sparkles, title: "Dual-engine math gate",   body: "Every cap-table commit is independently verified by two engines — your totals always reconcile." },
  { icon: Briefcase, title: "Soft-circle first",       body: "Investors can soft-circle before legal — fewer surprises at the close." },
  { icon: FileText, title: "Watermarked previews",     body: "Dataroom files are watermarked per-viewer. No raw downloads unless you explicitly allow them." },
  { icon: Users,    title: "Cap-table communication",  body: "Open a thread to your entire cap table from the dashboard — one click." },
];

export default function FounderWelcome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const active = useActiveCompany();
  // Wave B FIX 5 (F-BUG-008) — /api/auth/me returns a UserContext whose name
  // lives on `identity.name`, NOT `displayName`. The previous typing made
  // `me.data?.displayName` always undefined, so the welcome heading fell
  // back to a literal "Founder".
  const me = useQuery<{ id: string; identity?: { name?: string }; displayName?: string; role: string }>({ queryKey: ["/api/auth/me"] });

  const ws = useQuery<WelcomeState>({
    queryKey: ["/api/founder/welcome"],
    queryFn: async () => (await apiRequest("GET", "/api/founder/welcome")).json(),
  });

  const _profileId = active.data?.activeCompanyId;
  const profile = useQuery<CompanyProfile>({
    queryKey: ["/api/companies", _profileId, "profile"],
    queryFn: async () => {
      if (!_profileId) return {};
      const res = await apiRequest("GET", `/api/companies/${_profileId}/profile`);
      return res.json();
    },
    enabled: !!_profileId,
  });

  // Lightweight activity feed for the bento. Returns [] when not available.
  const activity = useQuery<ActivityRow[]>({
    queryKey: ["/api/founder/activity-log"],
    queryFn: async () => {
      try {
        const r = await apiRequest("GET", "/api/founder/activity-log");
        const j = await r.json();
        return Array.isArray(j) ? j : (j?.rows ?? []);
      } catch { return []; }
    },
    retry: false,
  });

  const ackMut = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/founder/welcome/ack", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/welcome"] });
      toast({ title: "Welcome dismissed", description: "Your dashboard is now the default landing page." });
      navigate("/founder/dashboard");
    },
  });

  const profileCompletion = useMemo(() => {
    const data = profile.data || {};
    const filled = fields.filter(f => data[f]).length;
    return Math.round((filled / fields.length) * 100);
  }, [profile.data]);

  const fullNameFromMe = me.data?.identity?.name || me.data?.displayName || "";
  const firstName = ws.data?.firstName || fullNameFromMe.split(" ")[0] || "Founder";

  // Steps powering the onboarding checklist tile.
  const steps = [
    { step: 1, title: "Complete company profile", icon: Building2, href: "/founder/company",      progress: profileCompletion, done: profileCompletion >= 80 },
    { step: 2, title: "Invite co-founders & team", icon: Users,    href: "/founder/settings",     progress: null, done: false },
    { step: 3, title: "Set up your cap table",     icon: PieChart, href: "/founder/captable",     progress: null, done: false },
    { step: 4, title: "Build your pitch deck",     icon: FileText, href: "/founder/dataroom",     progress: null, done: false },
    { step: 5, title: "Plan your first round",     icon: Briefcase,href: "/founder/rounds/new",   progress: null, done: false },
  ];
  const completedSteps = steps.filter(s => s.done).length;
  const overallProgress = Math.round((completedSteps / steps.length) * 100);

  /* v25.11 NL-1 — the previous KPI values were hardcoded literal zeros for
   * every founder. Wire them to real data:
   *   - rounds: GET /api/rounds (already on the page-shape; count rounds for
   *     this company that aren't yet `closed`)
   *   - committed: sum of `raisedAmount` across this company's rounds
   *   - invited: cap-table reach — count distinct invitees across rounds via
   *     /api/founder/investor-crm (proxy for reach).
   * All queries gate on a real companyId so a fresh signup still sees zeros
   * naturally without showing fake activity. */
  const companyId = active.data?.activeCompanyId ?? "";
  type _Round = { id: string; companyId: string; state: string; raisedAmount: number };
  const roundsForKpiQ = useQuery<_Round[]>({
    queryKey: ["/api/rounds", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/rounds?companyId=${encodeURIComponent(companyId)}`)).json(),
    enabled: Boolean(companyId),
  });
  type _CrmContact = { id: string };
  const crmCountQ = useQuery<_CrmContact[]>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${encodeURIComponent(companyId)}`)).json(),
    enabled: Boolean(companyId),
  });
  const _roundsArr: _Round[] = Array.isArray(roundsForKpiQ.data) ? roundsForKpiQ.data : [];
  const _activeRoundsCount = _roundsArr.filter(r => r.state !== "closed").length;
  const _committedSum = _roundsArr.reduce((s, r) => s + (Number(r.raisedAmount) || 0), 0);
  const _committedDisplay = _committedSum > 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(_committedSum)
    : "$0";
  const _crmCount = Array.isArray(crmCountQ.data) ? crmCountQ.data.length : 0;
  const kpis = [
    { key: "companies", label: "Companies",        value: active.data?.activeCompanyId ? 1 : 0, icon: Building2, hint: "in your workspace" },
    { key: "rounds",    label: "Rounds in progress", value: _activeRoundsCount,                 icon: Briefcase, hint: "live or planned" },
    { key: "committed", label: "Total committed",   value: _committedDisplay,                   icon: PieChart,  hint: "soft + signed" },
    { key: "invited",   label: "Investors invited", value: _crmCount,                           icon: Users,     hint: "cap-table reach" },
  ];

  // Tips carousel — cycles every 8s, respects reduced-motion (no auto-rotate then).
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduce) return;
    const t = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 8000);
    return () => clearInterval(t);
  }, []);
  const tip = TIPS[tipIdx];
  const TipIcon = tip.icon;

  // Wave E Fix E10 — page-level loading + error states.
  if (me.isLoading && !me.data) {
    return <PageSkeleton label="Loading welcome page" data-testid="page-welcome-loading" />;
  }
  if (me.isError && !me.data) {
    return (
      <ErrorState
        title="Couldn't load your workspace"
        description="We couldn't fetch your account info. Please try again."
        onRetry={() => me.refetch()}
        error={me.error as Error | undefined}
        data-testid="page-welcome-error"
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10" data-testid="page-welcome">
      {/* Wave G Track 2 — G3: bento grid.
          4-column on lg, 2-column on md, 1-column on sm.
          Each tile is a Card with HOVER_LIFT micro-interaction. */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[minmax(120px,auto)]"
        data-testid="bento-grid-welcome"
      >
        {/* 1) HERO TILE — col-span-4 row-span-1 (always full-width) */}
        <Card
          className={`col-span-1 md:col-span-2 lg:col-span-4 bg-gradient-to-br from-[hsl(184_98%_22%/0.06)] to-[hsl(184_98%_22%/0.02)] border-[hsl(184_98%_22%/0.15)]`}
          data-testid="bento-tile-hero"
        >
          <CardContent className="p-6 sm:p-8 flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[hsl(184_98%_22%/0.08)] text-[hsl(184_98%_22%)] text-xs font-medium mb-4">
                <Rocket className="h-3.5 w-3.5" />
                Welcome to Capavate
              </div>
              <h1
                className="text-3xl font-semibold tracking-tight"
                data-testid="text-welcome-title"
              >
                Welcome back, {firstName}. Here's where you are.
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl">
                Capavate runs your equity story end-to-end — from cap-table accuracy to rounds,
                communications, and (optional) Collective deal flow.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => ackMut.mutate()}
              disabled={ackMut.isPending}
              data-testid="button-skip-welcome"
            >
              Skip and go to dashboard
            </Button>
          </CardContent>
        </Card>

        {/* 2-5) KPI TILES — col-span-1 each */}
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <Card
              key={k.key}
              interactive
              className={`col-span-1 ${HOVER_LIFT}`}
              data-testid={`bento-tile-kpi-${k.key}`}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
                  <Icon className="h-4 w-4 text-[hsl(184_98%_22%)]" />
                </div>
                <div className="text-2xl font-semibold tracking-tight mt-2 tabular-nums">{k.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{k.hint}</div>
              </CardContent>
            </Card>
          );
        })}

        {/* 6) ONBOARDING CHECKLIST — medium, col-span-2 row-span-2 */}
        <Card
          interactive
          className={`col-span-1 md:col-span-2 lg:col-span-2 row-span-2 ${HOVER_LIFT}`}
          data-testid="bento-tile-checklist"
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Onboarding checklist</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {completedSteps}/{steps.length} complete
              </Badge>
            </div>
            <Progress value={overallProgress} className="h-1.5 mt-3" />
          </CardHeader>
          <CardContent className="space-y-2">
            {steps.map(s => {
              const Icon = s.icon;
              return (
                <Link key={s.step} href={s.href}>
                  <div
                    className="flex items-center gap-3 rounded-md border border-border/60 p-3 hover:bg-secondary/40 cursor-pointer transition-colors"
                    data-testid={`card-welcome-${s.step}`}
                  >
                    <div className="h-8 w-8 rounded-md bg-[hsl(184_98%_22%/0.08)] flex items-center justify-center text-[hsl(184_98%_22%)] shrink-0">
                      {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      {s.progress !== null && (
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={s.progress} className="h-1 flex-1" />
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{s.progress}%</span>
                        </div>
                      )}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        {/* 7) RECENT ACTIVITY — col-span-2 row-span-1 */}
        <Card
          interactive
          className={`col-span-1 md:col-span-2 lg:col-span-2 ${HOVER_LIFT}`}
          data-testid="bento-tile-activity"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ActivityIcon className="h-4 w-4" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(activity.data ?? []).slice(0, 5).map(a => (
                <li key={a.id} className="flex items-start gap-2 text-sm" data-testid={`activity-${a.id}`}>
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(184_98%_22%)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{a.actor ?? "—"}</span>
                    <span className="text-muted-foreground"> {a.action ?? ""} </span>
                    <span className="font-medium">{a.target ?? ""}</span>
                    <div className="text-[11px] text-muted-foreground"><Clock className="inline h-3 w-3 mr-1" />{a.ts}</div>
                  </div>
                </li>
              ))}
              {(activity.data?.length ?? 0) === 0 && (
                <li className="text-sm text-muted-foreground py-2">No recent activity yet — your audit log will populate as you take actions.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        {/* 8) QUICK ACTIONS — small, col-span-1 */}
        <Card
          interactive
          className={`col-span-1 ${HOVER_LIFT}`}
          data-testid="bento-tile-quick-actions"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/founder/rounds/new">
              <Button size="sm" variant="outline" className="w-full justify-start" data-testid="quick-create-round">
                <Plus className="h-3.5 w-3.5 mr-2" /> Create round
              </Button>
            </Link>
            <Link href="/founder/crm">
              <Button size="sm" variant="outline" className="w-full justify-start" data-testid="quick-invite-investor">
                <Send className="h-3.5 w-3.5 mr-2" /> Invite investor
              </Button>
            </Link>
            <Link href="/founder/dataroom">
              <Button size="sm" variant="outline" className="w-full justify-start" data-testid="quick-upload-doc">
                <Upload className="h-3.5 w-3.5 mr-2" /> Upload document
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* 9) TIPS — small, col-span-1, cycles every 8s */}
        <Card
          interactive
          className={`col-span-1 ${HOVER_LIFT}`}
          data-testid="bento-tile-tips"
          aria-live="polite"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Tip
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-md bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                <TipIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{tip.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{tip.body}</div>
              </div>
            </div>
            <div className="flex gap-1 mt-3" aria-hidden="true">
              {TIPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i === tipIdx ? "bg-[hsl(184_98%_22%)]" : "bg-muted"}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CTA strip preserved — kept below the bento for the existing acknowledge flow. */}
      <Card className="mt-8 border-black/5">
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <div className="font-medium">Ready to dive in?</div>
              <div className="text-xs text-muted-foreground">After dismissal, your dashboard becomes the default landing page.</div>
            </div>
          </div>
          <Button
            onClick={() => ackMut.mutate()}
            disabled={ackMut.isPending}
            data-testid="button-ack-welcome"
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)]"
          >
            {ackMut.isPending ? "Saving…" : "Got it — go to dashboard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
