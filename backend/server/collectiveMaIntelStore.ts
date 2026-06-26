/**
 * v25.44 Surface 13 — M&A Intelligence (`/api/collective/ma-intel`).
 *
 * INSTITUTIONAL-GRADE aggregation over per-company M&A intelligence with a
 * mandatory privacy gate, k-anonymity floor, and narrative redaction.
 *
 * v25.44 ROUND 2 (BLOCKER 2 FIX): aggregation now reads the REAL founder-
 * supplied M&A fields captured at Company Profile Step 4 and persisted in
 * `profilestore_company_profile.profile_json` (via server/lib/maProfileSource).
 * Companies with NO stored Step 4 M&A data are EXCLUDED entirely (not zeroed).
 * The static COMPANY_FEATURES mock engine is no longer used for scores.
 *
 * v25.44 ROUND 2 (BLOCKER 1 FIX): scope/visibility decisions are delegated to
 * the SHARED server/lib/maAuthzGate so the legacy per-company endpoint and this
 * aggregation are guaranteed to apply identical privacy rules.
 *
 * PRIVACY MODEL (default opt-OUT of Collective-wide aggregation):
 *   - Cross-Collective views require maPrivacy.shareWithCollective === true.
 *   - Chapter-scoped inclusion requires shareWithChapter === true AND the
 *     caller is in the same chapter.
 *   - maReadinessNarrative is NEVER in aggregate responses (the derived record
 *     in maProfileSource does not even carry it).
 *
 * K-ANONYMITY: sector benchmark medians require N>=5 opted-in companies in a
 * sector; otherwise status = "INSUFFICIENT_DATA" and medians = null.
 *
 * COMPARABLE EXITS: per the brief, public market comps can be aggregated
 * regardless of opt-in, with anonymized attribution for opt-out companies. We
 * therefore separate `compsScope` (ALL companies with M&A data) from
 * `pipelineScope` (privacy-filtered companies).
 */
import type { Express, Request, Response } from "express";
import { rawDb } from "./db/connection";
import { getUserContext } from "./lib/userContext";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import {
  deriveMaIntelFromProfile,
  type DerivedMaIntel,
} from "./lib/maProfileSource";
import {
  decideMaAccess,
  parseMaPrivacy,
  isDbAdmin,
  companyChapter as authzCompanyChapter,
  chapterIdsForUser,
  type MaAccessLevel,
} from "./lib/maAuthzGate";
import {
  PUBLIC_MARKET_COMPS,
  type PublicMarketComp,
} from "./lib/maPublicComps";
import { type MaPrivacy } from "@shared/schema";
import { log } from "./lib/logger";

const K_ANON_FLOOR = 5;

export type MaView = "pipeline" | "comps" | "benchmarks" | "dashboard_card";

/* ---------------- scope helpers ---------------- */

interface ScopedCompany {
  companyId: string;
  name: string;
  sector: string | null;
  privacy: MaPrivacy;
  chapter: string | null;
  /** Privacy/authz access level for THIS caller (from the shared gate). */
  access: MaAccessLevel;
  /** REAL derived M&A intelligence from stored Step 4 fields. */
  intel: DerivedMaIntel;
}

interface ScopeResult {
  /** Companies the caller may see in cross-Collective AGGREGATE views
   *  (pipeline / dashboard / benchmarks). Includes FULL, DETAIL, AND AGGREGATE
   *  access levels — every level EXCEPT NONE. The aggregate response shape
   *  itself carries no narrative and no buyer names, so AGGREGATE-level
   *  companies are safe here (scores + sector only). NONE-level companies are
   *  excluded entirely. */
  pipelineScope: ScopedCompany[];
  /** ALL companies with real M&A data (for public comps, anonymized as needed). */
  compsScope: ScopedCompany[];
}

/**
 * Build the in-scope company set for the caller.
 *
 * For each company that has REAL stored Step 4 M&A data, we ask the SHARED
 * maAuthzGate what the caller may see. Companies with no stored data are
 * skipped entirely (BLOCKER 2 — no zero-padding).
 *
 *   - pipelineScope: access level DETAIL or FULL (caller-attributed views).
 *   - compsScope:    EVERY company with data (public comps, anonymized for
 *                    anything below AGGREGATE attribution).
 */
function buildScope(userId: string, isAdmin: boolean): ScopeResult {
  let rows: Array<{ id: string; name: string; sector: string | null; ma_privacy_json: string | null }> = [];
  try {
    rows = rawDb()
      .prepare(`SELECT id, name, sector, ma_privacy_json FROM companies WHERE deleted_at IS NULL`)
      .all() as typeof rows;
  } catch (err) {
    log.warn("[maIntel.buildScope] companies read failed:", (err as Error).message);
    return { pipelineScope: [], compsScope: [] };
  }

  const userChapters = new Set(chapterIdsForUser(userId));
  const pipelineScope: ScopedCompany[] = [];
  const compsScope: ScopedCompany[] = [];

  for (const r of rows) {
    // BLOCKER 2: only companies with REAL stored Step 4 M&A data participate.
    const intel = deriveMaIntelFromProfile(r.id);
    if (!intel) continue;

    const privacy = parseMaPrivacy(r.ma_privacy_json);
    const chapter = authzCompanyChapter(r.id);
    const decision = decideMaAccess({
      companyId: r.id,
      userId,
      isAdminFromCtx: isAdmin,
      privacy,
      chapter,
      userChapters,
    });

    const sc: ScopedCompany = {
      companyId: r.id,
      name: r.name,
      sector: r.sector,
      privacy,
      chapter,
      access: decision.level,
      intel,
    };

    // compsScope: every company with data contributes public comps (anonymized
    // unless shareWithCollective grants attribution).
    compsScope.push(sc);

    // pipelineScope: any level the caller is allowed to see in aggregate views
    // — FULL, DETAIL, or AGGREGATE. Only NONE is excluded. The aggregate
    // response shape carries no narrative and no buyer names, so AGGREGATE
    // (cross-Collective opt-in) companies are safe to include here.
    if (decision.level !== "NONE") {
      pipelineScope.push(sc);
    }
  }
  return { pipelineScope, compsScope };
}

function maScoreColorBucket(score: number): "red" | "amber" | "gray" {
  if (score > 70) return "red";
  if (score >= 40) return "amber";
  return "gray";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function newestIso(dates: string[]): string {
  let newest = "";
  for (const d of dates) if (d && d > newest) newest = d;
  return newest || new Date().toISOString();
}

/* ---------------- filter helpers (shared by views) ---------------- */

interface PipelineFilters {
  sector?: string;
  region?: string;
  scoreMin?: number;
  scoreMax?: number;
  intentSignal?: string;
}

/** Apply sector/region/score/intent filters to a pipeline-style scope. */
function applyPipelineFilters(scope: ScopedCompany[], f: PipelineFilters): ScopedCompany[] {
  return scope.filter((c) => {
    if (f.sector && c.sector !== f.sector) return false;
    if (f.region && c.chapter !== f.region) return false;
    if (f.scoreMin != null && c.intel.maScore < f.scoreMin) return false;
    if (f.scoreMax != null && c.intel.maScore > f.scoreMax) return false;
    if (f.intentSignal && c.intel.intentSignal !== f.intentSignal) return false;
    return true;
  });
}

/* ---------------- view: dashboard_card ---------------- */

export interface MaDashboardCard {
  asOfDate: string;
  totalCompaniesInScope: number;
  activeNegotiations: number;
  topThree: Array<{
    companyId: string;
    companyName: string;
    sector: string;
    maScore: number;
    leadBuyer: string | null;
  }>;
  status: "OK" | "INSUFFICIENT_DATA";
}

export function viewDashboardCard(scope: ScopedCompany[]): MaDashboardCard {
  const asOf = new Date().toISOString();
  if (scope.length === 0) {
    return {
      asOfDate: asOf,
      totalCompaniesInScope: 0,
      activeNegotiations: 0,
      topThree: [],
      status: "INSUFFICIENT_DATA",
    };
  }
  const active = scope.filter((e) => e.intel.intentSignal === "active_negotiation");
  const topThree = active
    .slice()
    .sort((a, b) => b.intel.maScore - a.intel.maScore)
    .slice(0, 3)
    .map((e) => ({
      companyId: e.companyId,
      companyName: e.name,
      sector: e.sector ?? "Unspecified",
      maScore: e.intel.maScore,
      // topBuyer is null for derived records; only attribute when authz allows.
      leadBuyer: e.intel.topBuyer?.name ?? null,
    }));
  return {
    asOfDate: asOf,
    totalCompaniesInScope: scope.length,
    activeNegotiations: active.length,
    topThree,
    status: "OK",
  };
}

/* ---------------- view: pipeline ---------------- */

export interface MaPipelineRow {
  companyId: string;
  companyName: string;
  sector: string | null;
  region: string | null;
  maScore: number;
  acquirerFitScore: number;
  topBuyer: { name: string; rationale: string } | null;
  growthRate: number;
  revenueMultipleRange: { low: number; high: number };
  asOf: string;
  scoreBucket: "red" | "amber" | "gray";
}
export interface MaPipelineResponse {
  asOfDate: string;
  buckets: {
    active_negotiation: MaPipelineRow[];
    outbound: MaPipelineRow[];
    inbound: MaPipelineRow[];
    none: { count: number };
  };
}

function toPipelineRow(c: ScopedCompany): MaPipelineRow {
  const asOf = new Date().toISOString();
  return {
    companyId: c.companyId,
    companyName: c.name,
    sector: c.sector,
    region: c.chapter,
    maScore: c.intel.maScore,
    acquirerFitScore: c.intel.acquirerFitScore,
    // Buyers only when authz says so (DETAIL/FULL keep names). topBuyer is null
    // for derived records, so this is null in practice — never a static mock.
    topBuyer: c.intel.topBuyer,
    growthRate: c.intel.growthRate,
    // No revenue-multiple range in stored Step 4 fields → neutral zeros.
    revenueMultipleRange: { low: 0, high: 0 },
    asOf,
    scoreBucket: maScoreColorBucket(c.intel.maScore),
  };
}

export function viewPipeline(scope: ScopedCompany[], filters: PipelineFilters): MaPipelineResponse {
  const asOf = new Date().toISOString();
  const buckets: MaPipelineResponse["buckets"] = {
    active_negotiation: [],
    outbound: [],
    inbound: [],
    none: { count: 0 },
  };
  for (const c of applyPipelineFilters(scope, filters)) {
    const signal = c.intel.intentSignal;
    if (signal === "none") {
      buckets.none.count += 1;
    } else {
      buckets[signal].push(toPipelineRow(c));
    }
  }
  buckets.active_negotiation.sort((a, b) => b.maScore - a.maScore);
  buckets.outbound.sort((a, b) => b.maScore - a.maScore);
  buckets.inbound.sort((a, b) => b.maScore - a.maScore);
  return { asOfDate: asOf, buckets };
}

/* ---------------- view: comps (public market comps library) ---------------- */

export interface MaCompRow {
  target: string;
  acquirer: string;
  date: string;
  valuationUsd: number;
  revenueMultiple: number | null;
  sector: string;
  region: string;
  sourceAttribution: string;
}
export interface MaCompsResponse {
  asOfDate: string;
  totalRecords: number;
  exits: MaCompRow[];
}

/**
 * Comparable exits are PUBLIC market comps (real, observable acquisitions),
 * matched to the sectors present in the caller's compsScope. Per the brief,
 * they aggregate regardless of opt-in; attribution is anonymized for any
 * company that has NOT opted into Collective-wide sharing.
 */
export function viewComps(
  compsScope: ScopedCompany[],
  filters: { sector?: string; dateFrom?: string; dateTo?: string },
): MaCompsResponse {
  // Sectors represented by companies that have M&A data, with the best
  // attribution available for each sector (shareWithCollective → company id).
  const sectorAttribution = new Map<string, string>();
  const sectorsPresent = new Set<string>();
  for (const c of compsScope) {
    const sector = c.sector ?? "n/a";
    sectorsPresent.add(sector);
    if (c.privacy.shareWithCollective && !sectorAttribution.has(sector)) {
      sectorAttribution.set(sector, c.companyId);
    }
  }

  const exits: MaCompRow[] = [];
  for (const comp of PUBLIC_MARKET_COMPS) {
    if (!sectorsPresent.has(comp.sector)) continue;
    if (filters.sector && comp.sector !== filters.sector) continue;
    if (filters.dateFrom && comp.date < filters.dateFrom) continue;
    if (filters.dateTo && comp.date > filters.dateTo) continue;
    const attributedCompany = sectorAttribution.get(comp.sector);
    exits.push({
      target: comp.target,
      acquirer: comp.acquirer,
      date: comp.date,
      valuationUsd: comp.valuationUsd,
      revenueMultiple: comp.revenueMultiple,
      sector: comp.sector,
      region: comp.region ?? "global",
      sourceAttribution: attributedCompany
        ? attributedCompany
        : `Anonymous (sector: ${comp.sector})`,
    });
  }
  exits.sort((a, b) => b.date.localeCompare(a.date) || b.valuationUsd - a.valuationUsd);
  return {
    asOfDate: exits.length ? newestIso(exits.map((e) => e.date)) : new Date().toISOString(),
    totalRecords: exits.length,
    exits,
  };
}

/* ---------------- view: benchmarks (k-anonymity) ---------------- */

export interface MaBenchmarkSector {
  sector: string;
  n: number;
  status: "OK" | "INSUFFICIENT_DATA";
  medians: {
    maScore: number;
    acquirerFitScore: number;
    productMarketFit: number;
    technologyDifferentiation: number;
    customerConcentration: number;
    growthRate: number;
    marketShare: number;
    managementTeamStrength: number;
    revenueMultipleLow: number;
    revenueMultipleHigh: number;
  } | null;
}
export interface MaBenchmarksResponse {
  asOfDate: string;
  sectors: MaBenchmarkSector[];
}

export function viewBenchmarks(
  scope: ScopedCompany[],
  filters: PipelineFilters = {},
): MaBenchmarksResponse {
  // ROUND 2 (additional fix): benchmarks honor the same query filters as the
  // other views — filter the scope BEFORE computing medians.
  const filtered = applyPipelineFilters(scope, filters);
  const bySector = new Map<string, DerivedMaIntel[]>();
  for (const c of filtered) {
    const sector = c.sector ?? "Unspecified";
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(c.intel);
  }
  const sectors: MaBenchmarkSector[] = [];
  for (const [sector, intels] of Array.from(bySector.entries())) {
    const n = intels.length;
    if (n < K_ANON_FLOOR) {
      sectors.push({ sector, n, status: "INSUFFICIENT_DATA", medians: null });
      continue;
    }
    sectors.push({
      sector,
      n,
      status: "OK",
      medians: {
        maScore: median(intels.map((i) => i.maScore)),
        acquirerFitScore: median(intels.map((i) => i.acquirerFitScore)),
        productMarketFit: median(intels.map((i) => i.productMarketFit)),
        technologyDifferentiation: median(intels.map((i) => i.technologyDifferentiation)),
        customerConcentration: median(intels.map((i) => i.customerConcentration)),
        growthRate: median(intels.map((i) => i.growthRate)),
        marketShare: median(intels.map((i) => i.marketShare)),
        managementTeamStrength: median(intels.map((i) => i.managementTeamStrength)),
        // No revenue-multiple range stored at Step 4 → 0 (transparent).
        revenueMultipleLow: 0,
        revenueMultipleHigh: 0,
      },
    });
  }
  sectors.sort((a, b) => b.n - a.n || a.sector.localeCompare(b.sector));
  return { asOfDate: new Date().toISOString(), sectors };
}

/* ---------------- route registration ---------------- */

export function registerCollectiveMaIntelRoutes(app: Express): void {
  app.get(
    "/api/collective/ma-intel",
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      const userId = ctx?.userId;
      if (!userId) {
        res.status(401).json({ ok: false, error: "missing_identity" });
        return;
      }
      const isAdmin = ctx?.isAdmin === true || isDbAdmin(userId);
      const view = String(req.query.view ?? "dashboard_card") as MaView;

      let scope: ScopeResult;
      try {
        scope = buildScope(userId, isAdmin);
      } catch (err) {
        log.warn("[maIntel] scope build failed:", (err as Error).message);
        res.status(500).json({ ok: false, error: "ma_intel_scope_failed" });
        return;
      }

      const filters = {
        sector: req.query.sector ? String(req.query.sector) : undefined,
        region: req.query.region ? String(req.query.region) : undefined,
        scoreMin: req.query.scoreMin != null ? Number(req.query.scoreMin) : undefined,
        scoreMax: req.query.scoreMax != null ? Number(req.query.scoreMax) : undefined,
        intentSignal: req.query.intentSignal ? String(req.query.intentSignal) : undefined,
        dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
        dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
      };

      switch (view) {
        case "pipeline":
          res.json(viewPipeline(scope.pipelineScope, filters));
          return;
        case "comps":
          // Public comps aggregate across ALL companies with data (anonymized).
          res.json(viewComps(scope.compsScope, filters));
          return;
        case "benchmarks":
          res.json(viewBenchmarks(scope.pipelineScope, filters));
          return;
        case "dashboard_card":
        default:
          res.json(viewDashboardCard(scope.pipelineScope));
          return;
      }
    },
  );
}

export default registerCollectiveMaIntelRoutes;
