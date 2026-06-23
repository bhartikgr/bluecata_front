import { asArray } from "@/lib/safeArray";
/**
 * Sprint 6 — TermSheet.tsx
 *
 * Three states for a round's term sheet:
 * 1. Generate / Upload (no draft yet)
 * 2. Edit / Review (a draft exists)
 * 3. Signed + Send (locked, hash + signature emitted)
 *
 * Plus an "Upload + reconcile" alternative path that uploads a PDF/DOCX,
 * extracts headline terms server-side, diffs them against the round's terms,
 * and forces the founder to acknowledge each mismatch before signing.
 *
 * The signed term sheet writes a `termsheet.signed` telemetry event and is
 * surfaced in RoundDetail's Documents tab.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip } from "@/components/HelpTip";
import {
 AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileText, Lock,
 Printer, ScrollText, Send, ShieldCheck, Sparkles, Upload, X, Users,
} from "lucide-react";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { emit } from "@/lib/sprint3";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

import { sha256 } from "@capavate/cap-table-engine";
import { signSES, captureSessionMetadata } from "@/lib/esign/ses";
import {
 getTemplate, reconcileTerms,
 type ReconciliationDiff,
} from "@/lib/termsheet/templates";
import type { TermSheetData, Region, InstrumentValue, ClauseDescription } from "@/lib/termsheet/types";
import { useTermSheetStore, type SectionDraft, type TermSheetRecord } from "@/lib/termsheet/store";
import { CONSORTIUM_PARTNERS, partnersByRegion, type Region as PartnerRegion } from "@/lib/partners";
import { CAPAVATE_LOGO_URL } from "@/components/CapavateLogo";

type Round = {
 id: string; company: string; name: string; type: string; state: string;
 targetAmount: number; raisedAmount: number; preMoney: number; postMoney: number;
 pricePerShare: number; minTicket: number; closeDate: string; openDate?: string;
 termsSummary: string; leadInvestor?: string; investorCount?: number;
 currency?: string; region?: string;
};
type Invitation = { id: string; investorEmail: string; investorName: string; state: string };

const REGION_INSTRUMENT_BY_TYPE: Record<string, InstrumentValue> = {
 preseed: "safe_post",
 seed: "preferred",
 series_a: "preferred",
 series_b: "preferred",
 series_c: "preferred",
 bridge: "convertible_note",
 foundation: "common",
};

function inferData(r: Round): TermSheetData {
 return {
 companyName: r.company ?? "Company",
 companyLegalName: `${r.company ?? "Company"}, Inc.`,
 roundName: r.name,
 roundType: r.type,
 region: (r.region ?? "US") as Region,
 instrument: REGION_INSTRUMENT_BY_TYPE[r.type] ?? "preferred",
 leadInvestor: r.leadInvestor ?? "[Lead Investor]",
 targetAmount: r.targetAmount,
 preMoney: r.preMoney,
 postMoney: r.postMoney,
 pricePerShare: r.pricePerShare,
 fdSharesPreMoney: 12_500_000,
 liqPrefMultiple: 1,
 participating: false,
 capParticipation: "non-participating",
 antiDilutionVariant: "broad_based_wa",
 valuationCap: r.preMoney,
 discount: 20,
 interestRate: 6,
 maturityMonths: 24,
 mfn: true,
 poolSize: 10,
 poolTiming: "post_money",
 vestingMonths: 48,
 cliffMonths: 12,
 closeDate: r.closeDate,
 founderNames: [], // filled dynamically from me query
 governingLaw: r.region ?? "US",
 };
}

const REGIONS: Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"];
const INSTRUMENT_OPTIONS: { value: InstrumentValue; label: string }[] = [
 { value: "preferred", label: "Preferred Shares (Priced)" },
 { value: "safe_post", label: "SAFE — Post-Money Cap" },
 { value: "safe_pre", label: "SAFE — Pre-Money Cap" },
 { value: "convertible_note", label: "Convertible Note" },
 { value: "common", label: "Common Shares" },
 { value: "warrant", label: "Warrants" },
 { value: "option_pool", label: "Option Pool" },
];

export default function TermSheet() {
 const params = useParams<{ id: string }>();
 const id = params.id ?? "rnd_pre";
 const [location] = useLocation();
 const queryString = location.includes("?") ? location.split("?")[1] : "";
 const initialAction = new URLSearchParams(queryString).get("action") ?? "";
 const { toast } = useToast();
 const companyId = useActiveCompanyId();
 const me = useQuery<{ id: string; displayName: string; role: string }>({ queryKey: ["/api/auth/me"] });

 const round = useQuery<Round>({ queryKey: ["/api/rounds", id] });
 const invs = useQuery<Invitation[]>({ queryKey: [`/api/rounds/${id}/invitations`] });

 const stored = useTermSheetStore((s) => s.termSheets[id]);
 const saveTermSheet = useTermSheetStore.getState().saveTermSheet;
 const addConsortium = useTermSheetStore.getState().addConsortium;

 // Sprint 26 — credentialed server-side revision tracking.
 const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
 const [lastSaveError, setLastSaveError] = useState<string | null>(null);
 const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

 // Load the latest server-saved revision on mount; merge into local store if newer.
 const serverRevision = useQuery<{ ok: boolean; revision?: { revision: number; payload: TermSheetRecord; revisionHash: string; savedAt: string; savedBy: string; prevRevisionHash: string } }>({
 queryKey: [`/api/founder/term-sheets/${id}`],
 retry: false,
 });
 // When the server has a newer revision than what's local, hydrate the local store.
 useEffect(() => {
 const sv = serverRevision.data;
 if (!sv?.ok || !sv.revision) return;
 const incoming = sv.revision.payload as TermSheetRecord;
 const localRev = stored?.revision ?? 0;
 if (sv.revision.revision > localRev) {
 saveTermSheet({
 ...incoming,
 roundId: id,
 revision: sv.revision.revision,
 revisionHash: sv.revision.revisionHash,
 prevRevisionHash: sv.revision.prevRevisionHash,
 savedAt: sv.revision.savedAt,
 savedBy: sv.revision.savedBy,
 });
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [serverRevision.data]);

 // Credentialed save — POSTs to the new endpoint, returns the new revision.
 // The endpoint requires session auth (cap_uid cookie). On 401 we surface a
 // clear error so the founder knows to re-authenticate; on 409 (term sheet
 // locked) we surface that too.
 const persistMut = useMutation({
 mutationFn: async (rec: TermSheetRecord) => {
 const body = {
 roundId: rec.roundId,
 companyId,
 source: rec.source,
 region: rec.region,
 instrument: rec.instrument,
 templateId: rec.templateId,
 templateName: rec.templateName,
 sections: rec.sections,
 citations: rec.citations,
 status: rec.status,
 documentHash: rec.documentHash,
 signature: rec.signature,
 signedAt: rec.signedAt,
 uploadFilename: rec.uploadFilename,
 uploadMimeType: rec.uploadMimeType,
 extractedTerms: rec.extractedTerms,
 reconciliation: rec.reconciliation,
 acknowledgedMismatches: rec.acknowledgedMismatches,
 };
 const res = await apiRequest("POST", "/api/founder/term-sheets", body);
 return (await res.json()) as { ok: true; revision: { revision: number; revisionHash: string; prevRevisionHash: string; savedAt: string; savedBy: string } };
 },
 onSuccess: (data) => {
 setSaveState("saved");
 setLastSaveError(null);
 if (stored) {
 saveTermSheet({
 ...stored,
 revision: data.revision.revision,
 revisionHash: data.revision.revisionHash,
 prevRevisionHash: data.revision.prevRevisionHash,
 savedAt: data.revision.savedAt,
 savedBy: data.revision.savedBy,
 });
 }
 queryClient.invalidateQueries({ queryKey: [`/api/founder/term-sheets/${id}`] });
 queryClient.invalidateQueries({ queryKey: [`/api/founder/term-sheets/${id}/history`] });
 },
 onError: (err: Error) => {
 setSaveState("error");
 const msg = err.message ?? "";
 if (msg.includes("401")) {
 setLastSaveError("Sign in required to save.");
 } else if (msg.includes("409")) {
 setLastSaveError("This term sheet is signed and locked — saves are no longer accepted.");
 } else {
 setLastSaveError("Save failed. Your local draft is intact; try again.");
 }
 },
 });

 // Debounced auto-save: when `stored` changes, wait 800ms of idle then save.
 // Skipped when the record is signed (locked) or before initial load.
 useEffect(() => {
 if (!stored) return;
 if (stored.status === "signed") return; // locked — signing already persisted
 if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
 setSaveState("saving");
 saveTimerRef.current = setTimeout(() => {
 persistMut.mutate(stored);
 }, 800);
 return () => {
 if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stored?.sections, stored?.status]);

 const baseData = useMemo(() => {
 if (!round.data) return null;
 const d = inferData(round.data);
 d.founderNames = me.data?.displayName ? [me.data.displayName] : ["Founder"];
 return d;
 }, [round.data, me.data?.displayName]);

 const [region, setRegion] = useState<Region>("US");
 const [instrument, setInstrument] = useState<InstrumentValue>("preferred");
 const [signerName, setSignerName] = useState("");
 const [signerEmail, setSignerEmail] = useState("avi@capavate.demo");
 const [acknowledgedDraft, setAcknowledgedDraft] = useState(false);
 const [ackMismatches, setAckMismatches] = useState<Set<string>>(new Set());
 const [showConsortium, setShowConsortium] = useState(false);
 const [consortiumPicks, setConsortiumPicks] = useState<Set<string>>(new Set());
 const [consortiumNote, setConsortiumNote] = useState("");
 const fileRef = useRef<HTMLInputElement>(null);
 const [uploadInProgress, setUploadInProgress] = useState(false);
 const [uploadResult, setUploadResult] = useState<null | { filename: string; mimeType: string; extracted: ReturnType<typeof reconcileTerms> extends infer X ? X : never; diffs: ReconciliationDiff[] }>(null);

 // Sync region/instrument with round data once loaded
 useEffect(() => {
 if (baseData) {
 setRegion(baseData.region);
 setInstrument(baseData.instrument);
 }
 }, [baseData]);

 // If route arrived with ?action=upload and no termsheet stored, auto-open file dialog after mount
 useEffect(() => {
 if (initialAction === "upload" && !stored && fileRef.current) {
 // Don't auto-click — would surprise users. Just scroll to upload section visible by default.
 }
 }, [initialAction, stored]);

 // Sprint 26 fix — hoist sendToInvestorsMut ABOVE the early return so the
 // hook is called on every render (preserves React hook-order invariant).
 const sendToInvestorsMut = useMutation({
 mutationFn: async () => (await apiRequest("POST", `/api/rounds/${id}/term-sheet/send`, {
  invitationIds: asArray(invs.data).map(i => i.id),
 })).json(),
 onSuccess: () => {
  const cnt = asArray(invs.data).length;
  toast({ title: `Sent to ${cnt} investor(s)`, description: "Each investor will receive an email with the signed term sheet PDF." });
  queryClient.invalidateQueries({ queryKey: [`/api/rounds/${id}/invitations`] });
 },
 onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
 });

 // Sprint 27 fix: differentiate "still loading" from "round doesn't exist".
 // A 404 (or non-OK) from /api/rounds/:id resolves to null via the default
 // queryFn — without this branch the page hung on "Loading…" forever.
 if (round.isLoading) return <PageBody>Loading…</PageBody>;
 if (!round.data) {
  return (
  <PageBody>
   <div className="max-w-md mx-auto mt-12 p-6 rounded-lg border border-amber-200 bg-amber-50 text-sm">
   <div className="font-semibold text-amber-900 mb-1">Round not found</div>
   <div className="text-amber-800 mb-3">
    We couldn't load round <code className="bg-amber-100 px-1 rounded">{id}</code>. It may have been deleted, or the server restarted before it was saved.
   </div>
   <a href="#/founder/rounds" className="inline-block bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white px-3 py-1.5 rounded text-xs font-medium">
    Back to rounds list
   </a>
   </div>
  </PageBody>
  );
 }
 if (!baseData) return <PageBody>Loading…</PageBody>;
 const r = round.data;
 const data: TermSheetData = { ...baseData, region, instrument };

 /* ------------ State 1: GENERATE ------------ */
 function handleGenerate() {
 const tpl = getTemplate(region, instrument, data);
 // Sprint 26 — include the structured investor-grade description for every
 // clause so the editor can render it inline below the body.
 const sections: SectionDraft[] = tpl.sections.map((s) => ({
 id: s.id,
 heading: s.heading,
 body: s.body(data),
 edited: false,
 description: s.description,
 descriptionEdited: false,
 }));
 const rec: TermSheetRecord = {
 roundId: id,
 source: "generated",
 region,
 instrument,
 templateId: `${region}-${instrument}-${tpl.version}`,
 templateName: tpl.templateName,
 sections,
 citations: tpl.sourceCitations,
 status: "draft",
 };
 saveTermSheet(rec);
 emit({
 type: "termsheet.created",
 payload: { templateId: rec.templateId, region, instrument, roundId: id },
 }, { companyId: companyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 toast({ title: "Term sheet generated", description: tpl.templateName });
 }

 /* ------------ State 1b: UPLOAD ------------ */
 async function handleUpload(file: File) {
 setUploadInProgress(true);
 try {
 const fd = new FormData();
 fd.append("file", file);
 /* v25.10 M2 — include cookies for Safari + cross-origin compatibility. */
 const res = await fetch(`/api/rounds/${id}/termsheet/upload`, { method: "POST", body: fd, credentials: "include" });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json = await res.json() as { filename: string; mimeType: string; extracted: Parameters<typeof reconcileTerms>[1] };
 const diffs = reconcileTerms(data, json.extracted);
 setUploadResult({ filename: json.filename, mimeType: json.mimeType, extracted: json.extracted as never, diffs });
 // Persist as a draft record so the founder can sign it after acknowledging mismatches.
 const rec: TermSheetRecord = {
 roundId: id,
 source: "uploaded",
 region,
 instrument,
 templateId: `uploaded-${json.filename}`,
 templateName: `Uploaded: ${json.filename}`,
 sections: [{
 id: "uploaded-content",
 heading: "Uploaded Term Sheet",
 body: `(Original document: ${json.filename}. Extraction was automated; review carefully.)\n\nReconciled headline terms against round terms. See reconciliation panel.`,
 edited: false,
 }],
 citations: ["Founder-uploaded — review by qualified counsel before signing."],
 status: "draft",
 uploadFilename: json.filename,
 uploadMimeType: json.mimeType,
 extractedTerms: json.extracted,
 reconciliation: diffs,
 acknowledgedMismatches: [],
 };
 saveTermSheet(rec);
 emit({
 type: "termsheet.uploaded",
 payload: { filename: json.filename, mimeType: json.mimeType, roundId: id },
 }, { companyId: companyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 const matchCount = diffs.filter((d) => d.match).length;
 const mismatchCount = diffs.length - matchCount;
 emit({
 type: "termsheet.reconciled",
 payload: {
 mismatches: diffs.filter((d) => !d.match).map((d) => d.field),
 matches: diffs.filter((d) => d.match).map((d) => d.field),
 roundId: id,
 },
 }, { companyId: companyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 toast({
 title: mismatchCount === 0 ? "Term sheet reconciled — all match" : `${mismatchCount} mismatch(es) detected`,
 description: `Extracted ${diffs.length} field${diffs.length === 1 ? "" : "s"} (${matchCount} match, ${mismatchCount} mismatch).`,
 variant: mismatchCount === 0 ? "default" : "destructive",
 });
 } catch (err) {
 toast({ title: "Upload failed", description: String(err), variant: "destructive" });
 } finally {
 setUploadInProgress(false);
 if (fileRef.current) fileRef.current.value = "";
 }
 }

 /* ------------ State 2: EDIT a section / reset ------------ */
 function editSection(secId: string, body: string) {
 if (!stored) return;
 const sections = stored.sections.map((s) => s.id === secId ? { ...s, body, edited: true } : s);
 saveTermSheet({ ...stored, sections });
 }
 // Sprint 26 — each clause description has five fields; we let the founder
 // edit any of them and track whether the founder has diverged from the
 // template default (so a "reset" can restore it).
 function editDescription(secId: string, field: keyof ClauseDescription, value: string) {
 if (!stored) return;
 const sections = stored.sections.map((s) => {
 if (s.id !== secId) return s;
 const base: ClauseDescription = s.description ?? { whatItMeans: "", whyItMatters: "" };
 const nextDesc: ClauseDescription = { ...base, [field]: value };
 return { ...s, description: nextDesc, descriptionEdited: true };
 });
 saveTermSheet({ ...stored, sections });
 }
 function resetSection(secId: string) {
 if (!stored || stored.source !== "generated") return;
 const tpl = getTemplate(stored.region, stored.instrument, data);
 const tplSec = tpl.sections.find((x) => x.id === secId);
 if (!tplSec) return;
 const sections = stored.sections.map((s) => s.id === secId
 ? { ...s, body: tplSec.body(data), edited: false, description: tplSec.description, descriptionEdited: false }
 : s);
 saveTermSheet({ ...stored, sections });
 toast({ title: "Section reset", description: tplSec.heading });
 }
 // Sprint 26 — reset ONLY the description to the template default (keeps body edits).
 function resetDescription(secId: string) {
 if (!stored || stored.source !== "generated") return;
 const tpl = getTemplate(stored.region, stored.instrument, data);
 const tplSec = tpl.sections.find((x) => x.id === secId);
 if (!tplSec) return;
 const sections = stored.sections.map((s) => s.id === secId
 ? { ...s, description: tplSec.description, descriptionEdited: false }
 : s);
 saveTermSheet({ ...stored, sections });
 toast({ title: "Description reset", description: tplSec.heading });
 }
 // Sprint 26 — manual save (in addition to debounced auto-save).
 function handleManualSave() {
 if (!stored) return;
 setSaveState("saving");
 persistMut.mutate(stored);
 }

 /* ------------ State 3: SIGN ------------ */
 function handleSign() {
 if (!stored) return;
 if (!signerName.trim()) {
 toast({ title: "Type your full legal name to sign", variant: "destructive" });
 return;
 }
 if (!acknowledgedDraft) {
 toast({ title: "Confirm the legal-counsel acknowledgment", variant: "destructive" });
 return;
 }
 // Block signing if mismatches remain unacknowledged
 if (stored.source === "uploaded" && stored.reconciliation) {
 const unack = stored.reconciliation.filter((d) => !d.match).filter((d) => !ackMismatches.has(d.field));
 if (unack.length > 0) {
 toast({ title: "Acknowledge each mismatch first", description: unack.map((u) => u.field).join(", "), variant: "destructive" });
 return;
 }
 }
 const fullText = stored.sections.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n");
 const documentHash = sha256(fullText);
 const meta = captureSessionMetadata();
 const sig = signSES({
 documentId: documentHash,
 documentType: "termsheet",
 signerName: signerName.trim(),
 signerEmail: signerEmail.trim(),
 signerRole: "founder",
 intentText: "I understand this term sheet is a draft and recommended for review by qualified legal counsel before signing or sending. Capavate is not a law firm.",
 ipAddress: meta.ipAddress,
 userAgent: meta.userAgent,
 timestamp: meta.timestamp,
 sessionId: meta.sessionId,
 prevHash: "0".repeat(64),
 });
 const next: TermSheetRecord = {
 ...stored,
 status: "signed",
 documentHash,
 signature: sig,
 signedAt: meta.timestamp,
 acknowledgedMismatches: Array.from(ackMismatches),
 };
 saveTermSheet(next);
 /* v25.11 NC-2 fix — the previous implementation only wrote the signed term
  * sheet to the Zustand in-memory store, then emitted a WebSocket event.
  * If the founder navigated away or the page reloaded, the signature,
  * documentHash, and status:"signed" were lost. Investors then received
  * unsigned drafts when sendToInvestors fired from the stale server copy.
  * Persist via the same POST /api/founder/term-sheets path that the manual
  * save and auto-save effects already use. */
 persistMut.mutate(next);
 emit({
 type: "termsheet.signed",
 payload: { documentHash, signature: sig, roundId: id },
 }, { companyId: companyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 toast({ title: "Term sheet signed + locked", description: `Hash ${documentHash.slice(0, 12)}…` });
 }

 function handleSendToInvestors() {
 if (!stored || stored.status !== "signed") return;
 sendToInvestorsMut.mutate();
 }

 function handleRequestIntro() {
 if (consortiumPicks.size === 0) {
 toast({ title: "Select at least one partner", variant: "destructive" });
 return;
 }
 const partners = Array.from(consortiumPicks);
 const rec = {
 id: `intro-${Date.now()}`,
 roundId: id,
 partnerIds: partners,
 contextMessage: consortiumNote || `Term-sheet review — ${r.name}`,
 createdAt: new Date().toISOString(),
 };
 addConsortium(rec);
 emit({
 type: "consortium.introduction.requested",
 payload: { partnerIds: partners, roundId: id, contextMessage: rec.contextMessage },
 }, { companyId: companyId, roundId: id, actorId: me.data?.id ?? "founder", actorRole: "founder" });
 toast({ title: `Introduction requested from ${partners.length} firm(s)`, description: "Capavate Collective will reach out within their stated SLA." });
 setShowConsortium(false);
 setConsortiumPicks(new Set());
 setConsortiumNote("");
 }

 async function handleExportPdf() {
 try {
   const res = await apiRequest("GET", `/api/rounds/${id}/term-sheet/pdf`);
   const blob = await res.blob();
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url; a.download = `term-sheet-${id}.pdf`; a.click();
   URL.revokeObjectURL(url);
 } catch {
   toast({ title: "PDF export unavailable", description: "Use browser print (Ctrl+P) as fallback.", variant: "destructive" });
 }
 }

 /* ------------ render ------------ */
 return (
 <>
 <PageHeader
 title={`Term Sheet — ${r.name}`}
 description={stored ? (stored.status === "signed" ? `Signed by ${stored.signature?.signerName} on ${fmtDate(stored.signedAt ?? "")}` : "Draft — review carefully before signing.") : "Generate, upload, or skip."}
 breadcrumbs={[
 { href: "/founder/dashboard", label: "Workspace" },
 { href: "/founder/rounds", label: "Rounds" },
 { href: `/founder/rounds/${id}`, label: r.name },
 { label: "Term sheet" },
 ]}
 actions={
 <>
 <GlossaryLink />
 <Link href={`/founder/rounds/${id}`}><Button variant="ghost" data-testid="button-back-round"><ArrowLeft className="h-4 w-4 mr-2" />Back to round</Button></Link>
 {stored && (
 <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-termsheet-pdf">
 <Printer className="h-4 w-4 mr-2" /> Export PDF
 </Button>
 )}
 </>
 }
 />
 <PageBody>
 {/* No draft yet → Generate / Upload */}
 {!stored && (
 <div className="grid md:grid-cols-2 gap-5">
 <Card data-testid="card-generate">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-[hsl(184_98%_22%)]" /> Generate term sheet
 <HelpTip>Pick a region + instrument; we render a citation-backed template (NVCA, BVCA, J-KISS, CCPS, etc.) populated with your round terms.</HelpTip>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div>
 <Label>Region</Label>
 <select
 className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
 value={region}
 onChange={(e) => setRegion(e.target.value as Region)}
 data-testid="select-region"
 >
 {REGIONS.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
 </select>
 </div>
 <div>
 <Label>Instrument template</Label>
 <select
 className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
 value={instrument}
 onChange={(e) => setInstrument(e.target.value as InstrumentValue)}
 data-testid="select-template"
 >
 {INSTRUMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
 </select>
 </div>
 <div className="text-xs text-muted-foreground">
 Template: <span className="font-medium text-foreground">{getTemplate(region, instrument, data).templateName}</span>
 <div className="mt-2">
 Citations: {getTemplate(region, instrument, data).sourceCitations.slice(0, 2).map((c) => (
 <Badge key={c} variant="outline" className="text-[10px] mr-1">{c}</Badge>
 ))}
 </div>
 </div>
 <Button onClick={handleGenerate} className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-generate-termsheet">
 <ScrollText className="h-4 w-4 mr-2" /> Generate term sheet
 </Button>
 </CardContent>
 </Card>

 <Card data-testid="card-upload">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <Upload className="h-4 w-4 text-[hsl(327_77%_30%)]" /> Upload my own term sheet
 <HelpTip>Upload a PDF or DOCX you (or your counsel) prepared. We extract headline terms and diff them against your round.</HelpTip>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <p className="text-sm text-muted-foreground">PDF or DOCX, &lt; 8 MB. Extraction is heuristic — review the reconciliation panel carefully.</p>
 <div className="border-2 border-dashed border-border rounded-md p-6 text-center">
 <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
 <input
 ref={fileRef}
 type="file"
 accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
 className="block mx-auto text-xs file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:bg-secondary"
 data-testid="input-upload-termsheet"
 onChange={(e) => {
 const f = e.target.files?.[0];
 if (f) handleUpload(f);
 }}
 />
 {uploadInProgress && <div className="text-xs text-muted-foreground mt-2">Extracting…</div>}
 </div>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Draft → Edit / Review */}
 {stored && stored.status === "draft" && (
 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <FileText className="h-4 w-4" /> {stored.templateName}
 <Badge variant="outline" className="text-[10px]">{stored.source}</Badge>
 <Badge className="text-[10px] bg-[hsl(184_98%_22%)] text-white">draft</Badge>
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">
 {stored.citations.slice(0, 2).map((c) => (
 <Badge key={c} variant="outline" className="text-[10px] mr-1">{c}</Badge>
 ))}
 </p>
 </CardHeader>
 </Card>

 {/* Reconciliation panel for uploaded */}
 {stored.source === "uploaded" && stored.reconciliation && stored.reconciliation.length > 0 && (
 <Card data-testid="card-reconciliation">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <ShieldCheck className="h-4 w-4 text-[hsl(184_98%_22%)]" /> Reconciliation against round terms
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">Each mismatch must be acknowledged below before signing.</p>
 </CardHeader>
 <CardContent className="space-y-2">
 {stored.reconciliation.map((d) => (
 <div key={d.field} className={`flex items-start gap-3 p-3 rounded-md border ${d.match ? "border-emerald-300/40 bg-emerald-50/40 " : "border-rose-300/40 bg-rose-50/40 "}`} data-testid={`reconcile-${d.field.replace(/\s+/g, "-")}`}>
 <div className="mt-0.5 shrink-0">
 {d.match ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-sm font-medium">{d.field}</div>
 <div className="text-xs text-muted-foreground mt-0.5">
 Round: <span className="font-mono">{d.roundValue}</span> · Uploaded: <span className="font-mono">{d.uploadedValue}</span>
 </div>
 {!d.match && (
 <label className="mt-2 flex items-center gap-2 text-xs cursor-pointer">
 <Checkbox
 checked={ackMismatches.has(d.field)}
 onCheckedChange={(v) => {
 setAckMismatches((prev) => {
 const next = new Set(prev);
 if (v) next.add(d.field); else next.delete(d.field);
 return next;
 });
 }}
 data-testid={`checkbox-ack-${d.field.replace(/\s+/g, "-")}`}
 />
 <span>I acknowledge this mismatch and accept the uploaded value as the canonical term.</span>
 </label>
 )}
 </div>
 </div>
 ))}
 </CardContent>
 </Card>
 )}

 {/* Section editor + Sprint 26 description editor */}
 <Card>
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between gap-3">
 <div>
 <CardTitle className="text-base">Sections</CardTitle>
 <p className="text-sm text-muted-foreground">
 Edit any clause body or its investor-grade description. Auto-save runs after every edit; revisions are hash-chained server-side. {stored.sections.length} section(s).
 </p>
 </div>
 {/* Sprint 26 — save status + revision badge */}
 <div className="flex items-center gap-2 shrink-0" data-testid="save-status">
 {stored.revision && (
 <Badge variant="outline" className="text-[10px]" data-testid="badge-revision">
 rev {stored.revision}
 </Badge>
 )}
 {saveState === "saving" && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300" data-testid="badge-saving">Saving…</Badge>}
 {saveState === "saved" && <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300" data-testid="badge-saved">Saved</Badge>}
 {saveState === "error" && <Badge variant="outline" className="text-[10px] text-rose-700 border-rose-300" data-testid="badge-save-error">Save failed</Badge>}
 <Button size="sm" variant="outline" onClick={handleManualSave} disabled={!stored || stored.status === "signed"} data-testid="button-manual-save">
 <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Save
 </Button>
 </div>
 </div>
 {lastSaveError && (
 <div role="alert" className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5" data-testid="text-save-error">
 {lastSaveError}
 </div>
 )}
 </CardHeader>
 <CardContent className="space-y-4">
 {stored.sections.map((s) => (
 <div key={s.id} className="border border-border rounded-md p-3" data-testid={`section-${s.id}`}>
 <div className="flex items-center justify-between mb-2">
 <h4 className="text-sm font-semibold">{s.heading}</h4>
 <div className="flex gap-1">
 {s.edited && <Badge variant="outline" className="text-[10px]">edited</Badge>}
 {s.descriptionEdited && <Badge variant="outline" className="text-[10px] border-[hsl(184_98%_22%)]/40 text-[hsl(184_98%_22%)]">description edited</Badge>}
 {stored.source === "generated" && (
 <Button size="sm" variant="ghost" onClick={() => resetSection(s.id)} data-testid={`button-reset-${s.id}`}>Reset</Button>
 )}
 </div>
 </div>
 <Textarea
 value={s.body}
 onChange={(e) => editSection(s.id, e.target.value)}
 rows={Math.max(3, Math.min(10, s.body.split("\n").length + 1))}
 className="text-xs font-mono"
 data-testid={`textarea-section-${s.id}`}
 />
 {/* Sprint 26 — editable investor-grade clause description (5 fields). */}
 <ClauseDescriptionEditor
 description={s.description}
 descriptionEdited={s.descriptionEdited}
 onEdit={(field, value) => editDescription(s.id, field, value)}
 onReset={stored.source === "generated" ? () => resetDescription(s.id) : undefined}
 testIdPrefix={s.id}
 />
 </div>
 ))}
 </CardContent>
 </Card>

 {/* Sign panel */}
 <Card data-testid="card-sign">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4 text-[hsl(38_92%_50%)]" />Sign + lock</CardTitle>
 <p className="text-sm text-muted-foreground mt-0.5">SES (Simple Electronic Signature). ESIGN/UETA-compliant for the United States; eIDAS Article 25 SES tier for the EU/UK.</p>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="grid md:grid-cols-2 gap-3">
 <div>
 <Label>Signer full legal name</Label>
 <Input
 className="mt-1"
 placeholder="Avi Barnes"
 value={signerName}
 onChange={(e) => setSignerName(e.target.value)}
 data-testid="input-signer-name"
 />
 </div>
 <div>
 <Label>Signer email</Label>
 <Input
 className="mt-1"
 placeholder="avi@example.com"
 value={signerEmail}
 onChange={(e) => setSignerEmail(e.target.value)}
 data-testid="input-signer-email"
 />
 </div>
 </div>
 {/* BUG 028 fix v23.7 — the legal-counsel acknowledgment checkbox rendered
  * invisibly (white-on-white) and its data-testid contained a space, so it
  * could not be targeted by name. We wrap it in a bordered, tinted row and
  * force a high-contrast box (slate border + white fill, primary when
  * checked) so the control is always obvious regardless of card background. */}
 <label
   htmlFor="legal-counsel-ack"
   className="flex items-start gap-2 text-xs cursor-pointer rounded-md border border-slate-300 bg-slate-50 p-2.5"
   data-testid="label-legal-counsel-ack"
 >
 <Checkbox
 id="legal-counsel-ack"
 checked={acknowledgedDraft}
 onCheckedChange={(v) => setAcknowledgedDraft(!!v)}
 aria-label="Legal Counsel Acknowledgment"
 className="h-4 w-4 shrink-0 border-2 border-slate-600 bg-white data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground"
 data-testid="checkbox-legal-counsel-ack"
 />
 <span className="leading-relaxed">
 I understand this term sheet is a draft and recommended for review by qualified legal counsel before signing or sending. Capavate is not a law firm.
 </span>
 </label>
 <Button onClick={handleSign} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-sign-termsheet">
 <Lock className="h-4 w-4 mr-2" /> Sign + lock
 </Button>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Signed → final view */}
 {stored && stored.status === "signed" && (
 <div className="space-y-4">
 <Card data-testid="card-signed">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <ShieldCheck className="h-4 w-4 text-emerald-600" /> Signed + locked
 <Badge className="text-[10px] bg-emerald-600 text-white">signed</Badge>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-2 text-sm">
 <div className="grid md:grid-cols-2 gap-3">
 <div><div className="text-xs text-muted-foreground">Signer</div><div className="font-medium">{stored.signature?.signerName}</div></div>
 <div><div className="text-xs text-muted-foreground">Signed at</div><div className="font-medium">{fmtDate(stored.signedAt ?? "")}</div></div>
 <div className="md:col-span-2"><div className="text-xs text-muted-foreground">Document hash</div><div className="font-mono text-[11px] break-all">{stored.documentHash}</div></div>
 <div className="md:col-span-2"><div className="text-xs text-muted-foreground">Signature hash</div><div className="font-mono text-[11px] break-all">{stored.signature?.hash}</div></div>
 </div>
 <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
 <Button onClick={handleSendToInvestors} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-send-termsheet">
 <Send className="h-4 w-4 mr-2" /> Send to investors ({invs.data?.length ?? 0})
 </Button>
 <Button variant="outline" onClick={() => setShowConsortium(true)} data-testid="button-request-intro">
 <Users className="h-4 w-4 mr-2" /> Request introduction to consortium partner
 </Button>
 <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-termsheet-pdf-bottom">
 <Download className="h-4 w-4 mr-2" /> Export PDF
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Locked, read-only view */}
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">{stored.templateName}</CardTitle></CardHeader>
 <CardContent>
 <div className="space-y-4 text-sm" id="termsheet-print-area">
 <div className="hidden print:flex items-center justify-between mb-4 border-b border-border pb-3">
 <img src={CAPAVATE_LOGO_URL} alt="Capavate" style={{ height: 32, width: "auto" }} />
 <div className="text-xs text-muted-foreground">Generated by Capavate · {new Date().toISOString().slice(0, 10)}</div>
 </div>
 {stored.sections.map((s) => (
 <div key={s.id} data-testid={`section-locked-${s.id}`} className="mb-4">
 <h4 className="font-semibold mb-1">{s.heading}</h4>
 <p className="whitespace-pre-wrap text-muted-foreground">{s.body}</p>
 {/* Sprint 26 — print the investor-grade description inline beneath each clause. */}
 {s.description && (s.description.whatItMeans || s.description.whyItMatters) && (
 <div className="mt-2 pl-3 border-l-2 border-[hsl(184_98%_22%)]/30 text-[11px] text-muted-foreground space-y-1" data-testid={`description-locked-${s.id}`}>
 {s.description.whatItMeans && <div><strong className="text-foreground">What it means:</strong> {s.description.whatItMeans}</div>}
 {s.description.whyItMatters && <div><strong className="text-foreground">Why it matters:</strong> {s.description.whyItMatters}</div>}
 {s.description.commonVariants && <div><strong className="text-foreground">Common variants:</strong> {s.description.commonVariants}</div>}
 {s.description.founderWatchouts && <div><strong className="text-foreground">Founder watch-outs:</strong> {s.description.founderWatchouts}</div>}
 {s.description.citation && <div><strong className="text-foreground">Source:</strong> {s.description.citation}</div>}
 </div>
 )}
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Sticky disclaimer banner */}
 <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-3 bg-amber-50 border-t border-amber-300/50 text-xs leading-relaxed flex items-start gap-2 print:hidden">
 <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
 <div>
 <strong>Term sheets are draft documents.</strong> Capavate strongly recommends review by qualified securities counsel before signing or sending. Need an introduction? Capavate Collective has consortium partner law firms in 9 regions covering NVCA / BVCA / J-KISS / CCPS / SAFE templates.
 </div>
 </div>

 {/* Consortium picker dialog (rendered as panel for simplicity in print/iframe) */}
 {showConsortium && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="consortium-modal">
 <Card className="max-w-2xl w-full max-h-[80vh] overflow-auto">
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Capavate Collective — request an introduction</CardTitle>
 <Button variant="ghost" size="sm" onClick={() => setShowConsortium(false)} data-testid="button-consortium-close"><X className="h-4 w-4" /></Button>
 </CardHeader>
 <CardContent className="space-y-3">
 <p className="text-sm text-muted-foreground">Pick one or more partner firms; we'll send each a brief context note. SLA varies per region; partner profile shows business-day SLA.</p>
 <div className="grid md:grid-cols-2 gap-2 max-h-[40vh] overflow-auto">
 {partnersByRegion(region as PartnerRegion).map((p) => (
 <label key={p.id} className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded-md border border-border hover:bg-secondary/40">
 <Checkbox
 checked={consortiumPicks.has(p.id)}
 onCheckedChange={(v) => {
 setConsortiumPicks((prev) => {
 const next = new Set(prev);
 if (v) next.add(p.id); else next.delete(p.id);
 return next;
 });
 }}
 data-testid={`checkbox-partner-${p.id}`}
 />
 <div>
 <div className="font-medium">{p.firmName}</div>
 <div className="text-muted-foreground">{p.regionalSpecialty}</div>
 <div className="text-[10px] mt-1 text-[hsl(184_98%_22%)]">SLA {p.slaBusinessDays} business days</div>
 </div>
 </label>
 ))}
 {partnersByRegion(region as PartnerRegion).length === 0 && (
 <div className="col-span-2 text-xs text-muted-foreground italic p-4">
  No consortium partners are currently listed for {region}. Capavate is onboarding partners across regions — check back soon.
 </div>
 )}
 {/* v25.23 NC-C fix — the previous ungated fallback rendered CONSORTIUM_PARTNERS.slice(0,6)
     which leaked the placeholder firm directory (firms that have NOT confirmed Collective
     membership per lib/partners.ts header). The portfolio-companies gate at partnersByRegion
     is the source of truth; if a region is empty, render the empty state above and STOP.
     No mock data is rendered to founders. */}
 {false && partnersByRegion(region as PartnerRegion).length === 0 && CONSORTIUM_PARTNERS.slice(0, 0).map((p) => (
 <label key={p.id} className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded-md border border-border hover:bg-secondary/40">
 <Checkbox
 checked={consortiumPicks.has(p.id)}
 onCheckedChange={(v) => {
 setConsortiumPicks((prev) => {
 const next = new Set(prev);
 if (v) next.add(p.id); else next.delete(p.id);
 return next;
 });
 }}
 data-testid={`checkbox-partner-${p.id}`}
 />
 <div>
 <div className="font-medium">{p.firmName} ({p.region})</div>
 <div className="text-muted-foreground">{p.regionalSpecialty}</div>
 </div>
 </label>
 ))}
 </div>
 <div>
 <Label>Context note (optional)</Label>
 <Textarea
 rows={3}
 className="mt-1"
 value={consortiumNote}
 onChange={(e) => setConsortiumNote(e.target.value)}
 placeholder={`Looking for a quick term-sheet read on the ${r.name} round.`}
 data-testid="textarea-consortium-note"
 />
 </div>
 <div className="flex justify-end gap-2 pt-2 border-t border-border">
 <Button variant="ghost" onClick={() => setShowConsortium(false)}>Cancel</Button>
 <Button onClick={handleRequestIntro} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-consortium-submit">
 <ArrowRight className="h-4 w-4 mr-2" /> Request introduction
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 )}

 {/* Print-only stylesheet — strip the chrome, render only the term sheet body */}
 <style>{`
 @media print {
 header, nav, footer, [data-sidebar], .print\\:hidden { display: none !important; }
 body { background: white !important; }
 .sticky { position: static !important; }
 }
 `}</style>
 </PageBody>
 </>
 );
}

/**
 * Sprint 26 — ClauseDescriptionEditor.
 *
 * Renders the five-part investor-grade clause description as an editable
 * accordion-style panel beneath the clause body. All five fields are
 * editable; the founder can override the template's default explanation
 * or add their own founder watch-outs. Each field is persisted in the
 * SectionDraft and travels through the credentialed save endpoint.
 *
 * Collapsed by default so the editor isn't overwhelming — click the heading
 * to expand.
 */
function ClauseDescriptionEditor({
 description,
 descriptionEdited,
 onEdit,
 onReset,
 testIdPrefix,
}: {
 description?: ClauseDescription;
 descriptionEdited?: boolean;
 onEdit: (field: keyof ClauseDescription, value: string) => void;
 onReset?: () => void;
 testIdPrefix: string;
}) {
 const [open, setOpen] = useState(false);
 const isEmpty = !description || (!description.whatItMeans && !description.whyItMatters);

 return (
 <div className="mt-3 rounded-md border border-dashed border-[hsl(184_98%_22%)]/30 bg-[hsl(184_98%_22%)]/5" data-testid={`description-panel-${testIdPrefix}`}>
 <button
 type="button"
 onClick={() => setOpen((v) => !v)}
 className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_22%)]/10 rounded-md"
 data-testid={`description-toggle-${testIdPrefix}`}
 aria-expanded={open}
 >
 <span className="flex items-center gap-2">
 <ScrollText className="h-3.5 w-3.5" />
 Clause description {isEmpty && <span className="text-muted-foreground">(empty)</span>}
 {descriptionEdited && <Badge variant="outline" className="text-[10px] ml-1">edited</Badge>}
 </span>
 <span className="text-[10px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
 </button>
 {open && (
 <div className="px-3 pb-3 space-y-3" data-testid={`description-fields-${testIdPrefix}`}>
 <DescriptionField
 label="What it means"
 hint="Plain-English summary so non-lawyers (founders, employees, investors' analysts) understand the clause."
 value={description?.whatItMeans ?? ""}
 onChange={(v) => onEdit("whatItMeans", v)}
 testId={`description-${testIdPrefix}-whatItMeans`}
 />
 <DescriptionField
 label="Why it matters"
 hint="Investor-grade rationale: why the clause exists and what the market norm is."
 value={description?.whyItMatters ?? ""}
 onChange={(v) => onEdit("whyItMatters", v)}
 testId={`description-${testIdPrefix}-whyItMatters`}
 />
 <DescriptionField
 label="Common variants"
 hint="Negotiable alternatives a founder or lead might propose."
 value={description?.commonVariants ?? ""}
 onChange={(v) => onEdit("commonVariants", v)}
 testId={`description-${testIdPrefix}-commonVariants`}
 />
 <DescriptionField
 label="Founder watch-outs"
 hint="How this clause can go wrong if mis-set."
 value={description?.founderWatchouts ?? ""}
 onChange={(v) => onEdit("founderWatchouts", v)}
 testId={`description-${testIdPrefix}-founderWatchouts`}
 />
 <DescriptionField
 label="Source / citation"
 hint="Authoritative source: NVCA, YC, BVCA, J-KISS, or specific statute."
 value={description?.citation ?? ""}
 onChange={(v) => onEdit("citation", v)}
 testId={`description-${testIdPrefix}-citation`}
 compact
 />
 {onReset && descriptionEdited && (
 <div className="flex justify-end">
 <Button size="sm" variant="ghost" onClick={onReset} data-testid={`button-reset-description-${testIdPrefix}`}>
 Reset description to template
 </Button>
 </div>
 )}
 </div>
 )}
 </div>
 );
}

function DescriptionField({
 label,
 hint,
 value,
 onChange,
 testId,
 compact,
}: {
 label: string;
 hint: string;
 value: string;
 onChange: (v: string) => void;
 testId: string;
 compact?: boolean;
}) {
 return (
 <div>
 <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
 <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">{hint}</p>
 {compact ? (
 <Input
 value={value}
 onChange={(e) => onChange(e.target.value)}
 className="text-xs"
 data-testid={testId}
 />
 ) : (
 <Textarea
 value={value}
 onChange={(e) => onChange(e.target.value)}
 rows={Math.max(2, Math.min(6, value.split("\n").length + 1))}
 className="text-xs"
 data-testid={testId}
 />
 )}
 </div>
 );
}
