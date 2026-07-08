/**
 * W2-D — Consortium Partner Private Portfolio (read-only list).
 *
 * The server API GET /api/partner/me/portfolio (partnerRoutes.ts) has existed
 * since v25.50.0 Phase 3 but had no client route/nav, so partners could not
 * reach their private per-company portfolio profiles. This page consumes that
 * endpoint and lists each attributed company with its saved profile summary.
 * Read-only — profile edits happen on the company-scoped surfaces, not here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";

interface PortfolioRow {
  companyId: string;
  companyName: string | null;
  logoUrl: string | null;
  profile: Record<string, unknown> | null;
  updatedAt: string | null;
}

export default function PartnerPortfolio() {
  const role = useRequirePartnerRole();
  const [search, setSearch] = useState("");

  const q = useQuery<{ portfolio: PortfolioRow[] }>({
    queryKey: ["/api/partner/me/portfolio"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/portfolio")).json(),
  });

  const filtered = useMemo(() => {
    const rows = q.data?.portfolio ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.companyName ?? "").toLowerCase().includes(needle) ||
        r.companyId.toLowerCase().includes(needle),
    );
  }, [q.data, search]);

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  const hasRows = !!data && data.portfolio.length > 0;

  return (
    <PartnerShell
      title="Portfolio"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      {q.isLoading && (
        <div className="text-slate-500" data-testid="portfolio-loading">Loading…</div>
      )}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="portfolio-error"
        >
          Could not load your portfolio. Please refresh and try again.
        </div>
      )}
      {!q.isLoading && !q.isError && data && data.portfolio.length === 0 && (
        <PartnerEmptyState
          title="No portfolio companies yet"
          description="Companies you maintain a private profile for will appear here. Add a profile from a company's page to start building your portfolio."
        />
      )}

      {!q.isError && hasRows && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            className="max-w-xs flex-1 rounded-md border border-[#ddd9d3] px-3 py-2 text-sm"
            data-testid="portfolio-search"
          />
        </div>
      )}

      {!q.isError && hasRows && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="portfolio-table">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Company ID</th>
                <th className="text-left p-3">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr data-testid="portfolio-no-match">
                  <td className="p-3 text-slate-500" colSpan={3}>No companies match your search.</td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.companyId} className="border-t" data-testid={`portfolio-row-${r.companyId}`}>
                  <td className="p-3 font-medium">{r.companyName ?? r.companyId}</td>
                  <td className="p-3 text-slate-500">{r.companyId}</td>
                  <td className="p-3 text-slate-500">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PartnerShell>
  );
}
