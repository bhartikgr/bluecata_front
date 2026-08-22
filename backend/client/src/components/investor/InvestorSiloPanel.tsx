/**
 * WAVE 18 — ORP-040 (DEF-040): the orphaned investor read surface.
 *
 * WHAT WAS WRONG, verified at source before this file existed. Four live,
 * `requireAuth`-gated, session-scoped investor endpoints had ZERO client callers.
 * `grep -rn "investor/watchlist\|investor/discover\|investor/activity\|investor/soft-circles" client/src`
 * matched nothing outside a comment in App.tsx. So this item is **WIRING** — no
 * route and no store method was created for it.
 *
 *   GET /api/investor/watchlist     server/routes.ts:2748  (soft-circled rounds)
 *   GET /api/investor/discover      server/routes.ts:2776  (open + invited rounds)
 *   GET /api/investor/activity      server/routes.ts:2853  (commits + soft circles)
 *   GET /api/investor/soft-circles  server/routes.ts:2704  (this investor's rows)
 *
 * MONEY. Every amount rendered here is an INTEGER MINOR-UNIT value passed through
 * `formatMinor` (client/src/lib/currency.ts:102), which uses the currency's
 * ISO-4217 exponent. There is no `/100` anywhere in this file and there must never
 * be one: a JPY row (exponent 0) would be divided by a hundred and a KWD row
 * (exponent 3) multiplied by ten.
 *
 * The minor-unit fields did not previously exist on these projections — the
 * watchlist and soft-circle rows exposed only a MAJOR-unit float `amount`, and the
 * activity feed exposed a decimal STRING with no currency at all. Wave 18 added
 * `amountMinor` / `targetAmountMinor` / `currency` to the four projections
 * (additively; `amount` is untouched for existing server-side callers) so that this
 * surface never re-derives money from a float. See server/routes.ts:2722, :2762,
 * :2797, :2870.
 *
 * NEVER SUMMED ACROSS CURRENCIES. The watchlist total is grouped by currency, the
 * way the server groups elsewhere in this codebase. Two rows in two currencies
 * produce two totals, not one meaningless number.
 *
 * FAIL-CLOSED STATES ARE RENDERED, NOT HIDDEN. A row whose amount is `null`
 * (unpriced soft circle, a round with no target, a ledger value too precise for its
 * currency to represent) renders the words "Amount not set", never a fabricated
 * `$0.00`. Each of the four endpoints answers `[]` on an internal read failure, so
 * an empty list is genuinely ambiguous between "nothing yet" and "read failed";
 * the copy says "None yet" and does not claim more than it knows.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { formatMinor } from "@/lib/currency";
/* WAVE 90 · ITEM 3 (M-3) — raw `rnd_…` ids and raw state enums were rendered as
   this panel's primary labels. `displayName` prefers the name the server now
   projects and DESCRIBES the row when there is none (Wave 83's `u_redeemed_...`
   -> "Redeemed holder" precedent); it never prints any part of an id. */
import { displayName, decisionStateLabel } from "@shared/investorDisplayLabels";

/** Mirrors the projection at server/routes.ts:2758. */
export interface WatchlistItem {
  roundId: string;
  /** WAVE 90 · ITEM 3 — human round name, projected by server/routes.ts. */
  roundName?: string | null;
  companyId: string | null;
  amount: number | null;
  amountMinor: number | null;
  currency: string | null;
  addedAt: string | null;
}

/** Mirrors the projection at server/routes.ts:2790. */
export interface DiscoverItem {
  id: string;
  companyId: string | null;
  name: string | null;
  status: string;
  targetAmount: number | null;
  targetAmountMinor: number | null;
  currency: string | null;
  invited: boolean;
}

/** Mirrors the projection at server/routes.ts:2885. */
export interface ActivityEvent {
  ts: string;
  kind: string;
  roundId?: string;
  /** WAVE 90 · ITEM 3 — human round name, projected by server/routes.ts. */
  roundName?: string | null;
  companyId?: string;
  amount?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
}

/** Mirrors the projection at server/routes.ts:2710. */
export interface SoftCircleItem {
  id: string;
  roundId: string;
  /** WAVE 90 · ITEM 3 — human round name, projected by server/routes.ts. */
  roundName?: string | null;
  companyId: string | null;
  amount: number | null;
  amountMinor: number | null;
  currency: string | null;
  state: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  wireFundedAt: string | null;
}

export const AMOUNT_NOT_SET_COPY = "Amount not set";

/**
 * The ONLY money renderer in this file. Refuses to invent a number: a missing
 * minor value or a missing currency yields copy, not a zero.
 */
export function renderAmount(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return AMOUNT_NOT_SET_COPY;
  if (!currency) return AMOUNT_NOT_SET_COPY;
  return formatMinor(minor, currency);
}

/**
 * Group minor-unit amounts by currency. Rows without a currency or without a
 * minor amount are EXCLUDED from every total (they are shown individually as
 * "Amount not set"), because folding them in as zero would understate the total
 * while looking authoritative.
 */
export function totalsByCurrency(
  rows: ReadonlyArray<{ amountMinor: number | null; currency: string | null }>,
): Array<{ currency: string; minor: number }> {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.amountMinor !== "number" || !Number.isFinite(r.amountMinor)) continue;
    if (!r.currency) continue;
    acc.set(r.currency, (acc.get(r.currency) ?? 0) + r.amountMinor);
  }
  /* Array.from — a spread over `.entries()` raises TS2802 under this tsconfig. */
  return Array.from(acc.entries())
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const ACTIVITY_KIND_COPY: Record<string, string> = {
  "softcircle.added": "Soft-circle recorded",
  "captable.committed": "Cap-table commitment",
  "captable.pending": "Cap-table commitment pending",
  "captable.commit": "Cap-table commitment",
};

export function activityLabel(kind: string): string {
  return ACTIVITY_KIND_COPY[kind] ?? kind;
}

function shortTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().slice(0, 10);
}

export function InvestorSiloPanel() {
  const watchlistQ = useQuery<WatchlistItem[]>({
    queryKey: ["/api/investor/watchlist"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/watchlist")).json(),
    retry: false,
  });
  const discoverQ = useQuery<DiscoverItem[]>({
    queryKey: ["/api/investor/discover"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/discover")).json(),
    retry: false,
  });
  const activityQ = useQuery<ActivityEvent[]>({
    queryKey: ["/api/investor/activity"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/activity")).json(),
    retry: false,
  });
  const softCirclesQ = useQuery<SoftCircleItem[]>({
    queryKey: ["/api/investor/soft-circles"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/soft-circles")).json(),
    retry: false,
  });

  const watchlist = Array.isArray(watchlistQ.data) ? watchlistQ.data : [];
  const discover = Array.isArray(discoverQ.data) ? discoverQ.data : [];
  const activity = Array.isArray(activityQ.data) ? activityQ.data : [];
  const softCircles = Array.isArray(softCirclesQ.data) ? softCirclesQ.data : [];

  const watchlistTotals = totalsByCurrency(watchlist);

  return (
    <div className="mb-6 space-y-6" data-testid="investor-silo">
      {/* ── Watchlist ─────────────────────────────────────────── */}
      <Card data-testid="card-investor-watchlist">
        <CardHeader>
          <CardTitle className="text-lg">Your watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            Rounds you have soft-circled. Amounts are your indicated interest, not a
            commitment.
          </div>
          {watchlistQ.isLoading && <Skeleton className="h-16 w-full mt-3" />}
          {!watchlistQ.isLoading && watchlist.length === 0 && (
            <div className="mt-3 text-sm text-muted-foreground" data-testid="investor-watchlist-empty">
              None yet. Soft-circle a round and it appears here.
            </div>
          )}
          {watchlist.length > 0 && (
            <>
              <ul className="mt-3 space-y-2">
                {watchlist.map((w) => (
                  <li
                    key={`${w.roundId}-${w.addedAt ?? ""}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    data-testid={`investor-watchlist-row-${w.roundId}`}
                  >
                    <span>
                      <span className="font-medium" data-round-id={w.roundId}>{displayName(w.roundName, "round", w.roundId)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        added {shortTs(w.addedAt)}
                      </span>
                    </span>
                    <span className="font-medium" data-testid={`investor-watchlist-amount-${w.roundId}`}>
                      {renderAmount(w.amountMinor, w.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-border pt-2" data-testid="investor-watchlist-totals">
                <div className="text-xs text-muted-foreground">
                  Totals are shown per currency and are never added together.
                </div>
                {watchlistTotals.map((t) => (
                  <div
                    key={t.currency}
                    className="text-sm font-semibold"
                    data-testid={`investor-watchlist-total-${t.currency}`}
                  >
                    {t.currency}: {formatMinor(t.minor, t.currency)}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Discover ──────────────────────────────────────────── */}
      <Card data-testid="card-investor-discover">
        <CardHeader>
          <CardTitle className="text-lg">Rounds open to you</CardTitle>
        </CardHeader>
        <CardContent>
          {discoverQ.isLoading && <Skeleton className="h-16 w-full" />}
          {!discoverQ.isLoading && discover.length === 0 && (
            <div className="text-sm text-muted-foreground" data-testid="investor-discover-empty">
              No open rounds are available to you right now.
            </div>
          )}
          {discover.length > 0 && (
            <ul className="space-y-2">
              {discover.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`investor-discover-row-${d.id}`}
                >
                  <span>
                    <span className="font-medium" data-round-id={d.id}>{displayName(d.name, "round", d.id)}</span>
                    {d.invited && (
                      <Badge variant="secondary" className="ml-2" data-testid={`investor-discover-invited-${d.id}`}>
                        Invited
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs">
                    <span className="mr-2 text-muted-foreground">target</span>
                    <span className="font-medium" data-testid={`investor-discover-target-${d.id}`}>
                      {renderAmount(d.targetAmountMinor, d.currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Soft circles ──────────────────────────────────────── */}
      <Card data-testid="card-investor-soft-circles">
        <CardHeader>
          <CardTitle className="text-lg">Your soft circles</CardTitle>
        </CardHeader>
        <CardContent>
          {softCirclesQ.isLoading && <Skeleton className="h-16 w-full" />}
          {!softCirclesQ.isLoading && softCircles.length === 0 && (
            <div className="text-sm text-muted-foreground" data-testid="investor-soft-circles-empty">
              You have no soft circles on record.
            </div>
          )}
          {softCircles.length > 0 && (
            <ul className="space-y-2">
              {softCircles.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`investor-soft-circle-row-${s.id}`}
                >
                  <span>
                    <span className="font-medium" data-round-id={s.roundId}>{displayName(s.roundName, "round", s.roundId)}</span>
                    {s.state && (
                      <Badge variant="outline" className="ml-2" data-state={s.state}>
                        {decisionStateLabel(s.state)}
                      </Badge>
                    )}
                    {s.wireFundedAt && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        wire funded {shortTs(s.wireFundedAt)}
                      </span>
                    )}
                  </span>
                  <span className="font-medium" data-testid={`investor-soft-circle-amount-${s.id}`}>
                    {renderAmount(s.amountMinor, s.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Activity ──────────────────────────────────────────── */}
      <Card data-testid="card-investor-activity">
        <CardHeader>
          <CardTitle className="text-lg">Your activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activityQ.isLoading && <Skeleton className="h-16 w-full" />}
          {!activityQ.isLoading && activity.length === 0 && (
            <div className="text-sm text-muted-foreground" data-testid="investor-activity-empty">
              No recorded activity yet.
            </div>
          )}
          {activity.length > 0 && (
            <ul className="space-y-2">
              {activity.map((e, i) => (
                <li
                  key={`${e.ts}-${e.kind}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`investor-activity-row-${i}`}
                >
                  <span>
                    <span className="font-medium">{activityLabel(e.kind)}</span>
                    {e.roundId && (
                      <span className="ml-2 text-xs text-muted-foreground" data-round-id={e.roundId}>{displayName(e.roundName, "round", e.roundId)}</span>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">{shortTs(e.ts)}</span>
                  </span>
                  <span className="font-medium" data-testid={`investor-activity-amount-${i}`}>
                    {renderAmount(e.amountMinor, e.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default InvestorSiloPanel;
