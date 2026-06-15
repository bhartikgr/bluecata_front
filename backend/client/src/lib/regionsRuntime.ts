/**
 * Sprint 28 Wave 5 — Runtime regions hook.
 *
 * DO NOT modify client/src/lib/regions.ts — it remains the canonical frozen 9.
 * This module provides `useRegions()` which fetches `/api/regions` and returns
 * the merged list: canonical 9 (source:"canonical") + any live extensions
 * (source:"extension").
 *
 * Existing components continue to import from regions.ts (unchanged).
 * New region-aware components (RegionsExtensions page, etc.) use this hook.
 */

import { useQuery } from "@tanstack/react-query";

export interface RuntimeRegion {
  code: string;
  name: string;
  jurisdiction: string;
  currency: string;
  flag: string;
  source: "canonical" | "extension";
}

interface RegionsApiResponse {
  regions: RuntimeRegion[];
}

export function useRegions(): {
  regions: RuntimeRegion[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const query = useQuery<RegionsApiResponse>({
    queryKey: ["/api/regions"],
    staleTime: 60_000,   // 1 minute stale-while-revalidate
    gcTime: 5 * 60_000,  // keep in cache 5 minutes
  });

  return {
    regions: query.data?.regions ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
  };
}
