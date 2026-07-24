import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useActiveCompany, useActiveCompanyId } from "@/lib/useActiveCompany";
import UpgradeToProInterstitial, { isPaidFounderPlan } from "@/pages/founder/UpgradeToProInterstitial";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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

// v23.4.9 Phase 2 (Avi feedback #3) — surface Warrants as a top-level round
// category. Avi (30 May 2026): "along with priced round and unpriced round,
// there should be an option to choose warrants, but here the warrant is working
// like a radio button." We add a 3-way segmented control ABOVE the instrument
// list that filters which investment vehicles are shown. Each category maps to
// a fixed set of instrument values; the first value is the default when the
// founder switches categories.
type RoundCategory = "priced" | "unpriced" | "warrants";
const ROUND_CATEGORIES: { value: RoundCategory; label: string; instruments: InstrumentValue[] }[] = [
 { value: "priced", label: "Priced Round", instruments: ["preferred", "common"] },
 { value: "unpriced", label: "Unpriced Round", instruments: ["safe_post", "safe_pre", "convertible_note"] },
 { value: "warrants", label: "Warrants & Options", instruments: ["warrant", "option_pool"] },
];
function categoryForInstrument(instrument: InstrumentValue): RoundCategory {
 const hit = ROUND_CATEGORIES.find(c => c.instruments.includes(instrument));
 return hit ? hit.value : "priced";
}

const STEPS = [
 { id: 1, title: "Round + Vehicle", desc: "Round type and instrument" },
 { id: 2, title: "Terms", desc: "Per-instrument fields" },
 { id: 3, title: "Schedule", desc: "Open + close + narrative" },
 // v23.4.8 Phase 2 / BUG 012 — founder can add initial investors (CRM or manual)
 // BEFORE the term sheet step so non-Capavate investors land on the round.
 { id: 4, title: "Investors", desc: "Pick from CRM or add manually" },
 { id: 5, title: "Review", desc: "Confirm and create" },
];

// v23.4.8 Phase 2 / BUG 012 — shape sent to the PATCH endpoint.
type WizardInitialShareholder = {
 name: string;
 // v25.51 5a — discrete identity fields captured for manual (non-Capavate)
 // investors. Optional so CRM-sourced picks (which only supply a display name)
 // stay valid; `name` remains the backward-compat display composite.
 firstName?: string;
 lastName?: string;
 company?: string;
 email: string;
 checkSize: string;
 // Wave C3 (Shadie 2a) — optional personal note added to this investor's
 // invitation email (message only; never the round terms).
 note?: string | null;
 // W3 Shadie 3a — optional stage focus + invite expiry (days) for manual picks.
 stageFocus?: string | null;
 expiryDays?: number | null;
 source: "crm" | "manual";
 crmContactId?: string;
};

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
 // BUG 033 fix v23.7 — monetary/numeric/date inputs start EMPTY. The previous
 // hardcoded figures (target "2000000", pre-money "18000000", etc.) were mock
 // placeholders that pre-filled the wizard with fictional deal economics. Real
 // founders must enter their own values; guidance is carried by the field
 // placeholders, not by seeded state. Enum/boolean UX defaults (type,
 // instrument, region, mfn, anti-dilution, etc.) are intentionally preserved.
 targetAmount: "",
 preMoney: "",
 // v23.4.9 Phase 1 (Avi #2) — share price is DERIVED for priced rounds
 // (pre-money ÷ shares authorized), so it must start EMPTY rather than
 // carrying a hardcoded mock value. The previous "1.42" default was also a
 // v23.4.5 mock-data violation that slipped through. For warrants/SAFEs the
 // share price is an explicit input (strikePrice / valuationCap), so this
 // pricePerShare field is never shown for them and the change is safe.
 pricePerShare: "",
 minTicket: "",
 valuationCap: "",
 discount: "",
 interestRate: "",
 maturityMonths: "",
 mfn: true,
 liqPrefMultiple: "1",
 participating: false,
 capParticipation: "",
 antiDilution: "broad_based_wa",
 strikePrice: "",
 expiryYears: "",
 cashlessAllowed: true,
 poolSize: "",
 poolTiming: "pre_money",
 vestingMonths: "",
 cliffMonths: "",
 jurisdictionVariant: "us_iso",
 sharesAuthorized: "",
 openDate: "",
 closeDate: "",
 notes: "",
 useOfProceeds: "",
 tranches: false,
 tranchesPlan: "",
};

// v23.9 C3 — a numeric input that displays a thousands-separated value while
// storing the raw, comma-free string. The server (POST /api/rounds) strips
// commas/whitespace/$ defensively (v23.9 A2), but formatting the display here
// makes large currency figures readable as the founder types. The stored
// `value` stays a plain numeric string so downstream parsing is unchanged.
function formatWithCommas(raw: string): string {
 if (raw == null || raw === "") return "";
 const negative = raw.trim().startsWith("-");
 const cleaned = raw.replace(/[^\d.]/g, "");
 if (cleaned === "") return negative ? "-" : "";
 const [intPart, ...rest] = cleaned.split(".");
 const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
 const decimal = rest.length > 0 ? "." + rest.join("") : (cleaned.endsWith(".") ? "." : "");
 return (negative ? "-" : "") + grouped + decimal;
}

function FormattedNumberInput(props: {
 value: string;
 onChange: (raw: string) => void;
 className?: string;
 placeholder?: string;
 readOnly?: boolean;
 "aria-readonly"?: boolean;
 "data-testid"?: string;
}) {
 const { value, onChange, ...rest } = props;
 return (
 <Input
 type="text"
 inputMode="decimal"
 value={formatWithCommas(value)}
 onChange={(e) => {
 // Strip grouping so the stored value is a clean numeric string.
 const raw = e.target.value.replace(/[,\s$]/g, "");
 onChange(raw);
 }}
 {...rest}
 />
 );
}

export default function RoundNew() {
 const { toast } = useToast();
 const [, navigate] = useLocation();
 const [step, setStep] = useState(1);
 // v25.51 7a — default to "skip". The "generate" option is hidden + inactivated
 // (dormant/restorable, like the partner Branding tab) so it can never be
 // pre-selected or submitted. Do NOT delete the block (rule #78).
 const [termsheetChoice, setTermsheetChoice] = useState<"generate" | "upload" | "skip">("skip");
 // Sprint 11 D4 — Warrants/ESOP attach to a parent round (no own term sheet)
 const [attachToRound, setAttachToRound] = useState<string>("");
 // A4 (W-FIX1c) — optional warrant + option-pool ADD-ONS that run in PARALLEL
 // with a priced/unpriced round. Warrants/ESOP are no longer a mutually-exclusive
 // category: within a priced/unpriced round the founder can also attach warrants
 // and/or an option pool, which chain-create as parentRoundId-attached
 // warrant/option_pool rounds via the SAME /api/rounds endpoint on success — so
 // they appear in the cap table alongside the priced holders. The standalone
 // Warrants category is preserved (no silent-drop).
 const [addonWarrant, setAddonWarrant] = useState(false);
 const [addonWarrantDraft, setAddonWarrantDraft] = useState({ sharesAuthorized: "", strikePrice: "", expiryYears: "10" });
 const [addonPool, setAddonPool] = useState(false);
 const [addonPoolDraft, setAddonPoolDraft] = useState({ poolSize: "" });
 const [form, setForm] = useState<FormShape>(defaultForm);
 // v23.9 C1 — when the founder manually edits the auto-derived price per share,
 // this flag stops the auto-sync effect from clobbering their value. Reset
 // whenever the instrument changes (priced ↔ non-priced) so the default
 // behaviour is always "auto" for a fresh instrument choice.
 const [pricePerShareOverridden, setPricePerShareOverridden] = useState(false);
 // v23.4.8 Phase 2 / BUG 012 — initial-shareholders state (step 4).
 const [selectedShareholders, setSelectedShareholders] = useState<WizardInitialShareholder[]>([]);
 const [manualOpen, setManualOpen] = useState(false);
 // Wave C3 (Shadie 2a) — optional personal note added to the standard invitation
 // email for this manually-added investor (only the message; not the terms).
 // W3 Shadie 3a — manual-investor draft now also carries stageFocus (optional)
 // and expiryDays (invite window; default 14). expiryDays is a string in the
 // draft for the <select>, coerced to a number on add.
 const [manualDraft, setManualDraft] = useState<{ firstName: string; lastName: string; company: string; email: string; checkSize: string; note: string; stageFocus: string; expiryDays: string }>({ firstName: "", lastName: "", company: "", email: "", checkSize: "", note: "", stageFocus: "", expiryDays: "14" });
 // Exact-HTML preview of the invitation email for the manual dialog.
 const [manualPreviewHtml, setManualPreviewHtml] = useState<string | null>(null);
 // Wave C3 (Shadie 7a) — round-name uniqueness hint. When the typed name
 // collides with an existing round for this company, we auto-fill an editable
 // unique suggestion so the founder is never blocked and never ships two
 // same-named rounds (which confuses investors).
 const [roundNameHint, setRoundNameHint] = useState<string | null>(null);

 // Defect A — use real active companyId (never hardcode co_novapay).
 const companyId = useActiveCompanyId();

 // v23.4.11 Phase 1 (B-201) — read the active company so we can plan-gate the
 // round wizard with an explicit interstitial instead of a silent /subscribe
 // redirect. We read from the SAME query the header/switcher uses
 // (/api/founder/active-company) so the displayed company name + plan never
 // drift from the top-bar, which also addresses the active-company "snap back"
 // symptom. Hook is unconditional (no early return before it) so React hook
 // ordering is preserved.
 const activeCompanyQ = useActiveCompany();
 const activeCompany = activeCompanyQ.data?.company ?? null;
 const activePlan = activeCompany?.billing?.plan ?? null;

 // BUG-005: round creation requires a company. Redirect to company setup if none.
 // This guard must come before any hooks that depend on companyId to avoid
 // React hooks ordering violations.
 // (companyId null = loading OR no company; we handle loading below in the render)

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
 // B-302 fix v23.4.13: include name in round-create payload
 const payload = {
 companyId,
 type: form.type,
 instrument: form.instrument,
 name: form.name || undefined,
 // W-AVI43 Issue 1 fix: the wizard captured Step 3 open/close dates in
 // form.openDate/form.closeDate and validated them client-side, but they were
 // never included in this create payload — so the server always received an
 // empty openDate and rejected with OPEN_DATE_REQUIRED (Avi's report). Send the
 // trimmed date strings; the server (POST /api/rounds) enforces both are present
 // and that close >= open, and persists them via the non-sacred roundsStore.
 openDate: (form.openDate ?? "").trim(),
 closeDate: (form.closeDate ?? "").trim(),
 // Decimal-as-string values — preserved end-to-end at 38-digit precision.
 // v25.51 8a: only send preMoney/targetAmount when the instrument actually
 // uses them. For a common priced round Step 2 renders no inputs for these, so
 // coercing empty → "0" injected a phantom "0" that tripped the server's
 // targetAmount>0 and priced-preMoney guards with no on-screen field to fix.
 // Omit (null) when unused; server derives targetAmount = PPS × shares for common.
 targetAmount: usesField("targetAmount") ? requiredDecimalString(form.targetAmount) : null,
 preMoney: usesField("preMoney") ? requiredDecimalString(form.preMoney) : null,
 pricePerShare: optionalDecimalString(form.pricePerShare),
 valuationCap: optionalDecimalString(form.valuationCap),
 discount: optionalDecimalString(form.discount),
 interestRate: optionalDecimalString(form.interestRate),
 // v25.53 N1 — warrants derive their target raise server-side from
 // strikePrice × sharesAuthorized, so both must reach the server. They were
 // captured in the wizard but never sent, which (with no Target-amount field
 // on the Warrant Terms step) made warrants uncreatable.
 strikePrice: usesField("strikePrice") ? optionalDecimalString(form.strikePrice) : null,
 expiryYears: usesField("expiryYears") ? optionalIntegerString(form.expiryYears) : null,
 // Integer-as-string — share counts use BigInt internally, never float.
 maturityMonths: optionalIntegerString(form.maturityMonths),
 sharesAuthorized: optionalIntegerString(form.sharesAuthorized),
 poolSize: optionalIntegerString(form.poolSize),
 region: form.region,
 termsheetChoice,
 // v25.20 Lane 5 NC fix: persist parent-round attachment for warrants/ESOP.
 // The wizard captured `attachToRound` but never sent it; server auto-stashes
 // unknown fields into extras_json, so this restores the cap-table ledger chain.
 parentRoundId:
 (form.instrument === "warrant" || form.instrument === "option_pool")
 ? (attachToRound || null)
 : null,
 };
 return (await apiRequest("POST", "/api/rounds", payload)).json();
 },
 onSuccess: async (data: { id: string }) => {
 queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
 // v23.4.8 Phase 2 / BUG 012 — persist initial-shareholders picks against
 // the new round via the dedicated (non-sacred) endpoint. Failure here is
 // non-fatal: the round is already created and the picker can be revisited.
 // Wave C2 (Shadie 1a/1b) — Step-4 picks are now issued round invitations
 // server-side (they land in the Invitations table AND get emailed), so we
 // surface the invitation summary instead of silently swallowing.
 let inviteSummary: { invited?: number; skippedNoEmail?: number; inviteErrors?: Array<{ email: string; error: string }> } | null = null;
 // W-AVI64 FIX 1 — track a TOTAL failure of the picks PATCH so we don't
 // silently swallow it. If the request itself throws, the investors were
 // neither recorded nor invited; the founder must be told (not left guessing).
 let picksPatchFailed = false;
 if (selectedShareholders.length > 0) {
 try {
 const r = await apiRequest("PATCH", `/api/founder/rounds/${data.id}/initial-shareholders`, {
 companyId,
 shareholders: selectedShareholders.map((s) => ({
 name: s.name,
 // v25.51 5a — persist discrete first/last/company alongside the composed
 // display name (null for CRM picks that don't supply them).
 firstName: s.firstName ?? null,
 lastName: s.lastName ?? null,
 company: s.company ?? null,
 email: s.email || null,
 checkSize: s.checkSize || null,
 // Wave C3 (Shadie 2a) — carry the personal note so the server injects it
 // into this investor's invitation email.
 note: s.note ?? null,
 // W3 Shadie 3a — carry stage focus + invite expiry into the invitation.
 stageFocus: s.stageFocus ?? null,
 expiryDays: s.expiryDays ?? null,
 source: s.source,
 crmContactId: s.crmContactId ?? null,
 })),
 });
 inviteSummary = await r.json().catch(() => null);
 } catch {
 /* non-fatal: round exists; investors can be added from the round page.
    W-AVI64 FIX 1 — but flag it so the toast tells the founder the picks
    were not recorded/invited rather than silently swallowing. */
 picksPatchFailed = true;
 }
 }
 // A4 (W-FIX1c) — chain-create the optional parallel warrant / option-pool
 // issuances attached to the just-created parent round. Reuses the SAME
 // /api/rounds endpoint + the existing parentRoundId cap-table ledger chain, so
 // warrants/ESOP coexist with the priced/unpriced round rather than replacing
 // it. Only runs for a non-warrant parent flow; failures are non-fatal (the
 // parent round already exists and add-ons can be created from the round page).
 let addonCreated = 0;
 const parentIsWarrantFlow = form.instrument === "warrant" || form.instrument === "option_pool";
 if (!parentIsWarrantFlow) {
 const addonPayloads: Record<string, unknown>[] = [];
 if (addonWarrant && /^\d+$/.test(addonWarrantDraft.sharesAuthorized.trim()) && /^\d+(\.\d+)?$/.test(addonWarrantDraft.strikePrice.trim())) {
 addonPayloads.push({
 companyId, type: form.type, instrument: "warrant",
 name: `${form.name || "Round"} — Warrants`,
 openDate: (form.openDate ?? "").trim(), closeDate: (form.closeDate ?? "").trim(),
 strikePrice: addonWarrantDraft.strikePrice.trim(),
 expiryYears: (addonWarrantDraft.expiryYears || "10").trim(),
 sharesAuthorized: addonWarrantDraft.sharesAuthorized.trim(),
 region: form.region, termsheetChoice: "skip", parentRoundId: data.id,
 });
 }
 if (addonPool && /^\d+$/.test(addonPoolDraft.poolSize.trim())) {
 addonPayloads.push({
 companyId, type: form.type, instrument: "option_pool",
 name: `${form.name || "Round"} — Option Pool`,
 openDate: (form.openDate ?? "").trim(), closeDate: (form.closeDate ?? "").trim(),
 poolSize: addonPoolDraft.poolSize.trim(), sharesAuthorized: addonPoolDraft.poolSize.trim(),
 region: form.region, termsheetChoice: "skip", parentRoundId: data.id,
 });
 }
 for (const p of addonPayloads) {
 try { await apiRequest("POST", "/api/rounds", p); addonCreated += 1; } catch { /* non-fatal */ }
 }
 }
 const invited = inviteSummary?.invited ?? 0;
 const noEmail = inviteSummary?.skippedNoEmail ?? 0;
 const failed = inviteSummary?.inviteErrors?.length ?? 0;
 // W3 Shadie 5a — on the "Upload my own term sheet" path, do NOT declare the
 // round "active": the founder's mental model is that the round finalizes after
 // the term sheet is uploaded. Use upload-forward copy there; keep the "active"
 // copy for the skip/generate paths.
 const isUploadPath = termsheetChoice === "upload";
 const parts: string[] = [isUploadPath ? "Next: upload your term sheet." : `Round ${data.id} is now active.`];
 if (invited > 0) parts.push(`${invited} investor${invited === 1 ? "" : "s"} invited by email.`);
 if (noEmail > 0) parts.push(`${noEmail} added without an email (no invite sent).`);
 if (failed > 0) parts.push(`${failed} invitation${failed === 1 ? "" : "s"} could not be sent.`);
 // W-AVI64 FIX 1 — surface a TOTAL picks-PATCH failure so the founder knows
 // the selected investors were not added/invited (add them from the round page).
 if (picksPatchFailed) parts.push(`Your selected investors could not be saved to the round — add them from the round page.`);
 if (addonCreated > 0) parts.push(`${addonCreated} warrant/option-pool issuance${addonCreated === 1 ? "" : "s"} attached to this round.`);
 toast({
  title: isUploadPath ? "Almost done — upload your term sheet" : "Round created",
  description: isUploadPath
   ? `Once your term sheet is uploaded, the round will be created.${parts.length > 1 ? " " + parts.slice(1).join(" ") : ""}`
   : parts.join(" "),
  variant: (failed > 0 || picksPatchFailed) ? "destructive" : undefined,
 });
 // Shadie V6 7a — respect the Step-5 term-sheet choice. "upload" routes
 // straight to the term-sheet page WITH ?action=upload so it lands directly on
 // the Upload panel (Generate was removed entirely per Ozan). "skip" goes to
 // the round detail.
 if (termsheetChoice === "upload") {
 navigate(`/founder/rounds/${data.id}/termsheet?action=upload`);
 } else {
 navigate(`/founder/rounds/${data.id}`);
 }
 },
 onError: (err: unknown) => {
  // Wave C3 (Shadie 7a) backstop — if two rounds race to the same name, the
  // server returns 409 ROUND_NAME_DUPLICATE with an editable unique suggestion.
  // Auto-apply it to the name field and tell the founder to re-submit.
  if (err instanceof ApiError && err.code === "ROUND_NAME_DUPLICATE") {
   const payload = err.payload as { suggestedName?: string } | undefined;
   if (payload?.suggestedName) {
    update("name", payload.suggestedName);
    setRoundNameHint(`That round name is already in use at this stage. Renamed to “${payload.suggestedName}” — review and create again.`);
   }
   toast({ title: "Round name already used", description: "Round names must be unique within a stage. We suggested a unique name — review and create again.", variant: "destructive" });
   return;
  }
  // v24.1 Bug B (Avi #2): surface server field-level validation errors so the
  // founder learns exactly which field is wrong instead of a generic toast.
  if (err instanceof ApiError && err.code === "validation_failed") {
   const payload = err.payload as { fieldErrors?: Record<string, string> } | undefined;
   const fe = payload?.fieldErrors;
   if (fe && Object.keys(fe).length > 0) {
    const lines = Object.entries(fe).map(([field, reason]) => `• ${field}: ${reason}`);
    toast({
     title: "Please fix the highlighted fields",
     description: lines.join("\n"),
     variant: "destructive",
    });
    return;
   }
  }
  toast({ title: "Failed to create round", variant: "destructive" });
 },
 });

 // Sprint 8 — default round wizard region from the live company profile so a
 // country change in /founder/company propagates here on next mount.
 const profileQ = useQuery<CompanyProfile>({ queryKey: ["/api/companies", companyId, "profile"] });

 // Parent-round picker (warrants/ESOP attach). Loaded from the active company's rounds.
 const parentRoundsQ = useQuery<Array<{ id: string; name: string; series?: string }>>({
  queryKey: ["/api/companies", companyId, "rounds"],
  queryFn: async () => {
   if (!companyId) return [];
   // v25.10 M3 — include cookies for Safari + cross-origin compatibility.
   const r = await fetch(`/api/companies/${encodeURIComponent(companyId)}/rounds`, { credentials: "include" });
   if (!r.ok) return [];
   const data = await r.json();
   return Array.isArray(data) ? data : [];
  },
  enabled: Boolean(companyId),
 });

 // v23.4.8 Phase 2 / BUG 012 — CRM contacts feed the wizard's Investors step.
 type WizardCrmRow = { id: string; name: string; firmName?: string; email?: string; region?: string; stage?: string };
 const crmQ = useQuery<WizardCrmRow[]>({
  queryKey: ["/api/founder/investor-crm", companyId],
  queryFn: async () => {
   if (!companyId) return [];
   const r = await apiRequest("GET", `/api/founder/investor-crm?companyId=${encodeURIComponent(companyId)}`);
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

 // v23.4.9 Phase 2 (Avi #3) — the active top-level round category is derived
 // directly from the chosen instrument (single source of truth, no separate
 // state to drift). Switching category resets the instrument to the first
 // vehicle in that category and clears the auto-derived price.
 const roundCategory: RoundCategory = categoryForInstrument(form.instrument);
 const setRoundCategory = (next: RoundCategory) => {
 const cat = ROUND_CATEGORIES.find(c => c.value === next);
 if (!cat || cat.instruments.length === 0) return;
 if (cat.instruments.includes(form.instrument)) return; // already in category
 const firstInstrument = cat.instruments[0];
 setForm(f => ({ ...f, instrument: firstInstrument, pricePerShare: "" }));
 setPricePerShareOverridden(false);
 };

 const instrument = INSTRUMENTS.find(i => i.value === form.instrument)!;
 const usesField = (f: string) => (instrument.fields as readonly string[]).includes(f);
 // v23.4.9 Phase 2 — vehicles shown in the instrument grid, filtered to the
 // active category so warrants are a deliberate top-level choice rather than
 // one radio button buried in a long list.
 const visibleInstruments = INSTRUMENTS.filter(i =>
 (ROUND_CATEGORIES.find(c => c.value === roundCategory)?.instruments ?? []).includes(i.value as InstrumentValue),
 );

 // v23.4.9 Phase 1 (Avi #2) — Share price auto-calculation.
 // For PRICED rounds (Common / Preferred) the price per share is a DERIVED
 // value, not a manual input. The cap-table engine itself derives it as
 // pre_money_valuation ÷ fully_diluted_shares (see
 // packages/cap-table-engine/src/captable/compute.ts), so the wizard mirrors
 // that here for live display only — the engine remains the source of truth
 // on commit. We use the simpler pre-money ÷ shares-authorized pair that the
 // wizard exposes. SAFEs / Convertible Notes don't expose this field (price
 // is set at conversion); Warrants use an explicit strikePrice that stays
 // editable. So this read-only derivation applies ONLY to priced rounds.
 const isPricedInstrument = form.instrument === "preferred" || form.instrument === "common";
 // W-FIX2 F5 — investor-grade PPS: pre-money ÷ fully-diluted PRE-MONEY shares
 // INCLUDING the option-pool top-up (the "pool shuffle"). When the founder
 // attaches an option pool to this priced round (addonPool below), a pre-money
 // pool of p% grosses the FD denominator up to existingFD / (1 − p) — the pool
 // is carved out of the pre-money, diluting founders before new money lands,
 // which correctly LOWERS the price per share. With no pool it reduces to the
 // plain pre-money ÷ FD-shares. The engine remains source-of-truth on commit.
 const poolTopUpPct = (() => {
 if (!addonPool) return 0;
 const p = Number(addonPoolDraft.poolSize);
 if (!isFinite(p) || p <= 0 || p >= 100) return 0;
 return p / 100;
 })();
 const fdPreMoneyShares = (() => {
 const shares = Number(form.sharesAuthorized);
 if (!isFinite(shares) || shares <= 0) return 0;
 return poolTopUpPct > 0 ? shares / (1 - poolTopUpPct) : shares;
 })();
 const derivedPricePerShare = (() => {
 const pre = Number(form.preMoney);
 if (!isPricedInstrument) return "";
 if (!isFinite(pre) || pre <= 0 || fdPreMoneyShares <= 0) return "";
 // Keep full precision as a string; the engine re-derives at 38-digit
 // precision on commit. Trim trailing zeros for display cleanliness.
 const v = pre / fdPreMoneyShares;
 return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
 })();

 // Keep form.pricePerShare in sync with the derived value for priced rounds so
 // the computed price is what travels to the server on commit. For warrants /
 // SAFEs we never touch it here (the field isn't shown for them).
 useEffect(() => {
 if (!isPricedInstrument) return;
 // v23.9 C1 — respect a manual override: once the founder types their own
 // price, the auto-derivation no longer overwrites it.
 if (pricePerShareOverridden) return;
 if (form.pricePerShare !== derivedPricePerShare) {
 setForm(f => ({ ...f, pricePerShare: derivedPricePerShare }));
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [isPricedInstrument, derivedPricePerShare, pricePerShareOverridden]);

 // Recommended instruments for the chosen round type, marked with a Sparkles badge
 const recommended = INSTRUMENTS.filter(i => (i.suggestedFor as readonly string[]).includes(form.type)).map(i => i.value);

 const post = Number(form.preMoney) + Number(form.targetAmount) || 0;

 // v25.51 3a — a round must not close before it opens. Block Step 3 → Next and
 // Create when both dates are present and the open date is after the close date.
 // The server enforces the same rule (invalid_closeDate) as a backstop.
 const dateRangeInvalid =
 !!form.openDate && !!form.closeDate &&
 new Date(form.openDate).getTime() > new Date(form.closeDate).getTime();

 // Shadie V6 1a (Ozan spec) — past Open / Target-close dates are now ALLOWED
 // (a founder may record a historical/closed round). We enforce ONLY that the
 // Target close date is on or after the Open date (dateRangeInvalid, above),
 // plus the 4-digit-year / valid-calendar checks below. The server mirrors
 // this: it keeps the invalid_closeDate (close<open) guard but no longer
 // rejects past dates.
 // N4 — a native <input type="date"> yields ISO yyyy-mm-dd; a valid year is
 // exactly 4 digits. Reject anything else (guards the "07062026" → 70620 bug
 // if the value ever arrives from a non-native picker / paste).
 const badYear = (iso: string): boolean => {
 if (!iso) return false;
 const m = /^(\d+)-\d{2}-\d{2}$/.exec(iso);
 if (!m) return true;
 return m[1].length !== 4;
 };
 const openDateMalformed = badYear(form.openDate);
 const closeDateMalformed = badYear(form.closeDate);
 // W3 Shadie 1a (Ozan spec) — BOTH Open date and Target close date are now
 // MANDATORY. Previously an empty date passed every check (badYear("")===false,
 // dateRangeInvalid needs both present) so Step 3 advanced with blank dates.
 const openDateMissing = !(form.openDate ?? "").trim();
 const closeDateMissing = !(form.closeDate ?? "").trim();
 const scheduleInvalid =
 dateRangeInvalid || openDateMalformed || closeDateMalformed || openDateMissing || closeDateMissing;

 // v25.53 1a / N2 / N3 — per-vehicle required-field validation for Step 2
 // (Terms). Previously Continue advanced with empty price/shares and the step
 // showed a false green "complete" check. We now compute field-level errors per
 // instrument and gate Continue (and Create) until they resolve. The server
 // re-validates every field (fail-closed) as the backstop.
 const numOf = (s: string): number => {
 const n = Number((s ?? "").toString().replace(/[,\s$]/g, ""));
 return isFinite(n) ? n : NaN;
 };
 // Effective price per share: the derived value for priced rounds unless the
 // founder overrode it. For common there is no pre-money field so the derived
 // value is empty and the founder must Override to enter an explicit price
 // (N3) — either way this must resolve to > 0.
 const effectivePps = isPricedInstrument
 ? (pricePerShareOverridden ? form.pricePerShare : derivedPricePerShare)
 : form.pricePerShare;
 const step2Errors: Record<string, string> = (() => {
 const e: Record<string, string> = {};
 const reqPos = (field: keyof FormShape, label: string) => {
 if (!usesField(field as string)) return;
 if (!(numOf(form[field] as string) > 0)) e[field as string] = `${label} is required and must be greater than 0.`;
 };
 switch (form.instrument) {
 case "common":
 reqPos("sharesAuthorized", "Shares authorized");
 if (!(numOf(effectivePps) > 0)) e.pricePerShare = "Price per share is required and must be greater than 0.";
 break;
 case "preferred":
 reqPos("preMoney", "Pre-money valuation");
 reqPos("targetAmount", "Target raise");
 if (!(numOf(effectivePps) > 0)) e.pricePerShare = "Price per share is required and must be greater than 0.";
 break;
 case "safe_post":
 case "safe_pre":
 reqPos("targetAmount", "Target raise");
 if (!(numOf(form.valuationCap) > 0) && !(numOf(form.discount) > 0)) e.valuationCap = "Enter a valuation cap or a discount.";
 break;
 case "convertible_note":
 reqPos("targetAmount", "Target raise");
 if (!(numOf(form.valuationCap) > 0) && !(numOf(form.discount) > 0)) e.valuationCap = "Enter a valuation cap or a discount.";
 reqPos("maturityMonths", "Maturity (months)");
 break;
 case "warrant":
 reqPos("sharesAuthorized", "Shares authorized");
 reqPos("strikePrice", "Strike price");
 reqPos("expiryYears", "Expiry (years)");
 break;
 case "option_pool":
 reqPos("poolSize", "Pool size");
 break;
 }
 return e;
 })();
 const step2Valid = Object.keys(step2Errors).length === 0;

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

 // BUG-005 fix: if no active company, show a clear message and link to company setup.
 // This is a render-time guard (after all hooks) — not an early return before hooks.
 if (companyId === null || companyId === "") {
 return (
 <>
 <PageHeader
 title="New round"
 description="Create a company profile first, then you can open rounds."
 breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { href: "/founder/rounds", label: "Rounds" }, { label: "New" }]}
 />
 <PageBody>
 <div className="max-w-md mx-auto mt-16 text-center p-8 border rounded-lg bg-muted/30">
 <h2 className="text-lg font-semibold mb-2">No company yet</h2>
 <p className="text-muted-foreground mb-6">
 You need to create your company profile before opening a funding round.
 </p>
 <Button
 asChild
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
 >
 <a href="/founder/company">Create company profile</a>
 </Button>
 </div>
 </PageBody>
 </>
 );
 }

 // v23.4.11 Phase 1 (B-201) — plan gate. A company exists but if it is on a
 // Free tier the round wizard is not available. Previously the App-level
 // RequireActiveSubscription / route logic silently bounced these founders to
 // /founder/subscribe with no feedback. Instead we render an explicit
 // interstitial that explains why and offers clear CTAs. This is a render-time
 // guard (after all hooks) — never an early return before hooks. We wait for
 // the active-company query to resolve so we never flash the gate while the
 // real (possibly paid) plan is still loading.
 if (!activeCompanyQ.isLoading && !isPaidFounderPlan(activePlan)) {
 return (
 <UpgradeToProInterstitial
 currentPlan={activePlan ?? "Founder Free"}
 companyName={activeCompany?.companyName ?? ""}
 />
 );
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
 <button onClick={() => setStep(s.id)} className={`flex items-center gap-3 px-4 py-2 rounded-md border transition ${active ? "border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)]/10" : done ? "border-emerald-300/70 bg-emerald-50 " : "border-border text-muted-foreground hover:bg-secondary"}`}>
 <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold ${active ? "bg-[hsl(0_100%_40%)] text-white" : done ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
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
 <Input
 className="mt-1"
 value={form.name}
 onChange={e => { update("name", e.target.value); if (roundNameHint) setRoundNameHint(null); }}
 data-testid="input-round-name"
 onBlur={async () => {
 const nm = form.name.trim();
 if (!nm || !companyId) { setRoundNameHint(null); return; }
 try {
 const res = await apiRequest("GET", `/api/rounds/name-availability?companyId=${encodeURIComponent(companyId)}&name=${encodeURIComponent(nm)}`);
 const j = await res.json().catch(() => null);
 if (j && j.available === false && j.suggestedName) {
 // Auto-fill the editable unique suggestion + explain why.
 update("name", j.suggestedName);
 setRoundNameHint(`“${nm}” is already used for this company. Renamed to “${j.suggestedName}” — edit if you like.`);
 } else {
 setRoundNameHint(null);
 }
 } catch { setRoundNameHint(null); }
 }}
 />
 {roundNameHint && (
 <p className="text-[11px] text-amber-600 mt-1" data-testid="round-name-uniqueness-hint">{roundNameHint}</p>
 )}
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
 {/* v23.4.9 Phase 2 (Avi #3) — top-level round-category segmented
 control. Three deliberate choices instead of warrants hiding as one
 radio button in a long vehicle list. */}
 <Label>Round category</Label>
 <Tabs
 value={roundCategory}
 onValueChange={(v) => setRoundCategory(v as RoundCategory)}
 className="mt-1 mb-4"
 >
 <TabsList className="grid w-full grid-cols-3" data-testid="round-category-tabs">
 {ROUND_CATEGORIES.map(cat => (
 <TabsTrigger
 key={cat.value}
 value={cat.value}
 // A3/O7 — Radix's controlled `onValueChange` can miss the very first
 // pointer interaction (the platform-wide first-click no-op), leaving the
 // derived `roundCategory` stuck on its initial value. An explicit
 // idempotent onClick guarantees the category switch registers on the first
 // click; setRoundCategory early-returns if already in-category, so calling
 // it alongside onValueChange is harmless.
 onClick={() => setRoundCategory(cat.value)}
 data-testid={`round-category-${cat.value}`}
 >
 {cat.label}
 </TabsTrigger>
 ))}
 </TabsList>
 </Tabs>

 <Label>Investment vehicle</Label>
 <p className="text-xs text-muted-foreground mb-3 mt-1">Pick the instrument the engine will issue. Each vehicle exposes its own terms in Step 2.</p>
 <div className="grid md:grid-cols-2 gap-3">
 {visibleInstruments.map(inst => {
 const selected = form.instrument === inst.value;
 const isRecommended = recommended.includes(inst.value);
 return (
 <div
 key={inst.value}
 role="button"
 tabIndex={0}
 aria-pressed={selected}
 onClick={() => update("instrument", inst.value)}
 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); update("instrument", inst.value); } }}
 data-testid={`instrument-${inst.value}`}
 className={`text-left p-4 rounded-lg border-2 transition cursor-pointer ${selected
 ? "border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)]/5 ring-2 ring-[hsl(0_100%_40%)]/20"
 : "border-border hover:border-[hsl(0_100%_40%)]/50 hover:bg-secondary/50"}`}
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
 <Badge className="text-[10px] bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_40%)] text-white"><Check className="h-2.5 w-2.5 mr-1" />selected</Badge>
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
 <Info className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
 <span>The selected vehicle is wired to <code className="px-1 py-0.5 bg-background border border-border rounded">@capavate/cap-table-engine</code> region <code className="px-1 py-0.5 bg-background border border-border rounded">{form.region}</code>. Step 2 only renders the fields this instrument needs. Cap-table impact is computed live on Review.</span>
 </div>
 </div>
 )}

 {step === 2 && (
 <div className="grid md:grid-cols-2 gap-5">
 {usesField("targetAmount") && (
 <div><LabelWithTip tip="How much new money you want this round to bring in. Investors look at progress vs. this number to decide whether to commit."><Label>Target raise (USD)</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.targetAmount} onChange={v => update("targetAmount", v)} data-testid="input-target" />{step2Errors.targetAmount && <p className="text-xs text-rose-500 mt-1" data-testid="err-targetAmount">{step2Errors.targetAmount}</p>}</div>
 )}
 {usesField("preMoney") && (
 <>
 <div><LabelWithTip tip="The agreed value of your company BEFORE the new money lands. Pre-money + new money = post-money."><Label>Pre-money valuation (USD)</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.preMoney} onChange={v => update("preMoney", v)} data-testid="input-pre" />{step2Errors.preMoney && <p className="text-xs text-rose-500 mt-1" data-testid="err-preMoney">{step2Errors.preMoney}</p>}</div>
 <div><LabelWithTip tip="Calculated automatically: pre-money + target raise. This is the company's valuation immediately after the round closes."><Label>Implied post-money</Label></LabelWithTip><Input className="mt-1 font-mono bg-secondary/50" value={`$${post.toLocaleString()}`} readOnly data-testid="input-post" /></div>
 </>
 )}
 {usesField("pricePerShare") && (
 <div data-testid="pps-block">
 {/* v23.4.9 Phase 1 (Avi #2) — priced rounds: PPS is auto-calculated and
 read-only. Avi: "the share price has to be entered manually, whereas
 it should be calculated automatically based on the value." */}
 <LabelWithTip tip="Calculated automatically: pre-money valuation ÷ shares authorized. Edit pre-money or shares-authorized above to change it, or click Override to enter a price manually. (SAFE / Convertible Note rounds hide this field — PPS is set at conversion, not at issue.)">
 <Label className="flex items-center gap-1.5">Price per share (USD) <Badge variant="outline" className="text-[10px]">{pricePerShareOverridden ? "manual" : "auto"}</Badge></Label>
 </LabelWithTip>
 {/* v25.51 2a — grouping commas via FormattedNumberInput (decimals preserved
 by formatWithCommas). Auto/override + derivedPricePerShare wiring kept intact;
 the stored value stays a clean numeric string (commas stripped on change). */}
 <FormattedNumberInput
 className={`mt-1 font-mono ${pricePerShareOverridden ? "" : "bg-secondary/50"}`}
 value={pricePerShareOverridden ? form.pricePerShare : derivedPricePerShare}
 readOnly={!pricePerShareOverridden}
 aria-readonly={!pricePerShareOverridden}
 onChange={(v) => { if (pricePerShareOverridden) update("pricePerShare", v); }}
 placeholder="Enter pre-money and shares authorized"
 data-testid="input-pps"
 />
 <div className="flex items-center justify-between mt-1">
 <p className="text-[11px] text-muted-foreground font-mono" data-testid="pps-formula">
 PPS = pre_money ÷ FD_pre_money_shares{poolTopUpPct > 0 ? " (incl. option-pool top-up)" : ""}
 {fdPreMoneyShares > 0 ? ` — FD = ${Math.round(fdPreMoneyShares).toLocaleString()}` : ""}
 </p>
 <button
 type="button"
 className="text-[11px] text-primary underline-offset-2 hover:underline"
 onClick={() => {
 setPricePerShareOverridden(prev => {
 const next = !prev;
 // Returning to auto re-syncs to the derived value immediately.
 if (!next) setForm(f => ({ ...f, pricePerShare: derivedPricePerShare }));
 return next;
 });
 }}
 data-testid="btn-pps-override"
 >
 {pricePerShareOverridden ? "Use auto" : "Override"}
 </button>
 </div>
 {step2Errors.pricePerShare && <p className="text-xs text-rose-500 mt-1" data-testid="err-pricePerShare">{step2Errors.pricePerShare}</p>}
 </div>
 )}
 {usesField("sharesAuthorized") && (
 <div><LabelWithTip tip="How many new shares this issuance creates. For a Foundation round, this is your founder allocation. For a warrant or option grant, it's the underlying share count."><Label>Shares authorized</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.sharesAuthorized} onChange={v => update("sharesAuthorized", v)} data-testid="input-shares" />{step2Errors.sharesAuthorized && <p className="text-xs text-rose-500 mt-1" data-testid="err-sharesAuthorized">{step2Errors.sharesAuthorized}</p>}</div>
 )}
 {usesField("valuationCap") && (
 <div><LabelWithTip tip="The maximum valuation at which this SAFE/Note converts to shares. Lower cap = more dilution to founders, more upside for the investor. Most early SAFEs use $5M–$15M caps."><Label>Valuation cap (USD)</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.valuationCap} onChange={v => update("valuationCap", v)} data-testid="input-cap" />{step2Errors.valuationCap && <p className="text-xs text-rose-500 mt-1" data-testid="err-valuationCap">{step2Errors.valuationCap}</p>}</div>
 )}
 {usesField("discount") && (
 <div><LabelWithTip tip="Percentage off the priced-round share price the SAFE/Note investor gets. 20% means they pay $0.80 for what new investors pay $1.00. Standard range is 10–25%."><Label>Discount (%)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.discount} onChange={e => update("discount", e.target.value)} data-testid="input-disc" /></div>
 )}
 {usesField("interestRate") && (
 <div><LabelWithTip tip="Annual interest rate on the convertible note. Accrues until conversion. Standard range is 4–8% APR."><Label>Interest rate (% APR)</Label></LabelWithTip><Input type="number" step="0.1" className="mt-1 font-mono" value={form.interestRate} onChange={e => update("interestRate", e.target.value)} data-testid="input-int" /></div>
 )}
 {usesField("maturityMonths") && (
 <div><LabelWithTip tip="Months until the note legally matures. If you haven't priced a round by then, the holder can demand repayment OR force conversion. Standard is 18–24 months."><Label>Maturity (months)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.maturityMonths} onChange={e => update("maturityMonths", e.target.value)} data-testid="input-maturity" />{step2Errors.maturityMonths && <p className="text-xs text-rose-500 mt-1" data-testid="err-maturityMonths">{step2Errors.maturityMonths}</p>}</div>
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
 <div><LabelWithTip tip="What the warrant holder pays per share to exercise. Typically set at the fair market value at issuance."><Label>Strike price (USD)</Label></LabelWithTip><Input type="number" step="0.01" className="mt-1 font-mono" value={form.strikePrice} onChange={e => update("strikePrice", e.target.value)} data-testid="input-strike" />{step2Errors.strikePrice && <p className="text-xs text-rose-500 mt-1" data-testid="err-strikePrice">{step2Errors.strikePrice}</p>}</div>
 )}
 {usesField("expiryYears") && (
 <div><LabelWithTip tip="How long the warrant remains exercisable. Standard is 7–10 years for venture warrants."><Label>Expiry (years)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.expiryYears} onChange={e => update("expiryYears", e.target.value)} data-testid="input-expiry" />{step2Errors.expiryYears && <p className="text-xs text-rose-500 mt-1" data-testid="err-expiryYears">{step2Errors.expiryYears}</p>}</div>
 )}
 {usesField("cashlessAllowed") && (
 <div className="flex items-center gap-3 p-3 rounded-md border border-border md:col-span-2">
 <Switch checked={form.cashlessAllowed} onCheckedChange={v => update("cashlessAllowed", v)} data-testid="switch-cashless" />
 <div><LabelWithTip tip="Holder can net-exercise: instead of paying strike×shares, they receive only the in-the-money shares. Common for venture warrants."><Label className="cursor-pointer">Cashless exercise allowed</Label></LabelWithTip><p className="text-xs text-muted-foreground">Holder can net-exercise without paying cash; engine computes net shares delivered.</p></div>
 </div>
 )}
 {usesField("poolSize") && (
 <div><LabelWithTip tip="How big the new pool is, as a percentage of fully-diluted shares. VCs typically require 10–15% post-money pool at Series A."><Label>Pool size (% of fully-diluted)</Label></LabelWithTip><Input type="number" step="0.5" className="mt-1 font-mono" value={form.poolSize} onChange={e => update("poolSize", e.target.value)} data-testid="input-pool" />{step2Errors.poolSize && <p className="text-xs text-rose-500 mt-1" data-testid="err-poolSize">{step2Errors.poolSize}</p>}</div>
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
 <div><Label className="flex items-center gap-1">Open date <span className="text-rose-500">*</span></Label><Input type="date" className={`mt-1 ${(openDateMalformed || openDateMissing) ? "border-rose-500 focus-visible:ring-rose-500" : ""}`} value={form.openDate} onChange={e => update("openDate", e.target.value)} data-testid="input-open" />{openDateMalformed ? <p className="text-xs text-rose-500 mt-1" data-testid="open-date-malformed">Enter a valid date with a 4-digit year.</p> : openDateMissing ? <p className="text-xs text-rose-500 mt-1" data-testid="open-date-required">Open date is required.</p> : null}</div>
 <div><Label className="flex items-center gap-1">Target close date <span className="text-rose-500">*</span></Label><Input type="date" className={`mt-1 ${(dateRangeInvalid || closeDateMalformed || closeDateMissing) ? "border-rose-500 focus-visible:ring-rose-500" : ""}`} value={form.closeDate} onChange={e => update("closeDate", e.target.value)} data-testid="input-close" />{closeDateMalformed ? <p className="text-xs text-rose-500 mt-1" data-testid="close-date-malformed">Enter a valid date with a 4-digit year.</p> : closeDateMissing ? <p className="text-xs text-rose-500 mt-1" data-testid="close-date-required">Target close date is required.</p> : null}</div>
 {dateRangeInvalid && (
 <p className="md:col-span-2 text-xs text-rose-500" data-testid="date-range-error">Target close date must be on or after the open date.</p>
 )}
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
 <div className="space-y-4" data-testid="step-investors">
 <div className="flex items-start justify-between gap-3">
 <div>
 <p className="text-sm font-semibold">Add initial shareholders</p>
 <p className="text-xs text-muted-foreground mt-1">Pick investors from your CRM, or add non-Capavate investors manually. You can also skip this step and add them after the round is created.</p>
 </div>
 <div className="flex gap-2 shrink-0">
 <Button variant="outline" size="sm" onClick={() => setManualOpen(true)} data-testid="button-add-manual-shareholder">+ Add investor manually</Button>
 <Button variant="ghost" size="sm" onClick={() => { setSelectedShareholders([]); setStep(5); }} data-testid="button-skip-shareholders">Skip</Button>
 </div>
 </div>
 <div className="grid md:grid-cols-2 gap-3">
 <div className="rounded-md border" data-testid="crm-available-column">
 <div className="px-3 py-2 border-b bg-secondary/30 text-xs font-semibold">Available from your CRM ({(crmQ.data ?? []).length})</div>
 <div className="max-h-80 overflow-y-auto divide-y">
 {(crmQ.data ?? []).length === 0 && (
 <div className="p-3 text-xs text-muted-foreground">No CRM contacts yet — use “Add investor manually”.</div>
 )}
 {(crmQ.data ?? []).map((c) => {
 const already = selectedShareholders.some((s) => s.source === "crm" && s.crmContactId === c.id);
 // W-AVI64 FIX 1 — a CRM contact with no email on file cannot be invited
 // (the server needs an email to create the round_invitation). Rather than
 // silently adding an un-invitable row that never reaches the investor, we
 // block "+ Add" and tell the founder why, so they can add an email first.
 const crmEmail = (c.email ?? "").trim();
 const hasEmail = crmEmail.length > 0;
 return (
 <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`crm-row-${c.id}`}>
 <div className="min-w-0">
 <div className="font-medium truncate">{c.name}</div>
 <div className="text-xs text-muted-foreground truncate">{c.firmName ?? "—"} · {c.email ?? "no email"}{c.stage ? ` · ${String(c.stage).replace("_", " ")}` : ""}</div>
 {!hasEmail && (
 <div className="text-[11px] text-amber-600 mt-0.5" data-testid={`crm-no-email-hint-${c.id}`}>no email on file — add one to invite</div>
 )}
 </div>
 <Button
 size="sm"
 variant={already ? "ghost" : "outline"}
 disabled={already || !hasEmail}
 title={!hasEmail ? "This CRM contact has no email on file — add one to invite them." : undefined}
 onClick={() => setSelectedShareholders((prev) => [...prev, { name: c.name, email: crmEmail, checkSize: "", source: "crm", crmContactId: c.id }])}
 data-testid={`button-add-crm-${c.id}`}
 >{already ? "Added" : "+ Add"}</Button>
 </div>
 );
 })}
 </div>
 </div>
 <div className="rounded-md border" data-testid="selected-column">
 <div className="px-3 py-2 border-b bg-secondary/30 text-xs font-semibold">Selected for this round ({selectedShareholders.length})</div>
 <div className="max-h-80 overflow-y-auto divide-y">
 {selectedShareholders.length === 0 && (
 <div className="p-3 text-xs text-muted-foreground">No investors yet — add some from the left or click “+ Add investor manually”.</div>
 )}
 {selectedShareholders.map((s, idx) => (
 <div key={`${s.source}_${s.crmContactId ?? s.email ?? s.name}_${idx}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`selected-row-${idx}`}>
 <div className="min-w-0 flex-1">
 <div className="font-medium truncate">{s.name} <span className="text-[10px] uppercase tracking-wide text-muted-foreground">({s.source})</span></div>
 <div className="text-xs text-muted-foreground truncate">{s.email || "no email"}</div>
 <FormattedNumberInput
 className="mt-1 h-8 text-xs font-mono"
 placeholder="Check size (USD)"
 value={s.checkSize}
 onChange={(raw) => setSelectedShareholders((prev) => {
 const next = prev.slice();
 next[idx] = { ...s, checkSize: raw };
 return next;
 })}
 data-testid={`input-check-size-${idx}`}
 />
 </div>
 <Button
 size="sm"
 variant="ghost"
 onClick={() => setSelectedShareholders((prev) => prev.filter((_, i) => i !== idx))}
 data-testid={`button-remove-${idx}`}
 >Remove</Button>
 </div>
 ))}
 </div>
 </div>
 </div>
 {manualOpen && (
 <Dialog open onOpenChange={(o) => !o && setManualOpen(false)}>
 <DialogContent>
 <DialogHeader><DialogTitle>Add a non-Capavate investor</DialogTitle></DialogHeader>
 <div className="space-y-3">
 {/* v25.51 5a — capture first/last/company as discrete fields (per Ozan).
 First + last + email are mandatory; company is optional. `name` is composed
 as "First Last" for backward-compat display consumers. */}
 <div className="grid grid-cols-2 gap-3">
 <div><Label className="flex items-center gap-1">First name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={manualDraft.firstName} onChange={(e) => setManualDraft({ ...manualDraft, firstName: e.target.value })} data-testid="input-manual-first-name" /></div>
 <div><Label className="flex items-center gap-1">Last name <span className="text-rose-500">*</span></Label><Input className="mt-1" value={manualDraft.lastName} onChange={(e) => setManualDraft({ ...manualDraft, lastName: e.target.value })} data-testid="input-manual-last-name" /></div>
 </div>
 <div><Label>Company name (optional)</Label><Input className="mt-1" value={manualDraft.company} onChange={(e) => setManualDraft({ ...manualDraft, company: e.target.value })} data-testid="input-manual-company" /></div>
 <div><Label className="flex items-center gap-1">Email <span className="text-rose-500">*</span></Label><Input className="mt-1" type="email" value={manualDraft.email} onChange={(e) => setManualDraft({ ...manualDraft, email: e.target.value })} data-testid="input-manual-email" /></div>
 <div><Label>Check size (USD, optional)</Label><FormattedNumberInput className="mt-1" value={manualDraft.checkSize} onChange={(raw) => setManualDraft({ ...manualDraft, checkSize: raw })} data-testid="input-manual-check-size" /></div>
 {/* Wave C3 (Shadie 2a) — optional personal note added to the standard
     invitation email (message only; the round terms/name are unchanged). */}
 <div>
 <Label>Personal note (optional)</Label>
 <Input className="mt-1" value={manualDraft.note} onChange={(e) => { setManualDraft({ ...manualDraft, note: e.target.value }); setManualPreviewHtml(null); }} placeholder="Great meeting you at the event last week…" data-testid="input-manual-note" />
 <p className="text-[11px] text-muted-foreground mt-1">Added to the standard invitation email. Only your message — not the terms, duration or round name.</p>
 </div>
 {/* W3 Shadie 3a — Stage focus (optional) + Expires in (days). Both are
     threaded into the round invitation issued on round creation. */}
 <div>
 <Label>Stage focus (optional)</Label>
 <Input className="mt-1" value={manualDraft.stageFocus} onChange={(e) => setManualDraft({ ...manualDraft, stageFocus: e.target.value })} placeholder="e.g. Seed–Series A, deep tech" data-testid="input-manual-stage-focus" />
 </div>
 <div>
 <Label>Expires in</Label>
 <Select value={manualDraft.expiryDays} onValueChange={(v) => setManualDraft({ ...manualDraft, expiryDays: v })}>
 <SelectTrigger className="mt-1" data-testid="select-manual-expiry"><SelectValue /></SelectTrigger>
 <SelectContent>
 {[7, 14, 30, 60, 90].map((d) => (
 <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
 ))}
 </SelectContent>
 </Select>
 {/* Show BOTH the number of days AND the actual calendar date (Ozan). */}
 <p className="text-[11px] text-muted-foreground mt-1" data-testid="manual-expiry-hint">
 {(() => {
 const d = Number(manualDraft.expiryDays) || 14;
 const dt = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
 const cal = dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
 return `${d} days · expires ${cal}`;
 })()}
 </p>
 </div>
 {/* Exact-HTML preview of the email this investor will receive. */}
 <div>
 <Button type="button" variant="outline" size="sm" data-testid="button-preview-manual-invite"
 onClick={async () => {
 try {
 const res = await apiRequest("POST", `/api/companies/${encodeURIComponent(companyId ?? "")}/invitation-preview`, {
 investorName: `${manualDraft.firstName} ${manualDraft.lastName}`.trim() || undefined,
 roundName: form.name || undefined,
 note: manualDraft.note || undefined,
 });
 const j = await res.json().catch(() => null);
 setManualPreviewHtml(j?.preview?.html ?? "");
 } catch {
 setManualPreviewHtml("<p>Could not build preview.</p>");
 }
 }}>Preview email</Button>
 {manualPreviewHtml !== null && (
 <div className="mt-2 border rounded-md p-3 bg-white max-h-56 overflow-auto text-sm" data-testid="manual-invite-email-preview">
 <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Email preview — exactly what the investor will receive</div>
 <div dangerouslySetInnerHTML={{ __html: manualPreviewHtml }} />
 </div>
 )}
 </div>
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
 <Button
 disabled={!manualDraft.firstName.trim() || !manualDraft.lastName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualDraft.email.trim())}
 onClick={() => {
 const first = manualDraft.firstName.trim();
 const last = manualDraft.lastName.trim();
 setSelectedShareholders((prev) => [...prev, { name: `${first} ${last}`.trim(), firstName: first, lastName: last, company: manualDraft.company.trim(), email: manualDraft.email.trim(), checkSize: manualDraft.checkSize.trim(), note: manualDraft.note.trim() || null, stageFocus: manualDraft.stageFocus.trim() || null, expiryDays: Number(manualDraft.expiryDays) || 14, source: "manual" }]);
 setManualDraft({ firstName: "", lastName: "", company: "", email: "", checkSize: "", note: "", stageFocus: "", expiryDays: "14" });
 setManualPreviewHtml(null);
 setManualOpen(false);
 }}
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
 data-testid="button-confirm-manual-shareholder"
 >Add to round</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 )}
 </div>
 )}

 {step === 5 && (
 <div className="space-y-3 text-sm">
 <h3 className="text-base font-semibold">{form.name}</h3>
 <div className="flex flex-wrap gap-2">
 <Badge variant="outline">{ROUND_TYPES.find(t => t.value === form.type)?.label}</Badge>
 <Badge className="bg-[hsl(0_100%_40%)]">{instrument.label}</Badge>
 <Badge variant="outline">Region: {form.region}</Badge>
 {attachToRound && <Badge variant="outline" className="border-[hsl(0_100%_40%)] text-[hsl(0_100%_40%)]">Attached to {attachToRound}</Badge>}
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

 {/* A4 (W-FIX1c) — optional warrants / option-pool that run IN PARALLEL with
 this priced/unpriced round. They attach to this round and appear in the cap
 table alongside the priced holders — they do NOT replace the round. The
 standalone Warrants category remains available for a warrant-only raise. */}
 {(form.instrument !== "warrant" && form.instrument !== "option_pool") && (
 <div className="pt-4 mt-4 border-t border-border space-y-3" data-testid="addon-warrants-section">
 <div className="flex items-center gap-2 font-medium">
 Add warrants / option pool (optional)
 <HelpTip>A <strong>warrant</strong> is a right to buy shares at a fixed strike price within an expiry window. An <strong>option pool (ESOP)</strong> reserves shares for employees. Both can run alongside this round — they attach to it and show up in the cap table together, so you don't need a separate raise for them.</HelpTip>
 </div>
 <label className="flex items-start gap-2 text-sm">
 <input type="checkbox" className="mt-1" checked={addonWarrant} onChange={e => setAddonWarrant(e.target.checked)} data-testid="addon-warrant-toggle" />
 <span>Attach warrants to this round</span>
 </label>
 {addonWarrant && (
 <div className="grid md:grid-cols-3 gap-3 pl-6" data-testid="addon-warrant-fields">
 <div><Label className="text-xs">Warrant shares</Label><Input type="number" className="mt-1 font-mono" value={addonWarrantDraft.sharesAuthorized} onChange={e => setAddonWarrantDraft(d => ({ ...d, sharesAuthorized: e.target.value }))} data-testid="addon-warrant-shares" /></div>
 <div><Label className="text-xs">Strike price (USD)</Label><Input type="number" step="0.01" className="mt-1 font-mono" value={addonWarrantDraft.strikePrice} onChange={e => setAddonWarrantDraft(d => ({ ...d, strikePrice: e.target.value }))} data-testid="addon-warrant-strike" /></div>
 <div><Label className="text-xs">Expiry (years)</Label><Input type="number" className="mt-1 font-mono" value={addonWarrantDraft.expiryYears} onChange={e => setAddonWarrantDraft(d => ({ ...d, expiryYears: e.target.value }))} data-testid="addon-warrant-expiry" /></div>
 </div>
 )}
 <label className="flex items-start gap-2 text-sm">
 <input type="checkbox" className="mt-1" checked={addonPool} onChange={e => setAddonPool(e.target.checked)} data-testid="addon-pool-toggle" />
 <span>Add / top up an option pool (ESOP)</span>
 </label>
 {addonPool && (
 <div className="grid md:grid-cols-3 gap-3 pl-6" data-testid="addon-pool-fields">
 <div><Label className="text-xs">Pool size (shares)</Label><Input type="number" className="mt-1 font-mono" value={addonPoolDraft.poolSize} onChange={e => setAddonPoolDraft(d => ({ ...d, poolSize: e.target.value }))} data-testid="addon-pool-size" /></div>
 </div>
 )}
 {(addonWarrant || addonPool) && (
 <p className="text-[11px] text-muted-foreground">These issuances are created together with the round and chained to it in the cap-table ledger.</p>
 )}
 </div>
 )}

 <div className="pt-4 mt-4 border-t border-border space-y-3" data-testid="termsheet-prompt">
 <div className="flex items-center gap-2 font-medium">
 Would you like to create a term sheet for this round now?
 <HelpTip>A term sheet is a non-binding summary of the principal investment terms (instrument, valuation, liquidation preference, etc.). Investors expect to see one before they commit. Capavate generates region-appropriate templates citing NVCA, BVCA, J-KISS, CCPS and other standards — then you sign electronically (SES, ESIGN-compliant).</HelpTip>
 </div>
 {(form.instrument === "warrant" || form.instrument === "option_pool") && (
 <div className="rounded-md border border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5 p-3 text-xs" data-testid="banner-no-termsheet">
 <strong>{instrument.label}</strong> issuances don't require a separate term sheet — the parent round's terms govern. We'll skip term-sheet generation for this issuance.
 </div>
 )}
 <div className="space-y-2" style={{ display: (form.instrument === "warrant" || form.instrument === "option_pool") ? "none" : undefined }}>
 {/* v25.51 7a — HIDDEN + INACTIVE (dormant, restorable). Not deleted per
 rule #78. Disabled + display:none so it can never be selected or submitted. */}
 <label className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-secondary/40 cursor-pointer" style={{ display: "none" }} aria-hidden="true" data-testid="radio-termsheet-generate-row">
 <input
 type="radio"
 name="ts-choice"
 disabled
 tabIndex={-1}
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
 {step < 5 ? (
 <Button onClick={() => setStep(s => s + 1)} disabled={(step === 2 && !step2Valid) || (step === 3 && scheduleInvalid)} className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-next">Continue <ArrowRight className="h-4 w-4 ml-2" /></Button>
 ) : (
 <Button onClick={() => createRoundMut.mutate()} disabled={createRoundMut.isPending || scheduleInvalid || !step2Valid} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-create">{createRoundMut.isPending ? "Creating..." : "Create round"}</Button>
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
