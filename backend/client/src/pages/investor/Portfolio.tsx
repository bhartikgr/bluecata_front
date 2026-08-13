/**
 * Sprint 21 Wave C — Investor Portfolio page (scoped overhaul).
 *
 * C2 Scope narrowing: Portfolio-wide aggregate views (KPI strip, byStage /
 * byRegion / byVintage charts, cohort benchmark) belong on the Dashboard
 * and are removed here. Only per-company content remains.
 *
 * Layout:
 *  1. PageHeader
 *  2. PortfolioCompanySwitcher  (C1 — large branded selector)
 *  3. PortfolioCompanyOverview  (C2 — per-company detail: KPIs, updates, marks,
 *                                 pro-rata, anti-dilution, tax, promote button)
 *
 * URL param: ?company=<companyId>  (managed by the switcher)
 *
 * Math integrity: broadBasedWeightedAverage() is re-exported from here
 * so PortfolioCompanyOverview can import it without circular deps.
 *
 * Sprint 20 defect 36 fix is preserved in ProRataCard inside
 * PortfolioCompanyOverview — ownershipPct is normalised to fraction before math.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

import { PageBody, PageHeader } from "@/components/AppShell";
import { PortfolioCompanySwitcher } from "@/components/investor/PortfolioCompanySwitcher";
import { PortfolioCompanyOverview } from "@/components/investor/PortfolioCompanyOverview";
/* WAVE 32 · CP-SPV-30 capability 5 — LP (vehicle) positions in the EXISTING
   investor portal. Ruling A-23: no `pages/lp/*` tree, no second login. Until
   this mount, this page contained ZERO SPV references, so an LP's own position
   was invisible to them — the real gap named in `spec/LP_SCOPED_VIEW_DESIGN.md`
   §3. The component renders NOTHING for an investor who holds no LP interest,
   so a purely direct cap-table investor's portfolio is byte-unchanged. */
import { LpPositions } from "@/components/investor/LpPositions";
import { SpvInvitations } from "@/components/investor/SpvInvitations";
import { useRealtimeSync } from "@/lib/realtimeSync";

/* ------------------------------------------------------------------ */
/* Re-export math for sub-components                                   */
/* ------------------------------------------------------------------ */

/**
 * Broad-based weighted-average anti-dilution formula:
 *   CP_new = CP_old × (CSO + CCP) / (CSO + (NCM / CP_old))
 *
 * Where:
 *   CP_old = conversion price before new financing
 *   CSO    = common shares outstanding (fully diluted)
 *   CCP    = converted common at CP_old (= new shares as-if-converted)
 *   NCM    = new consideration received
 */
export function broadBasedWeightedAverage(opts: {
  cpOld: number;
  cso: number;
  ccp: number;
  ncm: number;
}): number {
  const { cpOld, cso, ccp, ncm } = opts;
  if (cpOld <= 0 || cso <= 0) return cpOld;
  return (cpOld * (cso + ccp)) / (cso + ncm / cpOld);
}

/* ------------------------------------------------------------------ */
/* URL param helpers                                                   */
/* ------------------------------------------------------------------ */

// Sprint 21 hotfix: the app uses hash routing, so query params live AFTER
// the hash, not in window.location.search. Read/write from the hash fragment.
function getCompanyParam(): string | null {
  if (typeof window === "undefined") return null;
  // search fallback first (for non-hash deep-links), then hash query
  const fromSearch = new URLSearchParams(window.location.search).get("company");
  if (fromSearch) return fromSearch;
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return null;
  return new URLSearchParams(hash.slice(qIdx + 1)).get("company");
}

function setCompanyParam(companyId: string): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  const base = qIdx === -1 ? hash : hash.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? "" : hash.slice(qIdx + 1));
  params.set("company", companyId);
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${base}?${params.toString()}`);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function InvestorPortfolio() {
  useRealtimeSync();
  const [, navigate] = useLocation();

  // Keep selectedCompanyId in state; initialise from URL param
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    getCompanyParam,
  );
  // DEF-048: guard to prevent flash of error during redirect when portfolio is empty
  const positions = useQuery<{ companyId: string }[]>({ queryKey: ["/api/investor/portfolio2"], staleTime: 30_000 });
  const hasPositions = (positions.data?.length ?? 1) > 0; // default true until loaded
  // v25.48.2 Q8 — once positions have loaded and there are none, the switcher
  // renders the empty-state CTA; suppress the "select a company" hint so we
  // don't stack two empty messages.
  const portfolioIsEmpty = !positions.isLoading && (positions.data?.length ?? 0) === 0;

  // When the switcher selects a company, update both state and URL param
  function handleCompanyChange(companyId: string) {
    setSelectedCompanyId(companyId);
    setCompanyParam(companyId);
  }

  // If no company param and we already have a selection from elsewhere,
  // sync it back to the URL
  useEffect(() => {
    if (selectedCompanyId) {
      setCompanyParam(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Per-company holdings, updates, and analytics."
        breadcrumbs={[
          { href: "/investor/dashboard", label: "Workspace" },
          { label: "Portfolio" },
        ]}
      />
      <PageBody>
        {/* C1: Company switcher — must be the very first content element */}
        <PortfolioCompanySwitcher
          selectedCompanyId={selectedCompanyId}
          onCompanyChange={handleCompanyChange}
        />

        {/* C2: Per-company overview — DEF-048: also guard against empty portfolio flash */}
        {selectedCompanyId && hasPositions && (
          <div className="mt-6">
            <PortfolioCompanyOverview companyId={selectedCompanyId} />
          </div>
        )}

        {/* When no company is selected yet (first load before switcher auto-selects) */}
        {!selectedCompanyId && !portfolioIsEmpty && (
          <div className="mt-6 text-sm text-muted-foreground text-center py-12">
            Select a portfolio company above to view its details.
          </div>
        )}

        {/* WAVE 32 capability 5 — LP vehicle interests, APPENDED as the last
            sibling of PageBody rather than inserted mid-list: inserting a Card
            into the middle renumbers a sibling's positional path and the guard
            reads that as a drop. This is a sibling element, not text added
            inside an existing text node. Scope follows the POSITION: this block
            appears only for the vehicles this session identity is actually a
            committed LP of, and the same human's direct holdings above are
            untouched (the dual-position case, design §5). */}
        <LpPositions />
        {/* WAVE 33 / CP-SPV-53 — invite-only vehicle invitations, APPENDED as
            the last sibling of PageBody for the same reason as LpPositions:
            inserting mid-list renumbers a sibling's positional path and the
            guard reads that as a drop. `invite_only` was excluded from every
            discovery context for every viewer, so an invited person had no
            surface anywhere on which to see the vehicle they were invited to.
            This is that surface, inside the EXISTING investor portal (ruling
            A-23) — no second door, no invitee account type. */}
        <SpvInvitations />
      </PageBody>
    </>
  );
}
