/**
 * W2-D — Consortium Partner Private Portfolio list.
 *
 * The server API GET /api/partner/me/portfolio (partnerRoutes.ts) has existed
 * since v25.50.0 Phase 3 but had no client route/nav, so partners could not
 * reach their private per-company portfolio profiles. This page consumes that
 * endpoint and lists each attributed company with its saved profile summary.
 *
 * w-partner F-new1 — the list is no longer read-only-with-no-way-in. Each row
 * now opens PartnerPortfolioProfileDialog, the same editor the Pipeline mounts,
 * so a partner can reach the profile from the surface that lists it. The
 * Pipeline mount is unchanged; this ADDS a second entry point. Write access is
 * the shared PORTFOLIO_PROFILE_WRITE_ROLES constant the server guard uses, so
 * the two cannot drift.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { PartnerPortfolioProfileDialog } from "@/components/partner/PartnerPortfolioProfileDialog";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { canWritePortfolioProfile } from "@shared/partnerRoles";

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
  /* w-partner F-new1 — the row whose profile editor is open (null = closed). */
  const [editing, setEditing] = useState<PortfolioRow | null>(null);

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
  const canEditProfile = canWritePortfolioProfile(role.identity.subRole);

  return (
    <PartnerShell
      title="Portfolio"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      {q.isLoading && (
        <div className="text-[var(--cv-color-text-muted)]" data-testid="portfolio-loading">Loading…</div>
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
          description="Companies you maintain a private profile for will appear here. Add a company from your Pipeline, then open its row here to fill in the private profile."
        />
      )}

      {!q.isError && hasRows && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            className="max-w-xs flex-1 rounded-md border border-[var(--cv-color-border)] px-3 py-2 text-sm"
            data-testid="portfolio-search"
          />
        </div>
      )}

      {!q.isError && hasRows && (
        <div className="bg-white rounded-lg border border-[var(--cv-color-border)] overflow-hidden">
          <table className="w-full text-sm" data-testid="portfolio-table">
            <thead className="bg-[var(--cv-color-surface-2)]">
              <tr>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Company ID</th>
                <th className="text-left p-3">Last updated</th>
                <th className="text-right p-3">Profile</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr data-testid="portfolio-no-match">
                  <td className="p-3 text-[var(--cv-color-text-muted)]" colSpan={4}>No companies match your search.</td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.companyId} className="border-t" data-testid={`portfolio-row-${r.companyId}`}>
                  <td className="p-3 font-medium">{r.companyName ?? r.companyId}</td>
                  <td className="p-3 text-[var(--cv-color-text-muted)]">{r.companyId}</td>
                  <td className="p-3 text-[var(--cv-color-text-muted)]">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="text-xs rounded border px-2 py-1 hover:bg-[var(--cv-color-surface-2)]"
                      data-testid={`portfolio-edit-${r.companyId}`}
                    >
                      {canEditProfile ? "Edit profile" : "View profile"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* w-partner F-new1 — same editor the Pipeline mounts. Its save handler
          invalidates ["/api/partner/me/portfolio"], which is this page's query
          key, so the list refreshes without extra wiring. */}
      {editing && (
        <PartnerPortfolioProfileDialog
          companyId={editing.companyId}
          companyName={editing.companyName ?? editing.companyId}
          canEdit={canEditProfile}
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
        />
      )}
    </PartnerShell>
  );
}
