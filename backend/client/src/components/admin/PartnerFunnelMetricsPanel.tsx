/**
 * WAVE 24 · ITEM 2 — AD-4: the partner lifecycle funnel metrics.
 *
 * `GET /api/admin/partners/metrics/funnel`
 * (`server/adminPartnerLifecycleRoutes.ts:144`) — pinned by FINAL REVIEW B
 * (R-1) as having zero client callers, and re-verified at source:
 *   grep -rn "metrics/funnel" client/src --include=*.tsx --include=*.ts
 *     | grep -v __tests__   → 0 hits
 * The only other reference anywhere in the tree is a COMMENT in
 * `server/routes.ts:1004` noting that the path returns zero hits elsewhere.
 * Genuinely orphaned.
 *
 * NOTE the citation correction: FINAL REVIEW B writes the file as
 * `server/lib/adminPartnerLifecycleRoutes.ts`. It is `server/adminPartnerLifecycleRoutes.ts`
 * — one directory up. The line number (144) is exact. Recorded because a
 * mis-stated path is how a later reader concludes the endpoint does not exist.
 *
 * NO SINK — this endpoint WRITES NOTHING. Rule 2 asks me to name the sink per
 * item; for this one the honest answer is that there isn't one, and that is
 * itself the property worth protecting. Every figure is COMPUTED FROM THE LIVE
 * STORES on each request (route comment, :138-142): there is no metrics table,
 * no cache and no counter incremented at write time, because a counter is a
 * second write path that silently drifts from the rows it claims to count.
 * This panel therefore holds no state, caches no number and derives no total
 * the server did not send — adding a client-side rollup here would recreate
 * exactly the drift the server refused.
 *
 * WHY IT LIVES ON /admin/partners AND NOT A NEW ROUTE. `pendingReferrals` is
 * the SAME call that backs the AD-1 queue, so the badge can never claim a
 * number the list does not show; and `byStatus` counts the very roster this
 * page renders. Splitting them across two screens is how the two stop agreeing.
 *
 * NO MONEY on this panel — these are counts and seats. Nothing to format with
 * `formatMinor`, and deliberately nothing to sum across currencies.
 *
 * FAIL-CLOSED (Rule 5). On failure this renders `LoadFailedRefusal`. It never
 * renders 0 partners, 0 seats or an empty funnel for a failed fetch — a zero
 * funnel and an unmeasured funnel are different claims, which is the same
 * defect FINAL REVIEW B filed as F-1 against the queue KPIs.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

/* Response shape read at source, server/adminPartnerLifecycleRoutes.ts:178-188. */
type FunnelResponse = {
  ok: boolean;
  computedAt: string;
  totalPartners: number;
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  seatsUsed: number;
  /** Sum of seat limits for partners that HAVE one. Partners with a null limit
      contribute nothing, so this is a floor, not a cap on the platform. */
  seatsLimit: number;
  pendingReferrals: number;
};

function Stat({ label, value, testId, hint }: { label: string; value: string; testId: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3" data-testid={testId}>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="block text-base font-semibold">{value}</span>
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function PartnerFunnelMetricsPanel() {
  const q = useQuery<FunnelResponse>({
    queryKey: ["/api/admin/partners/metrics/funnel"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/partners/metrics/funnel")).json(),
    retry: false,
  });

  const d = q.data ?? null;
  const statusRows = d ? Object.entries(d.byStatus) : [];
  const tierRows = d ? Object.entries(d.byTier) : [];

  return (
    <Card className="mt-4" data-testid="card-partner-funnel-metrics">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#041e41]" /> Lifecycle funnel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isError ? (
          <LoadFailedRefusal
            what="the partner lifecycle metrics"
            onRetry={() => q.refetch()}
            isRetrying={q.isFetching}
            testId="partner-funnel-load-failed"
          />
        ) : !q.isSuccess ? (
          /* isSuccess, not !isLoading && !isError: a PAUSED query is neither,
             and would otherwise render a confident zero funnel to someone who
             is merely offline. */
          <span className="block text-sm text-muted-foreground" data-testid="text-partner-funnel-loading">
            Loading lifecycle metrics…
          </span>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Partners" value={String(d?.totalPartners ?? 0)} testId="stat-funnel-total-partners" />
              <Stat label="Seats used" value={String(d?.seatsUsed ?? 0)} testId="stat-funnel-seats-used" />
              <Stat
                label="Seats limit"
                value={String(d?.seatsLimit ?? 0)}
                testId="stat-funnel-seats-limit"
                hint="Partners with no seat limit contribute nothing to this figure."
              />
              <Stat label="Pending referrals" value={String(d?.pendingReferrals ?? 0)} testId="stat-funnel-pending-referrals" />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <span className="mb-1 block text-xs font-medium">By status</span>
                {statusRows.length === 0 ? (
                  <span className="block text-xs text-muted-foreground" data-testid="text-funnel-status-empty">
                    No partners are on the roster, so there is no status breakdown.
                  </span>
                ) : (
                  <ul className="space-y-0.5 text-xs" data-testid="list-funnel-by-status">
                    {statusRows.map(([k, v]) => (
                      <li className="flex justify-between" key={k} data-testid={`funnel-status-${k}`}>
                        <span className="font-mono">{k}</span>
                        <span className="font-medium">{v}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium">By tier</span>
                {tierRows.length === 0 ? (
                  <span className="block text-xs text-muted-foreground" data-testid="text-funnel-tier-empty">
                    No partners are on the roster, so there is no tier breakdown.
                  </span>
                ) : (
                  <ul className="space-y-0.5 text-xs" data-testid="list-funnel-by-tier">
                    {tierRows.map(([k, v]) => (
                      <li className="flex justify-between" key={k} data-testid={`funnel-tier-${k}`}>
                        {/* The server labels an absent tier `unassigned`, NOT a
                            default tier. Rendered verbatim so the gap stays
                            visible instead of being tidied into a real tier. */}
                        <span className="font-mono">{k}</span>
                        <span className="font-medium">{v}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <span className="block text-[10px] text-muted-foreground" data-testid="text-funnel-computed-at">
              {`Computed from the live stores at ${d?.computedAt ?? "—"}. There is no metrics table and no cached counter behind these numbers.`}
            </span>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default PartnerFunnelMetricsPanel;
