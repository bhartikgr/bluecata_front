/**
 * WAVE 10 — route wrapper for the EN-1/EN-2 SPV performance surface.
 *
 * Thin on purpose. `SpvPerformance` is written as an embeddable panel so that
 * it can be dropped straight into `SpvDetailTabs` the moment the silent-drop
 * guard can tell an ADDED tab apart from a REMOVED tab list (see the comment on
 * the route in App.tsx). This wrapper supplies the page chrome and the back
 * link that a standalone route needs and a tab would not, and nothing else — so
 * that when the panel does move inside the tabs, nothing has to be rewritten.
 */
import { Link } from "wouter";
import SpvPerformance from "./SpvPerformance";

export default function SpvPerformanceRoute({ spvId }: { spvId: string }) {
  if (!spvId) {
    return (
      <div className="px-6 py-6" data-testid="spv-performance-route-missing-id">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          No vehicle was specified, so there is nothing to report on.
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6" data-testid="spv-performance-route">
      <div className="mb-4">
        {/* WAVE 128 - FINDING 4: THIS PAGE HAD ONE WAY OUT AND IT WENT SIDEWAYS.
            The only exit was "Back to vehicle". A GP who reached Performance from
            a deep link, a bookmark or an email had no path to the SPV list or to
            their workspace at all - the partner nav lives in CollectiveShell,
            which this route renders OUTSIDE of, and CollectiveShell is not in this
            wave's ownership. So the way home is stated here, as a breadcrumb, in
            ADDITION to the existing back link, which is untouched. Both targets
            are declared routes: /collective/partner/dashboard (App.tsx:1329) and
            /collective/partner/spv-engine (App.tsx:1437), the canonical vehicle
            list that /collective/partner/spvs itself redirects to (App.tsx:1472).
            No existing link is moved, renamed or removed. */}
        <nav className="text-xs text-slate-600 mb-1" aria-label="Breadcrumb" data-testid="spv-performance-breadcrumb">
          <Link href="/collective/partner/dashboard" className="underline" data-testid="spv-performance-crumb-workspace">
            Partner workspace
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href="/collective/partner/spv-engine" className="underline" data-testid="spv-performance-crumb-vehicles">
            Vehicles
          </Link>
          <span aria-hidden="true"> / </span>
          <span>Performance</span>
        </nav>
        <Link
          href={`/collective/partner/spvs/${encodeURIComponent(spvId)}`}
          className="text-sm text-slate-600 underline"
          data-testid="spv-performance-back-link"
        >
          Back to vehicle
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[var(--cv-color-navy)]" data-testid="page-title">
          Performance
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Cash flows, ILPA performance measures and ledger integrity for this vehicle. Figures are
          derived from recorded flows and the current valuation mark; nothing here is estimated.
        </p>
      </div>
      <SpvPerformance vehicleKind="spv" vehicleId={spvId} />
    </div>
  );
}
