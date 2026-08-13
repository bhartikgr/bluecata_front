/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — the GP-facing NAV surface.
 *
 * Backed by:
 *   GET  /api/partner/me/spv/:spvId/nav          live derived NAV + per-LP shares
 *   GET  /api/partner/me/spv/:spvId/nav/history  the freeze series
 *   POST /api/partner/me/spv/:spvId/nav/freeze   freeze the current NAV
 *
 * AN ENGINE WITH NO ROUTE, OR A COMPONENT MOUNTED NOWHERE, IS NOT SHIPPED.
 * This panel is mounted in `SpvDetailTabs.tsx` as the NAV tab.
 *
 * THE RENDERING RULE THAT MATTERS. Anything the server could not compute
 * renders as an EXPLICIT REFUSAL with its reason, never as `$0.00` and never as
 * a dash with no explanation. A fund administrator reading "—" must be able to
 * see, on the same screen, why. That is why `refusalCopy` from the server is
 * printed verbatim rather than being re-worded here: one sentence, one source.
 *
 * MONEY IS RENDERED VIA `formatMinorOrUnavailable`, never `minor / 100` —
 * division by 100 misstates JPY (ISO-4217 exponent 0) by a factor of a hundred.
 * `null` prints the unavailable marker, so an unknown NAV cannot appear as zero.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ── wire types (mirror server/lib/spvNav.ts) ─────────────────────────────── */

interface NavHoldingLine {
  deploymentId: string;
  companyId: string;
  shares: string | null;
  costMinor: number;
  currency: string;
  fairValueMinor: number | null;
  pricePerShare: number | null;
  valuationDate: string | null;
  markBadge: string | null;
  markMethod: string | null;
  ageDays: number | null;
  refusal: string | null;
}

interface NavResult {
  spvId: string;
  asOfDate: string;
  currency: string;
  status: "complete" | "partial_unmarked" | "no_holdings" | "mixed_currency";
  totalNavMinor: number | null;
  totalCostMinor: number | null;
  worstMarkBadge: string | null;
  markedHoldings: number;
  unmarkedHoldings: number;
  holdings: NavHoldingLine[];
  thresholds: { staleWarnDays: number; staleExpiredDays: number };
  refusalCopy: string | null;
}

interface LpShare {
  investorId: string;
  commitmentMinor: number;
  navShareMinor: number | null;
}

interface FrozenNav {
  id: string;
  asOfDate: string;
  totalNavMinor: number | null;
  currency: string;
  status: string;
  worstMarkBadge: string | null;
  markedHoldings: number;
  unmarkedHoldings: number;
  staleWarnDays: number;
  staleExpiredDays: number;
  frozenBy: string;
  frozenAt: string;
  supersededAt: string | null;
}

/* ── badge rendering ──────────────────────────────────────────────────────── */

const BADGE_STYLE: Record<string, { bg: string; fg: string; label: string; help: string }> = {
  fresh: { bg: "rgba(16,122,87,0.12)", fg: "#0b6b4f", label: "Fresh mark", help: "Valued from a priced round inside the freshness window." },
  stale: { bg: "rgba(180,120,10,0.14)", fg: "#8a5a06", label: "Stale mark", help: "The underlying priced round is older than the staleness threshold." },
  expired: { bg: "rgba(170,30,30,0.12)", fg: "#9b1c1c", label: "Expired mark", help: "The underlying priced round is older than the expiry threshold. The figure is shown, badged, and should be refreshed." },
  gp_override: { bg: "rgba(4,30,65,0.10)", fg: "#041e41", label: "GP override", help: "A GP override is in force for this holding. Overrides take effect only once approved." },
};

function MarkBadge({ badge }: { badge: string | null }) {
  if (!badge) {
    return (
      <span
        className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
        style={{ background: "rgba(120,120,120,0.14)", color: "#4a4a4a" }}
        title="No valuation mark exists for this holding, so it cannot be valued. It is not counted as zero."
        data-testid="spv-nav-badge-unmarked"
      >
        Unmarked
      </span>
    );
  }
  const s = BADGE_STYLE[badge] ?? { bg: "rgba(120,120,120,0.14)", fg: "#4a4a4a", label: badge, help: badge };
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: s.bg, color: s.fg }}
      title={s.help}
      data-testid={`spv-nav-badge-${badge}`}
    >
      {s.label}
    </span>
  );
}

/* ── panel ────────────────────────────────────────────────────────────────── */

export function SpvNavPanel({ spvId, canWrite }: { spvId: string; canWrite: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [asOfDate, setAsOfDate] = useState("");

  const navQ = useQuery<{ nav: NavResult; lpShares: LpShare[]; frozen: FrozenNav | null }>({
    queryKey: ["/api/partner/me/spv", spvId, "nav"],
    queryFn: () => apiRequest("GET", `/api/partner/me/spv/${spvId}/nav`).then((r) => r.json()),
  });
  const histQ = useQuery<{ snapshots: FrozenNav[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "nav", "history"],
    queryFn: () => apiRequest("GET", `/api/partner/me/spv/${spvId}/nav/history`).then((r) => r.json()),
  });

  const freeze = useMutation({
    mutationFn: (body: { asOfDate?: string }) =>
      apiRequest("POST", `/api/partner/me/spv/${spvId}/nav/freeze`, body).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "NAV frozen", description: "The valuation as of this date has been recorded, with its staleness badge and the policy in force." });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "nav"] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "nav", "history"] });
    },
    onError: (e: any) => toast({ title: "Could not freeze NAV", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const nav = navQ.data?.nav;
  const lpShares = navQ.data?.lpShares ?? [];
  const snapshots = histQ.data?.snapshots ?? [];

  const totalDisplay = useMemo(
    () => (nav ? formatMinorOrUnavailable(nav.totalNavMinor, nav.currency) : "—"),
    [nav],
  );

  if (navQ.isLoading) {
    return <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-nav-loading">Loading NAV…</div>;
  }
  if (navQ.isError || !nav) {
    /* AN HONEST FAILURE. We do not render a zero NAV when the server could not
       be reached — a blank with a reason is the only safe thing to show. */
    return (
      <div className="text-sm" data-testid="spv-nav-error">
        NAV is unavailable because the valuation service could not be reached. No figure is shown rather than a figure that may be wrong.
      </div>
    );
  }

  return (
    <div data-testid="spv-nav-panel">
      {/* ── headline ────────────────────────────────────────────────────── */}
      <div className="rounded-md p-3 mb-3" style={{ background: "rgba(4,30,65,0.06)", border: "1px solid rgba(4,30,65,0.18)" }}>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">Net asset value</div>
          <div className="text-2xl font-semibold" data-testid="spv-nav-total">{totalDisplay}</div>
          <MarkBadge badge={nav.worstMarkBadge} />
          <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="spv-nav-asof">as of {nav.asOfDate}</div>
        </div>
        <div className="text-xs mt-1 text-[var(--cv-color-text-muted)]" data-testid="spv-nav-basis">
          Cost basis {formatMinorOrUnavailable(nav.totalCostMinor, nav.currency)} · {nav.markedHoldings} marked · {nav.unmarkedHoldings} unmarked
        </div>
        {nav.refusalCopy && (
          <div className="text-xs mt-2 leading-relaxed" style={{ color: "#8a5a06" }} data-testid="spv-nav-refusal">
            {nav.refusalCopy}
          </div>
        )}
      </div>

      {/* ── valuation policy, stated ─────────────────────────────────────── */}
      <div className="text-xs mb-3 leading-relaxed text-[var(--cv-color-text-muted)]" data-testid="spv-nav-policy">
        Valuation policy: each holding is marked to the company's last priced round. A mark is flagged stale after{" "}
        {nav.thresholds.staleWarnDays} days and expired after {nav.thresholds.staleExpiredDays} days. A GP may override a
        mark; an override takes effect only once approved. A holding with no priced round is reported as unmarked and is
        never valued at its cost — cost is a historical fact, not a valuation.
      </div>

      {/* ── holdings ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="font-medium text-sm mb-1">Holdings</div>
        {nav.holdings.length === 0 ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-nav-holdings-empty">
            This vehicle has not deployed capital into a holding yet, so there is nothing to value.
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="spv-nav-holdings">
            <thead>
              <tr className="text-left text-[var(--cv-color-text-muted)]">
                <th className="py-1">Company</th><th>Shares</th><th>Price/share</th><th>Mark</th><th>Cost</th><th>Fair value</th>
              </tr>
            </thead>
            <tbody>
              {nav.holdings.map((h) => (
                <tr key={h.deploymentId} className="border-t" data-testid={`spv-nav-holding-${h.deploymentId}`}>
                  <td className="py-1">{h.companyId}</td>
                  <td>{h.shares ?? "—"}</td>
                  <td>{h.pricePerShare === null ? "—" : h.pricePerShare}</td>
                  <td><MarkBadge badge={h.markBadge} />{h.valuationDate ? <span className="ml-1 text-[var(--cv-color-text-muted)]">{h.valuationDate}</span> : null}</td>
                  <td>{formatMinorOrUnavailable(h.costMinor, h.currency)}</td>
                  <td data-testid={`spv-nav-fv-${h.deploymentId}`}>
                    {h.fairValueMinor === null ? (
                      <span title={
                        h.refusal === "SHARE_COUNT_UNKNOWN"
                          ? "The share count for this holding is not recorded, so it cannot be valued."
                          : "No priced round exists for this company, so no mark can be derived."
                      }>
                        Not valued
                      </span>
                    ) : (
                      formatMinorOrUnavailable(h.fairValueMinor, h.currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── per-LP allocation ────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="font-medium text-sm mb-1">NAV by limited partner</div>
        <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">
          Allocated across committed capital by largest remainder, so the shares sum exactly to the vehicle NAV with no
          rounding loss. Where the vehicle NAV is unknown, each LP's share is unknown too — not zero.
        </div>
        {lpShares.length === 0 ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-nav-lps-empty">
            No committed capital yet, so there is nothing to allocate.
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="spv-nav-lp-shares">
            <thead><tr className="text-left text-[var(--cv-color-text-muted)]"><th className="py-1">Investor</th><th>Commitment</th><th>NAV share</th></tr></thead>
            <tbody>
              {lpShares.map((s) => (
                <tr key={s.investorId} className="border-t" data-testid={`spv-nav-lp-${s.investorId}`}>
                  <td className="py-1">{s.investorId}</td>
                  <td>{formatMinorOrUnavailable(s.commitmentMinor, nav.currency)}</td>
                  <td>{s.navShareMinor === null ? <span title="The vehicle NAV is unknown, so this LP's share of it is unknown.">Not computable</span> : formatMinorOrUnavailable(s.navShareMinor, nav.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── freeze ───────────────────────────────────────────────────────── */}
      {canWrite && (
        <div className="mb-4 rounded-md p-3" style={{ border: "1px solid rgba(4,30,65,0.18)" }} data-testid="spv-nav-freeze">
          <div className="font-medium text-sm mb-1">Freeze this NAV</div>
          <div className="text-xs text-[var(--cv-color-text-muted)] mb-2">
            Records the valuation as of a date, with the staleness badge and the thresholds in force, attributed to you.
            A NAV that could not be computed is recorded as such — the series never silently skips a period.
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <Label htmlFor={`nav-asof-${spvId}`} className="text-xs">As-of date</Label>
              <Input
                id={`nav-asof-${spvId}`}
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                data-testid="spv-nav-freeze-date"
              />
            </div>
            <Button
              size="sm"
              disabled={freeze.isPending}
              onClick={() => freeze.mutate(asOfDate ? { asOfDate } : {})}
              data-testid="spv-nav-freeze-submit"
            >
              {freeze.isPending ? "Freezing…" : "Freeze NAV"}
            </Button>
          </div>
        </div>
      )}

      {/* ── freeze history ───────────────────────────────────────────────── */}
      <div>
        <div className="font-medium text-sm mb-1">NAV history</div>
        {snapshots.length === 0 ? (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spv-nav-history-empty">
            No NAV has been frozen for this vehicle yet.
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="spv-nav-history">
            <thead><tr className="text-left text-[var(--cv-color-text-muted)]"><th className="py-1">As of</th><th>NAV</th><th>Mark</th><th>Frozen by</th><th>State</th></tr></thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id} className="border-t" data-testid={`spv-nav-snapshot-${s.id}`}>
                  <td className="py-1">{s.asOfDate}</td>
                  <td>{s.totalNavMinor === null ? <span title={`Not computable: ${s.status}`}>Not computable</span> : formatMinorOrUnavailable(s.totalNavMinor, s.currency)}</td>
                  <td><MarkBadge badge={s.worstMarkBadge} /></td>
                  <td>{s.frozenBy}</td>
                  <td>{s.supersededAt ? "Superseded" : "Current"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
