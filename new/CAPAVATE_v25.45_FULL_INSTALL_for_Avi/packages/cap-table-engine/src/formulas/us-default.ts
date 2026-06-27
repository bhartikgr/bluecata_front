/**
 * US (Delaware C-Corp) default formula set.
 * Citations:
 *   - YC SAFE v1.2 post-money primer
 *   - YC SAFE pre-money primer (legacy)
 *   - NVCA Model Charter §4.4
 *   - ASC 718 / 409A guidance
 */
import type { FormulaRecord } from "../types.js";

export const US_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE post-money cap conversion (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Post-Money SAFE User Guide v1.2",
      url: "https://www.ycombinator.com/documents",
      note: "Conversion Price = min(SeriesPPS×(1−discount), PostMoneyValuationCap / CompanyCapitalization)",
    },
    definition: {
      formula: "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      where: {
        "SAFE Price": "Post-Money Valuation Cap / Company Capitalization (post-money)",
        "Discount Price": "Series PPS × (1 − Discount)",
      },
    },
    test: { name: "yc-safe-postmoney", description: "$100k @ $5M cap, Series A PPS $1.00, 1M outstanding" },
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE pre-money cap conversion (US, legacy)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "YC Pre-Money SAFE primer (legacy)",
      url: "https://www.ycombinator.com/documents",
    },
    definition: {
      formula: "SAFE Shares = Purchase Amount / min(SAFE Price, Discount Price)",
      where: { "SAFE Price": "Pre-Money Valuation Cap / Company Capitalization (pre-money)" },
    },
    test: { name: "yc-safe-premoney", description: "Pre-money cap conversion exemplar" },
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: {
      source: "NVCA Convertible Note primer + Pulley convertible note guide",
      url: "https://pulley.com/guides/convertible-notes",
    },
    definition: {
      formula: "Note Shares = (Principal + Accrued Interest) / min(Discount Price, Cap Price)",
      where: {
        "Accrued Interest (simple)": "Principal × rate × yearsElapsed",
        "Cap Price": "Cap / CompanyCapitalization",
      },
    },
    test: { name: "note-discount-cap-interest", description: "Discount + cap + interest convergence" },
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "NVCA Model Certificate of Incorporation §4.4(d)(i)",
      url: "https://nvca.org/model-legal-documents/",
    },
    definition: { formula: "NCP = NIP; newShares = oldShares × OIP / NIP" },
    test: { name: "fullratchet-downround", description: "Down round triggers ratchet" },
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based Weighted-Average (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "NVCA Model Charter §4.4(d)(ii)(A); Carta blog explainer",
      url: "https://carta.com/blog/anti-dilution-protection/",
    },
    definition: {
      formula: "NCP = OCP × (A + B) / (A + C)",
      where: {
        A: "Outstanding broad-based: common + preferred-as-converted + options + warrants + reserved pool",
        B: "Money raised / OCP",
        C: "Shares issued in dilutive round",
      },
    },
    test: { name: "carta-broadbased", description: "Carta walked-through example" },
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based Weighted-Average (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: {
      source: "NVCA Model Charter §4.4(d)(ii)(B) variant",
      url: "https://nvca.org/model-legal-documents/",
    },
    definition: { formula: "Same as broad-based, but A excludes options + warrants + pool" },
    test: { name: "narrowbased-downround", description: "Stronger protection than broad-based" },
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (US, pre/post-money)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source: "YC primer 'Pre-money vs Post-money option pool'; Carta option pool shuffle",
      url: "https://carta.com/blog/option-pool/",
    },
    definition: {
      formula: "T = (P × (existing + newInvestorShares) − existingPool) / (1 − P)",
    },
    test: { name: "esop-topup-10pct", description: "10% target pool, $5M pre-money round" },
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: {
      source: "NVCA Model Certificate §2 Liquidation Preference",
      url: "https://nvca.org/model-legal-documents/",
    },
    definition: {
      formula:
        "Senior preferred → 1×/2×/3× preference → participating share or cap → common pro-rata",
    },
    test: { name: "waterfall-1x-nonparticipating", description: "Standard 1× non-participating" },
  },
  {
    id: "ownership.percent",
    name: "Ownership Percentage (US)",
    region: "US",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: {
      source: "Industry-standard fully-diluted denominator",
      url: "https://carta.com/blog/fully-diluted-cap-table/",
    },
    definition: { formula: "ownership_i = shares_i / Σ shares" },
    test: { name: "ownership-sums-100", description: "Σ ownership_i = 1.0 exactly" },
  },
];
