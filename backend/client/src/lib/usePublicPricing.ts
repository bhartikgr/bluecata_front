/**
 * client/src/lib/usePublicPricing.ts — D2.5 Slice 2 (Dynamic public pricing).
 *
 * Single React Query hook backing the marketing homepage's pricing section
 * (PricingSection.jsx) and Academy pricing card (LearnSection.jsx). Both
 * previously hardcoded "$840" / "$1,500" directly in JSX — this hook is the
 * one place that now talks to the new public endpoint, so both components
 * (and any future ones) stay in sync automatically.
 *
 * Endpoint: GET /api/pricing-public — no auth, server-cached 5 minutes.
 * See server/publicPricingRoutes.ts.
 *
 * Explicitly uses a bare `fetch`, NOT `apiRequest`/`getQueryFn` from
 * lib/queryClient.ts — those helpers assume `credentials: "include"` and
 * route 401s through session-redirect handling, which is correct for the
 * authenticated app but wrong for a public, logged-out marketing page (we
 * never want an anonymous homepage visitor's fetch failure to trigger a
 * `/login` redirect). Kept intentionally simple and self-contained.
 */
import { useQuery } from "@tanstack/react-query";

export interface PublicPriceEntry {
  price_minor?: number;
  currency?: string;
  display: string;
}

export interface PublicPricingPayload {
  capavate_annual: PublicPriceEntry;
  academy_one_time: PublicPriceEntry;
  investors_free: PublicPriceEntry;
  partners_custom: PublicPriceEntry;
  as_of: string;
}

/** Static fallback — identical to the values this slice removed from the
 *  JSX, so a fetch failure degrades to exactly what visitors saw before
 *  this change shipped. Failure is logged via console.error per spec. */
export const PUBLIC_PRICING_FALLBACK: PublicPricingPayload = {
  capavate_annual: { price_minor: 84000, currency: "USD", display: "$840/year per company" },
  academy_one_time: { price_minor: 150000, currency: "USD", display: "$1,500 one-time" },
  investors_free: { display: "Free. Always." },
  partners_custom: { display: "Custom pricing" },
  as_of: "",
};

async function fetchPublicPricing(): Promise<PublicPricingPayload> {
  const res = await fetch("/api/pricing-public");
  if (!res.ok) {
    throw new Error(`pricing-public responded ${res.status}`);
  }
  return (await res.json()) as PublicPricingPayload;
}

export function usePublicPricing() {
  const query = useQuery<PublicPricingPayload>({
    queryKey: ["/api/pricing-public"],
    queryFn: fetchPublicPricing,
    staleTime: 5 * 60 * 1000, // matches server cache TTL
    retry: 1,
  });

  if (query.isError) {
    // eslint-disable-next-line no-console
    console.error("[usePublicPricing] failed to fetch /api/pricing-public, falling back to static pricing:", query.error);
  }

  return {
    ...query,
    /** Always-safe value to render: live data, else the static fallback. */
    data: query.data ?? (query.isError ? PUBLIC_PRICING_FALLBACK : undefined),
    isFallback: query.isError,
  };
}
