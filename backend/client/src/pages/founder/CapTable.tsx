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
 FileSpreadsheet, Send as SendIcon, X as XIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtNum, fmtUSD, fmtPct, fmtDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { runEngine, type ApiSecurity } from "@/lib/engineDemo";
import type { View, Region } from "@capavate/cap-table-engine";
/* v25.45.4 3c (APD-013) — Anti-Dilution UI control removed from /founder/captable.
   The anti-dilution math (applyBroadBasedWeightedAverage / applyFullRatchet /
   decimalToShares / Decimal) lives in the sacred cap-table engine and is NOT
   touched; only the unused/misplaced UI simulator + its engine imports are gone. */
import { GlossaryLink } from "@/components/Glossary";
import { useLocation } from "wouter"; /* v25.48.3 Q-F1 — redirect "Add security" to Rounds */
import { HelpTip } from "@/components/HelpTip";
import { MilestoneBroadcastPanel } from "@/components/founder/MilestoneBroadcastPanel";
import { currencySymbol } from "@/lib/currency";
import { MONEY_UNAVAILABLE } from "@/lib/moneyDisplay"; /* WAVE 55 · R6 */
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal"; /* WAVE 55b · OQ-3 */
import CapTableSnapshots from "@/components/founder/CapTableSnapshots"; /* W-CT — projected + previous snapshots */
import { CapTableInterim } from "@/components/founder/CapTableInterim"; /* W-CAP — interim (pro-forma) additive view */
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
import { isPhantomHolderRow } from "@/lib/captable/phantomHolder"; /* W-CAP LW-1 — phantom holder suppression */
/* WAVE 72 · DEFECT 2 — the ONE null-aware ownership formatter. `ownershipPercent`
   is `string | null` on the engine contract and `null` means UNDEFINED (0 ÷ 0,
   R47), not zero. Before this wave three consumers on this page did arithmetic on
   it first (`parseFloat(null)` → `NaN`) and rendered `NaN%`. */
import {
  ownershipPercentCellText, ownershipPercentBarWidth, sumOwnershipPercent,
  ownershipPercentForExport,
} from "@/lib/captable/ownershipPercent";
/* v25.45.4 3c (APD-013) — useEntitlement/evaluate import removed; they were only
   used to gate the now-removed Anti-Dilution control. */

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

/* W-FIX1c A5 (2026-07-19) — warrant EXERCISE affordance. A grant counts in
 * fully-diluted but had no way to actually ISSUE shares. This panel drives the
 * additive `/api/companies/:id/warrants/exercise` endpoint (preview → confirm);
 * all issuance flows through the SACRED commitFunded money path server-side. */
type ExerciseWarrant = { id?: string; holderName?: string; roundId?: string | null; investorId?: string | null; strike?: number | null; fmv?: number | null; shares?: number | null };
type ExercisePreview = { sharesIssued: string; cashPaid: string; ppsBasis: string; ledgerAmount: string };

function WarrantExercisePanel({ companyId, warrant, sym, onDone }: { companyId: string; warrant: ExerciseWarrant; sym: string; onDone: () => void }) {
 const { toast } = useToast();
 const [open, setOpen] = useState(false);
 const [mode, setMode] = useState<"cash" | "cashless" | "expire">("cash");
 const [qty, setQty] = useState<string>(String(warrant.shares ?? ""));
 const [fmv, setFmv] = useState<string>(warrant.fmv != null ? String(warrant.fmv) : "");
 const [preview, setPreview] = useState<ExercisePreview | null>(null);

 const disabledConfirm = !warrant.roundId || !warrant.investorId || (mode !== "expire" && (!qty || Number(qty) <= 0)) || (mode === "cashless" && (!fmv || Number(fmv) <= 0));

 async function post(body: Record<string, unknown>) {
  return (await apiRequest("POST", `/api/companies/${encodeURIComponent(companyId)}/warrants/exercise`, body)).json();
 }
 const previewM = useMutation({
  mutationFn: () => post({ roundId: warrant.roundId, investorId: warrant.investorId, quantity: qty, mode, fmv: fmv || undefined, preview: true }),
  onSuccess: (d: ExercisePreview) => setPreview(d),
  onError: () => toast({ variant: "destructive", title: "Preview failed", description: "Could not compute the exercise. Check the strike/FMV inputs." }),
 });
 const confirmM = useMutation({
  mutationFn: () => post({ roundId: warrant.roundId, investorId: warrant.investorId, quantity: qty, mode, fmv: fmv || undefined }),
  onSuccess: (d: { sharesIssued?: string; expired?: boolean }) => {
   toast({
    title: mode === "expire" ? "Warrant expired" : "Warrant exercised",
    description: mode === "expire" ? "No shares were issued." : `${fmtNum(Number(d?.sharesIssued ?? 0))} shares issued into the cap table.`,
   });
   setOpen(false); setPreview(null); onDone();
  },
  onError: (e: unknown) => {
   const msg = (e as { message?: string })?.message || "The exercise could not be recorded.";
   toast({ variant: "destructive", title: "Exercise failed", description: msg });
  },
 });

 return (
  <>
   <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" data-testid={`warrant-exercise-open-${warrant.id ?? "x"}`} onClick={() => { setOpen(true); setPreview(null); }}>Exercise</Button>
   <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null); }}>
    <DialogContent className="max-w-md">
     <DialogHeader><DialogTitle>Exercise warrant — {warrant.holderName ?? "Holder"}</DialogTitle></DialogHeader>
     <div className="space-y-3 text-xs">
      <div className="rounded-md border border-border/60 bg-secondary/30 p-2.5 space-y-1 text-muted-foreground">
       <p><span className="font-medium text-foreground">Cash exercise</span> — the holder pays <span className="font-mono">strike × quantity</span> and receives that many shares.</p>
       <p><span className="font-medium text-foreground">Cashless (net) exercise</span> — the holder pays nothing; they receive the NET shares <span className="font-mono">floor(qty × (FMV − strike) / FMV)</span>, surrendering the rest to cover the strike.</p>
       <p><span className="font-medium text-foreground">Expiry</span> — an unexercised warrant lapses and issues no shares.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 items-end">
       <div>
        <Label className="text-[11px]">Mode</Label>
        <Select value={mode} onValueChange={(v) => { setMode(v as typeof mode); setPreview(null); }}>
         <SelectTrigger className="h-8 text-xs" data-testid="warrant-exercise-mode"><SelectValue /></SelectTrigger>
         <SelectContent>
          <SelectItem value="cash">Cash exercise</SelectItem>
          <SelectItem value="cashless">Cashless (net)</SelectItem>
          <SelectItem value="expire">Expire (no shares)</SelectItem>
         </SelectContent>
        </Select>
       </div>
       {mode !== "expire" && (
        <div>
         <Label className="text-[11px]">Quantity</Label>
         <Input className="h-8 text-xs" type="number" min={0} value={qty} onChange={(e) => { setQty(e.target.value); setPreview(null); }} data-testid="warrant-exercise-qty" />
        </div>
       )}
       {mode === "cashless" && (
        <div className="col-span-2">
         <Label className="text-[11px]">Fair market value / share (FMV)</Label>
         <Input className="h-8 text-xs" type="number" min={0} step="0.01" value={fmv} onChange={(e) => { setFmv(e.target.value); setPreview(null); }} data-testid="warrant-exercise-fmv" />
        </div>
       )}
      </div>
      {(!warrant.roundId || !warrant.investorId) && (
       <p className="text-[11px] text-destructive">This warrant is missing a round or holder reference and cannot be exercised.</p>
      )}
      {preview && (
       <div className="rounded-md border border-border/60 p-2.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground" data-testid="warrant-exercise-preview">
        <span>Shares to issue</span><span className="font-mono text-right text-foreground">{fmtNum(Number(preview.sharesIssued))}</span>
        <span>Cash paid</span><span className="font-mono text-right">{sym}{Number(preview.cashPaid).toLocaleString()}</span>
        <span>Ledger amount</span><span className="font-mono text-right">{sym}{Number(preview.ledgerAmount).toLocaleString()}</span>
       </div>
      )}
     </div>
     <DialogFooter className="gap-2">
      {mode !== "expire" && (
       <Button variant="outline" size="sm" disabled={disabledConfirm || previewM.isPending} onClick={() => previewM.mutate()} data-testid="warrant-exercise-preview-btn">Preview</Button>
      )}
      <Button size="sm" className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" disabled={disabledConfirm || confirmM.isPending} onClick={() => confirmM.mutate()} data-testid="warrant-exercise-confirm-btn">
       {mode === "expire" ? "Record expiry" : "Confirm exercise"}
      </Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
  </>
 );
}

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
 // PF-1 null-guard: profileQ.data?.legal may be undefined for draft companies
 const liveRegion = profileQ.data?.legal?.region as Region | undefined;
 if (liveRegion && liveRegion !== region) setRegion(liveRegion);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [profileQ.data?.legal?.region]);
 const [, setLocation] = useLocation(); /* v25.48.3 Q-F1 — route "Add security" to Rounds */
 const [asOf, setAsOf] = useState<string>(new Date().toISOString().slice(0, 10));
 const [groupView, setGroupView] = useState(true);
 /* W-CAP (2026-07-17) — Committed (default) / Interim (pro-forma) toggle. Additive:
    "committed" preserves the EXISTING view unchanged; "interim" mounts the additive
    pro-forma projection alongside. No existing tile/chart/panel is removed. */
 const [captableMode, setCaptableMode] = useState<"committed" | "interim">("committed");
 /* v25.48.3 Q-F1 — cap table is view-only; the inline add-security dialog is no
    longer reachable (both entry points route to /founder/rounds). State kept as
    a permanently-false const so the dead dialog code below never mounts. */
 const [showAddSecurity, setShowAddSecurity] = useState(false);
 /* v25.45.4 3c (APD-013) — Anti-Dilution control removed (showAntiDil state +
    canAccessAntiDil entitlement gate deleted). Cap-table page is informative only. */
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
 // Wave B1 (3a) addendum — "Led by <Consortium Partner>" attribution, resolved
 // read-only from the additive /api/companies/:id/attribution endpoint (the
 // sacred company-profile endpoint is untouched).
 const attributionQ = useQuery<{ attributedPartner: { partnerId: string; name: string } | null }>({
   queryKey: ["/api/companies", companyId, "attribution"],
   queryFn: async () => (await apiRequest("GET", `/api/companies/${encodeURIComponent(companyId)}/attribution`)).json(),
   enabled: Boolean(companyId),
 });
 const attributedPartner = attributionQ.data?.attributedPartner ?? null;

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
 })
 /* W-CAP LW-1 (2026-07-17) — suppress the phantom demo "Other" holder (see
    isPhantomHolderRow). Real holders (any name, or any shares/invested) always
    render; the intelligence panel consumes this same filtered list. */
 .filter((r) => !isPhantomHolderRow(r));
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
 /* WAVE 72 · DEFECT 2 — `[null].join(",")` wrote an EMPTY cell, which reads as
    "the exporter lost it". An undefined percentage is stated as `—` instead. A
    real percentage still exports at FULL engine precision, unchanged. */
 ownershipPercentForExport(r.ownershipPercent),
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
 /* WAVE 72 · DEFECT 2 — as in exportCSV above. */
 ownershipPercentForExport(r.ownershipPercent),
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
 {/* Wave B1 (3a) — Consortium Partner leading this company's raise, when attributed. */}
 {attributedPartner?.name && (
   <Badge className="text-xs bg-[hsl(219_45%_20%)] text-white" data-testid="badge-led-by-partner">
     Led by {attributedPartner.name}
   </Badge>
 )}
 <Button variant="outline" onClick={exportCSV} data-testid="button-export-csv"><Download className="h-4 w-4 mr-2" /> CSV</Button>
 <Button variant="outline" onClick={exportPDFSnapshot} data-testid="button-export-pdf"><FileIcon className="h-4 w-4 mr-2" /> PDF snapshot</Button>
 <Button variant="outline" onClick={exportXLSX} data-testid="button-export-xlsx"><FileSpreadsheet className="h-4 w-4 mr-2" /> Excel</Button>
 {/* v25.45.4 3c (APD-013) — Anti-Dilution button removed (unused/misplaced control;
     cap-table page is informative only). Anti-dilution math remains in the sacred engine. */}
 <Button variant="outline" onClick={() => setShowBulkMsg(true)} data-testid="button-bulk-message"><SendIcon className="h-4 w-4 mr-2" /> Bulk message</Button>
 <Button variant="outline" onClick={exportPDFSnapshot} data-testid="button-print" className="hidden md:inline-flex"><Printer className="h-4 w-4 mr-2" /> Print</Button>
 {/* v25.48.3 Q-F1 — the cap table is VIEW-ONLY: equity originates through the
     round/ledger flow (cleaner audit trail), not ad-hoc on the cap table. This
     button now routes to Rounds instead of opening an inline add-security dialog. */}
 <Button onClick={() => setLocation("/founder/rounds")} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-add-security">
 <Plus className="h-4 w-4 mr-2" /> Add security in Rounds
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
 {/* W-CAP (2026-07-17) — Committed / Interim (pro-forma) toggle. Additive; committed is default. */}
 <div className="mb-4 print:hidden">
 <Tabs value={captableMode} onValueChange={(v) => setCaptableMode(v as "committed" | "interim")}>
 <TabsList data-testid="captable-mode-toggle">
 <TabsTrigger value="committed" data-testid="tab-captable-committed">Committed</TabsTrigger>
 <TabsTrigger value="interim" data-testid="tab-captable-interim">Interim (pro-forma)</TabsTrigger>
 </TabsList>
 </Tabs>
 </div>

 {captableMode === "interim" ? (
 <CapTableInterim companyId={companyId} />
 ) : (
 <>
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

 {/* W-CT — projected (pending) + previous (last committed) cap-table snapshots.
    Read-only; hidden when neither a pending round nor a prior committed snapshot exists. */}
 <CapTableSnapshots companyId={companyId} sym={sym} />

 {/* WAVE 16 ORP-044 — the founder-side surface for the milestone broadcast
    engine (server/milestoneBroadcastStore.ts:183,:196, registered at
    server/routes.ts:1271), which had no client caller anywhere in the tree.
    Placed here because recipients ARE the committed holders on this table. */}
 <MilestoneBroadcastPanel companyId={companyId} />

 {/* WAVE 55b · OQ-3 — A FAILED HOLDER LOAD IS NOT A CAP TABLE OF ZERO.
    `securities` feeds EVERY figure below: the four totals tiles, the option-pool
    card, the SAFEs/notes card, the warrants card and the holder table. When the
    query fails, `securities.data` is undefined, `rows` is `[]`, and this page
    rendered "Total shares 0", "Founder ownership 0.00%" and "None outstanding."
    — a load failure presented to the founder as the FACT that they own nothing.
    The PF-1 empty state below did not even appear (it required
    `securities.data !== undefined`), so no explanation reached the screen at all.

    SHAPE: the shared `LoadFailedRefusal` (16 existing call sites), placed as a
    SIBLING immediately above the totals so the refusal cannot be read past. NO
    control, tile, card, panel or row is removed — the empty-state Card, the
    as-of picker, the region select, the mode toggle, the export buttons and the
    holder table all still mount. The zero-claims below are re-gated on
    `isSuccess` (NOT `!isLoading && !isError`, which is still true for a PAUSED
    offline query) and each falls back to the em-dash this file already uses for
    "not known" (:583-:586, and `MONEY_UNAVAILABLE` from WAVE 55 · R6). No
    percentage's units are altered (R16): every happy-path expression is
    byte-identical and only its guard changes. */}
 {securities.isError && (
 <div className="mb-6" data-testid="captable-holders-error-wrap">
 <LoadFailedRefusal
 what="your cap table holders"
 testId="founder-captable-holders-error"
 onRetry={() => void securities.refetch()}
 isRetrying={securities.isFetching}
 />
 </div>
 )}

 {/* Totals */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
 {/* WAVE 55b · OQ-3 — the tiles are the loudest claim on the page. Each
     happy-path expression is UNCHANGED and merely guarded on `isSuccess`; the
     unknown branch is the em-dash already used at :583-:586 of this file, so no
     percentage's units, denominator or rounding is altered (R16) and no new
     percentage site is introduced. */}
 {/* WAVE 61a · R47 — THE FABRICATED DENOMINATOR IS GONE.
     `Math.max(1, totalSharesNum)` invented a denominator of 1 so that a cap
     table with genuinely ZERO shares printed a confident `0.00%` for a ratio
     that is mathematically UNDEFINED (0/0). The guard existed to avoid NaN; it
     converted *undefined* into *zero*, which is a different claim. The three
     ownership tiles now refuse with the em-dash this file already uses when
     `totalSharesNum === 0`, and the `Math.max` is REMOVED rather than papered
     over — NaN stays impossible because the `> 0` test now gates the division.
     For every totalSharesNum > 0 the expression is arithmetically identical to
     before (Math.max(1, n) === n for n > 0), so no percentage's units,
     denominator or rounding moves (R16).
     `Total shares` is DELIBERATELY UNCHANGED: a share count of zero is a fact,
     and only the percentages are undefined (R47, owner).
     The Wave 55b `securities.isSuccess` load-failure gate is PRESERVED, not
     re-fixed — this adds the genuine-zero case alongside it.
     The `hint` is left byte-identical on purpose: `0 shares` is a true fact and
     em-dashing it would drop information the page legitimately has. */}
 <Stat label="Total shares" value={securities.isSuccess ? fmtNum(totalSharesNum) : MONEY_UNAVAILABLE} hint={view === "basic" ? "Basic view" : view === "fully_diluted" ? "Fully diluted" : "As-converted"} icon={Layers} testid="stat-total-shares" />
 <Stat label="Founder ownership" value={securities.isSuccess && totalSharesNum > 0 ? fmtPct((founderSharesNum / totalSharesNum) * 100, 2) : MONEY_UNAVAILABLE} hint={securities.isSuccess ? `${fmtNum(founderSharesNum)} shares` : MONEY_UNAVAILABLE} icon={PieIcon} testid="stat-founders" />
 <Stat label="Investor ownership" value={securities.isSuccess && totalSharesNum > 0 ? fmtPct((investorSharesNum / totalSharesNum) * 100, 2) : MONEY_UNAVAILABLE} hint={securities.isSuccess ? `${fmtNum(investorSharesNum)} shares` : MONEY_UNAVAILABLE} icon={TrendingUp} testid="stat-investors" />
 <Stat label="Option pool" value={securities.isSuccess && totalSharesNum > 0 ? fmtPct((optionSharesNum / totalSharesNum) * 100, 2) : MONEY_UNAVAILABLE} hint={securities.isSuccess ? `${fmtNum(optionSharesNum)} options` : MONEY_UNAVAILABLE} icon={PieIcon} testid="stat-options" />
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
 ) : securities.isSuccess ? <span className="text-muted-foreground">No option pool reserved.</span> : <span className="text-muted-foreground">Option pool not loaded.</span>}
 </CardContent>
 </Card>

 <Card data-testid="card-convertibles">
 <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">SAFEs + Notes outstanding <HelpTip>Running balance of every unconverted SAFE and convertible note (principal + accrued interest).</HelpTip></CardTitle></CardHeader>
 <CardContent className="text-xs space-y-1.5">
 {!securities.isSuccess ? (
 <span className="text-muted-foreground">SAFEs and notes not loaded.</span>
 ) : notesAndSafes.length === 0 ? (
 <span className="text-muted-foreground">None outstanding.</span>
 ) : notesAndSafes.map((s) => (
 <div key={s.id} className="border-b border-border/60 pb-1.5 last:border-0">
 <div className="flex justify-between"><span className="font-medium">{s.holderName}</span><Badge variant="outline" className="text-[10px] capitalize">{s.instrument}</Badge></div>
 <div className="flex justify-between text-muted-foreground">
 <span>Principal</span>
 {/* WAVE 55 · R6 — the principal coalesced its own input to zero,
     printing the currency symbol against a 0 for a note whose principal is
     not recorded at all. No unit conversion is introduced: the happy-path
     expression is unchanged and these columns stay MAJOR units (R16).
     A genuine 0 principal still renders "<sym>0". */}
 <span className="font-mono tabular-nums">{s.investmentAmount == null ? MONEY_UNAVAILABLE : `${sym}${s.investmentAmount.toLocaleString()}`}</span>
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
 {!securities.isSuccess ? (
 <span className="text-muted-foreground">Warrants not loaded.</span>
 ) : warrants.length === 0 ? (
 <span className="text-muted-foreground">None outstanding.</span>
 ) : warrants.map((w) => {
 const remainingYrs = w.expiry ? ((new Date(w.expiry).getTime() - Date.now()) / (365.25 * 86400000)) : null;
 const intrinsic = w.fmv != null && w.strike != null ? Math.max(0, (w.fmv - w.strike) * (w.shares ?? 0)) : null;
 return (
 <div key={w.id} className="border-b border-border/60 pb-1.5 last:border-0">
 <div className="flex justify-between items-center gap-2"><span className="font-medium">{w.holderName}</span><div className="flex items-center gap-1.5"><Badge variant="outline" className="text-[10px]">{fmtNum(w.shares)} sh</Badge>{companyId && <WarrantExercisePanel companyId={companyId} warrant={w} sym={sym} onDone={() => { queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "securities"] }); queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "cap-table"] }); }} />}</div></div>
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

 {/* PF-1 empty state — rendered when data loaded but cap table is empty.
     WAVE 55b · OQ-3 — re-gated from `!isLoading && data !== undefined` to
     `isSuccess`. The copy, the icon, the button and the testid are BYTE-IDENTICAL:
     a genuinely empty cap table still says "No securities recorded yet." A PAUSED
     (offline) query is neither loading nor errored and used to be able to reach
     this branch as soon as any stale data existed. */}
 {securities.isSuccess && rows.length === 0 && (
 <Card className="mb-6" data-testid="captable-empty-state">
 <CardContent className="py-16 text-center">
 <Layers className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
 <p className="text-sm font-medium text-muted-foreground">No securities recorded yet.</p>
 <p className="text-xs text-muted-foreground mt-1">Securities are created through your funding rounds. Start a round to build your cap table.</p>
 {/* v25.48.3 Q-F1 — view-only cap table; route to Rounds to originate equity. */}
 <Button className="mt-4 bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" onClick={() => setLocation("/founder/rounds")}>
 <Plus className="h-4 w-4 mr-2" /> Go to Rounds
 </Button>
 </CardContent>
 </Card>
 )}

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
 /* WAVE 71 · D18 — `ownershipPercent` is now `string | null` and `null` means the
 denominator was zero (0 ÷ 0, undefined — owner ruling R47). It is NOT read as 0:
 the bar gets no width and the tooltip says so, so an empty cap table cannot render
 a confident 0.00% stripe. This is the same honesty the `totalSharesNum > 0` gate
 already gives the three ownership tiles; it is now structural here too. */
 style={{ width: r.ownershipPercent === null ? "0%" : `${parseFloat(r.ownershipPercent)}%`, backgroundColor: INSTRUMENT_COLORS[r.kind] || "hsl(0 0% 50%)" }}
 title={r.ownershipPercent === null
 ? `${r.holderName} — ownership is undefined: this cap table has zero shares, and a percentage of zero shares is undefined, not zero`
 : `${r.holderName} — ${parseFloat(r.ownershipPercent).toFixed(2)}% of fully-diluted shares`} /* WAVE 52c B6 — a percentage without its denominator is a defect (§10 item 5). */
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
 {/* ═══════════════════════════════════════════════════════════
     WAVE 58d · B3 — THE DENOMINATOR IN FORCE, BY NAME AND BY COMPONENT.
     ═══════════════════════════════════════════════════════════
     THE REVIEW'S CLAIM, AND THE CORRECTION. `W58B_REVIEW_1_MATH.md` §2.5 graded
     the caption above a "high-severity denominator misstatement", on the ground
     that the engine does not implement As-Converted and Fully-Diluted distinctly:
     "Both `fully_diluted` and `as_converted` include the same common, preferred,
     option and warrant rows · `computeCapTable` passes `estimatedPps: undefined`
     · On normal inputs, Fully Diluted and As-Converted are therefore identical."

     THAT IS REFUTED BY EXECUTION. This screen does not call `computeCapTable`; it
     calls `runEngine` in `shared/roundMathEngineAdapter.ts`, which PRE-CONVERTS
     SAFEs and notes into synthetic common issuances before the engine runs
     whenever the view is `as_converted` (the "Sprint 4 — As-Converted SAFE
     roll-up" block, added precisely because `estimatedPps` is undefined). Run on a
     populated ledger — 6,000,000 common + 2,000,000 preferred + 1,000,000 options
     + 500,000 warrants + a $250,000 SAFE + a $150,000 note, both at an $8,000,000
     cap with a 0.2 discount (`build_log/wave58cd/probe_views_output.txt`):

       basic          8,000,000 · 2 rows   (common + preferred only)
       fully_diluted  9,500,000 · 4 rows   (+ options + warrants)
       as_converted   9,975,000 · 6 rows   (+ SAFE 296,875 + note 178,125)

     Three different denominators, three different row sets, three different
     percentages for the same holder. The caption is TRUE. Review 1 read the
     engine package and missed the adapter layer between it and this screen.

     WHAT WAS GENUINELY WRONG, AND IS FIXED HERE: the definition was never stated
     on screen, and Capavate's "Fully Diluted" is NARROWER than the market term —
     Carta and Wilson Sonsini both include convertibles as-converted in "fully
     diluted", which is Capavate's As-Converted view. An unstated fully-diluted
     definition is the most common source of cap-table disputes, so each view now
     names its own denominator, component by component, including what it EXCLUDES
     and where it departs from the market term. Derived from the selected view, not
     hardcoded per screen (R21). */}
 <div className="mt-2 rounded-md border border-border bg-secondary/30 p-3 text-xs leading-relaxed space-y-1" data-testid="captable-denominator-definition">
 <div className="font-medium text-foreground">
 Denominator in force on this view: <span className="font-mono" data-testid="captable-denominator-view">{view}</span> — {fmtNum(totalSharesNum)} shares
 </div>
 <div data-testid="captable-denominator-includes">
 <span className="font-medium">Includes:</span> {DENOMINATOR_DEFINITION[view].includes}
 </div>
 <div data-testid="captable-denominator-excludes">
 <span className="font-medium">Excludes:</span> {DENOMINATOR_DEFINITION[view].excludes}
 </div>
 <div className="text-muted-foreground" data-testid="captable-denominator-authority">
 {DENOMINATOR_DEFINITION[view].authority}
 </div>
 </div>
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
 Computed by the cap-table engine. Source-of-truth ledger; SAFEs use post-money cap conversion.
 The as-converted view applies each instrument’s own cap and discount. New to a term? <span className="inline-flex align-middle"><GlossaryLink size="xs" /></span> for plain definitions.
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
 </>
 )}
 </PageBody>

 {/* v25.45.4 3c (APD-013) — Anti-dilution simulator dialog removed. */}

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

// v25.45.4 3c (APD-013) — Anti-dilution simulator dialog removed (unused/misplaced
// UI control). Anti-dilution math remains in the sacred cap-table engine.

// Sprint 11 D3 — Bulk message dialog. Pre-fills recipient list with all current cap-table holders.
// Sprint 19 H — send() now calls POST /api/founder/investor-crm/broadcast and invalidates /api/comms/channels.
function BulkMessageDialog({ open, onClose, rows, toast }: { open: boolean; onClose: () => void; rows: any[]; toast: ReturnType<typeof useToast>["toast"] }) {
 const [subject, setSubject] = useState("Quarterly cap-table broadcast");
 const [body, setBody] = useState("");
 const [isSending, setIsSending] = useState(false);
 const holders = Array.from(new Set(rows.map((r: any) => r.holderName))).slice(0, 50);
 // Derive investor ids: use investorUserId field or fall back to holderName slug.
 const recipientIds = Array.from(new Set(
 rows.map((r: any) => r.investorUserId ?? (r.holderName ?? "").toLowerCase().replace(/\s+/g, "_")) /* v25.45.4 B-1 — defensive: holderName may be undefined on production rows */
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
 {holders.map(h => <Badge key={h} variant="outline" className="text-[10px]" data-testid={`badge-recipient-${(h ?? "").replace(/\s/g, '-')}`}>{h}</Badge>)}
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
 <th className="text-right font-medium px-3 py-2.5 w-44">% on view<span className="ml-1 font-normal normal-case text-muted-foreground">of fully-diluted</span></th>
 </tr>
 </thead>
);

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 58b · DEFECT 6 — THE DISPLAYED TOTAL IS DERIVED, NOT ASSERTED.
 * ══════════════════════════════════════════════════════════════════════════
 * BEFORE: each row printed `parseFloat(r.ownershipPercent).toFixed(2)` — rounded
 * INDEPENDENTLY — while the total row printed the LITERAL STRING `100.00%`. The
 * exact ratios do sum to 100%, but their 2dp roundings need not: three equal
 * holders each display 33.33%, summing to 99.99% under a printed 100.00%.
 * Reproduced exactly in `build_log/wave58b/w58b_exact_math.py` (final section).
 *
 * A hardcoded total is a CLAIM about the rows above it. If it does not equal them
 * it is false, and the reader has no way to tell which of the two to trust. So the
 * total is now the SUM OF THE DISPLAYED ROW VALUES — arithmetic a reader can
 * repeat with their finger — and when that sum is not exactly 100.00% the
 * rounding residual is stated beside it rather than papered over.
 *
 * WHY NOT "reconcile the rows" (push the residual onto the largest holder)?
 * Because that prints a percentage for a specific NAMED holder that is not that
 * holder's ownership. On a cap table a per-holder figure has to be that holder's
 * own figure; the residual belongs to the total, where it is a rounding artefact
 * and not a claim about anybody's stake.
 *
 * The EXACT total is unchanged and remains 100%. This is a display fix; the
 * exact-ratio invariant is separately asserted by
 * `packages/cap-table-engine/test/property/ownership-sums-100.test.ts`. */
/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58c · A4 — AN EMPTY CAP TABLE MUST NOT ASSERT A TOTAL OF 100%.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT (`W58B_REVIEW_3_RISK.md` §5.3): with ZERO rows — which is EVERY
 * company on live (`LIVE_AUDIT_2026_08_15.md`: "TOTAL SHARES 0 · 0 rows") — the
 * basis-point sum is 0, so `exact` is false and the Total cell renders `0.00%`
 * underneath the note "rows shown to 2dp; exact total is 100%". The screen
 * contradicts itself, beside an empty-state card reading "No securities recorded
 * yet", on the most-viewed screen in the product.
 *
 * `empty` is returned as its own state rather than inferred from `sum === "0.00"`,
 * because a populated table CAN legitimately sum to 0.00% (every holder below
 * half a basis point), and that case is a rounding note, not an empty table. The
 * two are different facts and are reported differently.
 */
/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 72 · DEFECT 2 — AN UNDEFINED TOTAL IS ITS OWN STATE, AND IT IS NOT 0.00%.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, reproduced by final review 1 §5 and re-executed in
 * `build_log/wave72/scratch/p6_ui_before.mts`: this function read
 * `parseFloat(String(r.ownershipPercent ?? "0"))`. On a POPULATED zero-share view
 * every row's `ownershipPercent` is `null` (0 ÷ 0 — the engine's D18 contract), so
 * `?? "0"` turned every undefined ratio into a confident zero, `bpsSum` came out
 * `0`, `empty` was FALSE because rows existed, and the footer therefore printed
 * `0.00%` under the note "rows shown to 2dp; exact total is 100%". Two false
 * claims in one cell: a 0% total and an assertion that the exact total is 100%.
 *
 * `?? "0"` IS THE DEFECT AND IT IS GONE (R54). The display layer already refuses
 * undefined values; that coercion was the only reason it could not. `undefinedTotal`
 * is returned as its own state — exactly as Wave 58c returned `empty` as its own
 * state rather than inferring it from `sum === "0.00"` — because a populated table
 * CAN legitimately sum to 0.00% (every holder below half a basis point) and that is
 * a rounding note, not an undefined total. Three different facts, three states.
 *
 * `exact` can never be true when the total is undefined: there is no set of rows
 * reconciling to 100% when the denominator does not exist. */
export function displayedOwnershipTotal(rows: Array<{ ownershipPercent?: string | number | null }>): {
  /** As displayed — or `—` (R47) when the total is undefined. */
  readonly sum: string;
  readonly exact: boolean;
  /** No rows at all — there is nothing to total, which is not a 0% claim. */
  readonly empty: boolean;
  /** Rows exist but at least one ownership percentage is UNDEFINED (0 ÷ 0). */
  readonly undefinedTotal: boolean;
} {
  const empty = rows.length === 0;
  /* Summed AS DISPLAYED, and only when every member is defined. `sumOwnershipPercent`
     returns `null` the moment one row's percentage is undefined, so no undefined
     ratio is ever added in as a zero. */
  const defined = sumOwnershipPercent(rows);
  if (!empty && defined === null) {
    return { sum: OWNERSHIP_UNDEFINED_TOTAL, exact: false, empty: false, undefinedTotal: true };
  }
  /* `Math.round(v * 100)` reproduces `toFixed(2)` for the magnitudes on a cap
     table, and the accumulation is in integer basis points so the addition itself
     introduces no new floating-point error. */
  const bpsSum = rows.reduce<number>((acc, r) => {
    const v = parseFloat(String(r.ownershipPercent));
    return acc + (Number.isFinite(v) ? Math.round(v * 100) : 0);
  }, 0);
  /* An empty table cannot be "exact": there is no set of rows reconciling to
     100%. Stated here so no caller can read `exact` as a claim about nothing. */
  return { sum: (bpsSum / 100).toFixed(2), exact: !empty && bpsSum === 10000, empty, undefinedTotal: false };
}

/** R47 — an undefined total renders as an em dash, never as `0.00` or `NaN`. */
const OWNERSHIP_UNDEFINED_TOTAL = "—";

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58d · B3 — ONE DEFINITION PER VIEW, WRITTEN OUT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Every component listed here was READ OFF AN EXECUTED ENGINE RUN, not off a
 * source comment — `build_log/wave58cd/probe_views_output.txt` prints the row set
 * and the total for each of the three views on one populated ledger.
 *
 * The "departs from the market term" sentences are the point of the exercise: a
 * fund's counsel reading "fully diluted" expects convertibles counted
 * as-converted (Carta; Wilson Sonsini ECVC), which in Capavate is the
 * AS-CONVERTED view. Saying so on screen is cheaper than arguing about it after a
 * term sheet is signed. */
const DENOMINATOR_DEFINITION: Record<View, { includes: string; excludes: string; authority: string }> = {
  basic: {
    includes: "issued common shares and issued preferred shares, at their stated share counts.",
    excludes:
      "the option plan (granted options AND the unallocated reserve), warrants' underlying shares, unconverted " +
      "SAFEs and notes, and unissued authorised (charter) capital.",
    authority:
      "This is an OUTSTANDING (issued-shares) basis. It is NOT a fully-diluted figure and must not be quoted as " +
      "one in a term sheet — fully-diluted percentages are always lower.",
  },
  fully_diluted: {
    includes:
      "issued common + issued preferred + ALL option-plan shares (granted options and the unallocated reserve " +
      "together — Capavate's data model cannot separate them) + warrants' underlying shares.",
    excludes:
      "unconverted SAFEs and notes (they hold no shares until they convert), and unissued authorised (charter) " +
      "capital, which Capavate never treats as a denominator.",
    authority:
      "NARROWER THAN THE MARKET TERM, stated deliberately: Carta and Wilson Sonsini both count convertible " +
      "securities as-converted inside “fully diluted”. In Capavate that is the As-Converted view. If your term " +
      "sheet defines fully-diluted capitalisation to include SAFEs and notes, read As-Converted, not this view.",
  },
  as_converted: {
    includes:
      "everything in Fully Diluted, PLUS SAFEs and notes converted to common-equivalent shares at the lower of " +
      "the cap-implied price and (last priced-round price × (1 − discount)).",
    excludes:
      "unissued authorised (charter) capital. Nothing else outstanding is left out.",
    authority:
      "This is the basis that matches the market phrase “fully diluted capitalisation” in NVCA-style documents " +
      "(Carta; Wilson Sonsini ECVC). The conversion prices are ILLUSTRATIVE until a priced round actually " +
      "closes — the engine reconciles to the share at close. " +
      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 70 · D4 / D5 — WHAT THIS SENTENCE USED TO LEAVE OUT.
         ═══════════════════════════════════════════════════════════════════════
         “ILLUSTRATIVE” was true and insufficient. The three material things it
         did not disclose were the ones that moved the number:
           1. a HARDCODED $1.00 per share was used when no priced round existed;
           2. the cap was applied on a PRE-money basis here and a post-money basis
              at close;
           3. a convertible note's ACCRUED INTEREST was omitted entirely.
         On the documented fixture that made a SAFE 2,500,000 shares here and
         2,250,000 at close, a note 588,235 here and 397,741 at close, and founder
         ownership 66.180…% here against 51.512…% at close. All three are fixed
         (this view now calls the engine's own conversion), and what remains
         genuinely uncertain is stated instead of implied. */
      "This view now uses the SAME conversion the engine performs at close — the same post-money cap " +
      "re-basing, the same accrued interest on notes, and the same exact-decimal arithmetic — so the " +
      "figures here and on the Projection are produced by one computation, not two. Two things still make it " +
      "an estimate rather than a fact: the round price used is the LAST PRICED ROUND’S price, not the price " +
      "of a round that has not happened; and where a SAFE’s cap convention is not recorded it is read as " +
      "POST-MONEY (YC SAFE v1.2, the market standard), which issues MORE shares to the SAFE holder than a " +
      "pre-money SAFE on identical terms. If no priced round exists at all, Capavate REFUSES to compute this " +
      "view rather than assume a price for it.",
  },
};

function FlatHoldings({ rows, sym, totalSharesNum, totalInvested, viewerId }: { rows: any[]; sym: string; totalSharesNum: number; totalInvested: number; viewerId: string }) {
 const displayedTotal = displayedOwnershipTotal(rows);
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
 {/* ═════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 6 — DERIVED FROM THE ROWS ABOVE, NEVER ASSERTED.
     ═════════════════════════════════════════════════════════════
     TWO GUARD IDENTITIES WERE RESTORED HERE RATHER THAN ALLOWLISTED (R28):
       1. panel `td | at=FlatHoldings:table>tbody>tr#4 | child=#text#1` — the cell
          still has a DIRECT text child (the `%` after the derived number), so the
          membership record is unchanged.
       2. copy `100.00%` — the literal string still exists, but it is now rendered
          ONLY WHEN IT IS TRUE: in the `exact` branch, where the displayed rows do
          sum to 100.00%. That is the whole distinction this defect turns on. It
          sits in a screen-reader-only span so an assistive-technology user is told
          the rows reconcile, which is the same fact the sighted reader gets from
          seeing the derived number read 100.00.
     R28's standard is that a recoverable identity is RESTORED, not excused, and
     both of these were recoverable, so no allowlist entry was requested. */}
 {/* NOTE ON WHY THE `data-testid` IS ON THE SPAN AND NOT ON THIS `<td>`:
     `scripts/silent-drop-guard/extract-inventory.ts::containerIdentity` prefers a
     `data-testid` over the positional `at=...#ord` key, so adding one to this cell
     RENAMED its guard identity from
     `td | at=FlatHoldings:table>tbody>tr#4 | child=#text#1` to a testid-keyed one,
     and the guard correctly reported the old identity as DISAPPEARED. That is a
     recoverable identity, so under R28 it is RESTORED rather than allowlisted: the
     cell keeps its positional identity and its direct `#text` child (the `%`), and
     the test hook moves one level in. Verified by re-running `npm run guard`. */}
 <td className="px-3 py-3 text-right font-mono tabular-nums">
 <span data-testid="captable-flat-total-percent">{displayedTotal.sum}</span>%
 <span className="sr-only"> of fully-diluted shares, summed from the rows above exactly as they are displayed</span>
 {/* WAVE 58c · A4 — THE EMPTY BRANCH COMES FIRST. Neither the "exact total is
     100%" note nor the sr-only `100.00%` may be printed for a table with no
     rows: both are claims about rows that do not exist. The cell keeps its
     direct `#text` child (the `%`) and its positional guard identity, so this
     is one added condition and no identity moves (R28). */}
 {displayedTotal.empty ? (
 <span className="block font-normal text-[9px] text-muted-foreground" data-testid="captable-flat-total-empty-note">no securities recorded on this view — there is nothing to total, and this is not a 0% ownership figure</span>
 ) : displayedTotal.undefinedTotal ? (
 /* WAVE 72 · DEFECT 2 — SECOND, FOR THE SAME REASON THE EMPTY BRANCH IS FIRST.
    On a populated view whose total shares are zero, every row's ownership is
    UNDEFINED (0 ÷ 0, R47), so neither the sr-only `100.00%` nor the note "exact
    total is 100%" may print: both are claims about a total that does not exist.
    This is the Wave 58c/58d contradiction, one branch over — it is refused here
    rather than allowed to reappear. */
 <span className="block font-normal text-[9px] text-muted-foreground" data-testid="captable-flat-total-undefined-note">this view holds 0 shares in total, so each holder's share of it is undefined — not 0% — and there is no exact total to state</span>
 ) : displayedTotal.exact ? (
 <span className="sr-only" data-testid="captable-flat-total-exact">100.00%</span>
 ) : (
 <span className="block font-normal text-[9px] text-muted-foreground" data-testid="captable-flat-total-rounding-note">rows shown to 2dp; exact total is 100%</span>
 )}
 </td>
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
 /* WAVE 72 · DEFECT 2 — was `reduce((s, r) => s + parseFloat(r.ownershipPercent), 0)`,
    which produced `NaN` from the first undefined row and rendered `NaN%` as this
    group's subtotal. `null` now propagates and the cell says the subtotal is
    undefined instead of inventing one. */
 const groupPct = sumOwnershipPercent(groupRows);
 const groupInvested = groupRows.reduce((s, r) => s + (parseFloat(r.invested ?? "0") || 0), 0);
 return (
 <React.Fragment key={`grp-frag-${g.key}`}>
 <tr className={`border-y border-border ${g.tone}`} data-testid={`group-${g.key}`}>
 <td colSpan={6} className="px-4 py-2 font-semibold uppercase tracking-wide text-[10px]">{g.label} <span className="ml-2 text-muted-foreground normal-case">{groupRows.length} holder{groupRows.length === 1 ? "" : "s"}</span></td>
 <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{fmtNum(Number(groupShares))}</td>
 <td />
 <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{groupInvested ? `${sym}${Math.round(groupInvested).toLocaleString()}` : "—"}</td>
 <td colSpan={2} />
 <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">{ownershipPercentCellText(groupPct)}%<span className="sr-only"> of fully-diluted shares on the selected view</span></td>
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
 <TooltipContent className="text-xs"><div className="font-semibold">{round.name}</div><div className="text-muted-foreground capitalize">{(round.type ?? "").replace(/_/g, " ")} · {fmtDate(round.closeDate ?? null)}</div></TooltipContent>
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
 {/* WAVE 72 · DEFECT 2 — THE CELL THAT RENDERED `NaN%`. It was
     `{parseFloat(r.ownershipPercent).toFixed(2)}%`, and on a populated zero-share
     view `parseFloat(null)` is `NaN`, `NaN.toFixed(2)` is the string "NaN", so a
     real holder's row read `NaN%`. It now renders `—` for an undefined ratio and
     `0.00` for a genuine zero. The `%` stays a DIRECT text child of this div and
     the sr-only span stays beside it, so the guard's baselined child shape for
     this cell does not move (the same care RoundDetail's cell took). */}
 <div className="font-mono tabular-nums w-14 text-right">{ownershipPercentCellText(r.ownershipPercent)}%<span className="sr-only"> of fully-diluted shares</span></div>
 <div className="h-1.5 rounded-full bg-secondary w-24 overflow-hidden">
 <div className="h-full" style={{ width: ownershipPercentBarWidth(r.ownershipPercent), backgroundColor: INSTRUMENT_COLORS[r.kind] }} />
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
