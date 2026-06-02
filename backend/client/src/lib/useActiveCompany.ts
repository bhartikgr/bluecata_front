/**
 * Sprint 11 Phase 2 — Active company hook + founder-scoped query helpers.
 *
 * Single source of truth for the founder's currently active company id.
 * Components read this hook to scope every founder-side query (cap-table,
 * dataroom, reports, CRM, etc) by `companyId=...`.
 *
 * The CompanySwitcher already invalidates the relevant query keys on
 * activate, so consumers do NOT need to depend on a `companyId` URL param.
 *
 * B-510 fix v23.6: persist activeCompanyId in localStorage so that hard
 * navigation/page reload does not flash-redirect to /founder/subscribe while
 * the server round-trip is in flight.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const LS_KEY = "capavate:activeCompanyId";

export type ActiveCompanyResp = {
  activeCompanyId: string;
  company: {
    companyId: string;
    companyName: string;
    legalName: string;
    role: string;
    sector: string;
    stage: string;
    hq: string;
    kpi: {
      capTableHolders: number;
      activeRoundsCount: number;
      raisedThisYearUsd: number;
      dataroomFiles: number;
      pendingSoftCircles: number;
      ownershipPct: number;
    };
    collective: { status: string; memberSince?: string };
    billing: {
      plan: string;
      monthlyUsd: number;
      nextBillingDate: string;
      cardLast4: string | null;
      invoiceCount: number;
    };
  };
};

export function useActiveCompany() {
  const q = useQuery<ActiveCompanyResp>({
    queryKey: ["/api/founder/active-company"],
  });

  // B-510 fix v23.6: persist activeCompanyId in localStorage on every
  // successful fetch so page reloads can restore state before the server
  // round-trip completes and avoid a flash-redirect to /founder/subscribe.
  useEffect(() => {
    const id = q.data?.activeCompanyId;
    if (id) {
      try { localStorage.setItem(LS_KEY, id); } catch { /* storage unavailable */ }
    }
  }, [q.data?.activeCompanyId]);

  return q;
}

/**
 * Convenience: returns the active company id or empty string when none is set
 * (fresh user / not yet provisioned). Callers must guard rendering on an empty
 * id; Patch v4 removes the prior "co_novapay" demo fallback that caused leaks.
 *
 * B-510 fix v23.6: falls back to localStorage when the server query is still
 * loading, preventing a flash-redirect to /founder/subscribe on page reload.
 */
export function useActiveCompanyId(): string {
  const q = useActiveCompany();
  if (q.data?.activeCompanyId) return q.data.activeCompanyId;
  // Fallback: localStorage-cached value during loading to avoid redirect flicker
  if (q.isLoading) {
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) return cached;
    } catch { /* storage unavailable */ }
  }
  return "";
}
