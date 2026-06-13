/**
 * Australia (AU) default formula set.
 *
 * Operating context:
 *   Australian proprietary companies (Pty Ltd) are governed by the Corporations
 *   Act 2001 (Cth) and supervised by ASIC (Australian Securities & Investments
 *   Commission). Share issuance under §254A requires lodging Form 484 within
 *   28 days of allotment — engine emits au_corporations_act_filing: true on
 *   every preferred / equity issuance.
 *
 *   The standout AU mechanism is the Employee Share Scheme (ESS) **startup
 *   concession** under ITAA 1997 §83A-105: companies that are <10 yrs old,
 *   <$50M turnover, unlisted, and Australian-resident can issue ESS interests
 *   that defer ALL tax until disposal — there is no taxable point at grant,
 *   vesting, or exercise. On disposal, the gain is taxed as a capital gain
 *   (eligible for the 50% CGT discount under §115-100 if held > 12 months by
 *   an individual). Compare to non-startup ESS where deferred tax applies at
 *   the EARLIER of cessation, 15-year ceiling, or sale of vested rights.
 *
 *   FIRB (Foreign Investment Review Board) approval under FATA 1975 is
 *   required for foreign investors above the relevant threshold (~A$339M for
 *   non-government investors in non-sensitive sectors as at 2025; A$0 for
 *   national-security businesses; A$71M for agribusiness). Engine emits
 *   au_firb_approval_required: true when an offshore investor exceeds the
 *   threshold.
 *
 *   AFSL (Australian Financial Services Licence) under Corporations Act §911A
 *   is required for SPV / fund mechanics — an AU founder operating an SPV to
 *   pool angels needs an AFSL holder or to rely on an exemption (e.g. the
 *   small-scale-offering ASIC RG 217 / s708(1) "20 investors / A$2M / 12 mo"
 *   safe harbour, or a wholesale-investor §761G(7) exemption).
 *
 *   CGT: ITAA 1997 §115-100 — individuals (and trusts/superannuation funds in
 *   certain cases) get a 50% discount on capital gains for assets held > 12
 *   months. Engine emits au_cgt_50_percent_discount_eligible: true on the
 *   waterfall trace when the holding metadata indicates > 12 mo individual
 *   ownership.
 *
 *   Stamp duty: NIL on share issuance in most AU states (post-2016 abolitions);
 *   transfer of shares in unlisted companies still attracts duty in some
 *   states (NSW abolished in 2016; QLD remains).
 *
 * Citations:
 *   - Corporations Act 2001 (Cth) §254A — share issuance authorization
 *   - Corporations Act §249 + §253B-G — meetings + special resolutions
 *   - Corporations Act §911A — Australian Financial Services Licence requirement
 *   - Corporations Act §708 — small-scale offering exemption (20/A$2M/12mo)
 *   - ITAA 1997 Division 83A — Employee Share Schemes
 *   - ITAA 1997 §83A-105 — Startup ESS concession (< 10yrs, < $50M turnover)
 *   - ITAA 1997 §115-100 — 50% CGT discount for individuals (> 12 mo)
 *   - FATA (Foreign Acquisitions and Takeovers Act) 1975 — FIRB thresholds
 *   - ASIC Regulatory Guide 217 — small-scale offerings & disclosure
 *   - ATO TD 2022/2 — ESS reporting (Form ESS in tax return)
 */
import type { FormulaRecord } from "../types.js";

const def = (formula: string, where?: Record<string, string>, notes?: string[]) => ({
  formula,
  ...(where ? { where } : {}),
  ...(notes ? { notes } : {}),
});

export const AU_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE post-money cap conversion (AU — Pty Ltd / Corporations Act §254A)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source:
        "YC Post-Money SAFE v1.2 mechanics, adapted for Pty Ltd issuance under Corporations Act 2001 §254A; AVCAL/Innovation Investment Committee model documents",
      url: "https://www.legislation.gov.au/Series/C2004A00818",
      note:
        "AU Pty Ltd companies use SAFEs as a private-placement convertible-equity instrument. Issuance must satisfy a §708 disclosure exemption (typically the 20/A$2M/12mo small-scale offering, or wholesale-investor §761G(7), or sophisticated investor §708(8)) AND be lodged with ASIC via Form 484 within 28 days. Engine emits au_corporations_act_filing: true.",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money)",
        "Discount Price": "Series PPS × (1 − Discount)",
      },
      [
        "Issuer: Australian Pty Ltd. Form 484 (notification of change to company details) lodged with ASIC within 28 days of allotment.",
        "§708 disclosure exemption MUST be satisfied (most commonly the 20/A$2M/12mo small-scale offering safe harbour).",
        "Cross-border subscriber over FIRB threshold → emits au_firb_approval_required: true.",
        "If the SPV / nominee holding the SAFE is unlicensed → emits au_afsl_required: true (Corporations Act §911A).",
      ],
    ),
    test: { name: "au-safe-postmoney", description: "$1M @ $10M cap — Pty Ltd issuance, emits au_corporations_act_filing" },
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE pre-money cap conversion (AU, legacy)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Pre-Money SAFE primer (legacy); Corporations Act 2001 §254A",
      url: "https://www.legislation.gov.au/Series/C2004A00818",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money)" },
      ["Used only on legacy pre-2018 SAFE templates."],
    ),
    test: { name: "au-safe-premoney", description: "Pre-money cap conversion exemplar (AU)" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (AU)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source:
        "Corporations Act 2001 Part 2L (debentures); AVCAL standard convertible note terms; §708 disclosure exemption applicable",
      url: "https://www.legislation.gov.au/Series/C2004A00818",
      note:
        "AU convertible notes: §283AB requires a trust deed if the offer requires a disclosure document; private placements under §708 do not. Interest income to AU-resident holder is taxed as ordinary income; no thin-cap rules typically applicable for early-stage cos.",
    },
    definition: def(
      "Note Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
      },
      [
        "Form 484 lodged with ASIC on conversion to shares (§254A).",
        "Cross-border note over FIRB threshold → emits au_firb_approval_required: true.",
      ],
    ),
    test: { name: "au-note-conversion", description: "Note with discount + cap + interest converts to preferred (AU)" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (AU — preferred class adjustment via §246 special resolution)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Corporations Act 2001 §246B (variation of class rights); AVCAL model term sheet",
      url: "https://www.legislation.gov.au/Series/C2004A00818",
    },
    definition: def("NCP = NIP; newShares = oldShares × OIP / NIP", undefined, [
      "Implemented as a class-rights variation under §246B; requires special resolution of the affected class.",
      "Constitution amendment lodged with ASIC via Form 205 within 14 days.",
    ]),
    test: { name: "au-fullratchet", description: "Down round triggers ratchet via class rights variation (AU)" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (AU)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "AVCAL model term sheet broad-based WA (mirrors NVCA §4.4(d)(ii)(A))",
      url: "https://avcal.com.au/",
    },
    definition: def(
      "NCP = OCP × (A + B) / (A + C)",
      {
        A: "Outstanding broad-based: ordinary + preferred as-converted + ESS interests + warrants + reserved pool",
        B: "Money raised / OCP",
        C: "Shares issued in dilutive round",
      },
      ["Standard AVCAL/founder-friendly default for AU early-stage rounds."],
    ),
    test: { name: "au-broadbased", description: "Broad-based WA (AU)" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (AU)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "AVCAL narrow-based WA (mirrors NVCA §4.4(d)(ii)(B) variant); requires explicit constitutional election",
      url: "https://avcal.com.au/",
    },
    definition: def("Same as broad-based, but A excludes ESS interests + warrants + unallocated pool", undefined, [
      "Stronger investor protection; common in AU growth-stage rounds led by offshore funds.",
    ]),
    test: { name: "au-narrowbased", description: "Narrow-based WA (AU)" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (AU — ESS Division 83A; startup concession §83A-105)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source:
        "ITAA 1997 Division 83A — Employee Share Schemes; §83A-105 — Startup concession (< 10 yrs, < $50M turnover, unlisted, AU-resident); §115-100 — 50% CGT discount; ATO TD 2022/2 — ESS reporting",
      url: "https://www.ato.gov.au/business/employee-share-schemes/",
      note:
        "AU Employee Share Schemes have two regimes: (1) the STARTUP CONCESSION under §83A-105 — for companies < 10 yrs old, < $50M turnover, unlisted, AU-resident: NO tax at grant, vesting, or exercise. The taxing point is the eventual disposal, taxed as capital gain (50% CGT discount under §115-100 if held > 12 months by individual). (2) the DEFERRED-TAX regime — taxing point is the earliest of cessation of employment, 15-year ceiling, or sale; spread taxed as employment income then. Engine emits au_ess_startup_concession_eligible: true|false based on company eligibility metadata; when true, no tax accrues until disposal.",
    },
    definition: def(
      "T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)",
      {
        "Startup concession": "ITAA 1997 §83A-105 — < 10 yr, < $50M turnover, unlisted, AU-resident",
        "Holding-period discount": "ITAA 1997 §115-100 — 50% CGT discount on > 12 mo individual holdings",
      },
      [
        "Issuance of ESS interests requires constitutional authorization + special resolution if rights vary class rights.",
        "Form 484 lodgement with ASIC within 28 days of allotment of vested shares.",
        "Engine emits au_ess_startup_concession_eligible: true|false based on company.eligibilityForStartupConcession input flag.",
        "ESS interest reporting: company files annual ESS statement to ATO + employee receives ESS Statement (Form ESS).",
      ],
    ),
    test: { name: "au-esop-startup-concession", description: "Startup concession eligibility flag emitted correctly" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (AU — Corporations Act §554 + 50% CGT discount)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source:
        "Corporations Act 2001 §554 (priority of debts in winding up); ITAA 1997 §115-100 (50% CGT discount > 12 mo); AVCAL standard preferred terms",
      url: "https://www.legislation.gov.au/Series/C2004A00818",
      note:
        "AU waterfall: preferred class preferences are designated in the company's constitution under §246. CGT discount applies on the gain to AU-resident individuals (and certain trusts/SMSFs) holding > 12 months — 50% discount under §115-100. Foreign-resident individuals lost the discount in 2012 reforms (§115-105). Engine emits au_cgt_50_percent_discount_eligible: true when holding-period metadata indicates > 12 mo by an AU-resident individual.",
    },
    definition: def(
      "Senior preferred → 1×/2×/3× preference → participating share or cap → ordinary pro-rata; 50% CGT discount applies to AU-resident individuals on > 12 mo holdings (per §115-100)",
      undefined,
      [
        "Preference must be designated in the constitution (§246) and registered with ASIC.",
        "AU-resident individuals & qualifying trusts: 50% CGT discount on capital gains for assets held > 12 months (§115-100).",
        "Foreign-resident individuals: no CGT discount for gains accruing post-2012 (§115-105).",
        "Companies: no CGT discount; gains taxed at corporate rate (25% small business / 30% standard).",
      ],
    ),
    test: { name: "au-waterfall-cgt-discount", description: "1× non-participating + 50% CGT discount flag for > 12 mo individuals" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (AU — fully diluted on as-converted preferred)",
    region: "AU",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "ASIC Form 484 / annual statement; AVCAL fully-diluted convention",
      url: "https://asic.gov.au/",
    },
    definition: def("ownership_i = shares_i / Σ shares", undefined, [
      "Preferred classes counted at current conversion ratio.",
      "ESS interests (granted + reserved) counted in fully-diluted denominator.",
    ]),
    test: { name: "au-ownership-sums-100", description: "Σ ownership_i = 1.0 exactly" },
  },
];
