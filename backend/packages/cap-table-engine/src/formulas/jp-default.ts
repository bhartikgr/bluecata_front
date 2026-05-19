/**
 * Japan (JP) default formula set.
 *
 * Operating context:
 *   Japanese kabushiki kaisha (株式会社 / KK) raise via class shares (種類株式)
 *   under Companies Act of Japan §107-108. Unlike the US Delaware model, the
 *   default form is a single-class common stock; preferred / liquidation-prefer
 *   classes must be EXPLICITLY designated in the articles of incorporation
 *   (定款) and registered with the Legal Affairs Bureau (法務局). The engine
 *   emits jp_class_shares_required: true on every preferred issuance so the
 *   doc-gen pipeline produces 種類株式設計 for the founder.
 *
 *   The Japanese SAFE-equivalent is the J-KISS — designed by Coral Capital in
 *   2016 as an open-source convertible-equity-style instrument. J-KISS converts
 *   at the next priced round into a defined A-class share (typically 1× non-
 *   participating). The math is identical to the YC SAFE — the engine surfaces
 *   jp_jkiss_template_used: true for traceability.
 *
 *   Stock acquisition rights (新株予約権 / shinkabu yoyaku-ken, Companies Act
 *   §236-294) cover BOTH employee stock options AND warrants. Tax treatment
 *   bifurcates sharply:
 *     - Tax-qualified options (税制適格ストックオプション per Income Tax Act
 *       §29-2): NO income tax at exercise; only 20% capital-gains tax at sale.
 *       Has strict caps: ¥12M annual exercise limit (¥36M for "scale-up
 *       certified" ventures post-2024 reform), 2-10 yr exercise window from
 *       grant, must be granted to W-2 employees of issuing co or affiliate.
 *     - Non-qualified: Income tax (up to 55% combined national + local) on
 *       spread at exercise + 20% CGT at sale.
 *
 *   Stamp tax (印紙税): Generally NOT applicable to share issuance in Japan
 *   (stamp tax targets specific receipts/contracts, not equity issuance) —
 *   different from India / Singapore.
 *
 *   FEFTA (Foreign Exchange and Foreign Trade Act / 外為法) §27 + §28: foreign
 *   investors investing in regulated sectors (defense, telecoms, energy,
 *   semiconductors, dual-use tech) require prior notification 30 days before
 *   the transaction; in unregulated sectors, ex-post notification only. Engine
 *   emits jp_fefta_filing_required: true when an offshore investor crosses
 *   the 1%/10% reporting thresholds.
 *
 * Citations:
 *   - Companies Act of Japan (会社法 / Kaishaho) §107-108 — class shares
 *   - Companies Act §236-294 — stock acquisition rights (warrants + options)
 *   - Coral Capital J-KISS template — open-source convertible-equity-style
 *     https://coralcap.co/j-kiss/
 *   - Income Tax Act §29-2 (所得税法29条の2) — tax-qualified stock option requirements
 *   - Foreign Exchange and Foreign Trade Act (FEFTA / 外為法) §27 + §28 — prior
 *     notification for restricted sectors
 *   - FSA (Financial Services Agency) — Type II Financial Instruments Business
 *     for SPV / fund mechanics under FIEA
 *   - 2024 Stock Option Tax Reform (株主優待制度改正) — ¥12M → ¥36M annual cap
 *     for scale-up certified startups
 */
import type { FormulaRecord } from "../types.js";

const def = (formula: string, where?: Record<string, string>, notes?: string[]) => ({
  formula,
  ...(where ? { where } : {}),
  ...(notes ? { notes } : {}),
});

export const JP_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "J-KISS post-money conversion (JP — Coral Capital template)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source:
        "Coral Capital J-KISS v1.0 template (open-source, modeled on YC post-money SAFE); Companies Act of Japan §107-108 (class shares); §238 (stock acquisition rights as carrier)",
      url: "https://coralcap.co/j-kiss/",
      note:
        "J-KISS = Japan Keep It Simple Security. Documented as a 新株予約権 (stock acquisition right) under §238 with conversion into a designated A-class preferred share at the next qualified financing. Math is identical to YC v1.2; the engine surfaces jp_jkiss_template_used: true for trace-level lineage. J-KISS is NOT a stand-alone preferred class — it is a right-to-subscribe carrier that crystallizes into class shares at conversion.",
    },
    definition: def(
      "J-KISS Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money)",
        "Discount Price": "Series PPS × (1 − Discount)",
        "Conversion class": "Typically Class A 種類株式 with 1× non-participating preference",
      },
      [
        "Issuer: Japanese KK (株式会社).",
        "Trace flag jp_jkiss_template_used: true emitted for compliance with Coral Capital's open-source attribution.",
        "Cross-border subscriber from a restricted-sector industry → emits jp_fefta_filing_required: true (FEFTA §27 prior notification).",
        "No stamp tax on share issuance in Japan (stamp tax targets receipts/contracts, not equity).",
      ],
    ),
    test: { name: "jp-jkiss-postmoney", description: "$1M @ $10M cap via J-KISS — math equals YC v1.2; emits jp_jkiss_template_used" },
  },
  {
    id: "safe.premoney.conversion",
    name: "J-KISS pre-money conversion (JP, legacy)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "Pre-2018 J-KISS template (legacy); Companies Act of Japan §238",
      url: "https://coralcap.co/j-kiss/",
    },
    definition: def(
      "J-KISS Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money)" },
      ["Used only on legacy pre-2018 J-KISS templates — modern J-KISS is post-money."],
    ),
    test: { name: "jp-jkiss-premoney", description: "Pre-money cap conversion exemplar (JP)" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (JP — 転換社債型新株予約権付社債)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source:
        "Companies Act of Japan §238-294 — stock-acquisition-right-attached bond (転換社債型新株予約権付社債); FIEA disclosure rules for offerings to > 50 persons",
      url: "https://elaws.e-gov.jp/document?lawid=417AC0000000086",
      note:
        "Japanese convertible notes are documented as 転換社債型新株予約権付社債 (CB with stock-acquisition right attached). They differ structurally from US convertible notes: the conversion right is technically a separate stock-acquisition-right instrument bundled with a debenture. Math is identical at conversion.",
    },
    definition: def(
      "Note Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
      },
      [
        "Interest income to JP-resident holder is taxed at 20.315% withholding (national 15.315% + local 5%).",
        "Cross-border interest payments may require FEFTA reporting for amounts > ¥30M.",
      ],
    ),
    test: { name: "jp-cb-conversion", description: "CB with discount + cap + interest converts to A-class shares" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (JP — class share conversion-ratio adjustment)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Companies Act of Japan §107(2)(ii) (取得条項付株式 / class share with adjustment); JVCA model term sheet",
      url: "https://jvca.jp/",
    },
    definition: def("NCP = NIP; classShareConversionRatio = oldRatio × OIP / NIP", undefined, [
      "Implemented as a class-share conversion-ratio adjustment in the articles of incorporation (定款変更); requires special resolution + Legal Affairs Bureau registration.",
    ]),
    test: { name: "jp-fullratchet-class-share", description: "Down round triggers class share ratio adjustment (JP)" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (JP — class shares)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "JVCA + Coral Capital model term sheets — broad-based WA (mirrors NVCA §4.4(d)(ii)(A))",
      url: "https://jvca.jp/",
    },
    definition: def(
      "NCP = OCP × (A + B) / (A + C)",
      {
        A: "Outstanding broad-based: common + class shares as-converted + 新株予約権 + reserved pool",
        B: "Money raised / OCP",
        C: "Shares issued in dilutive round",
      },
      ["Requires unanimous resolution of the affected class shareholders' meeting under §322."],
    ),
    test: { name: "jp-broadbased", description: "Broad-based WA (JP — class shares)" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (JP — class shares)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "JVCA narrow-based WA (mirrors NVCA §4.4(d)(ii)(B) variant)",
      url: "https://jvca.jp/",
    },
    definition: def("Same as broad-based, but A excludes 新株予約権 + unallocated pool", undefined, [
      "Stronger investor protection; less common in JP — typically used by offshore growth funds.",
    ]),
    test: { name: "jp-narrowbased", description: "Narrow-based WA (JP — class shares)" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (JP — 新株予約権; tax-qualified vs non-qualified)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source:
        "Companies Act of Japan §238-241 — stock acquisition rights; Income Tax Act §29-2 — tax-qualified stock option requirements; 2024 Stock Option Tax Reform (¥12M → ¥36M annual cap for scale-up certified startups)",
      url: "https://elaws.e-gov.jp/document?lawid=340AC0000000033_20240401_504AC0000000004",
      note:
        "Tax-qualified stock options (税制適格ストックオプション) require strict compliance with §29-2: (1) granted to W-2 employees of issuing co or wholly-owned affiliate, (2) annual exercise ≤ ¥12M (¥36M post-2024 for scale-up certified startups), (3) exercise window 2-10 yr from grant, (4) exercise price ≥ FMV at grant, (5) options non-transferable. If qualified, NO income tax at exercise — only 20.315% capital gains tax at sale. If non-qualified, the spread is taxed as employment income at marginal rate up to 55% (national 45% + local 10% top bracket). Engine surfaces jp_tax_qualified_option: true|false in trace.",
    },
    definition: def(
      "T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)",
      {
        "Tax-qualified annual cap": "¥12M default; ¥36M for scale-up certified startups (post-2024 reform)",
      },
      [
        "Pool issuance requires special shareholders' resolution (§240) + registration with Legal Affairs Bureau.",
        "Engine emits jp_tax_qualified_option: true|false based on grant inputs (W-2 status, ¥12M cap, 2-10 yr exercise window, FMV strike).",
        "Non-qualified exercise: jp_tax_qualified_option: false → income tax due in payroll cycle of exercise.",
      ],
    ),
    test: { name: "jp-esop-tax-qualified", description: "Tax-qualified vs non-qualified flag emitted correctly" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (JP — class share preference per §107-108)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source:
        "Companies Act of Japan §108(1)(ii) — preferential dividend on liquidation; §502-509 (winding-up distribution); FIEA disclosure for tender offers",
      url: "https://elaws.e-gov.jp/document?lawid=417AC0000000086",
    },
    definition: def(
      "Senior class shares → 1×/2×/3× preference (per articles) → participating share or cap → common pro-rata; 20.315% CGT applies to JP-resident individuals on the gain",
      undefined,
      [
        "Class share preference must be explicitly designated in 定款 (articles of incorporation).",
        "JP CGT 20.315% (national 15.315% + local 5%) applies to individual shareholders on capital gains; corporate shareholders pay the corporate tax rate ~30%.",
        "Treaty-eligible foreign shareholders may claim reduced WHT on dividend distributions (e.g. 10% under Japan-US tax treaty).",
      ],
    ),
    test: { name: "jp-waterfall-1x-class", description: "Standard 1× non-participating class share preference" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (JP — fully diluted on class share as-converted)",
    region: "JP",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "Industry-standard fully-diluted denominator at the KK level; Companies Act §107-108",
      url: "https://elaws.e-gov.jp/document?lawid=417AC0000000086",
    },
    definition: def("ownership_i = shares_i / Σ shares", undefined, [
      "Class shares counted at current conversion ratio.",
      "新株予約権 (granted + reserved) counted in fully-diluted denominator.",
    ]),
    test: { name: "jp-ownership-sums-100", description: "Σ ownership_i = 1.0 exactly with class shares as-converted" },
  },
];
