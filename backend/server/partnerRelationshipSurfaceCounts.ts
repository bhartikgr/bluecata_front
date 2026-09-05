/**
 * WAVE NB-A — THE RELATIONSHIP MAP'S FOUR SUMMARY FIGURES, COUNTED FROM THE
 * SAME SOURCES THE FOUR PAGES THEMSELVES READ.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The tiles used to be counted by `surfaceBreakdown` in
 * `partnerCompanyRelationshipStore`, which reads the MATERIALISED
 * `pcr_surface_presence` spine. Migration 0136 backfilled that spine once and
 * stopped, and a forward-write helper was only ever wired to ONE surface —
 * `partnerWorkspaceStore.writeTypedAttribution`, surface `"clients"`, two call
 * sites, counted by hand and not estimated. So the clients tile was right and
 * the other three were frozen at their 0136 values for ever. A materialised
 * figure that only one of its four writers maintains is not a cache, it is a
 * second version of the truth, and the only fix that makes drift impossible
 * rather than repairable is to stop materialising it.
 *
 * ── WHY IT CALLS STORES AND NOT SQL — THE PREMISE THAT FAILED ───────────────
 * The obvious implementation was to reuse `reconcilePartner`'s own four
 * `SELECT`s. That was measured and REJECTED, because two of those four queries
 * do not read what the corresponding page reads:
 *
 *   · PIPELINE. `partnerPipelineStore.create` persists a deal through
 *     `storePersistenceShim.persistEntry("partnerPipeline", …)` — a JSON blob in
 *     `kv_partnerPipeline` — and never inserts into `partner_deal_pipeline`.
 *     The pipeline page reads `partnerPipelineStore.listByPartner`, i.e. the kv
 *     store. `partner_deal_pipeline` holds only what a one-shot backfill put
 *     there. Counting that table would have produced a figure that disagreed
 *     with the pipeline page — a NEW drift, in the wave whose whole purpose was
 *     to remove drift.
 *
 *   · PORTFOLIO. The portfolio route drops records per record through
 *     `wave230CompanyVisible`. A count straight from
 *     `partner_portfolio_company` would include companies the portfolio page
 *     deliberately does not show, so the tile would again exceed its page.
 *
 * Hence the rule this file follows: for each surface, call THE SAME function
 * the surface's own route calls, and apply the same visibility filter the route
 * applies. The tiles cannot drift from the pages because they are reading the
 * pages' own reads.
 *
 * ── THE GRAIN, STATED ───────────────────────────────────────────────────────
 * The unit is a COMPANY, not a row. The Relationship Map is one row per
 * (partner, company), so two pipeline deals with the same company are one
 * company, and a record with no company behind it is not a company relationship
 * and is not counted — the same `if (!cid) continue` rule `reconcilePartner`
 * uses. The page states this on screen; a figure whose unit is not stated is a
 * figure the reader will misread.
 *
 * ── A SURFACE THAT COULD NOT BE READ IS `null`, NEVER 0 ─────────────────────
 * Each surface is counted in its own try/catch and an exception leaves that
 * surface `null`, which the page renders as a stated read-failure. KNOWN AND
 * DECLARED LIMIT: `listPortfolioCompanies` and `partnerAttributionStore` catch
 * their own read failures internally and return an empty list, so a failure
 * INSIDE them still arrives here as a truthful-looking 0. This file cannot see
 * through that and does not pretend to; the `null` path covers failures those
 * stores propagate, and nothing more.
 *
 * NO SQL is written here, no table is created, and nothing is mutated. This is a
 * read-only derivation.
 */
import { PCR_SURFACES, type PcrSurface } from "./partnerCompanyRelationshipStore";
import { partnerPipelineStore, partnerAttributionStore } from "./partnerWorkspaceStore";
import { listPortfolioCompanies } from "./partnerPortfolioStore";
import { wave230HiddenCompanyIds, wave230CompanyVisible } from "./lib/wave230DisplayExclusion";
import { managedFounderStore } from "./managedFounderStore";
import { log } from "./lib/logger";

export type SurfaceCounts = Record<PcrSurface, number | null>;

/**
 * One reader per surface, each one the page's own read.
 *
 * `mfc`       → `managedFounderStore.listEngagements`  (GET /api/partner/me/mfcrm/engagements)
 * `pipeline`  → `partnerPipelineStore.listByPartner`   (GET /api/partner/me/pipeline)
 * `clients`   → `partnerAttributionStore.listByPartner` (GET /api/partner/me/clients)
 * `portfolio` → `listPortfolioCompanies` + the W230 per-record visibility filter
 *               (GET /api/partner/me/portfolio)
 *
 * Each returns the company ids the corresponding page would show. Deduplication
 * and the empty-id rule are applied once, below, so the four cannot disagree
 * about the grain.
 */
const SURFACE_COMPANY_READERS: Record<PcrSurface, (partnerId: string) => Array<unknown>> = {
  mfc: (partnerId) => managedFounderStore.listEngagements(partnerId).map((e) => e.companyId),
  pipeline: (partnerId) => partnerPipelineStore.listByPartner(partnerId).map((d) => d.companyId),
  clients: (partnerId) => partnerAttributionStore.listByPartner(partnerId).map((a) => a.companyId),
  portfolio: (partnerId) => {
    const hidden = wave230HiddenCompanyIds();
    return listPortfolioCompanies(partnerId)
      .filter((p) => wave230CompanyVisible(hidden, p.companyId))
      .map((p) => p.companyId);
  },
};

/**
 * Distinct companies per surface for this partner's Relationship Map tiles.
 *
 * Every surface in `PCR_SURFACES` is present in the result — a number when the
 * surface was counted, `null` when reading it threw. `null` and `0` are
 * different facts and the caller must render them differently.
 */
export function surfaceCompanyCounts(partnerId: string): SurfaceCounts {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new Error("PARTNER_ID_REQUIRED");

  const out = {} as SurfaceCounts;
  for (const surface of PCR_SURFACES) {
    out[surface] = null;
  }

  for (const surface of PCR_SURFACES) {
    try {
      const ids = SURFACE_COMPANY_READERS[surface](pid);
      const companies = new Set<string>();
      for (const raw of ids) {
        const cid = String(raw ?? "").trim();
        if (!cid) continue; /* not a company relationship — same rule reconcile uses */
        companies.add(cid);
      }
      out[surface] = companies.size;
    } catch (err) {
      /* Deliberately left null. An unreadable surface must never be reported as
         an empty one. */
      log.warn(
        `[relationshipSurfaceCounts] surface ${surface} could not be counted:`,
        (err as Error).message,
      );
    }
  }
  return out;
}
