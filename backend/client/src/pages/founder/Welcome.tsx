/**
 * Sprint 18 Phase 2 — T1.2 Founder Welcome page.
 *
 * Post-signup landing page. Shows 6 priority guidance cards with progress
 * indicators. After acknowledgement, /founder/dashboard becomes the default.
 *
 * SANDBOX-SAFE: ack flag persisted via server (Sprint 17 auth_users.welcome_ack).
 */
import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Building2, Users, PieChart, FileText, Briefcase, Sparkles, ArrowRight, Rocket,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompany } from "@/lib/useActiveCompany";

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

const fields: Array<keyof CompanyProfile> = [
  "name", "legalName", "sector", "hqCountry", "hqCity", "entityType", "description",
];

export default function FounderWelcome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const active = useActiveCompany();
  const me = useQuery<{ id: string; displayName: string; role: string }>({ queryKey: ["/api/auth/me"] });

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

  const firstName = ws.data?.firstName || me.data?.displayName?.split(" ")[0] || "Founder";

  const cards = [
    {
      step: 1,
      title: "Complete company profile",
      description: "Legal entity, jurisdiction, sector, M&A signals.",
      progress: profileCompletion,
      icon: Building2,
      cta: "Open profile",
      href: "/founder/company",
      color: "from-amber-50 to-orange-50",
    },
    {
      step: 2,
      title: "Invite co-founders & team",
      description: "Add team members so they can collaborate on the cap table and rounds.",
      progress: null,
      icon: Users,
      cta: "Manage team",
      href: "/founder/settings",
      color: "from-emerald-50 to-teal-50",
    },
    {
      step: 3,
      title: "Set up your cap table",
      description: "Founder shares, ESOP pool, and any existing instruments. The dual-engine math gate keeps every total reconciled.",
      progress: null,
      icon: PieChart,
      cta: "Open cap table",
      href: "/founder/captable",
      color: "from-sky-50 to-indigo-50",
    },
    {
      step: 4,
      title: "Build your pitch deck",
      description: "Upload deck files and supporting documents in the dataroom — invited investors view via watermarked previews.",
      progress: null,
      icon: FileText,
      cta: "Open dataroom",
      href: "/founder/dataroom",
      color: "from-violet-50 to-purple-50",
    },
    {
      step: 5,
      title: "Plan your first round",
      description: "Choose terms (SAFE, priced, convertible), compose soft-circle book, and run the close in one place.",
      progress: null,
      icon: Briefcase,
      cta: "Plan a round",
      href: "/founder/rounds/new",
      color: "from-rose-50 to-pink-50",
    },
    {
      step: 6,
      title: "Decide on Capavate Collective",
      description: "Apply to present, or have a cap-table investor nominate you. Direct deal flow to accredited members.",
      progress: null,
      icon: Sparkles,
      cta: "Learn more",
      href: "/founder/collective",
      color: "from-cyan-50 to-sky-50",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8" data-testid="page-welcome">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[hsl(184_98%_22%/0.08)] text-[hsl(184_98%_22%)] text-xs font-medium mb-4">
            <Rocket className="h-3.5 w-3.5" />
            Welcome to Capavate
          </div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-welcome-title">
            Welcome back, {firstName}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Capavate runs your equity story end-to-end — from cap-table accuracy to rounds, communications, and (optional) Collective deal flow.
            Six steps to set up your workspace.
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(c => (
          <Card key={c.step} className={`relative overflow-hidden bg-gradient-to-br ${c.color} border-black/5`} data-testid={`card-welcome-${c.step}`}>
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-md bg-white/80 flex items-center justify-center text-[hsl(184_98%_22%)]">
                  <c.icon className="h-5 w-5" />
                </div>
                <Badge variant="secondary" className="bg-white/70 text-foreground/70">Step {c.step}</Badge>
              </div>
              <CardTitle className="text-base font-semibold">{c.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{c.description}</p>
              {c.progress !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Profile completion</span>
                    <span className="font-medium tabular-nums">{c.progress}%</span>
                  </div>
                  <Progress value={c.progress} className="h-1.5" />
                </div>
              )}
              <Link href={c.href}>
                <Button size="sm" variant="ghost" className="-ml-2 mt-1 text-[hsl(184_98%_22%)]" data-testid={`button-cta-${c.step}`}>
                  {c.cta}
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-black/5">
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
