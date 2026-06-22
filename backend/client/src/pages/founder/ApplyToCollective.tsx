import { asArray } from "@/lib/safeArray";
/**
 * Sprint 18 — Founder Apply-to-Collective.
 *
 * BOTH tabs are for COMPANIES applying to PRESENT to Collective members.
 * NEITHER tab is for membership. Membership is investor-side at /investor/apply-to-collective.
 *
 * Path A — "Investor-vouched company" — an existing cap-table investor nominates the
 *   company. Form: investor selector + pitch summary + deck link + supplementary + asks.
 *   Submit → POST /api/founder/collective/nominations
 *
 * Path B — "Direct company application" — apply directly to present without an
 *   existing investor sponsor. Form: pitch deck + traction + asks + references +
 *   2-page cover letter + non-refundable application-fee placeholder.
 *   Submit → POST /api/founder/collective/applications
 *
 * Sprint 17 inversion bug FIXED: Tab B previously rendered the investor-membership
 *   wizard. Now both tabs are COMPANY presentation applications.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  Sparkles, ShieldCheck, Users, Mail, ExternalLink, AlertTriangle,
  Building2, FileText, Trophy,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { PageBody, PageHeader } from "@/components/AppShell";
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { fmtUSD } from "@/lib/format";
import { useActiveCompany, useActiveCompanyId } from "@/lib/useActiveCompany";

type CrmRow = {
  id: string; investorId: string; name: string; firmName: string; region: string; stage: string;
};

type Nomination = {
  id: string; companyId: string; vouchingInvestorId: string; pitchSummary: string;
  status: "pending_vouch" | "vouched" | "reviewing" | "invited" | "presented" | "declined";
  submittedAt: string;
};

type Application = {
  id: string; companyId: string; pitchDeckFilename: string;
  status: "submitted" | "reviewing" | "invited" | "accepted" | "rejected" | "waitlisted";
  submittedAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  pending_vouch: "bg-amber-50 text-amber-800 border-amber-200",
  vouched: "bg-emerald-50 text-emerald-800 border-emerald-200",
  reviewing: "bg-blue-50 text-blue-800 border-blue-200",
  invited: "bg-emerald-50 text-emerald-800 border-emerald-200",
  presented: "bg-emerald-100 text-emerald-900 border-emerald-300",
  declined: "bg-rose-50 text-rose-800 border-rose-200",
  rejected: "bg-rose-50 text-rose-800 border-rose-200",
  waitlisted: "bg-slate-50 text-slate-700 border-slate-200",
  submitted: "bg-blue-50 text-blue-800 border-blue-200",
};

export default function FounderApplyToCollective() {
  const { data: activeCompanyResp } = useActiveCompany();
  const company = activeCompanyResp?.company;
  const companyId = useActiveCompanyId();

  // B-401 fix v23.4.13: use session founderId + surface errors
  const meQ = useQuery<{ id: string; displayName?: string }>({ queryKey: ["/api/auth/me"] });
  const sessionFounderId: string = (meQ.data as any)?.id ?? (meQ.data as any)?.userId ?? "";

  const crmQ = useQuery<CrmRow[]>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });

  // C-006 v23.5: fetch the founder's latest application status for banner
  const mineQ = useQuery<{ application: Application } | null>({
    queryKey: ["/api/founder/collective/applications/mine"],
    /* v25.32 burndown — item 14: apiRequest throws ApiError on non-2xx, so the
       prior `if (res.status === 404) return null` after the await was dead code
       (the 404 graceful-empty fallback never ran; the query errored instead).
       Source: v25_32_apiRequest_dead_code_sites_gpt55.txt (ApplyToCollective.tsx:88).
       Catch ApiError and branch on .status to restore the intended
       "no application yet" → null behavior. Read-only; additive. */
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/founder/collective/applications/mine");
        return res.json();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });
  const mineApp = (mineQ.data as any)?.application ?? null;

  const nominationsQ = useQuery<Nomination[]>({
    queryKey: ["/api/founder/collective/nominations", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/nominations?companyId=${companyId}`)).json(),
  });

  const applicationsQ = useQuery<Application[]>({
    queryKey: ["/api/founder/collective/applications", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/applications?companyId=${companyId}`)).json(),
  });

  const promoters = useMemo(
    () => asArray<CrmRow>(crmQ.data).filter(c => c.stage === "invested"),
    [crmQ.data]
  );

  return (
    <>
      <PageHeader
        title="Apply to present at Capavate Collective"
        description="Both paths apply your company to PRESENT to Collective members. Neither is a membership application."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Apply to Collective" }]}
      />
      <PageBody>
        {/* C-006 v23.5 — application status banner */}
        {mineApp && (
          <div
            className={`rounded-md border p-4 mb-5 flex items-start gap-3 ${mineApp.status === "rejected" ? "border-rose-200 bg-rose-50" : (mineApp.status === "invited" || mineApp.status === "accepted") ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}
            data-testid="banner-application-status"
          >
            <Mail className="h-5 w-5 shrink-0 mt-0.5 text-current" />
            <div className="text-sm">
              {mineApp.status === "submitted" && <><strong>Submitted on {new Date(mineApp.submittedAt).toLocaleDateString()}</strong> — under review.</>}
              {mineApp.status === "reviewing" && <><strong>Under review</strong> since {new Date(mineApp.submittedAt).toLocaleDateString()}.</>}
              {(mineApp.status === "invited" || mineApp.status === "accepted") && <><strong className="text-emerald-800">Accepted on {mineApp.reviewedAt ? new Date(mineApp.reviewedAt).toLocaleDateString() : "—"}</strong> — congratulations! <Link href="/collective"><span className="underline cursor-pointer">Go to Collective</span></Link></>}
              {mineApp.status === "rejected" && <><strong className="text-rose-800">Not selected this cycle.</strong> You may apply again in the next cycle.</>}
              {mineApp.status === "waitlisted" && <><strong>Waitlisted</strong> — you\'re on the waitlist for the next cycle.</>}
            </div>
          </div>
        )}

        {/* Eligibility info banner */}
        <div className="rounded-md border-2 border-[hsl(184_98%_22%)]/30 bg-[hsl(184_98%_22%)]/5 p-4 mb-5" data-testid="banner-presentation-eligibility">
          <div className="flex items-start gap-3">
            <Trophy className="h-5 w-5 text-[hsl(184_98%_22%)] shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold mb-1">This applies your <span className="underline">company</span> to PRESENT, not you for membership.</div>
              <p className="text-muted-foreground">
                The Capavate Collective is an invitation-only network of accredited investors. Companies can present to the network in two ways:
                via an investor on your cap table who nominates you (faster), or by applying directly (more diligence required, includes a non-refundable application fee).
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Looking for membership? Investors apply at <span className="font-mono text-[hsl(184_98%_22%)]">/investor/apply-to-collective</span>.
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="vouch" className="w-full">
          <TabsList className="grid grid-cols-2 max-w-2xl">
            <TabsTrigger value="vouch" data-testid="tab-vouch">
              <Users className="h-3.5 w-3.5 mr-1" /> Path A — Investor-vouched company
            </TabsTrigger>
            <TabsTrigger value="direct" data-testid="tab-direct">
              <Building2 className="h-3.5 w-3.5 mr-1" /> Path B — Direct company application
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vouch" className="mt-4">
            <PathA
              promoters={promoters}
              companyName={company?.companyName ?? "your company"}
              companyId={companyId}
              nominations={asArray<Nomination>(nominationsQ.data)}
              meId={sessionFounderId}
            />
          </TabsContent>

          <TabsContent value="direct" className="mt-4">
            <PathB
              companyId={companyId}
              applications={asArray<Application>(applicationsQ.data)}
              meId={sessionFounderId}
            />
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground text-center mt-6 pb-4">
          Looking for Collective membership? <Link href="/investor/apply-to-collective"><span className="text-[hsl(184_98%_22%)] underline cursor-pointer" data-testid="link-investor-membership">Investors apply here</span></Link>.
        </div>
      </PageBody>
    </>
  );
}

/* -------------- Path A — Investor-vouched company -------------- */
function PathA({
  promoters, companyName, companyId, nominations, meId,
}: { promoters: CrmRow[]; companyName: string; companyId: string; nominations: Nomination[]; meId?: string }) {
  const { toast } = useToast();
  const [selectedInvestorId, setSelectedInvestorId] = useState<string>("");
  const [pitchSummary, setPitchSummary] = useState("");
  const [deckLink, setDeckLink] = useState("");
  const [supplementary, setSupplementary] = useState("");
  const [asks, setAsks] = useState("");

  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/collective/nominations", {
        companyId,
        founderId: meId ?? companyId,
        vouchingInvestorId: selectedInvestorId,
        pitchSummary,
        deckLink: deckLink || undefined,
        supplementaryNotes: supplementary || undefined,
        asks: asks || undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.ok) {
        toast({ title: "Vouch request sent", description: "Your nominator will review and vouch in their inbox." });
        setSelectedInvestorId(""); setPitchSummary(""); setDeckLink(""); setSupplementary(""); setAsks("");
        queryClient.invalidateQueries({ queryKey: ["/api/founder/collective/nominations", companyId] });
      } else {
        toast({ title: "Validation failed", description: data?.error ?? "Please check the form.", variant: "destructive" });
      }
    },
    /* v25.12 NH5 — surface network / 4xx / 5xx errors so founders see
     * why their nomination didn't submit (rate-limit, eligibility, etc). */
    onError: (e: Error) => toast({
      variant: "destructive",
      title: "Nomination failed",
      description: e.message,
    }),
  });

  const canSubmit = selectedInvestorId && pitchSummary.length >= 20 && !submitMut.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(184_98%_22%)]" /> How vouching works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Pick an existing cap-table investor who is already a Collective member.</p>
          <p>2. We send them a one-click nomination request from {companyName}.</p>
          <p>3. Once they vouch, your <strong className="text-foreground">company</strong> skips the bulk of the diligence queue and is typically reviewed within 2 business days.</p>
          <p className="pt-2 text-xs italic">Reminder: this nominates your COMPANY to PRESENT — it doesn't enrol you as a member.</p>
        </CardContent>
      </Card>

      {nominations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Existing nominations</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {nominations.map(n => (
                <li key={n.id} className="px-5 py-3 flex items-center justify-between text-sm" data-testid={`row-nomination-${n.id}`}>
                  <div>
                    <div className="font-medium">{n.vouchingInvestorId}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{n.pitchSummary}</div>
                  </div>
                  <Badge variant="outline" className={STATUS_BADGE[n.status] ?? ""}>{n.status.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nominate your company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Cap-table investor to nominate you</Label>
            {promoters.length === 0 ? (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                No invested cap-table holders yet. Close at least one round, then come back.
              </div>
            ) : (
              <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
                <SelectTrigger className="mt-1" data-testid="select-vouching-investor"><SelectValue placeholder="Pick an investor from your cap table" /></SelectTrigger>
                <SelectContent>
                  {promoters.map(p => (
                    <SelectItem key={p.investorId} value={p.investorId}>{p.name} · {p.firmName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Company pitch summary (20–2000 chars)</Label>
            <Textarea rows={4} value={pitchSummary} onChange={e => setPitchSummary(e.target.value)} placeholder="What you do, why now, and traction so far. Pre-filled from CompanyProfile when available." className="mt-1" data-testid="textarea-pitch-summary" />
            <div className="text-xs text-muted-foreground mt-1">{pitchSummary.length}/2000</div>
          </div>
          <div>
            <Label>Deck link (optional)</Label>
            <Input value={deckLink} onChange={e => setDeckLink(e.target.value)} placeholder="https://docsend.com/..." className="mt-1" data-testid="input-deck-link" />
          </div>
          <div>
            <Label>Supplementary materials (optional)</Label>
            <Textarea rows={2} value={supplementary} onChange={e => setSupplementary(e.target.value)} placeholder="Customer testimonials, partner LOIs, key technical wins, etc." className="mt-1" data-testid="textarea-supplementary" />
          </div>
          <div>
            <Label>Asks (optional)</Label>
            <Textarea rows={2} value={asks} onChange={e => setAsks(e.target.value)} placeholder="What you'd like from Collective members presenting feedback, intros, or check sizes." className="mt-1" data-testid="textarea-asks" />
          </div>
          <div className="flex items-center justify-between pt-3 border-t">
            <p className="text-xs text-muted-foreground">Your nominator must approve before this enters the diligence queue.</p>
            <Button
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
              disabled={!canSubmit}
              onClick={() => submitMut.mutate()}
              data-testid="button-submit-nomination"
            >
              <Mail className="h-3.5 w-3.5 mr-1" /> Submit nomination
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------- Path B — Direct company application -------------- */
function PathB({ companyId, applications, meId }: { companyId: string; applications: Application[]; meId?: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Form state
  const [pitchDeck, setPitchDeck] = useState("");
  const [tractionMrr, setTractionMrr] = useState(0);
  const [tractionUsers, setTractionUsers] = useState(0);
  const [tractionGrowthPct, setTractionGrowthPct] = useState(0);
  const [asks, setAsks] = useState("");
  const [references, setReferences] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [feeAcknowledged, setFeeAcknowledged] = useState(false);

  const APPLICATION_FEE = 2_500;

  const submitMut = useMutation({
    mutationFn: async () => {
      // B-401 fix v23.4.13: use session founderId (meId) not a stale form default
      const res = await apiRequest("POST", "/api/founder/collective/applications", {
        companyId,
        founderId: meId || companyId,
        pitchDeckFilename: pitchDeck,
        tractionMrr,
        tractionUsers,
        tractionGrowthPct,
        asks,
        references,
        coverLetter,
        feeAcknowledged,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`);
      return data;
    },
    onSuccess: (data) => {
      if (data?.ok && data.application?.id) {
        setSubmittedId(data.application.id);
        toast({ title: "Application submitted", description: "Telemetry collective_company_application_submitted emitted." });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/collective/applications", companyId] });
        // C-006-refresh fix v23.6.1: invalidate /mine after submit so the status
        // banner updates immediately without a manual page reload. refetchType:
        // "all" forces a refetch even if the banner query was last resolved to a
        // 404→null (inactive/idle observer), which is exactly the pre-first-
        // application state where the banner was previously stuck until reload.
        queryClient.invalidateQueries({
          queryKey: ["/api/founder/collective/applications/mine"],
          refetchType: "all",
        });
      } else {
        toast({ title: "Validation failed", description: data?.error ?? "Please review the form.", variant: "destructive" });
      }
    },
    // B-401 fix v23.4.13: surface 4xx errors via toast instead of swallowing them
    onError: (e: Error) => toast({ title: "Application failed", description: e.message, variant: "destructive" }),
  });

  if (submittedId) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <Sparkles className="h-12 w-12 text-[hsl(184_98%_22%)] mx-auto" />
          <div>
            <h2 className="text-xl font-semibold">Application submitted!</h2>
            <p className="text-sm text-muted-foreground mt-1">ID: <span className="font-mono">{submittedId}</span></p>
          </div>
          <div className="text-sm text-muted-foreground max-w-md mx-auto">
            We'll review your company within 5 business days. You'll get an email plus an in-app notification when there's an update.
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate("/founder/dashboard")} data-testid="button-back-dashboard">Back to dashboard</Button>
            <Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => navigate("/founder/messages")} data-testid="button-go-messages">View Collective messages</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // C-012 v23.5: client-side validation feedback (always-enabled button pattern)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validateAndSubmit() {
    const errs: Record<string, string> = {};
    if (!pitchDeck) errs.pitchDeck = "Pitch deck filename is required.";
    if (asks.length < 20) errs.asks = `Asks must be at least 20 characters (${asks.length}/20).`;
    if (coverLetter.length < 100) errs.coverLetter = `Cover letter must be at least 100 characters (${coverLetter.length}/100).`;
    if (!feeAcknowledged) errs.feeAck = "You must acknowledge the application fee.";
    setFieldErrors(errs);
    const errCount = Object.keys(errs).length;
    if (errCount > 0) {
      // field(s) need attention — C-012 v23.5
      toast({ title: `${errCount} field${errCount !== 1 ? "s" : ""} need attention`, description: "Please review the highlighted fields below.", variant: "destructive" });
      // Scroll to first errored field
      const firstKey = Object.keys(errs)[0];
      const el = document.querySelector(`[data-testid="${firstKey === "pitchDeck" ? "input-pitch-deck" : firstKey === "asks" ? "textarea-asks-direct" : firstKey === "coverLetter" ? "textarea-cover-letter" : "checkbox-fee-ack"}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submitMut.mutate();
  }

  const canSubmit = !submitMut.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[hsl(184_98%_22%)]" /> Direct company application
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>This path is for founders without a cap-table investor sponsor.</p>
          <p>Diligence is more thorough — typically reviewed within 5 business days. A non-refundable application fee of {fmtUSD(APPLICATION_FEE)} applies.</p>
          <p className="pt-2 text-xs italic">Reminder: this applies your COMPANY to PRESENT — it doesn't enrol you as a member.</p>
        </CardContent>
      </Card>

      {applications.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Your existing applications</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {applications.map(a => (
                <li key={a.id} className="px-5 py-3 flex items-center justify-between text-sm" data-testid={`row-application-${a.id}`}>
                  <div>
                    <div className="font-medium">{a.pitchDeckFilename}</div>
                    <div className="text-xs text-muted-foreground">{new Date(a.submittedAt).toLocaleDateString()}</div>
                  </div>
                  <Badge variant="outline" className={STATUS_BADGE[a.status] ?? ""}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Pitch deck filename</Label>
            <Input value={pitchDeck} onChange={e => setPitchDeck(e.target.value)} placeholder="e.g. novapay_q2_deck.pdf" className="mt-1" data-testid="input-pitch-deck" />
            <p className="text-xs text-muted-foreground mt-1">In production this would be a multipart upload to S3 + KMS. Filenames accepted for demo.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>MRR (USD)</Label>
              <Input type="number" min={0} value={tractionMrr} onChange={e => setTractionMrr(Number(e.target.value))} className="mt-1" data-testid="input-traction-mrr" />
            </div>
            <div>
              <Label>Active users</Label>
              <Input type="number" min={0} value={tractionUsers} onChange={e => setTractionUsers(Number(e.target.value))} className="mt-1" data-testid="input-traction-users" />
            </div>
            <div>
              <Label>30-day growth (%)</Label>
              <Input type="number" value={tractionGrowthPct} onChange={e => setTractionGrowthPct(Number(e.target.value))} className="mt-1" data-testid="input-traction-growth" />
            </div>
          </div>

          <div>
            <Label>What you're asking from Collective members (20–2000 chars)</Label>
            <Textarea rows={3} value={asks} onChange={e => setAsks(e.target.value)} placeholder="Lead investor for Series A, strategic intros to enterprise customers, etc." className="mt-1" data-testid="textarea-asks-direct" />
            <div className="text-xs text-muted-foreground mt-1">{asks.length}/2000</div>
          </div>

          <div>
            <Label>References (optional)</Label>
            <Textarea rows={3} value={references} onChange={e => setReferences(e.target.value)} placeholder="Three professional references with names, titles, and contact info." className="mt-1" data-testid="textarea-references" />
          </div>

          <div>
            <Label>2-page cover letter (100–8000 chars)</Label>
            <Textarea rows={8} value={coverLetter} onChange={e => setCoverLetter(e.target.value)} placeholder="Why your company matters, what you've built, what you need from the Collective. Treat this as your founder's letter." className="mt-1" data-testid="textarea-cover-letter" />
            <div className="text-xs text-muted-foreground mt-1">{coverLetter.length}/8000</div>
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="font-semibold text-amber-900 mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Application fee — {fmtUSD(APPLICATION_FEE)} non-refundable
            </div>
            <p className="text-xs text-amber-800 mb-2">In production, payment is processed via Stripe before the application enters the queue. Demo mode does not charge.</p>
            <label className="flex items-start gap-2 text-xs text-amber-900 cursor-pointer">
              <Checkbox checked={feeAcknowledged} onCheckedChange={(v) => setFeeAcknowledged(v === true)} data-testid="checkbox-fee-ack" />
              I understand this is a non-refundable application fee and that submission does not guarantee an invitation.
            </label>
          </div>

          {/* C-012 v23.5 — field error summary */}
          {Object.keys(fieldErrors).length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm" data-testid="validation-errors">
              <strong className="text-rose-800">{Object.keys(fieldErrors).length} field{Object.keys(fieldErrors).length !== 1 ? "s" : ""} need attention:</strong>
              <ul className="mt-1 space-y-0.5 text-rose-700 text-xs">
                {Object.values(fieldErrors).map((msg, i) => <li key={i}>• {msg}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t">
            <p className="text-xs text-muted-foreground">Required: deck filename, asks (≥20), cover letter (≥100), fee acknowledgement.</p>
            <Button
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
              disabled={!canSubmit}
              onClick={validateAndSubmit}
              data-testid="button-submit-application"
            >
              {submitMut.isPending ? "Submitting…" : "Submit application"} <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
