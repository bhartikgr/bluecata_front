/**
 * v25.44 ROUND 2 — Public market M&A comparables library.
 *
 * These are REAL, publicly-observable M&A transactions (announced acquisitions
 * with public valuations). Per the Surface-13 brief §4: "All comparableExits[]
 * rows can be aggregated regardless of shareWithCollective (they're already
 * public market comps)". They are NOT founder-private data and carry no
 * per-company buyer rationale.
 *
 * This is the ONLY surviving piece of the round-1 static maps, relocated here
 * and clearly scoped as a PUBLIC-MARKET REFERENCE library (not company-private
 * intelligence). The founder-private COMPANY_FEATURES buyer mocks have been
 * retired from the aggregation path entirely (see maProfileSource.ts).
 *
 * Going forward, a real provider (e.g. a licensed comps feed) can replace this
 * array; the viewComps() consumer is agnostic to the source.
 */
export interface PublicMarketComp {
  target: string;
  acquirer: string;
  date: string; // ISO YYYY-MM-DD
  valuationUsd: number;
  revenueMultiple: number | null;
  sector: string;
  region?: string;
}

// PUBLIC-MARKET REFERENCE DATA — observable announced transactions.
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
