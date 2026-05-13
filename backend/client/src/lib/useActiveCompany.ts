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

/** Convenience: fall back to NovaPay so the page can still mount during fetch. */
export function useActiveCompanyId(): string {
  const q = useActiveCompany();
  return q.data?.activeCompanyId ?? "co_novapay";
}
