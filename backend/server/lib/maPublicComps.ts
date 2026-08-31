/**
 * v25.44 ROUND 2 — Public market M&A comparables library.
 *
 * WAVE 225 · R193.2 — THE CLAIM BELOW WAS FALSE AND IS CORRECTED HERE.
 *
 * This header used to assert: "These are REAL, publicly-observable M&A
 * transactions (announced acquisitions with public valuations)." That assertion
 * was not supportable. Not one of the nine entries carries a source or a date on
 * which a source reported it, and the interface below had nowhere to record one.
 * The entries were authored as literals and presented to accredited investors as
 * observed market data, on screen and in `comparable_exits.csv`.
 *
 * They are therefore now treated as UNVERIFIED comparable-transaction rows. They
 * are retained, unaltered, so that nothing is lost — but they no longer reach a
 * user, because `viewComps()` passes this array through the provenance gate in
 * `server/lib/wave225CompProvenance.ts`, which emits only rows carrying BOTH a
 * `source` and a real `sourceDate`. Today that is zero of nine.
 *
 * DO NOT "correct" these numbers and do not research replacements. A
 * wrong-but-plausible comparable is the defect, whether it came from a hardcoded
 * array or from a hurried search. The only way a row here becomes emittable is
 * by recording where the figure actually came from and when.
 *
 * Per the Surface-13 brief §4: "All comparableExits[] rows can be aggregated
 * regardless of shareWithCollective (they're already public market comps)".
 * They are NOT founder-private data and carry no per-company buyer rationale.
 * Note that the brief's phrase "already public" was an assumption about these
 * rows, not evidence for them; the privacy question and the truth question are
 * different questions, and only the first was ever answered.
 *
 * This is the ONLY surviving piece of the round-1 static maps, relocated here
 * and clearly scoped as a PUBLIC-MARKET REFERENCE library (not company-private
 * intelligence). The founder-private COMPANY_FEATURES buyer mocks have been
 * retired from the aggregation path entirely (see maProfileSource.ts).
 *
 * Going forward, a real provider (e.g. a licensed comps feed) can replace this
 * array; the viewComps() consumer is agnostic to the source. When it does, each
 * row it supplies must carry `source` and `sourceDate` or the gate will withhold
 * it — which is the intended behaviour, not an integration bug.
 */
export interface PublicMarketComp {
  target: string;
  acquirer: string;
  date: string; // ISO YYYY-MM-DD — the claimed transaction date
  valuationUsd: number;
  revenueMultiple: number | null;
  sector: string;
  region?: string;
  /**
   * WAVE 225 — provenance. Where this transaction figure came from: a named
   * publication, filing, press release or licensed feed. Optional in the type
   * only because the nine legacy rows below have none; a row without it is
   * WITHHELD by `wave225CompProvenance.verifiedComps()` and never reaches a
   * user. Absent means absent — do not populate this with anything that is not
   * the actual origin of the figure.
   */
  source?: string;
  /**
   * WAVE 225 — the date, ISO YYYY-MM-DD, on which `source` reported this
   * figure. Distinct from `date` above: `date` is the claimed transaction date,
   * this is when the claim became checkable. Required, with `source`, for the
   * row to be emitted. A source without a date cannot be checked for staleness.
   */
  sourceDate?: string;
}

// WAVE 225 — UNVERIFIED comparable-transaction rows. Retained deliberately and
// unaltered; withheld from every user-facing surface by the provenance gate
// because not one of them records where its figures came from. See the header.
// The previous label on this line read "PUBLIC-MARKET REFERENCE DATA —
// observable announced transactions", which was part of the misstatement.
export const PUBLIC_MARKET_COMPS: PublicMarketComp[] = [
  { target: "BridgeFX",       acquirer: "Visa",       date: "2025-11-04", valuationUsd:  680_000_000, revenueMultiple: 11.4, sector: "Fintech", region: "global" },
  { target: "Quill Pay",      acquirer: "Stripe",     date: "2025-08-19", valuationUsd:  340_000_000, revenueMultiple:  9.2, sector: "Fintech", region: "global" },
  { target: "Astra Settle",   acquirer: "Adyen",      date: "2024-12-12", valuationUsd:  220_000_000, revenueMultiple:  8.0, sector: "Fintech", region: "global" },
  { target: "Cordis Bio",     acquirer: "Roche",      date: "2025-09-30", valuationUsd: 1_100_000_000, revenueMultiple: 18.5, sector: "Biotech", region: "global" },
  { target: "MimicLabs",      acquirer: "Illumina",   date: "2024-11-21", valuationUsd:  410_000_000, revenueMultiple:  9.4, sector: "Biotech", region: "global" },
  { target: "Ardent Care",    acquirer: "Teladoc",    date: "2025-04-10", valuationUsd:  280_000_000, revenueMultiple:  6.8, sector: "Digital Health", region: "global" },
  { target: "Vesta Robotics", acquirer: "Rockwell",   date: "2025-07-01", valuationUsd:  520_000_000, revenueMultiple:  7.2, sector: "Industrial Automation", region: "global" },
  { target: "OnyxAI",         acquirer: "ServiceNow", date: "2025-10-08", valuationUsd:  890_000_000, revenueMultiple: 14.0, sector: "AI Infrastructure", region: "global" },
  { target: "Bristle Grid",   acquirer: "Schneider",  date: "2025-02-14", valuationUsd:  310_000_000, revenueMultiple:  6.0, sector: "Climate / Grid", region: "global" },
];
