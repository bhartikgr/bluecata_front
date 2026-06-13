/**
 * Region-aware term-sheet template types.
 * The renderer in TermSheet.tsx pulls a TermSheetTemplate by (region, instrument)
 * and interpolates the round's actual data into each section's body() function.
 */
import type { Region } from "../partners";
import type { InstrumentValue } from "@shared/schema";

export type { Region };
export type { InstrumentValue };

export interface TermSheetData {
  companyName: string;
  companyLegalName: string;
  roundName: string;
  roundType: string;
  region: Region;
  instrument: InstrumentValue;
  leadInvestor: string;
  targetAmount: number;
  preMoney: number;
  postMoney: number;
  pricePerShare: number;
  fdSharesPreMoney: number;
  liqPrefMultiple: number;
  participating: boolean;
  capParticipation: string;
  antiDilutionVariant: string; // e.g. "Broad-Based Weighted-Average"
  valuationCap: number;
  discount: number;            // percent
  interestRate: number;        // percent (notes)
  maturityMonths: number;
  mfn: boolean;
  poolSize: number;            // percent
  poolTiming: string;          // "pre_money" | "post_money"
  vestingMonths: number;
  cliffMonths: number;
  closeDate: string;
  founderNames: string[];
  governingLaw: string;        // override per region
}

/**
 * Sprint 26 — every clause carries a structured `description` explaining what
 * the clause means in plain English, the investor-grade rationale, common
 * variants, and the risk to the founder if the clause is mis-set. The
 * description is itself EDITABLE and persisted alongside the clause body.
 *
 * `whatItMeans`  — plain-English summary for non-lawyers
 * `whyItMatters` — investor-grade rationale + market norms
 * `commonVariants` — the typical alternatives a founder/lead might negotiate
 * `founderWatchouts` — the failure modes the founder must understand
 * `citation`     — the authoritative source (NVCA, YC, BVCA, J-KISS, etc.)
 */
export interface ClauseDescription {
  whatItMeans: string;
  whyItMatters: string;
  commonVariants?: string;
  founderWatchouts?: string;
  citation?: string;
}

export interface TermSheetSection {
  id: string;
  heading: string;
  body: (d: TermSheetData) => string;
  /** Sprint 26 — default description supplied by the template; founder can override. */
  description?: ClauseDescription;
  editable: boolean;
  disclaimerSection?: boolean;
}

export interface TermSheetTemplate {
  region: Region;
  instrument: InstrumentValue;
  templateName: string;
  version: string;
  sourceCitations: string[];
  sections: TermSheetSection[];
}
