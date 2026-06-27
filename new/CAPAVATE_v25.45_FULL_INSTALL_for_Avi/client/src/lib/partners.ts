/**
 * Capavate Collective consortium partner directory.
 *
 * v25.28 Phase E — client bundle scrub.
 * --------------------------------------
 * BEFORE v25.28: this file shipped 27 real firm names + URLs in the
 * production JS bundle even though the live render path was gated to
 * always return an empty list. GPT-5.5's v25.27 audit flagged this as
 * source/bundle hygiene (not a live data leak, but still uneeded data
 * download for every user).
 *
 * AFTER v25.28: CONSORTIUM_PARTNERS ships as the empty array. The type
 * definitions, helper signatures, and tests remain unchanged. Test fixtures
 * that previously relied on the 27 firms in dev/__DEMO_SEED_PARTNERS__
 * mode now have to seed their own data inline.
 *
 * Future wave (v25.29+): admin-controllable directory served from a new
 * server-side route that founders/admins can fetch on demand. Until then,
 * no consortium-partner picker renders any firm name.
 *
 * DO NOT add an ungated render of CONSORTIUM_PARTNERS in any consumer.
 * DO NOT re-add hardcoded firm data here — push it to the server. */

export type Region = "US" | "CA" | "UK" | "SG" | "HK" | "CN" | "IN" | "JP" | "AU";
export type PartnerType = "law" | "accounting" | "incubator" | "accelerator";

export interface ConsortiumPartner {
  id: string;
  region: Region;
  firmName: string;
  type: PartnerType;
  description: string;
  regionalSpecialty: string;
  url: string;
  slaBusinessDays: number;
  /**
   * Sprint 16 A3 — portfolio gating.
   *
   * Partners are visible in any directory only if they currently have at
   * least one Capavate-side portfolio company. Empty/missing array → the
   * partner is hidden from founders, investors, admins, term-sheet picker,
   * and profile sidebars.
   */
  portfolioCompanies?: string[];
}

/**
 * Patch v4 — Portfolio-companies gating values.
 *
 * In production builds these are EMPTY ARRAYS so the registry is hidden
 * from all founders/investors/admins until the real Capavate Collective
 * directory is wired up.
 *
 * In dev / test (VITE_ENABLE_DEMO_SEED="1" or vitest/node test env) the
 * two seeded portfolio bindings remain so unit tests that exercise the
 * gating rule keep passing.
 *
 * The leak strings only exist inside this guarded block; in production
 * bundles esbuild's dead-code elimination drops the entire ternary's
 * "else" branch and replaces the literals with the empty arrays.
 */
const __DEMO_SEED_PARTNERS__: boolean =
  // Browser bundle: only true when explicitly opted in AND not in prod.
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { MODE?: string; VITE_ENABLE_DEMO_SEED?: string } }).env?.MODE !== "production" &&
    (import.meta as { env?: { MODE?: string; VITE_ENABLE_DEMO_SEED?: string } }).env?.VITE_ENABLE_DEMO_SEED === "1") ||
  // Vitest / node test env (ssr) — process.env is defined.
  (typeof process !== "undefined" && process.env?.NODE_ENV === "test");

/* v25.28 Phase E — hardcoded firm directory removed from the bundle.
 *
 * Previously this file shipped 27 firms (US/CA/UK/SG/HK/CN/IN/JP/AU) with
 * firmName, URL, and regional specialty strings to every visitor's browser,
 * even though the production gate (`portfolioCompanies.length > 0`) prevented
 * any of them from rendering. Removed entirely. The empty array preserves
 * the export shape, type guards, helper signatures, and test fixtures.
 *
 * If/when admins want to publish a real consortium directory, a future wave
 * should add a server-side `consortium_partners` table + admin CRUD endpoints,
 * and this client file should fetch on demand via a React Query hook. */
export const CONSORTIUM_PARTNERS: ConsortiumPartner[] = [];

/**
 * v25.24 NC-3 fix — second-pass discovered that the v25.23 NC-C scrub of
 * `lib/partners.ts` only emptied `portfolioCompanies` (which feeds the
 * unused `visiblePartners*` helpers) and dead-coded the TermSheet `slice(0,6)`
 * fallback. The REAL leak in `client/src/pages/founder/TermSheet.tsx:917`
 * was the primary `partnersByRegion(region).map(...)` render — which
 * filtered by region only, ignoring `portfolioCompanies`. So all 27
 * hardcoded unconfirmed-membership firms continued to render to founders
 * in production.
 *
 * The fix: change `partnersByRegion` to require `portfolioCompanies.length > 0`,
 * matching the gating semantics the docstring already claims. In production
 * (`portfolioCompanies = []` per the demo-gate), this returns an empty array,
 * and the TermSheet empty-state copy fires instead. In dev / test
 * (`__DEMO_SEED_PARTNERS__ === true`), the two seeded firms remain visible
 * so unit tests that exercise the gate keep passing.
 */
export function partnersByRegion(region: Region): ConsortiumPartner[] {
  return CONSORTIUM_PARTNERS.filter(
    p =>
      p.region === region &&
      Array.isArray(p.portfolioCompanies) &&
      p.portfolioCompanies.length > 0,
  );
}

export function partnerById(id: string): ConsortiumPartner | undefined {
  return CONSORTIUM_PARTNERS.find(p => p.id === id);
}

/**
 * Sprint 16 A3 — portfolio gating rule.
 *
 * Filter the partner list to those who hold at least one ACTIVE Capavate
 * company. Apply this everywhere partners surface (founder Round wizard,
 * admin partner directory, term-sheet partner picker, profile sidebars).
 *
 * @param activeCapavateCompanyIds  Currently-active Capavate company IDs.
 *                                  When a company exits, callers should pass
 *                                  the new (post-exit) list — partners whose
 *                                  only co was that company will fall off.
 */
export function visiblePartners(activeCapavateCompanyIds: string[]): ConsortiumPartner[] {
  const active = new Set(activeCapavateCompanyIds);
  return CONSORTIUM_PARTNERS.filter(p =>
    p.portfolioCompanies?.some(cid => active.has(cid)) ?? false
  );
}

export function visiblePartnersByRegion(region: Region, activeCapavateCompanyIds: string[]): ConsortiumPartner[] {
  return visiblePartners(activeCapavateCompanyIds).filter(p => p.region === region);
}

export const REGIONS_LIST: Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"];
