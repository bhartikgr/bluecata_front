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
import { INVITE_EXPIRY_OPTIONS, DEFAULT_INVITE_EXPIRY_DAYS } from "@/lib/inviteExpiry";
import { GlossaryLink } from "@/components/Glossary";
import { HelpTip, LabelWithTip, LearnMore } from "@/components/HelpTip";
import RoundCarryForwardPanel from "@/components/RoundCarryForwardPanel";
// WAVE 52 — exact-decimal round mathematics with mandatory denominator labels
// and named refusals. See client/src/lib/roundMath.ts.
import {
  buildCapTablePreview,
  commonNotionalRaise,
  computePostMoney,
  derivePricePerShare,
  deriveInvestorShares,
  describeResidual,
  /* WAVE 58 · R27 — the option pool is a PERCENTAGE of fully diluted. */
  derivePoolTopUpFromPercent,
  parsePoolPercentAsWritten,
  /* WAVE 58c · A2 — the SHARE-COUNT unit, for instruments that have no price and
     therefore no definable percentage of post-money fully-diluted. */
  parsePoolShareCountAsWritten,
  /* WAVE 58d · B2 — `T × PPS` reconciled against `pre-money + new money`, as
     `CAPTABLE_MATH_INDUSTRY_STANDARD.md` requires. */
  reconcileImpliedCapitalisation,
  DENOM_LABEL_SHORT,
  DENOM_LABEL_TEXT,
  formatPct,
} from "@/lib/roundMath";
/* WAVE 58b · DEFECT 3 — the ONE base resolver, shared with the server round-math
   route and derived from the engine's own fully-diluted total. */
import {
  resolveFdPreMoneyBase,
  unconvertedConvertibleCount,
  /* WAVE 58c · A3 — the non-throwing ledger read for this render-scope caller. */
  tryLedgerFullyDilutedPreMoneyShares,
  /* WAVE 58e · D1/D3 — the ONE range rule and the ONE disclosure for the discount,
     imported from the same shared module the server routes call, so the wizard and
     the Edit-terms modal cannot validate differently — which is exactly what the
     two option-pool fields did on live. */
  validateDiscountPercentAsWritten,
  describeDiscount,
  /* WAVE 69 · V-2 (R56) — the approved date-shape WARNING, on the CREATE surface.
     Creation is where the corrupt live round came from, so the warning has to be
     here too. It warns; it is never added to `step2Errors` and never blocks
     `step2Valid`, because that would make it a refusal and contradict R56. */
  dateShapedValueWarning,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
/* WAVE 69 · V-1b (R58) — read the server's OWN sentence. `ApiError.message` is
   replaced with a generic string by `queryClient.ts:63` for anything ≥ 240 chars,
   and every R50 refusal is 424-543. */
import { serverRefusalMessage } from "@/lib/serverRefusalMessage";

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
 // Wave C v26.5.0 (Shadie Finding 1a) — fully-diluted pre-money share count.
 // Used ONLY as the PPS denominator for post-formation priced rounds
 // (pre-money ÷ FD shares, grossed up for any pool top-up). Foundation rounds
 // do NOT collect this (foundation is the formation event; no prior FD count).
 // Distinct from `sharesAuthorized` which is NEW shares issued in this round.
 fdPreMoneyShares: string;
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
 fdPreMoneyShares: "",   // Wave C v26.5.0
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
 /* ── WAVE 58 · R27 — THE POOL IS ENTERED AS A PERCENTAGE ────────────────────
    Owner ruling R27 (2026-08-15), asked directly after a live walkthrough of
    this wizard: "make it a percentage." `poolPercent` is PERCENT-AS-WRITTEN
    (R16 / OR-1): the founder types 15, the state holds "15", it travels as "15"
    and it is read as 15%. There is no division-by-one-hundred at any layer.

    `poolSize` IS NOT REMOVED and IS STILL SENT. It is now a DERIVED value —
    the share count the percentage produces — written by the effect below rather
    than typed. Every existing consumer of `addonPoolDraft.poolSize` (the
    `option_pool` child-round payload, the price-per-share gross-up, the Review
    derivation) therefore keeps working unchanged, and existing rounds that
    stored a share count keep reading correctly. R27's no-silent-drop constraint
    is satisfied by RELOCATION, not removal: the share count is still on screen,
    still labelled "Pool size (shares)", still under data-testid
    "addon-pool-size" — as an OUTPUT the founder can see.

    `poolMode` makes the pre-money / post-money PLACEMENT explicit, because
    placement decides WHO PAYS for the pool. There was no such control anywhere
    in the wizard before this wave. */
 const [addonPoolDraft, setAddonPoolDraft] = useState<{
  poolSize: string;
  poolPercent: string;
  poolMode: "pre_money" | "post_money";
 }>({ poolSize: "", poolPercent: "", poolMode: "pre_money" });
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
 // and expiryDays (invite window; default 7). expiryDays is a string in the
 // draft for the <select>, coerced to a number on add.
 const [manualDraft, setManualDraft] = useState<{ firstName: string; lastName: string; company: string; email: string; checkSize: string; note: string; stageFocus: string; expiryDays: string }>({ firstName: "", lastName: "", company: "", email: "", checkSize: "", note: "", stageFocus: "", expiryDays: String(DEFAULT_INVITE_EXPIRY_DAYS) });
 // Exact-HTML preview of the invitation email for the manual dialog.
 const [manualPreviewHtml, setManualPreviewHtml] = useState<string | null>(null);
 // Wave C3 (Shadie 7a) — round-name uniqueness hint. When the typed name
 // collides with an existing round for this company, we auto-fill an editable
 // unique suggestion so the founder is never blocked and never ships two
 // same-named rounds (which confuses investors).
 const [roundNameHint, setRoundNameHint] = useState<string | null>(null);
 /* WAVE 73 · ITEM 3 (finishes WAVE 69 · V-1b) — THE REFUSAL HAS TO STAY ON THE
    SCREEN. Wave 69 put the server's sentence in a TOAST here, and Wave 69's own
    report measured that a default toast node is GONE ~10 SECONDS after it
    appears. Its report also states that persistent inline copy is the required
    treatment and the toast is a secondary announcement — it did that on the EDIT
    dialog and stopped short on CREATION, which is the surface the corrupt live
    round came through. This state holds the same sentence next to the button that
    failed, until the founder changes something. */
 const [createRefusal, setCreateRefusal] = useState<string | null>(null);

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
 // Wave C v26.5.0 (Shadie Finding 1a) — preMoney is now in
 // INSTRUMENTS.common.fields (previously only in preferred). For a Foundation
 // round the input is hidden (render gate is `!isFoundationRound`) so
 // form.preMoney stays "" — without this second gate the payload would send
 // requiredDecimalString("") which coerces to "0", tripping the server's
 // priced-preMoney>0 guard for common. Foundation ALWAYS omits preMoney so
 // the payload sends null, matching v25.51 8a's original invariant.
 preMoney: usesField("preMoney") && form.type !== "foundation"
 ? requiredDecimalString(form.preMoney)
 : null,
 // Wave C v26.5.0 (Shadie Finding 1a) — FD pre-money share count.
 // Only sent when the instrument uses it (common/preferred) AND the round is
 // not a foundation round. Foundation rounds have no prior FD count so we
 // send null; server backstop enforces the same rule at POST /api/rounds.
 fdPreMoneyShares: usesField("fdPreMoneyShares") && form.type !== "foundation"
 ? optionalIntegerString(form.fdPreMoneyShares)
 : null,
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
 /* ══════════════════════════════════════════════════════════
    WAVE 58b — ONE STORED CONCEPT FOR "WHO PAYS FOR THE POOL" (R21).
    ══════════════════════════════════════════════════════════
    THE COLLISION, found by the 2026-08-15 live audit. The platform had TWO names
    for one concept: the standalone Option-Pool vehicle called it **"Pool timing"**
    with values framed *investor-friendly / founder-friendly* and stored it as
    `poolTiming`; Wave 58's priced-round add-on called it **"Pool placement"** with
    values framed *founders pay / everyone pays* and stored it as
    `optionPoolMode`. Same two values (`pre_money` / `post_money`), two keys.

    WHAT `poolTiming` DID BEFORE THIS LINE, verified by grep rather than assumed:
    NOTHING COMPUTATIONAL. It drove an explanatory sentence in the Step-2 preview
    (`:1241`) and a summary label (`:1472`), and it appears in ZERO server files and
    ZERO engine files. So there was no existing pre/post-money implementation to
    reuse — the standalone vehicle's placement choice was a dead input of exactly
    the R21 class, and the engine had no way to see it.

    THIS LINE CONVERGES THE DATA, not the labels. `poolTiming` is still sent,
    unchanged, under its own key, so nothing that reads it changes. The SAME value
    is additionally written to `optionPoolMode` — the one key `compute.ts`,
    `roundMathRoutes.ts`, `RoundDetail.tsx` and the term-sheet generator all read —
    so a placement chosen on EITHER surface now reaches the arithmetic through ONE
    key. The two LABELS are still two labels; converging the on-screen vocabulary
    would remove copy identities and is recorded as OPEN in
    `build_log/wave58b/WAVE58B_REPORT.md` rather than done quietly here.
    IMPLEMENTED at the single `optionPoolMode` key below — deliberately NOT as a
    second key here, because two keys with the same name in one object literal is
    exactly the kind of silent last-one-wins bug this project keeps finding. */
 /* ── WAVE 58 · R27 — THE WIRE KEY THAT CLOSES THE REACHABILITY GAP ─────────
    `optionPoolPostPercent` is the field `packages/cap-table-engine` has read
    since Wave 52 (`compute.ts:457-458`, gated on it) and that NOTHING has ever
    written. Before this wave the only writer was a hand-crafted query parameter
    on a route we added ourselves (`server/roundMathRoutes.ts:452`), and the
    client never sent it (`RoundDetail.tsx:1129`) — so no user action could reach
    the pool arithmetic at all. This line, plus the server reading the stored
    value in `roundMathRoutes.ts`, is what makes a percentage typed in the
    browser move the price and the ownership figures.

    PERCENT-AS-WRITTEN (R16 / OR-1): sent exactly as typed. `"15"` means 15%.
    There is no conversion at this boundary or any other.

    PERSISTENCE: both keys are stashed into `rounds.extras_json` by
    `POST /api/rounds` (`server/routes.ts` KNOWN_COLS / `extras`) and re-spread on
    hydrate by `roundsStore.rowToRound`. NO MIGRATION IS REQUIRED and none was
    written — which also means the dev/test inline-DDL parity trap in the sacred
    `server/db/connection.ts` is not touched. */
 optionPoolPostPercent: addonPool && poolDerivation && poolDerivation.ok
 ? poolDerivation.targetPercentAsWritten
 : null,
 /* WAVE 58b — ONE KEY, BOTH SURFACES. See the "who pays" note above `poolSize`.
    Standalone Option-Pool vehicle: the founder's "Pool timing" choice, which
    previously reached no arithmetic at all. Priced/SAFE add-on: the "Pool
    placement" choice. Same two values, one stored key, one engine path. */
 /* WAVE 58c · A2 — `poolExpressed` replaces `poolDerivation.ok` here so that a
    SAFE/note pool, which is expressed as a SHARE COUNT and has no percentage to
    derive, still stores the placement the founder chose. Before this line a
    SAFE pool stored neither a percentage nor a placement. */
 optionPoolMode:
 form.instrument === "option_pool"
 ? (form.poolTiming === "post_money" ? "post_money" : "pre_money")
 : (poolExpressed ? addonPoolDraft.poolMode : null),
 region: form.region,
 termsheetChoice,
 // v25.20 Lane 5 NC fix: persist parent-round attachment for warrants/ESOP.
 // The wizard captured `attachToRound` but never sent it; server auto-stashes
 // unknown fields into extras_json, so this restores the cap-table ledger chain.
 parentRoundId:
 (form.instrument === "warrant" || form.instrument === "option_pool")
 ? (attachToRound || null)
 : null,
 /* ══════════════════════════════════════════════════════════════════════════
    WAVE 80 · ITEM 2 — THE FOUR DEAL-DISCLOSURE CONTROLS THAT LOST EVERY VALUE.
    ══════════════════════════════════════════════════════════════════════════
    WHAT WAS WRONG, traced from the JSX to this object rather than inferred. The
    wizard rendered four controls — "Round narrative for investors" (`:2225`),
    "Use of proceeds" (`:2228`), "Round closes in tranches" (`:2231`) and the
    tranche plan (`:2236`) — bound them to `form.notes`, `form.useOfProceeds`,
    `form.tranches` and `form.tranchesPlan`, showed the narrative back in the
    review step, POSTed, and returned success. None of the four appeared in THIS
    payload, so all four were discarded on submit. That is founder-entered deal
    disclosure presented as functional and then not written — the owner's "no
    dead promises" rule, on exactly the content an investor reads first.

    PERSISTENCE, AND NO MIGRATION. `POST /api/rounds` stashes every non-column
    key into `rounds.extras_json` and `roundsStore.rowToRound` re-spreads it on
    hydrate, which is the same path `optionPoolPostPercent` and `parentRoundId`
    above already travel. Migrations stay at 173, highest `0192`.

    EVERY ONE OF THE FOUR NOW HAS A READER, because persisting into a shape
    nothing reads is a new dead promise wearing a fix's clothes:
      · `notes`           → Round Detail, "Round narrative for investors";
      · `useOfProceeds`   → Round Detail AND the Investor Invitation, both
                            widened this wave to render the founder's own text;
      · `tranchesEnabled` → Round Detail, "Tranche plan";
      · `tranchesPlan`    → Round Detail, "Tranche plan".

    WHY THE TRANCHE FLAG IS **NOT** SENT AS `tranches`. `RoundDetail`'s `Round`
    type reads `tranches` as an ARRAY of `{name, amount, condition,
    expectedDate, funded}` rows and reduces over their amounts. Writing this
    boolean under that key would put `true` where a list of funded events is
    read — a shape collision, not a fix. The founder's yes/no answer travels
    under its own key, `tranchesEnabled`, and the structured tranche LEDGER
    keeps `tranches` to itself. Nothing that reads `tranches` today changes.

    EMPTY IS NULL, NEVER "". A field the founder left blank is not a value they
    typed — the same rule `optionalDecimalString` above applies to money. */
 notes: (form.notes ?? "").trim() || null,
 useOfProceeds: (form.useOfProceeds ?? "").trim() || null,
 tranchesEnabled: form.tranches === true,
 tranchesPlan: form.tranches === true ? ((form.tranchesPlan ?? "").trim() || null) : null,
 };
 return (await apiRequest("POST", "/api/rounds", payload)).json();
 },
 onSuccess: async (data: { id: string }) => {
 queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
 /* ════════════════════════════════════════════════════════
    WAVE 69 · V-2 (R58 row 5) — the server's warning channel had ZERO client
    consumers. The round WAS created; this is a heads-up, never a failure, and it
    stacks beside the success toast (TOAST_LIMIT is 5).

    THE SIGNATURE ABOVE IS DELIBERATELY BYTE-IDENTICAL. `termWarnings` is read via
    a local cast rather than by widening the parameter type, because
    `v2348_phase2_round_initial_shareholders.test.ts:47` SPLITS THIS FILE ON THE
    EXACT STRING `onSuccess: async (data: { id: string }`. Widening the annotation
    broke that test on the first run of this change. Do not "tidy" this. */
 const created = data as { id: string; termWarnings?: unknown };
 if (Array.isArray(created.termWarnings) && created.termWarnings.length > 0) {
  toast({
   title: "Created \u2014 one thing to check",
   description: (created.termWarnings as unknown[]).map(String).join(" "),
   duration: 30000,
  });
 }
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
 // W-SHADIE 3a (F-1) — CRM-picked contacts carry no per-row expiryDays, so
 // this previously sent null → server ?? 14 → CRM invites got 14 days while
 // manual invites got the new 7-day default (a 7-vs-14 split WITHIN the same
 // wizard). Default to the shared client default so ALL Step-4 picks are
 // consistently 7 days. Manual picks already set s.expiryDays, so this only
 // changes the CRM-pick path.
 expiryDays: s.expiryDays ?? DEFAULT_INVITE_EXPIRY_DAYS,
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
 /* WAVE 58 · R27 — `poolSize` here is STILL A SHARE COUNT and is still sent,
    unchanged in meaning and unchanged in key. It is now DERIVED from the
    percentage instead of typed, so no existing consumer of this payload
    changes. The percentage and the placement travel alongside it so the child
    round records WHAT WAS AGREED as well as what it worked out to. */
 poolSize: addonPoolDraft.poolSize.trim(), sharesAuthorized: addonPoolDraft.poolSize.trim(),
 optionPoolPostPercent: poolDerivation && poolDerivation.ok ? poolDerivation.targetPercentAsWritten : null,
 optionPoolMode: addonPoolDraft.poolMode,
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
  /* ═════════════════════════════════════════════════════════════════
     WAVE 69 · V-1b (R58 row 1) — THE SAME REFUSALS WERE DISCARDED ON CREATION.
     ═════════════════════════════════════════════════════════════════
     `POST /api/rounds` (`server/routes.ts:6676`) refuses with the SAME
     `{ ok:false, error, message }` shape and the SAME 543-character sentence as
     the PATCH — and this handler discarded it, which is where the corrupt live
     round came from. The two branches above (name-duplicate, field errors) keep
     precedence: they return early and are untouched.

     THE TERMINAL FALLBACK BELOW IS LEFT BYTE-IDENTICAL (R44: it is true, not
     false) and still runs for a non-`ApiError` failure or a body with no message. */
  const serverMsg = serverRefusalMessage(err);
  if (serverMsg) {
   /* WAVE 73 · ITEM 3 — the toast is UNCHANGED (title, description, duration all
      byte-identical); the persistent copy is ADDED beside it, not instead of it. */
   setCreateRefusal(serverMsg);
   toast({ title: "Failed to create round", description: serverMsg, variant: "destructive", duration: 30000 });
   return;
  }
  setCreateRefusal(null);
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

 /* ── WAVE 58 · R27 SCOPE 5 — SURFACE THE POOL THAT ALREADY EXISTS ──────────
    The wizard never showed the founder how many shares were already reserved,
    so the gross-up they were being asked to pay for was invisible. The
    cap-table page shows it on a different screen (`OPTION POOL 0.00% / 0
    options`, "No option pool reserved.").

    Read from the SAME endpoint the cap table and the round-math route read —
    `GET /api/companies/:id/securities` — so the three surfaces cannot disagree
    (R21). `undefined` means NOT ESTABLISHED and produces a named refusal
    downstream; it is never silently treated as zero, because zero would
    over-size the top-up and dilute the founder by more than they agreed.

    WHAT THIS FIGURE IS, stated because the data model cannot be more precise:
    it is every `option`-instrument share on the cap table — GRANTED options and
    the UNALLOCATED reserve together. `compute.ts::applyTopUp` folds them the
    same way into its `existingPool`, so the wizard and the engine target the
    same quantity. It is NOT the narrower Cooley/WSGR "unallocated reserve"
    figure, and the screen says so rather than implying a precision that does
    not exist (§10 item 5 of the sent response document). */
 type WizardSecurityRow = { instrument?: string | null; shares?: number | null };
 const existingPoolQ = useQuery<WizardSecurityRow[]>({
  queryKey: ["/api/companies", companyId, "securities"],
  queryFn: async () => {
   if (!companyId) return [];
   const r = await apiRequest("GET", `/api/companies/${encodeURIComponent(companyId)}/securities`);
   const data = await r.json();
   return Array.isArray(data) ? data : [];
  },
  enabled: Boolean(companyId),
 });
 /** Integer string, or `null` when the platform has not established it. */
 const existingPoolShares: string | null =
  existingPoolQ.data === undefined
   ? null
   : String(
      existingPoolQ.data
       .filter((s) => s?.instrument === "option")
       .reduce((sum, s) => sum + Math.max(0, Math.trunc(Number(s?.shares ?? 0)) || 0), 0),
     );

 /* ══════════════════════════════════════════════════════════════════════
    WAVE 58b · DEFECT 3 — ONE BASE. THE WIZARD NO LONGER PICKS ITS OWN.
    ══════════════════════════════════════════════════════════════════════
    BEFORE: this screen sized the pool against the TYPED `form.fdPreMoneyShares`
    while `compute.ts` sized it against the securities LEDGER. On the canonical
    example (pre-money $30,000,000, raise $10,000,000, target 15%) the typed base
    10,000,000 produced 2,500,000 pool shares at $2.40 and the ledger base
    8,000,000 produced 2,000,000 at $3.00 — a 500,000-SHARE DIVERGENCE for one
    round, shown to the founder on two different screens.

    NOW: both numbers go through ONE resolver in
    `shared/roundMathEngineAdapter.ts::resolveFdPreMoneyBase`, which the
    `round-math` HTTP route also calls. It either returns one agreed base or it
    REFUSES BY NAME, and no surface can quietly prefer its own denominator. The
    ledger figure comes from the engine itself
    (`ledgerFullyDilutedPreMoneyShares` → `runEngine(...).totalShares`), so it
    cannot drift from what the projection will use. */
 /* WAVE 58c · A3 — REFUSAL, NOT THROW, AT RENDER SCOPE. A committed SAFE/note
    carrying `discount: 20` (the R16 percent-as-written convention that
    `server/routes.ts` `buildCompanySecurities` passes through unchanged) made
    `ledgerFullyDilutedPreMoneyShares` throw here, taking the whole round wizard
    to the ErrorBoundary fallback. Proved by execution —
    `build_log/wave58cd/probe_before.mts`. */
 const wizardLedger = existingPoolQ.data === undefined
  ? null
  : tryLedgerFullyDilutedPreMoneyShares(existingPoolQ.data as unknown as ApiSecurity[]);
 const wizardLedgerFd = wizardLedger !== null && wizardLedger.ok ? wizardLedger.shares : null;
 const wizardBase = wizardLedgerFd === null
  ? null
  : resolveFdPreMoneyBase({
     declaredFdPreMoneyShares: form.fdPreMoneyShares,
     ledgerFdShares: wizardLedgerFd,
     outstandingConvertibles: unconvertedConvertibleCount(
      (existingPoolQ.data ?? []) as unknown as ApiSecurity[],
     ),
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
 // Wave C v26.5.0 (Shadie Finding 1a) — foundation rounds are the formation
 // event and don't collect preMoney or fdPreMoneyShares. Declared at render
 // scope so the render, validation, and payload branches all use the same
 // predicate (avoids state divergence).
 const isFoundationRound = form.type === "foundation";
 // W-FIX2 F5 — investor-grade PPS: pre-money ÷ fully-diluted PRE-MONEY shares
 // INCLUDING the option-pool top-up (the "pool shuffle"). When the founder
 // attaches an option pool to this priced round (addonPool below), a pre-money
 // pool of p% grosses the FD denominator up to existingFD / (1 − p) — the pool
 // is carved out of the pre-money, diluting founders before new money lands,
 // which correctly LOWERS the price per share. With no pool it reduces to the
 // plain pre-money ÷ FD-shares. The engine remains source-of-truth on commit.
 // ── WAVE 50 · ITEM 4 — A SHARE COUNT WAS BEING DIVIDED BY 100 ──────────────
 //
 // WHAT WAS WRONG. `addonPoolDraft.poolSize` is a SHARE COUNT, not a percent:
 // its input is labelled "Pool size (shares)" (see the add-on pool card below)
 // and it is sent as BOTH `poolSize` AND `sharesAuthorized` on the
 // `option_pool` round payload. The genuine percent field is a DIFFERENT state
 // key — `form.poolSize`, labelled "Pool size (% of fully-diluted)". This block
 // read the share count and divided it by 100 as though it were a percentage.
 //
 // The damage was not merely "100,000 shares becomes 1,000". At any realistic
 // pool size the guard `p >= 100` fired FIRST, so `poolTopUpPct` came out 0 and
 // the pool dilution was SILENTLY DROPPED from the fully-diluted denominator
 // below — which OVERPRICES the round (a higher PPS than the founder is
 // actually offering). The `/ 100` branch was reachable only for pools of 1-99
 // shares, where it was also wrong.
 //
 // THE MATH, STATED. For a pool of S shares carved out of the pre-money on a
 // pre-pool fully-diluted base of F shares, the pool is
 //     p = S / (F + S)
 // of the post-carve fully-diluted total, and therefore
 //     F / (1 - p) = F + S     exactly.
 // So a SHARE COUNT ROUND-TRIPS UNCHANGED: the top-up added to the denominator
 // is exactly the S shares the founder typed, with no percentage anywhere in
 // the founder's input. That identity is what the Wave 50 test asserts.
 //
 // This requires the BASE share count before the percentage, so the base is
 // hoisted out of `fdPreMoneyShares` into `basePreMoneyShares` and both read
 // it. The `shares / (1 - poolTopUpPct)` expression and the `poolTopUpPct`
 // name are preserved verbatim — wfix2b_f5_auto_pps.test.ts source-locks both.
 // ── WAVE 52 · ITEM 5a — THE SILENT FALLBACK IS GONE ────────────────────────
 //
 // WHAT WAS WRONG. This block read `form.fdPreMoneyShares` and, when it was
 // blank, silently substituted `Number(form.sharesAuthorized)` — the count of
 // NEW shares this round will issue. The pre-money valuation was then divided by
 // that number and the result printed as a price per share, and the substituted
 // number was printed on screen next to the words `FD =`.
 //
 // Wrong in two separate ways. FIRST, a numerator used as a denominator: it
 // counts shares that do not exist yet and omits every share that does —
 // founders, granted options, the existing unallocated pool, and any SAFE or
 // note that will convert. SECOND, the number was mislabelled twice: the input
 // said "Shares authorized" while meaning new shares issued, and the substituted
 // value was displayed as `FD`.
 //
 // DIRECTION OF THE ERROR: the denominator is too small, so the price per share
 // is too high, so the incoming investor is overcharged and every existing
 // holder's percentage is overstated.
 //
 // Deliberately NOT cited as the reason: charter-authorized capital. Capavate
 // never reads an authorized figure — there is no authorized field anywhere in
 // the schema — so an authorized-capital rationale would put a false sentence in
 // front of a founder. Strategy Review 1 struck it.
 //
 // Foundation rounds are unaffected: they are the formation event, collect no
 // pre-money and no FD count, and price manually.
 //
 // DB-KEY MISMATCH, recorded per §11.1: the wire/DB key stays `sharesAuthorized`
 // while its meaning is "new shares issued in this round". It is persisted via
 // extras_json / UPDATE_EXTRAS_WHITELIST, so renaming the key is a data
 // migration with a mirror and is a named follow-on. Only the UI label changes.
 const basePreMoneyShares = (() => {
 const fd = Number(form.fdPreMoneyShares);
 return isFinite(fd) && fd > 0 ? fd : 0;
 })();

 /* ═══════════════════════════════════════════════════════════════════════════
    WAVE 58 · R27 — THE PERCENTAGE IS THE INPUT; THE SHARE COUNT IS DERIVED.
    ═══════════════════════════════════════════════════════════════════════════
    The single source of the pool arithmetic on this screen. It is exact-decimal
    (`client/src/lib/roundMath.ts::derivePoolTopUpFromPercent`), it answers the
    SAME algebraic question as the engine's `computeEsopTopUp` — target pool as a
    percentage of POST-MONEY fully diluted — and on the canonical example the two
    agree to the share.

    It REFUSES BY NAME rather than substituting anything: no assumed existing
    pool, no assumed raise, no coerced percentage. `poolDerivation` is `null`
    when the pool is switched off, a `Refusal` when a required input is missing,
    and an `ok` result otherwise — and the screen renders whichever it is. */
 const poolDerivation = (() => {
 if (!addonPool) return null;
 /* WAVE 58c · A2 — the PERCENTAGE path is only run where a percentage is
    DEFINABLE, i.e. where the round has a pre-money valuation. On SAFE/note the
    pool is expressed as a share count (`unpricedPoolCheck` below), so running
    this would only produce a refusal about a field that is not on screen — an
    alarming box on a working entry path. Instrument-driven, not a flag. */
 if (!isPricedInstrument) return null;
 /* WAVE 58b · DEFECT 3 — the pool is not sized until the base is settled. A
    divergence between the declared count and the ledger is surfaced as the
    derivation's own refusal, using the resolver's exact code and reason, so the
    founder sees ONE message and not a number computed against a base the
    projection will not use. */
 if (wizardBase === null) {
  return {
   ok: false as const,
   code: "fd_base_pending",
   reason:
    "Capavate is still reading your cap table to establish the fully-diluted pre-money share count. " +
    "The pool percentage is measured against that number, so nothing is sized until it is known.",
  };
 }
 if (!wizardBase.ok) return { ok: false as const, code: wizardBase.code, reason: wizardBase.reason };
 /* This instrument's raise is the base the POST-money percentage is measured
    against. Common collects no target raise at all (Shadie item 1a), so the
    honest answer is a named refusal, not a circular guess: the notional raise
    is price × new shares, and the price is what the pool is about to change. */
 const raise = usesField("targetAmount") ? form.targetAmount : "";
 return derivePoolTopUpFromPercent({
  poolPercentPostMoney: addonPoolDraft.poolPercent,
  /* WAVE 58b · DEFECT 1.1 — THE PLACEMENT THE FOUNDER SELECTED NOW REACHES THE
     ARITHMETIC. Before this wave `derivePoolTopUpFromPercent` took no placement
     argument at all, so both dropdown choices rendered byte-identical numbers:
     a founder could pick "Post-money — everyone pays for it pro-rata" and be
     shown the founders-pay figures. This one line is what makes the two choices
     differ on screen. */
  poolPlacement: addonPoolDraft.poolMode,
  /* DEFECT 3 — the RESOLVED base, not the raw typed field. */
  fdPreMoneyShares: wizardBase.base.toString(),
  preMoneyValuation: form.preMoney,
  investmentAmount: raise,
  existingPoolShares,
 });
 })();
 /* The percentage on its own, so the field can show a validation error even when
    the other inputs are still blank. R27 scope 6: a named message, never a
    silent coercion. "Pool size (shares)" used to accept `0.25` with no error. */
 const poolPercentCheck = addonPool && isPricedInstrument
 ? parsePoolPercentAsWritten(addonPoolDraft.poolPercent)
 : null;
 /* ══════════════════════════════════════════════════════════════════════
    WAVE 58c · A2 — THE POOL STAYS EXPRESSIBLE ON SAFE AND NOTE ROUNDS.
    ══════════════════════════════════════════════════════════════════════
    THE REGRESSION (`W58B_REVIEW_3_RISK.md` §4.1/§5.2, confirmed against the
    pre-wave source inside `release/preflight/W58_RESTORE_20260815_1230.tgz`):
    live's Review-step add-on accepted a TYPED SHARE COUNT on SAFE/note rounds
    and created the child `option_pool` round from it. After 58b the same screen
    asked for a PERCENTAGE, which needs a base those instruments do not collect,
    so it refused with `fd_base_unavailable` and RECORDED NO POOL. A vehicle lost
    a capability it has on live.

    AND IT IS DEEPER THAN THE SPEC STATES — proved by execution, not read. Even
    WITH a fully-diluted base supplied, the percentage path refuses again with
    `pre_money_missing_for_pool`, because "% of post-money fully-diluted" needs a
    pre-money VALUATION and a SAFE has only a valuation CAP (a ceiling on a
    future priced round, not this round's price). So the fix cannot be "collect
    the FD base on those instruments" — see `parsePoolShareCountAsWritten` in
    `client/src/lib/roundMath.ts` for the full reasoning and the transcript.

    THE UNIT FOLLOWS THE INSTRUMENT, and it is stated on screen either way:
      · priced (Common / Preferred) — a PERCENTAGE, share count derived (58b);
      · unpriced (SAFE / note)      — a SHARE COUNT, exactly as live, because the
        percentage is undefined without a price. Both placement options remain
        selectable on both, and the placement is stored on both. */
 const poolEntryUnit: "percent" | "shares" = isPricedInstrument ? "percent" : "shares";
 const unpricedPoolCheck = addonPool && poolEntryUnit === "shares"
 ? parsePoolShareCountAsWritten(addonPoolDraft.poolSize)
 : null;
 /** True when a pool has been validly expressed in THIS instrument's own unit. */
 const poolExpressed =
 addonPool &&
 (poolEntryUnit === "percent"
  ? Boolean(poolDerivation && poolDerivation.ok)
  : Boolean(unpricedPoolCheck && unpricedPoolCheck.ok));
 /* The DERIVED share count, as a string, for every existing consumer of
    `addonPoolDraft.poolSize`. "" when it cannot be derived — which every
    consumer already treats as "no pool", because that is how a blank field
    behaved before this wave, so no consumer changes behaviour. */
 /* WAVE 58d · B2 — `T × PPS` against `pre-money + raise`, exact decimals. `null`
    when there is no derivation to reconcile; a refusal when the two inputs the
    comparison needs are not both present. */
 const impliedCap = poolDerivation && poolDerivation.ok
 ? reconcileImpliedCapitalisation({
    preMoneyValuation: form.preMoney,
    investmentAmount: usesField("targetAmount") ? form.targetAmount : "",
    derivation: poolDerivation,
   })
 : null;
 const derivedPoolShares =
 poolDerivation && poolDerivation.ok ? poolDerivation.poolTopUpShares.toString() : "";
 /* Mirror the derived value into `addonPoolDraft.poolSize` so the wire key, the
    child `option_pool` round payload and the stored value all carry the derived
    share count. This effect is the ONLY writer of `poolSize` now.

    WAVE 58c · A2 — GATED ON THE PRICED PATH. On SAFE/note rounds `poolSize` is
    the founder's own TYPED share count (there is no percentage to derive it
    from), so mirroring an empty derivation over it would erase what they typed
    on every keystroke. `isPricedInstrument` is read from `form.instrument`, so
    switching instrument mid-wizard hands the field back to the correct owner. */
 useEffect(() => {
 if (!isPricedInstrument) return;
 setAddonPoolDraft((d) => (d.poolSize === derivedPoolShares ? d : { ...d, poolSize: derivedPoolShares }));
 }, [derivedPoolShares, isPricedInstrument]);
 const poolTopUpPct = (() => {
 if (!addonPool) return 0;
 /* WAVE 58b · DEFECT 1.2 — THE STORED PRICE NO LONGER IGNORES THE PLACEMENT.
    This ratio is the gross-up that `fdPreMoneyShares` below applies as
    `shares / (1 - poolTopUpPct)` — i.e. it is what puts the pool INSIDE the
    pricing denominator. That is the PRE-MONEY convention and ONLY the pre-money
    convention (Cooley GO, "Negotiating the option pool";
    `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.1/§4.3).

    BEFORE THIS WAVE it was applied REGARDLESS OF THE SELECTED PLACEMENT, so a
    founder who chose "Post-money — everyone pays for it pro-rata" was quoted, and
    committed at, the founders-pay-alone price (this is DEFECT 1.2 of
    `spec/WAVE58B_SPEC.md`). A post-money pool is created after the round closes
    and is therefore NOT in the pricing denominator, so the correct gross-up for
    that placement is NONE.

    The expression `shares / (1 - poolTopUpPct)` below is source-locked by
    `wfix2b_f5_auto_pps.test.ts`, so the placement is expressed by making this
    ratio ZERO for post-money rather than by rewriting that line. Zero here is NOT
    a silent drop of the pool: the pool still exists, is still derived, is still
    stored and is still projected — it simply does not move the price, which is
    precisely what post-money placement means. */
 if (addonPoolDraft.poolMode === "post_money") return 0;
 // A SHARE COUNT. Never divided by 100, and deliberately NOT bounded at 100 —
 // 100,000 is an ordinary pool, and the old `p >= 100` bail is what silently
 // discarded every real pool.
 const poolShares = Number(addonPoolDraft.poolSize);
 if (!isFinite(poolShares) || poolShares <= 0) return 0;
 if (basePreMoneyShares <= 0) return 0;
 return poolShares / (basePreMoneyShares + poolShares);
 })();
 // Wave C v26.5.0 (Shadie Finding 1a) — prefer the founder-supplied
 // fully-diluted pre-money share count as the PPS base. Fall back to
 // sharesAuthorized only when fdPreMoneyShares is blank; validation below
 // enforces non-blank for all non-foundation priced rounds, so this fallback
 // is only reachable for foundation (which uses a manual PPS anyway).
 // The local variable is deliberately named `shares` to preserve the
 // wfix2b_f5_auto_pps.test.ts source-lock on `shares / (1 - poolTopUpPct)`.
 const fdPreMoneyShares = (() => {
 const shares = basePreMoneyShares;
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

 // WAVE 52 · ITEM 1a — `post` is retained ONLY as the pre-Wave-52 value so the
 // regression test can assert that it is no longer what the surface renders.
 // Nothing on screen reads it any more.
 const post = Number(form.preMoney) + Number(form.targetAmount) || 0;

 /* ── WAVE 52 · ITEM 1a / AC-6 — POST-MONEY HAS EXACTLY ONE SOURCE ──────────
    T·p, where T = D + N. Computed with exact decimals, never floats. When it
    cannot be computed the surface REFUSES BY NAME and discloses the actual
    derivation instead of printing a number it cannot stand behind.

    For a Common round the server derives the raise as
    `pricePerShare × sharesAuthorized` and stores it as `targetAmount`. Since the
    multiplicand means NEW SHARES ISSUED, that product is the NOTIONAL PRIMARY
    RAISE — a defensible derivation. It is disclosed AS A RAISE AMOUNT and is
    NOT turned into a post-money. */
 const w52PostMoney = (() => {
 const tip =
 "Post-money has one source: the post-money fully-diluted share count times the " +
 "price per share (T·p). It is not shown until it can be computed — Capavate will " +
 "not print a number it cannot derive, and it will not show $0 to mean \u201cunknown\u201d.";
 const pricing = derivePricePerShare({
 preMoneyValuation: form.preMoney,
 fdPreMoneyShares: form.fdPreMoneyShares,
 poolTopUpShares: addonPool ? addonPoolDraft.poolSize : null,
 isFoundationRound,
 manualPricePerShare: pricePerShareOverridden ? form.pricePerShare : null,
 });
 if (!pricing.ok) {
 return { tip, display: "Not computable", derivation: pricing.reason };
 }

 /* The committed amount for this round, per instrument. Common has no target
    raise input at all — that is Shadie item 1a — so its raise is the server's
    notional derivation, disclosed as such. */
 let committed: string | null = null;
 let raiseNote = "";
 if (form.instrument === "common") {
 const notional = commonNotionalRaise(pricing.pricePerShare, form.sharesAuthorized);
 if (!notional.ok) {
 return {
 tip,
 display: "Not computable",
 derivation:
 "A Common round has no Target raise input. Capavate derives the raise on submit as " +
 "price per share \u00d7 new shares issued in this round, and that cannot be computed yet: " +
 notional.reason,
 };
 }
 committed = notional.raise;
 raiseNote =
 `This instrument has no Target raise field. The raise is derived as price per share ` +
 `\u00d7 new shares issued in this round = $${Number(notional.raise).toLocaleString()} \u2014 a ` +
 `NOTIONAL primary raise, subject to actual subscriptions. It is a raise amount, not a post-money.`;
 } else if (usesField("targetAmount")) {
 const t = (form.targetAmount ?? "").toString().replace(/[,\s$]/g, "");
 committed = t === "" ? null : t;
 raiseNote = "Committed amount taken from Target raise.";
 }

 if (committed === null) {
 return {
 tip,
 display: "Not computable",
 derivation:
 "Post-money cannot be computed yet: no committed amount has been entered for this round. " +
 "A blank amount is not $0.",
 };
 }

 const d = deriveInvestorShares(committed, pricing.pricePerShare);
 if (!d.ok) return { tip, display: "Not computable", derivation: d.reason };

 const pm = computePostMoney({
 denominator: pricing.denominator,
 pricePerShare: pricing.pricePerShare,
 derivations: [d],
 preMoneyValuation: isFoundationRound ? null : form.preMoney,
 });
 if (!pm.ok) return { tip, display: "Not computable", derivation: pm.reason };

 const parts: string[] = [];
 parts.push(
 `T\u00b7p = ${pm.postMoneyShares.toLocaleString()} shares \u00d7 $${pricing.pricePerShare} ` +
 `(post-money fully-diluted count \u00d7 price per share).`,
 );
 if (pm.figuresDiffer && pm.preMoneyPlusCommitted !== null) {
 parts.push(
 `Pre-money + committed = $${Number(pm.preMoneyPlusCommitted).toLocaleString()}, which differs ` +
 `because $${pm.residualTotal} of the cheque cannot buy a whole share and is carried as a residual.`,
 );
 }
 if (raiseNote) parts.push(raiseNote);
 parts.push(pm.reconciliation);
 return {
 tip,
 display: `$${Number(pm.postMoneyValuation).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
 derivation: parts.join(" "),
 };
 })();

 /* ── WAVE 52 · §0 — THE DEAD PROMISE, KEPT ─────────────────────────────────
    Step 1 tells the founder, verbatim, "Cap-table impact is computed live on
    Review". Four live walkthroughs of v26.16.0 found that Review rendered one
    line of text and three checkboxes on Preferred, Common, both SAFEs, the Note
    and the Option Pool — no ownership percentages, no new-investor share count,
    no fully-diluted breakdown, no conversion preview. No acceptance criterion in
    the original plan required one, so every other criterion could pass while the
    headline promise stayed dead.

    This is the instrument that keeps it. It returns EITHER a preview OR a named
    refusal — never a zero, never a blank — and every percentage it renders
    carries its denominator, because the same founder is legitimately 40.000%,
    48.485% or 51.613% depending only on which denominator was used. */
 const w52Preview = (() => {
 const committedFor = (): string | null => {
 if (form.instrument === "common") {
 const n = commonNotionalRaise(
 pricePerShareOverridden ? form.pricePerShare : derivedPricePerShare,
 form.sharesAuthorized,
 );
 return n.ok ? n.raise : null;
 }
 const t = (form.targetAmount ?? "").toString().replace(/[,\s$]/g, "");
 return t === "" ? null : t;
 };

 if (form.instrument === "safe_post" || form.instrument === "safe_pre") {
 const cap = (form.valuationCap ?? "").toString().replace(/[,\s$]/g, "");
 const amt = committedFor();
 if (!amt || cap === "") {
 return {
 kind: "refusal" as const,
 reason:
 "Insufficient inputs: a SAFE preview needs both the purchase amount (Target raise) and " +
 "the valuation cap. Capavate will not show a zero or a blank in place of them.",
 };
 }
 return {
 kind: "conversion" as const,
 lines: [
 form.instrument === "safe_post"
 ? `Post-money SAFE (YC v1.2). At conversion the SAFE takes ` +
 `$${Number(amt).toLocaleString()} \u00f7 $${Number(cap).toLocaleString()} of the ` +
 `company capitalization, and its own denominator EXCLUDES the option pool created at the ` +
 `next financing — that is what makes it post-money.`
 : `Pre-money SAFE (YC v1.0). At conversion the SAFE's shares are an ADDITIONAL pool on top ` +
 `of the pre-money capitalization, so the dilution is borne by founders and employees rather ` +
 `than shared with the new round's investors.`,
 `No shares are issued now. The share count and the conversion price are fixed at the next ` +
 `priced round, from that round's price and capitalization — so no ownership percentage can be ` +
 `shown today without inventing that round's terms.`,
 ],
 refusals: [
 "Ownership % cannot be previewed: it depends on the next round's price and denominator, " +
 "neither of which exists yet.",
 "Conversion trigger is not a stored field in this build. Whether this instrument converts in " +
 "a given financing is therefore UNDETERMINED, which fails closed: it is excluded from any " +
 "pricing denominator and any price computed alongside it is provisional.",
 ],
 };
 }

 if (form.instrument === "convertible_note") {
 const amt = committedFor();
 if (!amt) {
 return {
 kind: "refusal" as const,
 reason:
 "Insufficient inputs: a note preview needs the principal (Target raise). " +
 "Capavate will not show a zero in place of it.",
 };
 }
 return {
 kind: "conversion" as const,
 lines: [
 `Convertible note, principal $${Number(amt).toLocaleString()} at ${form.interestRate || "\u2014"}% ` +
 `interest, ${form.maturityMonths || "\u2014"}-month maturity.`,
 ],
 refusals: [
 "ACCRUED INTEREST IS NOT MODELLED, and this is a refusal rather than a silent zero. The wizard " +
 "collects an interest rate and a maturity but no issue date, no day-count convention " +
 "(ACT/365, ACT/360 or 30/360) and no simple-versus-compounded term, so elapsed years cannot " +
 "be supplied to the conversion. Treating accrued interest as zero would understate the " +
 "note's share count and overstate every founder. The note's converting share count is " +
 "therefore NOT final.",
 "Ownership % cannot be previewed: it depends on the next priced round's price and denominator.",
 ],
 };
 }

 if (form.instrument === "warrant") {
 const shares = (form.sharesAuthorized ?? "").toString().replace(/[,\s$]/g, "");
 if (shares === "") {
 return {
 kind: "refusal" as const,
 reason:
 "Insufficient inputs: a warrant preview needs the underlying share count. " +
 "Capavate will not show a zero in place of it.",
 };
 }
 return {
 kind: "conversion" as const,
 lines: [
 `${Number(shares).toLocaleString()} underlying shares at a $${form.strikePrice || "\u2014"} strike. ` +
 `A warrant counts in FULLY-DILUTED ownership immediately, whether or not it is ever exercised, ` +
 `so it dilutes every other holder by its full notional from today.`,
 ],
 refusals: [
 "Ownership % cannot be previewed here: the wizard has no fully-diluted base for a standalone " +
 "warrant issuance, so there is no denominator to divide by. Attach the warrant to a priced " +
 "round to see its effect.",
 ],
 };
 }

 if (form.instrument === "option_pool") {
 const pool = (form.poolSize ?? "").toString().replace(/[,\s$%]/g, "");
 if (pool === "") {
 return {
 kind: "refusal" as const,
 reason: "Insufficient inputs: an option-pool preview needs the pool size.",
 };
 }
 return {
 kind: "conversion" as const,
 lines: [
 form.poolTiming === "post_money"
 ? "POST-MONEY pool: created after the round, so the dilution is shared proportionally by " +
 "everyone, including the incoming investors."
 : "PRE-MONEY pool: created before the round closes, so existing holders dilute themselves and " +
 "the incoming investors do not. VCs almost always require pre-money. This also lowers the " +
 "price per share, because the pool sits inside the pricing denominator.",
 ],
 refusals: [
 "Ownership % cannot be previewed for a standalone pool top-up: there is no fully-diluted base " +
 "on this screen to divide by.",
 ],
 };
 }

 /* Priced instruments — common and preferred. */
 const committed = committedFor();
 const built = buildCapTablePreview({
 instrument: form.instrument,
 pricing: {
 preMoneyValuation: form.preMoney,
 fdPreMoneyShares: form.fdPreMoneyShares,
 poolTopUpShares: addonPool ? addonPoolDraft.poolSize : null,
 isFoundationRound,
 manualPricePerShare: pricePerShareOverridden ? form.pricePerShare : null,
 },
 existingHolders: (() => {
 const fd = (form.fdPreMoneyShares ?? "").toString().replace(/[,\s$]/g, "");
 return fd === "" ? [] : [{ name: "Existing fully-diluted holders (aggregate)", shares: fd }];
 })(),
 investments: committed === null ? [] : [{ name: "This round's investors", amount: committed }],
 });
 if (!built.ok) return { kind: "refusal" as const, reason: built.reason };
 return { kind: "priced" as const, preview: built };
 })();

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
 // Wave C v26.5.0 (Shadie Finding 1a) — foundation rounds are the
 // formation event: no prior valuation, no fully-diluted pre-money to
 // divide by. They collect only Shares authorized + a manual PPS.
 // Post-formation priced rounds (common OR preferred) require
 // preMoney + fdPreMoneyShares so auto-mode PPS can compute correctly.
 // Uses the render-scope isFoundationRound declared above (line 646).
 switch (form.instrument) {
 case "common":
 reqPos("sharesAuthorized", "Shares authorized");
 if (!isFoundationRound) {
 reqPos("preMoney", "Pre-money valuation");
 reqPos("fdPreMoneyShares", "Fully-diluted pre-money shares");
 }
 if (!(numOf(effectivePps) > 0)) e.pricePerShare = "Price per share is required and must be greater than 0.";
 break;
 case "preferred":
 // Wave C v26.5.0 (Shadie 1a, Opus BLOCK-2) — preMoney is gated on
 // !isFoundationRound so type=foundation + instrument=preferred does
 // not permanently disable Continue with a hidden input.
 if (!isFoundationRound) {
 reqPos("preMoney", "Pre-money valuation");
 reqPos("fdPreMoneyShares", "Fully-diluted pre-money shares");
 }
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
 /* ═════════════════════════════════════════════════════════
    WAVE 58b — ONE VALIDATION RULE FOR BOTH POOL-PERCENTAGE FIELDS.
    ═════════════════════════════════════════════════════════
    The 2026-08-15 live audit found the two pool inputs validating DIFFERENTLY in
    the same application: on the standalone vehicle's percentage field `-5` was
    rejected while on the add-on's field it was accepted silently, and NEITHER
    guarded an upper bound — `999999999` passed on both. Wave 58 fixed the add-on
    side by routing it through `parsePoolPercentAsWritten`. This routes the
    STANDALONE field through THE SAME FUNCTION, so there is one rule, one range
    (R16 `[0, 100)`) and one set of refusal names across both surfaces rather than
    two.

    `reqPos` is KEPT and runs FIRST, byte-identical, so the existing
    "Pool size is required and must be greater than 0." message and its
    `err-poolSize` test id are unchanged for the blank/zero case that produced
    them. The shared parser only ADDS the cases `reqPos` never covered: a
    negative, a non-number, and anything at or above 100%. */
 reqPos("poolSize", "Pool size");
 if (!e.poolSize) {
  const poolPct = parsePoolPercentAsWritten(form.poolSize, "Pool size (% of fully-diluted)");
  if (!poolPct.ok) e.poolSize = poolPct.reason;
 }
 break;
 }
 /* ═══════════════════════════════════════════════════════════════
    WAVE 58e · D3.5 — `Discount (%)` HAD NO VALIDATION AT ALL ON LIVE.
    ═══════════════════════════════════════════════════════════════
    Verified on live v26.17.0 (owner ruling R31, "Also observed"): the field
    accepted `0.2`, `20` and anything else — no clamp, no error, no hint — on BOTH
    this wizard and the Edit-terms modal. That absence is how the corrupt live row
    holding `discount: 20260707` (R31-a) is still writable today.

    ONE RULE, SHARED. `validateDiscountPercentAsWritten` lives in
    `shared/roundMathEngineAdapter.ts` and is the SAME function `POST /api/rounds`
    and `PATCH /api/rounds/:id/terms` call, so the screen and the server cannot
    disagree — the failure mode the two option-pool fields demonstrated on live.

    THE TRAP IS SURFACED, NOT GUESSED AT. A founder typing `0.2` may mean 20%.
    R16 forbids reading a unit off a magnitude, so nothing is rescaled: `0.2` is
    accepted as two tenths of one percent and the disclosure panel beside the field
    PRINTS what it will mean, so the founder can correct it themselves.

    Applied by FIELD, not by instrument, so any future instrument that shows the
    field inherits the rule instead of silently missing it. */
 if (usesField("discount")) {
  const dv = validateDiscountPercentAsWritten(form.discount);
  if (!dv.ok) e.discount = dv.message;
 }
 return e;
 })();
 const step2Valid = Object.keys(step2Errors).length === 0;
 /* WAVE 69 · V-2 (R56) — DELIBERATELY OUTSIDE `step2Errors`. Adding it there
    would block `step2Valid` above and turn the ruling's WARNING into a REFUSAL.
    The founder is told and may proceed; the value is stored exactly as written. */
 const capDateShapeWarning = usesField("valuationCap")
  ? dateShapedValueWarning("valuationCap", form.valuationCap)
  : null;

 /* ── WAVE 52c · B7 — NO UNIT WITHOUT A NUMBER ─────────────────────────────
    WHAT WAS WRONG. This function interpolated form fields directly:
        `…, ${form.discount}% discount${form.mfn ? ", MFN" : ""}…`
    so an EMPTY discount printed the literal string "% discount" on the Review
    step. The live walkthrough captured exactly that leak, and §10 of
    `RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` — a document ALREADY SENT to an
    external reviewer — told her it was corrected. It was not.

    THE SIBLINGS HAD THE SAME SHAPE, on every instrument and not only the SAFE:
    an empty cap printed "$NaN" via `Number("").toLocaleString()`, an empty
    interest rate printed "% interest", an empty maturity printed
    "-month maturity", an empty strike printed "$ strike", an empty pool printed
    "+%", and empty vesting printed "mo / mo cliff".

    THE RULE NOW. A term is rendered ONLY when it has a value. A blank field is
    OMITTED from the sentence — never printed as a bare unit, never coerced to
    zero, never printed as NaN. Zero IS a value and is shown; "" is not. */
 function engineSummary() {
  /** A supplied, non-empty field, trimmed. `null` means "not supplied". */
  const val = (raw: unknown): string | null => {
   if (raw === null || raw === undefined) return null;
   const t = String(raw).trim();
   return t === "" ? null : t;
  };
  /** A money term. Returns null rather than "$NaN" for a blank/garbage field. */
  const money = (raw: unknown): string | null => {
   const v = val(raw);
   if (v === null) return null;
   const n = Number(v.replace(/[,\s$]/g, ""));
   return Number.isFinite(n) ? `$${n.toLocaleString()}` : null;
  };
  /** A count term, thousands-separated, or dropped entirely when absent. */
  const count = (raw: unknown): string | null => {
   const v = val(raw);
   if (v === null) return null;
   const n = Number(v.replace(/[,\s]/g, ""));
   return Number.isFinite(n) ? n.toLocaleString() : null;
  };
  const term = (raw: unknown, render: (v: string) => string): string | null => {
   const v = val(raw);
   return v === null ? null : render(v);
  };
  const join = (parts: Array<string | null>): string =>
   parts.filter((x): x is string => x !== null && x !== "").join(" · ");

  switch (form.instrument) {
   case "common":
    return join([
     term(count(form.sharesAuthorized), (v) => `Issue ${v} Common`),
     term(form.pricePerShare, (v) => `$${v}/share`),
     "engine: us-default v1.0.0",
    ]);
   case "preferred":
    return join([
     `Series ${form.type.replace("series_", "").toUpperCase()} Preferred`,
     term(money(form.preMoney), (v) => `pre-money ${v}`),
     term(form.liqPrefMultiple, (v) => `${v}× ${form.participating ? "participating" : "non-participating"}`),
     ANTI_DILUTION_VARIANTS.find((a) => a.value === form.antiDilution)?.label ?? null,
    ]);
   case "safe_post":
    return join([
     term(money(form.valuationCap), (v) => `SAFE post-money cap ${v}`) ?? "SAFE post-money",
     term(form.discount, (v) => `${v}% discount`),
     form.mfn ? "MFN" : null,
     "YC v1.2",
     val(form.region),
    ]);
   case "safe_pre":
    return join([
     term(money(form.valuationCap), (v) => `SAFE pre-money cap ${v}`) ?? "SAFE pre-money",
     term(form.discount, (v) => `${v}% discount`),
     form.mfn ? "MFN" : null,
     "YC v1.0",
     val(form.region),
    ]);
   case "convertible_note":
    return join([
     term(money(form.valuationCap), (v) => `Convertible Note: cap ${v}`) ?? "Convertible Note",
     term(form.discount, (v) => `${v}% discount`),
     term(form.interestRate, (v) => `${v}% interest`),
     term(form.maturityMonths, (v) => `${v}-month maturity`),
     form.mfn ? "MFN" : null,
    ]);
   case "warrant":
    return join([
     term(count(form.sharesAuthorized), (v) => `Warrant: ${v} shares`) ?? "Warrant",
     term(form.strikePrice, (v) => `$${v} strike`),
     term(form.expiryYears, (v) => `${v}-year expiry`),
     form.cashlessAllowed ? "cashless allowed" : "cash only",
    ]);
   case "option_pool":
    return join([
     term(form.poolSize, (v) => `Option Pool +${v}% of fully-diluted`) ?? "Option Pool",
     ESOP_TIMING.find((t) => t.value === form.poolTiming)?.label ?? null,
     term(form.vestingMonths, (v) => `${v}mo vesting`),
     term(form.cliffMonths, (v) => `${v}mo cliff`),
     val(form.jurisdictionVariant),
    ]);
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
 {usesField("preMoney") && !isFoundationRound && (
 <>
 <div><LabelWithTip tip="The agreed value of your company BEFORE the new money lands. Pre-money + new money = post-money."><Label>Pre-money valuation (USD)</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.preMoney} onChange={v => update("preMoney", v)} data-testid="input-pre" />{step2Errors.preMoney && <p className="text-xs text-rose-500 mt-1" data-testid="err-preMoney">{step2Errors.preMoney}</p>}</div>
 {/* ── WAVE 52 · ITEM 1a — THE RENDERED FIELD WAS THE BUG ────────────────
 WHAT WAS WRONG. This rendered `Number(form.preMoney) +
 Number(form.targetAmount)` under a tooltip promising "pre-money +
 target raise". On a Common round `targetAmount` is not a field the
 instrument collects, so the addend was always NaN → 0 and the box
 displayed the PRE-money under a post-money label. It was structurally
 incapable of being a calculation. The rendered field was the defect,
 not the missing input.

 WHAT IT DOES NOW. Post-money has exactly one source — T·p — and the
 box shows it only when it can be computed. Otherwise it refuses by
 name and discloses the real derivation on screen. It is never $0
 standing in for "unknown"; a genuine $0 still renders as $0. */}
 <div>
 <LabelWithTip tip={w52PostMoney.tip}><Label>Post-money valuation</Label></LabelWithTip>
 <Input className="mt-1 font-mono bg-secondary/50" value={w52PostMoney.display} readOnly data-testid="input-post" />
 <p className="text-[11px] text-muted-foreground mt-1" data-testid="w52-post-money-derivation">{w52PostMoney.derivation}</p>
 </div>
 </>
 )}
 {/* Wave C v26.5.0 (Shadie Finding 1a) — fully-diluted pre-money shares.
 Only rendered for non-foundation priced rounds. This is the PPS denominator;
 not to be confused with "Shares authorized" below which is new-shares-issued. */}
 {usesField("fdPreMoneyShares") && !isFoundationRound && (
 <div>
 <LabelWithTip tip="Fully-diluted pre-money shares BEFORE this round: existing common + preferred (as-converted) + granted options + option pool reserved + SAFE/note conversions. Used only to compute the price per share — not to issue new shares. Investor convention is 'broad' FD (include the reserved pool).">
 <Label>Fully-diluted pre-money shares</Label>
 </LabelWithTip>
 <FormattedNumberInput
 className="mt-1 font-mono"
 value={form.fdPreMoneyShares}
 onChange={v => update("fdPreMoneyShares", v)}
 data-testid="input-fd-pre-money-shares"
 />
 {step2Errors.fdPreMoneyShares && (
 <p className="text-xs text-rose-500 mt-1" data-testid="err-fdPreMoneyShares">{step2Errors.fdPreMoneyShares}</p>
 )}
 </div>
 )}
 {usesField("pricePerShare") && (
 <div data-testid="pps-block">
 {/* v23.4.9 Phase 1 (Avi #2) — priced rounds: PPS is auto-calculated and
 read-only. Avi: "the share price has to be entered manually, whereas
 it should be calculated automatically based on the value." */}
 <LabelWithTip tip="Calculated automatically: pre-money valuation ÷ fully-diluted PRE-MONEY shares, grossed up for any option-pool top-up attached to this round. It is NOT divided by the new shares this round issues. Edit pre-money or the fully-diluted share count to change it, or click Override to enter a price manually. (SAFE / Convertible Note rounds hide this field — the price is set at conversion, not at issue.)">
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
 placeholder="Enter pre-money and fully-diluted pre-money shares"
 data-testid="input-pps"
 />
 <div className="flex items-center justify-between mt-1">
 <p className="text-[11px] text-muted-foreground font-mono" data-testid="pps-formula">
 {/* WAVE 52 · ITEM 5a — the caption now names the quantity it actually used
 and can no longer assert an `FD =` figure it never read from the
 fully-diluted field. With the fallback removed, a blank field produces
 a refusal here instead of a substituted number. */}
 PPS = pre_money ÷ FD_pre_money_shares{poolTopUpPct > 0 ? " (incl. option-pool top-up)" : (addonPool && addonPoolDraft.poolMode === "post_money" && addonPoolDraft.poolSize !== "" ? " (option-pool top-up EXCLUDED — post-money placement)" : "")}
 {fdPreMoneyShares > 0
 ? ` — fully-diluted pre-money shares used = ${Math.round(fdPreMoneyShares).toLocaleString()}`
 : " — no price yet: enter fully-diluted pre-money shares. Capavate will not substitute the new-share count for it."}
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
 <div><LabelWithTip tip="How many NEW shares this issuance creates. This is not authorized capital and it is not a sum of existing holdings — Capavate has no authorized-capital field at all. For a Foundation round it is your founder allocation; for a warrant or option grant it is the underlying share count. It is a numerator: it is never the denominator used to price the round."><Label>New shares issued in this round</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.sharesAuthorized} onChange={v => update("sharesAuthorized", v)} data-testid="input-shares" />{step2Errors.sharesAuthorized && <p className="text-xs text-rose-500 mt-1" data-testid="err-sharesAuthorized">{step2Errors.sharesAuthorized}</p>}</div>
 )}
 {usesField("valuationCap") && (
 <div><LabelWithTip tip="The maximum valuation at which this SAFE/Note converts to shares. Lower cap = more dilution to founders, more upside for the investor. Most early SAFEs use $5M–$15M caps."><Label>Valuation cap (USD)</Label></LabelWithTip><FormattedNumberInput className="mt-1 font-mono" value={form.valuationCap} onChange={v => update("valuationCap", v)} data-testid="input-cap" />{step2Errors.valuationCap && <p className="text-xs text-rose-500 mt-1" data-testid="err-valuationCap">{step2Errors.valuationCap}</p>}
 {/* WAVE 69 · V-2 (R56) — a WARNING beside the field, amber not rose, and the
     wizard's Next button is untouched. This is the surface the corrupt live
     round was created on. */}
 {capDateShapeWarning && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="warn-valuationCap-date-shape">{capDateShapeWarning}</p>}</div>
 )}
 {usesField("discount") && (
 <div><LabelWithTip tip="Percentage off the priced-round share price the SAFE/Note investor gets. 20% means they pay $0.80 for what new investors pay $1.00. Standard range is 10–25%."><Label>Discount (% off the round price)</Label></LabelWithTip><Input type="number" className="mt-1 font-mono" value={form.discount} onChange={e => update("discount", e.target.value)} data-testid="input-disc" />
 {step2Errors.discount && <p className="text-xs text-rose-500 mt-1" data-testid="err-discount">{step2Errors.discount}</p>}
 {/* ══════════════════════════════════════════════════════════════
     WAVE 58e · D3.1-D3.3 (owner ruling R30) — BOTH FORMS AND THE PRICE, ON SCREEN.
     ══════════════════════════════════════════════════════════════
     The label above is no longer a bare "Discount" — R30.1. This panel supplies the
     rest: BOTH industry forms in one sentence, and the resulting conversion price
     with its arithmetic.

     WHY BOTH FORMS. "Discount" and "Discount Rate" are INVERSES, and the YC SAFE
     legal form uses "Discount Rate" — the price AFTER the discount, so a 20%
     discount is a Discount Rate of 80%
     (Wyrick, https://www.wyrick.com/news-insights/safe-financing-valuation-cap-vs-discount-variants).
     DLA Piper's SAFE FAQs call recording a 20% Discount as a Discount Rate of 20%
     "quadrupling the intended discount"
     (https://www.dlapiper.com/en/insights/publications/2022/08/safe-faqs).
     A percent/fraction slip is 100× and obvious; this one looks plausible and
     reaches signed documents. Printing both is what makes the screen self-checking.

     THE $1.00 REFERENCE PRICE IS STATED AS AN ILLUSTRATION, NOT A PREDICTION. A
     SAFE has no price of its own — it has a CAP, which is a ceiling on a FUTURE
     round — so there is no round price per share to multiply here. The panel says
     so and works the arithmetic on $1.00, which the founder can scale. Inventing a
     price would be a fabricated number on a money screen. */}
 {(() => {
   const dd = describeDiscount(form.discount, "1.00");
   if (!dd) return null;
   if (dd.refusal) return null; /* the named error above already says it */
   return (
     <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs space-y-1" data-testid="disc-disclosure">
       <p data-testid="disc-both-forms"><strong>{dd.bothForms}</strong></p>
       <p data-testid="disc-conversion" className="font-mono">
         On a future round priced at $1.00 a share: {dd.conversionArithmetic} — so the holder converts at ${dd.conversionPrice} where new investors pay $1.00. Scale it to whatever the round price turns out to be; a SAFE has a cap, not a price, so Capavate will not invent one here.
       </p>
       <p data-testid="disc-lower-of">
         If this instrument also has a valuation cap, conversion happens at whichever of the cap-implied price and this discounted price is <strong>LOWER</strong>, and the round detail states which one governed.
       </p>
       {dd.marketNormNote && <p className="text-amber-600" data-testid="disc-market-norm">{dd.marketNormNote}</p>}
     </div>
   );
 })()}
 </div>
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
 {/* ════════════════════════════════════════════════════════
     WAVE 58d · B1 / B4 — ONE VOCABULARY ACROSS BOTH POOL SURFACES (R21).
     ════════════════════════════════════════════════════════
     This vehicle called the decision “Pool timing” with values framed
     “investor-friendly / founder-friendly”; the round add-on calls the same
     decision “Pool placement” with values framed “founders pay / everyone pays”.
     Two names and two framings for one thing, in one product.

     CONVERGED ADDITIVELY. Every existing string here is untouched — the label
     “Pool timing”, its tooltip, and both `ESOP_TIMING` option labels
     (“Pre-money pool (dilutes founders only — investor-friendly)” /
     “Post-money pool (dilutes everyone — founder-friendly)”) still render exactly
     as they do on live, so nothing is dropped and every choice stays reachable.
     What is ADDED is the one vocabulary both surfaces now share: the decision is
     named as a PRICING TREATMENT, the target basis is stated as the separate fact
     it is, and the term-sheet formulation is given verbatim.

     “Timing” is also actively misleading and is corrected here rather than
     deleted: nothing about this decision is chronological. And
     “investor-friendly / founder-friendly” is a value judgement the platform
     should not be making for the founder, so the neutral statement of who bears
     the dilution is given beside it. */}
 {/* NOTE ON WORD ORDER, and it is not stylistic: the denominator phrase is placed
     BEFORE the percentage. `scripts/lint/percentDenominatorFence.ts` builds its
     neighbourhood window from `maskComments()` output, and that masker blanks the
     remainder of a line from the `</` of a closing JSX tag — so a denominator named
     AFTER `{value}%</span>` is invisible to the fence and the site reads as
     unlabelled. Found by running the fence, not by reading it. Naming the
     denominator first is also better prose. */}
 <p className="text-[10px] text-muted-foreground mt-1" data-testid="standalone-pool-target-basis">
 <span className="font-medium">Target basis (the same on either choice):</span> the reserve is sized as a
 percentage of <strong>post-closing fully diluted capitalisation</strong> — the NVCA model term-sheet
 structure — and that percentage is{" "}
 <span className="font-mono">{form.poolSize || "—"}%</span>
 </p>
 <p className="text-[10px] text-muted-foreground mt-1" data-testid="standalone-pool-pricing-treatment">
 <span className="font-medium">Pricing treatment — who pays for the pool:</span>{" "}
 {form.poolTiming === "post_money"
 ? "the pool increase is EXCLUDED from pre-money pricing and added after the closing; all holders dilute pro rata. A negotiated departure from the NVCA/Cooley model form — and note that counsel often uses “post-money pool” to mean only the target basis above, under which the founders still bear it."
 : "the pool increase is INCLUDED in fully-diluted pre-money capitalization; existing holders bear the dilution. This is the market default (Cooley GO; Wilson Sonsini ECVC), which is what “investor-friendly” above means."}
 </p>
 <p className="text-[10px] text-muted-foreground mt-1" data-testid="standalone-pool-unit-note">
 This field is a <strong>percentage</strong>. The option pool attached to a priced round is entered the same
 way; on a SAFE or a convertible note it is entered as a <strong>share count</strong>, because those rounds
 have no pre-money valuation and so no post-money total to take a percentage of.
 </p>
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
 {INVITE_EXPIRY_OPTIONS.map((d) => (
 <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
 ))}
 </SelectContent>
 </Select>
 {/* Show BOTH the number of days AND the actual calendar date (Ozan). */}
 <p className="text-[11px] text-muted-foreground mt-1" data-testid="manual-expiry-hint">
 {(() => {
 const d = Number(manualDraft.expiryDays) || DEFAULT_INVITE_EXPIRY_DAYS;
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
 // W-SHADIE 3a (decider follow-up) — forward the selected expiry so the
 // preview shows the SAME "expires in N days" the real email will use.
 // Previously omitted → preview always said 14 regardless of the dropdown.
 expiryDays: Number(manualDraft.expiryDays) || DEFAULT_INVITE_EXPIRY_DAYS,
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
 setSelectedShareholders((prev) => [...prev, { name: `${first} ${last}`.trim(), firstName: first, lastName: last, company: manualDraft.company.trim(), email: manualDraft.email.trim(), checkSize: manualDraft.checkSize.trim(), note: manualDraft.note.trim() || null, stageFocus: manualDraft.stageFocus.trim() || null, expiryDays: Number(manualDraft.expiryDays) || DEFAULT_INVITE_EXPIRY_DAYS, source: "manual" }]);
 setManualDraft({ firstName: "", lastName: "", company: "", email: "", checkSize: "", note: "", stageFocus: "", expiryDays: String(DEFAULT_INVITE_EXPIRY_DAYS) });
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
 {/* WAVE 58 · R27 — RELOCATED. For a priced round the pool control now lives on
     STEP 2, beside the price it changes; Review shows a read-only recap so the
     pool never disappears from the screen that summarises the round. For every
     other instrument the control stays here, because there is no Step 2 price
     for it to move. Destination id: addon-pool-section (Step 2). */}
 {isPricedInstrument ? (
 <div className="rounded-md border border-border p-3 text-xs space-y-1" data-testid="addon-pool-review-recap">
 <div className="font-medium">Option pool (ESOP)</div>
 {!addonPool ? (
 <p className="text-muted-foreground">No option pool is being added in this round. Set one on Step 2 — "Terms" — where the price per share reacts to it.</p>
 ) : poolDerivation && poolDerivation.ok ? (
 <>
 <div className="flex justify-between font-mono"><span>Target</span><span>{poolDerivation.targetPercentAsWritten}% of post-money fully-diluted</span></div>
 <div className="flex justify-between font-mono"><span>Placement</span><span>{addonPoolDraft.poolMode === "pre_money" ? "Pre-money — founders pay" : "Post-money — everyone pays"}</span></div>
 <div className="flex justify-between font-mono"><span>Pool size (shares), derived</span><span>{poolDerivation.poolTopUpShares.toLocaleString()}</span></div>
 <div className="flex justify-between font-mono"><span>Pool after this round</span><span>{poolDerivation.resultingPoolShares.toLocaleString()} = {formatPct(poolDerivation.resultingPoolPercent)}</span></div>
 <div className="flex justify-between font-mono"><span>Effective pre-money</span><span>${Number(poolDerivation.effectivePreMoney).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
 <p className="text-[10px] text-muted-foreground">Change it on Step 2 — "Terms".</p>
 </>
 ) : (
 <p className="text-amber-700 dark:text-amber-400">{poolDerivation && !poolDerivation.ok ? poolDerivation.reason : "The pool has been switched on but not yet sized. Set the percentage on Step 2 — “Terms”."}</p>
 )}
 </div>
 ) : (
 /* Non-priced instruments (SAFE, note): the control renders in the single
    step-gated host below, which for them fires on step 5 — exactly where it
    has always been. Nothing is rendered twice. */
 null
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

 {/* ── WAVE 52 · §0 — THE CAP-TABLE PREVIEW STEP 1 PROMISES ─────────────
     APPENDED AT THE END AS A SIBLING, deliberately. Panel identity in the
     silent-drop guard is
       file -> tag -> at=<ancestor chain WITH occurrence indices> -> child=Tag#k
     so a MID-LIST sibling insertion renumbers `#k` for every later same-tag
     sibling and rewrites `childorder` for every affected ancestor. One
     mid-list insertion previously invalidated 46 child identities and produced
     62 phantom drops. This wave carries ~2,129 measured identities across its
     four files — the largest phantom-drop exposure in the plan — so every new
     node in this wave goes at the END of its parent. */}
 <div className="pt-4 mt-4 border-t border-border space-y-3" data-testid="w52-captable-preview">
 <div className="flex items-center gap-2 font-medium">
 Cap-table impact
 <HelpTip>Step 1 promises that cap-table impact is computed live on Review. This is that computation. Every percentage below names the denominator it was divided by, because the same holder is legitimately a different percentage on each one — nothing in that is wrong, but a percentage published without naming its denominator is.</HelpTip>
 </div>

 {w52Preview.kind === "refusal" && (
 <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs" data-testid="w52-preview-refusal">
 <strong>Cannot compute the cap-table impact yet.</strong>
 <p className="mt-1">{w52Preview.reason}</p>
 </div>
 )}

 {w52Preview.kind === "conversion" && (
 <div className="space-y-2 text-xs" data-testid="w52-preview-conversion">
 {w52Preview.lines.map((l, i) => (
 <p key={`w52cl-${i}`} data-testid={`w52-preview-conversion-line-${i}`}>{l}</p>
 ))}
 {w52Preview.refusals.map((r, i) => (
 <p key={`w52cr-${i}`} className="text-amber-600 dark:text-amber-400" data-testid={`w52-preview-conversion-refusal-${i}`}>{r}</p>
 ))}
 </div>
 )}

 {w52Preview.kind === "priced" && (
 <div className="space-y-3 text-xs" data-testid="w52-preview-priced">
 <div className="font-mono" data-testid="w52-preview-price">
 Price per share ${w52Preview.preview.pricing.pricePerShare}
 {w52Preview.preview.pricing.manual ? " (entered manually)" : " (derived)"}
 </div>

 <div data-testid="w52-preview-denominator">
 <div className="font-medium">Pricing denominator — {DENOM_LABEL_SHORT[w52Preview.preview.pricing.denominator.label]}</div>
 <div className="text-muted-foreground">{DENOM_LABEL_TEXT[w52Preview.preview.pricing.denominator.label]}</div>
 <ul className="mt-1 space-y-0.5 font-mono">
 {w52Preview.preview.pricing.denominator.items.map((it) => (
 <li key={it.key} data-testid={`w52-denom-item-${it.key}`}>
 {it.label}: {it.shares.toLocaleString()}
 </li>
 ))}
 <li className="font-semibold" data-testid="w52-denom-total">
 Total pricing denominator: {w52Preview.preview.pricing.denominator.shares.toLocaleString()}
 </li>
 </ul>
 <div className="mt-1 font-mono" data-testid="w52-effective-pre-money">
 Effective, pool-adjusted pre-money: ${Number(w52Preview.preview.pricing.effectivePreMoney).toLocaleString()}
 <span className="text-muted-foreground"> — the new pool sits inside the pre-money denominator, so the founders alone pay for it. This, not the headline pre-money, is what you are being paid for the pre-existing company.</span>
 </div>
 </div>

 {w52Preview.preview.derivations.map((d, i) => (
 <p key={`w52d-${i}`} data-testid={`w52-preview-residual-${i}`}>{describeResidual(d, null)}</p>
 ))}

 {w52Preview.preview.postMoney && (
 <div className="font-mono" data-testid="w52-preview-postmoney">
 Post-money (T·p): ${Number(w52Preview.preview.postMoney.postMoneyValuation).toLocaleString()} on T = {w52Preview.preview.postMoney.postMoneyShares.toLocaleString()} shares
 {w52Preview.preview.postMoney.figuresDiffer && w52Preview.preview.postMoney.preMoneyPlusCommitted !== null
 ? ` · pre-money + committed = $${Number(w52Preview.preview.postMoney.preMoneyPlusCommitted).toLocaleString()} · residual $${w52Preview.preview.postMoney.residualTotal}`
 : ""}
 </div>
 )}

 <table className="w-full font-mono" data-testid="w52-preview-ownership">
 <thead>
 <tr className="text-left text-muted-foreground">
 <th>Holder</th>
 <th>Shares</th>
 <th>Ownership, with its denominator named</th>
 </tr>
 </thead>
 <tbody>
 {w52Preview.preview.rows.map((r, i) => (
 <tr key={`w52r-${i}`} data-testid={`w52-preview-row-${i}`}>
 <td>{r.holder}</td>
 <td>{r.shares.toLocaleString()}</td>
 <td>{r.percentages.map((pc) => formatPct(pc)).join(" · ")}</td>
 </tr>
 ))}
 <tr data-testid="w52-preview-total">
 <td className="font-semibold">Total</td>
 <td className="font-semibold">{w52Preview.preview.rows.reduce((a, r) => a + Number(r.shares), 0).toLocaleString()}</td>
 <td>{w52Preview.preview.displayedTotals.map((pc) => formatPct(pc)).join(" · ")}</td>
 </tr>
 </tbody>
 </table>
 <p className="text-muted-foreground" data-testid="w52-preview-rounding-note">
 Each percentage is rounded to three decimals independently, so a displayed column need not
 total exactly 100.000%. The underlying share ratios always do. The total shown above is the
 exact total rounded once — never the sum of the rounded column.
 </p>

 {w52Preview.preview.notes.map((n, i) => (
 <p key={`w52n-${i}`} className="text-amber-600 dark:text-amber-400" data-testid={`w52-preview-note-${i}`}>{n}</p>
 ))}
 {/* WAVE 52c · B6 — APPENDED AT THE END AS A SIBLING. The Review preview
     renders on all seven instruments but the ownership table above is only
     meaningful for the priced ones. Review 1 called that an inconsistency, and
     Wave 52c states the limitation on screen rather than leaving a reader to
     notice that a table is missing. */}
 <p className="text-muted-foreground" data-testid="w52c-preview-ownership-scope">
 Scope of this preview: the ownership table above can only be computed for a PRICED round
 (preferred or common), because an ownership percentage needs a price and a denominator. For a
 SAFE, a convertible note, a warrant or a standalone option pool this wizard shows the terms and
 the conversion mechanics but NO ownership percentage — that figure is not withheld, it does not
 yet exist, and it is set by the next priced round&apos;s price and denominator.
 </p>
 </div>
 )}
 </div>
 </div>
 )}
 {/* ═══════════════════════════════════════════════════════════════════════════
    WAVE 58 · R27 — THE OPTION-POOL CONTROL, RELOCATED BESIDE THE PRICE.
    ═══════════════════════════════════════════════════════════════════════════
    THIS IS A RELOCATION, NOT A REMOVAL. Before this wave the only pool control
    sat inside STEP 5 (Review) — after Step 2 had already shown the founder
    "Price per share (USD) = 3" — and entering a pool changed nothing on screen.
    That is the structural complaint the external reviewer raised and the live
    walkthrough of v26.17.0 confirmed. R27: "Relocate the pool beside the price
    it changes … and make the price react."

    Defined ONCE and rendered in exactly one place at a time:
      · priced instruments (Common / Preferred) → STEP 2, immediately beneath the
        price-per-share field, where the derived price reacts as you type;
      · every other instrument → STEP 5, where it has always been, because a
        SAFE or a note has no price on Step 2 for the pool to move.
    Step 5 additionally renders a READ-ONLY RECAP for the priced case, so the
    Review screen still shows the pool and nothing disappears from it.

    Every pre-existing identity is carried across intact: the toggle
    (`addon-pool-toggle`), the field container (`addon-pool-fields`), the share
    count (`addon-pool-size`) and the label text "Pool size (shares)" are all
    still here. The share count is now READ-ONLY because it is DERIVED — R27:
    "The share count becomes the derived output, shown to the founder, never the
    input." */}
 {/* SINGLE, STEP-GATED HOST. Declared inline INSIDE the CardContent rather than
     hoisted into a variable: the silent-drop guard counts element membership
     LEXICALLY, and hoisting this JSX out of the card removed four descendant
     records (Input, Label, input, label) from the census even though every
     control was still on screen. Keeping it inline keeps the census additive.
     Rendered on STEP 2 for priced instruments (beside the price it changes) and
     on STEP 5 for everything else (where it has always been). */}
 {(form.instrument !== "warrant" && form.instrument !== "option_pool") &&
  ((step === 2 && isPricedInstrument) || (step === 5 && !isPricedInstrument)) && (
 <div className="pt-4 mt-4 border-t border-border" data-testid="addon-pool-host">

 <div className="space-y-3" data-testid="addon-pool-section">
 <label className="flex items-start gap-2 text-sm">
 <input type="checkbox" className="mt-1" checked={addonPool} onChange={e => setAddonPool(e.target.checked)} data-testid="addon-pool-toggle" />
 <span>Add / top up an option pool (ESOP)</span>
 </label>
 {/* WAVE 58 · R27 SCOPE 7 — THE DEAD TOOLTIP.
     The "?" beside "Add warrants / option pool (optional)" is a hover-only
     Radix tooltip on a button with `tabIndex={-1}` and no onClick: clicking it
     does nothing and puts no popover in the DOM, which is what the live
     walkthrough recorded. Rather than guess at a pointer-event root cause we
     cannot reproduce without a browser, the pool's own explanation is rendered
     STATICALLY, always, needing no hover, no focus and no click. An affordance
     that is always open cannot be dead. */}
 <div className="rounded-md border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed space-y-1" data-testid="addon-pool-help">
 <div className="font-medium text-foreground">How the option pool is sized</div>
 <p>
 You enter the pool as a <strong>percentage of fully-diluted shares</strong>, because that is what
 investors negotiate and what the glossary already promises ("ESOP: sized as a % of fully-diluted,
 refreshed at each round"). Capavate derives the <strong>share count</strong> from it and shows you
 both.
 </p>
 <p>
 Type the number as you say it: <strong>15 means 15%</strong>. It is never rescaled, so 0.25 means a
 quarter of one percent and not 25%.
 </p>
 <p>
 The percentage is measured against the <strong>post-money fully-diluted total</strong> — the shares
 that will exist after this round closes, including the pool itself.
 </p>
 </div>
 {/* WAVE 58b · DEFECT 3 — WHICH BASE IS IN FORCE, ON SCREEN, BY NUMBER.
     The declared count, the ledger count, and which one the arithmetic used.
     This is the figure the wizard and the Projection used to disagree on. */}
 {addonPool && wizardBase && wizardBase.ok && (
 <p className="text-[10px] text-muted-foreground pl-6" data-testid="addon-pool-base-label">{wizardBase.label}</p>
 )}
 {/* WAVE 58c · A2 — WHICH UNIT THIS INSTRUMENT USES, AND WHY, ON SCREEN.
     Rendered whenever the pool is on, so a founder meeting the share-count
     field on a SAFE is told why it is not a percentage there. */}
 {addonPool && poolEntryUnit === "shares" && (
 <div className="rounded-md border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed pl-3 space-y-1" data-testid="addon-pool-unit-note">
 <div className="font-medium text-foreground">On this instrument the pool is entered as a SHARE COUNT</div>
 <p>
 A percentage of <strong>post-money fully-diluted</strong> can only be worked out from a price per share, and
 a price comes from a <strong>pre-money valuation</strong>. A SAFE or a convertible note has no pre-money
 valuation — it has a valuation <strong>cap</strong>, which is a ceiling on a <em>future</em> priced round, not
 this round's price. So Capavate asks for the number of shares you are reserving, exactly as it does today,
 rather than quoting a percentage it cannot stand behind.
 </p>
 <p>
 You still choose <strong>who pays for it</strong> below, and that choice is stored on the round. The
 percentage will be worked out on the priced round these instruments convert into.
 </p>
 </div>
 )}
 {addonPool && (
 <div className="grid md:grid-cols-3 gap-3 pl-6" data-testid="addon-pool-fields">
 {/* THE INPUT (R27). Percent-as-written; the share count below is derived.
     WAVE 58c · A2 — on an UNPRICED instrument the two swap roles: this field
     becomes the unavailable one (a percentage is undefined without a price)
     and "Pool size (shares)" below becomes the input. Both fields are always
     on screen, so nothing is removed from either instrument family. */}
 <div>
 <Label className="text-xs">Pool size (% of fully-diluted)</Label>
 <Input
 type="number"
 step="0.5"
 min="0"
 max="99.9999"
 readOnly={poolEntryUnit === "shares"}
 aria-readonly={poolEntryUnit === "shares" ? "true" : undefined}
 className={poolEntryUnit === "shares" ? "mt-1 font-mono bg-secondary/50" : "mt-1 font-mono"}
 placeholder={poolEntryUnit === "shares" ? "Not applicable without a price per share" : "e.g. 15 for 15%"}
 value={poolEntryUnit === "shares" ? "" : addonPoolDraft.poolPercent}
 onChange={e => setAddonPoolDraft(d => ({ ...d, poolPercent: e.target.value }))}
 data-testid="addon-pool-percent"
 />
 <p className="text-[10px] text-muted-foreground mt-1">
 {poolEntryUnit === "shares"
 ? "Not available on a SAFE or a note: this round has no pre-money valuation, so there is no post-money fully-diluted total to take a percentage of. Enter the share count instead."
 : "Percent as written — 15 means 15%, of post-money fully-diluted."}
 </p>
 {poolPercentCheck && !poolPercentCheck.ok && (
 <p className="text-xs text-rose-500 mt-1" data-testid="err-addon-pool-percent">{poolPercentCheck.reason}</p>
 )}
 </div>
 {/* SCOPE 3 — PLACEMENT IS EXPLICIT, BECAUSE IT DECIDES WHO PAYS.

     ════════════════════════════════════════════════════════
     WAVE 58d · B1 — TWO DECISIONS, SEPARATED. RE-EXPRESSED, NOT REDUCED.
     ════════════════════════════════════════════════════════
     `W58B_REVIEW_1_MATH.md` §2.2 ranked “post-money pool” HIGH severity as a LABEL,
     not as arithmetic: counsel commonly says “post-money pool” to mean the pool is
     TARGETED on post-closing fully-diluted capitalisation while still being carved
     out of the PRE-money pricing denominator — under which reading the founders,
     not everyone, bear it (Cooley GO, “Negotiating the option pool”). Capavate uses
     the same phrase to mean a post-PRICING reserve diluting everyone pro rata. A
     founder can therefore select the wrong economics from a familiar-looking label.

     THE REVIEW'S OWN DIAGNOSIS: both branches ALREADY target the reserve at the
     same percentage of post-close fully diluted; the only thing this control
     changes is whether the reserve sits inside the pre-money PPS denominator. So
     the two decisions are now shown as two things:

       1. TARGET BASIS — stated, above, as a fact about what the percentage means
          (“% of post-closing fully diluted”). It is the same on both branches, so
          presenting it as a choice would invent an option that does not exist.
       2. PRICING TREATMENT — the control below, which is the real decision, now
          headed by what it actually decides.

     R28 / NO SILENT DROPS: not one option string is changed or removed. “Pool
     placement” survives as the sub-caption; both `SelectItem` labels are byte
     identical; the standalone vehicle keeps “Pool timing” and its own two labels.
     The precise counsel formulations are ADDED beneath, so the specialist and the
     non-specialist are both served on the same screen. */}
 <div>
 <Label className="text-xs">Pricing treatment — who pays for the pool?</Label>
 {/* Denominator phrase BEFORE the percentage — see the note on the standalone
     vehicle's target-basis line for why the fence requires that order here. */}
 <p className="text-[10px] text-muted-foreground mb-1" data-testid="addon-pool-target-basis">
 <span className="font-medium">Target basis (the same either way):</span> the unallocated reserve is sized as a
 percentage of <strong>post-closing fully diluted capitalisation</strong> — the NVCA model term-sheet
 structure, unaffected by the choice below — and that percentage is{" "}
 <span className="font-mono">{addonPoolDraft.poolPercent || "—"}%</span>
 </p>
 {/* R28 — THE ORIGINAL IDENTITY IS RESTORED, NOT EXCUSED. `Pool placement` is
     still a `Label` element with the same direct `#text` child and the same
     class, so no guard panel or copy record moves; the new heading is an ADDED
     sibling above it. Verified by re-running `npm run guard`. */}
 <Label className="text-xs">Pool placement</Label>
 <Select value={addonPoolDraft.poolMode} onValueChange={v => setAddonPoolDraft(d => ({ ...d, poolMode: v as "pre_money" | "post_money" }))}>
 <SelectTrigger className="mt-1" data-testid="addon-pool-placement"><SelectValue /></SelectTrigger>
 <SelectContent>
 {/* WAVE 58b — the market default is LABELLED as the default on screen. Both
     modes stay selectable and both are modelled; nothing is disabled. */}
 <SelectItem value="pre_money">Pre-money — the founders pay for it alone (market default)</SelectItem>
 <SelectItem value="post_money">Post-money — everyone pays for it pro-rata</SelectItem>
 </SelectContent>
 </Select>
 <p className="text-[10px] text-muted-foreground mt-1">
 {addonPoolDraft.poolMode === "pre_money"
 ? "Pre-money: the pool sits inside the pre-money denominator, so it lowers the price per share and dilutes only the holders who are already here. This is what most investors require."
 : "Post-money: the pool is created after the round, so the new investors are diluted by it alongside you."}
 </p>
 {/* WAVE 58d · B1 — THE PRECISE TERM, FOR THE READER WHO NEEDS IT, ALONGSIDE
     THE PLAIN ENGLISH ABOVE. This is the sentence a fund's counsel will look
     for, and it is the sentence that removes the “post-money pool” ambiguity. */}
 <p className="text-[10px] text-muted-foreground mt-1 italic" data-testid="addon-pool-counsel-formulation">
 {addonPoolDraft.poolMode === "pre_money"
 ? "In term-sheet language: “the pool increase is INCLUDED in fully-diluted pre-money capitalization; existing holders bear the dilution.” (Cooley GO; Wilson Sonsini ECVC — the market default.)"
 : "In term-sheet language: “the pool increase is EXCLUDED from pre-money pricing and added after the closing; all holders dilute pro rata.” This is a NEGOTIATED DEPARTURE from the NVCA/Cooley model form — note that “post-money pool” is often used by counsel to mean only the TARGET BASIS above, in which case the founders still bear it. Capavate means what this sentence says."}
 </p>
 </div>
 {/* THE DERIVED OUTPUT on a priced round. WAVE 58c · A2 — THE INPUT on an
     unpriced one, which is what live does today. Same label, same
     `data-testid`, same key on the wire; only who writes it changes. */}
 <div>
 <Label className="text-xs">Pool size (shares)</Label>
 <Input
 type={poolEntryUnit === "shares" ? "number" : undefined}
 min={poolEntryUnit === "shares" ? "0" : undefined}
 step={poolEntryUnit === "shares" ? "1" : undefined}
 readOnly={poolEntryUnit === "percent"}
 aria-readonly={poolEntryUnit === "percent" ? "true" : undefined}
 className={poolEntryUnit === "percent" ? "mt-1 font-mono bg-secondary/50" : "mt-1 font-mono"}
 value={addonPoolDraft.poolSize}
 onChange={e => setAddonPoolDraft(d => ({ ...d, poolSize: e.target.value }))}
 placeholder={poolEntryUnit === "percent" ? "Derived from the percentage" : "e.g. 500000"}
 data-testid="addon-pool-size"
 />
 <p className="text-[10px] text-muted-foreground mt-1">
 {poolEntryUnit === "percent"
 ? "Derived, not typed — this is the share count your percentage produces."
 : "The number of shares reserved under the plan by this round. A whole number, greater than zero."}
 </p>
 {unpricedPoolCheck && !unpricedPoolCheck.ok && (
 <p className="text-xs text-rose-500 mt-1" data-testid="err-addon-pool-size">{unpricedPoolCheck.reason}</p>
 )}
 </div>
 </div>
 )}
 {/* WAVE 58c · A2 — WHAT WILL BE RECORDED on an unpriced round, by number, so
     the founder is not left guessing whether the pool was taken. This is the
     confirmation live never gave them. */}
 {addonPool && poolEntryUnit === "shares" && unpricedPoolCheck && unpricedPoolCheck.ok && (
 <div className="rounded-md border border-border p-3 text-xs space-y-1 pl-3" data-testid="addon-pool-unpriced-recap">
 <div className="flex justify-between font-mono">
 <span>Shares reserved by this round</span>
 <span data-testid="addon-pool-unpriced-shares">{unpricedPoolCheck.shares.toLocaleString()}</span>
 </div>
 <div className="flex justify-between font-mono">
 <span>Who pays for it (stored on the round)</span>
 <span data-testid="addon-pool-unpriced-placement">
 {addonPoolDraft.poolMode === "pre_money"
 ? "Pre-money — the existing holders pay alone"
 : "Post-money — everyone pays pro-rata"}
 </span>
 </div>
 <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
 This creates the option-pool issuance alongside the round, chained to it in the cap-table ledger — the same
 thing the share-count field does today. No percentage is stored, because none has been established: a share
 count is not a percentage and Capavate will not file one as the other.
 </p>
 </div>
 )}
 {addonPool && poolDerivation && !poolDerivation.ok && (
 /* R6 honest refusal: name what is missing, never print a number we cannot
    stand behind and never substitute a value for a blank input. */
 <div className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs pl-3" data-testid="addon-pool-refusal">
 <div className="font-medium">The pool share count cannot be derived yet</div>
 <p className="mt-1">{poolDerivation.reason}</p>
 <p className="mt-1 text-[10px] text-muted-foreground">Refusal code: <code className="font-mono">{poolDerivation.code}</code></p>
 </div>
 )}
 {addonPool && poolDerivation && poolDerivation.ok && (
 <div className="space-y-2 text-xs">
 {/* SCOPE 5 — THE EXISTING POOL, THE TOP-UP AND THE RESULTING TOTAL, so the
     founder can see the gross-up they are paying for. */}
 <div className="rounded-md border border-border p-3 space-y-1" data-testid="addon-pool-existing">
 <div className="font-medium">Option pool before, added, and after</div>
 <div className="flex justify-between font-mono"><span>Already under the plan</span><span>{poolDerivation.resultingPoolShares - poolDerivation.poolTopUpShares > BigInt(0) ? (poolDerivation.resultingPoolShares - poolDerivation.poolTopUpShares).toLocaleString() : "0"} shares</span></div>
 <div className="flex justify-between font-mono"><span>New top-up this round (derived)</span><span>+{poolDerivation.poolTopUpShares.toLocaleString()} shares</span></div>
 <div className="flex justify-between font-mono font-semibold border-t border-border pt-1"><span>Pool after this round</span><span>{poolDerivation.resultingPoolShares.toLocaleString()} shares</span></div>
 <div className="flex justify-between font-mono"><span>As a percentage</span><span data-testid="addon-pool-resulting-percent">{formatPct(poolDerivation.resultingPoolPercent)}</span></div>
 <p className="text-[10px] text-muted-foreground">
 {DENOM_LABEL_TEXT[poolDerivation.resultingPoolPercent.denominator]} — {Number(poolDerivation.resultingPoolPercent.denominatorShares).toLocaleString()} shares.
 </p>
 <p className="text-[10px] text-muted-foreground">
 "Already under the plan" counts every option-plan share on your cap table — granted options and the
 unallocated reserve together. Capavate cannot yet separate the two, and says so rather than implying
 a precision it does not have.
 </p>
 </div>
 {/* ═════════════════════════════════════════════════════════
     WAVE 58d · B2 — THE TWO VALUATIONS, RECONCILED ON SCREEN.
     ═════════════════════════════════════════════════════════
     `CAPTABLE_MATH_INDUSTRY_STANDARD.md` requires `T × PPS` to be computed and
     disclosed whenever it differs from `pre-money + new money`. Independently
     reproduced on the canonical fixture in
     `build_log/wave58cd/w58cd_exact_math.py` and by execution in
     `build_log/wave58cd/probe_b2_output.txt`:
       post-money  12,549,019 × $3.75 = $47,058,821.25 vs $40,000,000 → +$7,058,821.25
       pre-money   13,333,333 × $3.00 = $39,999,999.00 vs $40,000,000 → −$1.00
     Shown on BOTH placements, so the founder learns what the figure means on the
     benign case before they meet it on the material one. */}
 {impliedCap && impliedCap.ok && (
 <div className="rounded-md border border-border p-3 space-y-1" data-testid="addon-pool-implied-capitalisation">
 <div className="font-medium">What the company is capitalised at, at this price</div>
 <div className="flex justify-between font-mono">
 <span>Nominal post-money (pre-money + raise)</span>
 <span data-testid="implied-cap-nominal">${Number(impliedCap.nominalPostMoney).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
 </div>
 <div className="flex justify-between font-mono">
 <span>All {poolDerivation.postMoneyFdShares.toLocaleString()} post-close shares × ${poolDerivation.pricePerShare}</span>
 <span data-testid="implied-cap-implied">${Number(impliedCap.impliedFullyDilutedCapitalisation).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
 </div>
 <div className="flex justify-between font-mono font-semibold border-t border-border pt-1">
 <span>Difference</span>
 <span data-testid="implied-cap-difference">${Number(impliedCap.difference).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
 </div>
 <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
 <span>— of which, the new reserve at this price</span>
 <span data-testid="implied-cap-pool-value">${Number(impliedCap.poolValueAtPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
 </div>
 <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
 <span>— less raise that buys no whole share (shares round DOWN)</span>
 <span data-testid="implied-cap-residual">${Number(impliedCap.investorFloorResidual).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
 </div>
 <p className="text-[11px] leading-relaxed pt-1 border-t border-border" data-testid="implied-cap-explanation">
 {impliedCap.explanation}
 </p>
 </div>
 )}
 {impliedCap && !impliedCap.ok && (
 <div className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs" data-testid="addon-pool-implied-capitalisation-refusal">
 <div className="font-medium">The implied capitalisation cannot be reconciled yet</div>
 <p className="mt-1">{impliedCap.reason}</p>
 <p className="mt-1 text-[10px] text-muted-foreground">Refusal code: <code className="font-mono">{impliedCap.code}</code></p>
 </div>
 )}
 {/* SCOPE 3 — THE POOL SHUFFLE, DISCLOSED WITH ITS DERIVATION. */}
 <div className="rounded-md border border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5 p-3 space-y-1" data-testid="addon-pool-effective-premoney">
 <div className="font-medium">
 {addonPoolDraft.poolMode === "pre_money"
 ? "A pre-money pool is paid for by you, not by the new investors"
 : "A post-money pool is paid for by everyone, including the new investors"}
 </div>
 <div className="flex justify-between font-mono"><span>Headline pre-money</span><span>${Number(form.preMoney || 0).toLocaleString()}</span></div>
 <div className="flex justify-between font-mono"><span>Value of the new pool ({poolDerivation.poolTopUpShares.toLocaleString()} × ${poolDerivation.pricePerShare})</span><span>−${Number(Number(form.preMoney || 0) - Number(poolDerivation.effectivePreMoney)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
 <div className="flex justify-between font-mono font-semibold border-t border-[hsl(0_100%_40%)]/30 pt-1"><span>Effective pre-money</span><span>${Number(poolDerivation.effectivePreMoney).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
 <div className="flex justify-between font-mono"><span>Price per share after the gross-up</span><span data-testid="addon-pool-derived-pps">${poolDerivation.pricePerShare}</span></div>
 {/* WAVE 58b · DEFECT 1 — THE PRICING DENOMINATOR, BY NAME AND BY NUMBER. This
     is the one figure that differs between the two placements, so it is printed
     rather than left to be inferred from the price. */}
 <div className="flex justify-between font-mono"><span>Pricing denominator ({addonPoolDraft.poolMode === "pre_money" ? "pool INSIDE" : "pool OUTSIDE"})</span><span data-testid="addon-pool-pricing-denominator">{poolDerivation.pricingDenominatorShares.toLocaleString()} shares</span></div>
 <p className="text-[10px]">
 {addonPoolDraft.poolMode === "pre_money"
 ? "Because the pool sits inside the pre-money share count, the price per share falls and the pool's value comes out of the valuation you were quoted. This is the \u201coption pool shuffle\u201d."
 : "Because the pool is created after this round closes, it is NOT inside the pricing denominator: the price per share is the pre-money valuation divided by your existing fully-diluted count, and your effective pre-money is the full headline figure. The pool then dilutes you and the incoming investor in exact proportion to what each of you holds after the raise."}
 </p>
 </div>
 {/* ══════════════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 1 — WHO PAYS, ON SCREEN, IN PLAIN LANGUAGE, WITH NUMBERS.
     ══════════════════════════════════════════════════════════════════════
     Not a hover, not a tooltip, not a details/summary — always open. The text is
     generated by the SAME derivation that produced the numbers above, so it can
     never drift from them. Diligence standard: the percentage, its denominator by
     name, the derived share count, who bears the dilution, and the effective
     pre-money are all present on this one card. */}
 <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-1" data-testid="addon-pool-who-pays">
 <div className="font-medium">Who pays for this pool</div>
 <p className="text-[11px] leading-relaxed">{poolDerivation.whoPays}</p>
 <p className="text-[10px] text-muted-foreground">{poolDerivation.fdDefinition}</p>
 <p className="text-[10px] text-muted-foreground">
 Convention: pre-money placement is the market default (Cooley GO, “Negotiating the option pool”), recorded
 in spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md §4.1 and §4.3. Post-money placement is a negotiated
 departure from the NVCA/Cooley model form; Capavate models it, and says here that no model form prescribes it.
 </p>
 </div>
 {/* The full derivation, on screen, not in a log. */}
 <details className="rounded-md border border-border p-3" data-testid="addon-pool-derivation">
 <summary className="cursor-pointer font-medium">Show the full derivation</summary>
 <ol className="mt-2 space-y-1 list-decimal pl-4 font-mono text-[10px] leading-relaxed">
 {poolDerivation.derivation.map((line, i) => <li key={i}>{line}</li>)}
 </ol>
 </details>
 </div>
 )}
 </div>
 </div>
 )}

 {/* WAVE 73 · ITEM 3 (finishes WAVE 69 · V-1b) — THE SERVER'S REFUSAL, IN COPY
     THAT DOES NOT EXPIRE. APPENDED as a new sibling immediately above the button
     row: nothing around it is moved, removed or re-nested, so the silent-drop
     guard census stays additive and the ordinal of every existing node is
     unchanged. It renders ONLY when the server actually refused, so the
     legitimate path is byte-identical. */}
 {createRefusal && (
 <div className="mb-3 rounded-md border border-[hsl(0_100%_40%)]/40 bg-[hsl(0_100%_40%)]/5 p-3 text-xs space-y-1" role="alert" data-testid="create-round-refusal">
 <div className="text-sm font-semibold">The round was not created</div>
 <p className="text-muted-foreground leading-relaxed" data-testid="create-round-refusal-message">{createRefusal}</p>
 <p className="text-[10px] text-muted-foreground">Nothing was saved. Correct the term above and create the round again — this explanation stays here until you do.</p>
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
