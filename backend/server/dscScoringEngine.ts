/**
 * Wave C-4 — DSC Scoring Engine
 *
 * Computes live composite M&A readiness scores from companyProfileStore
 * data — NO mock numbers anywhere. All inputs come from the 7 readiness %
 * fields stored on CompanyProfile (Wave C-1).
 *
 * ============================================================
 * Formula documentation (transparent, inline)
 * ============================================================
 *
 * ## 7 Input Dimensions (from companyProfileStore)
 *   1. ipDdReadinessPct               — IP / due-diligence readiness (0-100)
 *   2. customerContractsReadinessPct  — Customer-contracts documentation readiness (0-100)
 *   3. financialAuditReadinessPct     — Financial audit / clean books readiness (0-100)
 *   4. dataRoomOrganizedPct           — Data-room organisation readiness (0-100)
 *   5. regulatoryFilingsCompletePct   — Regulatory filing completeness (0-100)
 *   6. esgDisclosureCompletePct       — ESG disclosure readiness (0-100)
 *   7. transactionPrepStatus          — Used as a stage bonus: not_pursuing=0, exploring=5, active=10, closing=15
 *
 * ## Sub-scores
 *   mnaScore   = weighted avg of dimensions 1,2,3,5 (IP, customers, financials, regulatory)
 *   roundScore = weighted avg of dimensions 4,6 + runwayMonths (data room, ESG, runway)
 *
 * ## Sector weight matrix
 * Different sectors emphasise different dimensions. Weights must sum to 1.0 across the 6
 * continuous dimensions (transactionPrepStatus bonus applied separately).
 *
 *   Sector         ip    custContr  finAudit  dataRoom  regulatory  esg
 *   SaaS           0.25  0.30       0.20      0.10      0.05        0.10
 *   Biotech        0.35  0.10       0.15      0.08      0.25        0.07
 *   Fintech        0.20  0.20       0.30      0.10      0.15        0.05
 *   CleanTech      0.15  0.15       0.20      0.08      0.15        0.27
 *   HealthTech     0.20  0.20       0.20      0.10      0.20        0.10
 *   DeepTech       0.30  0.15       0.20      0.12      0.18        0.05
 *   Consumer       0.15  0.35       0.20      0.10      0.05        0.15
 *   Marketplace    0.15  0.35       0.20      0.12      0.03        0.15
 *   Default        0.20  0.20       0.20      0.15      0.15        0.10
 *
 * ## compositeScore
 *   compositeScore = sectorWeightedAvg(6 dims) + transactionPrepBonus
 *   where transactionPrepBonus ∈ {0, 5, 10, 15} (from transactionPrepStatus)
 *   result capped at 100
 *
 * ## Auto-tier
 *   A: compositeScore >= 85
 *   B: 70 <= compositeScore < 85
 *   C: 50 <= compositeScore < 70
 *   D: compositeScore < 50
 *
 * ## sectorBenchmark
 *   Median compositeScore across all companies in the same sector
 *   (computed live from companyProfileStore)
 */

import { getAllProfiles, type CompanyProfile } from "./companyProfileStore";

/* ============================================================
 * Sector weight matrix
 * ============================================================ */

interface SectorWeights {
  ip: number;
  customerContracts: number;
  financialAudit: number;
  dataRoom: number;
  regulatory: number;
  esg: number;
}

const SECTOR_WEIGHTS: Record<string, SectorWeights> = {
  // Key: lowercase normalised sector label (may be partial match)
  saas: {
    ip: 0.25, customerContracts: 0.30, financialAudit: 0.20,
    dataRoom: 0.10, regulatory: 0.05, esg: 0.10,
  },
  biotech: {
    ip: 0.35, customerContracts: 0.10, financialAudit: 0.15,
    dataRoom: 0.08, regulatory: 0.25, esg: 0.07,
  },
  fintech: {
    ip: 0.20, customerContracts: 0.20, financialAudit: 0.30,
    dataRoom: 0.10, regulatory: 0.15, esg: 0.05,
  },
  cleantech: {
    ip: 0.15, customerContracts: 0.15, financialAudit: 0.20,
    dataRoom: 0.08, regulatory: 0.15, esg: 0.27,
  },
  healthtech: {
    ip: 0.20, customerContracts: 0.20, financialAudit: 0.20,
    dataRoom: 0.10, regulatory: 0.20, esg: 0.10,
  },
  deeptech: {
    ip: 0.30, customerContracts: 0.15, financialAudit: 0.20,
    dataRoom: 0.12, regulatory: 0.18, esg: 0.05,
  },
  consumer: {
    ip: 0.15, customerContracts: 0.35, financialAudit: 0.20,
    dataRoom: 0.10, regulatory: 0.05, esg: 0.15,
  },
  marketplace: {
    ip: 0.15, customerContracts: 0.35, financialAudit: 0.20,
    dataRoom: 0.12, regulatory: 0.03, esg: 0.15,
  },
  default: {
    ip: 0.20, customerContracts: 0.20, financialAudit: 0.20,
    dataRoom: 0.15, regulatory: 0.15, esg: 0.10,
  },
};

/** Normalise sector string to a weight-matrix key */
function normaliseSector(sector: string | undefined): string {
  if (!sector) return "default";
  const lower = sector.toLowerCase();
  // Order matters: check most-specific first
  if (lower.includes("biotech") || lower.includes("bioscience") || lower.includes("life sci")) return "biotech";
  if (lower.includes("fintech") || lower.includes("payments") || lower.includes("finance")) return "fintech";
  if (lower.includes("cleantech") || lower.includes("climate") || lower.includes("energy") || lower.includes("clean")) return "cleantech";
  if (lower.includes("healthtech") || lower.includes("health") || lower.includes("medtech") || lower.includes("digital health")) return "healthtech";
  if (lower.includes("deeptech") || lower.includes("deep tech") || lower.includes("quantum") || lower.includes("hardware")) return "deeptech";
  if (lower.includes("consumer")) return "consumer";
  if (lower.includes("marketplace")) return "marketplace";
  if (lower.includes("saas") || lower.includes("software") || lower.includes("ai/ml") || lower.includes("ai ") || lower.includes(" ai")) return "saas";
  return "default";
}

const TRANSACTION_PREP_BONUS: Record<string, number> = {
  not_pursuing: 0,
  exploring: 5,
  active: 10,
  closing: 15,
};

/* ============================================================
 * Composite score result type
 * ============================================================ */

export interface DscCompositeResult {
  companyId: string;
  compositeScore: number;
  mnaScore: number;
  roundScore: number;
  autoTier: "A" | "B" | "C" | "D";
  sectorBenchmark: number | null; // median across sector; null if <2 companies
  breakdown: {
    ip: number;
    customerContracts: number;
    financialAudit: number;
    dataRoom: number;
    regulatory: number;
    esg: number;
    transactionPrepBonus: number;
    sectorKey: string;
    weights: SectorWeights;
  };
}

/* ============================================================
 * Median helper
 * ============================================================ */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ============================================================
 * Auto-tier boundary mapping
 * ============================================================ */

export function computeAutoTier(score: number): "A" | "B" | "C" | "D" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

/* ============================================================
 * Core computation
 * ============================================================ */

/**
 * Compute composite M&A readiness score for a single company profile.
 * Returns null if the profile has NO readiness data at all (graceful empty state).
 */
export function computeCompositeForProfile(profile: CompanyProfile): DscCompositeResult | null {
  const ip = profile.ipDdReadinessPct ?? null;
  const custContr = profile.customerContractsReadinessPct ?? null;
  const finAudit = profile.financialAuditReadinessPct ?? null;
  const dataRoom = profile.dataRoomOrganizedPct ?? null;
  const regulatory = profile.regulatoryFilingsCompletePct ?? null;
  const esg = profile.esgDisclosureCompletePct ?? null;

  // If ALL 6 continuous fields are null, return null (no data yet)
  if (
    ip === null &&
    custContr === null &&
    finAudit === null &&
    dataRoom === null &&
    regulatory === null &&
    esg === null
  ) {
    return null;
  }

  // Treat missing fields as 0 (worst-case assumption for unanswered dimensions)
  const ipVal = ip ?? 0;
  const custContrVal = custContr ?? 0;
  const finAuditVal = finAudit ?? 0;
  const dataRoomVal = dataRoom ?? 0;
  const regulatoryVal = regulatory ?? 0;
  const esgVal = esg ?? 0;

  const sectorKey = normaliseSector(profile.sector);
  const w = SECTOR_WEIGHTS[sectorKey] ?? SECTOR_WEIGHTS.default;

  // Weighted composite of 6 continuous dimensions
  const weightedBase =
    w.ip * ipVal +
    w.customerContracts * custContrVal +
    w.financialAudit * finAuditVal +
    w.dataRoom * dataRoomVal +
    w.regulatory * regulatoryVal +
    w.esg * esgVal;

  // Transaction-prep stage bonus
  const bonus = TRANSACTION_PREP_BONUS[profile.transactionPrepStatus ?? "not_pursuing"] ?? 0;

  const compositeScore = Math.min(100, Math.round(weightedBase + bonus));

  // mnaScore: IP, customers, financials, regulatory (equal weights normalised to 1.0)
  const mnaRaw = (ipVal + custContrVal + finAuditVal + regulatoryVal) / 4;
  const mnaScore = Math.round(mnaRaw);

  // roundScore: dataRoom, ESG + runway bonus (5 pts per 6 months of runway, capped 20)
  const runwayBonus = Math.min(20, Math.floor((profile.runwayMonths ?? 0) / 6) * 5);
  const roundRaw = (dataRoomVal + esgVal) / 2 + runwayBonus;
  const roundScore = Math.round(Math.min(100, roundRaw));

  return {
    companyId: profile.companyId,
    compositeScore,
    mnaScore,
    roundScore,
    autoTier: computeAutoTier(compositeScore),
    sectorBenchmark: null, // filled in by computeCompositeForCompany
    breakdown: {
      ip: ipVal,
      customerContracts: custContrVal,
      financialAudit: finAuditVal,
      dataRoom: dataRoomVal,
      regulatory: regulatoryVal,
      esg: esgVal,
      transactionPrepBonus: bonus,
      sectorKey,
      weights: w,
    },
  };
}

/**
 * Compute composite for a specific company by ID, including sector benchmark.
 * Returns null if no profile found OR if the profile has no readiness data.
 */
export function computeCompositeForCompany(companyId: string): DscCompositeResult | null {
  const allProfiles = getAllProfiles();
  const profile = allProfiles.find((p) => p.companyId === companyId);
  if (!profile) return null;

  const result = computeCompositeForProfile(profile);
  if (!result) return null;

  // Compute sector benchmark: median composite across all companies in same sector
  const sectorKey = normaliseSector(profile.sector);
  const sectorScores: number[] = [];
  for (const p of allProfiles) {
    if (normaliseSector(p.sector) === sectorKey) {
      const r = computeCompositeForProfile(p);
      if (r !== null) sectorScores.push(r.compositeScore);
    }
  }

  // Only set benchmark if we have at least 2 companies in the same sector
  result.sectorBenchmark = sectorScores.length >= 2 ? (median(sectorScores) ?? null) : null;

  return result;
}

/**
 * Get all composite scores for all companies (used in DSC scores table).
 * Companies with no readiness data are excluded.
 */
export function computeAllComposites(): DscCompositeResult[] {
  const allProfiles = getAllProfiles();
  const results: DscCompositeResult[] = [];

  for (const profile of allProfiles) {
    const r = computeCompositeForProfile(profile);
    if (r !== null) {
      // Add sector benchmark
      const sectorKey = r.breakdown.sectorKey;
      const sectorScores = results
        .filter((x) => x.breakdown.sectorKey === sectorKey)
        .map((x) => x.compositeScore);
      // Include current result in peer calculation
      sectorScores.push(r.compositeScore);
      r.sectorBenchmark = sectorScores.length >= 2 ? (median(sectorScores) ?? null) : null;
      results.push(r);
    }
  }

  // Second pass: fill in accurate benchmarks now that all composites are computed
  for (const result of results) {
    const sectorKey = result.breakdown.sectorKey;
    const sectorScores = results
      .filter((x) => x.breakdown.sectorKey === sectorKey)
      .map((x) => x.compositeScore);
    result.sectorBenchmark = sectorScores.length >= 2 ? (median(sectorScores) ?? null) : null;
  }

  return results;
}
