import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { CompanyProfile } from "@/lib/profile/types";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ROUND_TYPES, INSTRUMENTS, ANTI_DILUTION_VARIANTS, ESOP_TIMING, type InstrumentValue } from "@shared/schema";
import { ArrowLeft, ArrowRight, Check, Sparkles, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { emit } from "@/lib/sprint3";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip, LabelWithTip, LearnMore } from "@/components/HelpTip";
import RoundCarryForwardPanel from "@/components/RoundCarryForwardPanel";

// Patch v11 B-V11-10 — map the wizard's instrument value to the carry-forward
// engine's coarser roundType taxonomy. Returns null for instruments the engine
// doesn't model (warrant / option_pool / foundation / common); the read-only
// sidebar simply doesn't render in those cases.
function instrumentToCarryForwardRoundType(
  instrument: InstrumentValue,
): "safe" | "note" | "priced_equity" | null {
  if (instrument === "safe_post" || instrument === "safe_pre") return "safe";
  if (instrument === "convertible_note") return "note";
  if (instrument === "preferred") return "priced_equity";
  return null;
}

/* Sprint 4 — Per-instrument Learn More content. Voice: short, plain, with one
 * worked example using realistic numbers and one founder-facing watch-out. */
const INSTRUMENT_GUIDE: Record<InstrumentValue, { whenUsed: string; example: string; watchOut: string }> = {
 common: {
 whenUsed: "Used at company formation (Foundation round) and for employee equity grants. Founders almost always hold Common.",
 example: "At incorporation: Maya and Daniel each receive 4,000,000 Common shares at $0.0001 par value. Their tax basis is $400 each. They file 83(b) elections within 30 days.",
 watchOut: "Common is last in line on a sale or wind-down — holders only receive proceeds AFTER preferred holders have collected their liquidation preferences. This is fine if you sell big; painful if you don't.",
 },
 preferred: {
 whenUsed: "The standard for any priced round (Series Seed, Series A, B, C). Investors expect Preferred with NVCA-style terms.",
 example: "On a $4M raise at $18M pre-money: investors get Series Seed Preferred at $1.42/share with 1× non-participating liq pref, 8% pro-rata, broad-based weighted-average anti-dilution. They own ~18% post-money.",
 watchOut: "Aggressive terms (2–3× liq pref, participating, full ratchet anti-dilution) compound over multiple rounds. By Series C the founder economics can collapse. Push back on anything beyond 1× non-participating + broad-based AD.",
 },
 safe_post: {
 whenUsed: "Most pre-seed and seed rounds use SAFEs because they're quick (one page), avoid setting a valuation, and don't require lawyers. Post-money cap (YC v1.2) is the modern default.",
 example: "$500k SAFE at a $5M post-money cap means the investor will own roughly 10% of the company at the next priced round, before further dilution. If you later raise at $20M post-money, the SAFE still converts as if the company were worth $5M — a 4× paper return for the investor.",
 watchOut: "SAFEs accumulate. If you raise three SAFEs at different caps ($5M, $6M, $8M), the math at conversion can surprise founders — the lowest cap dominates and dilution stacks. Model conversion BEFORE you stack more SAFEs.",
 },
 safe_pre: {
 whenUsed: "The older YC v1.0 SAFE. Less common today but still seen with some angels and outside the US. Calculations differ subtly from post-money.",
 example: "$500k pre-money SAFE at a $5M cap on a next round of $1M raised at $10M post-money: founder dilution is borne entirely by founders + employees, not shared with the new round investors.",
 watchOut: "Pre-money SAFEs are confusing because the dilution math is non-obvious. If your investors are giving you a choice, pick post-money cap (v1.2) — the math is cleaner and matches what investors model in their spreadsheets.",
 },
 convertible_note: {
 whenUsed: "Less common than SAFEs in the US since ~2018, but still common in Canada, the UK, and EU. Required by some angel groups and almost all bridge financings.",
 example: "$250k note, 6% interest, 24-month maturity, $5M cap. After 12 months the principal-plus-interest is $265k. At conversion at the cap on a $10M post round, the investor gets 5.3% of the company.",
 watchOut: "Notes have a maturity date. If you don't price a round before maturity, the note holder can demand repayment OR force conversion at a default price you'll hate. Track maturity dates obsessively.",
 },
 warrant: {
 whenUsed: "Often given to lenders as a sweetener on venture debt; sometimes to strategic partners or banks. Rarely a primary fundraising tool.",
 example: "Silicon Valley Bank lends $2M and takes a 10-year warrant for 50,000 shares at $1.00 strike. If the company exits at $10/share, SVB makes ~$450k on the warrant.",
 watchOut: "Warrants count in fully-diluted ownership immediately, even if never exercised. They dilute every other holder by their full notional, which can surprise you in the next round's pre-money math.",
 },
 option_pool: {
 whenUsed: "At every priced round, the lead VC will require you to top up the employee option pool BEFORE the round closes — typically to 10–15% of post-money fully-diluted.",
 example: "Pre-round: 5% pool remaining. Lead requires 12% post-money pool. The 7% top-up is created PRE-money — dilutes founders by 7% before the new investors land. On an $18M pre-money this effectively values the founder side at $16.7M.",
 watchOut: "Pre-money pool dilutes founders only; post-money pool dilutes everyone. VCs almost always require pre-money. Negotiate pool SIZE (do you really need 12%?) before you negotiate other terms — a smaller pool returns more to founders 1-for-1.",
 },
};

const REGION_BLURBS: Record<string, string> = {
 US: "US default — best fit if you're incorporating in Delaware, plan to raise from US VCs, and want NVCA-standard preferred and YC v1.2 SAFE.",
 CA: "Canada — for CCPC corporations. Activates Canadian-specific options taxation, IFRS 2 share-based payment accounting, and NI 45-106 prospectus exemptions.",
 UK: "UK / EU — EMI / SEIS / EIS option scheme support, BVCA-style preferred, and HMRC-friendly defaults. Pick this if you're incorporated in England & Wales.",
 SG: "Singapore — Variable Capital Company (VCC) friendly, MAS-compliant, IRAS s13H tax exemption hooks. Good for SE-Asia regional plays.",
 HK: "Hong Kong — Cayman parent + HK OpCo is the standard structure. SFC-licensed offers, IRD DIPN 38 ESOP rules (income tax at exercise), no CGT. Pick this if your HoldCo is Cayman and your operating team is in HK.",
 CN: "Mainland China — Cayman parent over WFOE/VIE OpCo. Adds SAFE Circular 37 cross-border registration flags, SAMR onshore cap-table filings, phantom-equity ESOP variant, and onshore→offshore dividend WHT (10% standard / 5% under HK-PRC DTA) on the waterfall.",
 IN: "India — Companies Act 2013 issuer. Activates CCPS (compulsorily convertible preference shares) for preferred, CCD (compulsorily convertible debentures) for notes, FEMA cross-border filings, SEBI SBEB ESOP rules with perquisite tax at exercise, and DPIIT recognition checks for §56(2)(viib) angel-tax exemption.",
 JP: "Japan — Kabushiki Kaisha (株式会社). Class shares (種類株式) under Companies Act §107-108, J-KISS for SAFE-style rounds (Coral Capital open-source template), tax-qualified vs non-qualified stock options under Income Tax Act §29-2, FEFTA §27 prior notification for restricted-sector cross-border investment.",
 AU: "Australia — Pty Ltd under Corporations Act 2001. ASIC Form 484 lodgement on share issuance, ESS startup concession under ITAA 1997 §83A-105 (no tax until disposal for < 10 yr / < $50M turnover cos), 50% CGT discount on > 12 mo individual holdings, FIRB approval for foreign investors over threshold, AFSL for SPV / fund mechanics.",
};

const STEPS = [
 { id: 1, title: "Round + Vehicle", desc: "Round type and instrument" },
 { id: 2, title: "Terms", desc: "Per-instrument fields" },
 { id: 3, title: "Schedule", desc: "Open + close + narrative" },
 { id: 4, title: "Review", desc: "Confirm and create" },
];

type FormShape = {
 type: string;
 instrument: InstrumentValue;
 name: string;
 region: string;
 useOfProceeds: string;
 tranches: boolean;
 tranchesPlan: string;
 // common to many instruments
 targetAmount: string;
 preMoney: string;
 pricePerShare: string;
 minTicket: string;
 // SAFE / Note
 valuationCap: string;
 discount: string;
 interestRate: string;
 maturityMonths: string;
 mfn: boolean;
 // Preferred
 liqPrefMultiple: string;
 participating: boolean;
 capParticipation: string;
 antiDilution: string;
 // Warrant
 strikePrice: string;
 expiryYears: string;
 cashlessAllowed: boolean;
 // Option pool
 poolSize: string;
 poolTiming: string;
 vestingMonths: string;
 cliffMonths: string;
 jurisdictionVariant: string;
 // Common
 sharesAuthorized: string;
 // Schedule
 openDate: string;
 closeDate: string;
 notes: string;
};

const defaultForm: FormShape = {
 type: "seed",
 instrument: "safe_post",
 name: "",
 region: "US",
 targetAmount: "2000000",
 preMoney: "18000000",
 pricePerShare: "1.42",
 minTicket: "50000",
 valuationCap: "8000000",
 discount: "20",
 interestRate: "6",
 maturityMonths: "24",
 mfn: true,
 liqPrefMultiple: "1",
 participating: false,
 capParticipation: "",
 antiDilution: "broad_based_wa",
 strikePrice: "1.00",
 expiryYears: "10",
 cashlessAllowed: true,
 poolSize: "10",
 poolTiming: "pre_money",
 vestingMonths: "48",
 cliffMonths: "12",
 jurisdictionVariant: "us_iso",
 sharesAuthorized: "1000000",
 openDate: "2026-05-15",
 closeDate: "2026-07-15",
 notes: "Lead candidate: Hydra Capital. Target $1.5M lead check, $2.5M follower book.",
 useOfProceeds: "50% engineering hires; 20% cloud + LLM compute; 22% go-to-market; 8% legal + working capital.",
 tranches: false,
 tranchesPlan: "Tranche 1: $2.5M concurrent with signing. Tranche 2: $1.5M on hitting Net New ARR ≥ $2M by Q1 2027.",
};

export default function RoundNew() {
 const { toast } = useToast();
 const [, navigate] = useLocation();
 const [step, setStep] = useState(1);
 const [termsheetChoice, setTermsheetChoice] = useState<"generate" | "upload" | "skip">("generate");
 // Sprint 11 D4 — Warrants/ESOP attach to a parent round (no own term sheet)
 const [attachToRound, setAttachToRound] = useState<string>("");
 const [form, setForm] = useState<FormShape>(defaultForm);

 // Defect A — use real active companyId (never hardcode co_novapay).
 const companyId = useActiveCompanyId();

 // Defect B13 / Sprint 25 — createRoundMut wires the Create button to the real endpoint.
 //
 // Sprint 25 PRECISION RULE: money / valuation / price / discount / rate values
 // travel as STRINGS end-to-end. `Number("1.234567890123456789")` silently truncates
 // to ~15 significant digits — unacceptable for cap-table inputs. The engine
 // (decimal.js, 38-digit precision) accepts Decimal-as-string natively.
 //
 // Integer counters (months, share counts entered as whole numbers in the wizard)
 // travel as integer strings so BigInt / parseInt parsing on the server is safe.
 // Empty / blank inputs are sent as null — never as 0.
 const createRoundMut = useMutation({
 mutationFn: async () => {
 const optionalDecimalString = (v: string): string | null => {
 const trimmed = (v ?? "").trim();
 if (trimmed.length === 0) return null;
 return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
 };
 const requiredDecimalString = (v: string): string => optionalDecimalString(v) ?? "0";
 const optionalIntegerString = (v: string): string | null => {
 const trimmed = (v ?? "").trim();
 if (trimmed.length === 0) return null;
 return /^-?\d+$/.test(trimmed) ? trimmed : null;
 };
 const payload = {
 companyId,
 type: form.type,
 instrument: form.instrument,
 // Decimal-as-string values — preserved end-to-end at 38-digit precision.
 targetAmount: requiredDecimalString(form.targetAmount),
 preMoney: requiredDecimalString(form.preMoney),
 pricePerShare: optionalDecimalString(form.pricePerShare),
 valuationCap: optionalDecimalString(form.valuationCap),
 discount: optionalDecimalString(form.discount),
 interestRate: optionalDecimalString(form.interestRate),
 // Integer-as-string — share counts use BigInt internally, never float.
 maturityMonths: optionalIntegerString(form.maturityMonths),
 sharesAuthorized: optionalIntegerString(form.sharesAuthorized),
 poolSize: optionalIntegerString(form.poolSize),
 region: form.region,
 termsheetChoice,
 };
 return (await apiRequest("POST", "/api/rounds", payload)).json();
 },
 onSuccess: (data: { id: string }) => {
 queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
 toast({ title: "Round created", description: `Round ${data.id} is now active.` });
 // Sprint 27 fix: respect the user's term-sheet choice from Step 3. If they
 // picked Generate or Upload, route them straight to the term-sheet page
 // instead of dropping them on an empty round-detail screen with no UI hint.
 if (termsheetChoice === "generate" || termsheetChoice === "upload") {
 navigate(`/founder/rounds/${data.id}/termsheet`);
 } else {
 navigate(`/founder/rounds/${data.id}`);
 }
 },
 onError: () => toast({ title: "Failed to create round", variant: "destructive" }),
 });

 // Sprint 8 — default round wizard region from the live company profile so a
 // country change in /founder/company propagates here on next mount.
 const profileQ = useQuery<CompanyProfile>({ queryKey: ["/api/companies", companyId, "profile"] });

 // Parent-round picker (warrants/ESOP attach). Loaded from the active company's rounds.
 const parentRoundsQ = useQuery<Array<{ id: string; name: string; series?: string }>>({
  queryKey: ["/api/companies", companyId, "rounds"],
  queryFn: async () => {
   if (!companyId) return [];
   const r = await fetch(`/api/companies/${encodeURIComponent(companyId)}/rounds`);
   if (!r.ok) return [];
   const data = await r.json();
   return Array.isArray(data) ? data : [];
  },
  enabled: Boolean(companyId),
 });
 useEffect(() => {
 const liveRegion = profileQ.data?.legal.region;
 if (liveRegion && liveRegion !== form.region) setForm((f) => ({ ...f, region: liveRegion }));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [profileQ.data?.legal.region]);

 function update<K extends keyof FormShape>(k: K, v: FormShape[K]) { setForm(f => ({ ...f, [k]: v })); }

 const instrument = INSTRUMENTS.find(i => i.value === form.instrument)!;
 const usesField = (f: string) => (instrument.fields as readonly string[]).includes(f);

 // Recommended instruments for the chosen round type, marked with a Sparkles badge
 const recommended = INSTRUMENTS.filter(i => (i.suggestedFor as readonly string[]).includes(form.type)).map(i => i.value);

 const post = Number(form.preMoney) + Number(form.targetAmount) || 0;

 // Engine summary preview line — for review step
 function engineSummary() {
 switch (form.instrument) {
 case "common":
 return `Issue ${Number(form.sharesAuthorized).toLocaleString()} Common @ $${form.pricePerShare}/share — engine: us-default v1.0.0`;
 case "preferred":
 return `Series ${form.type.replace("series_", "").toUpperCase()} Preferred · pre-money $${Number(form.preMoney).toLocaleString()} · ${form.liqPrefMultiple}× ${form.participating ? "participating" : "non-participating"} · ${ANTI_DILUTION_VARIANTS.find(a => a.value === form.antiDilution)?.label}`;
 case "safe_post":
 return `SAFE post-money cap $${Number(form.valuationCap).toLocaleString()}, ${form.discount}% discount${form.mfn ? ", MFN" : ""} · YC v1.2 · ${form.region}`;
 case "safe_pre":
 return `SAFE pre-money cap $${Number(form.valuationCap).toLocaleString()}, ${form.discount}% discount${form.mfn ? ", MFN" : ""} · YC v1.0 · ${form.region}`;
 case "convertible_note":
 return `Convertible Note: cap $${Number(form.valuationCap).toLocaleString()}, ${form.discount}% discount, ${form.interestRate}% interest, ${form.maturityMonths}-month maturity${form.mfn ? ", MFN" : ""}`;
 case "warrant":
 return `Warrant: ${Number(form.sharesAuthorized).toLocaleString()} shares @ $${form.strikePrice} strike · ${form.expiryYears}-year expiry · ${form.cashlessAllowed ? "cashless allowed" : "cash only"}`;
 case "option_pool":
 return `Option Pool +${form.poolSize}% (${ESOP_TIMING.find(t => t.value === form.poolTiming)?.label}) · ${form.vestingMonths}mo / ${form.cliffMonths}mo cliff · ${form.jurisdictionVariant}`;
 }
 }

 return (
 <>
 <PageHeader
 title="New round"
 description="Set up a new round on your company's cap table. Pick the round type, the investment vehicle, and the terms — we'll preview the cap-table impact before you create."
 breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { href: "/founder/rounds", label: "Rounds" }, { label: "New" }]}
 actions={<GlossaryLink />}
 />
 <PageBody>
 <ol className="flex items-center mb-8 gap-2 overflow-x-auto pb-2">
 {STEPS.map((s, i) => {
 const active = s.id === step;
 const done = s.id < step;
 return (
 <li key={s.id} className="flex items-center gap-2 shrink-0">
 <button onClick={() => setStep(s.id)} className={`flex items-center gap-3 px-4 py-2 rounded-md border transition ${active ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/10" : done ? "border-emerald-300/70 bg-emerald-50 " : "border-border text-muted-foreground hover:bg-secondary"}`}>
 <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold ${active ? "bg-[hsl(184_98%_22%)] text-white" : done ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
 {done ? <Check className="h-3.5 w-3.5" /> : s.id}
 </div>
 <div className="text-left">
 <div className="text-sm font-medium">{s.title}</div>
 <div className="text-[11px] opacity-70">{s.desc}</div>
 </div>
 </button>
 {i < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
 </li>
 );
 })}
 </ol>

 <div className="grid lg:grid-cols-[1fr_minmax(0,420px)] gap-5 items-start">
 <Card>
 <CardHeader><CardTitle className="text-base">Step {step}: {STEPS[step - 1].title}</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 {step === 1 && (
 <div className="space-y-6">
 <div className="grid md:grid-cols-3 gap-5">
 <div>
 <Label>Round type</Label>
 <Select value={form.type} onValueChange={v => update("type", v)}>
 <SelectTrigger className="mt-1" data-testid="select-round-type"><SelectValue /></SelectTrigger>
 <SelectContent>
 {ROUND_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label>Round name</Label>
 <Input className="mt-1" value={form.name} onChange={e => update("name", e.target.value)} data-testid="input-round-name" />
 </div>
 <div>
 <Label className="flex items-center gap-1.5">Jurisdiction (formula region) <HelpTip>The formula region picks which formulas the engine uses for SAFE/Note conversion, anti-dilution, ESOP top-up and waterfall — and which legal documents Capavate generates.</HelpTip></Label>
 <Select value={form.region} onValueChange={v => update("region", v)}>
 <SelectTrigger className="mt-1" data-testid="select-region"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="US">US — Delaware C-Corp / YC SAFE v1.2 / NVCA</SelectItem>
 <SelectItem value="CA">Canada — CCPC / NI 45-106 / IFRS 2</SelectItem>
 <SelectItem value="UK">UK / EU — EMI / SEIS / EIS / BVCA</SelectItem>
 <SelectItem value="SG">Singapore — VCC / ACRA / MAS / IRAS s13H</SelectItem>
 <SelectItem value="HK">Hong Kong — Cayman / SFC / IRD (no CGT)</SelectItem>
 <SelectItem value="CN">Mainland China — WFOE / VIE / SAFE Circular 37</SelectItem>
 <SelectItem value="IN">India — Companies Act 2013 / CCPS / FEMA / DPIIT</SelectItem>
 <SelectItem value="JP">Japan — Companies Act / J-KISS / class shares / FEFTA</SelectItem>
 <SelectItem value="AU">Australia — Corporations Act 2001 / ESS / FIRB / ASIC</SelectItem>
 </SelectContent>
 </Select>
 <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{REGION_BLURBS[form.region]}</p>
 </div>
 </div>

 <div>
 <Label>Investment vehicle</Label>
 <p className="text-xs text-muted-foreground mb-3 mt-1">Pick the instrument the engine will issue. Each vehicle exposes its own terms in Step 2.</p>
 <div className="grid md:grid-cols-2 gap-3">
 {INSTRUMENTS.map(inst => {
 const selected = form.instrument === inst.value;
 const isRecommended = recommended.includes(inst.value);
 return (
 <div
 key={inst.value}
 role="button"
 tabIndex={0}
 onClick={() => update("instrument", inst.value)}
 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); update("instrument", inst.value); } }}
 data-testid={`instrument-${inst.value}`}
 className={`text-left p-4 rounded-lg border-2 transition cursor-pointer ${selected
 ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/5 ring-2 ring-[hsl(184_98%_22%)]/20"
 : "border-border hover:border-[hsl(184_98%_22%)]/50 hover:bg-secondary/50"}`}
 >
 <div className="flex items-start justify-between gap-2 mb-1">
 <div className="font-semibold text-sm">{inst.label}</div>
 <div className="flex gap-1.5 shrink-0">
 {isRecommended && (
 <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700 ">
 <Sparkles className="h-2.5 w-2.5" /> recommended
 </Badge>
 )}
 {selected && (
 <Badge className="text-[10px] bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_22%)] text-white"><Check className="h-2.5 w-2.5 mr-1" />selected</Badge>
 )}
 </div>
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed">{inst.description}</p>
 <div onClick={(e) => e.stopPropagation()}>
 <LearnMore label="Learn more" testid={`learn-more-${inst.value}`}>
 <div>
 <div className="font-semibold text-foreground/90 mb-0.5">When founders use it</div>
 <div>{INSTRUMENT_GUIDE[inst.value].whenUsed}</div>
 </div>
 <div>
 <div className="font-semibold text-foreground/90 mb-0.5">Worked example</div>
 <div>{INSTRUMENT_GUIDE[inst.value].example}</div>
 </div>
 <div>
 <div className="font-semibold text-amber-700 mb-0.5">Watch out</div>
 <div>{INSTRUMENT_GUIDE[inst.value].watchOut}</div>
 </div>
 </LearnMore>
 </div>
 </div>
 );
 })}
 </div>
 </div>

 <div className="flex items-start gap-2 p-3 rounded-md bg-secondary/40 border border-border text-xs text-muted-foreground">
 <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
 <span>The selected vehicle is wired to <code className="px-1 py-0.5 bg-background border border-border rounded">@capavate/cap-table-engine</code> region <code className="px-1 py-0.5 bg-background border border-border rounded">{form.region}</code>. Step 2 only renders the fields this instrument needs. Cap-table impact is computed live on Review.</span>
 </div>
 </div>
 )}

 {step === 2 && (
 <div className="grid md:grid-cols-2 gap-5">
 {usesField("targetAmount") && (
 <div><LabelWithTip tip="How much new money you want this round to bring in. Investors look at progress vs. this number to decide whether to commit."><Label>Target raise (USD)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.targetAmount} onChange={e => update("targetAmount", e.target.value)} data-testid="input-target" /></div>
 )}
 {usesField("preMoney") && (
 <>
 <div><LabelWithTip tip="The agreed value of your company BEFORE the new money lands. Pre-money + new money = post-money."><Label>Pre-money valuation (USD)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.preMoney} onChange={e => update("preMoney", e.target.value)} data-testid="input-pre" /></div>
 <div><LabelWithTip tip="Calculated automatically: pre-money + target raise. This is the company's valuation immediately after the round closes."><Label>Implied post-money</Label></LabelWithTip><Input className="mt-1 font-mono bg-secondary/50" value={`$${post.toLocaleString()}`} readOnly data-testid="input-post" /></div>
 </>
 )}
 {usesField("pricePerShare") && (
 <div><LabelWithTip tip="What each new share costs in this round. Computed by dividing pre-money valuation by fully-diluted shares before the round."><Label>Price per share (USD)</Label></LabelWithTip><Input type="number" step="0.01" className="mt-1 font-mono" value={form.pricePerShare} onChange={e => update("pricePerShare", e.target.value)} data-testid="input-pps" /></div>
 )}
 {usesField("sharesAuthorized") && (
 <div><LabelWithTip tip="How many new shares this issuance creates. For a Foundation round, this is your founder allocation. For a warrant or option grant, it's the underlying share count."><Label>Shares authorized</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.sharesAuthorized} onChange={e => update("sharesAuthorized", e.target.value)} data-testid="input-shares" /></div>
 )}
 {usesField("valuationCap") && (
 <div><LabelWithTip tip="The maximum valuation at which this SAFE/Note converts to shares. Lower cap = more dilution to founders, more upside for the investor. Most early SAFEs use $5M–$15M caps."><Label>Valuation cap (USD)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.valuationCap} onChange={e => update("valuationCap", e.target.value)} data-testid="input-cap" /></div>
 )}
 {usesField("discount") && (
 <div><LabelWithTip tip="Percentage off the priced-round share price the SAFE/Note investor gets. 20% means they pay $0.80 for what new investors pay $1.00. Standard range is 10–25%."><Label>Discount (%)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.discount} onChange={e => update("discount", e.target.value)} data-testid="input-disc" /></div>
 )}
 {usesField("interestRate") && (
 <div><LabelWithTip tip="Annual interest rate on the convertible note. Accrues until conversion. Standard range is 4–8% APR."><Label>Interest rate (% APR)</Label></LabelWithTip><Input type="number" step="0.1" className="mt-1 font-mono" value={form.interestRate} onChange={e => update("interestRate", e.target.value)} data-testid="input-int" /></div>
 )}
 {usesField("maturityMonths") && (
 <div><LabelWithTip tip="Months until the note legally matures. If you haven't priced a round by then, the holder can demand repayment OR force conversion. Standard is 18–24 months."><Label>Maturity (months)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.maturityMonths} onChange={e => update("maturityMonths", e.target.value)} data-testid="input-maturity" /></div>
 )}
 {usesField("mfn") && (
 <div className="flex items-center gap-3 p-3 rounded-md border border-border md:col-span-2">
 <Switch checked={form.mfn} onCheckedChange={v => update("mfn", v)} data-testid="switch-mfn" />
 <div><LabelWithTip tip="Most-Favored-Nation. If you raise a later SAFE/Note on better terms before the priced round, this investor inherits those better terms automatically."><Label className="cursor-pointer">MFN clause (Most-Favored-Nation)</Label></LabelWithTip><p className="text-xs text-muted-foreground">Investor inherits any better terms granted to a later SAFE/Note holder before the priced round.</p></div>
 </div>
 )}
 {usesField("liqPrefMultiple") && (
 <div><LabelWithTip tip="On exit, this investor gets back this multiple of their investment BEFORE common shareholders see anything. 1× is standard and founder-friendly. 2–3× is aggressive and rare in early-stage."><Label>Liquidation pref multiple</Label></LabelWithTip>
 <Select value={form.liqPrefMultiple} onValueChange={v => update("liqPrefMultiple", v)}>
 <SelectTrigger className="mt-1" data-testid="select-liqpref"><SelectValue /></SelectTrigger>
 <SelectContent><SelectItem value="1">1× (standard)</SelectItem><SelectItem value="2">2× (aggressive)</SelectItem><SelectItem value="3">3× (rare)</SelectItem></SelectContent>
 </Select>
 </div>
 )}
 {usesField("participating") && (
 <div className="flex items-center gap-3 p-3 rounded-md border border-border md:col-span-2">
 <Switch checked={form.participating} onCheckedChange={v => update("participating", v)} data-testid="switch-participating" />
 <div><LabelWithTip tip="After getting their liq-pref back, the investor ALSO shares pro-rata in remaining proceeds with common. Aggressive — most early-stage rounds use non-participating."><Label className="cursor-pointer">Participating preferred</Label></LabelWithTip><p className="text-xs text-muted-foreground">Investor receives liq-pref AND pro-rata of remainder. Otherwise, choose between liq-pref OR converted Common.</p></div>
 </div>
 )}
 {usesField("capParticipation") && form.participating && (
 <div><LabelWithTip tip="Optional ceiling on participation, expressed as a multiple of the original investment. 2–3× cap is most common when participating is in play."><Label>Participation cap (× — optional)</Label></LabelWithTip><Input type="number" step="0.5" className="mt-1 font-mono" placeholder="leave blank for uncapped" value={form.capParticipation} onChange={e => update("capParticipation", e.target.value)} data-testid="input-cap-part" /></div>
 )}
 {usesField("antiDilution") && (
 <div className="md:col-span-2"><LabelWithTip tip="Protects the investor's ownership percentage if you later raise at a lower valuation. Broad-based weighted-average is the gentle, founder-friendly version. Full ratchet is brutal — avoid if possible."><Label>Anti-dilution protection</Label></LabelWithTip>
 <Select value={form.antiDilution} onValueChange={v => update("antiDilution", v)}>
 <SelectTrigger className="mt-1" data-testid="select-ad"><SelectValue /></SelectTrigger>
 <SelectContent>{ANTI_DILUTION_VARIANTS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
 </Select>
 </div>
 )}
 {usesField("strikePrice") && (
 <div><LabelWithTip tip="What the warrant holder pays per share to exercise. Typically set at the fair market value at issuance."><Label>Strike price (USD)</Label></LabelWithTip><Input type="number" step="0.01" className="mt-1 font-mono" value={form.strikePrice} onChange={e => update("strikePrice", e.target.value)} data-testid="input-strike" /></div>
 )}
 {usesField("expiryYears") && (
 <div><LabelWithTip tip="How long the warrant remains exercisable. Standard is 7–10 years for venture warrants."><Label>Expiry (years)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.expiryYears} onChange={e => update("expiryYears", e.target.value)} data-testid="input-expiry" /></div>
 )}
 {usesField("cashlessAllowed") && (
 <div className="flex items-center gap-3 p-3 rounded-md border border-border md:col-span-2">
 <Switch checked={form.cashlessAllowed} onCheckedChange={v => update("cashlessAllowed", v)} data-testid="switch-cashless" />
 <div><LabelWithTip tip="Holder can net-exercise: instead of paying strike×shares, they receive only the in-the-money shares. Common for venture warrants."><Label className="cursor-pointer">Cashless exercise allowed</Label></LabelWithTip><p className="text-xs text-muted-foreground">Holder can net-exercise without paying cash; engine computes net shares delivered.</p></div>
 </div>
 )}
 {usesField("poolSize") && (
 <div><LabelWithTip tip="How big the new pool is, as a percentage of fully-diluted shares. VCs typically require 10–15% post-money pool at Series A."><Label>Pool size (% of fully-diluted)</Label></LabelWithTip><Input type="number" step="0.5" className="mt-1 font-mono" value={form.poolSize} onChange={e => update("poolSize", e.target.value)} data-testid="input-pool" /></div>
 )}
 {usesField("poolTiming") && (
 <div className="md:col-span-2"><LabelWithTip tip="Pre-money pool is created BEFORE the round and dilutes founders only. Post-money is created AFTER the round and dilutes everyone proportionally. VCs almost always require pre-money."><Label>Pool timing</Label></LabelWithTip>
 <Select value={form.poolTiming} onValueChange={v => update("poolTiming", v)}>
 <SelectTrigger className="mt-1" data-testid="select-timing"><SelectValue /></SelectTrigger>
 <SelectContent>{ESOP_TIMING.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
 </Select>
 </div>
 )}
 {usesField("vestingMonths") && (
 <>
 <div><LabelWithTip tip="Total vesting length. Standard is 48 months (4 years) for both founder stock and employee options."><Label>Vesting (months)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.vestingMonths} onChange={e => update("vestingMonths", e.target.value)} data-testid="input-vest" /></div>
 <div><LabelWithTip tip="Minimum tenure before any equity vests. Standard is 12 months. Leave before the cliff = leave with nothing vested."><Label>Cliff (months)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.cliffMonths} onChange={e => update("cliffMonths", e.target.value)} data-testid="input-cliff" /></div>
 </>
 )}
 {usesField("jurisdictionVariant") && (
 <div className="md:col-span-2"><LabelWithTip tip="Picks the correct option-tax framework for your country. ISO/NSO are US, EMI/CSOP are UK, CCPC is Canadian. Affects how option grants are taxed at exercise."><Label>ESOP variant</Label></LabelWithTip>
 <Select value={form.jurisdictionVariant} onValueChange={v => update("jurisdictionVariant", v)}>
 <SelectTrigger className="mt-1" data-testid="select-esop-variant"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="us_iso">US — ISO (Incentive Stock Options, $100k limit)</SelectItem>
 <SelectItem value="us_nso">US — NSO (Nonqualified Stock Options)</SelectItem>
 <SelectItem value="ca_ccpc">Canada — CCPC stock options</SelectItem>
 <SelectItem value="uk_emi">UK — EMI (£250k per employee)</SelectItem>
 <SelectItem value="uk_csop">UK — CSOP (£60k per employee)</SelectItem>
 <SelectItem value="sg_esop">Singapore — ESOP under MAS framework</SelectItem>
 </SelectContent>
 </Select>
 </div>
 )}
 {usesField("targetAmount") && (
 <div><LabelWithTip tip="The smallest cheque you'll accept. Sets a floor that filters out small angels you don't have time to manage. Common: $25k–$100k for seed; $250k+ for Series A."><Label>Minimum ticket (USD)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.minTicket} onChange={e => update("minTicket", e.target.value)} data-testid="input-min" /></div>
 )}
 </div>
 )}

 {step === 3 && (
 <div className="grid md:grid-cols-2 gap-5">
 <div><Label>Open date</Label><Input type="date" className="mt-1" value={form.openDate} onChange={e => update("openDate", e.target.value)} data-testid="input-open" /></div>
 <div><Label>Target close date</Label><Input type="date" className="mt-1" value={form.closeDate} onChange={e => update("closeDate", e.target.value)} data-testid="input-close" /></div>
 <div className="md:col-span-2"><Label>Round narrative for investors</Label><Textarea rows={4} className="mt-1" value={form.notes} onChange={e => update("notes", e.target.value)} data-testid="input-notes" /></div>
 <div className="md:col-span-2">
 <Label className="flex items-center gap-1.5">Use of proceeds <HelpTip>How the round capital will be deployed. Standard pitch-deck slide; investors review this before committing. Aim for explicit per-bucket % + dollar amounts.</HelpTip></Label>
 <Textarea rows={3} className="mt-1" placeholder="e.g. 50% engineering hires (12 FTE / 18mo); 20% compute; 22% GTM; 8% legal…" value={form.useOfProceeds} onChange={e => update("useOfProceeds", e.target.value)} data-testid="input-uop" />
 </div>
 <div className="md:col-span-2 flex items-start gap-3 p-3 rounded-md border border-border">
 <Switch checked={form.tranches} onCheckedChange={v => update("tranches", v)} data-testid="switch-tranches" />
 <div className="flex-1">
 <LabelWithTip tip="For larger rounds: split the close into two or more tranches tied to milestones. Each tranche is its own funded event."><Label className="cursor-pointer">Round closes in tranches</Label></LabelWithTip>
 <p className="text-xs text-muted-foreground mt-0.5">Toggle on for milestone-gated tranches. Each tranche emits its own immutable round_close-tranche telemetry event.</p>
 {form.tranches && (
 <Textarea rows={3} className="mt-2" placeholder="Tranche 1: $X concurrent with signing. Tranche 2: $Y on milestone Z by date.…" value={form.tranchesPlan} onChange={e => update("tranchesPlan", e.target.value)} data-testid="input-tranches-plan" />
 )}
 </div>
 </div>
 </div>
 )}

 {step === 4 && (
 <div className="space-y-3 text-sm">
 <h3 className="text-base font-semibold">{form.name}</h3>
 <div className="flex flex-wrap gap-2">
 <Badge variant="outline">{ROUND_TYPES.find(t => t.value === form.type)?.label}</Badge>
 <Badge className="bg-[hsl(184_98%_22%)]">{instrument.label}</Badge>
 <Badge variant="outline">Region: {form.region}</Badge>
 {attachToRound && <Badge variant="outline" className="border-[hsl(184_98%_22%)] text-[hsl(184_98%_22%)]">Attached to {attachToRound}</Badge>}
 </div>
 <div className="p-3 rounded-md bg-secondary/40 border border-border font-mono text-xs">{engineSummary()}</div>
 <p className="pt-3 text-muted-foreground">{form.notes}</p>

 {/* Sprint 11 D4 — Warrants/ESOP attach to a parent round */}
 {(form.instrument === "warrant" || form.instrument === "option_pool") && (
 <div className="pt-4 mt-4 border-t border-border space-y-3" data-testid="attach-prompt">
 <div className="flex items-center gap-2 font-medium">
 Attach to an existing round?
 <HelpTip>Warrants and ESOP top-ups don't stand alone — they're typically tied to a parent priced or convertible round so the cap-table reconciliation chains the events together.</HelpTip>
 </div>
 <Select value={attachToRound || "none"} onValueChange={(v) => setAttachToRound(v === "none" ? "" : v)}>
 <SelectTrigger className="max-w-md" data-testid="select-parent-round"><SelectValue placeholder="Pick a parent round (optional)" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="none">No parent (standalone)</SelectItem>
 {(parentRoundsQ.data ?? []).map((r) => (
  <SelectItem key={r.id} value={r.id}>{r.name}{r.series ? ` (${r.series})` : ""}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 {attachToRound && <p className="text-xs text-muted-foreground">Captable ledger will chain this issuance under {attachToRound}.</p>}
 </div>
 )}

 <div className="pt-4 mt-4 border-t border-border space-y-3" data-testid="termsheet-prompt">
 <div className="flex items-center gap-2 font-medium">
 Would you like to create a term sheet for this round now?
 <HelpTip>A term sheet is a non-binding summary of the principal investment terms (instrument, valuation, liquidation preference, etc.). Investors expect to see one before they commit. Capavate generates region-appropriate templates citing NVCA, BVCA, J-KISS, CCPS and other standards — then you sign electronically (SES, ESIGN-compliant).</HelpTip>
 </div>
 {(form.instrument === "warrant" || form.instrument === "option_pool") && (
 <div className="rounded-md border border-[hsl(184_98%_22%)]/40 bg-[hsl(184_98%_22%)]/5 p-3 text-xs" data-testid="banner-no-termsheet">
 <strong>{instrument.label}</strong> issuances don't require a separate term sheet — the parent round's terms govern. We'll skip term-sheet generation for this issuance.
 </div>
 )}
 <div className="space-y-2" style={{ display: (form.instrument === "warrant" || form.instrument === "option_pool") ? "none" : undefined }}>
 <label className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/40 cursor-pointer" data-testid="radio-termsheet-generate-row">
 <input
 type="radio"
 name="ts-choice"
 checked={termsheetChoice === "generate"}
 onChange={() => setTermsheetChoice("generate")}
 data-testid="radio-termsheet-generate"
 className="mt-1"
 />
 <div>
 <div className="font-medium">Generate a region-appropriate term sheet for me</div>
 <div className="text-xs text-muted-foreground mt-0.5">We render a citation-backed template for your region + instrument and let you edit any section before signing.</div>
 </div>
 </label>
 <label className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/40 cursor-pointer" data-testid="radio-termsheet-upload-row">
 <input
 type="radio"
 name="ts-choice"
 checked={termsheetChoice === "upload"}
 onChange={() => setTermsheetChoice("upload")}
 data-testid="radio-termsheet-upload"
 className="mt-1"
 />
 <div>
 <div className="font-medium">Upload my own term sheet (PDF or DOCX)</div>
 <div className="text-xs text-muted-foreground mt-0.5">We extract the headline terms and reconcile them against the round you just configured before signing.</div>
 </div>
 </label>
 <label className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/40 cursor-pointer" data-testid="radio-termsheet-skip-row">
 <input
 type="radio"
 name="ts-choice"
 checked={termsheetChoice === "skip"}
 onChange={() => setTermsheetChoice("skip")}
 data-testid="radio-termsheet-skip"
 className="mt-1"
 />
 <div>
 <div className="font-medium">Skip for now</div>
 <div className="text-xs text-muted-foreground mt-0.5">Create the round and revisit term sheets from the round detail page later.</div>
 </div>
 </label>
 </div>
 </div>
 </div>
 )}

 <div className="flex justify-between pt-3 border-t border-border">
 <Button variant="ghost" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1} data-testid="button-prev"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
 {step < 4 ? (
 <Button onClick={() => setStep(s => s + 1)} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-next">Continue <ArrowRight className="h-4 w-4 ml-2" /></Button>
 ) : (
 <Button onClick={() => createRoundMut.mutate()} disabled={createRoundMut.isPending} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-create">{createRoundMut.isPending ? "Creating..." : "Create round"}</Button>
 )}
 </div>
 </CardContent>
 </Card>
 {(step === 2 || step === 3) && companyId && instrumentToCarryForwardRoundType(form.instrument) && (
 <div className="space-y-3" data-testid="carry-forward-sidebar">
 <RoundCarryForwardPanel
 companyId={companyId}
 roundType={instrumentToCarryForwardRoundType(form.instrument)!}
 roundId=""
 />
 </div>
 )}
 </div>
 </PageBody>
 </>
 );
}
