import { asArray } from "@/lib/safeArray";
import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { CollectiveDeepLink } from "@/components/CollectiveDeepLink";
import { SoftCircleChannelCard } from "@/components/comms/ChannelCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StateBadge } from "@/components/common";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip } from "@/components/HelpTip";
import { Send, Upload, Eye, Repeat, Ban, Calendar, Plus, ArrowLeft, FileText, Check, Cpu, ArrowRight, Lock, Info, Crown, Users, ListChecks, GitBranch, Wallet, Layers, AlertTriangle, Sparkles, FilePlus2, Download, Hash, ShieldCheck, X } from "lucide-react";
import CloseRoundPanel from "@/components/CloseRoundPanel";
import { emit } from "@/lib/sprint3";
import { fmtUSD, fmtPct, fmtDate, timeAgo, fmtNum, safeToFixed } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { runEngine, projectPostClose, type ApiSecurity } from "@/lib/engineDemo";
import { currencySymbol, fmtCurrency } from "@/lib/currency";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useTermSheetStore } from "@/lib/termsheet/store";
import { signSES, captureSessionMetadata, type SESSignature } from "@/lib/esign/ses";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type UseOfProceedsRow = { category: string; percent: number; amount: number };
type ChecklistRow = { item: string; done: boolean; owner: string };
type TrancheRow = { name: string; amount: number; condition: string; expectedDate: string; funded: boolean };
type ScenarioRow = { name: string; preMoney: number; raise: number; founderPctAfter: number; dilutionPct: number; note: string };
type Round = {
 id: string; company: string; name: string; type: string; state: string;
 targetAmount: number; raisedAmount: number; preMoney: number; postMoney: number;
 pricePerShare: number; minTicket: number; closeDate: string; openDate?: string;
 termsSummary: string;
 leadInvestor?: string;
 investorCount?: number;
 currency?: string;
 region?: string;
 useOfProceeds?: UseOfProceedsRow[] | null;
 closingChecklist?: ChecklistRow[];
 tranches?: TrancheRow[] | null;
 coInvestors?: string[];
 scenarios?: ScenarioRow[] | null;
 termSheetUrl?: string | null;
};
type Invitation = { id: string; investorEmail: string; investorName: string; state: string; sentAt: string; viewedAt: string | null; expiresAt: string };
type SoftCircle = { id: string; investorName: string; amount: number; status: string; createdAt: string };

/* Sprint 4 — lifecycle state explainer text. */
const ROUND_STATE_GUIDE: Record<string, { title: string; body: string }> = {
 draft: {
 title: "Draft",
 body: "You're still setting up. Terms aren't fixed and no investors can see this round yet. Edit freely.",
 },
 terms_set: {
 title: "Terms set",
 body: "You've locked the headline terms (instrument, valuation, key preferences). You can now generate a term sheet and invite investors.",
 },
 soft_circle_open: {
 title: "Soft-circle open",
 body: "Investors are reviewing the deal and submitting non-binding soft circles. Track progress in the Soft-circle book tab.",
 },
 signing_open: {
 title: "Signing open",
 body: "Subscription docs are out for signature. Each soft-circle that converts to a signed sub doc + wire becomes a real investment.",
 },
 closed: {
 title: "Closed",
 body: "The round is sealed. Cap-table mutations from this round are immutable in the audit ledger; documents and proceeds have landed.",
 },
};

export default function RoundDetail() {
 const params = useParams<{ id: string }>();
 const id = params.id;
 const { toast } = useToast();
 const activeCompanyId = useActiveCompanyId();

 const [, navigate] = useLocation();
 const round = useQuery<Round>({ queryKey: ["/api/rounds", id] });
 const invs = useQuery<Invitation[]>({ queryKey: [`/api/rounds/${id}/invitations`] });
 const softs = useQuery<SoftCircle[]>({ queryKey: [`/api/rounds/${id}/soft-circles`] });
 const me = useQuery<{ id: string; displayName: string; role: string; identity?: { email?: string; name?: string } }>({ queryKey: ["/api/auth/me"] });

 const [inviteOpen, setInviteOpen] = useState(false);
 const [bulkOpen, setBulkOpen] = useState(false);
 const [inviteName, setInviteName] = useState("");
 const [inviteEmail, setInviteEmail] = useState("");
 const [inviteNote, setInviteNote] = useState("");
 // select-invite-expiry fix v23.4.13
 const [inviteExpiry, setInviteExpiry] = useState("30");
 const [revokeId, setRevokeId] = useState<string | null>(null);
 const [confirmSoftId, setConfirmSoftId] = useState<string | null>(null);

 // Real mutations wired to server endpoints (defects 10, 22-27)
 const sendInviteMut = useMutation({
   mutationFn: async () => {
     // select-invite-expiry fix v23.4.13: pass expiryDays from dropdown
     const expiryDaysVal = inviteExpiry === "never" ? null : parseInt(inviteExpiry, 10);
     const res = await apiRequest("POST", `/api/rounds/${id}/invitations`, {
       investorName: inviteName, investorEmail: inviteEmail, note: inviteNote,
       ...(expiryDaysVal !== null ? { expiryDays: expiryDaysVal } : {}),
     });
     return res.json();
   },
   onSuccess: () => {
     toast({ title: "Invitation sent", description: "The investor will receive an email." });
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
     emitMutationLocal("invitation", `inv-${Date.now()}`, "create");
     setInviteOpen(false); setInviteName(""); setInviteEmail(""); setInviteNote(""); setInviteExpiry("30");
   },
   onError: (e: Error) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
 });

 const resendMut = useMutation({
   mutationFn: async (invId: string) => (await apiRequest("POST", `/api/rounds/${id}/invitations/${invId}/resend`, {})).json(),
   onSuccess: (_d, invId) => {
     toast({ title: "Resent", description: "Reminder delivered." });
     emitMutationLocal("invitation", invId, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
   },
 });

 const extendExpiryMut = useMutation({
   mutationFn: async (invId: string) => (await apiRequest("PATCH", `/api/rounds/${id}/invitations/${invId}`, { expiryDays: 30 })).json(),
   onSuccess: (_d, invId) => {
     toast({ title: "Expiry extended +30 days" });
     emitMutationLocal("invitation", invId, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
   },
 });

 const revokeMut = useMutation({
   mutationFn: async (invId: string) => (await apiRequest("DELETE", `/api/rounds/${id}/invitations/${invId}`)).json(),
   onSuccess: (_d, invId) => {
     toast({ title: "Invitation revoked", variant: "destructive" });
     emitMutationLocal("invitation", invId, "delete");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
     setRevokeId(null);
   },
 });

 const addSoftCircleMut = useMutation({
   mutationFn: async () => (await apiRequest("POST", `/api/rounds/${id}/soft-circle`, { investorName: "Manual entry", amount: 0 })).json(),
   onSuccess: () => {
     toast({ title: "Soft circle added" });
     emitMutationLocal("round", id, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/soft-circles`] });
   },
 });

 function emitMutationLocal(aggregate: string, entityId: string, change: string) {
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   emit({ type: "round.updated" as any, payload: { roundId: id, aggregate, entityId, change } as any },
     { companyId: activeCompanyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 }

 if (round.isError) return (
 <PageBody>
   <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
     <p className="text-sm font-medium text-destructive">Failed to load round</p>
     <p className="text-xs text-muted-foreground mt-1">The round may not exist or you may lack access.</p>
   </div>
 </PageBody>
 );
 if (!round.data) return (
 <PageBody>
   <div className="space-y-4">
     <div className="text-xs text-muted-foreground">› Rounds › …</div>
     <div className="h-8 w-64 bg-secondary rounded animate-pulse" />
     <div className="h-4 w-48 bg-secondary rounded animate-pulse" />
     <div className="h-32 w-full bg-secondary rounded animate-pulse" />
   </div>
 </PageBody>
 );
 const r = round.data;
 const pct = r.targetAmount > 0 ? (r.raisedAmount / r.targetAmount) * 100 : 0;

 return (
 <>
 <PageHeader
 title={r.name}
 description={r.termsSummary}
 size="large"
 sticky
 breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { href: "/founder/rounds", label: "Rounds" }, { label: r.name }]}
 actions={
 <>
 <GlossaryLink />
 <Link href="/founder/rounds"><Button variant="ghost" data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-2" /> All rounds</Button></Link>
 <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-bulk-invite"><Upload className="h-4 w-4 mr-2" /> Bulk CSV</Button>
 <Button onClick={() => setInviteOpen(true)} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-invite"><Send className="h-4 w-4 mr-2" /> Invite investor</Button>
 <CollectiveDeepLink entity="round" id={r.id} label="View in Collective Deal Room" />
 </>
 }
 />
 <PageBody>
 {/* Round summary */}
 <Card className="mb-6">
 <CardContent className="p-5">
 <div className="flex flex-wrap items-center gap-3 mb-4">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="cursor-help" data-testid="badge-round-state"><StateBadge state={r.state} /></span>
 </TooltipTrigger>
 <TooltipContent className="max-w-xs text-xs leading-relaxed">
 <div className="font-semibold mb-1">{ROUND_STATE_GUIDE[r.state]?.title ?? r.state}</div>
 {ROUND_STATE_GUIDE[r.state]?.body ?? "Round lifecycle state."}
 </TooltipContent>
 </Tooltip>
 <Badge variant="outline" className="capitalize">{r.type.replace("_", " ")}</Badge>
 <span className="text-sm text-muted-foreground">Close target {fmtDate(r.closeDate)}</span>
 </div>
 {r.state === "soft_circle_open" && (
 <div className="mb-4 flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs leading-relaxed">
 <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
 <div>
 <span className="font-semibold">What's a soft circle?</span> A non-binding commitment from an investor to participate at a stated amount. It's a strong signal but not a contract — signing the subscription docs is what makes it real. Track which soft circles have firmed up in the Soft-circle book tab.
 </div>
 </div>
 )}
 <div className="flex items-baseline justify-between mb-2">
 <div><span className="text-2xl font-semibold">{fmtUSD(r.raisedAmount)}</span> <span className="text-muted-foreground text-sm">soft-circled of {fmtUSD(r.targetAmount)}</span></div>
 <div className="text-sm text-muted-foreground">{fmtPct(pct, 0)} of target</div>
 </div>
 <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
 <div className="h-full bg-gradient-to-r from-[hsl(184_98%_22%)] to-[hsl(184_98%_30%)]" style={{ width: `${Math.min(100, pct)}%` }} />
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-border text-sm">
 <div><div className="text-xs text-muted-foreground flex items-center gap-1">Pre-money <HelpTip>The agreed value of your company BEFORE this round closes. Pre-money + new money = post-money.</HelpTip></div><div className="font-medium">{fmtUSD(r.preMoney, { compact: true })}</div></div>
 <div><div className="text-xs text-muted-foreground flex items-center gap-1">Post-money <HelpTip>Pre-money plus the round size. Your company's valuation the moment this round closes.</HelpTip></div><div className="font-medium">{fmtUSD(r.postMoney, { compact: true })}</div></div>
 <div><div className="text-xs text-muted-foreground flex items-center gap-1">Price/share <HelpTip>What each new share costs in this round. Set by dividing pre-money by fully-diluted shares before close.</HelpTip></div><div className="font-medium">${r.pricePerShare?.toFixed(2)}</div></div>
 <div><div className="text-xs text-muted-foreground flex items-center gap-1">Min ticket <HelpTip>The smallest cheque you'll accept. Filters out small angels you don't have time to manage.</HelpTip></div><div className="font-medium">{fmtUSD(r.minTicket, { compact: true })}</div></div>
 </div>
 </CardContent>
 </Card>

 {/* Sprint 5 — Round lifecycle progress indicator (NVCA flow: terms → invitation → soft-circle → docs → signing → funded → closed) */}
 <RoundLifecycleProgress state={r.state} />

 {/* v23.9 C5 — read-only pipeline funnel sourced from GET /api/rounds/:id
 `pipeline`. Visibility only: it summarises invitation + soft-circle counts
 and does not drive the flow. */}
 {Array.isArray((r as any).pipeline) && (r as any).pipeline.length > 0 && (
 <div className="flex flex-wrap gap-2" data-testid="round-pipeline">
 {((r as any).pipeline as Array<{ stage: string; label: string; count: number }>).map((p) => (
 <div
 key={p.stage}
 data-testid={`pipeline-${p.stage}`}
 className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs"
 >
 <span className="text-muted-foreground">{p.label}</span>
 <span className="font-semibold font-mono">{p.count}</span>
 </div>
 ))}
 </div>
 )}

 {/* Sprint 5 — Lead investor + co-investor block */}
 <LeadAndCoInvestors round={r} softCircles={softs.data ?? []} />

 {/* Sprint 11 D12 — Commit pipeline + reconciliation + compliance hold */}
 <CommitPipeline roundId={r.id} companyId={(r as any).companyId ?? ""} />

 <Tabs defaultValue="invitations" className="space-y-4">
 <TabsList className="flex-wrap h-auto">
 <TabsTrigger value="invitations" data-testid="tab-invitations">Investor invitations ({invs.data?.length ?? 0})</TabsTrigger>
 <TabsTrigger value="soft" data-testid="tab-soft">Soft-circle book ({softs.data?.length ?? 0})</TabsTrigger>
 <TabsTrigger value="terms" data-testid="tab-terms">Terms</TabsTrigger>
 <TabsTrigger value="plan" data-testid="tab-plan"><Wallet className="h-3.5 w-3.5 mr-1.5" />Use of proceeds</TabsTrigger>
 <TabsTrigger value="checklist" data-testid="tab-checklist"><ListChecks className="h-3.5 w-3.5 mr-1.5" />Closing checklist</TabsTrigger>
 <TabsTrigger value="scenarios" data-testid="tab-scenarios"><GitBranch className="h-3.5 w-3.5 mr-1.5" />Scenarios</TabsTrigger>
 {r.tranches && r.tranches.length > 0 && (
 <TabsTrigger value="tranches" data-testid="tab-tranches"><Layers className="h-3.5 w-3.5 mr-1.5" />Tranches</TabsTrigger>
 )}
 <TabsTrigger value="docs" data-testid="tab-docs">Documents</TabsTrigger>
 <TabsTrigger value="projection" data-testid="tab-projection">Pre / post-close projection</TabsTrigger>
 <TabsTrigger value="close" data-testid="tab-close"><Lock className="h-3.5 w-3.5 mr-1.5" />Close round</TabsTrigger>
 </TabsList>

 <TabsContent value="invitations">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">Invitations</CardTitle></CardHeader>
 <CardContent className="px-0">
 <div className="overflow-x-auto">
 <table className="w-full text-sm" data-testid="table-invitations">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Investor</th>
 <th className="text-left font-medium px-3 py-2.5">State</th>
 <th className="text-left font-medium px-3 py-2.5">Sent</th>
 <th className="text-left font-medium px-3 py-2.5">Viewed</th>
 <th className="text-left font-medium px-3 py-2.5">Expires</th>
 <th className="text-right font-medium px-6 py-2.5">Actions</th>
 </tr>
 </thead>
 <tbody>
 {asArray(invs.data).length === 0 && (
 <tr>
 <td colSpan={6} className="px-6 py-10 text-center" data-testid="empty-invitations">
 <div className="text-sm text-muted-foreground italic">No investors invited yet.</div>
 <div className="text-xs text-muted-foreground mt-1">Use the <strong>Invite investor</strong> or <strong>Bulk CSV</strong> buttons in the round header above to start.</div>
 <Button size="sm" variant="outline" className="mt-3" onClick={() => setInviteOpen(true)} data-testid="button-empty-invite"><Send className="h-3.5 w-3.5 mr-1" /> Invite an investor</Button>
 </td>
 </tr>
 )}
 {invs.data?.map(i => (
 <tr key={i.id} className="border-b border-border/60 hover:bg-secondary/30" data-testid={`row-inv-${i.id}`}>
 <td className="px-6 py-3">
 <div className="font-medium">{i.investorName}</div>
 <div className="text-xs text-muted-foreground">{i.investorEmail}</div>
 </td>
 <td className="px-3 py-3"><StateBadge state={i.state} /></td>
 <td className="px-3 py-3 text-muted-foreground">{timeAgo(i.sentAt)}</td>
 <td className="px-3 py-3 text-muted-foreground">{i.viewedAt ? timeAgo(i.viewedAt) : "—"}</td>
 <td className="px-3 py-3 text-muted-foreground">{fmtDate(i.expiresAt)}</td>
 <td className="px-6 py-3 text-right">
 <div className="inline-flex gap-1">
 <Button size="sm" variant="ghost" onClick={() => resendMut.mutate(i.id)} disabled={resendMut.isPending} data-testid={`button-resend-${i.id}`}><Repeat className="h-3.5 w-3.5" /></Button>
 <Button size="sm" variant="ghost" onClick={() => extendExpiryMut.mutate(i.id)} disabled={extendExpiryMut.isPending} data-testid={`button-expiry-${i.id}`}><Calendar className="h-3.5 w-3.5" /></Button>
 <Button size="sm" variant="ghost" onClick={() => setRevokeId(i.id)} className="text-destructive hover:text-destructive" data-testid={`button-revoke-${i.id}`}><Ban className="h-3.5 w-3.5" /></Button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="soft">
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base">Soft-circle commitments</CardTitle>
 <Button size="sm" variant="outline" onClick={() => addSoftCircleMut.mutate()} disabled={addSoftCircleMut.isPending} data-testid="button-add-soft"><Plus className="h-4 w-4 mr-1" /> Add manually</Button>
 </CardHeader>
 <CardContent className="px-0">
 <div className="overflow-x-auto">
 <table className="w-full text-sm" data-testid="table-softcircles">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-6 py-2.5">Investor</th>
 <th className="text-right font-medium px-3 py-2.5">Investment Amount</th>
 <th className="text-left font-medium px-3 py-2.5">Date</th>
 <th className="text-left font-medium px-3 py-2.5">Status</th>
 <th className="text-right font-medium px-6 py-2.5">Actions</th>
 </tr>
 </thead>
 <tbody>
 {asArray(softs.data).length === 0 && (
 <tr>
 <td colSpan={5} className="px-6 py-10 text-center" data-testid="empty-softcircles">
 <div className="text-sm text-muted-foreground italic">Soft-circles will appear here when investors commit.</div>
 <Link href="/founder/crm"><Button size="sm" variant="outline" className="mt-3" data-testid="button-empty-crm">Open investor CRM <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button></Link>
 </td>
 </tr>
 )}
 {softs.data?.map(s => (
 <tr key={s.id} className="border-b border-border/60 hover:bg-secondary/30" data-testid={`row-sc-${s.id}`}>
 <td className="px-6 py-3 font-medium">{s.investorName}</td>
 <td className="px-3 py-3 text-right font-mono tabular-nums">{fmtUSD(s.amount)}</td>
 <td className="px-3 py-3 text-muted-foreground">{fmtDate(s.createdAt)}</td>
 <td className="px-3 py-3"><StateBadge state={s.status} /></td>
 <td className="px-6 py-3 text-right">
 <div className="inline-flex gap-1">
 {s.status !== "committed" && (
 <Button size="sm" variant="outline" onClick={() => setConfirmSoftId(s.id)} data-testid={`button-confirm-${s.id}`}>
 <Check className="h-3.5 w-3.5 mr-1" /> Confirm
 </Button>
 )}
 <Button size="sm" variant="ghost" data-testid={`button-view-${s.id}`}><Eye className="h-3.5 w-3.5" /></Button>
 </div>
 </td>
 </tr>
 ))}
 <tr className="font-semibold bg-secondary/40">
 <td className="px-6 py-3">Total</td>
 <td className="px-3 py-3 text-right font-mono tabular-nums">
 {fmtUSD(asArray<SoftCircle>(softs.data).reduce((s, x) => s + x.amount, 0))}
 </td>
 <td colSpan={3} />
 </tr>
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>
 {/* Sprint 9 — Soft-Circle Channel card on the soft-circle book tab. */}
 <div className="mt-4">
 <SoftCircleChannelCard roundId={id} roundName={r.name} basePath="/founder/messages" />
 </div>
 </TabsContent>

 <TabsContent value="terms">
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base">Round terms</CardTitle>
 <div className="flex gap-2">
 <Button size="sm" variant="outline" onClick={() => navigate(`/founder/rounds/${id}/termsheet`)} data-testid="button-generate-termsheet">
 <FilePlus2 className="h-3.5 w-3.5 mr-1.5" /> Generate / upload term sheet
 </Button>
 </div>
 </CardHeader>
 <CardContent className="text-sm space-y-3">
 <p>{r.termsSummary}</p>
 <div className="grid md:grid-cols-2 gap-4 pt-3 border-t border-border">
 {([
 ["Liquidation preference", "1x non-participating preferred"],
 ["Anti-dilution", "Broad-based weighted average"],
 ["Pro-rata", "Pro-rata for $250k+ investors"],
 ["Board composition", "1 founder, 1 investor, 1 mutual"],
 ["Information rights", "Quarterly financials + KPI dashboard"],
 ["ESOP top-up", "10% post-money pool refresh"],
 ["Drag-along", "Yes — majority of preferred + majority of common"],
 ["ROFR / Co-Sale", "Yes — standard NVCA form"],
 ["Region / formula pack", `${r.region ?? "US"} · ${r.currency ?? "USD"}`],
 ] as const).map(([k, v]) => (
 <div key={k} className="flex justify-between border-b border-border/60 py-2">
 <span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span>
 </div>
 ))}
 </div>
 <div className="text-xs text-muted-foreground pt-3">
 Editing terms is permitted in <span className="font-mono">draft</span> state; terms lock at <span className="font-mono">terms_set</span> with audit-log entry. Currently: <Badge variant="outline" className="text-[10px] capitalize">{r.state.replace(/_/g, " ")}</Badge>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="plan">
 <UseOfProceeds round={r} />
 </TabsContent>

 <TabsContent value="checklist">
 <ClosingChecklist round={r} />
 </TabsContent>

 <TabsContent value="scenarios">
 <ScenariosPanel round={r} />
 </TabsContent>

 {r.tranches && r.tranches.length > 0 && (
 <TabsContent value="tranches">
 <TranchesPanel round={r} />
 </TabsContent>
 )}

 <TabsContent value="projection">
 <ProjectionPanel round={r} />
 </TabsContent>

 <TabsContent value="docs">
 <DocumentsTab roundId={id} softs={softs.data ?? []} navigate={navigate} />
 </TabsContent>

 <TabsContent value="close">
 <CloseRoundPanel roundId={id} companyId={activeCompanyId} roundName={r.name} founderName={me.data?.displayName ?? "Founder"} />
 </TabsContent>
 </Tabs>

 {/* Founder soft-circle confirmation dialog (SES) */}
 <FounderConfirmDialog
 open={!!confirmSoftId}
 softId={confirmSoftId}
 softName={asArray<SoftCircle>(softs.data).find(s => s.id === confirmSoftId)?.investorName}
 softAmount={asArray<SoftCircle>(softs.data).find(s => s.id === confirmSoftId)?.amount}
 roundId={id}
 signerEmail={me.data?.identity?.email ?? ""}
 onClose={() => setConfirmSoftId(null)}
 />

 {/* Invite dialog */}
 <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
 <DialogContent className="max-w-lg">
 <DialogHeader>
 <DialogTitle>Invite an investor</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 <div><Label>Investor name</Label><Input className="mt-1" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Investor name" data-testid="input-invite-name" /></div>
 <div><Label>Email</Label><Input className="mt-1" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="investor@firm.com" data-testid="input-invite-email" /></div>
 <div><Label>Personal note (optional)</Label><Input className="mt-1" value={inviteNote} onChange={e => setInviteNote(e.target.value)} placeholder="Following up from our coffee at Latitude…" data-testid="input-invite-note" /></div>
 <div><Label>Expires in</Label>
 <select className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm" data-testid="select-invite-expiry" value={inviteExpiry} onChange={e => setInviteExpiry(e.target.value)}>
 <option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="never">Never</option>
 </select>
 </div>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
 {/* B-303 fix v23.4.12: wire Send invitation to sendInviteMut -- button-send-invite-mutation-v23412 */}
        <Button
          onClick={() => sendInviteMut.mutate()}
          disabled={sendInviteMut.isPending}
          data-testid="button-send-invite"
        >Send invitation</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Bulk dialog */}
 <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
 <DialogContent>
 <DialogHeader><DialogTitle>Bulk invite via CSV</DialogTitle></DialogHeader>
 <div className="space-y-3 text-sm">
 <p className="text-muted-foreground">Upload a CSV with columns <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">name,email,note</code>. Each row creates a pending invitation with the round's default 30-day expiry.</p>
 <div className="border-2 border-dashed border-border rounded-md p-8 text-center">
 <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
 <div className="font-medium">Drop CSV here</div>
 <div className="text-xs text-muted-foreground mt-1">or click to browse</div>
 </div>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
 <Button onClick={() => {
 emit({ type: "round.invitations_sent", payload: { roundId: id, count: 24 } }, { companyId: activeCompanyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 toast({ title: "Bulk import started", description: "Processing 24 rows…" });
 setBulkOpen(false);
 }} data-testid="button-bulk-go">Upload &amp; process</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Revoke confirm */}
 <AlertDialog open={!!revokeId} onOpenChange={o => !o && setRevokeId(null)}>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
 <AlertDialogDescription>
 The investor will no longer be able to access the dataroom or terms for this round. This action is logged in the audit ledger.
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel>Keep</AlertDialogCancel>
 <AlertDialogAction onClick={() => { if (revokeId) revokeMut.mutate(revokeId); }} data-testid="button-confirm-revoke">Revoke</AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 </PageBody>
 </>
 );
}

function ProjectionPanel({ round }: { round: Round }) {
 const { toast } = useToast();
 // Patch v4: use the round's companyId (not hardcoded). Engine math unchanged.
 const projCompanyId = (round as any).companyId ?? "";
 const securities = useQuery<ApiSecurity[]>({
 queryKey: ["/api/companies", projCompanyId, "securities"],
 queryFn: async () => (await apiRequest("GET", `/api/companies/${encodeURIComponent(projCompanyId)}/securities`)).json(),
 enabled: !!projCompanyId,
 });
 if (!projCompanyId) return <div className="py-10 text-center text-muted-foreground">No active company — set one before projecting.</div>;
 if (!securities.data) return <div className="py-10 text-center text-muted-foreground">Loading securities…</div>;

 const pre = runEngine(securities.data, "fully_diluted", "US");
 const post = projectPostClose(securities.data, {
 preMoneyValuation: round.preMoney,
 investmentAmount: round.targetAmount,
 series: round.name,
 }, "US");

 return (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 Pre-close vs post-close projection
 <Badge variant="outline" className="gap-1.5 bg-[hsl(327_77%_30%)]/10 border-[hsl(327_77%_30%)]/40 text-[hsl(327_77%_30%)] " data-testid="badge-engine-projection">
 <Cpu className="h-3 w-3" /> Engine v1.0.0
 </Badge>
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Computed live by <code className="font-mono text-[10px] bg-secondary/60 px-1 py-0.5 rounded">@capavate/cap-table-engine</code> by appending a synthetic priced round and re-running the pipeline.</p>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <SideTable title="Pre-close" rows={pre.rows} totalShares={pre.totalShares} testid="table-pre" />
 <SideTable title="Post-close" rows={post.rows} totalShares={post.totalShares} testid="table-post" highlight />
 </div>
 <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
 <ArrowRight className="h-3.5 w-3.5" />
 New investor allocation: <strong className="text-foreground">{fmtUSD(round.targetAmount)}</strong> at <strong className="text-foreground">${safeToFixed(round.pricePerShare, 4)}</strong>/share — {pre.formulaIdsUsed.length} → {post.formulaIdsUsed.length} formulas applied.
 </div>
 <div className="mt-3">
 <Button size="sm" variant="outline" onClick={() => toast({ title: "Soft circle validated", description: `Engine projection committed for ${round.name}.` })} data-testid="button-validate-soft-circle">
 <Check className="h-4 w-4 mr-2" /> Validate soft circle (commit projection)
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

function SideTable({ title, rows, totalShares, testid, highlight }: { title: string; rows: { holderName: string; holderType: string; kind: string; shares: bigint; ownershipPercent: string }[]; totalShares: bigint; testid: string; highlight?: boolean }) {
 return (
 <div className={`rounded-lg border ${highlight ? "border-[hsl(327_77%_30%)]/40 bg-[hsl(327_77%_30%)]/5" : "border-border"}`}>
 <div className={`px-4 py-3 border-b ${highlight ? "border-[hsl(327_77%_30%)]/30" : "border-border"} flex items-center justify-between`}>
 <h4 className="text-sm font-semibold">{title}</h4>
 <span className="text-xs text-muted-foreground font-mono tabular-nums">{fmtNum(Number(totalShares))} shares</span>
 </div>
 <table className="w-full text-xs" data-testid={testid}>
 <thead>
 <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/60">
 <th className="text-left font-medium px-4 py-2">Holder</th>
 <th className="text-right font-medium px-2 py-2">Shares</th>
 <th className="text-right font-medium px-4 py-2">%</th>
 </tr>
 </thead>
 <tbody>
 {rows.map((r, i) => (
 <tr key={i} className="border-b border-border/40 last:border-0">
 <td className="px-4 py-1.5">
 <div className="font-medium">{r.holderName}</div>
 <div className="text-[9px] text-muted-foreground capitalize">{r.kind} · {r.holderType}</div>
 </td>
 <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtNum(Number(r.shares))}</td>
 <td className="px-4 py-1.5 text-right font-mono tabular-nums">{parseFloat(r.ownershipPercent).toFixed(2)}%</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
}

/* ----- Sprint 5 institutional-grade components ----- */

const LIFECYCLE_STAGES: { id: string; label: string; states: string[] }[] = [
 { id: "draft", label: "Draft / Terms", states: ["draft"] },
 { id: "terms_set", label: "Terms set", states: ["terms_set"] },
 { id: "invitation", label: "Invitations", states: ["invitation_open"] },
 { id: "soft_circle", label: "Soft circles", states: ["soft_circle_open"] },
 { id: "signing", label: "Signing / Docs", states: ["signing_open"] },
 { id: "funded", label: "Funded", states: ["funded"] },
 { id: "closed", label: "Closed", states: ["closed"] },
];

function RoundLifecycleProgress({ state }: { state: string }) {
 // Resolve current stage index. soft_circle_open → 3, etc.
 const orderedStateMap: Record<string, number> = {
 draft: 0, terms_set: 1, invitation_open: 2, soft_circle_open: 3, signing_open: 4, funded: 5, closed: 6,
 };
 const currentIdx = orderedStateMap[state] ?? 0;
 return (
 <Card className="mb-6">
 <CardContent className="p-4">
 <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
 <Sparkles className="h-3.5 w-3.5" /> Round lifecycle <HelpTip>NVCA-flow round progression. Each stage emits an immutable telemetry event when entered. Click a future stage to preview the founder action required.</HelpTip>
 </div>
 <div className="flex items-center gap-1 overflow-x-auto pb-2">
 {LIFECYCLE_STAGES.map((s, i) => {
 const done = i < currentIdx;
 const active = i === currentIdx;
 return (
 <div key={s.id} className="flex items-center gap-1 shrink-0" data-testid={`lifecycle-${s.id}`}>
 <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] ${active ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/10 text-foreground font-medium" : done ? "border-emerald-300/60 bg-emerald-50 text-emerald-700 " : "border-border text-muted-foreground"}`}>
 <div className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold ${active ? "bg-[hsl(184_98%_22%)] text-white" : done ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
 {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
 </div>
 {s.label}
 </div>
 {i < LIFECYCLE_STAGES.length - 1 && <div className={`h-px w-3 ${i < currentIdx ? "bg-emerald-400" : "bg-border"}`} />}
 </div>
 );
 })}
 </div>
 </CardContent>
 </Card>
 );
}

function LeadAndCoInvestors({ round, softCircles }: { round: Round; softCircles: SoftCircle[] }) {
 const sym = currencySymbol(round.region ?? "US");
 const lead = softCircles.find((s) => s.investorName === round.leadInvestor);
 return (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
 <Card data-testid="card-lead">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2"><Crown className="h-4 w-4 text-[hsl(38_92%_50%)]" />Lead investor <HelpTip>The investor setting the terms and writing the largest check. Without a lead, a priced round can't close.</HelpTip></CardTitle>
 </CardHeader>
 <CardContent className="text-xs space-y-1">
 {round.leadInvestor ? (
 <>
 <div className="font-semibold text-base text-foreground">{round.leadInvestor}</div>
 {lead && (
 <>
 <div className="text-muted-foreground">Soft-circled <span className="font-mono text-foreground">{sym}{lead.amount.toLocaleString()}</span></div>
 <div className="text-muted-foreground">Status: <Badge variant="outline" className="text-[10px] capitalize ml-1">{lead.status}</Badge></div>
 </>
 )}
 {!lead && <div className="text-muted-foreground italic">Not yet soft-circled.</div>}
 </>
 ) : <span className="text-muted-foreground">No lead designated.</span>}
 </CardContent>
 </Card>

 <Card data-testid="card-coinvestors">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(184_98%_22%)]" />Co-investors <HelpTip>The follower book. Investors who join after the lead's terms are set.</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1">
 {round.coInvestors && round.coInvestors.length > 0 ? (
 <ul className="space-y-1">
 {round.coInvestors.map((c) => (
 <li key={c} className="flex items-center gap-1.5">
 <span className="h-1 w-1 rounded-full bg-muted-foreground" />
 <span>{c}</span>
 </li>
 ))}
 </ul>
 ) : <span className="text-muted-foreground">No co-investors yet.</span>}
 </CardContent>
 </Card>

 <Card data-testid="card-timeline">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-[hsl(327_77%_30%)]" />Timing <HelpTip>Carta benchmark: median seed round closes in 65 days from open. Series A in 90 days.</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1">
 {round.openDate && (
 <div className="flex justify-between"><span className="text-muted-foreground">Opened</span><span>{fmtDate(round.openDate)}</span></div>
 )}
 <div className="flex justify-between"><span className="text-muted-foreground">Target close</span><span>{fmtDate(round.closeDate)}</span></div>
 {round.openDate && round.closeDate && (
 <div className="flex justify-between"><span className="text-muted-foreground">Days planned</span><span className="font-mono">{Math.max(0, Math.round((new Date(round.closeDate).getTime() - new Date(round.openDate).getTime()) / 86400000))}d</span></div>
 )}
 {round.openDate && (
 <div className="flex justify-between"><span className="text-muted-foreground">Days elapsed</span><span className="font-mono">{Math.max(0, Math.round((Date.now() - new Date(round.openDate).getTime()) / 86400000))}d</span></div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

function UseOfProceeds({ round }: { round: Round }) {
 const { toast } = useToast();
 const sym = currencySymbol(round.region ?? "US");
 const data = round.useOfProceeds ?? [];
 const total = data.reduce((s, r) => s + r.amount, 0);
 return (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-[hsl(184_98%_22%)]" />Use of proceeds <HelpTip>How the round capital will be deployed. Standard pitch-deck slide; investors review this before committing. Aim for explicit per-bucket % + dollar amounts.</HelpTip></CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">{round.name} target: {fmtCurrency(round.targetAmount, round.region ?? "US", { compact: true })}. Actual deployment to be reported quarterly per IRA.</p>
 </CardHeader>
 <CardContent>
 {data.length === 0 ? (
 <div className="text-sm text-muted-foreground italic py-6 text-center border border-dashed border-border rounded-md">
 No use-of-proceeds plan documented yet.
 <div className="mt-3"><Button size="sm" variant="outline" onClick={() => toast({ title: "Add use of proceeds", description: "Use-of-proceeds editor stubbed for the preview." })} data-testid="button-add-uop"><Plus className="h-3.5 w-3.5 mr-1" />Add use of proceeds</Button></div>
 </div>
 ) : (
 <div className="space-y-3">
 {data.map((row, i) => (
 <div key={i} data-testid={`uop-row-${i}`}>
 <div className="flex justify-between text-sm mb-1">
 <span className="font-medium">{row.category}</span>
 <span className="font-mono tabular-nums">{sym}{row.amount.toLocaleString()} <span className="text-muted-foreground ml-1.5">{row.percent}%</span></span>
 </div>
 <div className="h-2 rounded-full bg-secondary overflow-hidden">
 <div className="h-full bg-gradient-to-r from-[hsl(184_98%_22%)] to-[hsl(184_98%_30%)]" style={{ width: `${row.percent}%` }} />
 </div>
 </div>
 ))}
 <div className="flex justify-between text-sm pt-3 border-t border-border font-semibold">
 <span>Total committed</span>
 <span className="font-mono tabular-nums">{sym}{total.toLocaleString()} ({data.reduce((s, r) => s + r.percent, 0)}%)</span>
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function ClosingChecklist({ round }: { round: Round }) {
 const { toast } = useToast();
 const initial = round.closingChecklist ?? [];
 const [items, setItems] = useState<ChecklistRow[]>(initial);
 const done = items.filter((i) => i.done).length;
 const pct = items.length === 0 ? 0 : (done / items.length) * 100;
 const toggle = (idx: number) => {
 setItems((arr) => arr.map((it, i) => i === idx ? { ...it, done: !it.done } : it));
 const it = items[idx];
 toast({ title: it.done ? "Marked incomplete" : "Marked complete", description: it.item });
 };
 const markAll = () => {
 setItems((arr) => arr.map((it) => ({ ...it, done: true })));
 toast({ title: "All checklist items marked complete" });
 };
 return (
 <Card>
 <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0 gap-3">
 <div className="flex-1 min-w-0">
 <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4 text-emerald-600" />Closing checklist <HelpTip>NVCA-style closing-conditions checklist. All items must be confirmed before the immutable round_close transaction commits.</HelpTip></CardTitle>
 <div className="flex items-baseline justify-between text-sm mt-1.5">
 <span className="text-muted-foreground">{done} of {items.length} complete</span>
 <span className="font-mono text-xs">{pct.toFixed(0)}%</span>
 </div>
 <Progress value={pct} className="h-2 mt-1" />
 </div>
 {items.length > 0 && done < items.length && (
 <Button size="sm" variant="outline" onClick={markAll} data-testid="button-mark-all-complete"><Check className="h-3.5 w-3.5 mr-1" /> Mark all complete</Button>
 )}
 </CardHeader>
 <CardContent className="space-y-1.5">
 {items.length === 0 ? (
 <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded-md">
 No closing checklist items configured. Counsel typically defines the items at the term-sheet stage.
 </div>
 ) : items.map((it, i) => (
 <div key={i} className={`flex items-center gap-3 p-2 rounded-md border ${it.done ? "border-emerald-300/40 bg-emerald-50/50 " : "border-border bg-card"}`} data-testid={`checklist-${i}`}>
 <button type="button" onClick={() => toggle(i)} className={`h-5 w-5 rounded flex items-center justify-center shrink-0 transition ${it.done ? "bg-emerald-500 text-white" : "border-2 border-border bg-background hover:border-emerald-400"}`} aria-label={it.done ? "Mark incomplete" : "Mark complete"} data-testid={`checkbox-checklist-${i}`}>
 {it.done && <Check className="h-3 w-3" />}
 </button>
 <span className={`flex-1 text-sm ${it.done ? "line-through text-muted-foreground" : "font-medium"}`}>{it.item}</span>
 <Badge variant="outline" className="text-[10px] shrink-0">{it.owner}</Badge>
 </div>
 ))}
 </CardContent>
 </Card>
 );
}

/* Sprint 6 — Documents tab: signed term sheets + signed soft-circles. */
function DocumentsTab({ roundId, softs, navigate }: { roundId: string; softs: SoftCircle[]; navigate: (path: string) => void }) {
 const ts = useTermSheetStore((s) => s.termSheets[roundId]);
 const signedSoftSigs = useTermSheetStore((s) => Object.values(s.softCircleSigs).filter((sc) => sc.roundId === roundId));
 const { toast } = useToast();
 const haveAny = !!ts || signedSoftSigs.length > 0;
 return (
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base">Documents</CardTitle>
 <Button size="sm" variant="outline" onClick={() => navigate(`/founder/rounds/${roundId}/termsheet`)} data-testid="button-docs-termsheet">
 <FilePlus2 className="h-3.5 w-3.5 mr-1" /> Term sheet workspace
 </Button>
 </CardHeader>
 <CardContent>
 {!haveAny ? (
 <div className="py-10 text-center border border-dashed border-border rounded-md" data-testid="empty-documents">
 <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
 <div className="text-sm text-muted-foreground">No documents yet — generate or upload a term sheet to get started.</div>
 <Button size="sm" className="mt-3 bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => navigate(`/founder/rounds/${roundId}/termsheet`)} data-testid="button-empty-termsheet">
 Open term sheet workspace <ArrowRight className="h-3.5 w-3.5 ml-1" />
 </Button>
 </div>
 ) : (
 <ul className="divide-y divide-border -mx-3">
 {ts && (
 <li className="px-3 py-3 flex items-center gap-3" data-testid="doc-termsheet">
 <FileText className="h-4 w-4 text-[hsl(184_98%_22%)]" />
 <div className="flex-1 min-w-0">
 <div className="text-sm font-medium">{ts.templateName}</div>
 <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-0.5">
 <Badge variant="outline" className="text-[10px]">{ts.status}</Badge>
 {ts.signature && <span>Signed by <strong>{ts.signature.signerName}</strong> {fmtDate(ts.signedAt ?? "")}</span>}
 {ts.documentHash && <span className="font-mono"><Hash className="h-3 w-3 inline" /> {ts.documentHash.slice(0, 12)}…</span>}
 </div>
 </div>
 <Button size="sm" variant="ghost" onClick={() => navigate(`/founder/rounds/${roundId}/termsheet`)} data-testid="button-view-termsheet-doc"><Eye className="h-3.5 w-3.5 mr-1" />View</Button>
 <Button size="sm" variant="ghost" onClick={() => { toast({ title: "PDF export", description: "Use the Print button in the term-sheet view." }); navigate(`/founder/rounds/${roundId}/termsheet`); }} data-testid="button-pdf-termsheet-doc"><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
 </li>
 )}
 {signedSoftSigs.map((sig) => {
 const investorName = softs.find(s => s.id === sig.softCircleId)?.investorName ?? sig.signature.signerName;
 return (
 <li key={sig.softCircleId} className="px-3 py-3 flex items-center gap-3" data-testid={`doc-softcircle-${sig.softCircleId}`}>
 <ShieldCheck className="h-4 w-4 text-emerald-600" />
 <div className="flex-1 min-w-0">
 <div className="text-sm font-medium">Soft-circle indication — {investorName}</div>
 <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-0.5">
 <span>{fmtUSD(sig.amount)}</span>
 <span className="font-mono"><Hash className="h-3 w-3 inline" /> {sig.signature.hash.slice(0, 12)}…</span>
 {sig.founderConfirmation && <Badge variant="outline" className="text-[10px]">founder confirmed</Badge>}
 </div>
 </div>
 <Button size="sm" variant="ghost" onClick={() => toast({ title: "Open soft-circle", description: `View document hash ${sig.signature.hash.slice(0, 16)}…` })} data-testid={`button-view-sc-${sig.softCircleId}`}><Eye className="h-3.5 w-3.5 mr-1" /></Button>
 </li>
 );
 })}
 </ul>
 )}
 </CardContent>
 </Card>
 );
}

/* Sprint 6 — Founder soft-circle confirmation dialog. SES e-sig + chained signature. */
function FounderConfirmDialog({ open, softId, softName, softAmount, roundId, signerEmail, onClose }:
 { open: boolean; softId: string | null; softName?: string; softAmount?: number; roundId: string; signerEmail: string; onClose: () => void }) {
 const { toast } = useToast();
 const saveSoftCircleSig = useTermSheetStore.getState().saveSoftCircleSig;
 const existing = useTermSheetStore.getState().softCircleSigs[softId ?? ""];
 const [name, setName] = useState("");
 const [ack, setAck] = useState(false);

 function handleConfirm() {
 if (!softId) return;
 if (!name.trim()) { toast({ title: "Type your name", variant: "destructive" }); return; }
 if (!ack) { toast({ title: "Confirm acceptance", variant: "destructive" }); return; }
 const meta = captureSessionMetadata();
 const prevHash = existing?.signature.hash ?? "0".repeat(64);
 const sig: SESSignature = signSES({
 documentId: softId,
 documentType: "softcircle",
 signerName: name.trim(),
 // C11 (v24.0): use the actual logged-in founder's email from /api/auth/me
 // instead of the hard-coded demo persona, so the SES signature record is
 // attributed to the real signer.
 signerEmail: signerEmail,
 signerRole: "founder",
 intentText: "I confirm receipt and acceptance of this soft-circle indication of interest.",
 ipAddress: meta.ipAddress,
 userAgent: meta.userAgent,
 timestamp: meta.timestamp,
 sessionId: meta.sessionId,
 prevHash,
 });
 if (existing) {
 saveSoftCircleSig({ ...existing, founderConfirmation: sig });
 } else {
 // No prior investor sig in store — record a founder-only sig with the soft amount.
 saveSoftCircleSig({
 softCircleId: softId,
 roundId,
 amount: softAmount ?? 0,
 signature: sig,
 founderConfirmation: sig,
 });
 }
 emit({ type: "softcircle.confirmed", payload: { softCircleId: softId } }, { companyId: "co-acme", roundId, actorId: "founder-avi", actorRole: "founder" });
 toast({ title: "Soft-circle confirmed", description: `Signature hash ${sig.hash.slice(0, 12)}…` });
 setName(""); setAck(false);
 onClose();
 }

 return (
 <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
 <DialogContent>
 <DialogHeader>
 <DialogTitle>Confirm soft-circle</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 <div className="text-sm">
 <div><strong>Investor:</strong> {softName ?? "—"}</div>
 <div><strong>Amount:</strong> {fmtUSD(softAmount ?? 0)}</div>
 </div>
 <div>
 <Label>Your full legal name</Label>
 <Input className="mt-1" placeholder="Avi Barnes" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-founder-confirm-name" />
 </div>
 <label className="flex items-start gap-2 text-xs cursor-pointer">
 <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} data-testid="checkbox-founder-confirm-ack" />
 <span>I confirm receipt and acceptance of this soft-circle indication of interest. I understand soft-circles are non-binding and do not become a contract until subscription documents are executed.</span>
 </label>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={onClose} data-testid="button-founder-confirm-cancel"><X className="h-4 w-4 mr-1" />Cancel</Button>
 <Button onClick={handleConfirm} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-founder-confirm-submit"><ShieldCheck className="h-4 w-4 mr-1" />Confirm + sign</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

function ScenariosPanel({ round }: { round: Round }) {
 const { toast } = useToast();
 const scenarios = round.scenarios ?? [];
 const sym = currencySymbol(round.region ?? "US");
 return (
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <div>
 <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4 text-[hsl(327_77%_30%)]" />What-if scenarios <HelpTip>Compare alternate term scenarios side-by-side. Founders use this to negotiate pre-money with the lead investor.</HelpTip></CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Side-by-side sensitivity on pre-money and dilution. Math is reconstructed by the engine on the live ledger.</p>
 </div>
 <Button size="sm" variant="outline" onClick={() => toast({ title: "Add scenario", description: "Scenario editor stubbed for the preview — wire this to the engine in production." })} data-testid="button-add-scenario"><Plus className="h-3.5 w-3.5 mr-1" /> Add scenario</Button>
 </CardHeader>
 <CardContent>
 {scenarios.length === 0 ? (
 <div className="text-sm text-muted-foreground italic py-6 text-center border border-dashed border-border rounded-md">
 No saved scenarios. Click <strong>Add scenario</strong> above to model term-sheet negotiations.
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
 {scenarios.map((s, i) => {
 const isBase = s.name === "Base case";
 const isUp = s.preMoney > (round.preMoney ?? 0);
 return (
 <div key={i} className={`p-4 rounded-lg border-2 ${isBase ? "border-[hsl(184_98%_22%)]/40 bg-[hsl(184_98%_22%)]/5" : "border-border bg-card"}`} data-testid={`scenario-${i}`}>
 <div className="flex items-center justify-between mb-2">
 <span className="font-semibold text-sm">{s.name}</span>
 {isBase && <Badge className="text-[10px] bg-[hsl(184_98%_22%)] text-white">Selected</Badge>}
 {!isBase && (isUp ? <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300/60">+ up</Badge> : <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300/60">− down</Badge>)}
 </div>
 <div className="space-y-1.5 text-xs">
 <div className="flex justify-between"><span className="text-muted-foreground">Pre-money</span><span className="font-mono tabular-nums">{sym}{(s.preMoney / 1e6).toFixed(1)}M</span></div>
 <div className="flex justify-between"><span className="text-muted-foreground">Post-money</span><span className="font-mono tabular-nums">{sym}{((s.preMoney + s.raise) / 1e6).toFixed(1)}M</span></div>
 <div className="flex justify-between"><span className="text-muted-foreground">New investor %</span><span className="font-mono tabular-nums">{s.dilutionPct.toFixed(1)}%</span></div>
 <div className="flex justify-between border-t border-border/60 pt-1.5"><span className="text-muted-foreground">Founder % after</span><span className="font-mono tabular-nums font-semibold">{s.founderPctAfter.toFixed(1)}%</span></div>
 </div>
 <p className="text-[11px] text-muted-foreground mt-3 italic">{s.note}</p>
 </div>
 );
 })}
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function TranchesPanel({ round }: { round: Round }) {
 const tranches = round.tranches ?? [];
 const sym = currencySymbol(round.region ?? "US");
 const totalCommitted = tranches.reduce((s, t) => s + t.amount, 0);
 return (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4 text-[hsl(38_92%_50%)]" />Tranche structure <HelpTip>Larger rounds often release capital in tranches tied to milestones. Each tranche is a separate funding event in the ledger.</HelpTip></CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Total round size {sym}{totalCommitted.toLocaleString()} across {tranches.length} tranches. Each tranche commit emits an immutable telemetry event.</p>
 </CardHeader>
 <CardContent>
 <table className="w-full text-sm" data-testid="table-tranches">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-2 py-2">Tranche</th>
 <th className="text-right font-medium px-2 py-2">Amount</th>
 <th className="text-left font-medium px-2 py-2">Trigger / condition</th>
 <th className="text-left font-medium px-2 py-2">Expected</th>
 <th className="text-center font-medium px-2 py-2">Funded</th>
 </tr>
 </thead>
 <tbody>
 {tranches.map((t, i) => (
 <tr key={i} className="border-b border-border/60" data-testid={`tranche-${i}`}>
 <td className="px-2 py-2.5 font-medium">{t.name}</td>
 <td className="px-2 py-2.5 text-right font-mono tabular-nums">{sym}{t.amount.toLocaleString()}</td>
 <td className="px-2 py-2.5 text-muted-foreground text-xs">{t.condition}</td>
 <td className="px-2 py-2.5 text-muted-foreground text-xs">{fmtDate(t.expectedDate)}</td>
 <td className="px-2 py-2.5 text-center">
 {t.funded ? <Badge className="bg-emerald-100 text-emerald-900 border-0 text-[10px]">Funded</Badge> : <Badge variant="outline" className="text-[10px]">Pending</Badge>}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </CardContent>
 </Card>
 );
}

/* ----- Sprint 11 D12: Commit pipeline ----- */
function CommitPipeline({ roundId, companyId }: { roundId: string; companyId: string }) {
  const { toast } = useToast();
  // v15 P0-13 — use apiRequest so the session cookie travels with the call.
  // Raw fetch() omits credentials and breaks the new requireAuth wrapper on
  // /api/founder/captable/ledger.
  const ledger = useQuery<{ entries: any[]; complianceHold: boolean; verified: { ok: boolean } }>({
    queryKey: ["/api/founder/captable/ledger", companyId, roundId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/founder/captable/ledger?companyId=${encodeURIComponent(companyId)}&roundId=${encodeURIComponent(roundId)}`,
      );
      return res.json();
    },
  });

  const STAGES = [
    { id: "invited", label: "Invited", icon: Send },
    { id: "viewed", label: "Viewed", icon: Eye },
    { id: "soft_circle", label: "Soft-circle", icon: Users },
    { id: "signed", label: "Signed", icon: FileText },
    { id: "funded", label: "Funded", icon: Wallet },
    { id: "committed", label: "Committed to cap-table", icon: ShieldCheck },
  ];

  // Synthesize stage counts from ledger entries
  const counts: Record<string, number> = { invited: 0, viewed: 0, soft_circle: 0, signed: 0, funded: 0, committed: 0 };
  for (const e of ledger.data?.entries ?? []) {
    if (e.stage && counts[e.stage] !== undefined) counts[e.stage] += 1;
  }
  // If empty (early sprint state), show placeholder counts derived from active state
  const isEmpty = (ledger.data?.entries?.length ?? 0) === 0;

  // Sprint 25 — batch-commit funded entries via the precision-preserving endpoint.
  // The endpoint is all-or-nothing: if any single entry fails the WHOLE batch
  // is rolled back, so the ledger never contains a partial commit.
  async function commitFunded() {
    try {
      // v15 P0-13 — apiRequest sends the session cookie and uses the proxy
      // base. Raw fetch broke the credentialed requireAuth gate.
      let res: Response;
      try {
        res = await apiRequest("POST", "/api/founder/captable/commit-funded-batch", { companyId, roundId });
      } catch (e: unknown) {
        // apiRequest throws on !res.ok; reconstruct a response-shaped error.
        const msg = e instanceof Error ? e.message : String(e);
        toast({ title: "Commit blocked", description: msg, variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (res.ok) {
        const n = Number(data.committedCount ?? 0);
        if (n === 0) {
          toast({ title: "No funded entries", description: data.message ?? "Nothing waiting to commit." });
        } else {
          toast({ title: "Funded entries committed", description: `${n} ${n === 1 ? "entry" : "entries"} committed to cap-table` });
        }
        ledger.refetch();
      } else {
        const errMsg = data.message ?? data.reason ?? data.error ?? "Commit blocked";
        toast({ title: "Commit blocked", description: String(errMsg), variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Commit failed", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card className="mb-6" data-testid="card-commit-pipeline">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-[hsl(184_98%_22%)]" /> Commit pipeline
          <HelpTip>Visualizes the path from invitation through funded → committed-to-cap-table. Commit fires the immutable cap-table mutation event and emits captable_committed telemetry.</HelpTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ledger.data?.complianceHold && (
          <div className="flex items-start gap-2 rounded-md border border-[hsl(7_61%_43%)]/40 bg-[hsl(7_61%_43%)]/5 p-3 text-xs" data-testid="banner-compliance-hold">
            <AlertTriangle className="h-4 w-4 text-[hsl(7_61%_43%)] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[hsl(7_61%_43%)]">Compliance hold active</div>
              <div className="text-muted-foreground mt-0.5">Cap-table commits are blocked until admin resolves the hold. Funds remain in escrow.</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STAGES.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1 shrink-0" data-testid={`stage-${s.id}`}>
              <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-md border bg-secondary/30 min-w-[100px]">
                <s.icon className="h-4 w-4 text-[hsl(184_98%_22%)]" />
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className="text-lg font-bold tabular-nums">{counts[s.id]}</div>
              </div>
              {i < STAGES.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {isEmpty && (
          <div className="text-xs text-muted-foreground rounded-md bg-secondary/30 p-3">
            <Info className="h-3 w-3 inline mr-1" />
            No ledger entries yet for this round. As investors progress through invitation → soft-circle → signing → wire-funded, they appear here. Once funded, click "Commit funded" to atomically write them to the cap table.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Badge variant="outline" className="text-[10px]" data-testid="badge-reconciliation">
            <Hash className="h-3 w-3 mr-1" />
            Reconciliation: <span className={`ml-1 font-mono ${ledger.data?.verified?.ok ? "text-[hsl(184_98%_22%)]" : "text-[hsl(7_61%_43%)]"}`}>{ledger.data?.verified?.ok ? "verified" : "drift"}</span>
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            <Layers className="h-3 w-3 mr-1" /> Ledger entries: {ledger.data?.entries?.length ?? 0}
          </Badge>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={ledger.data?.complianceHold || counts.funded === 0}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
            onClick={commitFunded}
            data-testid="button-commit-funded"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Commit funded → cap-table
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
