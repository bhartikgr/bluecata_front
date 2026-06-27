/**
 * Sprint 4 — Capavate Glossary
 *
 * One shared dialog with the full glossary of cap-table + round-management
 * terms. Triggered from anywhere via the `<GlossaryLink />` component. Searchable
 * and grouped by category. The voice is plain, first-time-founder-friendly, never
 * condescending: the goal is to make a non-finance founder confident reading
 * a term sheet in 60 seconds.
 */
import { useMemo, useState } from "react";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Search } from "lucide-react";

export type GlossaryEntry = {
 term: string;
 alt?: string[];
 category:
 | "Equity Instruments"
 | "Round Mechanics"
 | "Investor Rights"
 | "Regulatory"
 | "ESOP & Vesting"
 | "Cap Table Views";
 definition: string;
 technicalDefinition?: string;
 example?: string;
};

export const ENTRIES: GlossaryEntry[] = [
 // Equity Instruments
 { term: "Common Shares", category: "Equity Instruments",
 definition: "The default share class. Held by founders and (when exercised) by employees. No special rights — last in line if the company is sold or wound up.",
 technicalDefinition: "Ordinary shares with no liquidation preference, anti-dilution rights, or protective provisions. Valuation under IRC §409A requires 409A appraisal; typically at a significant discount to preferred (10–30%). Subject to voting rights per certificate of incorporation.",
 example: "Maya and Daniel each hold 4M Common at founding." },
 { term: "Preferred Shares", category: "Equity Instruments",
 definition: "Shares with extra rights (liquidation preference, anti-dilution, board seats) typically issued to investors in priced rounds. Series Seed, Series A, Series B and so on.",
 example: "Hydra Capital's 1.5M Series Seed Preferred." },
 { term: "SAFE", alt: ["Simple Agreement for Future Equity"], category: "Equity Instruments",
 definition: "A short contract where an investor pays now in exchange for shares at the next priced round. No interest, no maturity. The YC v1.2 post-money cap version is the early-stage standard.",
 example: "$500k SAFE @ $8M post-money cap. If next round prices the company at $12M, the SAFE converts as if the company were worth $8M — investor gets a better deal." },
 { term: "Convertible Note", category: "Equity Instruments",
 definition: "A loan that converts to shares at the next priced round. Has interest and a maturity date. Heavier paperwork than a SAFE.",
 example: "$250k note, 6% interest, 24-month maturity, $5M cap." },
 { term: "Warrant", category: "Equity Instruments",
 definition: "The right to buy shares at a fixed strike price within an expiry window. Often given to lenders or strategic partners as a sweetener.",
 example: "10-year warrant for 50k shares at $1.00 strike." },
 { term: "Option", alt: ["Stock Option"], category: "Equity Instruments",
 definition: "The right to buy a fixed number of shares at a fixed strike price after vesting. The standard equity tool for employees.",
 example: "10,000 ISOs at $0.10 strike, 4-year vest, 1-year cliff." },
 { term: "RSU", alt: ["Restricted Stock Unit"], category: "Equity Instruments",
 definition: "A promise to deliver shares once vesting hurdles are met. Common at later stages and at companies near IPO. Taxed differently from options.",
 example: "1,000 RSUs vesting quarterly over 4 years." },

 // Round Mechanics
 { term: "Pre-money valuation", alt: ["Pre"], category: "Round Mechanics",
 definition: "The agreed value of the company before new money lands.",
 example: "Pre-money $18M + $4M new investment = $22M post-money." },
 { term: "Post-money valuation", alt: ["Post"], category: "Round Mechanics",
 definition: "The company's value the moment the round closes — pre-money plus the new money raised.",
 example: "On a $4M raise at $18M pre-money, post-money is $22M." },
 { term: "Price per share", alt: ["PPS"], category: "Round Mechanics",
 definition: "What each new share costs in this round. Set by dividing pre-money by fully-diluted shares before the round.",
 example: "$18M pre / 12.7M FD shares = $1.42 per share." },
 { term: "Valuation cap", alt: ["Cap"], category: "Round Mechanics",
 definition: "The maximum company valuation at which a SAFE or Note converts to shares. Lower cap = more dilution to founders, more upside for the investor.",
 example: "$5M cap means a SAFE always converts as if the company were worth at most $5M." },
 { term: "Discount", category: "Round Mechanics",
 definition: "A percentage off the priced-round share price the SAFE/Note investor gets. 20% means they pay $0.80 for what new investors pay $1.00.",
 example: "$1.00 PPS × (1 − 0.20 discount) = $0.80 conversion price." },
 { term: "MFN", alt: ["Most-Favored-Nation"], category: "Round Mechanics",
 definition: "If you raise a later SAFE on better terms before the priced round, the MFN investor inherits those better terms automatically.",
 example: "Investor A signs a SAFE at $8M cap. You later sign Investor B at $5M cap. Investor A's MFN bumps them to $5M cap too." },
 { term: "Soft circle", category: "Round Mechanics",
 definition: "A non-binding commitment from an investor to participate at a stated amount. A strong signal but not a contract — signing the subscription docs is what makes it real.",
 example: "Hydra Capital soft-circled $1.5M; final docs sign at close." },
 { term: "Subscription docs", alt: ["Subscription Agreement"], category: "Round Mechanics",
 definition: "The signed paperwork that turns a soft circle into a binding investment.",
 example: "Investor signs sub docs → wire instructions sent → funds land → shares issued." },
 { term: "Term Sheet", category: "Round Mechanics",
 definition: "A short document outlining the headline terms of a round — valuation, instrument, board, preferences. Mostly non-binding but anchors the negotiation.",
 example: "Hydra Series Seed term sheet.pdf" },
 { term: "Round close", category: "Round Mechanics",
 definition: "The moment the round is locked: shares are issued, money is in the bank, the cap table is updated.",
 example: "Round closed 2025-03-15." },
 { term: "Lead investor", alt: ["Lead"], category: "Round Mechanics",
 definition: "The investor that anchors the round, sets the terms, and typically writes the largest cheque. Other investors follow at the same price.",
 example: "Hydra Capital led the Series Seed; Forge co-led." },
 { term: "Pro-rata rights", category: "Round Mechanics",
 definition: "The right (not obligation) to participate in the next round in an amount that maintains your existing ownership %.",
 example: "If you own 5% and we raise $10M, your pro-rata is to invest $500k to stay at 5%." },
 { term: "Bridge round", category: "Round Mechanics",
 definition: "A small round (often a SAFE or Note) to extend runway between priced rounds.",
 example: "$1M bridge SAFE between Seed and Series A." },
 { term: "Down round", category: "Round Mechanics",
 definition: "A new round priced LOWER than the previous round. Triggers anti-dilution adjustments and is generally bad signalling.",
 example: "Last round $50M post; new round at $30M post = down round." },
 { term: "Flat round", category: "Round Mechanics",
 definition: "A new round priced at the SAME valuation as the previous round. Neutral — no anti-dilution kicks in." },

 // Investor Rights
 { term: "Liquidation preference", alt: ["Liq pref"], category: "Investor Rights",
 definition: "On exit, this investor gets back this multiple of their investment BEFORE common shareholders see anything. 1× is standard and founder-friendly.",
 example: "$5M invested at 1× liq pref → first $5M out goes to the investor on a sale." },
 { term: "Participating preferred", category: "Investor Rights",
 definition: "After getting their liq-pref back, the investor ALSO shares pro-rata in the remaining proceeds with common. Aggressive — most early-stage rounds use non-participating.",
 example: "On a $50M sale: investor takes their $5M liq-pref, then participates in the remaining $45M." },
 { term: "Non-participating preferred", category: "Investor Rights",
 definition: "On exit the investor chooses ONE of: take their liq-pref, OR convert to common and share pro-rata. Founder-friendly default.",
 example: "$5M @ 1× non-participating: on a big exit they convert to common and ride; on a small exit they take their $5M back." },
 { term: "Anti-dilution", category: "Investor Rights",
 definition: "Protects an investor's ownership % if you later raise at a lower valuation. Broad-based weighted-average is the gentle, founder-friendly version. Full ratchet is harsh.",
 example: "Investor at $1.00 PPS; next round at $0.70 PPS — their conversion ratio bumps down to compensate." },
 { term: "Broad-based weighted average", category: "Investor Rights",
 definition: "The fair, common version of anti-dilution. The investor gets a small adjustment that accounts for the SIZE of the down round, not just the price drop." },
 { term: "Full ratchet", category: "Investor Rights",
 definition: "Brutal anti-dilution. The investor's conversion price drops to the new (lower) round's price, even on a tiny down round. Avoid if at all possible." },
 { term: "Information rights", category: "Investor Rights",
 definition: "The investor's contractual right to receive financial reports — typically quarterly financials and an annual budget.",
 example: "Standard for $100k+ cheques in a priced round." },
 { term: "Board seat", category: "Investor Rights",
 definition: "A seat on the board of directors. Comes with fiduciary duties and voting power on major company decisions.",
 example: "Lead investor: 1 board seat. Common cap-table at Series A: 2 founders, 1 lead, 1 mutual independent." },
 { term: "Board observer", category: "Investor Rights",
 definition: "Sits in on board meetings without voting. Gets information but no control. Common at Seed.",
 example: "Hydra's $1.5M ticket gets one observer seat." },
 { term: "Drag-along", category: "Investor Rights",
 definition: "If a defined majority votes to sell the company, all other shareholders are 'dragged' into selling on the same terms. Stops a small holdout from blocking an exit." },
 { term: "Tag-along", category: "Investor Rights",
 definition: "If a major shareholder sells, minority shareholders can 'tag' along and sell on the same terms — protects minorities from being left behind." },
 { term: "ROFR", alt: ["Right of First Refusal"], category: "Investor Rights",
 definition: "Before a shareholder can sell to an outsider, the company (or other shareholders) get first dibs at the same price." },
 { term: "Protective provisions", category: "Investor Rights",
 definition: "A list of company actions that require preferred-shareholder consent — e.g., raising new debt, selling the company, changing the rights of preferred." },

 // Regulatory
 { term: "NVCA", alt: ["National Venture Capital Association"], category: "Regulatory",
 definition: "The US trade body whose model documents (term sheet, charter, voting agreement) are the de-facto standard for priced rounds.",
 example: "Hydra's Series Seed docs are NVCA-style." },
 { term: "YC SAFE", category: "Regulatory",
 definition: "Y Combinator's open-source SAFE template. Post-money cap (v1.2) is the modern standard. Pre-money cap (v1.0) is older / less common." },
 { term: "Delaware C-Corp", category: "Regulatory",
 definition: "The default US incorporation choice for VC-backed startups. Tax-disadvantaged for founders short-term but expected by US VCs." },
 { term: "83(b) election", category: "Regulatory",
 definition: "A US tax filing founders make within 30 days of receiving founder stock (or option exercise) to lock in tax basis at the issue price. Forget this and you'll regret it." },
 { term: "Reg D", category: "Regulatory",
 definition: "US securities exemption for private offerings to accredited investors. Most US startup rounds use 506(b) or 506(c)." },
 { term: "Accredited investor", category: "Regulatory",
 definition: "A US investor who meets income or net-worth thresholds (or relevant credentials) and can therefore participate in private offerings." },
 { term: "EMI scheme", category: "Regulatory",
 definition: "UK 'Enterprise Management Incentive' option scheme — tax-advantaged employee equity for UK companies, limit £250k per employee." },
 { term: "SEIS / EIS", category: "Regulatory",
 definition: "UK tax reliefs for early-stage investors. SEIS funds first £250k, EIS up to £12M. Highly attractive for UK angel rounds." },

 // ESOP & Vesting
 { term: "ESOP", alt: ["Employee Stock Option Pool", "Option pool"], category: "ESOP & Vesting",
 definition: "A pool of shares reserved for employee equity grants. Sized as a % of fully-diluted, refreshed at each round.",
 example: "10% post-money pool refresh at the Series Seed close." },
 { term: "Pool timing — pre-money", category: "ESOP & Vesting",
 definition: "The new pool is created BEFORE the round closes — meaning the pool dilutes founders only, not the new investors. VCs almost always require this.",
 example: "$10M pre-money + 10% pool refresh effectively makes the founder-side valuation $9M." },
 { term: "Pool timing — post-money", category: "ESOP & Vesting",
 definition: "The pool is created AFTER the round — so it dilutes everyone (founders AND new investors) proportionally. Founder-friendly but rarely accepted." },
 { term: "Vesting", category: "ESOP & Vesting",
 definition: "The schedule over which an option grant or founder stock becomes 'earned' and unforgeable. Standard: 4 years monthly, with a 1-year cliff.",
 example: "10,000 options, 48-month vest: ~208 vest per month after the cliff." },
 { term: "Cliff", category: "ESOP & Vesting",
 definition: "The minimum tenure before any equity vests. Standard is 12 months. Leave before the cliff = leave with nothing.",
 example: "12-month cliff means the first 25% lands all at once on day 365." },
 { term: "Acceleration", alt: ["Single trigger", "Double trigger"], category: "ESOP & Vesting",
 definition: "Vesting that completes early on a trigger. Single trigger = on a sale. Double trigger = on a sale AND involuntary termination. Double trigger is the norm." },
 { term: "ISO", alt: ["Incentive Stock Option"], category: "ESOP & Vesting",
 definition: "A US tax-favored employee option, $100k/yr exercise-value cap. Only employees qualify." },
 { term: "NSO", alt: ["Non-Qualified Stock Option"], category: "ESOP & Vesting",
 definition: "US options without the ISO tax advantages but more flexible — can be granted to non-employees and outside ISO limits." },
 { term: "Strike price", alt: ["Exercise price"], category: "ESOP & Vesting",
 definition: "What an option holder pays per share to exercise. Set at the fair market value (409A) on the grant date.",
 example: "Strike $0.10, current FMV $1.00 → $0.90 of paper gain per share at exercise." },
 { term: "409A valuation", category: "ESOP & Vesting",
 definition: "An independent appraisal of the fair market value of the company's common stock — used to set option strike prices. Refresh at least annually and after each round." },

 // Cap Table Views
 { term: "Basic view", category: "Cap Table Views",
 definition: "Only issued shares (Common + Preferred). Ignores the option pool, warrants, SAFEs, and notes. The most conservative ownership picture." },
 { term: "Fully diluted (FD)", alt: ["Fully Diluted"], category: "Cap Table Views",
 definition: "Counts all issued shares PLUS options reserved (granted + ungranted pool) PLUS warrants outstanding. Excludes SAFEs/notes which haven't yet converted." },
 { term: "As Converted", category: "Cap Table Views",
 definition: "Fully Diluted PLUS SAFEs and Notes converted to Common at their effective conversion price. The most permissive view — used when modelling 'what if everything turned into common today'." },
];

export const CATEGORY_ORDER = [
 "Equity Instruments",
 "Round Mechanics",
 "Investor Rights",
 "Regulatory",
 "ESOP & Vesting",
 "Cap Table Views",
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
 "Equity Instruments": "bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] border-[hsl(0_100%_40%)]/30",
 "Round Mechanics": "bg-amber-100 text-amber-800 border-amber-300/40",
 "Investor Rights": "bg-rose-100 text-rose-800 border-rose-300/40",
 "Regulatory": "bg-blue-100 text-blue-800 border-blue-300/40",
 "ESOP & Vesting": "bg-emerald-100 text-emerald-800 border-emerald-300/40",
 "Cap Table Views": "bg-violet-100 text-violet-800 border-violet-300/40",
};

export function GlossaryDialog({ trigger }: { trigger: React.ReactNode }) {
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState("");

 const filtered = useMemo(() => {
 if (!query.trim()) return ENTRIES;
 const q = query.toLowerCase();
 return ENTRIES.filter((e) =>
 e.term.toLowerCase().includes(q) ||
 e.definition.toLowerCase().includes(q) ||
 e.alt?.some((a) => a.toLowerCase().includes(q)) ||
 e.example?.toLowerCase().includes(q),
 );
 }, [query]);

 const grouped = useMemo(() => {
 const groups = new Map<string, GlossaryEntry[]>();
 for (const e of filtered) {
 const arr = groups.get(e.category) ?? [];
 arr.push(e);
 groups.set(e.category, arr);
 }
 return groups;
 }, [filtered]);

 return (
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogTrigger asChild>{trigger}</DialogTrigger>
 <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
 <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
 <DialogTitle className="flex items-center gap-2 text-base">
 <BookOpen className="h-4 w-4 text-[hsl(0_100%_40%)]" />
 Capavate glossary
 </DialogTitle>
 <p className="text-xs text-muted-foreground mt-1">
 Plain-English definitions for every cap-table and round-management term Capavate uses. Search or browse.
 </p>
 <div className="relative mt-3">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 autoFocus
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search terms (e.g. 'cap', 'liquidation', 'cliff')…"
 className="pl-9"
 data-testid="input-glossary-search"
 />
 </div>
 <div className="flex flex-wrap gap-1.5 mt-3">
 <span className="text-[11px] text-muted-foreground">{ENTRIES.length} terms</span>
 <span className="text-[11px] text-muted-foreground">·</span>
 {CATEGORY_ORDER.map((c) => (
 <Badge key={c} variant="outline" className={`text-[10px] ${CATEGORY_COLORS[c]}`}>{c}</Badge>
 ))}
 </div>
 </DialogHeader>
 <ScrollArea className="flex-1 px-6 py-4">
 {filtered.length === 0 ? (
 <div className="text-center text-sm text-muted-foreground py-12">
 No terms match "{query}".
 </div>
 ) : (
 <div className="space-y-6">
 {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
 <section key={category}>
 <div className="flex items-center gap-2 mb-2">
 <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
 <div className="flex-1 h-px bg-border" />
 <span className="text-[10px] text-muted-foreground">{grouped.get(category)?.length}</span>
 </div>
 <ul className="space-y-3">
 {grouped.get(category)?.map((e) => (
 <li key={e.term} className="text-sm">
 <div className="flex flex-wrap items-baseline gap-2">
 <span className="font-semibold">{e.term}</span>
 {e.alt?.map((a) => (
 <span key={a} className="text-[11px] text-muted-foreground italic">aka {a}</span>
 ))}
 </div>
 <p className="text-muted-foreground mt-0.5 leading-relaxed">{e.definition}</p>
 {e.example && (
 <p className="text-[11px] text-foreground/80 mt-1 pl-3 border-l-2 border-[hsl(0_100%_40%)]/40 italic">
 {e.example}
 </p>
 )}
 </li>
 ))}
 </ul>
 </section>
 ))}
 </div>
 )}
 </ScrollArea>
 </DialogContent>
 </Dialog>
 );
}

/** Default link trigger — drop next to a page header. */
export function GlossaryLink({ size = "sm" }: { size?: "xs" | "sm" }) {
 return (
 <GlossaryDialog
 trigger={
 <button
 type="button"
 className={`inline-flex items-center gap-1.5 ${size === "xs" ? "text-[11px]" : "text-xs"} text-muted-foreground hover:text-foreground transition-colors`}
 data-testid="link-glossary"
 >
 <BookOpen className="h-3.5 w-3.5" />
 Open glossary
 </button>
 }
 />
 );
}
