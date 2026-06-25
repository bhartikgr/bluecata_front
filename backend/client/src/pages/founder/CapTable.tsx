import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/common";
import { CAPAVATE_LOGO_URL } from "@/components/CapavateLogo";
import {
 Download, Plus, PieChart as PieIcon, Layers, TrendingUp, Cpu, Info,
 FileText as FileIcon, Printer, Shield, Calendar, ChevronDown, ChevronRight,
 FileSpreadsheet, Calculator, Send as SendIcon, X as XIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtNum, fmtUSD, fmtPct, fmtDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { runEngine, type ApiSecurity } from "@/lib/engineDemo";
import type { View, Region } from "@capavate/cap-table-engine";
import {
  applyBroadBasedWeightedAverage,
  applyFullRatchet,
  decimalToShares,
  D as DecimalFromString,
} from "@capavate/cap-table-engine";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip } from "@/components/HelpTip";
import { currencySymbol } from "@/lib/currency";
import type { ApiRound } from "@/lib/types";
import type { CompanyProfile } from "@/lib/profile/types";
import { useEffect } from "react";
import { useActiveCompanyId, useActiveCompany } from "@/lib/useActiveCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useQuery as _useQuery } from "@tanstack/react-query";
import { resolveCoMemberLabel } from "@/lib/privacy/visibility";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MemberValueIntelligenceBox } from "@/components/MemberValueIntelligenceBox";
import { useEntitlement, evaluate } from "@/lib/entitlement";

const INSTRUMENT_COLORS: Record<string, string> = {
 common: "hsl(219 45% 30%)",
 preferred: "hsl(0 100% 40%)",
 safe: "hsl(333 75% 40%)",
 note: "hsl(38 92% 50%)",
 warrant: "hsl(158 64% 38%)",
 option: "hsl(219 70% 55%)",
};

const INSTRUMENT_LABELS: Record<string, string> = {
 common: "Common", preferred: "Preferred", safe: "SAFE",
 note: "Convertible Note", warrant: "Warrant", option: "Option",
};

const INSTRUMENT_BLURBS: Record<string, string> = {
 common: "The default share class — held by founders and (when exercised) by employees. No special rights.",
 preferred: "Investor shares with extra rights (liq pref, anti-dilution, board seats). Standard for priced rounds.",
 safe: "A short contract for the next priced round. No interest, no maturity. The early-stage standard.",
 note: "A loan that converts to shares at the next priced round. Interest + maturity date.",
 warrant: "The right to buy shares at a fixed strike within an expiry window.",
 option: "The right to buy shares at a fixed strike after vesting — the standard employee equity tool.",
};

const VIEW_BLURBS: Record<View, { title: string; body: string }> = {
 basic: { title: "Basic", body: "Only issued shares: Common + Preferred. Ignores the option pool, warrants, SAFEs and notes — the most conservative ownership picture." },
 fully_diluted: { title: "Fully Diluted", body: "Counts all issued shares PLUS the full option pool (granted + reserved) PLUS warrants outstanding. Excludes SAFEs/notes which haven't yet converted." },
 as_converted: { title: "As Converted", body: "Fully Diluted PLUS SAFEs and Notes converted to Common at their effective conversion price. Most permissive view." },
};

const HOLDER_GROUPS: { label: string; types: string[]; key: string; tone: string }[] = [
 { key: "founder", label: "Founders", types: ["founder"], tone: "border-[hsl(219_45%_30%)]/40 bg-[hsl(219_45%_30%)]/5" },
 { key: "employee", label: "Employees & Pool", types: ["employee", "pool"], tone: "border-[hsl(219_70%_55%)]/40 bg-[hsl(219_70%_55%)]/5" },
 { key: "investor", label: "Investors", types: ["investor"], tone: "border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5" },
 { key: "advisor", label: "Advisors", types: ["advisor"], tone: "border-[hsl(38_92%_50%)]/40 bg-[hsl(38_92%_50%)]/5" },
 { key: "other", label: "Other", types: ["other"], tone: "border-border bg-secondary/30" },
];

/** Session-persisted view toggle (kept in module scope to survive re-renders).
 * R200 §7 — display preferences are non-sensitive UI state only. */
let SESSION_VIEW: View = "fully_diluted";

export default function CapTable() {
 const [view, setViewState] = useState<View>(SESSION_VIEW);
 const setView = (v: View) => { SESSION_VIEW = v; setViewState(v); };
 const [region, setRegion] = useState<Region>("US");

 // Sprint 8 — sync engine region from the live company profile so a country
 // change in /founder/company propagates here without page reload.
 const companyId = useActiveCompanyId();
 const activeCompanyQ = useActiveCompany();
 const profileQ = useQuery<CompanyProfile>({ queryKey: ["/api/companies", companyId, "profile"] });
 useEffect(() => {
 const liveRegion = profileQ.data?.legal.region as Region | undefined;
 if (liveRegion && liveRegion !== region) setRegion(liveRegion);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [profileQ.data?.legal.region]);
 const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
 const [groupView, setGroupView] = useState(true);
 const [showAntiDil, setShowAntiDil] = useState(false);
 const [showAddSecurity, setShowAddSecurity] = useState(false);
 // Defect F1 — anti-dilution modeling is gated on founder.ofActiveCompany.
 const { data: entitlementCtx } = useEntitlement();
 const canAccessAntiDil = evaluate("founder.ofActiveCompany", entitlementCtx ?? null);
 const [showBulkMsg, setShowBulkMsg] = useState(false);
 const [showDrillId, setShowDrillId] = useState<string | null>(null);
 const { toast } = useToast();

 // Defect 15 — need viewer identity to resolve co-member privacy labels.
 const meQ = useQuery<{ id: string; displayName: string }>({ queryKey: ["/api/auth/me"] });
 const viewerId = meQ.data?.id ?? "";

 const securities = useQuery<ApiSecurity[]>({
 queryKey: ["/api/companies", companyId, "securities"],
 queryFn: async () => (await apiRequest("GET", `/api/companies/${companyId}/securities`)).json(),
 });
 const rounds = useQuery<ApiRound[]>({ queryKey: ["/api/rounds"] });

 // Filter securities to those issued at-or-before the as-of date
 const securitiesAsOf = useMemo(() => {
 if (!securities.data) return undefined;
 return securities.data.filter((s) => (s.issuedAt ?? "0000-01-01") <= asOf);
 }, [securities.data, asOf]);

 const result = useMemo(() => {
 if (!securitiesAsOf) return null;
 return runEngine(securitiesAsOf, view, region);
 }, [securitiesAsOf, view, region]);

 const rows = result?.rows ?? [];

 /** Map engine row → original security record (so we can surface rich fields). */
 const enrichedRows = useMemo(() => {
 return rows.map((r) => {
 const orig = securitiesAsOf?.find(
 (s) => s.holderName === r.holderName && s.instrument === r.kind && (s.series ?? "") === (r.series ?? ""),
 ) ?? securitiesAsOf?.find((s) => s.holderName === r.holderName);
 const round = rounds.data?.find((rd) => rd.id === orig?.roundId);
 return { ...r, orig, round };
 });
 }, [rows, securitiesAsOf, rounds.data]);

 const totals = useMemo(() => {
 const totalShares = rows.reduce<bigint>((s, r) => s + r.shares, 0n);
 const sumByType = (type: string) =>
 rows.filter((r) => r.holderType === type).reduce<bigint>((s, r) => s + r.shares, 0n);
 const totalInvested = (securitiesAsOf ?? []).reduce((s, r) => s + (r.investmentAmount ?? 0), 0);
 return {
 totalShares,
 founderShares: sumByType("founder"),
 investorShares: sumByType("investor"),
 optionShares: sumByType("pool"),
 totalInvested,
 };
 }, [rows, securitiesAsOf]);

 const sym = currencySymbol(region);

 // Option pool sub-breakdown
 const poolSec = securitiesAsOf?.find((s) => s.instrument === "option" && s.optionStatus);
 const pool = poolSec?.optionStatus ?? null;

 // Notes & SAFE running balance
 const notesAndSafes = (securitiesAsOf ?? []).filter((s) => s.instrument === "note" || s.instrument === "safe");
 const safeNoteTotal = notesAndSafes.reduce((s, x) => s + (x.investmentAmount ?? 0) + (x.accruedInterest ?? 0), 0);

 // Warrants outstanding
 const warrants = (securitiesAsOf ?? []).filter((s) => s.instrument === "warrant");

 function exportCSV() {
 const headers = [
 "Cert #", "Shares from–to", "Round", "Holder", "Holder type",
 "Instrument", "Series", "Issuance date", "Shares", "Price/share",
 "Investment", "Vested %", "Drag", "ROFR", "Co-Sale", "Pro-rata",
 "Side letter", "Ownership %",
 ];
 const lines = [
 headers.join(","),
 ...enrichedRows.map((r) => [
 `"${r.orig?.certificateNumber ?? ""}"`,
 `"${r.orig?.shareNumberFrom ?? ""}–${r.orig?.shareNumberTo ?? ""}"`,
 `"${r.round?.name ?? ""}"`,
 `"${r.holderName}"`,
 r.holderType,
 r.kind,
 `"${r.series ?? ""}"`,
 r.orig?.issuedAt ?? "",
 r.shares.toString(),
 r.orig?.pricePerShare ?? "",
 r.invested ?? "",
 r.orig?.vesting?.percentVested ?? "",
 r.orig?.drag ? "Y" : "",
 r.orig?.rofr ? "Y" : "",
 r.orig?.coSale ? "Y" : "",
 r.orig?.proRata ? "Y" : "",
 `"${r.orig?.sideLetter ?? ""}"`,
 r.ownershipPercent,
 ].join(",")),
 ];
 const blob = new Blob([lines.join("\n")], { type: "text/csv" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 /* v25.11 NM-4 — the previous filename `novapay-captable-...` hard-coded a
  * demo company slug, so every founder's export downloaded as a competitor
  * company's filename. Derive a safe slug from the active company name; if
  * unavailable, fall back to `captable-<companyId>` rather than to any
  * persona slug. */
 const co = activeCompanyQ.data?.company;
 const rawSlug = (co?.companyName || co?.legalName || companyId || "captable").toString();
 const safeSlug = rawSlug
   .toLowerCase()
   .replace(/[^a-z0-9]+/g, "-")
   .replace(/^-+|-+$/g, "")
   .slice(0, 40) || "captable";
 a.href = url; a.download = `${safeSlug}-captable-${asOf}.csv`; a.click();
 URL.revokeObjectURL(url);
 toast({ title: "Cap table exported", description: "Downloaded as CSV." });
 }

 async function exportPDFSnapshot() {
 try {
   const res = await apiRequest("GET", `/api/companies/${companyId}/cap-table/pdf`);
   const blob = await res.blob();
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url; a.download = `cap-table-${companyId}-${asOf}.pdf`; a.click();
   URL.revokeObjectURL(url);
   toast({ title: "PDF downloaded", description: "Cap table snapshot saved." });
 } catch {
   toast({ title: "PDF unavailable", description: "Try the CSV export instead.", variant: "destructive" });
 }
 }

 // Sprint 11 D3 — Excel-flavored export (TSV that opens in Excel/Sheets without conversion).
 function exportXLSX() {
 const headers = [
 "Cert #", "Holder", "Type", "Instrument", "Series",
 "Issued", "Shares", "Price/share", "Investment", "Vested %",
 "Drag", "ROFR", "Co-Sale", "Pro-rata", "Ownership %",
 ];
 const lines = [
 headers.join("\t"),
 ...enrichedRows.map((r: any) => [
 r.orig?.certificateNumber ?? "",
 r.holderName,
 r.holderType,
 r.kind,
 r.series ?? "",
 r.orig?.issuedAt ?? "",
 r.shares.toString(),
 r.orig?.pricePerShare ?? "",
 r.invested ?? "",
 r.orig?.vesting?.percentVested ?? "",
 r.orig?.drag ? "Y" : "",
 r.orig?.rofr ? "Y" : "",
 r.orig?.coSale ? "Y" : "",
 r.orig?.proRata ? "Y" : "",
 r.ownershipPercent,
 ].join("\t")),
 ];
 const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "application/vnd.ms-excel" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url; a.download = `novapay-captable-${asOf}.xls`; a.click();
 URL.revokeObjectURL(url);
 toast({ title: "Excel export ready", description: "Opens directly in Excel or Google Sheets." });
 }

 const totalSharesNum = Number(totals.totalShares);
 const founderSharesNum = Number(totals.founderShares);
 const investorSharesNum = Number(totals.investorShares);
 const optionSharesNum = Number(totals.optionShares);

 return (
 <>
 <PageHeader
 title="Cap table"
 description="A cap table is the running ledger of who owns what in your company. Every share, option, SAFE, warrant, and note lives here — reconciles to 100% on every view."
 breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Cap table" }]}
 actions={
 <>
 <GlossaryLink />
 <EngineBadge result={result} region={region} />
 <Button variant="outline" onClick={exportCSV} data-testid="button-export-csv"><Download className="h-4 w-4 mr-2" /> CSV</Button>
 <Button variant="outline" onClick={exportPDFSnapshot} data-testid="button-export-pdf"><FileIcon className="h-4 w-4 mr-2" /> PDF snapshot</Button>
 <Button variant="outline" onClick={exportXLSX} data-testid="button-export-xlsx"><FileSpreadsheet className="h-4 w-4 mr-2" /> Excel</Button>
 {/* v25.19 Lane 3 NH1 (hard close) — the pre-v25.19 gate was `(canAccessAntiDil.allow || true)`,
     which short-circuited the plan gate so EVERY founder (even free plan) saw
     the anti-dilution button. Removing the `|| true` restores the entitlement
     gate as designed. */}
 {canAccessAntiDil.allow && <Button variant="outline" onClick={() => setShowAntiDil(true)} data-testid="button-anti-dilution"><Calculator className="h-4 w-4 mr-2" /> Anti-dilution</Button>}
 <Button variant="outline" onClick={() => setShowBulkMsg(true)} data-testid="button-bulk-message"><SendIcon className="h-4 w-4 mr-2" /> Bulk message</Button>
 <Button variant="outline" onClick={exportPDFSnapshot} data-testid="button-print" className="hidden md:inline-flex"><Printer className="h-4 w-4 mr-2" /> Print</Button>
 <Button onClick={() => setShowAddSecurity(true)} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-add-security">
 <Plus className="h-4 w-4 mr-2" /> Add security
 </Button>
 </>
 }
 />
 <PageBody>
 {/* Print-only header (only visible when window.print() runs) */}
 <div className="hidden print:flex items-center justify-between mb-4 border-b border-border pb-3">
 <img src={CAPAVATE_LOGO_URL} alt="Capavate" style={{ height: 28, width: "auto" }} />
 <div className="text-xs text-muted-foreground">Cap table snapshot · {new Date().toISOString().slice(0, 10)}</div>
 </div>
 {/* As-of selector + region */}
 <Card className="mb-4">
 <CardContent className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-2">
 <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs text-muted-foreground flex items-center gap-1">
 As of <HelpTip>The cap table reconstructs to whatever date you pick. Try a past round-close date to see the company's snapshot at that moment in time. Powered by the immutable transaction ledger.</HelpTip>
 </span>
 <Input
 type="date"
 className="h-8 w-[150px] text-xs"
 value={asOf}
 onChange={(e) => setAsOf(e.target.value)}
 data-testid="input-asof"
 />
 <Button size="sm" variant="ghost" onClick={() => setAsOf(new Date().toISOString().slice(0, 10))} data-testid="button-asof-today">Today</Button>
 </div>
 <span className="text-xs text-muted-foreground">·</span>
 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground flex items-center gap-1">
 Region <HelpTip>Picks which formula pack the engine runs (US/CA/UK/SG/HK/CN/IN/JP/AU). Changes display currency and conversion rules.</HelpTip>
 </span>
 <select
 value={region}
 onChange={(e) => setRegion(e.target.value as Region)}
 className="h-8 px-2 rounded-md border border-input bg-background text-xs"
 data-testid="select-region-captable"
 >
 <option value="US">US ($)</option>
 <option value="CA">CA (C$)</option>
 <option value="UK">UK (£)</option>
 <option value="SG">SG ($)</option>
 <option value="HK">HK (HK$)</option>
 <option value="CN">CN (¥)</option>
 <option value="IN">IN (₹)</option>
 <option value="JP">JP (¥)</option>
 <option value="AU">AU (A$)</option>
 </select>
 </div>
 </div>
 <div className="text-[11px] text-muted-foreground">
 Display currency: <span className="font-mono">{sym}</span> · Engine reconstructs from immutable ledger
 </div>
 </CardContent>
 </Card>

 {/* Totals */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
 <Stat label="Total shares" value={fmtNum(totalSharesNum)} hint={view === "basic" ? "Basic view" : view === "fully_diluted" ? "Fully diluted" : "As-converted"} icon={Layers} testid="stat-total-shares" />
 <Stat label="Founder ownership" value={fmtPct((founderSharesNum / Math.max(1, totalSharesNum)) * 100, 2)} hint={`${fmtNum(founderSharesNum)} shares`} icon={PieIcon} testid="stat-founders" />
 <Stat label="Investor ownership" value={fmtPct((investorSharesNum / Math.max(1, totalSharesNum)) * 100, 2)} hint={`${fmtNum(investorSharesNum)} shares`} icon={TrendingUp} testid="stat-investors" />
 <Stat label="Option pool" value={fmtPct((optionSharesNum / Math.max(1, totalSharesNum)) * 100, 2)} hint={`${fmtNum(optionSharesNum)} options`} icon={PieIcon} testid="stat-options" />
 </div>

 {/* Option pool sub-breakdown + Convertibles balance + Warrants */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
 <Card data-testid="card-pool-breakdown">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">Option pool sub-breakdown <HelpTip>Carta/Pulley standard. Splits the pool into Granted, Available, Exercised, Cancelled.</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1.5">
 {pool ? (
 <>
 <Row label="Granted (outstanding)" value={fmtNum(pool.granted)} />
 <Row label="Available (unallocated)" value={fmtNum(pool.available)} />
 <Row label="Exercised" value={fmtNum(pool.exercised)} />
 <Row label="Cancelled / forfeited" value={fmtNum(pool.cancelled)} />
 <div className="border-t border-border/60 pt-1.5 mt-1.5">
 <Row label="Total reserved" value={fmtNum(pool.granted + pool.available + pool.exercised + pool.cancelled)} bold />
 </div>
 </>
 ) : <span className="text-muted-foreground">No option pool reserved.</span>}
 </CardContent>
 </Card>

 <Card data-testid="card-convertibles">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">SAFEs + Notes outstanding <HelpTip>Running balance of every unconverted SAFE and convertible note (principal + accrued interest).</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1.5">
 {notesAndSafes.length === 0 ? (
 <span className="text-muted-foreground">None outstanding.</span>
 ) : notesAndSafes.map((s) => (
 <div key={s.id} className="border-b border-border/60 pb-1.5 last:border-0">
 <div className="flex justify-between"><span className="font-medium">{s.holderName}</span><Badge variant="outline" className="text-[10px] capitalize">{s.instrument}</Badge></div>
 <div className="flex justify-between text-muted-foreground">
 <span>Principal</span>
 <span className="font-mono tabular-nums">{sym}{(s.investmentAmount ?? 0).toLocaleString()}</span>
 </div>
 {s.accruedInterest != null && s.accruedInterest > 0 && (
 <div className="flex justify-between text-muted-foreground">
 <span>+ Accrued ({s.interestRate}% APR)</span>
 <span className="font-mono tabular-nums">{sym}{(s.accruedInterest ?? 0).toLocaleString()}</span>
 </div>
 )}
 {s.maturityDate && (
 <div className="flex justify-between text-muted-foreground"><span>Maturity</span><span>{fmtDate(s.maturityDate)}</span></div>
 )}
 </div>
 ))}
 {notesAndSafes.length > 0 && (
 <div className="flex justify-between font-medium pt-1.5">
 <span>Total</span>
 <span className="font-mono tabular-nums">{sym}{safeNoteTotal.toLocaleString()}</span>
 </div>
 )}
 </CardContent>
 </Card>

 <Card data-testid="card-warrants">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">Warrants outstanding <HelpTip>Strike, expiry, remaining life, and intrinsic value (FMV − strike) per institutional convention.</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1.5">
 {warrants.length === 0 ? (
 <span className="text-muted-foreground">None outstanding.</span>
 ) : warrants.map((w) => {
 const remainingYrs = w.expiry ? ((new Date(w.expiry).getTime() - Date.now()) / (365.25 * 86400000)) : null;
 const intrinsic = w.fmv != null && w.strike != null ? Math.max(0, (w.fmv - w.strike) * (w.shares ?? 0)) : null;
 return (
 <div key={w.id} className="border-b border-border/60 pb-1.5 last:border-0">
 <div className="flex justify-between"><span className="font-medium">{w.holderName}</span><Badge variant="outline" className="text-[10px]">{fmtNum(w.shares)} sh</Badge></div>
 <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
 <span>Strike</span><span className="font-mono text-right">{sym}{w.strike?.toFixed(2) ?? "—"}</span>
 <span>FMV</span><span className="font-mono text-right">{sym}{w.fmv?.toFixed(2) ?? "—"}</span>
 <span>Remaining life</span><span className="font-mono text-right">{remainingYrs != null ? `${remainingYrs.toFixed(1)} yrs` : "—"}</span>
 <span>Intrinsic value</span><span className="font-mono text-right text-foreground">{intrinsic != null ? `${sym}${intrinsic.toLocaleString()}` : "—"}</span>
 </div>
 </div>
 );
 })}
 </CardContent>
 </Card>
 </div>

 {/* View toggle + stacked-bar viz */}
 <Card className="mb-6">
 <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
 <div className="min-w-0">
 <CardTitle className="text-base flex items-center gap-2">
 Ownership composition
 <HelpTip>
 Three views, three different denominators. Hover the tabs to see what each one counts. Each view always sums to 100% — only the slices change.
 </HelpTip>
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Computed by <code className="font-mono text-[10px] bg-secondary/60 px-1 py-0.5 rounded">@capavate/cap-table-engine</code> on every render.</p>
 </div>
 <div className="flex items-center gap-3">
 <button
 type="button"
 onClick={() => setGroupView(!groupView)}
 className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-secondary/60"
 data-testid="button-toggle-grouping"
 >
 {groupView ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
 {groupView ? "Grouped" : "Flat list"}
 </button>
 <Tabs value={view} onValueChange={(v) => setView(v as View)} className="w-full md:w-auto overflow-x-auto">
 <TabsList className="h-9 w-full md:w-auto">
 {(Object.keys(VIEW_BLURBS) as View[]).map((v) => (
 <Tooltip key={v}>
 <TooltipTrigger asChild>
 <TabsTrigger value={v} data-testid={`tab-${v === "fully_diluted" ? "fd" : v === "as_converted" ? "ac" : "basic"}`} className="text-xs px-2.5 flex-1 md:flex-none">
 {VIEW_BLURBS[v].title}
 </TabsTrigger>
 </TooltipTrigger>
 <TooltipContent className="max-w-xs text-xs leading-relaxed">
 <div className="font-semibold mb-1">{VIEW_BLURBS[v].title} view</div>
 {VIEW_BLURBS[v].body}
 </TooltipContent>
 </Tooltip>
 ))}
 </TabsList>
 </Tabs>
 </div>
 </CardHeader>
 <CardContent>
 <div className="flex h-10 rounded-md overflow-hidden border border-border" data-testid="bar-ownership">
 {rows.map((r, i) => (
 <div
 key={i}
 className="relative group transition-all"
 style={{ width: `${parseFloat(r.ownershipPercent)}%`, backgroundColor: INSTRUMENT_COLORS[r.kind] || "hsl(0 0% 50%)" }}
 title={`${r.holderName} — ${parseFloat(r.ownershipPercent).toFixed(2)}%`}
 />
 ))}
 </div>
 <div className="mt-4 flex flex-wrap gap-3 text-xs">
 {Object.entries(INSTRUMENT_LABELS).map(([k, label]) => (
 <Tooltip key={k}>
 <TooltipTrigger asChild>
 <button type="button" className="flex items-center gap-1.5 cursor-help rounded px-1 py-0.5 hover:bg-secondary/60" data-testid={`chip-instrument-${k}`}>
 <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: INSTRUMENT_COLORS[k] }} />
 <span className="text-muted-foreground">{label}</span>
 </button>
 </TooltipTrigger>
 <TooltipContent className="max-w-xs text-xs leading-relaxed">
 <div className="font-semibold mb-1">{label}</div>
 {INSTRUMENT_BLURBS[k]}
 </TooltipContent>
 </Tooltip>
 ))}
 </div>
 {view === "as_converted" && (
 <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs text-muted-foreground">
 <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
 <span>SAFEs are converted to Common-equivalent shares at the lower of (cap-implied price) and (last priced round PPS × (1 − discount)). The math is illustrative — the engine reconciles to the share when the round actually closes.</span>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Holdings table — institutional view */}
 <Card>
 <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0">
 <div>
 <CardTitle className="text-base">Holdings</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">% on As-Converted and % on Fully-Diluted are shown distinctly per Carta convention.</p>
 </div>
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <span>Engine view: <span className="font-mono text-foreground">{view}</span></span>
 <span>·</span>
 <span>{enrichedRows.length} rows</span>
 </div>
 </CardHeader>
 <CardContent className="px-0">
 <div className="overflow-x-auto">
 {groupView ? (
 <GroupedHoldings rows={enrichedRows} sym={sym} viewerId={viewerId} />
 ) : (
 <FlatHoldings rows={enrichedRows} sym={sym} totalSharesNum={totalSharesNum} totalInvested={totals.totalInvested} viewerId={viewerId} />
 )}
 </div>
 </CardContent>
 </Card>

 {/* Sprint 18 Phase 2 — T4.4 Member value & intelligence */}
 <MemberValueIntelligenceBox rows={enrichedRows} />

 <p className="text-xs text-muted-foreground mt-4 max-w-3xl leading-relaxed">
 Cap table engine per R200 §10. Source-of-truth ledger; SAFEs use post-money cap conversion.
 As-converted view applies cap/discount per R165 §2. New to a term? <span className="inline-flex align-middle"><GlossaryLink size="xs" /></span> for plain definitions.
 </p>

 {/* Print-only signature block (Sprint 5) */}
 <div className="hidden print:block mt-12 pt-8 border-t border-foreground">
 <div className="flex items-center gap-2 mb-6 text-xs">
 <Shield className="h-4 w-4" />
 <span className="font-semibold">Capavate institutional cap-table snapshot</span>
 <span className="ml-auto">Generated {new Date().toLocaleString()} · As-of {asOf} · Engine v1.0.0 ({region})</span>
 </div>
 <div className="grid grid-cols-2 gap-12 mt-12">
 <div>
 <div className="border-t-2 border-foreground pt-2">
 <div className="text-xs font-semibold">Founder / CEO</div>
 <div className="text-[10px] text-muted-foreground">{meQ.data?.displayName ?? "Founder"}{activeCompanyQ.data?.company?.companyName ? ` — ${activeCompanyQ.data.company.companyName}` : ""}</div>
 </div>
 </div>
 <div>
 <div className="border-t-2 border-foreground pt-2">
 <div className="text-xs font-semibold">Capavate platform admin</div>
 <div className="text-[10px] text-muted-foreground">Counter-signature on dual-engine reconciliation</div>
 </div>
 </div>
 </div>
 </div>
 </PageBody>

 {/* Sprint 11 D3 — Anti-dilution simulator */}
 <AntiDilutionDialog open={showAntiDil} onClose={() => setShowAntiDil(false)} rows={enrichedRows} sym={sym} />

 {/* Sprint 11 D3 — Bulk message */}
 <BulkMessageDialog open={showBulkMsg} onClose={() => setShowBulkMsg(false)} rows={enrichedRows} toast={toast} />

 {/* v25.11 NC-1 fix — the AddSecurityDialog component existed (line 991+) but was
  * never mounted in the JSX tree, so clicking "Add security" set state but no
  * dialog rendered. Mounting it here closes the silent-dead-button gap. The
  * cap-table list query is invalidated on success so the new row appears
  * without a page reload. */}
 {showAddSecurity && (
   <AddSecurityDialog
     companyId={companyId}
     onClose={() => setShowAddSecurity(false)}
     onSuccess={() => {
       setShowAddSecurity(false);
       queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "securities"] });
       queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "cap-table"] });
       toast({ title: "Security added", description: "Cap table will refresh." });
     }}
   />
 )}
 </>
 );
}

// Sprint 11 D3 / Sprint 25 — Anti-dilution simulator dialog.
//
// CRITICAL: Models a hypothetical down-round applying broad-based weighted-average
// vs full-ratchet conversion BY CALLING THE PRODUCTION ENGINE DIRECTLY. Previously
// this simulator re-implemented the NVCA broad-based-WA formula in float64, which
// could diverge from the production engine's decimal.js / BigInt result by up to
// several shares for typical Series A inputs.
//
// Sprint 25 rule: the simulator output MUST equal the engine output for the same
// inputs. No alternative implementations of the formula anywhere in the codebase.
function AntiDilutionDialog({ open, onClose, rows, sym }: { open: boolean; onClose: () => void; rows: any[]; sym: string }) {
 // Inputs are entered as Decimal-as-strings so a founder can type a full-precision
 // price like "1.234567890123" without lossy Number() truncation.
 const [newPreMoney, setNewPreMoney] = useState("8000000");
 const [newRaise, setNewRaise] = useState("2000000");
 const [newPps, setNewPps] = useState("1.00");
 // newPreMoney is informational only — the formula uses newRaise + newPps. We keep
 // the input so a founder can sanity-check their pre-money assumption.
 void newPreMoney;

 // Holders with anti-dilution clauses (assume preferred holders qualify).
 const protected_ = rows.filter((r: any) => r.kind === "preferred" || r.kind === "safe" || r.kind === "note");
 // Total pre-round outstanding (broad-based: include all visible rows).
 const totalSharesPreBn: bigint = rows.reduce<bigint>(
 (s: bigint, r: any) => s + BigInt(String(r.shares ?? 0)),
 0n,
 );

 // Shares newly issued in the dilutive round (BigInt floor of raise / pps).
 const newSharesBn: bigint = (() => {
 try {
 const pps = DecimalFromString(newPps);
 if (pps.lte(0)) return 0n;
 return decimalToShares(DecimalFromString(newRaise).div(pps), "floor");
 } catch { return 0n; }
 })();
 const totalSharesPostBn = totalSharesPreBn + newSharesBn;

 // Compute dilution per holder using the real engine.
 const sims = protected_.slice(0, 8).map((r: any) => {
 const oldPpsStr = String(r.orig?.pricePerShare ?? "1.00");
 const oldSharesBn: bigint = BigInt(String(r.shares ?? 0));
 const FORMULA_STUB = { formulaId: "antiDilution.broadBased.simulator", formulaVersion: "1.0.0", region: "US" as Region, formulaDef: {} };
 // Engine call: broad-based weighted-average.
 let sharesAfterWeightedBn = oldSharesBn;
 try {
 const wa = applyBroadBasedWeightedAverage({
 originalConversionPrice: oldPpsStr,
 newIssuePrice: newPps,
 moneyRaised: newRaise,
 outstandingBroadBased: totalSharesPreBn,
 sharesIssuedInRound: newSharesBn,
 protectedShares: oldSharesBn,
 ...FORMULA_STUB,
 });
 sharesAfterWeightedBn = wa.newShares;
 } catch { /* leave as oldSharesBn on invalid input */ }
 // Engine call: full-ratchet.
 let sharesAfterRatchetBn = oldSharesBn;
 try {
 const fr = applyFullRatchet({
 originalIssuePrice: oldPpsStr,
 newIssuePrice: newPps,
 protectedShares: oldSharesBn,
 ...FORMULA_STUB,
 });
 sharesAfterRatchetBn = fr.newShares;
 } catch { /* leave as oldSharesBn */ }

 // Percentages computed at Decimal precision then converted to display number
 // (display-only — the binding share counts above remain BigInt).
 const pct = (numer: bigint, denom: bigint): number => {
 if (denom === 0n) return 0;
 return Number(DecimalFromString(numer.toString()).div(DecimalFromString(denom.toString())).mul(100).toFixed(6));
 };
 const ownPre = pct(oldSharesBn, totalSharesPreBn);
 const ownPostUnprot = pct(oldSharesBn, totalSharesPostBn);
 const postWeightedDenom = totalSharesPostBn - oldSharesBn + sharesAfterWeightedBn;
 const postRatchetDenom = totalSharesPostBn - oldSharesBn + sharesAfterRatchetBn;
 const ownPostWeighted = pct(sharesAfterWeightedBn, postWeightedDenom);
 const ownPostRatchet = pct(sharesAfterRatchetBn, postRatchetDenom);
 return {
 holder: r.holderName,
 oldPps: oldPpsStr,
 ownPre, ownPostUnprot, ownPostWeighted, ownPostRatchet,
 sharesAfterWeighted: sharesAfterWeightedBn.toString(),
 sharesAfterRatchet: sharesAfterRatchetBn.toString(),
 };
 });
 // Display helpers for the new-shares-issued line.
 const newSharesDisplay = newSharesBn.toString();
 const totalSharesPostDisplay = totalSharesPostBn.toString();

 return (
 <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
 <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2"><Calculator className="h-4 w-4" /> Anti-dilution simulator</DialogTitle>
 </DialogHeader>
 <div className="space-y-4">
 <div className="text-xs text-muted-foreground rounded-md bg-secondary/30 p-3">
 Models a hypothetical financing event and shows how protected holders' positions move under <strong>broad-based weighted-average</strong> (NVCA standard) vs <strong>full-ratchet</strong> (founder-unfriendly).
 </div>
 <div className="grid grid-cols-3 gap-3">
 <div>
 <Label className="text-xs">New pre-money ({sym})</Label>
 {/* Sprint 25: string-typed input preserves full precision (no Number() coercion) */}
 <Input type="text" inputMode="decimal" value={newPreMoney} onChange={e => setNewPreMoney(e.target.value)} className="mt-1 font-mono" data-testid="input-pre-money" />
 </div>
 <div>
 <Label className="text-xs">New raise ({sym})</Label>
 <Input type="text" inputMode="decimal" value={newRaise} onChange={e => setNewRaise(e.target.value)} className="mt-1 font-mono" data-testid="input-new-raise" />
 </div>
 <div>
 <Label className="text-xs">New price/share ({sym})</Label>
 <Input type="text" inputMode="decimal" value={newPps} onChange={e => setNewPps(e.target.value)} className="mt-1 font-mono" data-testid="input-new-pps" />
 </div>
 </div>
 <div className="text-xs text-muted-foreground" data-testid="text-antidil-totals">
 {fmtNum(Number(newSharesDisplay))} new shares issued · post-money total: {fmtNum(Number(totalSharesPostDisplay))} shares
 </div>

 <div className="rounded-md border">
 <table className="w-full text-xs">
 <thead className="bg-secondary/50"><tr>
 <th className="text-left p-2">Holder</th>
 <th className="text-right p-2">Pre-round %</th>
 <th className="text-right p-2">Unprotected %</th>
 <th className="text-right p-2">Weighted-avg %</th>
 <th className="text-right p-2">Full-ratchet %</th>
 </tr></thead>
 <tbody>
 {sims.map((s, i) => (
 <tr key={i} className="border-t" data-testid={`row-antidil-${i}`}>
 <td className="p-2 font-medium">{s.holder}</td>
 <td className="p-2 text-right font-mono" title={`OCP: ${s.oldPps}`}>{s.ownPre.toFixed(2)}%</td>
 <td className="p-2 text-right font-mono text-[hsl(7_61%_43%)]">{s.ownPostUnprot.toFixed(2)}%</td>
 <td className="p-2 text-right font-mono text-[hsl(0_100%_40%)]" title={`Engine: ${s.sharesAfterWeighted} shares`}>{s.ownPostWeighted.toFixed(2)}%</td>
 <td className="p-2 text-right font-mono" title={`Engine: ${s.sharesAfterRatchet} shares`}>{s.ownPostRatchet.toFixed(2)}%</td>
 </tr>
 ))}
 {sims.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No protected holders found.</td></tr>}
 </tbody>
 </table>
 </div>
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={onClose}>Close</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

// Sprint 11 D3 — Bulk message dialog. Pre-fills recipient list with all current cap-table holders.
// Sprint 19 H — send() now calls POST /api/founder/investor-crm/broadcast and invalidates /api/comms/channels.
function BulkMessageDialog({ open, onClose, rows, toast }: { open: boolean; onClose: () => void; rows: any[]; toast: ReturnType<typeof useToast>["toast"] }) {
 const [subject, setSubject] = useState("Quarterly cap-table broadcast");
 const [body, setBody] = useState("");
 const [isSending, setIsSending] = useState(false);
 const holders = Array.from(new Set(rows.map((r: any) => r.holderName))).slice(0, 50);
 // Derive investor ids: use investorUserId field or fall back to holderName slug.
 const recipientIds = Array.from(new Set(
 rows.map((r: any) => r.investorUserId ?? r.holderName.toLowerCase().replace(/\s+/g, "_"))
 )).slice(0, 50);

 async function send() {
 if (!body.trim()) return;
 // Patch v4: derive companyId only from real rows; do not leak demo id.
 const companyId = rows[0]?.companyId;
 if (!companyId) {
 toast({ title: "No company selected", description: "Select an active company before broadcasting.", variant: "destructive" });
 return;
 }
 setIsSending(true);
 try {
 await apiRequest("POST", "/api/founder/investor-crm/broadcast", {
 companyId,
 message: body.trim(),
 recipientIds,
 });
 queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] });
 toast({ title: "Broadcast queued", description: `Delivered to ${holders.length} holders via Messages.` });
 onClose();
 } catch {
 toast({ title: "Send failed", description: "Could not deliver broadcast.", variant: "destructive" });
 } finally {
 setIsSending(false);
 }
 }

 return (
 <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
 <DialogContent className="max-w-xl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2"><SendIcon className="h-4 w-4" /> Bulk message cap-table</DialogTitle>
 </DialogHeader>
 <div className="space-y-3">
 <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto rounded-md border p-2">
 {holders.map(h => <Badge key={h} variant="outline" className="text-[10px]" data-testid={`badge-recipient-${h.replace(/\s/g, '-')}`}>{h}</Badge>)}
 </div>
 <div className="text-xs text-muted-foreground">{holders.length} unique holders selected.</div>
 <div>
 <Label>Subject</Label>
 <Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" data-testid="input-bulk-subject" />
 </div>
 <div>
 <Label>Message</Label>
 <Textarea rows={6} value={body} onChange={e => setBody(e.target.value)} placeholder="Quarterly update for all cap-table holders…" className="mt-1" data-testid="textarea-bulk-body" />
 </div>
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={onClose}>Cancel</Button>
 <Button className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" onClick={send} disabled={!body.trim() || isSending} data-testid="button-send-bulk">{isSending ? "Sending…" : `Send to ${holders.length}`}</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
 return (
 <div className={`flex justify-between ${bold ? "font-semibold" : "text-muted-foreground"}`}>
 <span>{label}</span>
 <span className="font-mono tabular-nums">{value}</span>
 </div>
 );
}

type EnrichedRow = ReturnType<typeof enrichedRowType>;
function enrichedRowType() { return null as any; } // type-only helper, never called

const HOLDINGS_HEADERS = (
 <thead>
 <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
 <th className="text-left font-medium px-4 py-2.5">Cert #</th>
 <th className="text-left font-medium px-2 py-2.5">Holder</th>
 <th className="text-left font-medium px-2 py-2.5">Round</th>
 <th className="text-left font-medium px-2 py-2.5">Instrument</th>
 <th className="text-left font-medium px-2 py-2.5">Series</th>
 <th className="text-left font-medium px-2 py-2.5">Issued</th>
 <th className="text-right font-medium px-2 py-2.5">Shares</th>
 <th className="text-right font-medium px-2 py-2.5">$/share</th>
 <th className="text-right font-medium px-2 py-2.5">Invested</th>
 <th className="text-center font-medium px-2 py-2.5">Vested</th>
 <th className="text-center font-medium px-2 py-2.5">Rights</th>
 <th className="text-right font-medium px-3 py-2.5 w-44">% on view</th>
 </tr>
 </thead>
);

function FlatHoldings({ rows, sym, totalSharesNum, totalInvested, viewerId }: { rows: any[]; sym: string; totalSharesNum: number; totalInvested: number; viewerId: string }) {
 return (
 <table className="w-full text-xs" data-testid="table-captable">
 {HOLDINGS_HEADERS}
 <tbody>
 {rows.map((r, i) => <HoldingRow key={i} r={r} sym={sym} idx={i} viewerId={viewerId} />)}
 <tr className="font-semibold bg-secondary/50">
 <td className="px-4 py-3" colSpan={6}>Total</td>
 <td className="px-2 py-3 text-right font-mono tabular-nums">{fmtNum(totalSharesNum)}</td>
 <td />
 <td className="px-2 py-3 text-right font-mono tabular-nums">{sym}{totalInvested.toLocaleString()}</td>
 <td colSpan={2} />
 <td className="px-3 py-3 text-right font-mono tabular-nums">100.00%</td>
 </tr>
 </tbody>
 </table>
 );
}

function GroupedHoldings({ rows, sym, viewerId }: { rows: any[]; sym: string; viewerId: string }) {
 return (
 <table className="w-full text-xs" data-testid="table-captable">
 {HOLDINGS_HEADERS}
 <tbody>
 {HOLDER_GROUPS.map((g) => {
 const groupRows = rows.filter((r) => g.types.includes(r.holderType));
 if (groupRows.length === 0) return null;
 const groupShares = groupRows.reduce<bigint>((s, r) => s + r.shares, 0n);
 const groupPct = groupRows.reduce((s, r) => s + parseFloat(r.ownershipPercent), 0);
 const groupInvested = groupRows.reduce((s, r) => s + (parseFloat(r.invested ?? "0") || 0), 0);
 return (
 <React.Fragment key={`grp-frag-${g.key}`}>
 <tr className={`border-y border-border ${g.tone}`} data-testid={`group-${g.key}`}>
 <td colSpan={6} className="px-4 py-2 font-semibold uppercase tracking-wide text-[10px]">{g.label} <span className="ml-2 text-muted-foreground normal-case">{groupRows.length} holder{groupRows.length === 1 ? "" : "s"}</span></td>
 <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{fmtNum(Number(groupShares))}</td>
 <td />
 <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{groupInvested ? `${sym}${Math.round(groupInvested).toLocaleString()}` : "—"}</td>
 <td colSpan={2} />
 <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">{groupPct.toFixed(2)}%</td>
 </tr>
 {groupRows.map((r, i) => <HoldingRow key={`${g.key}-${i}`} r={r} sym={sym} idx={i} viewerId={viewerId} />)}
 </React.Fragment>
 );
 })}
 </tbody>
 </table>
 );
}

function HoldingRow({ r, sym, idx, viewerId }: { r: any; sym: string; idx: number; viewerId: string }) {
 const orig = r.orig as ApiSecurity | undefined;
 const round = r.round as ApiRound | undefined;
 const rights: string[] = [];
 if (orig?.drag) rights.push("Drag");
 if (orig?.rofr) rights.push("ROFR");
 if (orig?.coSale) rights.push("Co-Sale");
 if (orig?.proRata) rights.push("Pro-rata");
 // Defect 15 — apply privacy label resolution. If the security carries holderVisibility
 // (enriched by server for co-member views), use resolveCoMemberLabel. Otherwise fall back
 // to holderName (which is always visible to the founder viewing their own cap table).
 const displayName: string = orig?.holderVisibility && orig?.investorId
 ? resolveCoMemberLabel(
 { id: orig.investorId, legalName: r.holderName, visibility: orig.holderVisibility },
 { id: viewerId },
 )
 : r.holderName;
 return (
 <tr className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-security-${idx}`}>
 <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">{orig?.certificateNumber ?? "—"}</td>
 <td className="px-2 py-2.5">
 <div className="font-medium">{displayName}</div>
 <div className="text-[10px] text-muted-foreground capitalize">{r.holderType}{orig?.leadInvestorOfRound ? <span className="ml-1 text-[hsl(0_100%_40%)] font-medium">· LEAD</span> : ""}</div>
 </td>
 <td className="px-2 py-2.5">
 {round ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-[10px] inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-secondary/40 cursor-help truncate max-w-[120px]" data-testid={`round-attr-${idx}`}>{round.name}</span>
 </TooltipTrigger>
 <TooltipContent className="text-xs"><div className="font-semibold">{round.name}</div><div className="text-muted-foreground capitalize">{round.type.replace(/_/g, " ")} · {fmtDate(round.closeDate ?? null)}</div></TooltipContent>
 </Tooltip>
 ) : <span className="text-muted-foreground">—</span>}
 </td>
 <td className="px-2 py-2.5">
 <Badge variant="outline" className="capitalize text-[10px]" style={{ borderColor: INSTRUMENT_COLORS[r.kind], color: INSTRUMENT_COLORS[r.kind] }}>
 {INSTRUMENT_LABELS[r.kind] ?? r.kind}
 </Badge>
 </td>
 <td className="px-2 py-2.5 text-muted-foreground truncate max-w-[140px]">{r.series ?? "—"}</td>
 <td className="px-2 py-2.5 text-muted-foreground text-[10px]">{orig?.issuedAt ? fmtDate(orig.issuedAt) : "—"}</td>
 <td className="px-2 py-2.5 text-right font-mono tabular-nums">{fmtNum(Number(r.shares))}</td>
 <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{orig?.pricePerShare != null ? `${sym}${orig.pricePerShare.toFixed(4)}` : "—"}</td>
 <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{r.invested ? `${sym}${parseFloat(r.invested).toLocaleString()}` : "—"}</td>
 <td className="px-2 py-2.5 text-center">
 {orig?.vesting ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="inline-flex items-center gap-1 cursor-help" data-testid={`vest-${idx}`}>
 <span className="text-[10px] font-mono">{orig.vesting.percentVested}%</span>
 <span className="h-1 w-8 bg-secondary rounded-full overflow-hidden inline-block">
 <span className="h-full bg-[hsl(0_100%_40%)] block" style={{ width: `${orig.vesting.percentVested}%` }} />
 </span>
 </span>
 </TooltipTrigger>
 <TooltipContent className="text-xs">
 <div className="font-semibold">Vesting</div>
 <div>{orig.vesting.months} months · {orig.vesting.cliff}-mo cliff</div>
 <div className="text-muted-foreground">Started {fmtDate(orig.vesting.startDate)}</div>
 </TooltipContent>
 </Tooltip>
 ) : <span className="text-[10px] text-muted-foreground">—</span>}
 </td>
 <td className="px-2 py-2.5 text-center">
 {rights.length > 0 ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="inline-flex gap-1 cursor-help" data-testid={`rights-${idx}`}>
 {orig?.drag && <Badge variant="outline" className="text-[9px] px-1 py-0">D</Badge>}
 {orig?.rofr && <Badge variant="outline" className="text-[9px] px-1 py-0">R</Badge>}
 {orig?.coSale && <Badge variant="outline" className="text-[9px] px-1 py-0">C</Badge>}
 {orig?.proRata && <Badge variant="outline" className="text-[9px] px-1 py-0 border-[hsl(0_100%_40%)] text-[hsl(0_100%_40%)]">P</Badge>}
 </span>
 </TooltipTrigger>
 <TooltipContent className="text-xs space-y-0.5">
 <div className="font-semibold">Investor rights</div>
 {orig?.drag && <div><span className="font-mono text-[10px]">D</span> Drag-along — majority can force minority to sell on M&A.</div>}
 {orig?.rofr && <div><span className="font-mono text-[10px]">R</span> Right of First Refusal — company/investors can match third-party offers.</div>}
 {orig?.coSale && <div><span className="font-mono text-[10px]">C</span> Co-Sale (tag-along) — investor can sell pro-rata if a major holder sells.</div>}
 {orig?.proRata && <div><span className="font-mono text-[10px]">P</span> Pro-rata participation right in future rounds.</div>}
 {orig?.sideLetter && <div className="border-t border-border/60 pt-1 mt-1"><span className="font-semibold">Side letter:</span> {orig.sideLetter}</div>}
 </TooltipContent>
 </Tooltip>
 ) : <span className="text-[10px] text-muted-foreground">—</span>}
 </td>
 <td className="px-3 py-2.5">
 <div className="flex items-center justify-end gap-3">
 <div className="font-mono tabular-nums w-14 text-right">{parseFloat(r.ownershipPercent).toFixed(2)}%</div>
 <div className="h-1.5 rounded-full bg-secondary w-24 overflow-hidden">
 <div className="h-full" style={{ width: `${Math.min(100, parseFloat(r.ownershipPercent))}%`, backgroundColor: INSTRUMENT_COLORS[r.kind] }} />
 </div>
 </div>
 </td>
 </tr>
 );
}

function EngineBadge({ result, region }: { result: ReturnType<typeof runEngine> | null; region: Region }) {
 if (!result) return null;
 const label = `Computed by ${region}-default v1.0.0`;
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <Badge variant="outline" className="gap-1.5 cursor-help bg-[hsl(0_100%_40%)]/10 border-[hsl(0_100%_40%)]/40 text-[hsl(0_100%_40%)] " data-testid="badge-engine">
 <Cpu className="h-3 w-3" /> {label}
 </Badge>
 </TooltipTrigger>
 <TooltipContent className="max-w-md text-xs">
 <div className="font-semibold mb-1">Why this badge matters</div>
 <p className="mb-2 leading-relaxed">Every number on this page is computed live by a versioned, audited formula registry — not a copy-pasted spreadsheet. The badge tells you exactly which engine version, region pack, and formulas ran. If your auditor or an investor asks "how did you arrive at 6.82%?", the trace below is the answer.</p>
 <div className="font-semibold mb-1 mt-3">Engine trace</div>
 <ul className="space-y-0.5 max-h-48 overflow-y-auto">
 {result.trace.map((t, i) => (
 <li key={i} className="font-mono text-[10px]">
 <span className="text-emerald-400">{t.formulaId}</span> v{t.formulaVersion} · {t.region} · #{t.defHash.slice(0, 8)}
 </li>
 ))}
 </ul>
 <div className="mt-2 text-[10px] text-muted-foreground">
 {result.formulaIdsUsed.length} formulas · {result.trace.length} trace steps
 </div>
 </TooltipContent>
 </Tooltip>
 );
}

/* ---- AddSecurityDialog (defect 8) ---- */
function AddSecurityDialog({ companyId, onClose, onSuccess }: {
  companyId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<"safe" | "note" | "warrant" | "common" | "preferred">("safe");
  const [principal, setPrincipal] = useState("");
  const [terms, setTerms] = useState("");

  const addMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/companies/${companyId}/securities`, {
        kind, principal: Number(principal), terms,
      });
      return res.json();
    },
    onSuccess: () => onSuccess(),
    onError: (e: Error) => toast({ title: "Failed to add security", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add security</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Instrument type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="mt-1" data-testid="select-security-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">SAFE</SelectItem>
                <SelectItem value="note">Convertible Note</SelectItem>
                <SelectItem value="warrant">Warrant</SelectItem>
                <SelectItem value="common">Common</SelectItem>
                <SelectItem value="preferred">Preferred</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Principal / Investment amount (USD)</Label>
            <Input className="mt-1" type="number" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="500000" data-testid="input-security-principal" />
          </div>
          <div>
            <Label>Terms / notes (optional)</Label>
            <Textarea className="mt-1" rows={2} value={terms} onChange={e => setTerms(e.target.value)} placeholder="$5M cap, 20% discount…" data-testid="input-security-terms" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || !principal} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-add-security-confirm">
            {addMut.isPending ? "Adding…" : "Add security"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
