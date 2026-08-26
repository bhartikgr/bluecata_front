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
import { MONEY_NOT_ON_RECORD } from "./currency";

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

/**
 * WAVE 152 · ITEM G · G-C10 (R95, R104 item 3, R115.2 #6).
 *
 * WAS: `capavate_annual: { price_minor: 84000, currency: "USD", display:
 * "$840/year per company" }` and `academy_one_time: { price_minor: 150000, …
 * display: "$1,500 one-time" }` — two PRICES COMPILED INTO THE CLIENT BUNDLE,
 * on the public marketing homepage, described by their own comment as a feature
 * ("degrades to exactly what visitors saw before").
 *
 * That is the defect R95 names. If `/api/pricing-public` fails — or worse, if an
 * administrator lowers the Capavate annual price and the endpoint is briefly
 * unreachable — the homepage kept ADVERTISING $840/year and $1,500 to the public
 * with no indication the number was stale. A prospective customer cannot tell a
 * cached bundle from a current price, and neither can the admin who changed it.
 * Editing this file also required a deploy to correct a price, which is exactly
 * the coupling the pricing model exists to remove.
 *
 * NOW: the fallback carries NO AMOUNT. `price_minor` and `currency` are
 * `undefined` and `display` is the platform's one agreed absence wording (see
 * client/src/lib/currency.ts:108). A visitor sees that the price is not on
 * record, which is TRUE, instead of a number that may not be. The two entries
 * that were never amounts — `investors_free` and `partners_custom` — are
 * unchanged, because "Free. Always." and "Custom pricing" are positioning
 * statements the platform owns, not prices read from a table.
 *
 * This file is added to the wave-129 FENCED list in the same wave, so a future
 * change cannot quietly reintroduce a literal here.
 */
export const PUBLIC_PRICING_FALLBACK: PublicPricingPayload = {
  capavate_annual: { display: MONEY_NOT_ON_RECORD },
  academy_one_time: { display: MONEY_NOT_ON_RECORD },
  investors_free: { display: "Free. Always." },
  partners_custom: { display: "Custom pricing" },
  as_of: "",
};

/** Cache lifetime, in MILLISECONDS — matches the server-side cache TTL in
 *  server/publicPricingRoutes.ts. WAVE 152 · ITEM G · G-C10: named rather than
 *  written inline because this file is now inside the wave-129 money-literal
 *  fence, and a duration should not have to be excused by a mute in that fence.
 *  A named millisecond constant cannot be mistaken for a price by a reader or by
 *  the fence. NOT MONEY. */
const PUBLIC_PRICING_STALE_MS = 5 * 60 * 1000;

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
    staleTime: PUBLIC_PRICING_STALE_MS,
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
