/**
 * v25.44 ROUND 2 — Single source of truth for REAL stored M&A profile data.
 *
 * BLOCKER 2 FIX. Prior to round 2, both the legacy
 * `/api/investor/ma/intelligence/:companyId` endpoint and the new
 * `/api/collective/ma-intel` aggregation derived their numbers from the static
 * `COMPANY_FEATURES` / `COMPS_LIBRARY` maps in maIntelligenceStore.ts. That is
 * the classic "looks DB-backed but uses in-memory mocks" pattern: a real
 * company with no entry in those maps produced zeros, and the seeded NovaPay /
 * Helia buyer rationale could leak to fresh users.
 *
 * The ACTUAL founder-supplied M&A fields are captured at Company Profile Step 4
 * (client/src/pages/founder/Company.tsx -> Step4MaIntent) and persisted by
 * server/profileStore.ts into `profilestore_company_profile.profile_json`
 * (a JSON blob keyed by company_id) under the `ma` key
 * (the `CompanyMAIntelligence` shape — strategicPriorities, transactionInterests,
 * the 11 governance booleans, competitors, maReadinessNarrative, etc.).
 *
 * This module reads THAT stored data and derives a strict, typed M&A
 * intelligence record from it. Companies with no stored Step 4 profile return
 * `null` so the aggregation can EXCLUDE them entirely (NOT emit zeros).
 *
 * NO MUTATION of the AVI Tier-2 companyProfileStore — we read the durable side
 * table `profilestore_company_profile` directly via rawDb().
 */
import { rawDb } from "../db/connection";
import {
  computeMaReadinessScore,
  type CompanyMAIntelligence,
  type CompanyProfile,
} from "../../client/src/lib/profile/types";

/**
 * The derived, redaction-safe per-company M&A intelligence record built from
 * REAL stored Step 4 fields. Deliberately does NOT carry maReadinessNarrative
 * (or any free-text) — the narrative is returned ONLY by the dedicated
 * narrative accessor below, gated by the authz layer.
 */
export interface DerivedMaIntel {
  companyId: string;
  /** 0-100 readiness score derived from the stored Step 4 fields. */
  maScore: number;
  /** 0-100 acquirer-fit proxy (same readiness model; institutional preview). */
  acquirerFitScore: number;
  intentSignal: "none" | "inbound" | "outbound" | "active_negotiation";
  /** Derived 0-100 sub-dimensions (transparent, from stored governance/market). */
  productMarketFit: number;
  technologyDifferentiation: number;
  customerConcentration: number;
  growthRate: number;
  marketShare: number;
  managementTeamStrength: number;
  /** Strategic intent chips the founder actually selected (non-sensitive). */
  strategicPriorities: string[];
  transactionInterests: string[];
  /** Lead strategic buyer is NOT founder-private static data anymore — we have
   *  no buyer shortlist in the Step 4 schema, so this is always null for derived
   *  records. (The static buyer mocks were the round-1 leak.) */
  topBuyer: { name: string; rationale: string } | null;
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Read the durably-stored CompanyProfile (Step 4 lives under `.ma`). */
export function readStoredCompanyProfile(companyId: string): CompanyProfile | null {
  try {
    const row = rawDb()
      .prepare(
        `SELECT profile_json FROM profilestore_company_profile
         WHERE company_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(companyId) as { profile_json?: string } | undefined;
    if (!row?.profile_json) return null;
    const parsed = JSON.parse(row.profile_json) as CompanyProfile;
    if (!parsed || typeof parsed !== "object" || !parsed.ma) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Derive the intent signal from the founder's actually-selected transaction
 * interests + strategic priorities. Deterministic, transparent, DB-driven.
 */
function deriveIntentSignal(ma: CompanyMAIntelligence): DerivedMaIntel["intentSignal"] {
  const priorities = ma.strategicPriorities ?? [];
  const interests = ma.transactionInterests ?? [];
  if (priorities.includes("no_intention")) return "none";
  // Active sale-of-control / full-exit appetite → strongest signal.
  if (interests.includes("full_exit") || interests.includes("majority_sale")) {
    return "active_negotiation";
  }
  // Being an acquirer (inbound interest in buying) → inbound.
  if (interests.includes("strategic_acquisition")) {
    return "inbound";
  }
  // Minority raise or JV partnership → outbound exploration.
  if (interests.includes("minority_investment") || interests.includes("jv_partnership") || interests.length > 0) {
    return "outbound";
  }
  return "none";
}

/**
 * Derive a strict, redaction-safe M&A intelligence record from the REAL stored
 * Step 4 fields. Returns null when the company has no stored M&A profile, so
 * the aggregation EXCLUDES it (no zero-padding of the scope).
 */
export function deriveMaIntelFromProfile(companyId: string): DerivedMaIntel | null {
  const profile = readStoredCompanyProfile(companyId);
  if (!profile) return null;
  const ma = profile.ma;
  // Treat a profile that has never been touched at Step 4 (no priorities AND no
  // transaction interests AND empty narrative) as "no M&A data" -> excluded.
  const hasAnyStep4 =
    (ma.strategicPriorities?.length ?? 0) > 0 ||
    (ma.transactionInterests?.length ?? 0) > 0 ||
    (ma.operatingGeographies?.length ?? 0) > 0 ||
    (ma.maReadinessNarrative?.trim().length ?? 0) > 0 ||
    ma.hasFormalBoard || ma.isFinanciallyAudited || ma.holdsMaterialIp;
  if (!hasAnyStep4) return null;

  const readiness = computeMaReadinessScore(ma);
  const maScore = clamp100(readiness.score);

  // Map readiness sub-components to the documented sub-dimensions transparently.
  const byLabel = new Map(readiness.components.map((c) => [c.label, c]));
  const pct = (label: string): number => {
    const c = byLabel.get(label);
    if (!c || c.weight <= 0) return 0;
    return clamp100((Math.min(c.weight, c.awarded) / c.weight) * 100);
  };

  const governancePct = pct("Governance");
  const riskPct = pct("Risk posture");
  const marketPct = pct("Market presence");
  const strategicPct = pct("Strategic clarity");
  const narrativePct = pct("Narrative");

  return {
    companyId,
    maScore,
    // Acquirer-fit proxy weights governance + risk + market readiness.
    acquirerFitScore: clamp100(governancePct * 0.4 + riskPct * 0.3 + marketPct * 0.3),
    intentSignal: deriveIntentSignal(ma),
    productMarketFit: clamp100(strategicPct * 0.5 + marketPct * 0.5),
    technologyDifferentiation: clamp100(ma.holdsMaterialIp ? Math.max(60, marketPct) : marketPct),
    // customerConcentration: HIGHER is BETTER (less concentrated). Penalize >30%.
    customerConcentration: clamp100(ma.hasRevenueConcentration30Pct ? 35 : 85),
    growthRate: clamp100(strategicPct),
    marketShare: marketPct,
    managementTeamStrength: clamp100(governancePct * 0.6 + narrativePct * 0.4),
    strategicPriorities: ma.strategicPriorities ?? [],
    transactionInterests: ma.transactionInterests ?? [],
    // No buyer shortlist exists in the Step 4 schema -> never fabricate one.
    topBuyer: null,
  };
}

/**
 * Return the company's stored maReadinessNarrative (free text) or null.
 * SENSITIVE — callers MUST gate this behind maAuthzGate. Never include in
 * aggregate responses.
 */
export function readMaReadinessNarrative(companyId: string): string | null {
  const profile = readStoredCompanyProfile(companyId);
  const text = profile?.ma?.maReadinessNarrative?.trim();
  return text && text.length > 0 ? text : null;
}
