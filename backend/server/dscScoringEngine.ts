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
import { parseMaPrivacy } from "./lib/maAuthzGate";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

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

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  R206 · THE FOUNDER'S COLLECTIVE-SHARING SWITCH, HONOURED AT THE POINT OF
 *  COMPUTATION
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * THE DEFECT. `shareWithCollective` — a switch the founder can turn off in
 * `client/src/components/founder/MaPrivacyConsent.tsx` — appeared ZERO times in this
 * file. It is honoured on the M&A intelligence surface (`server/lib/maAuthzGate.ts:174`
 * and `server/collectiveMaIntelStore.ts:404`) and was ignored here, so a founder who
 * switched sharing OFF was still inside the sector median shown to everyone else. The
 * control existed, rendered, and nothing consulted it.
 *
 * WHY THE FILTER IS HERE AND NOT AT DISPLAY. A median filtered on its way to the screen
 * has still been COMPUTED from the data of a company that asked not to be in it. The
 * excluded company must not be in the comparison set at all. This follows the
 * construction wave 221 used for its benchmarking opt-out in
 * `server/wave9ReportingStore.ts` `computeCohortBenchmark()`, where the filter sits
 * BEFORE the NO_DATA and minimum-N branches. No second opt-out mechanism is built
 * (R171.1): the switch is the existing `ma_privacy_json.shareWithCollective`, read
 * through the existing `parseMaPrivacy` from `maAuthzGate`.
 *
 * ── THE ONE JUDGEMENT CALL, STATED OPENLY AND NEEDING RATIFICATION ──
 * `MA_PRIVACY_DEFAULT.shareWithCollective` is `false`, and `getCompanyPrivacy` returns
 * that default for a company whose `ma_privacy_json` is NULL. On the measured data of
 * this tree, ALL 367 non-deleted companies have `ma_privacy_json` NULL. Excluding every
 * company whose EFFECTIVE value is false would therefore exclude the entire platform
 * and empty every sector benchmark that exists.
 *
 * That is not honouring a founder's choice — a NULL is the ABSENCE of a choice — and
 * emptying every benchmark would be exactly the narrowing R190.10 forbids me from
 * doing. So this filter excludes a company only when its stored privacy row
 * AFFIRMATIVELY records `shareWithCollective: false`. That is precisely wave 221's own
 * rule, whose `wave221OptedOutIds` counts only rows where the opt-out column
 * `IS NOT NULL AND <> ''`.
 *
 * CONSEQUENCE, WHICH THE OWNER MUST DECIDE ON: a founder who has never opened the
 * privacy screen is still in the median, even though the platform's default elsewhere
 * treats them as not sharing. Reading NULL as an opt-out is a one-line change here,
 * and W219_FOR_THE_OWNER.md asks for the ruling rather than making it silently.
 *
 * WITH NOBODY SWITCHED OFF THIS IS A NO-OP. `dscCollectiveOptedOutCompanyIds()` returns
 * an empty Set for a platform with no takers, for a database with no `ma_privacy_json`
 * column, and for a failed read — so the cohort array holds the same values in the same
 * order and every benchmark is byte-identical to before this wave.
 *
 * A read failure must never become "everyone opted out", which would empty every
 * benchmark on the platform. It becomes "nobody opted out", which is today's behaviour,
 * and it is logged. */
export function dscCollectiveOptedOutCompanyIds(): Set<string> {
  const out = new Set<string>();
  try {
    const rows = (rawDb() as any)
      .prepare(
        `SELECT id, ma_privacy_json AS j FROM companies
          WHERE deleted_at IS NULL AND ma_privacy_json IS NOT NULL AND ma_privacy_json <> ''`,
      )
      .all() as Array<{ id: string; j: string | null }>;
    for (const r of rows) {
      /* Reused reader, not a second parse: `parseMaPrivacy` fails closed to the
         platform default on malformed JSON. Only an AFFIRMATIVE false counts. */
      if (parseMaPrivacy(r.j).shareWithCollective === false) out.add(String(r.id));
    }
  } catch (err) {
    log.warn(
      "[R206] Collective-sharing opt-out read failed; treating as no takers:",
      (err as Error).message,
    );
  }
  return out;
}

/** Minimum companies in a sector before a median may be published. Pre-existing
 *  value, named rather than repeated three times, so the R206 filter cannot be read
 *  as having changed it. */
const DSC_MIN_SECTOR_N = 2;

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
  /* R206 — read ONCE per computation, not once per company: a query per row would put
     a database read inside the cohort loop. See the note on
     `dscCollectiveOptedOutCompanyIds` above for why this is here and not at display. */
  const optedOut = dscCollectiveOptedOutCompanyIds();
  const sectorScores: number[] = [];
  for (const p of allProfiles) {
    if (normaliseSector(p.sector) === sectorKey) {
      /* R206 — a company whose founder switched Collective sharing off is not in the
         comparison set AT ALL. Placed BEFORE the minimum-N branch below, so an
         exclusion that drops a sector under its minimum suppresses the benchmark
         rather than publishing a median of a shorter sample. THIS COMPANY'S OWN row
         and its own compositeScore are untouched — an opted-out founder still sees
         their own figure, which R190.10 requires. */
      if (optedOut.has(p.companyId)) continue;
      const r = computeCompositeForProfile(p);
      if (r !== null) sectorScores.push(r.compositeScore);
    }
  }

  /* Only set benchmark if we have at least DSC_MIN_SECTOR_N companies in the sector.
     Below it the benchmark is `null` — NEVER 0, and never a plausible-looking
     placeholder (R201.2). The screens already render `null` as an em dash or hide the
     card; verified at `client/src/pages/collective/CollectiveDscScores.tsx:212` and
     `client/src/pages/collective/CollectiveDealRoomDetail.tsx:307`. */
  result.sectorBenchmark =
    sectorScores.length >= DSC_MIN_SECTOR_N ? (median(sectorScores) ?? null) : null;

  return result;
}

/**
 * Get all composite scores for all companies (used in DSC scores table).
 * Companies with no readiness data are excluded.
 */
export function computeAllComposites(): DscCompositeResult[] {
  const allProfiles = getAllProfiles();
  const results: DscCompositeResult[] = [];

  /* R206 — one read for the whole sweep. */
  const optedOut = dscCollectiveOptedOutCompanyIds();

  for (const profile of allProfiles) {
    const r = computeCompositeForProfile(profile);
    if (r !== null) {
      // Add sector benchmark
      const sectorKey = r.breakdown.sectorKey;
      /* R206 — the cohort excludes opted-out companies. `results` still holds EVERY
         company, including the opted-out ones, so their own rows and their own scores
         are still returned and still rendered: the switch controls what OTHERS are
         compared against, not whether the founder can see their own number.

         HONEST NOTE, ESTABLISHED ADVERSARIALLY AND NOT BY REVIEW: this first-pass
         filter is REDUNDANT and no test can observe it. The second pass below
         overwrites `sectorBenchmark` for every result unconditionally, so whatever
         this pass computes is always replaced. Two disarms proving it — removing this
         filter, and pushing the subject into its own cohort regardless of its switch —
         both come back GREEN, and that is expected rather than a hole in the proof.
         The load-bearing filter is the one in the second pass, and disarming THAT is
         RED. It is kept here anyway, defensively, because a future wave that removes
         or short-circuits the second pass would otherwise silently reopen R206. */
      const sectorScores = results
        .filter((x) => x.breakdown.sectorKey === sectorKey && !optedOut.has(x.companyId))
        .map((x) => x.compositeScore);
      // Include current result in peer calculation, unless it opted out
      if (!optedOut.has(r.companyId)) sectorScores.push(r.compositeScore);
      r.sectorBenchmark =
        sectorScores.length >= DSC_MIN_SECTOR_N ? (median(sectorScores) ?? null) : null;
      results.push(r);
    }
  }

  // Second pass: fill in accurate benchmarks now that all composites are computed
  for (const result of results) {
    const sectorKey = result.breakdown.sectorKey;
    /* R206 — same exclusion in the second pass. If this filter were only in the
       first pass the second would overwrite it with an unfiltered median, which is
       how a fix like this quietly becomes inert. */
    const sectorScores = results
      .filter((x) => x.breakdown.sectorKey === sectorKey && !optedOut.has(x.companyId))
      .map((x) => x.compositeScore);
    result.sectorBenchmark =
      sectorScores.length >= DSC_MIN_SECTOR_N ? (median(sectorScores) ?? null) : null;
  }

  return results;
}
