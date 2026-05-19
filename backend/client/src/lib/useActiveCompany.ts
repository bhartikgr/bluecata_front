/**
 * Sprint 11 Phase 2 — Active company hook + founder-scoped query helpers.
 *
 * Single source of truth for the founder's currently active company id.
 * Components read this hook to scope every founder-side query (cap-table,
 * dataroom, reports, CRM, etc) by `companyId=...`.
 *
 * The CompanySwitcher already invalidates the relevant query keys on
 * activate, so consumers do NOT need to depend on a `companyId` URL param.
 */
import { useQuery } from "@tanstack/react-query";

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
  return useQuery<ActiveCompanyResp>({
    queryKey: ["/api/founder/active-company"],
  });
}

/**
 * Convenience: returns the active company id or empty string when none is set
 * (fresh user / not yet provisioned). Callers must guard rendering on an empty
 * id; Patch v4 removes the prior "co_novapay" demo fallback that caused leaks.
 */
export function useActiveCompanyId(): string {
  const q = useActiveCompany();
  return q.data?.activeCompanyId ?? "";
}
