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
      /* WAVE 75 · ITEM 1 (R70/R47) — `number | null`. The server now COMPUTES this
         from the cap-table engine on every read (`server/multiCompanyStore.ts`
         → `withComputedOwnership`), and sends `null` when the engine has nothing to
         compute from. `Dashboard.tsx:283` already narrows `== null` and
         `fmtPct(null, 2)` renders the platform's em-dash, so an unknown ownership
         reaches the founder as `—` rather than as a fabricated `100.00%`. */
      ownershipPct: number | null;
      /* WAVE 125 · FINDING 2 — the DERIVED distinct cap-table holder count, added at
         read time by `server/multiCompanyStore.ts::withComputedOwnership` from the
         same engine call as `ownershipPct`. `capTableHolders` above has NO WRITER in
         live code (29 live sites, 0 computations), so `?? 0` on it published a zero
         nobody computed; the dashboard now reads THIS field and renders an em dash
         plus a plain-English statement when it is `null`. Optional because the
         SACRED `/api/auth/me` projection (`server/lib/userContext.ts:309`) cannot
         carry it. */
      capTableHoldersOnRecord?: number | null;
    };
    /* WAVE 190 · ITEM A — THE COMPANY'S CURRENCY, WHICH THE CAP TABLE NEEDS AND
       COULD NOT SEE. The server has sent this since v24.2 Bug 6
       (`server/multiCompanyStore.ts:369-372`, read from `company_default_currency`
       via `readDefaultCurrency`), but it was never declared here, so
       `client/src/pages/founder/CapTable.tsx` had no currency to read and reached
       for `company_profile.legal.region` instead — printing `HK$` for a Hong Kong
       company that may well be denominated in USD.

       OPTIONAL ON PURPOSE, AND `undefined` IS NOT `"USD"`. The server omits the
       key entirely when no row exists in `company_default_currency`; that is a
       genuine "no currency on record", and the cap table must refuse and name it
       rather than default (R6). Do not give this field a fallback. */
    defaultCurrency?: string;
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
