import { asArray } from "@/lib/safeArray";
/**
 * Sprint 10 — Investor view of a portfolio company (rebuild).
 *
 * Tabs: Overview · Team · Traction · Financials · Round Terms · Documents · Your Decision
 *
 * The Your Decision tab implements the 10-state machine via PATCH
 * /api/rounds/:roundId/invitations/:invId/decision and the 7-currency
 * soft-circle form per `collective_investor_audit §2 Tab 7`.
 */

import { useEffect, useMemo, useState } from "react";
import { useRoute, Link, useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RequireEntitlement, useEntitlement } from "@/lib/entitlement";
import { PageBody, PageHeader } from "@/components/AppShell";
import { CollectiveDeepLink } from "@/components/CollectiveDeepLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StateBadge } from "@/components/common";
import {
 ArrowLeft, Users, Activity, BarChart3, FileText, Check, X, ShieldCheck,
 Inbox, AlertTriangle, MessageSquare, Building2, Target, Layers,
 Eye, Download, Hash, Megaphone, ChevronRight,
} from "lucide-react";
import { fmtUSD, fmtPct, fmtDate, fmtNum, fmtBytes, safeToFixed } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { signSES, captureSessionMetadata } from "@/lib/esign/ses";
import {
 SUPPORTED_CURRENCIES, SOFT_CIRCLE_TYPES, YOUR_DECISION_TRANSITIONS,
 type YourDecisionState, type SupportedCurrency, type SoftCircleType,
 type MaIntelligence,
} from "@shared/schema";
import NotFound from "@/pages/not-found";

type Inv = {
 id: string;
 company: { id: string; name: string; sector: string };
 round: { id: string; name: string; type: string; state: string };
 state: string; receivedAt: string; expiresAt: string;
 minTicket: number; targetAmount: number; raisedAmount: number;
 preMoney: number; postMoney: number; pricePerShare: number;
};
type DecisionRecord = {
 invitationId: string; roundId: string; companyId: string;
 state: YourDecisionState;
 amount?: number; currency?: string; softCircleType?: string; note?: string;
 history: Array<{ ts: string; from: string; to: string; action: string; reason?: string }>;
 mim: Array<{ screenName: string; amountUsd: number; softCircleType: string }>;
};
type DR = { id: string; category: string; name: string; sizeBytes: number; uploadedAt: string };

/* Banner messages by state — non-binding UX language */
const STATE_BANNER: Record<YourDecisionState, { title: string; tone: "neutral" | "positive" | "warn" | "rejected" }> = {
 pending: { title: "You haven't opened this deal yet.", tone: "neutral" },
 viewed: { title: "You're reviewing this round. Decide when you're ready.", tone: "neutral" },
 accepted: { title: "Acceptance recorded. Soft-circle to commit a non-binding amount.", tone: "positive" },
 soft_circled: { title: "Soft-circle recorded. Founder notified.", tone: "positive" },
 confirmed: { title: "Founder has confirmed your soft-circle. Awaiting term sheet signature.", tone: "positive" },
 signed: { title: "Term sheet signed. Awaiting wire instructions.", tone: "positive" },
 funded: { title: "Funded. Welcome to the cap table.", tone: "positive" },
 declined: { title: "You declined. The round remains visible read-only.", tone: "rejected" },
 expired: { title: "Window closed. Contact the founder to discuss next steps.", tone: "warn" },
 revoked: { title: "Invitation revoked by the founder.", tone: "warn" },
};

// readTabFromHash is replaced by useSearch() in the component body

export default function InvestorCompanyDetail() {
 const [, params] = useRoute("/investor/companies/:id");
 const id = params?.id;
 const { toast } = useToast();
 const [, navigate] = useLocation();
 // Sprint 20 Wave 2 — use wouter useSearch() for tab routing (replaces readTabFromHash)
 const searchString = useSearch();
 const searchParams = new URLSearchParams(searchString);
 const initialTab = searchParams.get("tab") ?? "overview";
 const [tab, setTab] = useState(initialTab);

 const company = useQuery<{ id: string; name: string; sector: string; stage: string; legalName?: string; team?: Array<{ name: string; role: string; bio?: string }>; financials?: Record<string, string>; kpi?: Record<string, string> }>({
 queryKey: ["/api/companies", id],
 enabled: !!id,
 });

 // Find the matching open invitation for this investor (preview maps companyId → invitation).
 const invitations = useQuery<Inv[]>({ queryKey: ["/api/investor/invitations"] });
 const myInv = asArray(invitations.data).find((i) => i.company.id === id) ?? null;

 // DEF-024 fix: pass ?companyId= so the server doesn't return 400
 const dr = useQuery<DR[]>({
  queryKey: ["/api/dataroom", id],
  queryFn: () =>
   apiRequest("GET", `/api/dataroom?companyId=${encodeURIComponent(id ?? "")}`).then((r) => r.json()),
  enabled: !!id,
 });
 const intel = useQuery<MaIntelligence>({
 queryKey: ["/api/investor/ma/intelligence", id],
 enabled: !!id,
 });

 // Sprint 20 Wave 2 — fetch real co-investors from API; graceful 404 fallback
 // Sprint 22 Wave 1 — DEF-003 fix: added userId (platform userId) and allowDM fields.
 type CoMemberResp = { id: string; memberId?: string; userId?: string; legalName: string; screenName: string | null; displayLabel?: string; allowDM?: boolean };
 const coMembers = useQuery<CoMemberResp[]>({
 queryKey: ["/api/investor/companies", id, "co-members"],
 enabled: !!id,
 retry: false,
 });

 // DEF-018: Fetch real founder userId for "Request access" DM link.
 type FounderResp = { userId?: string; name?: string };
 const founderQ = useQuery<FounderResp>({
  queryKey: ["/api/companies", id, "founder"],
  enabled: !!id,
  retry: false,
 });

 // Sprint 20 Wave 2 — send DM to co-member
 // Sprint 22 Wave 1 — DEF-003 fix: use targetUserId (platform userId), not m.id (memberId).
 const dmStart = useMutation({
 mutationFn: async (targetUserId: string) => {
 const r = await apiRequest("POST", "/api/comms/dm/start", { targetUserId });
 if (!r.ok) throw new Error(`HTTP ${r.status}`);
 return r.json() as Promise<{ channelId: string }>;
 },
 onSuccess: (d) => navigate(`/investor/messages?thread=${encodeURIComponent(d.channelId)}`),
 onError: (e: Error) => toast({ title: "Could not start DM", description: e.message, variant: "destructive" }),
 });

 if (!id) return <NotFound />;
 const c = company.data;

 return (
 <RequireEntitlement
 check={{ kind: "investor.onCapTableOf", companyId: id }}
 fallback={
  // DEF-E15: improved unauthorized state with helpful CTAs
  <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
   <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto" />
   <h2 className="text-base font-semibold">Cap-table membership required</h2>
   <p className="text-sm text-muted-foreground">
    You need to be a cap-table member of this company to view the full company detail.
   </p>
   <div className="flex flex-col sm:flex-row gap-3 justify-center">
    <Link href="/investor/invitations">
     <Button variant="outline" data-testid="button-back-invitations">
      <ArrowLeft className="h-4 w-4 mr-2" /> Back to invitations
     </Button>
    </Link>
    {founderQ.data?.userId ? (
     <Link href={`/investor/messages?targetUserId=${encodeURIComponent(founderQ.data.userId)}`}>
      <Button
       className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
       data-testid="button-request-access"
      >
       <MessageSquare className="h-4 w-4 mr-2" /> Request access
      </Button>
     </Link>
    ) : (
     <a href="mailto:support@capavate.com">
      <Button
       variant="outline"
       data-testid="button-contact-support"
      >
       <MessageSquare className="h-4 w-4 mr-2" /> Contact support
      </Button>
     </a>
    )}
   </div>
  </div>
 }
 >
 <>
 <PageHeader
 title={c?.name ?? "Loading…"}
 description={c ? `${c.sector} · ${c.stage}` : ""}
 breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { href: "/investor/portfolio", label: "Portfolio" }, { label: c?.name ?? id }]}
 actions={
 <div className="flex gap-2">
 <Link href="/investor/portfolio"><Button variant="ghost" data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-2" /> Portfolio</Button></Link>
 {myInv && <Link href={`/investor/invitations/${myInv.id}`}><Button variant="outline" data-testid="button-open-invitation"><Inbox className="h-4 w-4 mr-2" />Open invitation</Button></Link>}
 {/* Patch v4: only render deep link when we have a real company id. */}
 {id ? <CollectiveDeepLink entity="company" id={id} label="View Collective Profile" /> : null}
 </div>
 }
 />
 <PageBody>
 {/* Header strip */}
 <Card className="mb-6">
 <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
 <div className="h-14 w-14 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center text-lg font-semibold shrink-0">
 {(c?.name ?? "—").split(" ").map((s) => s[0]).slice(0, 2).join("")}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <h2 className="text-xl font-semibold">{c?.name ?? "—"}</h2>
 {c?.stage && <Badge variant="outline" className="text-[10px]">{c.stage}</Badge>}
 {intel.data && <Badge variant="outline" className="text-[10px]">Acquirer fit {intel.data.acquirerFitScore}/100</Badge>}
 {myInv && <StateBadge state={myInv.state} />}
 </div>
 <div className="text-sm text-muted-foreground mt-1">{c?.sector ?? ""}</div>
 </div>
 </CardContent>
 </Card>

 <Tabs value={tab} onValueChange={setTab} className="space-y-4">
 <TabsList className="grid grid-cols-8 h-auto">
 <TabsTrigger value="overview" data-testid="tab-overview" className="py-2">Overview</TabsTrigger>
 <TabsTrigger value="team" data-testid="tab-team" className="py-2">Team</TabsTrigger>
 <TabsTrigger value="traction" data-testid="tab-traction" className="py-2">Traction</TabsTrigger>
 <TabsTrigger value="financials" data-testid="tab-financials" className="py-2">Financials</TabsTrigger>
 <TabsTrigger value="terms" data-testid="tab-terms" className="py-2">Round Terms</TabsTrigger>
 <TabsTrigger value="documents" data-testid="tab-documents" className="py-2">Documents</TabsTrigger>
 {/* Sprint 23 — cap-table-gated public Messages tab */}
 <TabsTrigger value="messages" data-testid="tab-messages" className="py-2">Messages</TabsTrigger>
 {/* Sprint 23 — Your Decision gets a red border to emphasize the action surface */}
 <TabsTrigger
 value="your-decision"
 data-testid="tab-your-decision"
 className="py-2 border-2 border-destructive data-[state=active]:bg-destructive/10 rounded-sm"
 >
 Your Decision
 </TabsTrigger>
 </TabsList>

 {/* OVERVIEW */}
 <TabsContent value="overview" className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">About {c?.name}</CardTitle></CardHeader>
 <CardContent className="text-sm space-y-3">
 <p>{c?.name} is a {c?.stage?.toLowerCase()} company in {c?.sector}. Detailed investor-grade brief available below; founder-side data is gated behind your invitation grant.</p>
 {intel.data && (
 <div className="grid md:grid-cols-3 gap-3 pt-3 border-t border-border">
 <Stat label="Product-Market Fit" v={`${intel.data.productMarketFit}/100`} />
 <Stat label="Tech Differentiation" v={`${intel.data.technologyDifferentiation}/100`} />
 <Stat label="Mgmt Strength" v={`${intel.data.managementTeamStrength}/100`} />
 </div>
 )}
 </CardContent>
 </Card>

 {/* M&A Intelligence inline */}
 {intel.data && <MaIntelligenceSection intel={intel.data} companyId={id} />}
 </TabsContent>

 {/* TEAM */}
 <TabsContent value="team" className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Founders &amp; key team</CardTitle></CardHeader>
 <CardContent className="text-sm">
 {company.data?.team && company.data.team.length > 0 ? (
 <ul className="space-y-3">
 {company.data.team.map((m, i) => (
 <li key={i} className="flex items-start gap-3">
 <div className="h-9 w-9 rounded-full bg-[hsl(184_98%_22%)]/15 text-[hsl(184_98%_22%)] flex items-center justify-center text-xs font-semibold">
 {m.role.slice(0, 3).toUpperCase()}
 </div>
 <div><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.role}{m.bio ? ` — ${m.bio}` : ""}</div></div>
 </li>
 ))}
 </ul>
 ) : (
 <div className="text-sm text-muted-foreground py-6 text-center">Team info not available</div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 {/* TRACTION — DEF-024 fix: render company.kpi or company.tractionBullets; no hardcoded bullets */}
 <TabsContent value="traction" className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Last 90 days</CardTitle></CardHeader>
 <CardContent className="text-sm">
 {(() => {
 const kpiEntries = Object.entries(company.data?.kpi ?? {});
 const bullets: string[] = (company.data as any)?.tractionBullets ?? [];
 if (bullets.length > 0) {
  return (
  <ul className="space-y-2">
   {bullets.map((b, i) => (
   <li key={i} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-600" /> {b}</li>
   ))}
  </ul>
  );
 }
 if (kpiEntries.length > 0) {
  return (
  <div className="grid md:grid-cols-2 gap-3">
   {kpiEntries.map(([k, v]) => (
   <Stat key={k} label={k} v={String(v)} />
   ))}
  </div>
  );
 }
 return <div className="text-sm text-muted-foreground py-6 text-center">Founder has not published traction data yet.</div>;
 })()}
 </CardContent>
 </Card>
 </TabsContent>

 {/* FINANCIALS */}
 <TabsContent value="financials" className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Financial snapshot</CardTitle></CardHeader>
 <CardContent>
 {(company.data?.financials || company.data?.kpi) ? (
 <div className="grid md:grid-cols-3 gap-3 text-sm">
 {Object.entries(company.data.financials ?? {}).map(([k, v]) => (
 <Stat key={k} label={k} v={String(v)} />
 ))}
 {Object.entries(company.data.kpi ?? {}).map(([k, v]) => (
 <Stat key={k} label={k} v={String(v)} />
 ))}
 </div>
 ) : (
 <div className="text-sm text-muted-foreground py-6 text-center">Founder has not published financial KPIs yet</div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 {/* ROUND TERMS */}
 <TabsContent value="terms" className="space-y-4">
 {myInv ? (
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Headline round terms</CardTitle></CardHeader>
 <CardContent className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
 <Stat label="Round" v={myInv.round.name} />
 <Stat label="Pre-money" v={fmtUSD(myInv.preMoney, { compact: true })} />
 <Stat label="Post-money" v={fmtUSD(myInv.postMoney, { compact: true })} />
 <Stat label="Round size" v={fmtUSD(myInv.targetAmount, { compact: true })} />
 <Stat label="Min ticket" v={fmtUSD(myInv.minTicket, { compact: true })} />
 <Stat label="Price / share" v={`$${safeToFixed(myInv.pricePerShare, 4)}`} />
 </CardContent>
 </Card>
 ) : <EmptyTab text="No active round invitation for this company." />}
 </TabsContent>

 {/* DOCUMENTS */}
 <TabsContent value="documents" className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Documents shared with you</CardTitle></CardHeader>
 <CardContent className="px-0">
 <table className="w-full text-sm" data-testid="table-docs">
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
 {asArray(dr.data).slice(0, 8).map(f => (
 <tr key={f.id} className="border-b border-border/60" data-testid={`row-doc-${f.id}`}>
 <td className="px-5 py-2.5 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> {f.name}</td>
 <td className="px-3 py-2.5 text-muted-foreground capitalize">{f.category.replace("_", " ")}</td>
 <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(f.uploadedAt)}</td>
 <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{fmtBytes(f.sizeBytes)}</td>
 <td className="px-5 py-2.5 text-right">
 <div className="inline-flex gap-1">
 {/* v25.18 Lane D NC1 + NC3 — server-streaming download instead of a
     potentially-tainted `(f as any).url`. The streaming endpoint
     enforces v25.17 Lane A NC1 dataroom auth + per-investor permission. */}
 <Button size="sm" variant="ghost" data-testid={`button-view-${f.id}`}
 onClick={() => { try { window.open(`/api/dataroom/files/${encodeURIComponent(f.id)}/download?disposition=inline`, "_blank", "noopener,noreferrer"); } catch { toast({ title: "Could not open", description: "Please try the download button instead." }); } }}>
 <Eye className="h-3.5 w-3.5" />
 </Button>
 <a
 href={`/api/dataroom/files/${encodeURIComponent(f.id)}/download`}
 rel="noopener noreferrer"
 tabIndex={-1}
 >
 <Button size="sm" variant="ghost" data-testid={`button-dl-${f.id}`}><Download className="h-3.5 w-3.5" /></Button>
 </a>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </CardContent>
 </Card>
 </TabsContent>

 {/* Sprint 23 — MESSAGES (cap-table-gated public threads only) */}
 <TabsContent value="messages" className="space-y-4">
 <CapTableMessagesPanel companyId={id} companyName={c?.name ?? ""} />
 </TabsContent>

 {/* YOUR DECISION */}
 <TabsContent value="your-decision" className="space-y-4">
 {myInv ? (
 <YourDecisionPanel inv={myInv} toast={toast} />
 ) : (
 <EmptyTab text="No invitation found. Your Decision is only available for invited rounds." />
 )}
 </TabsContent>
 </Tabs>

 {/* Sprint 20 Wave 2 — Co-investors on cap table */}
 <Card className="mt-6">
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Co-investors on this cap table</CardTitle></CardHeader>
 <CardContent>
 {coMembers.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
 {coMembers.isError && <div className="text-sm text-muted-foreground">Co-member list unavailable in preview</div>}
 {!coMembers.isLoading && !coMembers.isError && asArray(coMembers.data).length === 0 && (
 <div className="text-sm text-muted-foreground">No co-investors found for this company.</div>
 )}
 {asArray(coMembers.data).map(m => (
 <div key={m.memberId ?? m.id} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0 text-sm" data-testid={`row-comember-${m.memberId ?? m.id}`}>
 <div>
 <div className="font-medium">{m.displayLabel ?? m.screenName ?? m.legalName}</div>
 {(m.screenName || m.displayLabel) && <div className="text-xs text-muted-foreground">{m.legalName}</div>}
 </div>
 {/* Sprint 22 Wave 1 — DEF-003: use m.userId (platform userId), disable when not available */}
 <Button
 size="sm"
 variant="outline"
 onClick={() => m.userId && dmStart.mutate(m.userId)}
 disabled={dmStart.isPending || !m.userId || m.allowDM === false}
 data-testid={`button-dm-${m.memberId ?? m.id}`}
 >
 <MessageSquare className="h-3.5 w-3.5 mr-1" /> Message
 </Button>
 </div>
 ))}
 </CardContent>
 </Card>
 </PageBody>
 </>
 </RequireEntitlement>
 );
}

/* ---------- Your Decision panel ---------- */
function YourDecisionPanel({ inv, toast }: { inv: Inv; toast: ReturnType<typeof useToast>["toast"] }) {
 const decision = useQuery<DecisionRecord>({
 queryKey: [`/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`],
 });

 // Mark as viewed on first mount if pending
 const viewMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, { action: "view" });
 return r.json();
 },
 });
 useEffect(() => {
 if (decision.data?.state === "pending") viewMut.mutate();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [decision.data?.state]);

 // Submit soft-circle
 const [amount, setAmount] = useState("250000");
 const [currency, setCurrency] = useState<SupportedCurrency>("USD");
 const [scType, setScType] = useState<SoftCircleType>("indication");
 const [note, setNote] = useState("");
 const [signerName, setSignerName] = useState("");
 // DEF-037 fix: pre-populate signerEmail from entitlement context, not hardcoded demo address.
 const { data: entCtx } = useEntitlement();
 const [signerEmail, setSignerEmail] = useState("");
 // Prefill email once entitlement context resolves.
 useEffect(() => {
   const email = entCtx?.identity?.email ?? entCtx?.email;
   if (email && !signerEmail) setSignerEmail(email as string);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entCtx]);
 const submitMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, {
 action: "soft_circle",
 amount: Number(amount),
 currency,
 softCircleType: scType,
 note: note.trim() || undefined,
 });
 return r.json();
 },
 onSuccess: () => {
 // Issue local SES signature for tamper-evident hash
 const meta = captureSessionMetadata();
 const sig = signSES({
 documentId: `sc-${inv.id}`,
 documentType: "softcircle",
 signerName: signerName.trim() || "Investor",
 signerEmail: signerEmail.trim(),
 signerRole: "investor",
 intentText: `Soft-circle ${currency} ${Number(amount).toLocaleString()} into ${inv.company.name} ${inv.round.name}. Non-binding indication.`,
 ipAddress: meta.ipAddress,
 userAgent: meta.userAgent,
 timestamp: meta.timestamp,
 sessionId: meta.sessionId,
 prevHash: "0".repeat(64),
 });
 toast({ title: "Soft-circle recorded", description: `Hash ${sig.hash.slice(0, 16)}…` });
 queryClient.invalidateQueries({ queryKey: [`/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`] });
 },
 onError: (e: Error) => toast({ title: "Could not submit soft-circle", description: e.message, variant: "destructive" }),
 });

 const declineMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, {
 action: "decline", reason: "investor declined",
 });
 return r.json();
 },
 onSuccess: () => {
 toast({ title: "Invitation declined" });
 queryClient.invalidateQueries({ queryKey: [`/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`] });
 },
 });

 const acceptMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, { action: "accept" });
 return r.json();
 },
 onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`] }),
 });

 const requestInfoMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, {
 action: "request_info", note: note.trim() || "Question on the round.",
 });
 return r.json();
 },
 onSuccess: () => toast({ title: "Question sent to founder" }),
 });

 const signMut = useMutation({
 mutationFn: async () => {
 const r = await apiRequest("PATCH", `/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`, { action: "sign" });
 return r.json();
 },
 onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/rounds/${inv.round.id}/invitations/${inv.id}/decision`] }),
 });

 const state = (decision.data?.state ?? "pending") as YourDecisionState;
 const allowed = YOUR_DECISION_TRANSITIONS[state] ?? [];
 const banner = STATE_BANNER[state];

 const [decisionRadio, setDecisionRadio] = useState<"accept" | "decline" | "soft_circle">("soft_circle");

 return (
 <div className="space-y-4">
 {/* 10-state banner */}
 <Card data-testid="banner-decision-state" className={
 banner.tone === "positive" ? "border-emerald-300/40 bg-emerald-50/30 " :
 banner.tone === "warn" ? "border-amber-300/40 bg-amber-50/30 " :
 banner.tone === "rejected" ? "border-[hsl(7_61%_43%)]/40 bg-[hsl(7_61%_43%)]/5" :
 "border-border"
 }>
 <CardContent className="p-4 flex items-start gap-3">
 <ShieldCheck className="h-4 w-4 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
 <div className="flex-1">
 <div className="font-medium">{banner.title}</div>
 <div className="text-xs text-muted-foreground mt-0.5 capitalize">Current state — <span className="font-mono">{state.replace("_", " ")}</span></div>
 </div>
 <StateBadge state={state} />
 </CardContent>
 </Card>

 {/* Action selector + form */}
 {!["funded", "declined", "expired", "revoked", "signed"].includes(state) && (
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">Make your decision</CardTitle></CardHeader>
 <CardContent className="space-y-4">
 <RadioGroup value={decisionRadio} onValueChange={(v) => setDecisionRadio(v as typeof decisionRadio)} className="grid md:grid-cols-3 gap-2">
 <label className="flex items-start gap-2 p-3 rounded-md border border-border cursor-pointer hover:bg-secondary/40">
 <RadioGroupItem value="accept" id="r-accept" data-testid="radio-accept" disabled={!allowed.includes("accepted")} />
 <div>
 <div className="font-medium text-sm">Accept</div>
 <div className="text-xs text-muted-foreground">Acknowledge interest before soft-circling.</div>
 </div>
 </label>
 <label className="flex items-start gap-2 p-3 rounded-md border border-border cursor-pointer hover:bg-secondary/40">
 <RadioGroupItem value="soft_circle" id="r-soft" data-testid="radio-softcircle" disabled={!allowed.includes("soft_circled")} />
 <div>
 <div className="font-medium text-sm">Soft-circle</div>
 <div className="text-xs text-muted-foreground">Non-binding indication of interest with amount.</div>
 </div>
 </label>
 <label className="flex items-start gap-2 p-3 rounded-md border border-border cursor-pointer hover:bg-secondary/40">
 <RadioGroupItem value="decline" id="r-decline" data-testid="radio-decline" disabled={!allowed.includes("declined")} />
 <div>
 <div className="font-medium text-sm">Decline</div>
 <div className="text-xs text-muted-foreground">Pass on this round (founder is notified, reason private).</div>
 </div>
 </label>
 </RadioGroup>

 {/* Soft-circle form */}
 {decisionRadio === "soft_circle" && allowed.includes("soft_circled") && (
 <div className="space-y-3">
 <div className="grid md:grid-cols-3 gap-3">
 <div>
 <Label>Amount</Label>
 <Input className="mt-1 font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} data-testid="input-sc-amount" />
 </div>
 <div>
 <Label>Currency</Label>
 <Select value={currency} onValueChange={(v) => setCurrency(v as SupportedCurrency)}>
 <SelectTrigger className="mt-1" data-testid="select-sc-currency"><SelectValue /></SelectTrigger>
 <SelectContent>
 {SUPPORTED_CURRENCIES.map(c => <SelectItem key={c} value={c} data-testid={`option-currency-${c}`}>{c}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label>Type</Label>
 <Select value={scType} onValueChange={(v) => setScType(v as SoftCircleType)}>
 <SelectTrigger className="mt-1" data-testid="select-sc-type"><SelectValue /></SelectTrigger>
 <SelectContent>
 {SOFT_CIRCLE_TYPES.map(s => <SelectItem key={s} value={s} data-testid={`option-sctype-${s}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 </div>
 <div>
 <Label>Note to founder (max 500 chars)</Label>
 <Textarea rows={2} className="mt-1" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this round, why now…" data-testid="input-sc-note" />
 </div>
 <div className="grid md:grid-cols-2 gap-3">
 <div><Label>Your full legal name (typed signature)</Label><Input className="mt-1" value={signerName} onChange={(e) => setSignerName(e.target.value)} data-testid="input-sc-signer" /></div>
 <div><Label>Your email</Label><Input className="mt-1" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} data-testid="input-sc-email" /></div>
 </div>
 <Button
 className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white w-full h-11"
 disabled={submitMut.isPending || !amount || !signerName.trim()}
 onClick={() => submitMut.mutate()}
 data-testid="button-submit-softcircle">
 <ShieldCheck className="h-4 w-4 mr-2" /> Submit soft-circle ({currency} {Number(amount || 0).toLocaleString()})
 </Button>
 </div>
 )}

 {/* Accept */}
 {decisionRadio === "accept" && allowed.includes("accepted") && (
 <Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => acceptMut.mutate()} disabled={acceptMut.isPending} data-testid="button-confirm-accept">
 <Check className="h-4 w-4 mr-2" /> Confirm acceptance
 </Button>
 )}

 {/* Decline */}
 {decisionRadio === "decline" && allowed.includes("declined") && (
 <div className="space-y-2">
 <Textarea rows={2} placeholder="Optional reason (private to you)…" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-decline-note" />
 <Button variant="outline" className="border-[hsl(7_61%_43%)] text-[hsl(7_61%_43%)] hover:bg-[hsl(7_61%_43%)]/10" onClick={() => declineMut.mutate()} disabled={declineMut.isPending} data-testid="button-confirm-decline">
 <X className="h-4 w-4 mr-2" /> Decline politely
 </Button>
 </div>
 )}

 <div className="pt-3 border-t border-border flex flex-wrap items-center gap-2">
 <Button size="sm" variant="ghost" onClick={() => requestInfoMut.mutate()} disabled={requestInfoMut.isPending} data-testid="button-request-info">
 <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Ask the founder a question
 </Button>
 {allowed.includes("signed") && (
 <Button size="sm" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => signMut.mutate()} disabled={signMut.isPending} data-testid="button-sign-termsheet">
 <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Sign term sheet
 </Button>
 )}
 </div>
 </CardContent>
 </Card>
 )}

 {/* MIM — Members Interested in this Deal */}
 <MimSection mim={decision.data?.mim ?? []} totalShown={decision.data?.amount ?? 0} round={inv.round.name} />

 {/* Term sheet preview surface */}
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Term sheet preview</CardTitle></CardHeader>
 <CardContent>
 <div className="text-sm text-muted-foreground mb-3">Read-only summary. Full document available in the Documents tab.</div>
 <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
 <Stat label="Round name" v={inv.round.name} />
 <Stat label="Pre-money" v={fmtUSD(inv.preMoney, { compact: true })} />
 <Stat label="Round size" v={fmtUSD(inv.targetAmount, { compact: true })} />
 <Stat label="Min ticket" v={fmtUSD(inv.minTicket, { compact: true })} />
 {/* DEF-025 fix: source liquidation pref + pro-rata from round data */}
 <Stat label="Liquidation pref" v={(myInv?.round as any)?.terms?.liquidationPref ?? "Per round terms"} />
 <Stat label="Pro-rata" v={(myInv?.round as any)?.terms?.proRataMinimum ?? "Per round terms"} />
 </div>
 </CardContent>
 </Card>

 {/* Decision history */}
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">Decision history</CardTitle></CardHeader>
 <CardContent>
 <ul className="space-y-2 text-sm">
 <li className="flex justify-between border-b border-border/60 py-2"><span>Invitation received</span><span className="text-muted-foreground">{fmtDate(inv.receivedAt)}</span></li>
 {(decision.data?.history ?? []).map((h, idx) => (
 <li key={idx} className="flex justify-between border-b border-border/60 py-2" data-testid={`history-${idx}`}>
 <span className="capitalize"><span className="font-medium">{h.action.replace("_", " ")}</span> — <span className="font-mono text-xs">{h.from} → {h.to}</span></span>
 <span className="text-muted-foreground">{fmtDate(h.ts)}</span>
 </li>
 ))}
 <li className="flex justify-between py-2"><span className="text-muted-foreground">Decision deadline</span><span className="font-medium">{fmtDate(inv.expiresAt)}</span></li>
 {decision.data?.amount && (
 <li className="flex items-center gap-2 text-xs font-mono text-muted-foreground pt-1">
 <Hash className="h-3 w-3" /> Recorded {decision.data.currency} {fmtNum(decision.data.amount)} · {decision.data.softCircleType}
 </li>
 )}
 </ul>
 </CardContent>
 </Card>
 </div>
 );
}

/* ---------- M&A Intelligence inline section on Overview ---------- */
function MaIntelligenceSection({ intel, companyId }: { intel: MaIntelligence; companyId: string }) {
 const { toast } = useToast();
 const startInitiative = useMutation({
 mutationFn: async (initiativeType: "discussion" | "lead_initiative") => {
 const top = intel.topStrategicBuyers.slice(0, 3).map(b => b.name);
 const r = await apiRequest("POST", "/api/investor/ma/initiative", {
 companyId, initiativeType, topic: initiativeType === "lead_initiative"
 ? `Lead M&A initiative: target shortlist + valuation calibration.`
 : `Open thread to discuss potential M&A.`,
 buyerShortlist: top,
 });
 return r.json();
 },
 onSuccess: (_d, vars) => {
 /* v25.11 NM-3 + NL-4 — prior version had no onError and did not invalidate
  * the initiatives list. Add both so failures surface a toast and any
  * dashboard component that reads /api/investor/ma/initiatives refreshes. */
 toast({ title: vars === "lead_initiative" ? "Lead initiative started" : "Discussion thread started" });
 queryClient.invalidateQueries({ queryKey: ["/api/investor/ma/initiatives"] });
 queryClient.invalidateQueries({ queryKey: ["/api/investor/ma/intelligence", companyId] });
 },
 onError: (err: Error) => toast({
 title: "Could not start M&A initiative",
 description: err.message || "Please try again.",
 variant: "destructive",
 }),
 });

 return (
 <Card data-testid="card-ma-intel">
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <div>
 <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> M&amp;A Intelligence</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Acquirer fit {intel.acquirerFitScore}/100 · M&amp;A score {intel.maScore}/100 · Intent <span className="capitalize">{intel.intentSignal.replace("_", " ")}</span></p>
 </div>
 <div className="flex gap-2">
 <Button size="sm" variant="outline" onClick={() => startInitiative.mutate("discussion")} disabled={startInitiative.isPending} data-testid="button-ma-discuss"><MessageSquare className="h-3.5 w-3.5 mr-1" />Discuss</Button>
 <Button size="sm" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => startInitiative.mutate("lead_initiative")} disabled={startInitiative.isPending} data-testid="button-ma-lead"><Megaphone className="h-3.5 w-3.5 mr-1" />Lead initiative</Button>
 </div>
 </CardHeader>
 <CardContent>
 <div className="grid md:grid-cols-2 gap-6">
 <div>
 <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium mb-2">Top strategic buyers</div>
 <ul className="space-y-2">
 {intel.topStrategicBuyers.map(b => (
 <li key={b.name} className="flex items-start gap-2 text-sm" data-testid={`row-buyer-${b.name}`}>
 <Building2 className="h-4 w-4 text-[hsl(184_98%_22%)] mt-0.5 shrink-0" />
 <div>
 <div className="font-medium">{b.name}</div>
 <div className="text-xs text-muted-foreground">{b.rationale}</div>
 <div className="text-[11px] text-muted-foreground italic">{b.recentActivity}</div>
 </div>
 </li>
 ))}
 </ul>
 </div>
 <div>
 <div className="text-xs uppercase text-muted-foreground tracking-wide font-medium mb-2">Comparable exits (24 mo)</div>
 <ul className="space-y-2">
 {intel.comparableExits.map(c => (
 <li key={c.target} className="flex items-start gap-2 text-sm" data-testid={`row-comp-${c.target}`}>
 <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
 <div>
 <div className="font-medium">{c.target} → {c.acquirer}</div>
 <div className="text-xs text-muted-foreground">{fmtDate(c.date)} · {fmtUSD(c.valuationUsd, { compact: true })} · {c.revenueMultiple?.toFixed(1)}x rev</div>
 </div>
 </li>
 ))}
 {intel.comparableExits.length === 0 && <li className="text-xs text-muted-foreground">No qualifying comps in window.</li>}
 </ul>
 <div className="mt-3 text-xs text-muted-foreground">Revenue multiple range: <span className="font-mono">{intel.revenueMultipleRange.low.toFixed(1)}x – {intel.revenueMultipleRange.high.toFixed(1)}x</span></div>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

/* ---------- MIM section ---------- */
function MimSection({ mim, round }: { mim: Array<{ screenName: string; amountUsd: number; softCircleType: string }>; totalShown: number; round: string }) {
 const total = mim.reduce((s, m) => s + m.amountUsd, 0);
 return (
 <Card data-testid="card-mim">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Members Interested in this Deal (MIM)</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Anonymized peer commits in the {round} round.</p>
 </CardHeader>
 <CardContent>
 {mim.length === 0 ? (
 <div className="text-sm text-muted-foreground py-4 text-center">No peer commits yet — be the first.</div>
 ) : (
 <>
 <div className="text-sm mb-3">
 <span className="font-semibold">{fmtUSD(total, { compact: true })}</span> aggregated peer commitment across {mim.length} members.
 </div>
 <ul className="space-y-2">
 {mim.map((m, idx) => (
 <li key={idx} className="flex items-center justify-between text-sm py-2 border-b border-border/60 last:border-0" data-testid={`row-mim-${idx}`}>
 <span className="font-mono text-xs">{m.screenName}</span>
 <span className="flex items-center gap-3">
 <Badge variant="outline" className="text-[10px] capitalize">{m.softCircleType}</Badge>
 <span className="font-mono tabular-nums">{fmtUSD(m.amountUsd, { compact: true })}</span>
 </span>
 </li>
 ))}
 </ul>
 </>
 )}
 </CardContent>
 </Card>
 );
}

/* ---------- presentational helpers ---------- */
function Stat({ label, v }: { label: string; v: string }) {
 return (
 <div className="flex justify-between border-b border-border/60 py-1.5">
 <span className="text-muted-foreground">{label}</span>
 <span className="font-medium">{v}</span>
 </div>
 );
}
function EmptyTab({ text }: { text: string }) {
 return <div className="text-sm text-muted-foreground py-12 text-center">{text}</div>;
}

/* ---------- Sprint 23 — CapTableMessagesPanel ----------
 * Renders the public cap-table thread for this company.
 * - ONLY visible to cap-table members (server-side gated).
 * - Excludes soft-circle / DM / network / transaction-prep channels.
 * - Read-only summary here; investors compose by clicking "Open thread in Messages".
 */
function CapTableMessagesPanel({
 companyId,
 companyName,
}: { companyId: string; companyName: string }) {
 type CapTableMsg = {
 id: string;
 authorLabel: string;
 authorRole: "founder" | "investor";
 body: string;
 createdAt: string;
 isAnonymous?: boolean;
 };
 type CapTableChannelResp = {
 exists: boolean;
 isMember?: boolean;
 channel?: { id: string; name?: string; metadata?: { title?: string }; participantUserIds?: string[] } | undefined;
 lastMessages?: CapTableMsg[];
 visibleMemberCount?: number;
 totalMemberCount?: number;
 };
 const q = useQuery<CapTableChannelResp>({
 queryKey: ["/api/comms/cap-table", companyId],
 });
 const data = q.data;
 if (q.isLoading) {
 return <div className="text-sm text-muted-foreground py-12 text-center">Loading cap-table messages…</div>;
 }
 if (!data || data.exists === false) {
 return (
 <div className="text-sm text-muted-foreground py-12 text-center">
 No cap-table message channel exists for this company yet.
 </div>
 );
 }
 if (data.isMember === false) {
 // Server says channel exists but viewer is not a cap-table member — hard-gated.
 return (
 <Card className="border-2 border-destructive/40">
 <CardContent className="py-8 text-center space-y-3">
 <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground" />
 <div className="text-sm font-medium">Cap-table members only</div>
 <p className="text-sm text-muted-foreground max-w-md mx-auto">
 This thread is reserved for verified cap-table members of {companyName || "this company"}.
 Soft-circle and other channels are not shown here.
 </p>
 </CardContent>
 </Card>
 );
 }
 const ch = data.channel;
 const msgs = data.lastMessages ?? [];
 const open = ch ? `/investor/messages?channel=${encodeURIComponent(ch.id)}&thread=${encodeURIComponent(ch.id)}` : "/investor/messages";
 return (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
 <div>
 <CardTitle className="text-base flex items-center gap-2">
 <MessageSquare className="h-4 w-4" />
 {companyName ? `${companyName} — Cap-Table` : "Cap-Table channel"}
 </CardTitle>
 <p className="text-xs text-muted-foreground mt-1">
 Public thread for cap-table members only — no soft-circle / DM / other channels.
 {typeof data.visibleMemberCount === "number" && (
 <span className="ml-2 inline-flex items-center gap-1">
 <Users className="h-3 w-3" /> {data.visibleMemberCount} visible member{data.visibleMemberCount === 1 ? "" : "s"}
 </span>
 )}
 </p>
 </div>
 <Link href={open}>
 <Button size="sm" data-testid="button-open-cap-table-thread">
 <MessageSquare className="h-3.5 w-3.5 mr-2" /> Open in Messages
 </Button>
 </Link>
 </CardHeader>
 <CardContent>
 {msgs.length === 0 ? (
 <div className="text-sm text-muted-foreground py-6 text-center">
 No messages yet. Be the first to start a thread with your fellow cap-table members.
 </div>
 ) : (
 <ul className="divide-y divide-border">
 {msgs.map((m) => (
 <li key={m.id} className="py-3 first:pt-0 last:pb-0">
 <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
 <span className="font-medium text-foreground">{m.isAnonymous ? "[Anonymous Holder]" : m.authorLabel}</span>
 <Badge variant="outline" className="text-[10px] py-0 px-1.5">{m.authorRole}</Badge>
 <span>·</span>
 <span>{new Date(m.createdAt).toLocaleString()}</span>
 </div>
 <p className="text-sm whitespace-pre-wrap">{m.body}</p>
 </li>
 ))}
 </ul>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

void Target;
void useMemo;
