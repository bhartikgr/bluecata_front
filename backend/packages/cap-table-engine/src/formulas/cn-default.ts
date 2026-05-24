/**
 * Mainland China (CN) default formula set.
 *
 * Operating context:
 *   Mainland Chinese startups raising USD/foreign capital almost always run
 *   under a Cayman parent → BVI / HK intermediate → WFOE (Wholly Foreign-Owned
 *   Enterprise) → onshore OpCo structure, sometimes with a VIE (Variable
 *   Interest Entity) for restricted sectors. Standard preferred-share
 *   mechanics live at the Cayman parent. The onshore PRC entity (有限责任公司
 *   LLC or 股份有限公司 JSC) does NOT natively support multi-class preferred
 *   the way Cayman or Delaware do — PRC Company Law (公司法 2024 revision)
 *   §36 limits LLCs to a single equity class with capital-contribution
 *   percentages registered with SAMR (formerly AIC).
 *
 *   Critical CN-specific constraints baked into the engine:
 *     1. Foreign currency controls: cross-border SAFE / Note funding requires
 *        SAFE Circular 37 registration when round-tripping via founders'
 *        offshore holding companies. Engine emits trace flag
 *        `safe_circular_37_required: true` on every cross-border conversion.
 *     2. Capital contribution registration: every cap-table change at the
 *        WFOE / onshore entity must be re-registered with SAMR. Engine emits
 *        `samr_filing_required: true` on issue / transfer / conversion.
 *     3. ESOP variant: phantom equity / SARs (Stock Appreciation Rights) are
 *        common because direct equity ownership by employees triggers complex
 *        tax + SAFE registration for foreign-listed parent. Engine exposes a
 *        `phantom_equity` flag on ESOP grants that bypasses share issuance
 *        and tracks contractual cash-settled units.
 *     4. Liquidation withholding tax: distributions from onshore PRC entity
 *        to Cayman parent are subject to dividend WHT (10% standard;
 *        5% under HK-PRC double-tax treaty for qualifying HK recipients).
 *        Engine exposes `withholdingTaxRate` parameter on the waterfall.
 *
 * Citations:
 *   - PRC Company Law (公司法) 2024 revision — Article 36 share issuance
 *   - SAFE Circular 37 (国家外汇管理局37号文) — round-trip foreign investment registration
 *   - FIL (Foreign Investment Law) 2020 — WFOE / VIE rules
 *   - STA Circular 35 (国税函〔2009〕461号 / Cai Shui [2016] 101) — taxation of share-based payments
 *   - Cayman Companies Act (As Revised) — exempted-company governance for offshore parent
 *   - SAT Bulletin 7 — indirect transfer of PRC taxable assets via offshore entities
 */
import type { FormulaRecord } from "../types.js";

const def = (formula: string, where?: Record<string, string>, notes?: string[]) => ({
  formula,
  ...(where ? { where } : {}),
  ...(notes ? { notes } : {}),
});

export const CN_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE post-money cap conversion (CN — Cayman parent + WFOE)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source:
        "YC Post-Money SAFE v1.2 mechanics, issued by Cayman parent of WFOE/VIE structure; SAFE Circular 37 cross-border registration",
      url: "https://www.safe.gov.cn/safe/2014/0714/3879.html",
      note:
        "Mainland Chinese onshore entities (LLCs / JSCs) cannot natively issue YC-style SAFEs — preferred-share mechanics do not exist in PRC Company Law §36. The SAFE is therefore issued by the Cayman parent. Founders who are PRC tax residents must register their offshore holding under SAFE Circular 37 before signing.",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money)",
        "Discount Price": "Series PPS × (1 − Discount)",
      },
      [
        "Issuer: Cayman parent. The math is identical to YC v1.2 — only the issuer differs.",
        "Engine emits trace flag safe_circular_37_required: true.",
        "Onshore WFOE cap-table is unchanged on conversion; only Cayman parent's cap-table moves.",
      ],
    ),
    test: { name: "cn-safe-postmoney-circular37", description: "$1M @ $10M cap via Cayman parent — emits SAFE Circular 37 flag" },
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE pre-money cap conversion (CN — legacy)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Pre-Money SAFE primer (legacy); Cayman Companies Act (As Revised); SAFE Circular 37",
      url: "https://www.safe.gov.cn/",
    },
    definition: def(
      "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money)" },
      [
        "Used only on legacy pre-2018 SAFE templates.",
        "SAFE Circular 37 registration still required for PRC-resident founders.",
      ],
    ),
    test: { name: "cn-safe-premoney", description: "Pre-money cap conversion exemplar (CN)" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (CN — cross-border)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source:
        "PRC Company Law (公司法 2024) Part on debt instruments; SAFE Circular 37 + Circular 75 — registration of round-trip cross-border tranches",
      url: "https://www.safe.gov.cn/",
      note:
        "Cross-border note tranches require SAFE registration before each disbursement. Onshore RMB notes are governed by the PRC Company Law and PBOC interbank rules — completely different mechanics — so the engine assumes USD notes issued by the Cayman parent.",
    },
    definition: def(
      "Note Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
      },
      [
        "SAFE registration required for cross-border tranches (each disbursement).",
        "Interest paid by Cayman parent is not subject to PRC withholding tax.",
        "Engine emits safe_circular_37_required: true.",
      ],
    ),
    test: { name: "cn-note-cross-border", description: "Discount + cap + interest with SAFE registration flag" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (CN — Cayman parent)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Cayman Companies Act — articles of association; not enforceable at PRC onshore level",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def("NCP = NIP; newShares = oldShares × OIP / NIP", undefined, [
      "Exercised via the Cayman parent's articles, NOT the WFOE/onshore OpCo.",
      "PRC Company Law §36 does not natively support different conversion prices per share class.",
    ]),
    test: { name: "cn-fullratchet-cayman", description: "Down round triggers ratchet at Cayman parent" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (CN — Cayman parent)",
    region: "CN",
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
        A: "Outstanding broad-based at Cayman parent: common + preferred-as-converted + options + warrants + reserved pool",
        B: "Money raised / OCP",
        C: "Shares issued in dilutive round",
      },
      [
        "Adjustment recorded only at the Cayman parent level.",
        "Onshore WFOE / VIE cap-table is unaffected and does not require SAMR re-registration for this step.",
      ],
    ),
    test: { name: "cn-broadbased", description: "Broad-based WA (CN — Cayman parent)" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (CN — Cayman parent)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "Cayman Companies Act + narrow-based WA (mirrors NVCA §4.4(d)(ii)(B) variant)",
      url: "https://www.gov.ky/laws/companies-act",
    },
    definition: def("Same as broad-based, but A excludes options + warrants + pool", undefined, [
      "Stronger investor protection — requires explicit election in Cayman articles.",
    ]),
    test: { name: "cn-narrowbased", description: "Narrow-based WA (CN — Cayman parent)" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (CN — phantom-equity variant supported)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source:
        "STA Circular Cai Shui [2016] 101 — preferential tax on qualifying ESOP / phantom equity; PRC Company Law §142 share buybacks for ESOP",
      url: "http://www.chinatax.gov.cn/",
      note:
        "Phantom equity / SARs are widely used because direct share ownership by PRC-resident employees of a Cayman parent triggers SAFE Circular 7 registration and complex IIT (individual income tax) reporting. Phantom equity bypasses share issuance entirely — employees receive contractual cash-settled units tracked off the cap-table. The engine exposes a `phantom_equity: true` flag on the grant; when set, NO shares are issued, only a contractual liability is recorded.",
    },
    definition: def(
      "T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)",
      {
        "phantom_equity variant": "When grant.phantom_equity = true, no actual shares are issued; engine records contractual phantom units and skips cap-table mutation",
      },
      [
        "Default: Cayman-parent options (real equity) — same math as US/HK.",
        "phantom_equity: true → cash-settled units, no share issuance, no SAMR filing.",
        "Tax: Cai Shui [2016] 101 allows qualifying ESOPs deferred IIT until sale; phantom equity is taxed as employment income at payout.",
      ],
    ),
    test: { name: "cn-esop-phantom", description: "Phantom-equity variant: no shares issued, contractual units tracked" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (CN — onshore distribution WHT)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source:
        "PRC Enterprise Income Tax Law Art. 27 — 10% dividend WHT; HK-PRC DTA Art. 10 — 5% concessional rate; Cayman Companies Act — winding up",
      url: "http://www.chinatax.gov.cn/",
      note:
        "Distributions from the onshore PRC OpCo / WFOE to the Cayman parent are subject to a dividend withholding tax: 10% standard rate, 5% under the HK-PRC double-tax treaty if the immediate parent is HK-resident with substance and beneficial-ownership tests satisfied. The engine accepts a `withholdingTaxRate` parameter (decimal, e.g. \"0.10\") and applies it to onshore→offshore proceeds before the standard waterfall ranks.",
    },
    definition: def(
      "After-WHT proceeds = grossProceeds × (1 − withholdingTaxRate); then Senior preferred → 1×/2×/3× preference → participating share or cap → common pro-rata",
      {
        withholdingTaxRate: "Decimal-as-string. 0 disables WHT (e.g. for asset sales offshore-only). 0.10 standard. 0.05 HK-DTA.",
      },
      [
        "WHT applies only to the portion sourced from onshore PRC distributions; offshore-only proceeds (e.g. a Cayman-level secondary) skip WHT.",
        "SAT Bulletin 7 — if the transaction is structured as an indirect offshore share sale that effectively transfers PRC taxable assets, PRC tax authorities can re-characterize and apply WHT regardless of structure.",
        "Engine surfaces `cn_dividend_wht_applied: true` and the rate used in the trace step.",
      ],
    ),
    test: { name: "cn-waterfall-wht-10pct", description: "Onshore distribution with 10% WHT applied before preference stack" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (CN)",
    region: "CN",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "Industry-standard fully-diluted denominator at the Cayman parent; PRC Company Law §36 (onshore registered capital %)",
      url: "http://www.chinatax.gov.cn/",
    },
    definition: def("ownership_i = shares_i / Σ shares", undefined, [
      "Computed at the Cayman-parent cap-table.",
      "Onshore capital-contribution percentages are tracked separately and registered with SAMR.",
    ]),
    test: { name: "cn-ownership-sums-100", description: "Σ ownership_i = 1.0 exactly" },
  },
];
