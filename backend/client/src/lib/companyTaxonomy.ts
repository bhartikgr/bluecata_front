/**
 * client/src/lib/companyTaxonomy.ts — slide13b WAVE D.
 *
 * The ONE client read path for the DB-backed company-sector taxonomy
 * (`GET /api/company-taxonomy/company_sector`). Used by the three selectors
 * (PartnerAddPortfolioCompany, PartnerSpvEngine, ApplyToCollective) and by
 * the /admin/company-taxonomy page for invalidation.
 *
 * FRESHNESS CONTRACT (spec: "DB-direct + bounded focus/poll + real query
 * invalidation")
 *   • Every fetch reads the database through the API — no static list, no
 *     COLLECTIVE_SECTORS_45 fallback. On failure the hook reports `isError`
 *     and consumers BLOCK selection changes while KEEPING the current value.
 *   • staleTime 30s (the app default) + refetchOnWindowFocus + a 60s poll, so
 *     an admin edit is visible to an open selector within ≤ 60s or on the
 *     next focus — bounded, not "instant" and not claimed to be.
 *   • Admin mutations call `invalidateCompanyTaxonomy()` which invalidates the
 *     public key AND the admin key, so the same browser refetches at once.
 */
import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  COMPANY_SECTOR_NAMESPACE,
  type TaxonomyListResponse,
  type TaxonomyNamespace,
  type TaxonomyTermDto,
} from "@shared/companyTaxonomy";

export const COMPANY_TAXONOMY_POLL_MS = 60_000;
export const COMPANY_TAXONOMY_STALE_MS = 30_000;

export function companyTaxonomyKey(namespace: TaxonomyNamespace = COMPANY_SECTOR_NAMESPACE) {
  return ["/api/company-taxonomy", namespace] as const;
}
export function adminCompanyTaxonomyKey(namespace: TaxonomyNamespace = COMPANY_SECTOR_NAMESPACE) {
  return ["/api/admin/company-taxonomy", namespace, "all"] as const;
}

async function fetchTaxonomy(url: string): Promise<TaxonomyListResponse> {
  const r = await apiRequest("GET", url);
  const j = (await r.json()) as TaxonomyListResponse | { ok: false; error?: string; code?: string; message?: string };
  if (!j || (j as { ok: boolean }).ok !== true || !Array.isArray((j as TaxonomyListResponse).terms)) {
    const e = j as { error?: string; code?: string; message?: string };
    throw new Error(e?.message || e?.code || e?.error || "taxonomy unavailable");
  }
  return j as TaxonomyListResponse;
}

/** Active terms, alphabetical, for any authenticated persona. */
export type CompanySectorTaxonomyResult = UseQueryResult<TaxonomyTermDto[], Error> & {
  /** Every term incl. retired (active:false) — for LABELLING held values only. */
  allTerms: TaxonomyTermDto[] | undefined;
};

export function useCompanySectorTaxonomy(
  namespace: TaxonomyNamespace = COMPANY_SECTOR_NAMESPACE,
): CompanySectorTaxonomyResult {
  const q = useQuery<TaxonomyTermDto[], Error>({
    queryKey: companyTaxonomyKey(namespace),
    // Retired rows are fetched so a value a draft already holds can be shown as
    // "retired" rather than "custom"; they are NEVER offered as new choices.
    queryFn: async () => (await fetchTaxonomy(`/api/company-taxonomy/${namespace}?includeRetired=1`)).terms,
    staleTime: COMPANY_TAXONOMY_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: COMPANY_TAXONOMY_POLL_MS,
    retry: false,
  });
  // `data` = ACTIVE terms only, so every existing consumer that maps `.data`
  // to selectable options keeps offering only active sectors.
  const active = useMemo(() => q.data?.filter((t) => t.active), [q.data]);
  return { ...q, data: active, allTerms: q.data } as CompanySectorTaxonomyResult;
}

export function useAdminCompanyTaxonomy(
  namespace: TaxonomyNamespace = COMPANY_SECTOR_NAMESPACE,
): UseQueryResult<TaxonomyTermDto[], Error> {
  return useQuery<TaxonomyTermDto[], Error>({
    queryKey: adminCompanyTaxonomyKey(namespace),
    queryFn: async () =>
      (await fetchTaxonomy(`/api/admin/company-taxonomy/${namespace}?includeRetired=1`)).terms,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Real invalidation: both the public and the admin caches refetch. */
export async function invalidateCompanyTaxonomy(
  namespace: TaxonomyNamespace = COMPANY_SECTOR_NAMESPACE,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: companyTaxonomyKey(namespace) }),
    queryClient.invalidateQueries({ queryKey: adminCompanyTaxonomyKey(namespace) }),
  ]);
}

/** Copy shown by every consumer when the taxonomy cannot be read. One string, one truth. */
export const COMPANY_TAXONOMY_LOADING_COPY = "Loading sectors…";
export const COMPANY_TAXONOMY_ERROR_COPY =
  "Sector list unavailable — your current selection is kept, but it cannot be changed until the list loads. Retry or refresh.";
