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
  /* WAVE 58b · DEFECT 4 (R21) — NULLABLE, because the honest answer when the
     round has no declared fully-diluted count is a named blank in the document,
     not an invented number. It was a hardcoded 12,500,000 at
     `client/src/pages/founder/TermSheet.tsx:83`. */
  fdSharesPreMoney: number | null;
  /* ═════════════════════════════════════════════════════════════════════════
     WAVE 92 · ITEM 3 (open item N-3 / OQ-W94-2) — NULLABLE, FOR THE SAME REASON
     `fdSharesPreMoney` ABOVE IS NULLABLE.
     ═════════════════════════════════════════════════════════════════════════
     These three were HARDCODED at `client/src/pages/founder/TermSheet.tsx` to
     `1`, `false` and the word "non-participating", in the object that generates a
     document a founder SENDS TO AN INVESTOR. A company with 2x participating
     capped at 3x on record generated a term sheet asserting 1x non-participating,
     and the third literal was a WORD in a slot the template renders as a MULTIPLE
     ("a participation cap of non-participating x the Original Issue Price").

     They now READ THE ROUND through `./roundNegotiatedTerms`, and `null` means the
     round does not record the term. The templates state that in words. ABSENT
     MEANS ABSENT: a term sheet that asserts a liquidation preference nobody
     negotiated is worse than one that leaves it blank, and this is also the term
     the exit waterfall computes from — so a default here could print one
     liquidation term while the platform models another. */
  liqPrefMultiple: number | null;
  participating: boolean | null;
  /** The cap MULTIPLE as text, or `""` for "no cap on record". Never a word. */
  capParticipation: string;
  /** WAVE 92 · ITEM 3 — the round's stored liquidation-preference WORDING,
   *  verbatim, or `null`. Printed inside the "not on record" clause so a founder
   *  reading a blank term is shown what IS stored and why it was not enough,
   *  rather than being told only that something is missing. */
  liquidationPreferenceRaw: string | null;
  antiDilutionVariant: string; // e.g. "Broad-Based Weighted-Average"
  valuationCap: number;
  discount: number;            // percent
  interestRate: number;        // percent (notes)
  maturityMonths: number;
  mfn: boolean;
  /* WAVE 58b · DEFECT 4 (R21) — PERCENT-AS-WRITTEN (R16): 15 means 15%. NULL
     means the round contemplates NO pool top-up, which the templates state in
     words. It was hardcoded to 10 at `TermSheet.tsx:93` regardless of what the
     founder actually agreed in the round wizard. */
  poolSize: number | null;     // percent-as-written, or null for "no pool"
  /* WAVE 58b · DEFECT 4 (R21) — read from the round's stored placement. It was
     hardcoded to "post_money" at `TermSheet.tsx:94`. */
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
