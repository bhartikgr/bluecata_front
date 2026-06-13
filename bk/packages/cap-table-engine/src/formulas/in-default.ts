/**
 * India (IN) default formula set.
 *
 * Operating context:
 *   Indian private companies are governed by the Companies Act 2013 and supervised
 *   by the Ministry of Corporate Affairs (MCA / Registrar of Companies).
 *   Onshore Indian rounds typically issue Compulsorily Convertible Preference Shares
 *   (CCPS) and Compulsorily Convertible Debentures (CCD) — pure-discretionary YC-style
 *   SAFEs do NOT exist under Indian law because Companies Act §55 forbids issuing
 *   irredeemable preference shares: every preference instrument MUST compulsorily
 *   convert to equity within ~10 years (20 years for infrastructure companies).
 *   The convertible-note equivalent is the CCD (Compulsorily Convertible Debenture).
 *
 *   Critical IN-specific constraints baked into the engine:
 *     1. Foreign-currency / cross-border: any non-resident subscription requires
 *        FEMA (Foreign Exchange Management) Non-Debt Instrument Rules 2019
 *        compliance. RBI's automatic vs. approval route depends on sector caps.
 *        Engine emits trace flag `in_fema_filing_required: true` on every
 *        cross-border conversion (e.g. SAFE/CCD subscribed by an offshore investor).
 *     2. CCPS mandatory: Indian preferred MUST compulsorily convert. Engine emits
 *        `in_ccps_required: true` on every preferred-stock issuance so downstream
 *        document generators substitute CCPS templates for the NVCA preferred form.
 *     3. Stamp duty: share issuance is taxed under the Indian Stamp Act —
 *        0.005% on issue, 0.015% on transfer (uniform post-2020). Engine emits
 *        `in_stamp_duty_applicable: true` on issuance + transfer.
 *     4. ESOP: Companies Act §62(1)(b) + SEBI SBEB Regulations 2021. Tax treatment
 *        is materially different from US ISOs — the spread between FMV and exercise
 *        price is a *perquisite* (Section 17(2)(vi) Income-Tax Act) taxed at
 *        ordinary income rates on the EXERCISE date; capital gains tax then applies
 *        on the eventual sale (LTCG 12.5% if held > 24 mo, STCG 20%). Engine emits
 *        `in_perquisite_tax_at_exercise: true`.
 *     5. Section 56(2)(viib) ("angel tax"): Issue price > FMV creates a deemed
 *        income to the issuer unless the company is DPIIT-recognized (rationalized
 *        in Finance Act 2024 — angel-tax-free for DPIIT startups). Engine emits
 *        `in_dpiit_recognition_required: true` so the doc-gen pipeline prompts the
 *        founder for the DPIIT certificate.
 *
 * Citations:
 *   - Companies Act 2013 §62(1)(b) — preferential allotment + ESOP issuance
 *   - Companies Act 2013 §55 — preference shares must be compulsorily convertible/redeemable
 *   - Companies Act 2013 §42 — private placement procedure
 *   - FEMA (Non-Debt Instruments) Rules 2019 — FDI compliance, automatic vs approval route
 *   - RBI Master Direction — Foreign Investment in India (most recent: October 2024)
 *   - SEBI (Share Based Employee Benefits and Sweat Equity) Regulations 2021
 *   - SEBI (Alternative Investment Funds) Regulations 2012 — Cat I/II/III AIFs
 *   - Income-tax Act 1961 §56(2)(viib) — "angel tax" (rationalized for DPIIT startups, FA 2024)
 *   - Income-tax Act 1961 §17(2)(vi) — ESOP perquisite taxation at exercise
 *   - Indian Stamp Act 1899 (uniform post-2020) — 0.005% issue / 0.015% transfer
 */
import type { FormulaRecord } from "../types.js";

const def = (formula: string, where?: Record<string, string>, notes?: string[]) => ({
  formula,
  ...(where ? { where } : {}),
  ...(notes ? { notes } : {}),
});

export const IN_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE → CCPS conversion (IN — Companies Act §55 compulsory conversion)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source:
        "YC Post-Money SAFE v1.2 mechanics adapted to Indian Companies Act 2013 §55 (compulsory conversion) and §42 (private placement); FEMA Non-Debt Instrument Rules 2019",
      url: "https://www.mca.gov.in/content/mca/global/en/acts-rules/companies-act/companies-act-2013.html",
      note:
        "Pure-discretionary YC-style SAFEs do NOT exist under Indian law. Every preference instrument MUST compulsorily convert to equity within ~10 years per Companies Act §55. The 'SAFE' is therefore documented as a CCPS subscription agreement — same conversion math, but the instrument carries a hard conversion long-stop date and conversion is mandatory, not discretionary. Cross-border subscriptions emit in_fema_filing_required: true (Form FC-GPR within 30 days of allotment).",
    },
    definition: def(
      "CCPS Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money, fully diluted)",
        "Discount Price": "Series PPS × (1 − Discount)",
        "Long-stop date": "Mandatory ≤ 10 years from issue (Companies Act §55(2)) — 20 years for infrastructure cos",
      },
      [
        "Issuer: Indian Pvt Ltd / Public Ltd. CCPS instrument required, NOT plain preferred.",
        "Engine emits in_ccps_required: true to switch the doc-gen template to CCPS subscription agreement.",
        "Cross-border subscriber → emits in_fema_filing_required: true (RBI automatic / approval route by sector).",
        "Issue price > FMV → emits in_dpiit_recognition_required: true (§56(2)(viib) angel-tax exposure unless DPIIT-recognized).",
        "Stamp duty 0.005% on issuance — emits in_stamp_duty_applicable: true.",
      ],
    ),
    test: { name: "in-safe-ccps-postmoney", description: "$1M @ $10M cap converts to CCPS — math matches YC v1.2; emits in_ccps_required" },
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE → CCPS pre-money cap conversion (IN, legacy)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Pre-Money SAFE primer (legacy); Companies Act 2013 §55 (compulsory conversion)",
      url: "https://www.mca.gov.in/",
    },
    definition: def(
      "CCPS Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money, fully diluted)" },
      ["Used only on legacy pre-2018 SAFE templates; Indian rounds usually run modern post-money or directly issue CCPS."],
    ),
    test: { name: "in-safe-premoney", description: "Pre-money cap conversion to CCPS (IN)" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note → CCD conversion (IN — compulsorily convertible debenture)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source:
        "Companies Act 2013 §71 (debentures) + §62(1)(c) (further issue of capital); RBI Master Direction on Foreign Investment — CCDs are the only debt-like instrument permitted from FDI investors as automatic-route",
      url: "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx",
      note:
        "Indian convertible notes are documented as CCDs (Compulsorily Convertible Debentures). Unlike a US convertible note, the CCD MUST convert to equity — it cannot remain debt indefinitely. Maximum tenor 10 years. Interest accrues but is taxed as interest income to the holder; no withholding tax exemption. Cross-border CCDs require Form FC-GPR within 30 days of conversion.",
    },
    definition: def(
      "CCD Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
        "Conversion long-stop": "≤ 10 years from issue date (Companies Act §71)",
      },
      [
        "CCD interest is taxed as interest income (no QSBS-style preference like the US).",
        "Cross-border CCD → emits in_fema_filing_required: true on conversion.",
        "Stamp duty 0.005% on issue (FA 2019 uniform rate).",
      ],
    ),
    test: { name: "in-ccd-conversion", description: "CCD with discount + cap + 6% interest converts to CCPS" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (IN — CCPS conversion-ratio adjustment)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Companies Act 2013 §48 (variation of class rights) + §62(1)(c); SEBI standard preferred-share covenants for AIF-led rounds",
      url: "https://www.sebi.gov.in/",
    },
    definition: def("NCP = NIP; newCcpsConversionRatio = oldRatio × OIP / NIP", undefined, [
      "Implemented as a CCPS conversion-ratio reset in the SHA + Articles, NOT as a price re-allotment, because §55 forbids issuing additional preference shares retroactively at a lower price without a fresh §42 private-placement procedure.",
      "Down round → CCPS holders convert into more equity shares at conversion long-stop.",
    ]),
    test: { name: "in-fullratchet-ccps-ratio", description: "Down round triggers CCPS conversion-ratio adjustment" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (IN — CCPS)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Indian VC market-standard broad-based WA (mirrors NVCA §4.4(d)(ii)(A)); IVCA model term sheet",
      url: "https://www.ivca.in/",
    },
    definition: def(
      "NCP = OCP × (A + B) / (A + C)",
      {
        A: "Outstanding broad-based: equity + CCPS as-converted + ESOPs granted + warrants + reserved pool (fully diluted)",
        B: "Money raised / OCP",
        C: "Shares issued in the dilutive round",
      },
      [
        "Adjustment recorded as a change in the CCPS conversion ratio in the company's Articles of Association (filed with MCA via Form MGT-14).",
        "IVCA model term sheet treats this as the founder-friendly default.",
      ],
    ),
    test: { name: "in-broadbased", description: "Broad-based WA on CCPS (IN)" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (IN — CCPS)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Indian VC narrow-based WA (mirrors NVCA §4.4(d)(ii)(B) variant); requires explicit SHA election",
      url: "https://www.ivca.in/",
    },
    definition: def("Same as broad-based, but A excludes ESOPs + warrants + unallocated pool", undefined, [
      "Stronger investor protection — common in Series-A+ rounds led by offshore growth funds.",
    ]),
    test: { name: "in-narrowbased", description: "Narrow-based WA on CCPS (IN)" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (IN — SEBI SBEB 2021 + Companies Act §62(1)(b); perquisite tax at exercise)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source:
        "Companies Act 2013 §62(1)(b) — issue of shares to employees; SEBI (Share Based Employee Benefits & Sweat Equity) Regulations 2021; Income-tax Act 1961 §17(2)(vi) — perquisite taxation",
      url: "https://www.sebi.gov.in/legal/regulations/aug-2021/securities-and-exchange-board-of-india-share-based-employee-benefits-and-sweat-equity-regulations-2021_51961.html",
      note:
        "Indian ESOP exercise is taxed in TWO stages: (1) on EXERCISE — the spread (FMV − exercise price) × shares is a perquisite under §17(2)(vi), taxed at the employee's marginal slab rate up to 39%; the employer must withhold TDS under §192. (2) on SALE — capital gains tax on (sale price − FMV at exercise): LTCG 12.5% if held > 24 months (post-FA 2024), STCG 20%. Eligible startups (DPIIT-recognized) can defer the perquisite tax under §191 for 5 years / sale / cessation. Engine emits in_perquisite_tax_at_exercise: true.",
    },
    definition: def("T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)", undefined, [
      "Issuer: Indian company; pool created via shareholder special resolution + Form MGT-14 filing.",
      "Per SEBI SBEB 2021, options must vest min 1 year from grant; cannot exceed 5% of paid-up capital in a single year without special resolution.",
      "Engine emits in_perquisite_tax_at_exercise: true on every exercise step (TDS under §192 due in payroll cycle of exercise month).",
      "DPIIT-recognized startups can defer perquisite tax up to 5 years post-exercise (§191(1) third proviso, FA 2020).",
    ]),
    test: { name: "in-esop-topup-perquisite", description: "10% target pool — exercise emits perquisite tax flag" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (IN — Companies Act §53 + CCPS preference)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source:
        "Companies Act 2013 §53 (winding-up distribution); SEBI AIF Regulations 2012; IBC 2016 — insolvency waterfall priority for distress scenarios",
      url: "https://www.mca.gov.in/",
      note:
        "In a solvent winding-up or share sale, CCPS holders receive their preferential return per the Articles (typically 1× non-participating). For an insolvent winding-up, the IBC 2016 §53 waterfall overrides — CCPS rank below all secured + unsecured creditors. The engine assumes a solvent exit; for IBC scenarios use a separate workflow.",
    },
    definition: def(
      "Senior CCPS → 1×/2×/3× preference → participating share or cap → equity pro-rata; LTCG 12.5% applies to individual shareholders on > 24 mo holdings",
      undefined,
      [
        "CCPS preference is documented in the AoA (filed with MCA); enforced at the SHA level.",
        "No dividend distribution tax (DDT abolished 2020); dividends taxed in shareholder hands at slab rate.",
        "Buyback tax 23.296% applies if exit is structured as a §68 buyback (vs sale).",
      ],
    ),
    test: { name: "in-waterfall-1x-ccps", description: "Standard 1× non-participating CCPS, equity pro-rata residual" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (IN — fully diluted on CCPS as-converted)",
    region: "IN",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "MCA Companies Act §92 (annual return); IVCA fully-diluted convention; CCPS counted at conversion ratio",
      url: "https://www.mca.gov.in/",
    },
    definition: def("ownership_i = shares_i / Σ shares", undefined, [
      "CCPS counted at their current conversion ratio (typically 1:1 unless anti-dilution has triggered).",
      "ESOP options counted in fully-diluted denominator (granted + reserved pool).",
    ]),
    test: { name: "in-ownership-sums-100", description: "Σ ownership_i = 1.0 exactly with CCPS as-converted" },
  },
];
