import { asArray } from "@/lib/safeArray";
import { useState, useRef, useCallback } from "react";
import { useParams, Link, useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { StateBadge } from "@/components/common";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip } from "@/components/HelpTip";
import { ArrowLeft, FileText, Eye, Download, ShieldCheck, Check, X, Layers, PieChart as PieIcon, Building2, Info, Hash, Undo2, Wallet, Copy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtUSD, fmtPct, fmtDate, fmtNum, fmtBytes } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { emit } from "@/lib/sprint3";
import { useEffect } from "react";
import { signSES, captureSessionMetadata } from "@/lib/esign/ses";
import { useTermSheetStore } from "@/lib/termsheet/store";
import { useEntitlement } from "@/lib/entitlement";
import { apiRequest, ApiError } from "@/lib/queryClient";
// Sprint 21 Wave B components
import InvestmentHistoryPanel from "@/components/investor/InvestmentHistoryPanel";
import CoSoftCircleBox from "@/components/investor/CoSoftCircleBox";
import FounderQABox from "@/components/investor/FounderQABox";
import { useRealtimeSync } from "@/lib/realtimeSync";

type RoundTerms = {
 liquidationPref?: string;
 antiDilution?: string;
 proRataMinimum?: string;
 boardComposition?: string;
};
type UseOfProceedsEntry = { category: string; percent: number };
type Inv = {
 id: string;
 company: { id: string; name: string; sector: string };
 round: { id: string; name: string; type: string; state: string;
 whyNow?: string;
 leadInvestorNote?: string;
 terms?: RoundTerms;
 useOfProceeds?: UseOfProceedsEntry[];
 };
 state: string; receivedAt: string; expiresAt: string;
 minTicket: number; targetAmount: number; raisedAmount: number;
 preMoney: number; postMoney: number; pricePerShare: number;
};
type Sec = { id: string; holderName: string; holderType: string; instrument: string; series: string | null; shares: number; investmentAmount: number | null };
type DR = { id: string; category: string; name: string; sizeBytes: number; uploadedAt: string };
// v24.3 — wire-transfer instructions published by the founder for this round.
type WireInstructions = {
 roundId: string;
 bankName: string;
 accountName: string;
 accountNumber: string;
 routingNumber: string | null;
 swift: string | null;
 reference: string | null;
 notes: string | null;
 updatedAt: string;
};

const INSTRUMENT_COLORS: Record<string, string> = {
 common: "hsl(219 45% 30%)", preferred: "hsl(184 98% 28%)", safe: "hsl(333 75% 40%)",
 note: "hsl(38 92% 50%)", warrant: "hsl(158 64% 38%)", option: "hsl(219 70% 55%)",
};

/* Sprint 4 — short orientation line at the top of every tab. */
function TabIntro({ children }: { children: React.ReactNode }) {
 return (
  <div className="flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs leading-relaxed" data-testid="tab-intro">
   <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
   <span className="text-muted-foreground">{children}</span>
  </div>
 );
}

// B4: Tab values mapped to URL-safe keys
type TabValue = "overview" | "captable" | "terms" | "dataroom" | "decision";

const VALID_TABS: TabValue[] = ["overview", "captable", "terms", "dataroom", "decision"];

function parseTabParam(search: string): TabValue {
 const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
 const t = params.get("tab") as TabValue | null;
 return t && VALID_TABS.includes(t) ? t : "overview";
}

export default function InvitationDetail() {
 useRealtimeSync();
 const params = useParams<{ id: string }>();
 const id = params.id;
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const { data: entitlementCtx } = useEntitlement();
 const [, navigate] = useLocation();

 // B4: URL-synced tab — read ?tab= from search
 const search = useSearch();
 const activeTab = parseTabParam(search);

 const setActiveTab = useCallback((tab: TabValue) => {
   navigate(`/investor/invitations/${id}?tab=${tab}`, { replace: true });
 }, [id, navigate]);

 // Ref for scrolling to soft-circle form (B5)
 const softCircleFormRef = useRef<HTMLDivElement>(null);

 const inv = useQuery<Inv>({ queryKey: ["/api/investor/invitations", id] });

 // Patch v4: company id is sourced from the invitation; no hardcoded ids.
 const companyId = inv.data?.company.id;
 const roundId = inv.data?.round.id;

 const sec = useQuery<Sec[]>({
  queryKey: ["/api/companies", companyId, "securities"],
  queryFn: async () => {
   if (!companyId) return [];
   const res = await apiRequest("GET", `/api/companies/${companyId}/securities`);
   return res.json();
  },
  enabled: !!companyId,
 });
 // Defect 2 fix: fetch dataroom scoped to company
 const dr = useQuery<DR[]>({
  queryKey: ["/api/dataroom", companyId],
  queryFn: async () => {
   if (!companyId) return [];
   const res = await apiRequest("GET", `/api/dataroom?companyId=${encodeURIComponent(companyId)}`);
   if (!res.ok) return [];
   return res.json();
  },
  enabled: !!companyId,
 });

 // B3: Fetch decision record to know if investor has soft-circled (for B6 CoSoftCircleBox)
 const decisionRecord = useQuery<{ record?: { state?: string } }>({
   queryKey: ["/api/rounds", roundId, "invitations", id, "decision"],
   queryFn: async () => {
     if (!roundId || !id) return {};
     const res = await apiRequest("GET", `/api/rounds/${roundId}/invitations/${id}/decision`);
     if (!res.ok) return {};
     return res.json();
   },
   enabled: !!roundId && !!id,
 });

 const [acceptOpen, setAcceptOpen] = useState(false);
 const [declineOpen, setDeclineOpen] = useState(false);
 // Sign term sheet state
 const [signOpen, setSignOpen] = useState(false);
 const [signName, setSignName] = useState("");
 const [signAck, setSignAck] = useState(false);
 const [amount, setAmount] = useState("250000");
 const [note, setNote] = useState("");
 const [signerName, setSignerName] = useState("");
 // Defect 6 fix: signerEmail from session identity, not hardcoded
 const [signerEmail, setSignerEmail] = useState("");
 const [ack, setAck] = useState(false);
 const softCircleSigs = useTermSheetStore((s) => s.softCircleSigs);
 const saveSoftCircleSig = useTermSheetStore.getState().saveSoftCircleSig;
 const mySoftCircleId = `sc-${id}`;
 const mySig = softCircleSigs[mySoftCircleId];

 // Prefill signer email from session once available (Defect 6)
 useEffect(() => {
  const email = entitlementCtx?.identity?.email;
  if (email && !signerEmail) {
   setSignerEmail(email);
  }
 }, [entitlementCtx?.identity?.email]);

 // Decision mutation helper
 const decisionMutation = useMutation({
  mutationFn: async (patch: Record<string, unknown>) => {
   if (!inv.data) throw new Error("no invitation");
   const res = await apiRequest(
    "PATCH",
    `/api/rounds/${inv.data.round.id}/invitations/${inv.data.id}/decision`,
    patch,
   );
   if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "decision_failed");
   }
   return res.json();
  },
  onError: (err: Error) => {
   // noop_transition:viewed is benign — the server already recorded the view on a prior mount
   if (/noop_transition/i.test(err.message)) return;
   toast({ title: "Action failed", description: "Please try again. If this continues, contact support.", variant: "destructive" });
  },
 });

 useEffect(() => {
  if (!inv.data) return;
  // Defect 19: record viewedAt on the server
  decisionMutation.mutate({ action: "view" });
  emit({ type: "invitation.viewed", payload: { invitationId: `inv-${inv.data.id}` } }, { companyId: inv.data.company.id ?? "co-x", roundId: inv.data.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
 }, [inv.data?.id]);

 if (!inv.data) return <PageBody>Loading…</PageBody>;
 const i = inv.data;
 const pct = (i.raisedAmount / i.targetAmount) * 100;
 // Defect 7 fix: guard against totalShares <= 0 to avoid garbage percentages
 const rawTotalShares = asArray(sec.data).reduce((s, x) => s + x.shares, 0);
 const totalShares = rawTotalShares > 0 ? rawTotalShares : null;
 const captableRows = totalShares
  ? asArray(sec.data).map(x => ({ ...x, ownership: (x.shares / totalShares) * 100 }))
  : [];

 // B6: check if investor has soft-circled (from local term-sheet store OR decision record)
 const hasSoftCircled =
   (mySig && !mySig.withdrawn) ||
   decisionRecord.data?.record?.state === "soft_circled" ||
   decisionRecord.data?.record?.state === "confirmed" ||
   decisionRecord.data?.record?.state === "signed" ||
   decisionRecord.data?.record?.state === "funded";

 // v24.3 — a CONFIRMED (signed) soft-circle means the investor now needs the
 // founder's wire instructions so they know where to send funds. Also treat
 // downstream states (signed/funded) as confirmed for visibility.
 const isConfirmed =
   decisionRecord.data?.record?.state === "confirmed" ||
   decisionRecord.data?.record?.state === "signed" ||
   decisionRecord.data?.record?.state === "funded";

 const wireInstr = useQuery<WireInstructions | null>({
   queryKey: [`/api/investor/rounds/${roundId}/wire-instructions`],
   queryFn: async () => {
     // Use apiRequest so the session cookie travels with the call and the
     // proxy prefix is applied. A 404 ("founder hasn't shared yet") is a
     // normal empty state, so we catch it rather than surfacing an error.
     try {
       const res = await apiRequest("GET", `/api/investor/rounds/${roundId}/wire-instructions`);
       const json = await res.json();
       return (json?.wireInstructions ?? null) as WireInstructions | null;
     } catch (err) {
       if (err instanceof ApiError && err.status === 404) return null;
       throw err;
     }
   },
   enabled: !!roundId && isConfirmed,
   retry: false,
 });

 const copyAccountNumber = useCallback(() => {
   const acct = wireInstr.data?.accountNumber;
   if (!acct) return;
   try {
     navigator.clipboard?.writeText(acct);
     toast({ title: "Copied", description: "Account number copied to clipboard." });
   } catch {
     toast({ title: "Copy failed", description: "Select and copy the account number manually.", variant: "destructive" });
   }
 }, [wireInstr.data, toast]);

 // B5: handler for the Soft-Circle button — navigates to Your Decision tab + scrolls
 const handleSoftCircleClick = () => {
   setActiveTab("decision");
   // Brief delay to allow tab render before scrolling
   setTimeout(() => {
     softCircleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
   }, 120);
 };

 return (
  <>
   <PageHeader
    title={i.company.name}
    description={`${i.round.name} · ${i.company.sector}`}
    breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { href: "/investor/invitations", label: "Invitations" }, { label: i.company.name }]}
    actions={
     <>
      <GlossaryLink />
      <Link href="/investor/invitations">
       <Button variant="ghost" data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-2" /> All invitations</Button>
      </Link>
     </>
    }
   />
   <PageBody>
    {/* Header strip */}
    <Card className="mb-6">
     <CardContent className="p-5">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
       <div className="h-14 w-14 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center text-lg font-semibold shrink-0">
        {i.company.name.split(" ").map(s => s[0]).slice(0, 2).join("")}
       </div>
       <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
         <h2 className="text-xl font-semibold">{i.company.name}</h2>
         <StateBadge state={i.state} />
         <Badge variant="outline" className="text-[10px] capitalize">{i.round.type.replace("_", " ")}</Badge>
        </div>
        <div className="text-sm text-muted-foreground mt-1">{i.company.sector} · invited {fmtDate(i.receivedAt)} · expires {fmtDate(i.expiresAt)}</div>
       </div>
       <div className="flex gap-2 shrink-0 flex-wrap">
        <Button variant="outline" onClick={() => setDeclineOpen(true)} data-testid="button-decline"><X className="h-4 w-4 mr-2" /> Decline</Button>
        {/* B5: Soft-circle button navigates to Your Decision tab */}
        <Button
          onClick={handleSoftCircleClick}
          className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
          data-testid="button-accept"
        >
          <Check className="h-4 w-4 mr-2" /> Soft-circle
        </Button>
        {/* DEF-013: Sign Term Sheet trigger — visible when invitation state is confirmed */}
        {(i.state === "confirmed" || i.state === "soft_circled") && (
         <Button
          onClick={() => setSignOpen(true)}
          variant="outline"
          className="border-[hsl(184_98%_22%)] text-[hsl(184_98%_22%)]"
          data-testid="button-open-sign"
         >
          <ShieldCheck className="h-4 w-4 mr-2" /> Sign Term Sheet
         </Button>
        )}
       </div>
      </div>
     </CardContent>
    </Card>

    {/* B4: URL-synced tabs via value + onValueChange */}
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="space-y-4">
     <TabsList className="grid grid-cols-5 h-auto">
      <TabsTrigger value="overview" data-testid="tab-overview" className="py-2">Overview</TabsTrigger>
      <TabsTrigger value="captable" data-testid="tab-captable" className="py-2">Cap Table</TabsTrigger>
      <TabsTrigger value="terms" data-testid="tab-terms" className="py-2">Investment Terms</TabsTrigger>
      <TabsTrigger value="dataroom" data-testid="tab-dataroom" className="py-2">Data Room</TabsTrigger>
      <TabsTrigger value="decision" data-testid="tab-decision" className="py-2">Your Decision</TabsTrigger>
     </TabsList>

     {/* TAB 1 — OVERVIEW */}
     <TabsContent value="overview" className="space-y-5">
      <TabIntro>Read the company's pitch and decide if it's worth a closer look.</TabIntro>
      <div className="grid md:grid-cols-3 gap-4">
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Round target</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.targetAmount, { compact: true })}</div>
        <div className="text-xs text-muted-foreground mt-1">{fmtUSD(i.raisedAmount, { compact: true })} soft-circled · {fmtPct(pct, 0)}</div>
        <div className="h-2 mt-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-[hsl(184_98%_22%)]" style={{ width: `${Math.min(100, pct)}%` }} /></div>
       </CardContent></Card>
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Pre / post-money</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.preMoney, { compact: true })}</div>
        <div className="text-xs text-muted-foreground mt-1">Post: {fmtUSD(i.postMoney, { compact: true })} · ${i.pricePerShare?.toFixed(2)}/sh</div>
       </CardContent></Card>
       <Card><CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium">Min ticket</div>
        <div className="text-2xl font-semibold mt-1">{fmtUSD(i.minTicket, { compact: true })}</div>
        <div className="text-xs text-muted-foreground mt-1">Pro-rata for $250k+ investors</div>
       </CardContent></Card>
      </div>

      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">About the company</CardTitle></CardHeader>
       <CardContent className="space-y-4 text-sm">
        {/* Defect 18 fix: render company description from API data */}
        <p>
         {(i.company as { description?: string }).description ||
          `${i.company.name} is participating in a ${i.round.name.toLowerCase()} round on Capavate. No description available.`}
        </p>
        <div className="grid md:grid-cols-3 gap-3 pt-3 border-t border-border">
         <div><div className="text-xs text-muted-foreground">Founded</div><div className="font-medium">{(i.company as {founded?: string}).founded ?? "—"}</div></div>
         <div><div className="text-xs text-muted-foreground">Headquarters</div><div className="font-medium">{(i.company as {headquarters?: string}).headquarters ?? "—"}</div></div>
         <div><div className="text-xs text-muted-foreground">Team size</div><div className="font-medium">{(i.company as {teamSize?: string}).teamSize ?? "—"}</div></div>
        </div>
        <div className="pt-3 border-t border-border">
         <div className="text-xs text-muted-foreground mb-1">Traction (last 90 days)</div>
         <ul className="space-y-1.5">
          {((i.round as {highlights?: string[]}).highlights ?? ["ARR data not available", "NRR data not available", "Compliance status not available"]).map((h, idx) => (
           <li key={idx} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-600" /> {h}</li>
          ))}
         </ul>
        </div>
       </CardContent>
      </Card>

      {/* DEF-021 fix: source "Why now" from round.whyNow API field */}
      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">Why now</CardTitle></CardHeader>
       <CardContent className="text-sm space-y-2">
        {i.round.whyNow ? (
         <p>{i.round.whyNow}</p>
        ) : (
         <p className="text-muted-foreground italic">Founder has not published a "Why now" statement yet.</p>
        )}
        {i.round.leadInvestorNote && (
         <p className="text-muted-foreground">{i.round.leadInvestorNote}</p>
        )}
       </CardContent>
      </Card>

      {/* B6: Co-Soft-Circle members box — only when soft-circled */}
      {companyId && roundId && (
        <CoSoftCircleBox roundId={roundId} hasSoftCircled={!!hasSoftCircled} />
      )}

      {/* B7: Founder Q&A box */}
      {roundId && <FounderQABox roundId={roundId} />}
     </TabsContent>

     {/* TAB 2 — CAP TABLE */}
     <TabsContent value="captable" className="space-y-5">
      <TabIntro>See who else is on the cap table and what they own.</TabIntro>
      <Card>
       <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
         <CardTitle className="text-base flex items-center gap-2"><PieIcon className="h-4 w-4" /> Pre-money cap table</CardTitle>
         <p className="text-sm text-muted-foreground mt-0.5">Fully-diluted view, shared with you under R165 §4 redaction policy.</p>
        </div>
        <Badge variant="outline" className="text-[10px]"><ShieldCheck className="h-3 w-3 mr-1" /> Redacted to investor-grade</Badge>
       </CardHeader>
       <CardContent>
        <div className="flex h-10 rounded-md overflow-hidden border border-border mb-4">
         {captableRows.map(r => (
          <div key={r.id} className="relative group" style={{ width: `${r.ownership}%`, backgroundColor: INSTRUMENT_COLORS[r.instrument] }} title={`${r.holderName} · ${fmtPct(r.ownership, 2)}`} />
         ))}
        </div>
        <table className="w-full text-sm" data-testid="table-investor-captable">
         <thead>
          <tr className="text-xs uppercase text-muted-foreground border-b border-border">
           <th className="text-left font-medium py-2">Holder</th>
           <th className="text-left font-medium py-2">Instrument</th>
           <th className="text-right font-medium py-2">Shares</th>
           <th className="text-right font-medium py-2 w-40">Ownership</th>
          </tr>
         </thead>
         <tbody>
          {captableRows.map(r => (
           <tr key={r.id} className="border-b border-border/60">
            <td className="py-2.5">
             <div className="font-medium">{r.holderName}</div>
             <div className="text-xs text-muted-foreground capitalize">{r.holderType}</div>
            </td>
            <td className="py-2.5 capitalize">{r.instrument}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{fmtNum(r.shares)}</td>
            <td className="py-2.5 text-right font-mono tabular-nums">{fmtPct(r.ownership, 2)}</td>
           </tr>
          ))}
         </tbody>
        </table>
       </CardContent>
      </Card>

      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">Your post-round position (illustrative)</CardTitle></CardHeader>
       <CardContent className="text-sm">
        <p className="text-muted-foreground mb-3">Assuming you commit at the {fmtUSD(Number(amount) || i.minTicket)} level on a {fmtUSD(i.preMoney, { compact: true })} pre-money:</p>
        <div className="grid md:grid-cols-3 gap-3">
         <div><div className="text-xs text-muted-foreground">Shares purchased</div><div className="font-mono tabular-nums font-medium">{fmtNum(Math.round((Number(amount) || i.minTicket) / (i.pricePerShare || 1)))}</div></div>
         <div><div className="text-xs text-muted-foreground">Implied ownership</div><div className="font-mono tabular-nums font-medium">{fmtPct(((Number(amount) || i.minTicket) / i.postMoney) * 100, 3)}</div></div>
         <div><div className="text-xs text-muted-foreground">Pro-rata reservation</div><div className="font-mono tabular-nums font-medium">{Number(amount) >= 250000 ? "Yes" : "No"}</div></div>
        </div>
       </CardContent>
      </Card>
     </TabsContent>

     {/* TAB 3 — INVESTMENT TERMS */}
     <TabsContent value="terms" className="space-y-5">
      <TabIntro>The deal terms — instrument, valuation, and the preferences that decide who gets paid first on an exit.</TabIntro>
      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Headline terms</CardTitle></CardHeader>
       <CardContent className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {/* DEF-022 fix: source liquidation pref / anti-dilution / pro-rata / board from round.terms */}
        {([
         ["Instrument", "Series Seed Preferred Stock", "Investor shares with extra rights compared to Common: liquidation preference, anti-dilution, board seats, information rights."],
         ["Pre-money valuation", fmtUSD(i.preMoney), "The company's value before this round's new money lands."],
         ["Post-money valuation", fmtUSD(i.postMoney), "Pre-money plus the round size — the company's value the instant the round closes."],
         ["Round size", fmtUSD(i.targetAmount), "Total new money the company is targeting in this round."],
         ["Price per share", `$${i.pricePerShare?.toFixed(4)}`, "The cost of one share in this round, set by pre-money divided by fully-diluted shares."],
         ["Min ticket", fmtUSD(i.minTicket), "The smallest cheque the founder will accept."],
         ["Liquidation preference", i.round.terms?.liquidationPref ?? "Not specified", "On exit you receive your invested capital back BEFORE common shareholders — OR you convert to common and share pro-rata, whichever is better. 1× non-participating is the founder-friendly standard."],
         ["Anti-dilution", i.round.terms?.antiDilution ?? "Not specified", "If the company later raises at a lower valuation, your conversion ratio adjusts in your favour. Broad-based weighted-average is the gentle, mainstream version."],
         ["Pro-rata rights", i.round.terms?.proRataMinimum ?? "Not specified", "The right to participate in future rounds at an amount that maintains your current ownership %."],
         ["Board composition", i.round.terms?.boardComposition ?? "Not specified", "How the board of directors is structured."],
         ["Information rights", "Quarterly financials + KPI dashboard", "What financial reporting the company commits to share with you."],
         ["ESOP top-up", "10% post-money pool refresh", "Size of the new employee option pool created at this round. Pool timing affects who is diluted by it."],
        ] as Array<[string, string, string]>).map(([k, v, tip]) => (
         <div key={k} className="flex justify-between border-b border-border/60 py-1.5 gap-3">
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
           {k}
           <HelpTip>{tip}</HelpTip>
          </span>
          <span className="font-medium text-right">{v}</span>
         </div>
        ))}
       </CardContent>
      </Card>

      {/* DEF-023 fix: source use-of-proceeds from round.useOfProceeds API field */}
      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">Use of proceeds</CardTitle></CardHeader>
       <CardContent>
        {(!i.round.useOfProceeds || i.round.useOfProceeds.length === 0) ? (
         <p className="text-sm text-muted-foreground italic">Founder has not published use-of-proceeds data yet.</p>
        ) : (
         <div className="space-y-3">
          {i.round.useOfProceeds.map(u => (
           <div key={u.category}>
            <div className="flex justify-between text-sm mb-1"><span>{u.category}</span><span className="font-mono tabular-nums">{u.percent}%</span></div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-[hsl(184_98%_22%)]" style={{ width: `${u.percent}%` }} /></div>
           </div>
          ))}
         </div>
        )}
       </CardContent>
      </Card>

      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">Round timeline</CardTitle></CardHeader>
       <CardContent>
        {/* Defect 17 fix: derive dates from round data */}
        <ol className="relative border-l border-border ml-2 space-y-4">
         {[
          { d: (i.round as { createdAt?: string }).createdAt ?? i.receivedAt, t: "Invitation sent" },
          { d: i.receivedAt, t: "Soft-circle book opens" },
          { d: i.expiresAt, t: "Soft-circle book closes" },
          { d: (i.round as { closeDate?: string }).closeDate ?? i.expiresAt, t: "Definitive docs + wire instructions" },
         ].map((s, idx) => (
          <li key={idx} className="ml-4">
           <div className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-[hsl(184_98%_22%)]" />
           <div className="text-xs text-muted-foreground">{fmtDate(s.d)}</div>
           <div className="font-medium text-sm">{s.t}</div>
          </li>
         ))}
        </ol>
       </CardContent>
      </Card>
     </TabsContent>

     {/* TAB 4 — DATA ROOM */}
     <TabsContent value="dataroom" className="space-y-5">
      <TabIntro>Sensitive documents the founder is sharing for diligence. Every view is logged.</TabIntro>
      <Card>
       <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div>
         <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Files shared with you</CardTitle>
         <p className="text-sm text-muted-foreground mt-0.5">All access is logged in the company's audit ledger. Watermarked on download.</p>
        </div>
        <Badge variant="outline" className="text-[10px]"><Eye className="h-3 w-3 mr-1" /> Read-only</Badge>
       </CardHeader>
       <CardContent className="px-0">
        <table className="w-full text-sm" data-testid="table-dataroom">
         <thead>
          <tr className="text-xs uppercase text-muted-foreground border-b border-border">
           <th className="text-left font-medium px-5 py-2.5">Name</th>
           <th className="text-left font-medium px-3 py-2.5">Category</th>
           <th className="text-left font-medium px-3 py-2.5">Uploaded</th>
           <th className="text-right font-medium px-3 py-2.5">Size</th>
           <th className="text-right font-medium px-5 py-2.5"></th>
          </tr>
         </thead>
         <tbody>
          {dr.data?.slice(0, 8).map(f => (
           <tr key={f.id} className="border-b border-border/60" data-testid={`row-dr-${f.id}`}>
            <td className="px-5 py-2.5 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> {f.name}</td>
            <td className="px-3 py-2.5 text-muted-foreground capitalize">{f.category.replace("_", " ")}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(f.uploadedAt)}</td>
            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{fmtBytes(f.sizeBytes)}</td>
            <td className="px-5 py-2.5 text-right">
             {/* Defect 16 fix: wire onClick to open/download file */}
             <div className="inline-flex gap-1">
              <Button size="sm" variant="ghost" data-testid={`button-view-dr-${f.id}`}
               onClick={() => { if ((f as { url?: string }).url) window.open((f as { url?: string }).url, "_blank", "noopener,noreferrer"); }}
              ><Eye className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" data-testid={`button-dl-dr-${f.id}`}
               onClick={() => {
                const url = (f as { url?: string; downloadUrl?: string }).downloadUrl ?? (f as { url?: string }).url;
                if (url) {
                 const a = document.createElement("a"); a.href = url; a.download = f.name; a.click();
                }
               }}
              ><Download className="h-3.5 w-3.5" /></Button>
             </div>
            </td>
           </tr>
          ))}
         </tbody>
        </table>
       </CardContent>
      </Card>
     </TabsContent>

     {/* TAB 5 — YOUR DECISION */}
     <TabsContent value="decision" className="space-y-5">
      <TabIntro>Indicate interest with a soft-circle amount or decline politely. Soft-circles are non-binding indications of interest — not contracts.</TabIntro>

      {/* v24.3 — Wire Transfer Instructions. Shown once the soft-circle is
          CONFIRMED (signed), so the investor knows where to send funds.
          Addresses Avi's main v24.3 complaint. */}
      {isConfirmed && (
       <Card className="border-[hsl(184_98%_22%)]/40" data-testid="card-wire-instructions-investor">
        <CardHeader className="pb-3">
         <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Wire Transfer Instructions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
         {wireInstr.isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
         ) : wireInstr.data ? (
          <div className="space-y-3" data-testid="investor-wire-display">
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            <div><span className="text-muted-foreground">Bank</span><div className="font-medium">{wireInstr.data.bankName}</div></div>
            <div><span className="text-muted-foreground">Account name</span><div className="font-medium">{wireInstr.data.accountName}</div></div>
            <div>
             <span className="text-muted-foreground">Account number</span>
             <div className="font-mono flex items-center gap-2">
              <span data-testid="investor-wire-accountNumber">{wireInstr.data.accountNumber}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={copyAccountNumber} data-testid="button-copy-account-number">
               <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </Button>
             </div>
            </div>
            {wireInstr.data.routingNumber && <div><span className="text-muted-foreground">Routing</span><div className="font-mono">{wireInstr.data.routingNumber}</div></div>}
            {wireInstr.data.swift && <div><span className="text-muted-foreground">SWIFT/BIC</span><div className="font-mono">{wireInstr.data.swift}</div></div>}
            {wireInstr.data.reference && <div><span className="text-muted-foreground">Reference</span><div className="font-medium">{wireInstr.data.reference}</div></div>}
           </div>
           {wireInstr.data.notes && (
            <div className="p-3 rounded-md bg-secondary/40 border border-border text-xs">
             <span className="font-semibold">Note from the founder: </span>{wireInstr.data.notes}
            </div>
           )}
           <div className="text-xs text-muted-foreground">Always confirm these details with the founder via Messages before sending a wire.</div>
          </div>
         ) : (
          <div className="text-muted-foreground" data-testid="investor-wire-empty">
           The founder hasn't shared wire instructions yet. Reach out via Messages.
          </div>
         )}
        </CardContent>
       </Card>
      )}

      {/* B3: Previous engagement history panel ABOVE the decision form */}
      {companyId && (
        <InvestmentHistoryPanel companyId={companyId} companyName={i.company.name} />
      )}

      <div className="flex items-start gap-2 p-3 rounded-md border border-[hsl(184_98%_22%)]/30 bg-[hsl(184_98%_22%)]/5 text-xs leading-relaxed">
       <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
       <div>
        <span className="font-semibold">Soft-circle commitment — non-binding indication of interest.</span> A binding subscription requires definitive transaction documents executed by both parties. You can withdraw before the deadline.
       </div>
      </div>

      {/* Recorded soft-circle (success card) */}
      {mySig && !mySig.withdrawn && (
       <Card className="border-emerald-300/40 bg-emerald-50/30 " data-testid="card-softcircle-recorded">
        <CardHeader className="pb-3">
         <CardTitle className="text-base flex items-center gap-2 text-emerald-700 "><ShieldCheck className="h-4 w-4" /> Soft-circle recorded</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
         <div>You indicated <strong>{fmtUSD(mySig.amount)}</strong> in the {i.round.name} round.</div>
         <div className="flex items-center gap-1.5 text-xs font-mono" data-testid="text-softcircle-hash">
          <Hash className="h-3 w-3" /> Verifiable hash: <span className="break-all">{mySig.signature.hash}</span>
         </div>
         <div className="text-xs text-muted-foreground">You can withdraw before {fmtDate(i.expiresAt)} by clicking <strong>Withdraw soft-circle</strong>.</div>
         <Button size="sm" variant="outline" onClick={() => {
          saveSoftCircleSig({ ...mySig, withdrawn: true });
          emit({ type: "softcircle.cancelled", payload: { softCircleId: mySig.softCircleId, reason: "investor withdrew" } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
          toast({ title: "Soft-circle withdrawn", variant: "destructive" });
         }} data-testid="button-withdraw-softcircle"><Undo2 className="h-3.5 w-3.5 mr-1" />Withdraw soft-circle</Button>
        </CardContent>
       </Card>
      )}

      {/* B5: Scroll target for Soft-Circle button (ref placed at top of form) */}
      <div ref={softCircleFormRef} />

      <div className="grid md:grid-cols-2 gap-5">
       <Card className="border-[hsl(184_98%_22%)]/40">
        <CardHeader className="pb-3"><CardTitle className="text-base text-[hsl(184_98%_22%)] ">{mySig && !mySig.withdrawn ? "Update soft-circle" : "Soft-circle this round"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
         <div>
          <Label>Investment amount (USD)</Label>
          <Input className="mt-1 font-mono" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-amount" />
          <div className="text-xs text-muted-foreground mt-1">Min ticket {fmtUSD(i.minTicket)}. Pro-rata available at $250k+.</div>
         </div>
         <div>
          <Label>Your full legal name (typed signature)</Label>
          <Input className="mt-1" placeholder="Your full legal name" value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="input-investor-signer-name" />
         </div>
         <div>
          <Label>Your email</Label>
          <Input className="mt-1" placeholder="you@firm.com" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="input-investor-signer-email" />
         </div>
         <div>
          <Label>Note to founder (optional)</Label>
          <Textarea rows={2} className="mt-1" value={note} onChange={e => setNote(e.target.value)} placeholder="Looking forward to partnering." data-testid="input-note" />
         </div>
         <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed">
          I, <strong>{signerName.trim() || "[Typed Name]"}</strong>, indicate my intention to invest <strong>{fmtUSD(Number(amount) || 0)}</strong> in <strong>{i.company.name}</strong>'s <strong>{i.round.name}</strong> round at the terms stated. This soft-circle is a non-binding indication of interest, not a contract. A binding subscription requires definitive transaction documents executed by both parties.
         </div>
         <label className="flex items-start gap-2 text-xs cursor-pointer">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="checkbox-investor-ack" />
          <span>I acknowledge this is a non-binding indication of interest.</span>
         </label>
         <Button
          className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white h-11"
          onClick={async () => {
           if (!signerName.trim()) { toast({ title: "Type your full legal name", variant: "destructive" }); return; }
           if (!ack) { toast({ title: "Acknowledge before submitting", variant: "destructive" }); return; }
           const meta = captureSessionMetadata();
           const prevHash = mySig?.signature.hash ?? "0".repeat(64);
           const sig = signSES({
            documentId: mySoftCircleId,
            documentType: "softcircle",
            signerName: signerName.trim(),
            signerEmail: signerEmail.trim(),
            signerRole: "investor",
            intentText: `Soft-circle ${fmtUSD(Number(amount) || 0)} into ${i.company.name} ${i.round.name}. Non-binding indication of interest.`,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            timestamp: meta.timestamp,
            sessionId: meta.sessionId,
            prevHash,
           });
           // Defect 3 fix: call PATCH to persist soft-circle on server. Roll back on failure.
           try {
            await decisionMutation.mutateAsync({
             action: "soft_circle",
             amount: Number(amount) || 0,
             currency: "USD",
             softCircleType: "indication",
             note: note.trim() || undefined,
             sesContext: { typedName: signerName.trim(), timestamp: meta.timestamp, ipBucket: meta.ipAddress },
            });
           } catch {
            // Error already toasted by mutation onError
            return;
           }
           saveSoftCircleSig({
            softCircleId: mySoftCircleId,
            roundId: i.round.id,
            invitationId: i.id,
            signature: sig,
            amount: Number(amount) || 0,
            withdrawn: false,
           });
           emit({ type: "invitation.soft_circled", payload: { invitationId: `inv-${i.id}`, amount: String(Number(amount) || 0) } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
           emit({ type: "softcircle.created", payload: { softCircleId: mySoftCircleId, roundId: i.round.id, investorId: "investor-current", amount: String(Number(amount) || 0) } }, { companyId: i.company.id ?? "co-x", roundId: i.round.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
           toast({ title: "Soft-circle recorded. Founder notified.", description: `Verifiable hash ${sig.hash.slice(0, 16)}…` });
           setAck(false);
          }}
          data-testid="button-submit-softcircle"
         >
          <ShieldCheck className="h-4 w-4 mr-2" /> Submit soft-circle ({fmtUSD(Number(amount) || 0)})
         </Button>
        </CardContent>
       </Card>

       <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Pass on this round</CardTitle></CardHeader>
        <CardContent className="space-y-3">
         <p className="text-sm text-muted-foreground">If this isn't a fit, let the founder know. Your decline is private to {i.company.name}.</p>
         <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm">
          <div className="font-medium mb-1">Common reasons</div>
          <ul className="text-muted-foreground space-y-1">
           <li>· Stage too early / too late</li>
           <li>· Outside thesis</li>
           <li>· Pass for now, revisit at next round</li>
          </ul>
         </div>
         <Button variant="outline" className="w-full h-11" onClick={() => setDeclineOpen(true)} data-testid="button-pass">
          <X className="h-4 w-4 mr-2" /> Decline politely
         </Button>
        </CardContent>
       </Card>
      </div>

      <Card>
       <CardHeader className="pb-3"><CardTitle className="text-base">Decision history</CardTitle></CardHeader>
       <CardContent>
        <ul className="space-y-2 text-sm">
         <li className="flex justify-between border-b border-border/60 py-2"><span>Invitation received</span><span className="text-muted-foreground">{fmtDate(i.receivedAt)}</span></li>
         {/* Defect 19 fix: show viewedAt from decision store, not receivedAt */}
         <li className="flex justify-between border-b border-border/60 py-2">
          <span>You opened the deal</span>
          <span className="text-muted-foreground" data-testid="text-viewed-at">
           {decisionMutation.data?.record?.viewedAt
            ? fmtDate(decisionMutation.data.record.viewedAt)
            : fmtDate(i.receivedAt)}
          </span>
         </li>
         <li className="flex justify-between py-2"><span className="text-muted-foreground">Decision deadline</span><span className="font-medium">{fmtDate(i.expiresAt)}</span></li>
        </ul>
       </CardContent>
      </Card>
     </TabsContent>
    </Tabs>

    {/* Soft-circle confirm */}
    <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
     <AlertDialogContent>
      <AlertDialogHeader>
       <AlertDialogTitle>Soft-circle {fmtUSD(Number(amount) || 0)}?</AlertDialogTitle>
       <AlertDialogDescription>
        This signals intent to invest at the listed terms. The founder will be notified. You can confirm or withdraw before docs are signed.
       </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
       <AlertDialogCancel>Cancel</AlertDialogCancel>
       {/* Defect 4 fix: call PATCH with action:\"confirm\" BEFORE emitting bridge events */}
       <AlertDialogAction onClick={async () => {
        try {
         await decisionMutation.mutateAsync({ action: "confirm" });
        } catch {
         return; // error already toasted
        }
        const invId = `inv-${i.id}`;
        const scId = `sc-${i.id}-${Date.now()}`;
        emit({ type: "invitation.soft_circled", payload: { invitationId: invId, amount: String(i.minTicket ?? 100000) } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        emit({ type: "softcircle.created", payload: { softCircleId: scId, roundId: i.round?.id ?? "r1", investorId: "investor-current", amount: String(i.minTicket ?? 100000) } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        toast({ title: "Soft-circled", description: `${i.company.name} has been notified.` });
        setAcceptOpen(false);
       }} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)]" data-testid="button-confirm-soft">
        Confirm soft-circle
       </AlertDialogAction>
      </AlertDialogFooter>
     </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
     <AlertDialogContent>
      <AlertDialogHeader>
       <AlertDialogTitle>Decline this invitation?</AlertDialogTitle>
       <AlertDialogDescription>
        The founder will see your decline (without your reason). You can leave a private note if helpful.
       </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
       <AlertDialogCancel>Keep open</AlertDialogCancel>
       {/* Defect 5 fix: call PATCH with action:\"decline\" to persist on server */}
       <AlertDialogAction onClick={async () => {
        try {
         await decisionMutation.mutateAsync({ action: "decline" });
        } catch {
         return; // error already toasted
        }
        emit({ type: "invitation.declined", payload: { invitationId: `inv-${i.id}`, reason: "investor declined" } }, { companyId: i.company.id ?? "co-x", roundId: i.round?.id, actorId: entitlementCtx?.userId ?? "investor-current", actorRole: "investor" });
        // Invalidate invitations list so it reflects the new declined state
        queryClient.invalidateQueries({ queryKey: ["/api/investor/invitations"] });
        toast({ title: "Invitation declined", variant: "destructive" });
        setDeclineOpen(false);
       }} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-decline">
        Decline
       </AlertDialogAction>
      </AlertDialogFooter>
     </AlertDialogContent>
    </AlertDialog>

    {/* Defect 33: Sign term sheet — SES evidence dialog (no window.confirm/alert) */}
    <Dialog open={signOpen} onOpenChange={setSignOpen}>
     <DialogContent>
      <DialogHeader>
       <DialogTitle>Sign term sheet</DialogTitle>
       <DialogDescription>
        Review the term sheet summary below. By typing your full legal name and checking the box,
        you provide electronic signature evidence (SES) for this commitment.
       </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
       <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed">
        <div className="font-medium mb-1">Term sheet summary</div>
        <div>Company: <strong>{i.company.name}</strong></div>
        <div>Round: <strong>{i.round.name}</strong></div>
        <div>Pre-money: <strong>{fmtUSD(i.preMoney)}</strong></div>
        <div>Target: <strong>{fmtUSD(i.targetAmount)}</strong></div>
       </div>
       <div className="space-y-1.5">
        <Label>Your full legal name (typed signature)</Label>
        <Input value={signName} onChange={e => setSignName(e.target.value)} placeholder="Legal name" data-testid="input-sign-name" />
       </div>
       <label className="flex items-start gap-2 text-xs cursor-pointer">
        <Checkbox checked={signAck} onCheckedChange={v => setSignAck(!!v)} data-testid="checkbox-sign-ack" />
        <span>I confirm I have read the term sheet and intend to sign this document. This constitutes my electronic signature.</span>
       </label>
      </div>
      <DialogFooter>
       <Button variant="outline" onClick={() => setSignOpen(false)}>Cancel</Button>
       <Button
        disabled={!signName.trim() || !signAck || decisionMutation.isPending}
        onClick={async () => {
         if (!signName.trim() || !signAck) return;
         const meta = captureSessionMetadata();
         try {
          await decisionMutation.mutateAsync({
           action: "sign",
           sesContext: { typedName: signName.trim(), timestamp: meta.timestamp, ipBucket: meta.ipAddress },
          });
          toast({ title: "Term sheet signed", description: "Your signature has been recorded." });
          setSignOpen(false);
         } catch { /* error already toasted */ }
        }}
        className="bg-[hsl(184_98%_22%)] text-white"
        data-testid="button-confirm-sign"
       >
        Sign term sheet
       </Button>
      </DialogFooter>
     </DialogContent>
    </Dialog>
   </PageBody>
  </>
 );
}
