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
/* WAVE 43 · OWNER RULING R7 — the founder's deliberate, audited late-acceptance
 * surface (reopen the round · accept one specific late commitment). The close
 * itself is enforced server-side; this is the only way back in. */
import { RoundCloseLateAcceptance } from "@/components/founder/RoundCloseLateAcceptance";
import { emit } from "@/lib/sprint3";
import { fmtUSD, fmtPct, fmtDate, timeAgo, fmtNum, safeToFixed } from "@/lib/format";
/* WAVE 72 · DEFECT 2 — the single null-aware ownership formatter (R21/R47). */
import { ownershipPercentCellText } from "@/lib/captable/ownershipPercent";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import {
  runEngine,
  projectPostClose,
  /* WAVE 58b · DEFECT 3 — the ONE fully-diluted base resolver, identical to the
     one the wizard and the server round-math route call. */
  ledgerFullyDilutedPreMoneyShares,
  resolveFdPreMoneyBase,
  unconvertedConvertibleCount,
  type ApiSecurity,
  /* WAVE 58e · D3.7 — the ONE discount disclosure, shared with the wizard and the
     Edit-terms modal so all three surfaces say the same thing. */
  describeDiscount,
} from "@/lib/engineDemo";
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
 /* WAVE 80 · ITEM 2 — TWO SHAPES, BOTH REAL, BOTH RENDERED. The founder round
    wizard collects use of proceeds as ONE FREE-TEXT NARRATIVE; only
    `server/mockData.ts` ever produced the `{category, amount, percent}` rows this
    field was typed for. Wave 80 kept the free text and widened the reader rather
    than deriving rows, because deriving them would mean this platform inventing
    per-bucket percentages and dollar amounts a founder never entered and printing
    them on an investor-facing deal document. The decision and its reason are
    declared once, on `validateUseOfProceeds` in `shared/roundMathEngineAdapter.ts`. */
 useOfProceeds?: UseOfProceedsRow[] | string | null;
 /* WAVE 80 · ITEM 2 — the round narrative the wizard collected and discarded. */
 notes?: string | null;
 closingChecklist?: ChecklistRow[];
 tranches?: TrancheRow[] | null;
 /* WAVE 80 · ITEM 2 — the founder's yes/no answer to "does this round close in
    tranches", and the plan they typed. Deliberately NOT folded into `tranches`
    above: that key is the structured LEDGER of funded tranche events and is
    reduced over as an array. Two different facts, two keys. */
 tranchesEnabled?: boolean;
 tranchesPlan?: string | null;
 coInvestors?: string[];
 scenarios?: ScenarioRow[] | null;
 termSheetUrl?: string | null;
};
// W-INVEST BUG B — `active` is an additive, server-computed flag: the investor
// is committed/funded on this round OR already in the company committed cap table.
type Invitation = { id: string; investorEmail: string; investorName: string; state: string; sentAt: string; viewedAt: string | null; expiresAt: string; resentAt?: string | null; active?: boolean };
/* WAVE 43 · R7 — `acceptedAfterClose` and `lateAcceptance` are DERIVED by the
 * server from the append-only `round_late_acceptances` ledger and joined onto
 * this projection (`GET /api/rounds/:id/soft-circles`). They are not columns on
 * the commitment, so no write path can forget or clear them. */
type SoftCircleLateAcceptance = {
 closedAt: string; acceptedByUserId: string; acceptedByName: string | null;
 acceptedAt: string; reason: string | null; kind: string; label: string;
};
type SoftCircle = { id: string; investorName: string; amount: number; status: string; createdAt: string; active?: boolean;
 acceptedAfterClose?: boolean; lateAcceptance?: SoftCircleLateAcceptance | null };
// v24.3 — wire-transfer instructions published by the founder per round.
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
 // v24.4 BUG 044 — CRM contacts so the invite dialog can pick an existing
 // investor instead of always retyping name/email.
 const crmContacts = useQuery<Array<{ id: string; name: string; email: string; firmName?: string }>>({ queryKey: ["/api/founder/crm/contacts"] });

 const [inviteOpen, setInviteOpen] = useState(false);
 const [bulkOpen, setBulkOpen] = useState(false);
 const [inviteName, setInviteName] = useState("");
 const [inviteFirstName, setInviteFirstName] = useState("");
 const [inviteLastName, setInviteLastName] = useState("");
 const [inviteEmail, setInviteEmail] = useState("");
 const [inviteNote, setInviteNote] = useState("");
 // Wave C3 (Shadie 2a) — exact-HTML preview of the invitation email. The founder
 // edits ONLY the personal note; the preview shows precisely what the investor
 // will receive (rendered server-side via the shared renderer). No token/email.
 const [invitePreviewHtml, setInvitePreviewHtml] = useState<string | null>(null);
 // v25.53 8a — optional invite fields mirroring the CRM menu.
 const [inviteCompany, setInviteCompany] = useState("");
 const [inviteStageFocus, setInviteStageFocus] = useState("");
 const [inviteMarketSize, setInviteMarketSize] = useState("");
 // v24.4 BUG 044 — invite source: pick from CRM, or add a brand-new investor.
 const [inviteSource, setInviteSource] = useState<"crm" | "new">("crm");
 const [inviteCrmId, setInviteCrmId] = useState("");
 // select-invite-expiry fix v23.4.13
 const [inviteExpiry, setInviteExpiry] = useState("7");
 const [revokeId, setRevokeId] = useState<string | null>(null);
 const [confirmSoftId, setConfirmSoftId] = useState<string | null>(null);
 // v25.55 Q3 — "Record existing investors" backfill form.
 const [backfillOpen, setBackfillOpen] = useState(false);
 const [backfillFirstName, setBackfillFirstName] = useState("");
 const [backfillLastName, setBackfillLastName] = useState("");
 const [backfillEmail, setBackfillEmail] = useState("");
 const [backfillAmount, setBackfillAmount] = useState("");
 const [backfillShares, setBackfillShares] = useState("");
 // v24.3 — wire-transfer instructions (founder publishes; investor reads).
 const [wireDlgOpen, setWireDlgOpen] = useState(false);
 const [wireForm, setWireForm] = useState({
   bankName: "", accountName: "", accountNumber: "",
   routingNumber: "", swift: "", reference: "", notes: "",
 });

 // Real mutations wired to server endpoints (defects 10, 22-27)
 const sendInviteMut = useMutation({
   mutationFn: async () => {
     // select-invite-expiry fix v23.4.13: pass expiryDays from dropdown
     const expiryDaysVal = inviteExpiry === "never" ? null : parseInt(inviteExpiry, 10);
     const composedInviteName =
       inviteSource === "new"
         ? [inviteFirstName.trim(), inviteLastName.trim()].filter(Boolean).join(" ")
         : inviteName;
     const res = await apiRequest("POST", `/api/rounds/${id}/invitations`, {
       investorName: composedInviteName, investorEmail: inviteEmail, note: inviteNote,
       ...(inviteSource === "new"
         ? {
             investorFirstName: inviteFirstName.trim() || null,
             investorLastName: inviteLastName.trim() || null,
           }
         : {}),
       // v25.53 8a — optional CRM-aligned fields (persisted onto the CRM contact).
       investorCompany: inviteCompany.trim() || null,
       stageFocus: inviteStageFocus.trim() || null,
       typicalMarketSize: inviteMarketSize.trim() || null,
       ...(expiryDaysVal !== null ? { expiryDays: expiryDaysVal } : {}),
     });
     return res.json();
   },
   onSuccess: (data: any) => {
     // v25.52 Avi-BUG-1 — be honest about delivery. When SMTP is not configured
     // (emailDelivered !== true) the invite was recorded but NOT actually emailed;
     // surface the copyable redeem link so the founder can share it manually and
     // isn't misled into thinking the investor received an email.
     if (data?.emailDelivered) {
       toast({ title: "Invitation sent", description: "The investor will receive an email." });
     } else {
       toast({
         title: "Invitation created (email NOT sent)",
         description:
           "Email delivery is not configured on the server, so no email was sent. " +
           "Copy the invite link from the invitations list to share it directly, or ask your admin to configure SMTP.",
         variant: "destructive",
       });
     }
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
     emitMutationLocal("invitation", `inv-${Date.now()}`, "create");
     setInviteOpen(false); setInviteName(""); setInviteFirstName(""); setInviteLastName(""); setInviteEmail(""); setInviteNote(""); setInviteCompany(""); setInviteStageFocus(""); setInviteMarketSize(""); setInviteExpiry("7"); setInvitePreviewHtml(null);
   },
   // v25.55 8a — a duplicate active invite is a friendly conflict, not a
   // failure. Give it a clear title instead of the generic "Failed to send".
   onError: (e: Error) => {
     const dup = (e as ApiError).code === "duplicate_invitation";
     toast({
       title: dup ? "The investor has already been invited to the round." : "Failed to send",
       description: e.message,
       variant: "destructive",
     });
   },
 });

 // Wave C3 (Shadie 2a) — fetch the EXACT invitation email HTML (same renderer
 // the send uses) so the founder previews precisely what the investor receives.
 const previewInviteMut = useMutation({
   mutationFn: async () => {
     const previewName = (inviteSource === "new"
       ? `${inviteFirstName} ${inviteLastName}`.trim()
       : inviteName).trim();
     // Wave C3 REVISE — mirror the SEND's expiry mapping EXACTLY so the preview
     // shows the same "expires in N days" the investor will receive. "never"
     // omits expiryDays (send does the same → renderer default applies to both).
     const expiryDaysVal = inviteExpiry === "never" ? null : parseInt(inviteExpiry, 10);
     const res = await apiRequest("POST", `/api/rounds/${id}/invitations/preview`, {
       investorName: previewName || undefined,
       note: inviteNote || undefined,
       ...(expiryDaysVal !== null && Number.isFinite(expiryDaysVal) ? { expiryDays: expiryDaysVal } : {}),
     });
     return res.json() as Promise<{ ok: boolean; preview?: { subject: string; html: string; text: string } }>;
   },
   onSuccess: (data) => {
     setInvitePreviewHtml(data.preview?.html ?? "");
   },
   onError: (e: Error) => {
     toast({ title: "Could not build preview", description: e.message, variant: "destructive" });
   },
 });

 const resendMut = useMutation({
   mutationFn: async (invId: string) => (await apiRequest("POST", `/api/rounds/${id}/invitations/${invId}/resend`, {})).json(),
 // (resend keeps its existing behavior; preview is a separate action below)
   onSuccess: (_d, invId) => {
     toast({ title: "Reminder sent", description: "A fresh invitation email with a new link was sent." });
     emitMutationLocal("invitation", invId, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
   },
   // v25.55 3a — an already-accepted invite cannot be reminded; surface the
   // server's typed message rather than a generic error.
   onError: (e: Error) => {
     const accepted = (e as ApiError).code === "already_accepted";
     toast({
       title: accepted ? "Already accepted" : "Resend failed",
       description: accepted ? "This investor has already accepted the invitation." : e.message,
       variant: "destructive",
     });
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

 // v25.55 Q3 — record an existing (off-platform) investor: seat them on the
 // cap table as already-committed AND send a platform-registration invite.
 const backfillMut = useMutation({
   mutationFn: async () => (await apiRequest("POST", `/api/founder/captable/backfill-investor`, {
     companyId: activeCompanyId,
     roundId: id,
     holderFirstName: backfillFirstName.trim(),
     holderLastName: backfillLastName.trim(),
     investorEmail: backfillEmail.trim(),
     amount: backfillAmount.replace(/,/g, "").trim(),
     shares: backfillShares.replace(/,/g, "").trim(),
   })).json(),
   onSuccess: (d) => {
     toast({
       title: d?.idempotent ? "Investor already recorded" : "Investor recorded",
       description: d?.inviteEmailSent
         ? "Seated on the cap table; a registration invite was emailed."
         : "Seated on the cap table. A registration invite was created (email delivery may be off).",
     });
     emitMutationLocal("round", id, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}`] });
     setBackfillOpen(false);
     setBackfillFirstName(""); setBackfillLastName(""); setBackfillEmail(""); setBackfillAmount(""); setBackfillShares("");
   },
   onError: (e: Error) => toast({ title: "Could not record investor", description: e.message, variant: "destructive" }),
 });

 const addSoftCircleMut = useMutation({
   mutationFn: async () => (await apiRequest("POST", `/api/rounds/${id}/soft-circle`, { investorName: "Manual entry", amount: 0 })).json(),
   onSuccess: () => {
     toast({ title: "Soft circle added" });
     emitMutationLocal("round", id, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/soft-circles`] });
   },
 });

 // v24.2 Bug 3 — wire-funded action: founder marks a confirmed soft-circle as
 // wire-funded, which enqueues it onto the cap-table funded queue.
 const wireFundedMut = useMutation({
   mutationFn: async (scId: string) =>
     (await apiRequest("POST", `/api/founder/rounds/${id}/soft-circle/${scId}/wire-funded`, {})).json(),
   onSuccess: (_d, scId) => {
     toast({ title: "Wire funded", description: "Added to the cap-table funded queue." });
     emitMutationLocal("round", scId, "update");
     queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/soft-circles`] });
     queryClient.invalidateQueries({ queryKey: ["/api/founder/captable/funded-queue"] });
     // v24.4.2 Bug H — also invalidate the ledger so CommitPipeline’s
     // counts.funded gate re-evaluates and enables the Commit button.
     queryClient.invalidateQueries({ queryKey: ["/api/founder/captable/ledger"] });
   },
   onError: (e: Error) => toast({ title: "Failed to mark funded", description: e.message, variant: "destructive" }),
 });

 // v24.3 — fetch the founder's published wire instructions for this round.
 // 404 (none set yet) is treated as "no instructions" rather than an error.
 const wireInstr = useQuery<WireInstructions | null>({
   queryKey: [`/api/founder/rounds/${id}/wire-instructions`],
   queryFn: async () => {
     // v15 P0-13 — use apiRequest so the session cookie (cap_uid) travels with
     // the call and the proxy prefix is applied. apiRequest throws on non-2xx,
     // so we catch the 404 "not set yet" case and treat it as an empty state
     // (the founder simply hasn't published wire instructions for this round).
     try {
       const res = await apiRequest("GET", `/api/founder/rounds/${id}/wire-instructions`);
       const json = await res.json();
       return (json?.wireInstructions ?? null) as WireInstructions | null;
     } catch (err) {
       if (err instanceof ApiError && err.status === 404) return null;
       throw err;
     }
   },
   retry: false,
 });

 const saveWireMut = useMutation({
   mutationFn: async () => {
     const res = await apiRequest("POST", `/api/founder/rounds/${id}/wire-instructions`, {
       bankName: wireForm.bankName,
       accountName: wireForm.accountName,
       accountNumber: wireForm.accountNumber,
       routingNumber: wireForm.routingNumber || undefined,
       swift: wireForm.swift || undefined,
       reference: wireForm.reference || undefined,
       notes: wireForm.notes || undefined,
     });
     const json = await res.json();
     if (!res.ok || json?.ok === false) {
       throw new Error(json?.message ?? "Could not save wire instructions.");
     }
     return json;
   },
   onSuccess: () => {
     toast({ title: "Wire instructions saved", description: "Investors with a signed soft-circle can now see where to wire." });
     queryClient.invalidateQueries({ queryKey: [`/api/founder/rounds/${id}/wire-instructions`] });
     setWireDlgOpen(false);
   },
   onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
 });

 function openWireDialog() {
   const w = wireInstr.data;
   setWireForm({
     bankName: w?.bankName ?? "",
     accountName: w?.accountName ?? "",
     accountNumber: w?.accountNumber ?? "",
     routingNumber: w?.routingNumber ?? "",
     swift: w?.swift ?? "",
     reference: w?.reference ?? "",
     notes: w?.notes ?? "",
   });
   setWireDlgOpen(true);
 }

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
 <Button variant="ghost" data-testid="button-back" asChild><Link href="/founder/rounds"><ArrowLeft className="h-4 w-4 mr-2" /> All rounds</Link></Button>
 <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-bulk-invite"><Upload className="h-4 w-4 mr-2" /> Bulk CSV</Button>
 <Button variant="outline" onClick={() => setBackfillOpen(true)} data-testid="button-backfill-investor"><Users className="h-4 w-4 mr-2" /> Record existing investors</Button>
 <Button onClick={() => setInviteOpen(true)} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-invite"><Send className="h-4 w-4 mr-2" /> Invite investor</Button>
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
 <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
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
 <div className="h-full bg-gradient-to-r from-[hsl(0_100%_40%)] to-[hsl(0_100%_40%)]" style={{ width: `${Math.min(100, pct)}%` }} />
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
 {/* v25.48.3 Q-F2 — highlight the soft-circle review tab when there are
     soft circles awaiting founder confirmation, so the confirm/mark-funded
     actions are easy to find. Amber ring + dot when any row is not committed. */}
 <TabsTrigger value="soft" data-testid="tab-soft"
   className={asArray<SoftCircle>(softs.data).some(s => s.status !== "committed") ? "ring-2 ring-amber-400 data-[state=inactive]:bg-amber-50" : ""}>
   Soft-circle book ({softs.data?.length ?? 0})
   {asArray<SoftCircle>(softs.data).some(s => s.status !== "committed") && (
     <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" aria-label="pending confirmations" />
   )}
 </TabsTrigger>
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
 {/* W-SHADIE 4a — Resent gets its own dated column between Sent and Viewed. */}
 <th className="text-left font-medium px-3 py-2.5">Resent</th>
 <th className="text-left font-medium px-3 py-2.5">Viewed</th>
 <th className="text-left font-medium px-3 py-2.5">Expires</th>
 <th className="text-right font-medium px-6 py-2.5">Actions</th>
 </tr>
 </thead>
 <tbody>
 {asArray(invs.data).length === 0 && (
 <tr>
 <td colSpan={7} className="px-6 py-10 text-center" data-testid="empty-invitations">
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
 {/* v25.55 5b — a resent (still "sent") invite shows a teal "resent" chip. */}
 {/* W-INVEST BUG B — additive "Active" badge next to the existing StateBadge when
     the investor is committed/funded on this round OR in the company committed cap table. */}
 <td className="px-3 py-3">
   <div className="inline-flex items-center gap-1.5">
     <StateBadge state={i.state === "sent" && i.resentAt ? "resent" : i.state} />
     {i.active && (
       <Badge variant="outline" className="gap-1 bg-emerald-500/10 border-emerald-500/40 text-emerald-700 text-[10px]" data-testid={`badge-inv-active-${i.id}`}>Active</Badge>
     )}
   </div>
 </td>
 {/* W3 Shadie 6a — show BOTH the absolute date AND the relative "Xd ago" in
     the Sent and Expires columns (previously Sent was relative-only and
     Expires absolute-only). Absolute on top, relative muted below. */}
 <td className="px-3 py-3 text-muted-foreground" data-testid={`inv-sent-${i.id}`}>
  {i.sentAt ? (<div className="leading-tight"><div>{fmtDate(i.sentAt)}</div><div className="text-xs text-muted-foreground/70">{timeAgo(i.sentAt)}</div></div>) : "—"}
 </td>
 {/* W-SHADIE 4a — Resent date, same absolute-over-relative pattern as Sent. */}
 <td className="px-3 py-3 text-muted-foreground" data-testid={`inv-resent-${i.id}`}>
  {i.resentAt ? (<div className="leading-tight"><div>{fmtDate(i.resentAt)}</div><div className="text-xs text-muted-foreground/70">{timeAgo(i.resentAt)}</div></div>) : "—"}
 </td>
 <td className="px-3 py-3 text-muted-foreground" data-testid={`inv-viewed-${i.id}`}>{i.viewedAt ? (<div className="leading-tight"><div>{fmtDate(i.viewedAt)}</div><div className="text-xs text-muted-foreground/70">{timeAgo(i.viewedAt)}</div></div>) : "—"}</td>
 <td className="px-3 py-3 text-muted-foreground" data-testid={`inv-expires-${i.id}`}>
  {i.expiresAt ? (<div className="leading-tight"><div>{fmtDate(i.expiresAt)}</div><div className="text-xs text-muted-foreground/70">{timeAgo(i.expiresAt)}</div></div>) : "—"}
 </td>
 <td className="px-6 py-3 text-right">
 <div className="inline-flex gap-1">
 {/* v25.55 3a — cannot remind an investor who already accepted.
     Wave C1 (Shadie 3a/4a/5a) — a REVOKED invitation is terminal: resend,
     extend-expiry, and revoke are all disabled (no re-notifying a revoked
     investor). Expiry extend is also disabled for accepted (Ozan: revoked
     AND accepted). */}
 {/* W-SHADIE 5a — icon THEN visible label, so the founder can tell the
     three actions apart without hovering. Disabled logic and data-testids
     are unchanged; the testid stays `button-expiry-` despite the "Extend"
     label (renaming it would break existing selectors). */}
 <Button size="sm" variant="ghost" onClick={() => resendMut.mutate(i.id)} disabled={resendMut.isPending || i.state === "accepted" || i.state === "revoked"} aria-label="Resend invitation" data-testid={`button-resend-${i.id}`}><Repeat className="h-3.5 w-3.5 mr-1" />Resend</Button>
 <Button size="sm" variant="ghost" onClick={() => extendExpiryMut.mutate(i.id)} disabled={extendExpiryMut.isPending || i.state === "revoked" || i.state === "accepted"} aria-label="Extend invitation expiry" data-testid={`button-expiry-${i.id}`}><Calendar className="h-3.5 w-3.5 mr-1" />Extend</Button>
 <Button size="sm" variant="ghost" onClick={() => setRevokeId(i.id)} disabled={i.state === "revoked"} className="text-destructive hover:text-destructive" aria-label="Revoke invitation" data-testid={`button-revoke-${i.id}`}><Ban className="h-3.5 w-3.5 mr-1" />Revoke</Button>
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
 {/* WAVE 43 · R7 — the close status and the two late-acceptance doors sit at the
     top of the soft-circle book, which is where a founder looks when an investor
     says "I still want in". */}
 <RoundCloseLateAcceptance
  roundId={id}
  /* `asArray` erases the element type to `unknown`; the typed query data is
     used directly so the mapping stays type-checked. */
  invitations={(invs.data ?? []).map((inv) => ({
   id: inv.id,
   investorName: inv.investorName,
   investorEmail: inv.investorEmail,
   state: inv.state,
  }))}
 />
 {/* v24.3 — Wire Transfer Instructions. Founder publishes the company's
     bank details so investors with a signed (confirmed) soft-circle know
     where to send the funds. Addresses Avi's main v24.3 complaint. */}
 <Card className="mb-4" data-testid="card-wire-instructions-founder">
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Wire Transfer Instructions</CardTitle>
 <Button size="sm" variant="outline" onClick={openWireDialog} data-testid="button-edit-wire-instructions">
 {wireInstr.data ? <><FileText className="h-3.5 w-3.5 mr-1" /> Edit</> : <><Plus className="h-3.5 w-3.5 mr-1" /> Set instructions</>}
 </Button>
 </CardHeader>
 <CardContent>
 {wireInstr.isLoading ? (
 <div className="text-sm text-muted-foreground">Loading…</div>
 ) : wireInstr.data ? (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm" data-testid="founder-wire-display">
 <div><span className="text-muted-foreground">Bank</span><div className="font-medium">{wireInstr.data.bankName}</div></div>
 <div><span className="text-muted-foreground">Account name</span><div className="font-medium">{wireInstr.data.accountName}</div></div>
 <div><span className="text-muted-foreground">Account number</span><div className="font-mono">{wireInstr.data.accountNumber}</div></div>
 {wireInstr.data.routingNumber && <div><span className="text-muted-foreground">Routing</span><div className="font-mono">{wireInstr.data.routingNumber}</div></div>}
 {wireInstr.data.swift && <div><span className="text-muted-foreground">SWIFT/BIC</span><div className="font-mono">{wireInstr.data.swift}</div></div>}
 {wireInstr.data.reference && <div><span className="text-muted-foreground">Reference</span><div className="font-medium">{wireInstr.data.reference}</div></div>}
 {wireInstr.data.notes && <div className="sm:col-span-2"><span className="text-muted-foreground">Notes</span><div>{wireInstr.data.notes}</div></div>}
 </div>
 ) : (
 <div className="text-sm text-muted-foreground" data-testid="founder-wire-empty">
 No wire instructions set yet. Investors with a signed soft-circle won't see where to wire until you add them.
 </div>
 )}
 </CardContent>
 </Card>

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
 <Button size="sm" variant="outline" className="mt-3" data-testid="button-empty-crm" asChild><Link href="/founder/crm">Open investor CRM <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link></Button>
 </td>
 </tr>
 )}
 {softs.data?.map(s => (
 <tr key={s.id} className="border-b border-border/60 hover:bg-secondary/30" data-testid={`row-sc-${s.id}`}>
 <td className="px-6 py-3 font-medium">{s.investorName}</td>
 <td className="px-3 py-3 text-right font-mono tabular-nums">{fmtUSD(s.amount)}</td>
 <td className="px-3 py-3 text-muted-foreground">{fmtDate(s.createdAt)}</td>
 {/* W-INVEST BUG B — additive "Active" badge next to the existing StateBadge. */}
 <td className="px-3 py-3">
   <div className="inline-flex items-center gap-1.5">
     <StateBadge state={s.status} />
     {s.active && (
       <Badge variant="outline" className="gap-1 bg-emerald-500/10 border-emerald-500/40 text-emerald-700 text-[10px]" data-testid={`badge-sc-active-${s.id}`}>Active</Badge>
     )}
     {/* WAVE 43 · OWNER RULING R7 — "the money is allowed in, but the record
         must never look like it arrived on time." The mark is rendered
         wherever the commitment appears; this is the founder's copy of it,
         carrying the attribution so the founder sees whose decision it was. */}
     {s.acceptedAfterClose && (
       <Tooltip>
         <TooltipTrigger asChild>
           <Badge variant="outline" className="gap-1 bg-amber-500/10 border-amber-500/50 text-amber-800 text-[10px] cursor-help" data-testid={`badge-sc-late-${s.id}`}>
             {s.lateAcceptance?.label ?? "Accepted after close"}
           </Badge>
         </TooltipTrigger>
         <TooltipContent className="max-w-xs text-xs leading-relaxed">
           Accepted after this round closed on {fmtDate(s.lateAcceptance?.closedAt)}
           {s.lateAcceptance?.acceptedByName ? <> by {s.lateAcceptance.acceptedByName}</> : null}
           {s.lateAcceptance?.acceptedAt ? <> on {fmtDate(s.lateAcceptance.acceptedAt)}</> : null}.
           {s.lateAcceptance?.reason ? <> Reason: “{s.lateAcceptance.reason}”</> : null}
         </TooltipContent>
       </Tooltip>
     )}
   </div>
 </td>
 <td className="px-6 py-3 text-right">
 <div className="inline-flex gap-1">
 {/* v25.48.3 Q-F2 — the founder-facing "confirm investor onto cap table"
     actions live HERE, on the round's soft-circle review row. Both are now
     HIGHLIGHTED (solid, not subtle outline) so the founder can clearly find
     "I received this investor's funds; put them on the cap table."
     Confirm = brand red; Mark funded = emerald (money-in). */}
 {s.status !== "committed" && (
 <Button size="sm" onClick={() => setConfirmSoftId(s.id)} data-testid={`button-confirm-${s.id}`} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white font-semibold">
 <Check className="h-3.5 w-3.5 mr-1" /> Confirm
 </Button>
 )}
 {s.status === "confirmed" && (
 <Button size="sm" onClick={() => wireFundedMut.mutate(s.id)} disabled={wireFundedMut.isPending} data-testid={`button-wire-funded-${s.id}`} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
 <Wallet className="h-3.5 w-3.5 mr-1" /> Confirm / mark funded
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

 {/* v24.3 — Wire instructions edit dialog. */}
 <Dialog open={wireDlgOpen} onOpenChange={setWireDlgOpen}>
 <DialogContent data-testid="dialog-wire-instructions">
 <DialogHeader>
 <DialogTitle>Wire Transfer Instructions</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 <div>
 <Label htmlFor="wire-bank">Bank name *</Label>
 <Input id="wire-bank" data-testid="input-wire-bankName" value={wireForm.bankName} onChange={(e) => setWireForm({ ...wireForm, bankName: e.target.value })} placeholder="e.g. First Republic Bank" />
 </div>
 <div>
 <Label htmlFor="wire-acctname">Account name *</Label>
 <Input id="wire-acctname" data-testid="input-wire-accountName" value={wireForm.accountName} onChange={(e) => setWireForm({ ...wireForm, accountName: e.target.value })} placeholder="Beneficiary / company legal name" />
 </div>
 <div>
 <Label htmlFor="wire-acctnum">Account number *</Label>
 <Input id="wire-acctnum" data-testid="input-wire-accountNumber" value={wireForm.accountNumber} onChange={(e) => setWireForm({ ...wireForm, accountNumber: e.target.value })} />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <Label htmlFor="wire-routing">Routing number</Label>
 <Input id="wire-routing" data-testid="input-wire-routingNumber" value={wireForm.routingNumber} onChange={(e) => setWireForm({ ...wireForm, routingNumber: e.target.value })} />
 </div>
 <div>
 <Label htmlFor="wire-swift">SWIFT/BIC</Label>
 <Input id="wire-swift" data-testid="input-wire-swift" value={wireForm.swift} onChange={(e) => setWireForm({ ...wireForm, swift: e.target.value })} />
 </div>
 </div>
 <div>
 <Label htmlFor="wire-ref">Reference</Label>
 <Input id="wire-ref" data-testid="input-wire-reference" value={wireForm.reference} onChange={(e) => setWireForm({ ...wireForm, reference: e.target.value })} placeholder="What investors should put on the wire" />
 </div>
 <div>
 <Label htmlFor="wire-notes">Notes</Label>
 <Input id="wire-notes" data-testid="input-wire-notes" value={wireForm.notes} onChange={(e) => setWireForm({ ...wireForm, notes: e.target.value })} placeholder="Optional instructions for investors" />
 </div>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setWireDlgOpen(false)} data-testid="button-wire-cancel">Cancel</Button>
 <Button
 onClick={() => saveWireMut.mutate()}
 disabled={saveWireMut.isPending || !wireForm.bankName.trim() || !wireForm.accountName.trim() || !wireForm.accountNumber.trim()}
 data-testid="button-wire-save"
 >
 {saveWireMut.isPending ? "Saving…" : "Save instructions"}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
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
 /* ═════════════════════════════════════════════════════════════
    WAVE 58b · DEFECT 4 (R21) — THE USER-VISIBLE HARDCODED 10%.
    ═════════════════════════════════════════════════════════════
    WAS: the literal string 10%-post-money-pool-refresh (quoted here with hyphens
    only so the source-lock test cannot be satisfied by this comment), rendered
    IDENTICALLY on
    every round on live v26.17.0, Active and Draft alike — confirmed on production
    by the 2026-08-15 browser audit (`build_log/wave58b/LIVE_AUDIT_2026_08_15.md`,
    "THE POOL IS EXPRESSED IN 5 PLACES", item 3: "read-only, and this is the
    hardcode"). A founder who set 15% PRE-money in the wizard read "10%
    post-money" here, on the round's own Terms tab.

    NOW: read from the round. `optionPoolPostPercent` / `optionPoolMode` live in
    `extras_json` and are re-spread by `roundsStore.rowToRound`.
    PERCENT-AS-WRITTEN (R16): the stored `"15"` prints as `15%`, unrescaled.
    ABSENT MEANS ABSENT (R6): a round with no pool says so by name rather than
    displaying somebody else's 10%. */
 ["ESOP top-up", (() => {
   const pct = (r as unknown as Record<string, unknown>).optionPoolPostPercent;
   if (pct === null || pct === undefined || String(pct).trim() === "") {
     return "No option-pool top-up recorded on this round";
   }
   const mode = String((r as unknown as Record<string, unknown>).optionPoolMode ?? "pre_money") === "post_money"
     ? "post-money"
     : "pre-money";
   return `${String(pct)}% of post-money fully-diluted, ${mode} placement`;
 })()],
 /* ════════════════════════════════════════════════════════════
    WAVE 58e · D3.7 — THE TERMS TAB SHOWED NO DISCOUNT AT ALL.
    ════════════════════════════════════════════════════════════
    Verified on live v26.17.0 (R31, "Also observed"): the round-detail Terms tab
    rendered NO discount field, even on SAFE and Note rounds, so the value was
    reachable only through the rounds-list Edit-terms modal — which is also the only
    place the corrupt `20260707` was ever visible. A term that governs what every
    SAFE holder converts into was absent from the round's own terms panel.

    IT IS RENDERED FROM THE ROUND (R21), NOT FROM A FIXED STRING, with BOTH industry
    forms (R30.2) and the conversion arithmetic (R30.3). ABSENT MEANS ABSENT (R6): a
    round with no discount says so by name rather than printing 0%.

    OUT-OF-RANGE IS SURFACED, NOT REWRITTEN (R31-a / D2.3). The corrupt live row is
    test data; it is named here as unreadable, with what to do, and nothing is
    silently corrected. */
 ["Discount (% off the round price)", (() => {
   const raw = (r as unknown as Record<string, unknown>).discount;
   if (raw === null || raw === undefined || String(raw).trim() === "") {
     return "No discount recorded on this round";
   }
   const dd = describeDiscount(raw, r.pricePerShare);
   if (!dd) return "No discount recorded on this round";
   if (dd.refusal) {
     return `Stored value “${dd.discountPercent}” cannot be read as a discount — it is outside the permitted range of 0 to under 100. Capavate will not guess what it meant and has not changed it. Correct it on Edit terms.`;
   }
   return `${dd.bothForms}${dd.conversionArithmetic ? ` Conversion price at this round's price per share: ${dd.conversionArithmetic}.` : " This round stores no price per share, so no conversion price is quoted."}${dd.marketNormNote ? ` ${dd.marketNormNote}` : ""}`;
 })()],
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
 {/* WAVE 58b · DEFECT 2 — THE CAPTION ABOVE PROMISED AN EDITABILITY THIS PANEL
     NEVER PROVIDED. The 2026-08-15 live audit confirmed the panel is STATIC TEXT
     in Draft as well as Active, while its caption says editing "is permitted in
     draft state". The caption is left byte-identical (it is a true statement
     about the RULE) and the missing half is supplied: where the edit actually
     happens. That surface now carries the pool fields, which is Defect 2. */}
 <span data-testid="terms-edit-where"> The editable surface is <strong>Edit terms</strong> on the Rounds list, which can change the round name, the amounts, the valuations, the price, the close date, the fully-diluted pre-money share count, and the option-pool percentage and placement. This panel is read-only. The server refuses every term edit once the round is <span className="font-mono">closed</span> or <span className="font-mono">funded</span>, by name, with <span className="font-mono">closed_round_readonly</span>.</span>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="plan">
 <UseOfProceeds round={r} />
 {/* ═══════════════════════════════════════════════════════════════
     WAVE 80 · ITEM 2 — THE READERS FOR THE OTHER THREE RESCUED CONTROLS.
     ═══════════════════════════════════════════════════════════════
     APPENDED AT THE END of this container, never inserted at its head: the
     silent-drop guard reads a head insertion in an ordered container as a mass
     removal of everything after it, which has cost this project one false alarm
     across 18 panels already. Both panels render only when the founder actually
     recorded something, so a round with neither is byte-identical on screen to
     how it looked before this wave. */}
 <div className="mt-4 space-y-4">
 <RoundNarrative round={r} />
 <TranchePlan round={r} />
 </div>
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

 {/* v25.55 Q3 — Record existing investors (backfill) dialog */}
 <Dialog open={backfillOpen} onOpenChange={setBackfillOpen}>
 <DialogContent className="max-w-lg">
 <DialogHeader>
 <DialogTitle>Record an existing investor</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 <p className="text-sm text-muted-foreground">
 Seat an investor who already committed off-platform directly onto this round's cap table as already-committed. They'll also receive an email inviting them to register so they can log in and communicate.
 </p>
 <div className="grid grid-cols-2 gap-3">
 <div><Label>First name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={backfillFirstName} onChange={e => setBackfillFirstName(e.target.value)} placeholder="First name" data-testid="input-backfill-first-name" /></div>
 <div><Label>Last name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={backfillLastName} onChange={e => setBackfillLastName(e.target.value)} placeholder="Last name" data-testid="input-backfill-last-name" /></div>
 </div>
 <div><Label>Email <span className="text-rose-500">*</span></Label><Input className="mt-1" type="email" value={backfillEmail} onChange={e => setBackfillEmail(e.target.value)} placeholder="investor@firm.com" data-testid="input-backfill-email" /></div>
 <div className="grid grid-cols-2 gap-3">
 <div><Label>Amount <span className="text-rose-500">*</span></Label><Input className="mt-1" value={backfillAmount} onChange={e => setBackfillAmount(e.target.value)} placeholder="e.g. 50000" data-testid="input-backfill-amount" /></div>
 <div><Label>Shares <span className="text-rose-500">*</span></Label><Input className="mt-1" value={backfillShares} onChange={e => setBackfillShares(e.target.value)} placeholder="e.g. 5000" data-testid="input-backfill-shares" /></div>
 </div>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setBackfillOpen(false)}>Cancel</Button>
 <Button
 onClick={() => backfillMut.mutate()}
 disabled={backfillMut.isPending || !backfillFirstName.trim() || !backfillLastName.trim() || !backfillEmail.trim() || !backfillAmount.trim() || !backfillShares.trim()}
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
 data-testid="button-backfill-submit"
 >
 <Users className="h-4 w-4 mr-2" /> Record investor
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Invite dialog */}
 <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
 <DialogContent className="max-w-lg">
 <DialogHeader>
 <DialogTitle>Invite an investor</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 {/* v24.4 BUG 044 — CRM picker. Choose an existing contact or add new. */}
 <div>
 <Label>Investor</Label>
 <select
 className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
 data-testid="select-invite-source"
 value={inviteSource === "new" ? "__new__" : inviteCrmId}
 onChange={e => {
 const v = e.target.value;
 if (v === "__new__") {
 setInviteSource("new");
 setInviteCrmId("");
 setInviteName("");
 setInviteFirstName("");
 setInviteLastName("");
 setInviteEmail("");
 } else {
 setInviteSource("crm");
 setInviteCrmId(v);
 const c = asArray<{ id: string; name: string; email: string }>(crmContacts.data).find(x => x.id === v);
 if (c) { setInviteName(c.name ?? ""); setInviteEmail(c.email ?? ""); }
 }
 }}
 >
 <option value="" disabled>Select from CRM…</option>
 {asArray<{ id: string; name: string; email: string; firmName?: string }>(crmContacts.data).map(c => (
 <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</option>
 ))}
 <option value="__new__">+ Add new investor</option>
 </select>
 </div>
 {inviteSource === "new" && (
 <>
 <div><Label>First name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={inviteFirstName} onChange={e => setInviteFirstName(e.target.value)} placeholder="First name" data-testid="input-invite-first-name" /></div>
 <div><Label>Last name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={inviteLastName} onChange={e => setInviteLastName(e.target.value)} placeholder="Last name" data-testid="input-invite-last-name" /></div>
 <div><Label>Email <span className="text-rose-500">*</span></Label><Input className="mt-1" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="investor@firm.com" data-testid="input-invite-email" /></div>
 {/* v25.53 8a — optional fields matching the CRM menu. */}
 <div><Label>Company name (optional)</Label><Input className="mt-1" value={inviteCompany} onChange={e => setInviteCompany(e.target.value)} placeholder="Firm / fund name" data-testid="input-invite-company" /></div>
 <div><Label>Stage focus (optional)</Label><Input className="mt-1" value={inviteStageFocus} onChange={e => setInviteStageFocus(e.target.value)} placeholder="e.g. Seed–Series A" data-testid="input-invite-stage-focus" /></div>
 <div><Label>Typical market size (optional)</Label><Input className="mt-1" value={inviteMarketSize} onChange={e => setInviteMarketSize(e.target.value)} placeholder="e.g. $50M–$100M" data-testid="input-invite-market-size" /></div>
 </>
 )}
 {inviteSource === "crm" && inviteCrmId && (
 <div className="text-sm text-muted-foreground" data-testid="crm-selected-summary">
 Inviting <strong>{inviteName || "—"}</strong>{inviteEmail ? ` (${inviteEmail})` : ""}
 </div>
 )}
 <div>
 <Label>Personal note (optional)</Label>
 <Input className="mt-1" value={inviteNote} onChange={e => { setInviteNote(e.target.value); setInvitePreviewHtml(null); }} placeholder="Following up from our coffee at Latitude…" data-testid="input-invite-note" />
 <p className="text-[11px] text-muted-foreground mt-1">Your note is added to the standard invitation email. The round terms and name are not changed — only your message.</p>
 </div>
 {/* Wave C3 (Shadie 2a) — exact-HTML preview: the founder can SEE precisely
     what the investor receives before sending, and refine only the note. */}
 <div>
 <Button type="button" variant="outline" size="sm" onClick={() => previewInviteMut.mutate()} disabled={previewInviteMut.isPending} data-testid="button-preview-invite">
 {previewInviteMut.isPending ? "Building preview…" : "Preview email"}
 </Button>
 {invitePreviewHtml !== null && (
 <div className="mt-2 border rounded-md p-3 bg-white max-h-64 overflow-auto text-sm" data-testid="invite-email-preview">
 <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Email preview — exactly what the investor will receive</div>
 {/* Server-rendered markup; every interpolated value is HTML-escaped server-side. */}
 <div dangerouslySetInnerHTML={{ __html: invitePreviewHtml }} />
 </div>
 )}
 </div>
 <div><Label>Expires in</Label>
 <select className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm" data-testid="select-invite-expiry" value={inviteExpiry} onChange={e => { setInviteExpiry(e.target.value); setInvitePreviewHtml(null); }}>
 {/* W-SHADIE 3a — 7 days is the default and the first option; the literal
     values mirror INVITE_EXPIRY_OPTIONS (native <select> idiom, so the list
     is written out rather than mapped). "Never" is retained. */}
 <option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="never">Never</option>
 </select>
 </div>
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
 {/* B-303 fix v23.4.12: wire Send invitation to sendInviteMut -- button-send-invite-mutation-v23412 */}
        <Button
          onClick={() => sendInviteMut.mutate()}
          disabled={sendInviteMut.isPending || (inviteSource === "new"
            ? !(inviteFirstName.trim() && inviteLastName.trim() && /.+@.+\..+/.test(inviteEmail.trim()))
            : !inviteEmail.trim())}
          data-testid="button-send-invite"
        >Send invitation</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* v25.19 Lane 3 NC3 (hard close) — the pre-v25.19 dialog showed a fake
     "Processing 24 rows…" toast without ever reading the CSV or POSTing to a
     real endpoint. /api/rounds/:id/invitations/bulk has existed for waves.
     This now: parses an uploaded CSV (header `name,email,note`), POSTs each
     row, reports created vs skipped, invalidates the invitations list. */}
 <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
 <DialogContent>
 <DialogHeader><DialogTitle>Bulk invite via CSV</DialogTitle></DialogHeader>
 <div className="space-y-3 text-sm">
 <p className="text-muted-foreground">Upload a CSV with columns <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">name,email,note</code>. Each row creates a pending invitation with the round's default 7-day expiry.</p>
 <input
 type="file"
 accept=".csv,text/csv"
 data-testid="input-bulk-csv"
 onChange={async (ev) => {
 const file = ev.target.files?.[0];
 if (!file) return;
 const text = await file.text();
 const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
 if (lines.length === 0) { toast({ title: "Empty CSV", variant: "destructive" }); return; }
 // Detect & skip a header row (case-insensitive: name,email,note).
 const startIdx = /^name\s*,\s*email/i.test(lines[0]) ? 1 : 0;
 const invitations = lines.slice(startIdx).map((row) => {
 const cols = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
 return { name: cols[0] || undefined, email: cols[1] || "", note: cols[2] || undefined };
 }).filter((r) => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
 if (invitations.length === 0) { toast({ title: "No valid email rows found", variant: "destructive" }); return; }
 try {
 const res = await apiRequest("POST", `/api/rounds/${id}/invitations/bulk`, { invitations });
 const j = await res.json();
 if (!res.ok || !j.ok) {
 toast({ title: "Bulk import failed", description: j.error ?? `HTTP ${res.status}`, variant: "destructive" });
 return;
 }
 const created = Array.isArray(j.created) ? j.created.length : 0;
 const skipped = Array.isArray(j.skipped) ? j.skipped.length : 0;
 toast({ title: "Bulk import complete", description: `${created} created, ${skipped} skipped` });
 // v25.20 Lane 6 NH fix: queryKey for invitations is the single template-literal
 // string `/api/rounds/${id}/invitations` (line 101). The previous tuple form
 // never matched, so the bulk import dialog closed without the list refreshing
 // — founders had to hard-reload to see the new rows. Match the exact key.
 queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
 setBulkOpen(false);
 } catch (err) {
 toast({ title: "Bulk import error", description: (err as Error).message, variant: "destructive" });
 }
 }}
 />
 </div>
 <DialogFooter>
 <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
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

/* WAVE 72 · R58 — EXPORTED so a test can MOUNT it and assert that the projection
   refusal really reaches the DOM. Additive: no behaviour, no JSX and no call site
   changes, and the component is still rendered only from this page. R58's rule is
   that a wave may not claim a user-visible improvement unless a test asserts the
   string renders, and a page this size cannot be mounted whole in jsdom. */
export function ProjectionPanel({ round }: { round: Round }) {
 const { toast } = useToast();
 // Patch v4: use the round's companyId (not hardcoded). Engine math unchanged.
 const projCompanyId = (round as any).companyId ?? "";
 const securities = useQuery<ApiSecurity[]>({
 queryKey: ["/api/companies", projCompanyId, "securities"],
 queryFn: async () => (await apiRequest("GET", `/api/companies/${encodeURIComponent(projCompanyId)}/securities`)).json(),
 enabled: !!projCompanyId,
 });

 /* ══════════════════════════════════════════════════════════════════════════
    WAVE 73 · ITEM 7 — THIS HOOK MOVED ABOVE THE EARLY RETURNS. IT IS THE WHOLE FIX.
    ══════════════════════════════════════════════════════════════════════════
    THE DEFECT, precisely: this `useQuery` used to sit BELOW the two early
    returns immediately after `securities`. On a cold cache the first render of
    this panel took `if (!securities.data) return <Loading/>` and therefore ran
    ONE hook; the render after the holder-list query resolved fell through and
    ran TWO. React compares hook counts between renders, raised
    "Rendered more hooks than during the previous render", and the Round Detail
    projection tab UNMOUNTED INTO THE ErrorBoundary — a founder opening the tab
    on a cold cache lost the entire projection, not one figure inside it.

    Hooks must be unconditional, so it is hoisted here, ABOVE both returns and
    beside the other `useQuery`. Nothing else moves: the two early returns, the
    engine call, every branch and every node below are byte-identical, and the
    comment that documented this query travels with it. It is not gated on
    `securities.data`, because a hook that is sometimes skipped is the defect.
    Reported by Wave 72 as F-1 / OQ-1. */

 /* ── WAVE 52c · B1 + B3 — THE PROJECTION NOW ASKS THE DATABASE ─────────────
    This panel is the production consumer of the Wave 52 pricing order. Until
    Wave 52c the engine ran here with NO mode argument, so the platform-level
    rollback flag — which the owner had been told was the rollback mechanism —
    could not affect this screen at all: a browser cannot read `platform_config`.
    It now asks the server, per mount, and passes the resolved mode into the
    engine. `staleTime: 0` and `refetchOnMount` are deliberate: a flag whose
    value is cached in the browser is a flag that needs a page reload to roll
    back.

    B3: the arithmetic on this screen MOVED for any company with a SAFE or a note
    (measured: founder 56.14% → 53.33%, Series A investors 21.05% → 25.00%, price
    $3.3333 → $2.6667). The new numbers are the correct ones. The disclosure below
    is why a founder or an investor is not left to discover that on their own. */
 const roundMath = useQuery<{
  ok: boolean;
  pricingOrder: { mode: "w52_post_pool_post_conversion" | "legacy_pre_w52"; enabled: boolean; source: string; version: number | null };
  disclosure: { headline: string; body: string };
 }>({
  queryKey: ["/api/founder/round-math/pricing-order", (round as any).id],
  queryFn: async () => (await apiRequest("GET", "/api/founder/round-math/pricing-order")).json(),
  staleTime: 0,
  refetchOnMount: "always",
 });
 if (!projCompanyId) return <div className="py-10 text-center text-muted-foreground">No active company — set one before projecting.</div>;
 if (!securities.data) return <div className="py-10 text-center text-muted-foreground">Loading securities…</div>;
 const pricingOrderMode = roundMath.data?.pricingOrder?.mode;
 const pre = runEngine(securities.data, "fully_diluted", "US", pricingOrderMode);
 // Wave C4 — a post-close projection is only meaningful with a real (positive)
 // pre-money valuation AND target/investment amount. A freshly-created round
 // often has neither (shown as "Unknown"/$0); feeding 0/0 into the engine
 // produced a price-per-share of 0/0 = NaN and crashed on BigInt(NaN),
 // taking down the whole tab. We now gate the projection: show the pre-close
 // cap table plus clear guidance instead of computing a degenerate round.
 const preMoneyNum = Number(round.preMoney);
 const targetNum = Number(round.targetAmount);
 const canProject = Number.isFinite(preMoneyNum) && preMoneyNum > 0 && Number.isFinite(targetNum) && targetNum > 0;
 /* ── WAVE 58 · R27 — THE PROJECTION READS THE ROUND'S POOL PERCENTAGE ───────
    THE GAP THIS CLOSES, precisely. This call is the production consumer of the
    engine, and it passed NO pool field. `compute.ts:457-458` is gated on
    `optionPoolPostPercent && optionPoolMode === "pre_money"`, so the pool
    arithmetic could not run here at all — which is why the W58 live walkthrough
    found that entering a pool changed nothing, and why the reachability claim
    that recommended this wave was wrong.

    The round now CARRIES the percentage the founder typed (persisted in
    `extras_json`, re-spread by `roundsStore.rowToRound`), and this panel passes
    it through. PERCENT-AS-WRITTEN (R16): the stored `"15"` is handed to the
    engine as `"15"` and read as 15%. No conversion at this boundary.

    Absent means ABSENT. When the round has no pool percentage the spread adds
    nothing and the projection behaves exactly as it did before — it does not
    fall back to the ambiguous legacy pool-size extra, because guessing that key's unit
    is the defect R16 forbids. */
 /* WAVE 58b · DEFECT 3 — THIS PANEL USES THE SAME BASE RESOLVER AS THE WIZARD.
    This is the surface that showed a DIFFERENT pool share count from the wizard,
    because the wizard sized against the typed count and the engine sized against
    the ledger — 2,500,000 vs 2,000,000 on the canonical example. Both now go
    through `resolveFdPreMoneyBase`, and when the two disagree the pool is NOT
    projected and the divergence is stated by name: a named refusal instead of two
    different numbers on two screens. */
 const projLedgerFd = ledgerFullyDilutedPreMoneyShares(securities.data);
 const projFdBase = resolveFdPreMoneyBase({
  declaredFdPreMoneyShares: (round as unknown as Record<string, unknown>).fdPreMoneyShares as
   string | number | null | undefined,
  ledgerFdShares: projLedgerFd,
  outstandingConvertibles: unconvertedConvertibleCount(securities.data),
 });
 const roundPoolPercent = (round as unknown as Record<string, unknown>).optionPoolPostPercent;
 const roundPoolMode = (round as unknown as Record<string, unknown>).optionPoolMode;
 const hasRoundPoolPercent =
 roundPoolPercent !== undefined && roundPoolPercent !== null && String(roundPoolPercent) !== ""
 /* DEFECT 3 — a pool is only projected once ONE base is settled. */
 && projFdBase.ok;
 /* ══════════════════════════════════════════════════════════════════════════
    WAVE 72 · DEFECT 1 / R58 — THE REFUSAL IS RENDERED, NOT THROWN AT THE PAGE.
    ══════════════════════════════════════════════════════════════════════════
    `projectPostClose` refuses BY NAME for a term it will not invent — a missing
    note rate, an unreadable cap convention, an unprotected down round, and (this
    wave) a pricing denominator of zero or a pricing solve that did not settle.
    Called bare in render, every one of those unmounted this whole page into the
    app-level `ErrorBoundary`: the founder saw a generic failure instead of the
    sentence the refusal carries, which is R58's "dead promise" — a carefully
    written refusal discarded at the boundary.
    Caught here and rendered below in the SAME card, so the refusal replaces the
    projection's VALUE and not its container (no silent drops). Anything that is
    not a named refusal is re-thrown untouched — a real bug must still surface. */
 let post: ReturnType<typeof projectPostClose> | null = null;
 let postRefusal: { code: string; name: string; field: string | null; message: string } | null = null;
 try {
 post = canProject
 ? projectPostClose(securities.data, {
 preMoneyValuation: preMoneyNum,
 investmentAmount: targetNum,
 series: round.name,
 ...(hasRoundPoolPercent
 ? {
 optionPoolPostPercent: String(roundPoolPercent),
 /* ══════════════════════════════════════════════════════════
    WAVE 58b · DEFECT 1.3 — THE FOUNDER'S OWN PLACEMENT NOW REACHES THE ENGINE.
    ══════════════════════════════════════════════════════════
    BEFORE: this line was the literal `"pre_money" as const`, so a round whose
    stored placement was `post_money` was projected under the OTHER convention
    and an amber sentence explained the mismatch after the fact. The founder's
    selection was overwritten here — a silent drop of a stored instruction.
    `compute.ts` now models both placements, so the stored value is passed
    through unchanged. An absent or unrecognised value resolves to `pre_money`,
    the market default (Cooley GO, "Negotiating the option pool"), which is also
    what the engine falls back to — one default, stated in both places. */
 optionPoolMode:
 String(roundPoolMode ?? "pre_money") === "post_money"
 ? ("post_money" as const)
 : ("pre_money" as const),
 }
 : {}),
 }, "US", pricingOrderMode)
 : null;
 } catch (err) {
 const e = err as { code?: string; name?: string; field?: string | null; message?: string };
 if (typeof e.code === "string" && e.code !== "") {
 postRefusal = { code: e.code, name: String(e.name ?? "RoundMathTermRefusal"), field: e.field ?? null, message: String(e.message ?? "") };
 } else {
 throw err;
 }
 }

 return (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 Pre-close vs post-close projection
 <Badge variant="outline" className="gap-1.5 bg-[hsl(0_100%_40%)]/10 border-[hsl(0_100%_40%)]/40 text-[hsl(0_100%_40%)] " data-testid="badge-engine-projection">
 <Cpu className="h-3 w-3" /> Engine v1.0.0
 </Badge>
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Computed live by <code className="font-mono text-[10px] bg-secondary/60 px-1 py-0.5 rounded">@capavate/cap-table-engine</code> by appending a synthetic priced round and re-running the pipeline.</p>
 </CardHeader>
 <CardContent>
 {canProject && post ? (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <SideTable title="Pre-close" rows={pre.rows} totalShares={pre.totalShares} testid="table-pre" />
 <SideTable title="Post-close" rows={post.rows} totalShares={post.totalShares} testid="table-post" highlight />
 </div>
 <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
 <ArrowRight className="h-3.5 w-3.5" />
 New investor allocation: <strong className="text-foreground">{fmtUSD(round.targetAmount)}</strong> at <strong className="text-foreground">${safeToFixed(round.pricePerShare, 4)}</strong>/share — {pre.formulaIdsUsed.length} → {post.formulaIdsUsed.length} formulas applied.
 </div>
 </>
 ) : postRefusal ? (
 <>
 {/* WAVE 72 · DEFECT 1 / R58 — THE NAMED REFUSAL, ON THE SCREEN. The pre-close
     column is UNCHANGED and still renders: only the post-close projection is
     refused, and the reason is the engine's own sentence rather than a generic
     "could not compute". A NEW SIBLING BRANCH — nothing in the two branches
     around it is moved, removed or re-nested. */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <SideTable title="Pre-close (current cap table)" rows={pre.rows} totalShares={pre.totalShares} testid="table-pre" />
 <div className="rounded-lg border border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5 p-4 text-xs space-y-2" data-testid="projection-refused">
 <div className="text-sm font-semibold">The post-close projection was refused</div>
 <p className="text-muted-foreground leading-relaxed" data-testid="projection-refused-message">{postRefusal.message}</p>
 <p className="text-[10px] text-muted-foreground">Refusal code: <code className="font-mono" data-testid="projection-refused-code">{postRefusal.code}</code>{postRefusal.field ? <> · field: <code className="font-mono">{postRefusal.field}</code></> : null}. Capavate shows no post-close figures while this is unresolved: every share count and percentage in that column is derived from the price per share.</p>
 </div>
 </div>
 </>
 ) : (
 <>
 {/* Wave C4 — projection gated until the round has a positive pre-money + target. */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <SideTable title="Pre-close (current cap table)" rows={pre.rows} totalShares={pre.totalShares} testid="table-pre" />
 <div className="rounded-lg border border-dashed border-border flex items-center justify-center p-6 text-center text-sm text-muted-foreground" data-testid="projection-needs-terms">
 Add a pre-money valuation and a target amount in <strong className="mx-1 text-foreground">Edit terms</strong> to see the post-close projection.
 </div>
 </div>
 <div className="text-xs text-muted-foreground mt-4" data-testid="projection-gated-note">
 The post-close projection needs a positive pre-money valuation and target raise to compute the new-investor allocation and price per share.
 </div>
 </>
 )}
 <div className="mt-3">
 <Button size="sm" variant="outline" onClick={() => toast({ title: "Soft circle validated", description: `Engine projection committed for ${round.name}.` })} data-testid="button-validate-soft-circle">
 <Check className="h-4 w-4 mr-2" /> Validate soft circle (commit projection)
 </Button>
 </div>
 {/* WAVE 58 · R27 — APPENDED AT THE END AS A SIBLING, for the same reason the
     Wave 52c block below was: nothing above is moved, removed or re-nested, so
     the silent-drop guard census cannot change shape.

     Every percentage on this screen must name its denominator, and the pool is
     the reason the numbers above are what they are, so it is disclosed rather
     than left for the founder to infer. */}
 {hasRoundPoolPercent && (
 <div className="mt-4 rounded-md border border-border p-3 text-xs space-y-1" data-testid="disclosure-w58-option-pool">
 <div className="font-medium">Option pool applied to this projection</div>
 <div className="flex justify-between font-mono">
 <span>Target pool</span>
 <span>{String(roundPoolPercent)}% of post-money fully-diluted shares</span>
 </div>
 <div className="flex justify-between font-mono">
 <span>Placement recorded on the round</span>
 <span>{String(roundPoolMode ?? "pre_money") === "post_money" ? "Post-money — everyone pays" : "Pre-money — the existing holders pay"}</span>
 </div>
 <p className="text-[10px] text-muted-foreground">
 Percent as written: {String(roundPoolMode ?? "pre_money") === "post_money" ? "this figure is" : "this figure is"} {String(roundPoolPercent)} meaning {String(roundPoolPercent)}%.
 {String(roundPoolMode ?? "pre_money") === "post_money"
 ? " The pool top-up is OUTSIDE the pricing denominator, so it does not change the price per share; it dilutes the existing holders and the incoming investor in exact proportion to what each holds after the raise, and that dilution is already reflected in every share count and percentage in the post-close column above."
 : " The pool top-up is inside the pricing denominator, so it lowers the price per share and it is already reflected in every share count and percentage in the post-close column above."}
 </p>
 {/* WAVE 58b · DEFECT 1.3 — REPLACES A WARNING THAT IS NO LONGER TRUE. The
     amber block that used to sit here said the figures applied the PRE-MONEY
     convention because that was the only one the engine modelled. Both are now
     modelled, so the honest statement is which one was applied and what it
     means — not an apology for applying the wrong one. */}
 {String(roundPoolMode ?? "pre_money") === "post_money" && (
 <p className="text-[10px] text-muted-foreground" data-testid="disclosure-w58-pool-placement-warning">
 This round records a POST-MONEY placement and the figures above apply it: the price per share is the
 pre-money valuation divided by the fully-diluted count BEFORE the new reserve, so the effective
 pre-money is the full headline figure and the pool's dilution is shared pro-rata with the incoming
 investor. Post-money placement is a negotiated departure from the NVCA/Cooley model form, which
 assumes the pre-money convention.
 </p>
 )}
 </div>
 )}
 {/* ════════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 3 — WHICH FULLY-DILUTED BASE THIS PROJECTION USED.
     ════════════════════════════════════════════════════════════════
     OUTSIDE the pool card deliberately: when the declared count and the ledger
     disagree the pool is not projected at all, so a message inside the pool card
     would not render. APPENDED AT THE END AS A SIBLING — nothing above is moved,
     removed or re-nested, so the silent-drop guard census stays additive. */}
 <div className="mt-4 rounded-md border border-border p-3 text-xs" data-testid="disclosure-w58b-fd-base">
 <div className="font-medium">{projFdBase.ok ? "Fully-diluted pre-money base used by this projection" : "The fully-diluted pre-money base could not be settled"}</div>
 <p className="mt-1 text-[10px] text-muted-foreground">{projFdBase.ok ? projFdBase.label : projFdBase.reason}</p>
 {!projFdBase.ok && (
 <p className="mt-1 text-[10px] text-muted-foreground">Refusal code: <code className="font-mono">{projFdBase.code}</code>. No option pool is applied to the figures above while this is unresolved — sizing it against one of two disagreeing counts would show you a number the round wizard does not agree with.</p>
 )}
 </div>
 {/* WAVE 52c · B3 — APPENDED AT THE END AS A SIBLING. Nothing above is moved,
     removed or re-nested, so the silent-drop guard census cannot change shape. */}
 {roundMath.data?.disclosure && (
 <div
 className="mt-4 rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs"
 data-testid="disclosure-w52c-pricing-order"
 >
 <div className="font-semibold mb-1">{roundMath.data.disclosure.headline}</div>
 <p className="text-muted-foreground">{roundMath.data.disclosure.body}</p>
 <p className="text-muted-foreground mt-1.5">
 Pricing order in force: <span className="font-mono">{roundMath.data.pricingOrder.mode}</span>
 {" "}(source: {roundMath.data.pricingOrder.source}
 {roundMath.data.pricingOrder.version != null ? `, revision ${roundMath.data.pricingOrder.version}` : ""}).
 Percentages in the tables above are the <strong>% of fully-diluted shares</strong>.
 </p>
 </div>
 )}
 {roundMath.isError && (
 <div className="mt-4 rounded-md border border-border p-3 text-xs text-muted-foreground" data-testid="disclosure-w52c-unavailable">
 The platform pricing-order setting could not be read, so this projection was computed on the
 engine's own default ordering. This is stated rather than hidden.
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

/* ── WAVE 71 · D18 — THE UNDEFINED RATIO, WITHOUT CHANGING THE CELL'S SHAPE ───
   `ownershipPercent` is `string | null`; `null` means the view's denominator was
   zero, i.e. 0 / 0, which owner ruling R47 says is UNDEFINED and not zero. The
   numeric part is replaced by an em-dash rather than by `0.00`.
   WHY THE `%` AND THE sr-only SPAN STAY AS DIRECT CHILDREN of the cell: the
   silent-drop guard baselines this cell's rendered child shape
   (`td … child=#text#1`, `childorder={expr}|#text`). Wrapping the whole cell in a
   ternary of fragments REMOVED two baselined panel-body items and the guard blocked
   the build — correctly, because it could not tell an honesty fix from a deletion.
   Keeping `{expr}` + the `%` text child + the span preserves the shape exactly.
   THE `—%` COMBINATION IS UNREACHABLE ON THIS SURFACE, stated rather than assumed:
   `SideTable` renders the pre/post projection, which only renders when `canProject`
   is true (`RoundDetail.tsx`, `preMoney > 0 && target > 0`), so the denominator is
   never zero here. The branch exists because the engine's CONTRACT allows null, not
   because this screen can reach it. */
function ownershipCellText(v: string | null): string {
  /* WAVE 72 · DEFECT 2 — DELEGATES, so there is ONE definition of "what an
     undefined ownership percentage looks like" instead of two. This page was the
     null-aware one; `client/src/pages/founder/CapTable.tsx` was not, and rendered
     `NaN%`. Two implementations of one display rule is how the two screens came to
     disagree, so the rule now lives in `@/lib/captable/ownershipPercent` and both
     pages import it. Behaviour here is byte-identical: `null` → `—`, `"0"` → `0.00`. */
  return ownershipPercentCellText(v);
}

/* WAVE 71 · D18 — `ownershipPercent` is `string | null` on the engine contract;
   `null` means a zero-share denominator (0 ÷ 0, undefined — R47). This prop type
   now matches the engine rather than narrowing it, and the cell below renders the
   em-dash instead of a confident 0.00%. */
function SideTable({ title, rows, totalShares, testid, highlight }: { title: string; rows: { holderName: string; holderType: string; kind: string; shares: bigint; ownershipPercent: string | null }[]; totalShares: bigint; testid: string; highlight?: boolean }) {
 return (
 <div className={`rounded-lg border ${highlight ? "border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5" : "border-border"}`}>
 <div className={`px-4 py-3 border-b ${highlight ? "border-[hsl(0_100%_40%)]/30" : "border-border"} flex items-center justify-between`}>
 <h4 className="text-sm font-semibold">{title}</h4>
 <span className="text-xs text-muted-foreground font-mono tabular-nums">{fmtNum(Number(totalShares))} shares</span>
 </div>
 <table className="w-full text-xs" data-testid={testid}>
 <thead>
 <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/60">
 <th className="text-left font-medium px-4 py-2">Holder</th>
 <th className="text-right font-medium px-2 py-2">Shares</th>
 <th className="text-right font-medium px-4 py-2">%<span className="ml-1 font-normal normal-case text-muted-foreground">of fully-diluted</span></th>
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
 <td className="px-4 py-1.5 text-right font-mono tabular-nums">{ownershipCellText(r.ownershipPercent)}%<span className="sr-only"> of fully-diluted shares</span></td>
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
 <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] ${active ? "border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)]/10 text-foreground font-medium" : done ? "border-emerald-300/60 bg-emerald-50 text-emerald-700 " : "border-border text-muted-foreground"}`}>
 <div className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold ${active ? "bg-[hsl(0_100%_40%)] text-white" : done ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
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
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-[hsl(0_100%_40%)]" />Co-investors <HelpTip>The follower book. Investors who join after the lead's terms are set.</HelpTip></CardTitle></CardHeader>
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
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-[hsl(0_100%_40%)]" />Timing <HelpTip>Carta benchmark: median seed round closes in 65 days from open. Series A in 90 days.</HelpTip></CardTitle></CardHeader>
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

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 80 · ITEM 2 + ITEM 4.3 — USE OF PROCEEDS: BOTH SHAPES RENDER, AND THE
   BUTTON THAT ADMITTED IT WAS A STUB NO LONGER REPORTS SUCCESS FOR NOTHING.
   ════════════════════════════════════════════════════════════════════════════
   Two things were wrong on this one card.

   ONE — THE SHAPE CONTRADICTION. The founder wizard collects use of proceeds as a
   single free-text narrative; this reader was typed for an array of
   `{category, amount, percent}` rows that only `server/mockData.ts` ever produced.
   Wave 80 keeps the free text and renders BOTH shapes here. It does NOT derive
   rows from a sentence: that would mean inventing per-bucket percentages and
   dollar amounts the founder never entered and putting them on a document
   investors read. The rows path below is unchanged, so every existing structured
   round renders exactly as it did.

   TWO — THE DEAD CONTROL. "Add use of proceeds" fired a toast titled "Add use of
   proceeds" whose body admitted the editor was stubbed. A control that reports
   success while doing nothing is worse than one that says it is unavailable, so it
   is now DISABLED with a plain sentence naming the surface that DOES record this
   value today (R58: never name a control that is not there). It is not deleted —
   the vehicle stays, visibly and honestly unavailable. */
export function UseOfProceedsNarrative({ text }: { text: string }) {
 return (
 <div className="space-y-2" data-testid="uop-narrative">
 <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
 <p className="text-xs text-muted-foreground">Recorded as written on the round wizard. Capavate does not split this into per-bucket percentages, because that would mean inventing figures you did not enter.</p>
 </div>
 );
}
export function UseOfProceeds({ round }: { round: Round }) {
 const sym = currencySymbol(round.region ?? "US");
 const raw = round.useOfProceeds ?? null;
 const narrative = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
 const data: UseOfProceedsRow[] = Array.isArray(raw) ? raw : [];
 const total = data.reduce((s, r) => s + r.amount, 0);
 return (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-[hsl(0_100%_40%)]" />Use of proceeds <HelpTip>How the round capital will be deployed. Standard pitch-deck slide; investors review this before committing. Aim for explicit per-bucket % + dollar amounts.</HelpTip></CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">{round.name} target: {fmtCurrency(round.targetAmount, round.region ?? "US", { compact: true })}. Actual deployment to be reported quarterly per IRA.</p>
 </CardHeader>
 <CardContent>
 {narrative ? (
 <UseOfProceedsNarrative text={narrative} />
 ) : data.length === 0 ? (
 <div className="text-sm text-muted-foreground italic py-6 text-center border border-dashed border-border rounded-md">
 No use-of-proceeds plan documented yet.
 <div className="mt-3"><Button size="sm" variant="outline" disabled data-testid="button-add-uop"><Plus className="h-3.5 w-3.5 mr-1" />Add use of proceeds</Button></div>
 <p className="mt-2 text-xs not-italic" data-testid="uop-editor-unavailable">Editing use of proceeds on this screen is not yet available. You can record it when you create a round, under &ldquo;Use of proceeds&rdquo; on the round wizard.</p>
 </div>
 ) : (
 <div className="space-y-3">
 {data.map((row, i) => (
 <div key={i} data-testid={`uop-row-${i}`}>
 <div className="flex justify-between text-sm mb-1">
 <span className="font-medium">{row.category}</span>
 <span className="font-mono tabular-nums">{sym}{row.amount.toLocaleString()} <span className="text-muted-foreground ml-1.5">{row.percent}%<span className="sr-only"> of the total committed capital</span></span></span>
 </div>
 <div className="h-2 rounded-full bg-secondary overflow-hidden">
 <div className="h-full bg-gradient-to-r from-[hsl(0_100%_40%)] to-[hsl(0_100%_40%)]" style={{ width: `${row.percent}%` }} />
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

/**
 * WAVE 80 · ITEM 2 — "Round narrative for investors", the wizard field whose value
 * used to exist only inside the wizard's own review step and then vanish on submit.
 * It is the founder's own prose, rendered verbatim; nothing is summarised or
 * reformatted. Renders nothing at all when the round has no narrative, so a round
 * created before this wave shows exactly what it showed before.
 */
export function RoundNarrative({ round }: { round: Round }) {
 const text = (round.notes ?? "").trim();
 if (text.length === 0) return null;
 return (
 <Card data-testid="card-round-narrative">
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Round narrative for investors</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Recorded when this round was created. Investors you invite read this alongside the terms.</p>
 </CardHeader>
 <CardContent>
 <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-round-narrative">{text}</p>
 </CardContent>
 </Card>
 );
}

/**
 * WAVE 80 · ITEM 2 — "Round closes in tranches" and the tranche plan.
 *
 * SEPARATE FROM `TranchesPanel` ON PURPOSE. That panel renders the structured
 * LEDGER of funded tranche events (`round.tranches`, an array it reduces over).
 * This one renders the founder's stated INTENT: the yes/no answer and the plan
 * they typed. Two different facts about a round; conflating them into one key is
 * the shape collision Wave 80 refused to create.
 */
export function TranchePlan({ round }: { round: Round }) {
 const enabled = round.tranchesEnabled === true;
 const plan = (round.tranchesPlan ?? "").trim();
 if (!enabled && plan.length === 0) return null;
 return (
 <Card data-testid="card-tranche-plan">
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Tranche plan</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-tranches-enabled">{enabled ? "This round closes in tranches." : "This round does not close in tranches."}</p>
 </CardHeader>
 <CardContent>
 {plan.length === 0 ? (
 <p className="text-sm text-muted-foreground italic" data-testid="text-tranche-plan-empty">No tranche plan was recorded when this round was created.</p>
 ) : (
 <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-tranche-plan">{plan}</p>
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
 <Button size="sm" className="mt-3 bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" onClick={() => navigate(`/founder/rounds/${roundId}/termsheet`)} data-testid="button-empty-termsheet">
 Open term sheet workspace <ArrowRight className="h-3.5 w-3.5 ml-1" />
 </Button>
 </div>
 ) : (
 <ul className="divide-y divide-border -mx-3">
 {ts && (
 <li className="px-3 py-3 flex items-center gap-3" data-testid="doc-termsheet">
 <FileText className="h-4 w-4 text-[hsl(0_100%_40%)]" />
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
 const [submitting, setSubmitting] = useState(false);

 async function handleConfirm() {
 if (!softId) return;
 if (!name.trim()) { toast({ title: "Type your name", variant: "destructive" }); return; }
 if (!ack) { toast({ title: "Confirm acceptance", variant: "destructive" }); return; }
 if (submitting) return;
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

 // v24.4 Bug E — after the local SES signature succeeds, ALSO persist the
 // status transition on the server so the soft-circle flips from "intent"
 // to "confirmed" (which gates downstream "Mark wire funded"). On a non-OK
 // response we surface an error toast and keep the dialog open so the founder
 // can retry; we do NOT silently close.
 setSubmitting(true);
 try {
 await apiRequest("POST", `/api/rounds/${roundId}/soft-circle/${softId}/validate`, {});
 } catch (err) {
 setSubmitting(false);
 toast({
 title: "Could not confirm on server",
 description: err instanceof ApiError ? err.message : "Please try again.",
 variant: "destructive",
 });
 return;
 }
 // Refresh the soft-circles list so s.status reflects the server transition.
 queryClient.invalidateQueries({ queryKey: [`/api/rounds/${roundId}/soft-circles`] });
 setSubmitting(false);
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
 <Button onClick={handleConfirm} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-founder-confirm-submit"><ShieldCheck className="h-4 w-4 mr-1" />Confirm + sign</Button>
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
 <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4 text-[hsl(0_100%_40%)]" />What-if scenarios <HelpTip>Compare alternate term scenarios side-by-side. Founders use this to negotiate pre-money with the lead investor.</HelpTip></CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Side-by-side sensitivity on pre-money and dilution. Math is reconstructed by the engine on the live ledger.</p>
 </div>
 {/* WAVE 80 · ITEM 4 — the same treatment as "Add use of proceeds" above, and for
     the same reason: this button's only effect was a toast titled "Add scenario"
     whose body admitted the editor was stubbed and told the reader to wire it to
     the engine in production. Kept in place, disabled, with the honest sentence
     rendered beside it instead of inside a toast that disappears. */}
 {/* NOT WRAPPED IN A NEW CONTAINER. An extra <div> around the button changes the
     CardHeader's own child ORDER, which the silent-drop guard correctly reads as a
     panel-body change — the ordinal trap this project has already paid for once.
     The sentence is appended as a SIBLING after the button instead. */}
 <Button size="sm" variant="outline" disabled data-testid="button-add-scenario"><Plus className="h-3.5 w-3.5 mr-1" /> Add scenario</Button>
 <p className="text-xs text-muted-foreground mt-1.5 max-w-xs text-right" data-testid="text-scenario-editor-unavailable">Adding your own what-if scenario is not yet available. The scenarios already recorded on this round are shown below and are computed by the engine.</p>
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
 <div key={i} className={`p-4 rounded-lg border-2 ${isBase ? "border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5" : "border-border bg-card"}`} data-testid={`scenario-${i}`}>
 <div className="flex items-center justify-between mb-2">
 <span className="font-semibold text-sm">{s.name}</span>
 {isBase && <Badge className="text-[10px] bg-[hsl(0_100%_40%)] text-white">Selected</Badge>}
 {!isBase && (isUp ? <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300/60">+ up</Badge> : <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300/60">− down</Badge>)}
 </div>
 <div className="space-y-1.5 text-xs">
 <div className="flex justify-between"><span className="text-muted-foreground">Pre-money</span><span className="font-mono tabular-nums">{sym}{(s.preMoney / 1e6).toFixed(1)}M</span></div>
 <div className="flex justify-between"><span className="text-muted-foreground">Post-money</span><span className="font-mono tabular-nums">{sym}{((s.preMoney + s.raise) / 1e6).toFixed(1)}M</span></div>
 <div className="flex justify-between"><span className="text-muted-foreground">New investor %<span className="ml-1"> of fully-diluted</span></span><span className="font-mono tabular-nums">{s.dilutionPct.toFixed(1)}%</span></div>
 <div className="flex justify-between border-t border-border/60 pt-1.5"><span className="text-muted-foreground">Founder % after<span className="ml-1"> of fully-diluted</span></span><span className="font-mono tabular-nums font-semibold">{s.founderPctAfter.toFixed(1)}%</span></div>
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

  // v24.4.2 Bug H — funded-queue is the source of truth for the Commit button
  // gate. The button must enable as soon as wire-funded enqueues an entry (the
  // ledger has no "funded" entries until after commit, so counts.funded from
  // ledger was always 0).
  const fundedQueue = useQuery<{ entries: any[]; count: number }>({
    queryKey: ["/api/founder/captable/funded-queue", companyId, roundId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/founder/captable/funded-queue?companyId=${encodeURIComponent(companyId)}&roundId=${encodeURIComponent(roundId)}`,
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

  // Synthesize stage counts from ledger entries.
  // v24.4.2 Bug H — was using e.stage (undefined) — ledger entries expose
  // the field as e.state. Fixed to use e.state so visual pipeline counts
  // reflect actual ledger state transitions.
  const counts: Record<string, number> = { invited: 0, viewed: 0, soft_circle: 0, signed: 0, funded: 0, committed: 0 };
  for (const e of ledger.data?.entries ?? []) {
    const stage = e.state ?? e.stage;
    if (stage && counts[stage] !== undefined) counts[stage] += 1;
  }
  // Funded-queue count drives the Commit button gate (funded-queue entries
  // exist before the ledger records a "funded" state).
  const fundedQueueCount = fundedQueue.data?.count ?? (fundedQueue.data?.entries?.length ?? 0);
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
        fundedQueue.refetch();
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
          <GitBranch className="h-4 w-4 text-[hsl(0_100%_40%)]" /> Commit pipeline
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
                <s.icon className="h-4 w-4 text-[hsl(0_100%_40%)]" />
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className="text-lg font-bold tabular-nums">{counts[s.id]}</div>
              </div>
              {i < STAGES.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {isEmpty && (
          <div className="text-xs text-muted-foreground rounded-md bg-secondary/30 p-3" data-testid="ledger-empty-state">
            <Info className="h-3 w-3 inline mr-1" />
            {/* v24.1 Bug F (BUG 039) — the old copy told founders to "click Commit
                funded" even when the only button is disabled, and Avi went looking
                for a non-existent admin "permission option". There is no admin
                permission grant: the founder-side "Commit funded → cap-table"
                button below is the only action, and it stays disabled until at
                least one investor reaches the wire-funded step (and any
                compliance hold is cleared). Explain that directly instead of
                implying a hidden permission. */}
            No funded entries yet for this round. Investors appear here as they move through invitation → soft-circle → signing → wire-funded. The “Commit funded → cap-table” button below stays disabled until at least one investor reaches the wire-funded step and any compliance hold is cleared — there is no separate permission to enable; once a funded entry exists, the button activates for you to write it to the cap table.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Badge variant="outline" className="text-[10px]" data-testid="badge-reconciliation">
            <Hash className="h-3 w-3 mr-1" />
            Reconciliation: <span className={`ml-1 font-mono ${ledger.data?.verified?.ok ? "text-[hsl(0_100%_40%)]" : "text-[hsl(7_61%_43%)]"}`}>{ledger.data?.verified?.ok ? "verified" : "drift"}</span>
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            <Layers className="h-3 w-3 mr-1" /> Ledger entries: {ledger.data?.entries?.length ?? 0}
          </Badge>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={ledger.data?.complianceHold || fundedQueueCount === 0}
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
