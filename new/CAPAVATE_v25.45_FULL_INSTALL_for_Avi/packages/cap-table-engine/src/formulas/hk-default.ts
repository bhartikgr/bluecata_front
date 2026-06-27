/**
 * Hong Kong (HK) default formula set.
 *
 * Operating context:
 *   Most HK-headquartered startups raise via a Cayman exempted-company parent
 *   with HK as the operational HQ (a "Cayman + HK OpCo" structure). This gives
 *   founders the flexibility of Cayman preferred-share mechanics (similar to
 *   Delaware C-Corp) while operating under Hong Kong's English-common-law
 *   company framework. Because HK has no capital controls and no capital-gains
 *   tax, the underlying SAFE / Note / preferred mechanics are mathematically
 *   identical to the US conventions when the issuer is the Cayman parent.
 *
 *   Where HK diverges from US is on the *tax* side, not the *math* side:
 *     - No CGT on share sales (IRD Departmental Interpretation Note (DIPN) 38)
 *     - ESOP exercise is taxed as employment income at the spread between FMV
 *       and exercise price on exercise date — not as capital gain on sale.
 *       This is materially different from US ISO long-term-capital-gains
 *       treatment after holding periods, and the engine surfaces this in the
 *       trace as `hk_income_tax_at_exercise: true`.
 *
 * Citations:
 *   - HK Companies Ordinance (Cap. 622) §135 — share issuance authorization
 *   - SFC Type 1/4/9 licences — offers to non-professional investors
 *   - IRD DIPN 38 — taxation of share-based payments in Hong Kong
 *   - Cayman Companies Act (As Revised) — exempted-company governance for the parent
 *   - HKEX Listing Rules Ch. 17 — share-based comp for listed entities (reference only)
 */
import type { FormulaRecord } from "../types.js";

const def = (formula: string, where?: Record<string, string>, notes?: string[]) => ({
  formula,
  ...(where ? { where } : {}),
  ...(notes ? { notes } : {}),
});

export const HK_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE post-money cap conversion (HK / Cayman)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source:
        "YC Post-Money SAFE v1.2 mechanics, issued by Cayman parent of HK OpCo; HK Companies Ordinance (Cap. 622) §135 share issuance authorization",
      url: "https://www.elegislation.gov.hk/hk/cap622",
      note:
        "HK startups typically issue SAFEs from a Cayman exempted-company parent — the conversion math is identical to YC v1.2; HK adds no extra restriction because there are no capital controls or CGT.",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money)",
        "Discount Price": "Series PPS × (1 − Discount)",
      },
      [
        "Issuer: Cayman parent (HK OpCo is wholly-owned subsidiary).",
        "SFC Type 1 licence required if offered to non-professional investors in HK.",
        "No HK stamp duty on issuance of new shares of a Cayman parent.",
      ],
    ),
    test: { name: "hk-safe-postmoney-cayman", description: "$1M @ $10M cap via Cayman parent — math equals US YC v1.2" },
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE pre-money cap conversion (HK / Cayman, legacy)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Pre-Money SAFE primer (legacy); Cayman Companies Act (As Revised) §27",
      url: "https://www.elegislation.gov.hk/hk/cap622",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money)" },
      ["Used only on legacy pre-2018 SAFE templates; the modern HK / Cayman convention is post-money."],
    ),
    test: { name: "hk-safe-premoney", description: "Pre-money cap conversion exemplar (HK)" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (HK)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source:
        "HK Companies Ordinance (Cap. 622) Part 5 (debentures); SFC Type 1 licence — offers to non-professional investors",
      url: "https://www.sfc.hk/",
      note:
        "Convertible-note interest in HK is paid gross — no preferential tax treatment vs. SAFE — so engines should ignore tax adjustments and treat interest as ordinary accrued principal.",
    },
    definition: def(
      "Note Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
      },
      [
        "HK does not give note interest preferential tax treatment (unlike US qualified small business stock).",
        "Notes issued by Cayman parent — interest payments cross-border are not subject to HK withholding tax.",
      ],
    ),
    test: { name: "hk-note-discount-cap-interest", description: "Discount + cap + interest — same math as US" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (HK / Cayman)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Cayman Companies Act — articles of association; HK practice mirrors NVCA full-ratchet",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def("NCP = NIP; newShares = oldShares × OIP / NIP", undefined, [
      "Exercised through the Cayman parent's articles of association, not the HK OpCo.",
    ]),
    test: { name: "hk-fullratchet-downround", description: "Down round triggers ratchet (HK / Cayman)" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (HK / Cayman)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Cayman Companies Act + market-standard broad-based WA (mirrors NVCA §4.4(d)(ii)(A))",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def(
      "NCP = OCP × (A + B) / (A + C)",
      {
        A: "Outstanding broad-based: common + preferred-as-converted + options + warrants + reserved pool (Cayman cap-table)",
        B: "Money raised / OCP",
        C: "Shares issued in dilutive round",
      },
      ["Adjustment is recorded at the Cayman parent level; HK OpCo cap-table is unchanged."],
    ),
    test: { name: "hk-broadbased", description: "Broad-based WA (HK / Cayman)" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (HK / Cayman)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Cayman Companies Act + narrow-based WA (mirrors NVCA §4.4(d)(ii)(B) variant)",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def("Same as broad-based, but A excludes options + warrants + pool", undefined, [
      "Stronger investor protection than broad-based; requires explicit election in Cayman articles.",
    ]),
    test: { name: "hk-narrowbased", description: "Narrow-based WA (HK / Cayman)" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (HK — IRD DIPN 38 income-at-exercise)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source: "IRD DIPN 38 — taxation of share-based payments in Hong Kong; IFRS 2 share-based payment accounting",
      url: "https://www.ird.gov.hk/eng/pdf/dipn38.pdf",
      note:
        "Crucial difference vs. US ISO: HK taxes the spread between FMV and exercise price as employment income on the EXERCISE date, not at sale. There is no long-term-capital-gains preference — HK has no CGT at all. Engine emits hk_income_tax_at_exercise: true in the trace.",
    },
    definition: def("T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)", undefined, [
      "Pool sits in the Cayman parent — grantees get options on Cayman shares, not HK OpCo shares.",
      "Exercise spread = (FMV − exercisePrice) × shares is taxed as Salaries Tax income in the year of exercise.",
      "Engine emits trace flag hk_income_tax_at_exercise: true on every exercise step.",
    ]),
    test: { name: "hk-esop-topup-10pct", description: "10% target pool, exercise emits income-tax flag" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (HK / Cayman)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source: "Cayman Companies Act — winding up; HK Companies Ordinance (Cap. 622) §669 distributions",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def(
      "Senior preferred → 1×/2×/3× preference → participating share or cap → common pro-rata",
      undefined,
      [
        "Distributions from HK OpCo to Cayman parent are not subject to HK dividend withholding tax (HK has no dividend WHT).",
        "From Cayman parent to ultimate beneficial owners — no further WHT (Cayman has no WHT).",
        "Founders/employees with HK residency owe Salaries Tax only on the portion treated as employment income (e.g. ESOP exercise spread); pure capital distributions are not taxed.",
      ],
    ),
    test: { name: "hk-waterfall-1x-nonparticipating", description: "Standard 1× non-participating, no WHT applied" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (HK)",
    region: "HK",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "Industry-standard fully-diluted denominator, Cayman cap-table convention",
      url: "https://www.elegislation.gov.hk/hk/cap622",
    },
    definition: def("ownership_i = shares_i / Σ shares"),
    test: { name: "hk-ownership-sums-100", description: "Σ ownership_i = 1.0 exactly" },
  },
];
