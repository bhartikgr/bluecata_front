/**
 * Sprint 10 — Apply to Capavate Collective (7-step wizard).
 *
 *   Step 1  Eligibility check
 *   Step 2  Investor profile (thesis, check size, sectors×45, stages, geo×9, tier, referral)
 *   Step 3  Identity & KYC docs (passport, proof of address, additional)
 *   Step 4  Accreditation declaration (jurisdiction-specific)
 *   Step 5  Payment (mock Stripe — explicit "demo only" notice)
 *   Step 6  Review & confirm
 *   Step 7  Success — what happens next
 *
 * Sprint 21 Wave G — merged Capavate Collective marketing section (hero, eligibility checks,
 * "What's waiting for you" panel) into the TOP of this page. Old /investor/collective
 * redirects here. Sidebar entry removed. Active-member banner shown instead of wizard
 * when collectiveStatus === "active".
 *
 * Validates each step locally with `collectiveApplicationSchema` partials and
 * submits the full payload to POST /api/collective/applications. Telemetry
 * `collective_application_submitted` is emitted server-side.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CheckCircle2, Circle, Lock, Sparkles, ChevronLeft, ChevronRight, ShieldCheck,
  CreditCard, FileCheck, Globe, Briefcase, Upload, AlertTriangle, X,
  Users, Network, Vote, Check, ChevronDown, ChevronUp, ArrowUpRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

import { PageBody, PageHeader } from "@/components/AppShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtUSD } from "@/lib/format";
import { useEntitlement } from "@/lib/entitlement";

import {
  COLLECTIVE_SECTORS_45,
  COLLECTIVE_REGIONS_9,
  COLLECTIVE_STAGES,
  ACCREDITATION_JURISDICTIONS,
  collectiveApplicationSchema,
  type CollectiveApplication,
  type AccreditationJurisdiction,
} from "@shared/schema";

/* ---------------------------------------------------------------- */
/* Eligibility                                                      */
/* ---------------------------------------------------------------- */

type Eligibility = {
  eligible: boolean;
  reasons: string[];
  passes: {
    investorOnCapTable: boolean;
    founderOfCompany: boolean;
    signatoryOnCompany: boolean;
    vouchedByPartner: boolean;
  };
};

/**
 * v25.21 Lane C NH-3 fix — the hardcoded `price: 1_000 / 5_000 / 15_000 /
 * 50_000` numbers below were MOCK DATA: the live billing system
 * (`server/lib/stripeCollective.ts COLLECTIVE_TIER_CATALOG`) uses a
 * different tier vocabulary entirely (`basic / standard / premium`) and
 * env-driven prices. The application form's labels/perks are kept for
 * preference capture but ALL pricing is now sourced from the live
 * `/api/collective/membership/tiers` endpoint at apply time (see
 * `liveTiersQ` below) so the figure shown at "Annual fee" matches what the
 * member will actually be billed. The application's memberTier enum stays
 * bronze/silver/gold/platinum to preserve schema/admin compatibility; the
 * server-side billing tier is selected separately by the admin during
 * review (see admin tier mapping doc).
 */
const TIER_LABEL: Record<"bronze" | "silver" | "gold" | "platinum", { label: string; perks: string[] }> = {
  bronze:   { label: "Bronze",   perks: ["Quarterly deal flow", "Discord community", "Newsletter"] },
  silver:   { label: "Silver",   perks: ["Monthly curated deals", "Co-investor matching", "Office hours"] },
  gold:     { label: "Gold",     perks: ["Weekly invites", "Term sheet review", "Founder intros"] },
  platinum: { label: "Platinum", perks: ["Daily flow", "Lead-investor priority", "Concierge LP intros"] },
};

// Sprint 20 Wave 2 — extended jurisdiction text (AU, IN, JP added)
const JURISDICTION_TEXT_EXTRA: Record<string, string> = {
  AU: "I am a sophisticated or professional investor under the Australian Corporations Act 2001 s761G — I hold an ASIC class order certificate or meet the net assets / gross income thresholds.",
  IN: "I am a qualified institutional buyer or high-net-worth individual under SEBI regulations — I meet the minimum net tangible assets or income thresholds under Regulation 2.",
  JP: "I am a professional investor under the Financial Instruments and Exchange Act (FIEA) Article 2(31) — I meet the specified asset/experience criteria.",
};

const JURISDICTION_TEXT: Record<string, string> = {
  US: "I qualify as an accredited investor under SEC Rule 501(a) — I have either a net worth ≥ $1M (excluding primary residence) or income ≥ $200K (single) / $300K (joint) for the past two years.",
  CA: "I qualify as an accredited investor under NI 45-106 — I have either net financial assets ≥ $1M, net assets ≥ $5M, or income ≥ $200K (single) / $300K (joint) for the past two years.",
  UK: "I am a high-net-worth or sophisticated investor under FCA COBS 4.12 — I meet the income, net asset, or self-certification thresholds.",
  EU: "I am a professional client under MiFID II — I meet two of the three quantitative criteria (transaction frequency, portfolio size, professional experience).",
  SG: "I am an accredited investor under MAS Securities and Futures Act §4A — I have either S$2M net assets, S$300K income, or S$1M financial assets.",
  HK: "I am a professional investor under SFC Securities and Futures Ordinance Schedule 1 — I have a portfolio ≥ HK$8M.",
  ...JURISDICTION_TEXT_EXTRA,
};

const STEPS = [
  { n: 1, t: "Eligibility",        icon: ShieldCheck },
  { n: 2, t: "Investor profile",   icon: Briefcase },
  { n: 3, t: "Identity & KYC",     icon: FileCheck },
  { n: 4, t: "Accreditation",      icon: Globe },
  { n: 5, t: "Payment",            icon: CreditCard },
  { n: 6, t: "Review",             icon: CheckCircle2 },
  { n: 7, t: "Submitted",          icon: Sparkles },
];

/* ---------------------------------------------------------------- */
/* Collective types (merged from Collective.tsx)                    */
/* ---------------------------------------------------------------- */

type CollectiveNetwork = {
  activeDeals: Array<{ id: string; label: string; daysLeft: number; type: string }>;
  eligibilityChecks: Array<{ label: string; ok: boolean }>;
};

/* ---------------------------------------------------------------- */
/* Page                                                             */
/* ---------------------------------------------------------------- */

export default function ApplyToCollective() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<number>(1);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Sprint 21 Wave G — merged Collective marketing state
  const [insideOpen, setInsideOpen] = useState(false);
  const { data: ctx } = useEntitlement();
  const collective = useQuery<CollectiveNetwork>({
    queryKey: ["/api/collective/network"],
  });

  // Sprint 20 Wave 2 — active member redirect (defect 44)
  // Sprint 21 Wave G — redirect target updated: no longer /investor/collective
  // (that route now redirects here). Active member sees banner, not wizard.
  const elig = useQuery<{ eligible: boolean; passes: Record<string, boolean>; reasons: string[]; collectiveStatus?: string }>({
    queryKey: ["/api/collective/eligibility"],
  });

  // Sprint 21 Wave G — active member: show banner instead of redirecting away.
  // (Old redirect to /investor/collective is removed — that page redirects back here.)
  const isActiveMember = elig.data?.collectiveStatus === "active";

  // C-014 v23.5: fetch investor's own application status for status banner
  const mineQ = useQuery<{ application: { status: string; submittedAt: string; reviewedAt?: string } } | null>({
    queryKey: ["/api/collective/applications/mine"],
    queryFn: async () => {
      // v25.10 M6 — include cookies for Safari + cross-origin compatibility.
      const res = await fetch("/api/collective/applications/mine", { credentials: "include" });
      if (res.status === 404) return null;
      return res.json();
    },
    retry: false,
  });
  const mineApp = (mineQ.data as any)?.application ?? null;

  // v23.8 C4/W-15 — during invite-only beta the rest of the Collective is
  // gated off and signups land on the WAITLIST store instead of the
  // applications store. Surface the requester's own waitlist status so they
  // are not left wondering whether their signup was received.
  const waitlistMineQ = useQuery<{ items: Array<{ id: string; kind: string; status: string; createdAt: string }>; count: number }>({
    queryKey: ["/api/collective/waitlist/mine"],
    queryFn: async () => {
      // v25.10 M6 — include cookies for Safari + cross-origin compatibility.
      const res = await fetch("/api/collective/waitlist/mine", { credentials: "include" });
      if (!res.ok) return { items: [], count: 0 };
      return res.json();
    },
    retry: false,
  });
  const myWaitlist = waitlistMineQ.data?.items ?? [];
  const latestWaitlist = myWaitlist.length
    ? [...myWaitlist].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    : null;

  const [form, setForm] = useState<CollectiveApplication>({
    thesis: "",
    minCheckUsd: 25_000,
    maxCheckUsd: 250_000,
    sectors: [],
    stages: [],
    geoFocus: [],
    memberTier: "silver",
    referralCode: "",
    passportFilename: "",
    proofOfAddressFilename: "",
    additionalDocs: [],
    jurisdiction: "US",
    accreditationDeclaration: "",
    paymentMethod: "card_mock",
    cardholderName: "",
  });

  // elig is declared above (Sprint 20 Wave 2 active member redirect)
  const submit = useMutation({
    mutationFn: async (payload: CollectiveApplication) => {
      const res = await apiRequest("POST", "/api/collective/applications", payload);
      return res.json();
    },
    onSuccess: (d) => {
      // v25.13 NM5 — invalidate the "my applications" and eligibility
      // queries so re-navigation to this page reads the fresh state and
      // doesn't allow a duplicate submission.
      queryClient.invalidateQueries({ queryKey: ["/api/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/eligibility"] });
      setSubmittedId(d.application.id);
      setStep(7);
      toast({ title: "Application submitted", description: "We'll review and respond within 5 business days." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Could not submit", description: "Please try again. If this continues, contact support." }),
  });

  /* ---- step validation ---- */
  function stepOk(s: number): boolean {
    if (s === 1) return Boolean(elig.data?.eligible);
    if (s === 2) {
      return form.thesis.trim().length >= 20
        && form.minCheckUsd >= 5_000
        && form.maxCheckUsd >= form.minCheckUsd
        && form.sectors.length >= 1
        && form.stages.length >= 1
        && form.geoFocus.length >= 1;
    }
    if (s === 3) return form.passportFilename.length > 0 && form.proofOfAddressFilename.length > 0;
    if (s === 4) return form.accreditationDeclaration.length > 0;
    if (s === 5) return form.paymentMethod === "invoice" || (form.paymentMethod === "card_mock" && (form.cardholderName ?? "").length >= 2);
    if (s === 6) return collectiveApplicationSchema.safeParse(form).success;
    return true;
  }

  function next() {
    if (!stepOk(step)) {
      toast({ variant: "destructive", title: "Please complete this step", description: "Required fields are missing or invalid." });
      return;
    }
    if (step === 6) {
      submit.mutate(form);
      return;
    }
    setStep((s) => Math.min(7, s + 1));
  }

  // v23.8 W-12: eligibility checks reflect REAL user state only. Previously a
  // null `ctx` fell back to an all-green hardcoded list, misrepresenting an
  // unverified investor as fully accredited/KYC'd. Now we read the actual
  // checks from GET /api/collective/eligibility (`passes`), falling back to
  // the live UserContext, and default to NOT-passed (never green) when neither
  // source has loaded.
  //
  // v25.21 Lane C NH-2 fix — the previous code read `passes.accreditation /
  // kyc / profile / primaryInvestment / riskAck`, but the server returns
  // `passes.investorOnCapTable / founderOfCompany / signatoryOnCompany /
  // vouchedByPartner`. Total key mismatch — every check silently fell back
  // to UserContext, so the eligibility checklist shown to the user was
  // fabricated client-side, not server-derived. We now use the real server
  // keys and label each check accurately.
  const passes = elig.data?.passes ?? {};
  const eligChecks = [
    {
      label: "Investor on a Capavate cap table",
      ok: Boolean(passes.investorOnCapTable),
    },
    {
      label: "Founder of a Capavate company",
      ok: Boolean(passes.founderOfCompany),
    },
    {
      label: "Authorised signatory on a Capavate company",
      ok: Boolean(passes.signatoryOnCompany),
    },
    {
      label: "Vouched by a consortium partner",
      ok: Boolean(passes.vouchedByPartner),
    },
  ];

  // v23.8 W-12: only real deals from /api/collective/network. No hardcoded
  // "DSC-08 Helia AI / SPV-14 Tideline Pay / CHTR" placeholders — those were
  // shown to every investor regardless of state (material misrepresentation).
  const activeDeals = collective.data?.activeDeals ?? [];

  return (
    <>
      <PageHeader
        title="Apply to Capavate Collective"
        description="Curated deal flow, peer co-investors, term-sheet support."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Apply to Collective" }]}
      />
      <PageBody>
        {/* C-014 v23.5 — investor application status banner */}
        {mineApp && !isActiveMember && (
          <div
            className={`rounded-md border p-4 mb-5 flex items-start gap-3 text-sm ${mineApp.status === "accepted" ? "border-emerald-200 bg-emerald-50" : mineApp.status === "rejected" ? "border-rose-200 bg-rose-50" : "border-blue-200 bg-blue-50"}`}
            data-testid="banner-investor-application-status"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              {mineApp.status === "submitted" && <><strong>Application submitted</strong> on {new Date(mineApp.submittedAt).toLocaleDateString()} — under review.</>}
              {mineApp.status === "reviewing" && <><strong>Under review</strong> since {new Date(mineApp.submittedAt).toLocaleDateString()}.</>}
              {mineApp.status === "accepted" && <><strong className="text-emerald-800">Accepted</strong> on {mineApp.reviewedAt ? new Date(mineApp.reviewedAt).toLocaleDateString() : "—"} — your membership is being activated.</>}
              {mineApp.status === "rejected" && <><strong className="text-rose-800">Not selected this cycle.</strong></>}
              {mineApp.status === "waitlisted" && <><strong>Waitlisted</strong> — we’ll notify you when a spot opens.</>}
            </div>
          </div>
        )}

        {/* v23.8 C4/W-15 — waitlist status banner (invite-only beta path) */}
        {latestWaitlist && !mineApp && !isActiveMember && (
          <div
            className={`rounded-md border p-4 mb-5 flex items-start gap-3 text-sm ${latestWaitlist.status === "accepted" ? "border-emerald-200 bg-emerald-50" : latestWaitlist.status === "declined" ? "border-rose-200 bg-rose-50" : "border-blue-200 bg-blue-50"}`}
            data-testid="banner-investor-waitlist-status"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              {latestWaitlist.status === "waitlist" && <><strong>You're on the waitlist</strong> — joined {new Date(latestWaitlist.createdAt).toLocaleDateString()}. We'll be in touch as we open chapter access.</>}
              {latestWaitlist.status === "accepted" && <><strong className="text-emerald-800">Accepted from the waitlist</strong> — your membership is being activated.</>}
              {latestWaitlist.status === "declined" && <><strong className="text-rose-800">Not selected this cycle.</strong></>}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Sprint 21 Wave G — active member banner                         */}
        {/* ---------------------------------------------------------------- */}
        {isActiveMember && (
          <div
            className="flex items-center justify-between gap-4 p-4 mb-6 rounded-lg bg-emerald-50 border border-emerald-200"
            data-testid="banner-active-member"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <div className="font-semibold text-emerald-800 text-sm">You're an active Collective member</div>
                <div className="text-xs text-emerald-700 mt-0.5">
                  Your membership is confirmed. Access the full Collective experience at capavate.com.
                </div>
              </div>
            </div>
            <Button
              onClick={() => window.open("https://capavate.com/collective/", "_blank")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4 shrink-0"
              data-testid="button-open-collective-member"
            >
              Open the Collective <ArrowUpRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Sprint 21 Wave G — merged Collective hero section (top)         */}
        {/* ---------------------------------------------------------------- */}
        <Card className="overflow-hidden mb-6">
          <div className="bg-gradient-to-br from-[hsl(219_45%_20%)] via-[hsl(219_45%_18%)] to-[hsl(333_75%_35%)] text-white p-8">
            <Badge className="bg-white/20 text-white border-0 mb-3">Collective · Investor</Badge>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight max-w-2xl">
              You're eligible to join Capavate Collective.
            </h2>
            <p className="text-white/85 mt-3 max-w-2xl">
              Collective gives accredited investors access to <strong>SPV co-investments, DSC voting on
              high-conviction rounds, M&amp;A deal flow, monthly chapter meetings, and a private founder-investor
              feed</strong>. Built and live at{" "}
              <code className="bg-white/15 px-1.5 py-0.5 rounded text-sm">capavate.com/collective</code>.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              {/* Sprint 20 Wave 2 — real URL, not toast (defect 39) */}
              <Button
                onClick={() => window.open("https://capavate.com/collective/", "_blank")}
                className="bg-white text-[hsl(219_45%_20%)] hover:bg-white/90 h-11 px-6"
                data-testid="button-join-collective"
              >
                Open the Collective <ArrowUpRight className="h-4 w-4 ml-2" />
              </Button>
              {/* Sprint 20 Wave 2 — What's inside accordion toggle (defect 40) */}
              <Button
                variant="outline"
                className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white h-11 px-6"
                data-testid="button-learn-more"
                onClick={() => setInsideOpen((v) => !v)}
              >
                What's inside? {insideOpen ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
              </Button>
            </div>
            {/* Accordion panel */}
            {insideOpen && (
              <div className="mt-4 bg-white/10 rounded-lg p-4 text-sm text-white/90 space-y-2" data-testid="panel-whats-inside">
                <div className="font-semibold mb-2">What Collective members get access to:</div>
                <ul className="space-y-1.5">
                  <li>• <strong>SPV co-investments</strong> — stack alongside chapter syndicates</li>
                  <li>• <strong>DSC voting</strong> — distributed single-check screening rooms</li>
                  <li>• <strong>M&amp;A deal flow</strong> — curated acquisition intelligence</li>
                  <li>• <strong>Chapter meetings</strong> — 14 cities, monthly deal reviews</li>
                  <li>• <strong>Founder-investor feed</strong> — private Collective-exclusive posts</li>
                </ul>
              </div>
            )}
          </div>

          <CardContent className="p-6 grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Sparkles,
                title: "DSC screening rooms",
                desc: "Vote with the Distributed Single-Check vehicle on rounds the chapter is anchoring.",
              },
              {
                icon: Network,
                title: "SPVs & co-invest",
                desc: "Stack alongside chapter syndicates with low-friction Capavate-managed SPV vehicles.",
              },
              {
                icon: Users,
                title: "Chapters & meetings",
                desc: "14 cities, monthly deal reviews, founder office hours, peer LP roundtables.",
              },
            ].map((f, i) => (
              <div key={i} className="flex gap-3">
                <f.icon className="h-5 w-5 text-[hsl(var(--highlight))] mt-0.5" />
                <div>
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{f.desc}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Eligibility checks + What's waiting for you */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[hsl(var(--success))]" /> Eligibility checks
              </h3>
              {/* Sprint 20 Wave 2 — derived from live useEntitlement (defect 41) */}
              <ul className="space-y-2 text-sm">
                {eligChecks.map((ch) => (
                  <li key={ch.label} className="flex items-center gap-2">
                    <Check className={`h-4 w-4 ${ch.ok ? "text-[hsl(var(--success))]" : "text-muted-foreground"}`} />
                    <span className={ch.ok ? "" : "text-muted-foreground"}>{ch.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Vote className="h-4 w-4 text-[hsl(var(--highlight))]" /> What's waiting for you
              </h3>
              {/* Sprint 20 Wave 2 — live data from /api/collective/network (defect 42) */}
              {/* v23.8 W-12 — real deals only; clean empty/gated state otherwise. */}
              {activeDeals.length > 0 ? (
                <ul className="space-y-3 text-sm">
                  {activeDeals.map((deal) => (
                    <li key={deal.id} className="flex items-start gap-2" data-testid={`deal-${deal.id}`}>
                      <span className="text-xs font-mono mt-0.5 text-muted-foreground w-12 shrink-0">{deal.type}</span>
                      <span className="flex-1">{deal.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="deals-empty-state">
                  Apply and get accepted to see active deals, co-invest SPVs, and chapter events curated for you.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground text-center mb-6">
          Capavate Collective is a separate eligibility-gated experience — features above live at{" "}
          <code>capavate.com/collective</code>, not in the Capavate workspace.
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Divider                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-4 text-muted-foreground tracking-wider">
              Complete your application below
            </span>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Wizard (only shown when NOT an active member)                   */}
        {/* ---------------------------------------------------------------- */}
        {!isActiveMember && (
          <div className="max-w-4xl mx-auto">
            <Stepper step={step} />

            <div className="mt-6">
              {step === 1 && <Step1Eligibility eligibility={elig.data as Eligibility | undefined} loading={elig.isLoading} />}
              {step === 2 && <Step2Profile form={form} setForm={setForm} />}
              {step === 3 && <Step3Identity form={form} setForm={setForm} />}
              {step === 4 && <Step4Accreditation form={form} setForm={setForm} />}
              {step === 5 && <Step5Payment form={form} setForm={setForm} />}
              {step === 6 && <Step6Review form={form} />}
              {step === 7 && <Step7Success applicationId={submittedId} navigate={navigate} />}
            </div>

            {step < 7 && (
              <div className="flex items-center justify-between mt-6">
                <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1} data-testid="button-back">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={next}
                  disabled={!stepOk(step) || submit.isPending}
                  className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)]"
                  data-testid="button-next"
                >
                  {step === 6 ? (submit.isPending ? "Submitting…" : "Submit application") : "Continue"} <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Active member: show a prompt to scroll up or open the Collective */}
        {isActiveMember && (
          <div className="max-w-4xl mx-auto">
            <Card>
              <CardContent className="pt-12 pb-12 text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xl font-semibold">You're already a Collective member</div>
                  <div className="text-sm text-muted-foreground mt-1">No application needed — your membership is active.</div>
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  <Button
                    onClick={() => window.open("https://capavate.com/collective/", "_blank")}
                    className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)]"
                    data-testid="button-go-collective-home"
                  >
                    Open the Collective <ArrowUpRight className="h-4 w-4 ml-1.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Stepper                                                          */
/* ---------------------------------------------------------------- */

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${
                  done ? "bg-emerald-600 text-white" :
                  active ? "bg-[hsl(0_100%_40%)] text-white" :
                  "bg-slate-100 text-slate-500"
                }`}
                data-testid={`step-${s.n}`}
              >
                {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] uppercase tracking-wider ${active ? "text-[hsl(0_100%_40%)] font-semibold" : "text-muted-foreground"} hidden md:block`}>
                {s.t}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${done ? "bg-emerald-600" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Step 1                                                           */
/* ---------------------------------------------------------------- */

function Step1Eligibility({ eligibility, loading }: { eligibility?: Eligibility; loading: boolean }) {
  if (loading) return <Card><CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">Checking eligibility…</CardContent></Card>;
  if (!eligibility) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {eligibility.eligible ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Lock className="w-5 h-5 text-amber-600" />}
          {eligibility.eligible ? "You're eligible to apply" : "Eligibility signals required"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Capavate Collective is invite-only. Members are admitted via cap-table verification, founder status,
          deal-signatory history, or a partner vouch.
        </p>
        <div className="space-y-2">
          {Object.entries(eligibility.passes).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2" data-testid={`elig-${k}`}>
              {v ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-slate-300" />}
              <span className={v ? "" : "text-muted-foreground"}>
                {k === "investorOnCapTable" && "Verified investor on a Capavate cap table"}
                {k === "founderOfCompany" && "Founder of a Capavate company"}
                {k === "signatoryOnCompany" && "Signatory on at least one Capavate company"}
                {k === "vouchedByPartner" && "Vouched by a consortium partner"}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-border/40 pt-3">
          {eligibility.reasons.map((r, i) => (
            <div key={i} className="text-sm text-muted-foreground">• {r}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Step 2                                                           */
/* ---------------------------------------------------------------- */

function Step2Profile({ form, setForm }: { form: CollectiveApplication; setForm: (f: CollectiveApplication) => void }) {
  function toggleSector(s: string) {
    setForm({ ...form, sectors: form.sectors.includes(s) ? form.sectors.filter((x) => x !== s) : [...form.sectors, s] });
  }
  function toggleStage(s: string) {
    setForm({ ...form, stages: form.stages.includes(s) ? form.stages.filter((x) => x !== s) : [...form.stages, s] });
  }
  function toggleGeo(g: string) {
    setForm({ ...form, geoFocus: form.geoFocus.includes(g) ? form.geoFocus.filter((x) => x !== g) : [...form.geoFocus, g] });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Investor profile</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label>Investment thesis <span className="text-muted-foreground">(20-1000 chars)</span></Label>
          <Textarea
            rows={4}
            value={form.thesis}
            onChange={(e) => setForm({ ...form, thesis: e.target.value })}
            placeholder="What you back, why now, the unfair advantage you bring as an LP/operator…"
            data-testid="textarea-thesis"
          />
          <div className="text-[11px] text-muted-foreground mt-1">{form.thesis.length} / 1000</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Min check ($)</Label>
            <Input type="number" min={5_000} value={form.minCheckUsd} onChange={(e) => setForm({ ...form, minCheckUsd: Number(e.target.value) || 0 })} data-testid="input-min-check" />
          </div>
          <div>
            <Label>Max check ($)</Label>
            <Input type="number" min={5_000} value={form.maxCheckUsd} onChange={(e) => setForm({ ...form, maxCheckUsd: Number(e.target.value) || 0 })} data-testid="input-max-check" />
          </div>
        </div>

        <div>
          <Label>Sectors ({form.sectors.length} / 45)</Label>
          <div className="flex flex-wrap gap-1.5 mt-2 max-h-44 overflow-y-auto p-2 border rounded-md">
            {COLLECTIVE_SECTORS_45.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSector(s)}
                data-testid={`chip-sector-${s.replace(/\W/g, "_")}`}
                className={`px-2.5 py-1 text-xs rounded-full border ${form.sectors.includes(s) ? "bg-[hsl(0_100%_40%)] text-white border-transparent" : "bg-white text-slate-700"}`}
              >{s}</button>
            ))}
          </div>
        </div>

        <div>
          <Label>Stages</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLLECTIVE_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStage(s)}
                data-testid={`chip-stage-${s.replace(/\W/g, "_")}`}
                className={`px-3 py-1 text-sm rounded-full border ${form.stages.includes(s) ? "bg-[hsl(0_100%_40%)] text-white border-transparent" : "bg-white text-slate-700"}`}
              >{s}</button>
            ))}
          </div>
        </div>

        <div>
          <Label>Geographic focus</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLLECTIVE_REGIONS_9.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGeo(g)}
                data-testid={`chip-geo-${g.replace(/\W/g, "_")}`}
                className={`px-3 py-1 text-sm rounded-full border ${form.geoFocus.includes(g) ? "bg-[hsl(0_100%_40%)] text-white border-transparent" : "bg-white text-slate-700"}`}
              >{g}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Member tier</Label>
            <Select value={form.memberTier} onValueChange={(v) => setForm({ ...form, memberTier: v as CollectiveApplication["memberTier"] })}>
              <SelectTrigger data-testid="select-tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* v25.21 Lane C NH-3 fix — tier picker shows label only;
                    pricing is confirmed at billing checkout against the
                    live `/api/collective/membership/tiers` catalog. */}
                {Object.entries(TIER_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Referral code <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} data-testid="input-referral" />
          </div>
        </div>

        <div className="border rounded-md p-3 bg-slate-50">
          <div className="text-sm font-medium">{TIER_LABEL[form.memberTier].label} tier perks</div>
          <ul className="mt-2 text-xs space-y-1">
            {TIER_LABEL[form.memberTier].perks.map((p) => <li key={p}>• {p}</li>)}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Step 3                                                           */
/* ---------------------------------------------------------------- */

function Step3Identity({ form, setForm }: { form: CollectiveApplication; setForm: (f: CollectiveApplication) => void }) {
  // Sprint 20 Wave 2 — real KYC upload via FormData POST /api/collective/kyc-upload (defect 45)
  async function uploadKyc(file: File, field: "passportFilename" | "proofOfAddressFilename") {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("field", field);
      // v25.10 M6 — include cookies for Safari + cross-origin compatibility.
      const res = await fetch("/api/collective/kyc-upload", { method: "POST", body: fd, credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setForm({ ...form, [field]: d.url ?? file.name });
      } else {
        // Graceful fallback — use filename client-side
        setForm({ ...form, [field]: file.name });
      }
    } catch {
      setForm({ ...form, [field]: file.name });
    }
  }

  function attach(field: "passportFilename" | "proofOfAddressFilename") {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) uploadKyc(f, field);
    };
  }
  function attachAdditional(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).map((f) => f.name);
    setForm({ ...form, additionalDocs: [...(form.additionalDocs ?? []), ...files].slice(0, 10) });
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Identity verification & KYC</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <UploadField
          label="Passport / national ID"
          required
          filename={form.passportFilename}
          onChange={attach("passportFilename")}
          onClear={() => setForm({ ...form, passportFilename: "" })}
          testid="upload-passport"
        />
        <UploadField
          label="Proof of address (utility bill, statement)"
          required
          filename={form.proofOfAddressFilename}
          onChange={attach("proofOfAddressFilename")}
          onClear={() => setForm({ ...form, proofOfAddressFilename: "" })}
          testid="upload-poa"
        />
        <div>
          <Label>Additional documents <span className="text-muted-foreground">(optional, up to 10)</span></Label>
          <div className="mt-2 flex items-center gap-2">
            <input id="additional" type="file" multiple className="hidden" onChange={attachAdditional} data-testid="upload-additional" />
            <Button variant="outline" onClick={() => document.getElementById("additional")?.click()}>
              <Upload className="w-4 h-4 mr-1" /> Add files
            </Button>
            <span className="text-xs text-muted-foreground">{(form.additionalDocs ?? []).length} attached</span>
          </div>
          {(form.additionalDocs ?? []).length > 0 && (
            <ul className="mt-2 text-sm space-y-1">
              {(form.additionalDocs ?? []).map((d, i) => (
                <li key={i} className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded">
                  <span>{d}</span>
                  <button type="button" onClick={() => setForm({ ...form, additionalDocs: form.additionalDocs?.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-rose-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="text-xs text-muted-foreground border-t border-border/40 pt-3">
          Files are encrypted in transit. Capavate stores documents in an access-controlled vault and shares
          them only with the licensed KYC provider.
        </div>
      </CardContent>
    </Card>
  );
}

function UploadField({ label, required, filename, onChange, onClear, testid }: {
  label: string; required?: boolean; filename: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  testid: string;
}) {
  const id = `upload-${testid}`;
  return (
    <div>
      <Label>{label} {required && <span className="text-rose-600">*</span>}</Label>
      <div className="flex items-center gap-2 mt-1">
        <input id={id} type="file" className="hidden" onChange={onChange} data-testid={testid} />
        <Button variant="outline" onClick={() => document.getElementById(id)?.click()}>
          <Upload className="w-4 h-4 mr-1" /> Upload
        </Button>
        {filename ? (
          <div className="flex items-center gap-2 bg-emerald-50 px-2 py-1 rounded text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {filename}
            <button type="button" onClick={onClear} className="text-muted-foreground hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : <span className="text-xs text-muted-foreground">No file selected</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Step 4                                                           */
/* ---------------------------------------------------------------- */

function Step4Accreditation({ form, setForm }: { form: CollectiveApplication; setForm: (f: CollectiveApplication) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Accreditation declaration</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Jurisdiction</Label>
          <Select value={form.jurisdiction} onValueChange={(v) => setForm({ ...form, jurisdiction: v as AccreditationJurisdiction, accreditationDeclaration: "" })}>
            <SelectTrigger data-testid="select-jurisdiction"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCREDITATION_JURISDICTIONS.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-slate-50 border rounded-md p-3 text-sm whitespace-pre-wrap">
          {JURISDICTION_TEXT[form.jurisdiction]}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="declare"
            checked={form.accreditationDeclaration === JURISDICTION_TEXT[form.jurisdiction]}
            onCheckedChange={(v) => setForm({ ...form, accreditationDeclaration: v ? JURISDICTION_TEXT[form.jurisdiction] : "" })}
            data-testid="checkbox-declare"
          />
          <Label htmlFor="declare" className="text-sm font-normal cursor-pointer">
            I confirm the above declaration is true and I will provide supporting evidence on request. False
            declarations may result in account termination and reporting to the relevant regulator.
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Step 5                                                           */
/* ---------------------------------------------------------------- */

function Step5Payment({ form, setForm }: { form: CollectiveApplication; setForm: (f: CollectiveApplication) => void }) {
  const tier = TIER_LABEL[form.memberTier];
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Membership payment</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* v25.21 Lane C NH-3 fix — honest notice: the "Annual fee" figure
            previously shown here was a client-side mock ($1k/$5k/$15k/$50k)
            that did not reconcile with the live billing catalog. The fee is
            now confirmed at the secure Airwallex checkout post-approval. */}
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2 text-sm" data-testid="notice-stripe">
          <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5" />
          <div>
            <strong>This step records your payment preference only.</strong> Your
            actual annual fee is confirmed at the secure checkout after admin
            approval, against the live tier catalog. No card is charged here.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">Tier</div><div className="font-semibold">{tier.label}</div></div>
          <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">Annual fee</div><div className="font-semibold">Confirmed at checkout</div></div>
          <div className="p-3 rounded border"><div className="text-xs text-muted-foreground">Renewal</div><div className="font-semibold">12 months</div></div>
        </div>
        <div>
          <Label>Payment method</Label>
          <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as CollectiveApplication["paymentMethod"] })}>
            <SelectTrigger data-testid="select-payment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="card_mock">Card (mock — no charge)</SelectItem>
              <SelectItem value="invoice">Invoice (admin processes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.paymentMethod === "card_mock" && (
          <div>
            <Label>Cardholder name</Label>
            <Input value={form.cardholderName} onChange={(e) => setForm({ ...form, cardholderName: e.target.value })} data-testid="input-cardholder" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- */
/* Step 6                                                           */
/* ---------------------------------------------------------------- */

function Step6Review({ form }: { form: CollectiveApplication }) {
  const tier = TIER_LABEL[form.memberTier];
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Review your application</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Section title="Profile">
          {/* v25.21 Lane C NH-3 fix — don't show a fabricated annual fee */}
          <Kv k="Tier" v={tier.label} />
          <Kv k="Check size" v={`${fmtUSD(form.minCheckUsd)} – ${fmtUSD(form.maxCheckUsd)}`} />
          <Kv k="Sectors" v={form.sectors.join(", ") || "—"} />
          <Kv k="Stages" v={form.stages.join(", ") || "—"} />
          <Kv k="Geo focus" v={form.geoFocus.join(", ") || "—"} />
          {form.referralCode && <Kv k="Referral" v={form.referralCode} />}
        </Section>
        <Section title="Thesis">
          <p className="whitespace-pre-wrap">{form.thesis}</p>
        </Section>
        <Section title="Identity">
          <Kv k="Passport" v={form.passportFilename || "—"} />
          <Kv k="Proof of address" v={form.proofOfAddressFilename || "—"} />
          <Kv k="Additional" v={(form.additionalDocs ?? []).join(", ") || "none"} />
        </Section>
        <Section title="Accreditation">
          <Kv k="Jurisdiction" v={form.jurisdiction} />
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{form.accreditationDeclaration}</p>
        </Section>
        <Section title="Payment">
          <Kv k="Method" v={form.paymentMethod === "card_mock" ? "Card (mock)" : "Invoice"} />
          {form.paymentMethod === "card_mock" && <Kv k="Cardholder" v={form.cardholderName ?? "—"} />}
        </Section>
        <div className="text-xs text-muted-foreground border-t border-border/40 pt-2">
          Submitting will emit telemetry <code>collective_application_submitted</code> to the sync schema.
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/40 pb-3">
      <div className="text-xs uppercase text-muted-foreground tracking-wider mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Kv({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start gap-3"><span className="text-muted-foreground w-32 flex-shrink-0">{k}</span><span className="flex-1">{v}</span></div>;
}

/* ---------------------------------------------------------------- */
/* Step 7                                                           */
/* ---------------------------------------------------------------- */

function Step7Success({ applicationId, navigate }: { applicationId: string | null; navigate: (to: string) => void }) {
  return (
    <Card>
      <CardContent className="pt-12 pb-12 text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9 text-emerald-600" />
        </div>
        <div>
          <div className="text-xl font-semibold">Application submitted</div>
          <div className="text-sm text-muted-foreground mt-1">Reference: <code className="text-xs">{applicationId ?? "—"}</code></div>
        </div>
        <div className="text-sm max-w-md mx-auto text-muted-foreground">
          Our admissions team reviews applications within 5 business days. You'll get a decision by email and
          in-app notification, plus a member onboarding call if accepted.
        </div>
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" onClick={() => navigate("/investor/dashboard")} data-testid="button-go-dashboard">Back to dashboard</Button>
          <Button
            onClick={() => window.open("https://capavate.com/collective/", "_blank")}
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)]"
            data-testid="button-go-collective"
          >
            Open the Collective <ArrowUpRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
