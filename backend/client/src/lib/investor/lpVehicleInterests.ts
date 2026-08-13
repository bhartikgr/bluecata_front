/**
 * WAVE 35 · ROW 7 — the single source of truth for "does this identity hold
 * any LP interest in a vehicle?"
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ─────────────────────────────────────────
 * Two surfaces told an investor **"Your portfolio is empty"** based on a count
 * of DIRECT cap-table positions only:
 *
 *   · `client/src/components/investor/PortfolioCompanySwitcher.tsx` — which
 *     renders that sentence directly ABOVE `<LpPositions />`, so an LP could
 *     read "your portfolio is empty" and their real, funded vehicle interests
 *     in the very same viewport. A visible self-contradiction on one screen.
 *   · `client/src/components/investor/DashboardSpinePanels.tsx` — the
 *     "Portfolio standing" panel, driven by `spine.hasFundedPosition`, which is
 *     likewise cap-table-only. The dashboard has no `<LpPositions />` beneath
 *     it at all, so there the statement stands completely unqualified.
 *
 * An investor who has wired real capital into a vehicle must never be told they
 * hold nothing.
 *
 * ── WHY A SHARED HOOK AND NOT TWO LOCAL FIXES ───────────────────────────────
 * Review C found ONE instance of this message; there were two. The way to stop
 * a third appearing is for both surfaces (and any future one) to ask the same
 * question of the same endpoint through the same code, so the answer cannot
 * drift between screens. `LP_POSITIONS_QUERY_KEY` is deliberately identical to
 * the key `LpPositions` already uses, so on the Portfolio page the two
 * components share one react-query cache entry and one network request — the
 * switcher physically cannot disagree with the list rendered below it.
 *
 * ── NULLS, NOT ZEROS ────────────────────────────────────────────────────────
 * `count` is `null` whenever the answer is genuinely unknown — still loading,
 * or the request failed. It is NEVER coerced to `0`. Treating "we could not
 * ask" as "you hold nothing" is exactly the defect being fixed, one layer down.
 * Callers must render a refusal for `null`, not an empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/** Shared with `LpPositions` so both read one cache entry, never two. */
export const LP_POSITIONS_QUERY_KEY = ["/api/investor/me/lp-positions"] as const;

export interface LpVehicleInterests {
  /**
   * Number of vehicles this identity is a committed LP of.
   * `null` means UNKNOWN (loading or failed) — never assume zero.
   */
  count: number | null;
  /** True once the question has an answer, successful or not. */
  isResolved: boolean;
  /** True when the question could not be answered at all. */
  isUnavailable: boolean;
}

/**
 * The copy shown when a surface has no direct positions AND cannot determine
 * whether the identity holds vehicle interests. Exported so tests assert the
 * exact sentence rather than a substring that could drift.
 */
export const LP_INTERESTS_UNAVAILABLE_COPY =
  "We could not load your vehicle interests just now, so this view may be incomplete. Reload to try again.";

/**
 * Headline shown in place of "Your portfolio is empty" for someone who holds no
 * DIRECT cap-table position but does hold at least one vehicle interest. It is
 * accurate in both halves: it says what is absent and what is present.
 */
export const LP_ONLY_HEADLINE = "You hold no direct cap-table positions";

export function lpOnlyBody(count: number): string {
  const vehicles = count === 1 ? "1 vehicle" : `${count} vehicles`;
  return (
    `You are a committed LP in ${vehicles}. Your interest is in the vehicle, ` +
    `not directly on a company's cap table, so it is listed separately below ` +
    `rather than as a portfolio company.`
  );
}

/** Dashboard variant — that panel has no LP list beneath it to point at. */
export function lpOnlyBodyDashboard(count: number): string {
  const vehicles = count === 1 ? "1 vehicle" : `${count} vehicles`;
  return (
    `You are a committed LP in ${vehicles}. Vehicle interests are not ` +
    `cap-table holdings, so they are not counted in this panel — open your ` +
    `portfolio to see them.`
  );
}

interface LpPositionsResponse {
  positions?: unknown[];
}

export function useLpVehicleInterests(): LpVehicleInterests {
  const q = useQuery<LpPositionsResponse>({
    queryKey: LP_POSITIONS_QUERY_KEY,
    queryFn: () =>
      apiRequest("GET", "/api/investor/me/lp-positions").then((r) => r.json()),
  });

  if (q.isLoading) return { count: null, isResolved: false, isUnavailable: false };
  if (q.isError) return { count: null, isResolved: true, isUnavailable: true };

  const positions = q.data?.positions;
  if (!Array.isArray(positions)) {
    // A 200 whose shape we do not recognise is NOT evidence of zero holdings.
    return { count: null, isResolved: true, isUnavailable: true };
  }
  return { count: positions.length, isResolved: true, isUnavailable: false };
}
