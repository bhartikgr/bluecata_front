/**
 * Canada (CCPC) default formula set.
 * Citations: NI 45-106, IFRS 2 ESOP recognition, SR&ED-aware structuring.
 */
import type { FormulaRecord } from "../types.js";

const baseDef = (formula: string, where?: Record<string, string>) => ({ formula, ...(where ? { where } : {}) });

export const CA_FORMULAS: FormulaRecord[] = [
  {
    id: "safe.postmoney.conversion",
    name: "SAFE post-money cap conversion (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: {
      source: "Adapted YC SAFE post-money under NI 45-106 'accredited investor' exemption",
      url: "https://www.osc.ca/en/securities-law/instruments-rules-policies/4/45-106",
    },
    definition: baseDef("SAFE Shares = Purchase Amount / min(Cap Price, Discount Price)"),
  },
  {
    id: "safe.premoney.conversion",
    name: "SAFE pre-money cap conversion (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "safe_conversion",
    citation: { source: "YC SAFE primer (pre-money) adapted for CCPC", url: "https://www.ycombinator.com/documents" },
    definition: baseDef("SAFE Shares = Purchase Amount / Conversion Price"),
  },
  {
    id: "note.conversion",
    name: "Convertible Note conversion (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "note_conversion",
    citation: { source: "Standard CCPC convertible note conversion mechanics", url: "https://www.bdc.ca/en/articles-tools/money-finance/get-financing/financing-options-startups" },
    definition: baseDef("(Principal + Interest) / min(discountPrice, capPrice)"),
  },
  {
    id: "antiDilution.fullRatchet",
    name: "Anti-dilution: Full-Ratchet (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: { source: "Adapted NVCA model for CCPC", url: "https://nvca.org/model-legal-documents/" },
    definition: baseDef("NCP = NIP"),
  },
  {
    id: "antiDilution.broadBased",
    name: "Anti-dilution: Broad-Based WA (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: { source: "Adapted NVCA broad-based WA for CCPC", url: "https://nvca.org/model-legal-documents/" },
    definition: baseDef("NCP = OCP × (A+B)/(A+C)"),
  },
  {
    id: "antiDilution.narrowBased",
    name: "Anti-dilution: Narrow-Based WA (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "anti_dilution",
    citation: { source: "Adapted NVCA narrow-based WA for CCPC", url: "https://nvca.org/model-legal-documents/" },
    definition: baseDef("NCP = OCP × (A_narrow+B)/(A_narrow+C)"),
  },
  {
    id: "esop.topup",
    name: "ESOP top-up (CA, IFRS 2)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "esop_topup",
    citation: {
      source: "IFRS 2 share-based payment + CCPC stock option deduction (s.110(1)(d.1))",
      url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/it113r4/archived-benefits-employees-stock-options.html",
    },
    definition: baseDef("T = (P×(existing+newInv) − pool) / (1−P)"),
  },
  {
    id: "waterfall.liquidation",
    name: "Liquidation Waterfall (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "waterfall",
    citation: { source: "Standard CA preferred liquidation pref mechanics", url: "https://nvca.org/model-legal-documents/" },
    definition: baseDef("Senior pref → preference → participate/cap → common"),
  },
  {
    id: "ownership.percent",
    name: "Ownership % (CA)",
    region: "CA",
    version: "1.0.0",
    status: "active",
    category: "ownership",
    citation: { source: "Industry-standard FD denominator", url: "https://carta.com/blog/fully-diluted-cap-table/" },
    definition: baseDef("ownership_i = shares_i / Σ shares"),
  },
];
