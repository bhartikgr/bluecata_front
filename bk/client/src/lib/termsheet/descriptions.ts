/**
 * Sprint 26 — Investor-grade clause descriptions for term sheets.
 *
 * Every clause id (the same `id` field used in templates.ts) maps to a
 * structured ClauseDescription. The descriptions follow the four-part
 * institutional pattern:
 *
 *   whatItMeans     — plain English so non-lawyers understand the clause
 *   whyItMatters    — investor-grade rationale + the market norm
 *   commonVariants  — the negotiable alternatives a founder might see
 *   founderWatchouts — the failure modes / how this can go wrong
 *   citation        — the authoritative source (NVCA, YC, BVCA, etc.)
 *
 * Sources cited reflect the same authoritative documents used in templates.ts:
 *   - NVCA Model Term Sheet (2024) — https://nvca.org/model-legal-documents/
 *   - YC SAFE v1.2 (post-money) — https://www.ycombinator.com/documents
 *   - BVCA Model Form Term Sheet — https://www.bvca.co.uk/
 *   - J-KISS (Coral Capital) — https://github.com/CoralCapital/jkiss
 *   - Carta anti-dilution explainer — https://carta.com/blog/anti-dilution-protection/
 *   - Companies Act 2013 (IN) §55, §62, §71 — https://www.mca.gov.in/
 *   - Pulley convertible-note guide — https://pulley.com/guides/convertible-notes
 */
import type { ClauseDescription } from "./types";

export const CLAUSE_DESCRIPTIONS: Record<string, ClauseDescription> = {
  /* ============================ Common header ============================ */
  preamble: {
    whatItMeans:
      "Names the parties, frames the document as non-binding (with a few exceptions), and identifies the contemplated financing. The opening paragraph that every counsel reads first.",
    whyItMatters:
      "Investor-grade term sheets are almost entirely non-binding so neither side is locked in before diligence completes. The binding carve-outs (Confidentiality, No-Shop, Expenses, Governing Law) are the only enforceable promises at signing — they protect both sides during the deal window.",
    commonVariants:
      "Some leads insist on a binding exclusivity period that survives termination; some founder-friendly sheets carve back to ‘no-shop expires automatically if Lead doesn't fund within 45 days.’",
    founderWatchouts:
      "Do not let the preamble accidentally describe definitive-agreement-level commitments. If anything that should be binding (e.g. valuation) appears here, restructure into the Definitive Agreements clause.",
    citation: "NVCA Model Term Sheet (2024) — Section 1 (Preamble).",
  },
  closing: {
    whatItMeans:
      "The target closing date — the day money wires, shares issue, and the cap table updates.",
    whyItMatters:
      "A defined target keeps the deal moving. Investors stay engaged when there is a fixed wire date; founders avoid \"dead deal\" drift.",
    commonVariants:
      "Single closing (all-in) vs. multi-closing (lead first, then follow-on within 30–90 days). Multi-closings are common for seed/seed-extension rounds where soft-circled investors close on staggered KYC timelines.",
    founderWatchouts:
      "If you miss the date by more than 30 days the lead may renegotiate price. Build in a 'subsequent closing' window so soft-circled investors can join after the headline close.",
    citation: "NVCA Model Term Sheet §1.1 (Closing); ABA Stock Purchase Agreement model §1.3.",
  },
  investors: {
    whatItMeans:
      "Identifies the Lead Investor (who sets terms and typically takes the board seat) and the syndicate of follow-on Investors.",
    whyItMatters:
      "The Lead is the price-setter and the negotiation counterparty. Other Investors get to follow on the Lead's negotiated terms — this is the 'lead investor premium' the market pays for price discovery.",
    commonVariants:
      "Single lead vs. co-leads. Some rounds list a 'Major Investor' threshold (e.g. $250k) that triggers board observer rights, pro-rata, and information rights.",
    founderWatchouts:
      "Avoid 'party rounds' with no clear lead — they are slow to close and create governance ambiguity. A real Lead with ≥ 50% of the round simplifies follow-on negotiation.",
    citation: "NVCA Model Term Sheet §2 (Investors); 'Major Investor' threshold from NVCA Investors' Rights Agreement.",
  },

  /* ============================ Priced round ============================== */
  instrument: {
    whatItMeans:
      "The class of security being issued (Series A Preferred Stock, SAFE, Convertible Note, etc.).",
    whyItMatters:
      "Different instruments carry very different rights. Preferred stock gets liquidation preferences, dividends, voting carve-outs. SAFEs and Notes defer pricing to the next priced round — useful for early-stage rounds where valuation is contested.",
    commonVariants:
      "Series Seed Preferred (light-weight, NVCA Series Seed template), full Series A Preferred (NVCA full-form), SAFE post-money (YC v1.2), SAFE pre-money (YC v1.0), Convertible Note (NVCA / Pulley template), Class A Shares (Japan §107-108), CCPS (India).",
    founderWatchouts:
      "Mixing instruments in the same round (e.g. SAFE + Preferred) complicates the cap table at conversion. Pick one instrument per round wherever possible.",
    citation: "NVCA Series A Preferred Stock Purchase Agreement; YC SAFE v1.2; BVCA Model Form §3.",
  },
  amount: {
    whatItMeans:
      "The aggregate dollars (or local currency) raised in this round.",
    whyItMatters:
      "The headline number markets to LPs, employees, and the press. Investors size their allocation against this number. Founders dilute against this number.",
    commonVariants:
      "Hard target (e.g. exactly $4M) vs. range ($3.5M–$5M with a 'minimum closing' floor). Range-based rounds are common when soft-circles exceed target — the founder can take more without re-papering.",
    founderWatchouts:
      "Raise the amount you need + ~6 months runway buffer. Raising too little forces a bridge round at the same valuation; raising too much over-dilutes for capital you don't yet need.",
    citation: "NVCA Model Term Sheet §3 (Aggregate Investment); 18–24 month runway target per Sequoia Capital playbook.",
  },
  premoney: {
    whatItMeans:
      "The agreed value of the company BEFORE the new money lands. Pre-money + new money = post-money valuation.",
    whyItMatters:
      "Pre-money determines price-per-share and therefore every existing holder's dilution. A higher pre-money means less founder dilution; a lower pre-money means investors buy more shares for the same dollars.",
    commonVariants:
      "Pre-money vs. post-money pool: pre-money pool dilutes founders only; post-money pool dilutes all holders pro-rata. NVCA default is pre-money pool — favours investors.",
    founderWatchouts:
      "Always confirm the Fully-Diluted Capitalization assumption in this clause matches your actual cap table including options outstanding and warrants. A 10% pool top-up at pre-money silently reduces founder ownership by ~9% even at a 'clean' valuation.",
    citation: "NVCA Model Term Sheet §4 (Pre-Money Valuation); Carta 'How option-pool shuffles work' explainer.",
  },
  pps: {
    whatItMeans:
      "The price each new share costs in this round, calculated as Pre-Money Valuation ÷ Fully-Diluted Capitalization.",
    whyItMatters:
      "The Original Issue Price (OIP) anchors the liquidation preference and the anti-dilution protection. Every future down-round adjusts against this number.",
    commonVariants:
      "Quoted to 4 decimal places per NVCA convention. Some sheets quote in whole cents only — fine for round numbers but rounds against fractional shares at issue.",
    founderWatchouts:
      "If your Fully-Diluted Capitalization in the Pre-Money clause changes after diligence (e.g. unaccounted-for advisor grants), the PPS changes mechanically — the investor amount stays the same and your share count shrinks.",
    citation: "NVCA Model Term Sheet §5 (Price Per Share).",
  },
  liq: {
    whatItMeans:
      "How money is distributed if the company is sold or liquidated. The preferred stockholders get paid first (their preference), then the common (founders + employees) splits the rest.",
    whyItMatters:
      "This is the single most economically-material clause in the entire term sheet. 1× non-participating is the founder-friendly market norm. 2× participating with no cap is investor-friendly and rare in healthy markets.",
    commonVariants:
      "1× non-participating (market standard 2020–2024). 1× participating capped at 2–3× (sometimes seen in bridge rounds). 2× non-participating (deep-tech / dilutive rounds). Full participation with no cap is a red flag.",
    founderWatchouts:
      "A 1× participating preference on a $10M raise means investors take $10M off the top AND share the remainder pro-rata. On a $30M exit they get $10M + ~30% of $20M = $16M, leaving common with $14M. The same round with 1× non-participating would let common compete to $30M × ownership%.",
    citation: "NVCA Model Term Sheet §6 (Liquidation Preference); PitchBook Q2 2024 venture-terms survey shows 92% non-participating at Series A.",
  },
  ad: {
    whatItMeans:
      "Protects the investor's effective price-per-share if the company later issues stock at a lower price (a 'down-round'). The conversion ratio recalculates upward.",
    whyItMatters:
      "Anti-dilution is the second most material clause after liquidation preference. Broad-based weighted-average is the NVCA market standard — it shares the pain between investor and founders proportionally. Full ratchet is investor-friendly and rare in modern rounds.",
    commonVariants:
      "Broad-based weighted-average (NVCA Charter §4.4(d)(ii)(A) — the standard); narrow-based weighted-average (less common, slightly more investor-friendly); full ratchet (rare except in distressed bridge rounds).",
    founderWatchouts:
      "Full ratchet on a 50% down-round can mathematically wipe out founder ownership. Always insist on broad-based weighted-average and the customary carve-outs (option grants, M&A consideration, prior convertibles).",
    citation: "NVCA Model Charter §4.4(d)(ii)(A); Carta 'How weighted-average anti-dilution works'.",
  },
  dividends: {
    whatItMeans:
      "Preferred stockholders may be entitled to a dividend (typically 6–8% per annum), payable only if and when declared by the board. Almost never actually paid in VC-backed companies until exit.",
    whyItMatters:
      "Non-cumulative is market standard — dividends accrue only if declared. Cumulative dividends (declared or not) build up and dilute the founders' exit proceeds. Cumulative is investor-friendly and uncommon at seed/A.",
    commonVariants:
      "Non-cumulative when, as, and if declared (NVCA default). Cumulative compounding (later-stage debt-like rounds). PIK (paid-in-kind, accrues in shares) — found mainly in distressed bridge rounds.",
    founderWatchouts:
      "If your sheet says 'cumulative' or 'PIK', model the dilution effect at exit. At 8% cumulative over 5 years your effective liquidation preference grows ~47% from the headline number.",
    citation: "NVCA Model Term Sheet §8 (Dividends); 8% per annum is the modal rate per AngelList/PitchBook data.",
  },
  conversion: {
    whatItMeans:
      "Preferred stock can be converted to common stock at the holder's option (always), or automatically on a qualifying IPO. After conversion, preferred holders have the same rights as founders.",
    whyItMatters:
      "Mandatory conversion on a qualifying IPO (e.g. ≥$50M gross at ≥3× OIP) is the standard exit trigger. It simplifies the cap table at IPO and is non-negotiable for most institutional investors.",
    commonVariants:
      "QPO threshold: $50M+ at 3× OIP (NVCA default). Some sheets use $30M or 2× — more founder-friendly. Mandatory conversion on majority-investor vote (typical) vs. full series vote (rare).",
    founderWatchouts:
      "If your QPO threshold is too high (e.g. $200M at 5× OIP), preferred holders effectively keep their preference indefinitely — a problem if you IPO smaller than expected.",
    citation: "NVCA Model Charter §4 (Conversion); QPO thresholds per NVCA 2024 deal-terms report.",
  },
  vote: {
    whatItMeans:
      "How preferred holders vote on company matters. Standard is 'as-converted' — meaning their preferred shares vote the same way and weight as their hypothetical common shares.",
    whyItMatters:
      "As-converted voting keeps governance simple. Protective Provisions (the separate-class veto) live in a different clause and apply to specific matters only.",
    commonVariants:
      "As-converted with common (NVCA default). Voting as a separate class on specific matters (handled by Protective Provisions). Super-voting common for founders — rare in priced rounds, common in pre-IPO recaps.",
    founderWatchouts:
      "Watch for 'majority of preferred vote required for X' creeping into multiple clauses — it gives the lead a veto on operational decisions the founder should control.",
    citation: "NVCA Model Charter §4.1 (Voting Rights).",
  },
  protective: {
    whatItMeans:
      "A list of major company actions (e.g. selling the company, raising more money, amending the charter) that need a separate-class vote from preferred holders — even if the common majority approves.",
    whyItMatters:
      "Protective Provisions are the investor's emergency-brake. They prevent the founder-controlled board from making decisions that harm the preferred holders' economics (issuing a senior series, taking on bank debt, doing a fire-sale).",
    commonVariants:
      "NVCA standard list: charter amendments, senior/pari-passu series, sale/liquidation, dividend declaration, change to authorized shares, pool increase, debt > $500k. Some leads ask for headcount limits, capex caps — push back; those aren't market.",
    founderWatchouts:
      "An overly broad list (e.g. 'any expenditure > $250k') effectively gives the lead a veto on hiring decisions. Keep it to capital-structure and existential events only.",
    citation: "NVCA Model Charter §4.3 (Protective Provisions); NVCA Investors' Rights Agreement §3 (parallel protective provisions).",
  },
  rofr: {
    whatItMeans:
      "Right of First Refusal: if a founder wants to sell their common shares, they must offer them to the preferred holders first. Co-Sale: if the founder does sell, the preferred can join the sale pro-rata.",
    whyItMatters:
      "Prevents founders from quietly cashing out via secondary sales while the investors are still locked in. Standard NVCA Major-Investor right.",
    commonVariants:
      "All preferred holders vs. only Major Investors (the typical $250k+ threshold). Permitted-transferee carve-outs for estate planning and divorce.",
    founderWatchouts:
      "Carve out 'permitted transfers' (trusts, family LLCs, GRATs) for legitimate estate planning. Also carve out small secondary sales (e.g. up to 5% in any 12 months) so you can pay taxes on vesting without permission.",
    citation: "NVCA Right of First Refusal and Co-Sale Agreement (Model Form).",
  },
  drag: {
    whatItMeans:
      "If a qualified majority approves a sale, all other holders are required to vote in favor — preventing a single dissenter from blocking an exit.",
    whyItMatters:
      "The Drag-Along is the founder's exit-execution insurance. Without it, a 5% minority holder can hold up a $500M acquisition for nuisance value.",
    commonVariants:
      "Triple-trigger (NVCA): Board + Common majority + Preferred majority. Some leads ask for double-trigger (drop Common majority) — push back: founder control of the Common majority is the whole point.",
    founderWatchouts:
      "Insist on the Common-majority trigger so founder-led common cannot be dragged into a sale by preferred holders alone. Also add a 'minimum sale price' floor (e.g. ≥ 2× last preferred preference) so the drag can't force a fire-sale.",
    citation: "NVCA Voting Agreement §3 (Drag-Along); ABA Model Stock Purchase Agreement.",
  },
  board: {
    whatItMeans:
      "Who sits on the board of directors. The board controls hiring/firing the CEO, approving budgets, and approving major decisions.",
    whyItMatters:
      "Board composition is governance. A 2-2-1 board (2 common, 2 preferred, 1 independent) with the independent being mutually agreed is the NVCA standard at Series A. The founder controls the common seats; the lead controls the preferred seats; the independent is the swing vote.",
    commonVariants:
      "3-seat (Lead + Common + Independent): common at seed/A. 5-seat (Lead + Common + Founders × 2 + Independent): rare. 7-seat (B+): adds a second preferred director and a second independent.",
    founderWatchouts:
      "If the lead asks for 2 of 3 preferred seats and the independent is 'mutually agreed,' the lead effectively controls the board. Insist on the common-majority structure until Series B at the earliest.",
    citation: "NVCA Voting Agreement §1 (Board of Directors); 2-2-1 is the modal Series A structure per Cooley GO data.",
  },
  "founder-vesting": {
    whatItMeans:
      "Founder common stock vests over time. Unvested shares are 'returnable' to the company if the founder leaves. Standard is 48-month vesting with a 12-month cliff.",
    whyItMatters:
      "Investors require founder vesting because they're funding the team, not just the idea. Without vesting, a founder could quit the next day with all their shares and the company would have to fund a replacement from the option pool.",
    commonVariants:
      "48-month / 12-month cliff (market standard); 36-month / 6-month cliff (occasional for repeat founders); single-trigger acceleration on involuntary termination (NVCA standard); double-trigger acceleration on Change-of-Control (NVCA standard).",
    founderWatchouts:
      "Always negotiate credit for time-served (e.g. 12 months credit if you've been operating ≥ 12 months at signing). Without it, a 4-year-in founder restarts the 48-month clock at Closing.",
    citation: "NVCA Restricted Stock Purchase Agreement; 'double-trigger acceleration' per Cooley GO standard.",
  },
  esop: {
    whatItMeans:
      "Reserves shares for future hires. The 'top-up' makes sure the unallocated portion equals a target percentage (typically 10%) of the post-Closing fully-diluted cap table.",
    whyItMatters:
      "Whether the top-up sits 'pre-money' or 'post-money' is the single biggest hidden-dilution lever in any priced round.",
    commonVariants:
      "Pre-money pool (NVCA default): the pool sits inside the pre-money valuation, so the founders alone bear the dilution. Post-money pool: dilution is shared pro-rata across all holders. Some investors will agree to 50/50 split on the dilution as a negotiation compromise.",
    founderWatchouts:
      "A 10% pre-money pool on a $10M pre / $4M raise gives the founders a stealth ~9% dilution before the lead's first share is issued. Always model the post-Closing cap table BOTH ways and negotiate the smaller pool that supports your actual 12-month hiring plan.",
    citation: "NVCA Model Term Sheet §11 (Employee Pool); Carta 'The option pool shuffle' explainer.",
  },
  "info-rights": {
    whatItMeans:
      "Standard reporting package: annual audited financials, quarterly unaudited, an annual budget, and inspection rights. Given to Major Investors only.",
    whyItMatters:
      "Information Rights are the basic transparency obligation. Without them, investors can't track their investment or comply with their own LP reporting.",
    commonVariants:
      "Major-Investor threshold ($250k typical, $500k+ at later stages). Some sheets add monthly KPI dashboards — pushable for venture funds, fine for early-stage.",
    founderWatchouts:
      "Audited financials at seed/A are expensive (~$30k–$50k/year). Negotiate 'audited or founder-certified' until Series B. Also negotiate confidentiality of competitive info in monthly dashboards — small investors shouldn't see your engineering roadmap.",
    citation: "NVCA Investors' Rights Agreement §3 (Information Rights).",
  },
  "pro-rata": {
    whatItMeans:
      "Major Investors have the right (not obligation) to invest in future rounds at their current ownership percentage. Keeps them from getting diluted out as the company grows.",
    whyItMatters:
      "Pro-rata is the most valuable non-headline right an investor receives. For their best-performing companies, it's where institutional VCs make the bulk of their returns.",
    commonVariants:
      "Pro-rata to Major Investors only (NVCA default). 'Super pro-rata' (invest 1.5× their current %) — rare and investor-friendly. 'Pay-to-play' (pro-rata is forfeited if not exercised in a down-round) — useful in tough markets.",
    founderWatchouts:
      "Pro-rata limits new-investor allocation in hot follow-on rounds. If your seed had 5 firms with pro-rata, there might be no room for the Series A lead. Negotiate a Lead-allocation carve-out where the new lead can buy at least their target without pro-rata haircut.",
    citation: "NVCA Investors' Rights Agreement §4 (Right of First Offer / Pro-Rata Rights).",
  },
  "no-shop": {
    whatItMeans:
      "For a fixed window (typically 30 days) after signing the term sheet, the company cannot solicit or accept competing offers. The exclusivity period.",
    whyItMatters:
      "The lead is about to spend $20k–$50k+ on legal and diligence. They need to know you won't shop their term sheet to push the price up. This is one of the few binding clauses in the term sheet.",
    commonVariants:
      "30 days (NVCA default). 45–60 days (large rounds, foreign leads). Some sheets allow continued informal conversations but not formal term-sheet exchange.",
    founderWatchouts:
      "Insist that No-Shop expires automatically if Lead doesn't fund within the window. Without that, a lead can walk on day 29 and you've lost a month with no fallback. Also carve out continued conversations with existing investors and consortium partners.",
    citation: "NVCA Model Term Sheet §13 (No-Shop); Cooley GO 'Negotiating no-shop provisions'.",
  },
  expenses: {
    whatItMeans:
      "The company reimburses the lead investor's legal fees up to a cap (typically $35k at Series A, $50k+ at B/C).",
    whyItMatters:
      "Investor counsel does most of the document drafting at Series A. The cap protects the founder from runaway legal bills; the reimbursement protects the lead from doing free work if the deal falls through.",
    commonVariants:
      "$25k–$35k at Series A (NVCA range). $50k+ at Series B/C. Cap applies only on Closing — if the deal dies, each side pays its own counsel.",
    founderWatchouts:
      "Push back on caps above $35k at Series A — that's a signal the lead's counsel is doing more than NVCA-template work and you'll pay for it. Always insist 'payable only at Closing' — if the deal dies you should owe nothing.",
    citation: "NVCA Model Term Sheet §14 (Expenses); cap ranges per PitchBook 2024 venture-fees report.",
  },

  /* ================================ SAFE ================================== */
  cap: {
    whatItMeans:
      "The Valuation Cap is the ceiling on the price-per-share when the SAFE converts. The lower of the cap-implied price and the discount-implied price (and the round price) becomes the actual conversion price.",
    whyItMatters:
      "The cap protects the SAFE holder against an unexpectedly high Series A valuation. A $5M cap on a $20M Series A means the SAFE converts at the $5M-implied price — 4× more shares than a round-priced investor.",
    commonVariants:
      "Post-money cap (YC SAFE v1.2 default — the SAFE holder's percentage is computed against post-money including all converted SAFEs). Pre-money cap (YC SAFE v1.0 legacy — the percentage is computed against pre-money). Post-money is the modern market norm.",
    founderWatchouts:
      "Stack ≥ 3 SAFEs and your effective dilution at the Series A can exceed 25% before the lead's first share is issued. Always model post-Closing dilution against the actual SAFE stack — not just headline cap.",
    citation: "YC SAFE v1.2 (post-money cap) User Guide — https://www.ycombinator.com/documents.",
  },
  discount: {
    whatItMeans:
      "If no Valuation Cap is met, the SAFE/Note converts at a discount (typically 20%) to the Series A price-per-share. Equivalent to giving the holder ~25% more shares than a round-priced investor.",
    whyItMatters:
      "The discount compensates the SAFE/Note investor for taking earlier risk. Standard discounts are 15–25%; 20% is the modal market value.",
    commonVariants:
      "20% (modal). 15% (founder-friendly, repeat founders). 25–30% (later-stage bridge or tougher market). Some SAFEs are 'discount-only' (no cap) — useful when valuation is too contested.",
    founderWatchouts:
      "If both cap and discount apply, the SAFE converts at the LOWER price. Discount + cap together can produce surprising dilution in fast-growing companies — model both paths.",
    citation: "YC SAFE v1.2 User Guide §2 (Conversion Price); 20% modal per AngelList Q1 2024 convertible-terms data.",
  },
  mfn: {
    whatItMeans:
      "Most-Favored-Nation: if the company later issues a SAFE/Note on better terms, this investor can amend to match those terms.",
    whyItMatters:
      "MFN protects early SAFE holders from later investors negotiating a sweetener (e.g. a lower cap, a bigger discount). It's standard for the FIRST SAFE in a round.",
    commonVariants:
      "Standard MFN (single later-issued SAFE triggers). Multi-step MFN (rolling — applies to all later SAFEs). No-MFN (later-stage rounds where the lead doesn't want first-SAFE protection).",
    founderWatchouts:
      "MFN can lock you into the LOWEST cap you ever issue, even if it was a tiny strategic investor. Be deliberate about which SAFEs carry MFN and which don't — and never grant retroactive MFN.",
    citation: "YC Post-Money SAFE — Most-Favored-Nation provision; Cooley GO 'How SAFE MFN works'.",
  },
  trigger: {
    whatItMeans:
      "The event that converts the SAFE/Note into equity. Standard trigger: a 'Qualified Financing' of at least $1M in gross proceeds.",
    whyItMatters:
      "Without a trigger, a SAFE never converts. The trigger ensures conversion happens at the first real priced round, not at a tiny seed-extension that wouldn't otherwise warrant it.",
    commonVariants:
      "$1M+ Qualified Financing (YC default). $250k+ (smaller threshold for earlier-stage). Time-based fallback ('if no Qualified Financing within 24 months, holder may elect cash repayment or convert at the cap').",
    founderWatchouts:
      "If your trigger threshold is too high, a SAFE holder gets stuck in limbo on a small bridge round. Match the trigger to the minimum round you'd realistically do next.",
    citation: "YC SAFE v1.2 §1 (Triggering Events).",
  },

  /* ============================ Convertible Note ============================ */
  principal: {
    whatItMeans:
      "The dollar amount loaned to the company. Accrues interest until conversion or maturity.",
    whyItMatters:
      "Principal + accrued interest = the total amount that converts at the trigger event. Note investors usually convert (not repay) — but they have the legal right to demand repayment at maturity.",
    commonVariants:
      "Single-tranche notes (one wire at signing). Multi-tranche notes (commitment with milestone-based draws). Some notes have a 'most-favored-investor' carry-back if a SAFE is later issued at a lower cap.",
    founderWatchouts:
      "If the note matures before you raise a Qualified Financing, the holders can demand cash repayment — which the company often can't afford. Build a 'conversion at the cap' fallback that auto-converts on maturity.",
    citation: "NVCA Convertible Note Term Sheet; Pulley 'Convertible notes 101' guide.",
  },
  interest: {
    whatItMeans:
      "The annual interest rate (typically 4–8%) the note accrues until conversion or repayment. Usually simple interest.",
    whyItMatters:
      "Note interest is a small economic benefit compared to the cap/discount, but it adds up: on a $1M note at 8% over 24 months, the holder converts $1.16M not $1M — 16% more shares.",
    commonVariants:
      "5–8% simple interest (market). 8% compounded annually (founder-unfriendly). PIK interest (paid in additional notes — late-stage / distressed only).",
    founderWatchouts:
      "Compounded interest grows faster than simple — model both. AFR (Applicable Federal Rate) compliance: too-low rates trigger imputed-interest tax issues; consult tax counsel.",
    citation: "NVCA Convertible Note model; IRC §1274 imputed-interest rules (US).",
  },
  maturity: {
    whatItMeans:
      "The note's due date — typically 18–24 months after issuance. At maturity, the holder can demand cash repayment OR convert at the cap.",
    whyItMatters:
      "Maturity is the holder's enforcement mechanism. If the company hasn't raised a Qualified Financing by then, the holder has leverage to renegotiate terms.",
    commonVariants:
      "18 months (aggressive, signals 'raise the A by then'). 24 months (market standard). 36 months (long-runway companies, deep tech).",
    founderWatchouts:
      "Build a 'majority-of-noteholders may extend by 6 months' provision so a single dissenter can't trigger a call. Also negotiate auto-conversion at the cap on maturity as the default, with cash repayment requiring affirmative election.",
    citation: "NVCA Convertible Note Term Sheet §3 (Maturity Date).",
  },
  "cap-discount": {
    whatItMeans:
      "How the note converts at the next Qualified Financing: at the LOWER of (a) the cap-implied price and (b) the discount-implied price. Same mechanic as a SAFE.",
    whyItMatters:
      "The conversion-price mechanic is the economic core of every convertible. Always model both paths and confirm which is more dilutive for the company at the expected Series A price.",
    commonVariants:
      "Cap + discount (most common). Cap only (discount waived for strategic investors). Discount only (uncapped — rare).",
    founderWatchouts:
      "When the cap is much lower than the next-round price, the cap dominates and the discount is irrelevant. Don't pay both — negotiate one or the other.",
    citation: "Pulley convertible-note guide; YC SAFE conversion mechanic (analogous).",
  },
  qf: {
    whatItMeans:
      "The size threshold that triggers automatic conversion. Below this size, the note doesn't auto-convert and the holder has to decide whether to convert voluntarily or hold.",
    whyItMatters:
      "Prevents the founder from doing a tiny insider round at a low valuation just to wipe out the noteholders. Investor protection.",
    commonVariants:
      "$1M+ (YC / NVCA default). $250k+ (earliest stage). $5M+ (later-stage notes that want to convert only on a full priced round).",
    founderWatchouts:
      "If your threshold is too high, a bridge round below it won't auto-convert and you have stranded notes. Match to your expected Series A round size.",
    citation: "NVCA Convertible Note Term Sheet §5 (Qualified Financing).",
  },

  /* ============================== Warrant ================================= */
  underlying: {
    whatItMeans:
      "The number of shares the warrant gives the holder the right to purchase. Set at issuance and adjusts for splits.",
    whyItMatters:
      "Warrants are typically used to compensate strategic partners, lenders, or advisors. The underlying share count determines the upside.",
    commonVariants:
      "Fixed share count (e.g. 50,000 shares at $1 strike). Penny warrants (strike = $0.0001, effectively a grant). Coverage warrants (% of an associated loan — common in venture debt).",
    founderWatchouts:
      "Warrants count in your fully-diluted cap table even before exercise. Disclose them in every future Pre-Money Valuation clause; failure to do so creates anti-dilution exposure.",
    citation: "NVCA Warrant model; Carta 'Warrants vs. options' explainer.",
  },
  strike: {
    whatItMeans:
      "The exercise price — what the holder pays per share at exercise.",
    whyItMatters:
      "Set at the 409A fair-market value at issuance (or the most recent priced-round PPS). Below-FMV strikes trigger IRC §409A penalties for the holder.",
    commonVariants:
      "409A FMV (most common). Most-recent priced-round PPS (for late-stage warrants). Penny strike ($0.0001 — effectively a grant).",
    founderWatchouts:
      "Always get a 409A appraisal within the last 12 months before issuing a warrant. A stale 409A is a §409A penalty waiting to happen.",
    citation: "IRC §409A regulations; NVCA Warrant Agreement §2 (Exercise Price).",
  },
  term: {
    whatItMeans:
      "The expiration date — the latest the warrant can be exercised. Standard is 10 years.",
    whyItMatters:
      "10 years aligns with NVCA convention and IRS option-pricing assumptions. Shorter terms reduce the option's value to the holder.",
    commonVariants:
      "10 years (NVCA standard). 5–7 years (venture-debt warrants). Survive Change-of-Control? Yes by default — but some warrants auto-exercise at a sale.",
    founderWatchouts:
      "Auto-exercise-on-sale is convenient for holders but creates a 'phantom' line item on every M&A waterfall. Use net-exercise (cashless) and explicit survival to keep the cap table clean at sale.",
    citation: "NVCA Warrant Agreement §3 (Term).",
  },
  cashless: {
    whatItMeans:
      "Net (cashless) exercise lets the holder receive only the in-the-money portion of the warrant — they don't have to wire cash for the strike.",
    whyItMatters:
      "Standard for venture-debt and strategic-partner warrants. Simplifies M&A waterfalls because the warrant cancels into the appropriate net share count.",
    commonVariants:
      "Cashless allowed at all times (NVCA standard). Cashless only at expiration / Change-of-Control (less holder-friendly). Cash-only (rare — pushes back on holder convenience).",
    founderWatchouts:
      "Cashless exercise transfers value via share dilution rather than incoming cash. Model post-cashless cap-table impact at typical exit valuations.",
    citation: "NVCA Warrant Agreement §4 (Cashless Exercise).",
  },

  /* ============================ Option Pool ================================ */
  size: {
    whatItMeans:
      "The percentage of post-Closing fully-diluted shares reserved for future employee equity grants.",
    whyItMatters:
      "10% post-Closing is the market-standard reserve at Series A. The 'shuffle' is whether this lives inside pre-money (founder-dilutive) or post-money (everyone-dilutive).",
    commonVariants:
      "5–15% (range). 10% (modal at Series A). Larger at later stages where headcount is growing fast.",
    founderWatchouts:
      "Size to your real 12-month hiring plan, not a one-size-fits-all 10%. Build a defensible hiring plan with role, level, expected grant size — push back with the data when the lead asks for 12–15%.",
    citation: "NVCA Model Term Sheet §11 (Employee Pool); Carta 'Option pool sizing benchmarks'.",
  },
  timing: {
    whatItMeans:
      "When the pool is created relative to the new-money issuance. Pre-money pool = before round (founders dilute alone). Post-money pool = after round (everyone shares dilution pro-rata).",
    whyItMatters:
      "This is the single biggest hidden-dilution lever in any priced round. A 10% pre-money pool on a $10M pre / $4M raise gives the founders a stealth ~9% extra dilution.",
    commonVariants:
      "Pre-money pool (NVCA default — investor-friendly). Post-money pool (rarer, founder-friendly). 50/50 split (negotiated compromise).",
    founderWatchouts:
      "Always model BOTH cap tables. Negotiate the smaller pool that supports your real hiring plan AND the post-money treatment if you can get it. Either lever is worth real points of founder ownership.",
    citation: "Carta 'The option pool shuffle' explainer; NVCA Model Term Sheet §11.",
  },
  vesting: {
    whatItMeans:
      "Standard 48-month vesting with a 12-month cliff. After the cliff, vesting is monthly. Unvested shares forfeit on termination.",
    whyItMatters:
      "Vesting aligns employees with long-term outcomes. The cliff filters out fast quitters. Acceleration provisions (single or double trigger) protect employees in M&A.",
    commonVariants:
      "48-month / 12-month cliff (standard). 36-month / 6-month cliff (occasional for senior hires). 60-month vesting (rare — late-stage / pre-IPO).",
    founderWatchouts:
      "Avoid blanket acceleration on Change-of-Control for all employees — it can blow up the deal economics. Use double-trigger (CoC + termination without cause) for executives only.",
    citation: "NVCA Equity Incentive Plan model; Cooley GO 'Vesting basics'.",
  },

  /* ============================ Common Stock ============================== */
  /* `instrument` and `vesting` reuse the descriptions above. */

  /* ============================ Trailing sections ========================== */
  confidentiality: {
    whatItMeans:
      "Both sides agree to keep the existence and terms of the term sheet confidential, with exceptions for advisors, employees, and lawyers.",
    whyItMatters:
      "Confidentiality is one of the few BINDING clauses in the term sheet. Prevents either side from leaking terms to competing investors or to the press before close.",
    commonVariants:
      "Standard mutual confidentiality (NVCA default). One-way (rare — only protects the company). Expiration after Closing or termination (typical 12-month survival).",
    founderWatchouts:
      "Confidentiality survives termination of the term sheet itself. If the deal dies, you still cannot disclose the lead's terms to a competing investor (which would otherwise be the obvious negotiation tactic). Carve out 'disclosure to other actively-engaged investors under NDA' to preserve fall-back options.",
    citation: "NVCA Model Term Sheet §15 (Confidentiality).",
  },
  "securities-law": {
    whatItMeans:
      "The legal basis under which the securities are being offered. In the US: Reg D 506(b) or 506(c). In other regions: the local accredited / sophisticated investor exemption.",
    whyItMatters:
      "Selling securities without a proper exemption is a federal-securities-law violation in every jurisdiction. The exemption framework determines who can invest, what disclosures are required, and what filings are due (e.g. Form D in the US within 15 days of first sale).",
    commonVariants:
      "US: Reg D 506(b) (no general solicitation, ≤35 unaccredited). Reg D 506(c) (general solicitation OK, must verify all investors accredited). Outside US: NI 45-106 (Canada), FPO/FSMA (UK), SFA §272A/§275 (Singapore), AIF Regulations (India), FIEA (Japan), Corporations Act §708/§761G (Australia).",
    founderWatchouts:
      "Form D must be filed within 15 days of first sale. Missing it is a 'bad-actor disqualification' risk for future Reg D offerings. Your investor counsel typically files this.",
    citation: "Securities Act of 1933 Reg D 506(b)/(c); state-by-state Blue Sky filings.",
  },
  "governing-law": {
    whatItMeans:
      "Which jurisdiction's law governs the term sheet and which courts have jurisdiction over disputes.",
    whyItMatters:
      "Delaware is the de-facto US choice (8 Del. C. is well-developed for VC). UK choices England & Wales. International rounds typically use Cayman parent + local-OpCo structure with each side governed by its own law.",
    commonVariants:
      "US: Delaware General Corporation Law (NVCA default). UK: England & Wales (BVCA default). Singapore: Singapore Companies Act. Japan: Japan Companies Act with arbitration in Tokyo. China: Cayman parent law + PRC law for OpCo.",
    founderWatchouts:
      "Exclusive vs. non-exclusive jurisdiction matters. Exclusive forces all disputes to one court — efficient but inflexible. Non-exclusive permits parallel litigation — flexible but messy.",
    citation: "Delaware General Corporation Law (8 Del. C.); BVCA Model Form §16 (UK); analogous provisions per region.",
  },
  "counsel-disclaimer": {
    whatItMeans:
      "An explicit statement that Capavate is not a law firm and the term sheet should be reviewed by qualified securities counsel before signing or sending.",
    whyItMatters:
      "Capavate generates a citation-backed template; it does not give legal advice. Every founder must have qualified counsel review the actual document against their facts and jurisdiction before signing.",
    commonVariants:
      "This disclaimer is non-editable. The Capavate Collective consortium can introduce you to qualified counsel in 9 regions on request.",
    founderWatchouts:
      "Even with the best template, your specific facts (cap table history, prior convertibles, founder agreements, employment terms) require human review. Budget $5k–$15k for counsel review of a Series A term sheet; $15k–$30k+ for definitive agreements.",
    citation: "Capavate Terms of Service §3 (No-Legal-Advice clause).",
  },
};

/**
 * Look up a description by clause id. Returns `undefined` if the clause is
 * not in the registry — the editor will then render a default placeholder
 * that the founder can fill in manually.
 */
export function getClauseDescription(id: string): import("./types").ClauseDescription | undefined {
  return CLAUSE_DESCRIPTIONS[id];
}

/**
 * Format a ClauseDescription as a multi-line plain-text block for embedding
 * in the PDF / print export.
 */
export function formatDescriptionForExport(d: import("./types").ClauseDescription): string {
  const lines: string[] = [];
  lines.push(`What it means: ${d.whatItMeans}`);
  lines.push("");
  lines.push(`Why it matters: ${d.whyItMatters}`);
  if (d.commonVariants) {
    lines.push("");
    lines.push(`Common variants: ${d.commonVariants}`);
  }
  if (d.founderWatchouts) {
    lines.push("");
    lines.push(`Founder watch-outs: ${d.founderWatchouts}`);
  }
  if (d.citation) {
    lines.push("");
    lines.push(`Source: ${d.citation}`);
  }
  return lines.join("\n");
}
