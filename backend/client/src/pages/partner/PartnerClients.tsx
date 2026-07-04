import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import {
  PARTNER_CLIENT_STAGES,
  PARTNER_CLIENT_STAGE_LABELS,
  PARTNER_CLIENT_DEFAULT_STAGE,
  type PartnerClientStage,
} from "@shared/crmStages";

interface ClientRow { id: string; companyId: string; attributionSource: string; attributedAt: string }

/* v25.49 Phase-3A — small brand-navy stage badge. Uses the capavate.com scoped
 * tokens (navy text on a faint navy tint) applied by the partner subtree. */
function StageBadge({ stage }: { stage: PartnerClientStage }) {
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-medium border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] text-[#041e41]"
      data-testid={`client-stage-badge-${stage}`}
    >
      {PARTNER_CLIENT_STAGE_LABELS[stage]}
    </span>
  );
}

export default function PartnerClients() {
  const role = useRequirePartnerRole();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | PartnerClientStage>("all");

  const q = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["/api/partner/me/clients"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/clients")).json(),
  });
  /* v25.49 Phase-3A — per-client CRM stage index (separate partner-clients
   * engine). Best-effort: if it fails, rows fall back to the default stage. */
  const crmQ = useQuery<{ stages: Record<string, PartnerClientStage> }>({
    queryKey: ["/api/partner/me/client-crm-index"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/client-crm-index")).json(),
  });

  const stages = crmQ.data?.stages ?? {};
  const stageOf = (companyId: string): PartnerClientStage => stages[companyId] ?? PARTNER_CLIENT_DEFAULT_STAGE;

  const filtered = useMemo(() => {
    const rows = q.data?.clients ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter((c) => {
      const matchesSearch =
        !needle ||
        c.companyId.toLowerCase().includes(needle) ||
        (c.attributionSource ?? "").toLowerCase().includes(needle);
      const matchesStage = stageFilter === "all" || stageOf(c.companyId) === stageFilter;
      return matchesSearch && matchesStage;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, search, stageFilter, stages]);

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  const hasClients = !!data && data.clients.length > 0;

  return (
    <PartnerShell title="Clients" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {q.isLoading && <div className="text-slate-500" data-testid="clients-loading">Loading…</div>}
      {/* v25.14 NM2 — explicit error branch; previously a fetch failure
         rendered a permanently blank page body. */}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="clients-error"
        >
          Could not load clients. Please refresh and try again.
        </div>
      )}
      {!q.isLoading && !q.isError && data && data.clients.length === 0 && (
        <PartnerEmptyState
          title="No attributed companies yet"
          description="Ask Capavate admin to attribute companies to your partner record, or sign up companies with your referral code."
        />
      )}

      {/* v25.49 Phase-3A — list search + stage filter. Only shown when there is
         at least one client so the empty state stays clean. */}
      {!q.isError && hasClients && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or source…"
            className="max-w-xs flex-1 rounded-md border border-[#ddd9d3] px-3 py-2 text-sm"
            data-testid="clients-search"
          />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as "all" | PartnerClientStage)}
            className="rounded-md border border-[#ddd9d3] px-3 py-2 text-sm"
            data-testid="clients-stage-filter"
          >
            <option value="all">All stages</option>
            {PARTNER_CLIENT_STAGES.map((s) => (
              <option key={s} value={s}>{PARTNER_CLIENT_STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}

      {!q.isError && hasClients && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="clients-table">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Company ID</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Attributed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr data-testid="clients-no-match">
                  <td className="p-3 text-slate-500" colSpan={5}>No clients match your filters.</td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="border-t" data-testid={`client-row-${c.id}`}>
                  <td className="p-3 font-medium">{c.companyId}</td>
                  <td className="p-3"><StageBadge stage={stageOf(c.companyId)} /></td>
                  <td className="p-3 text-slate-500">{c.attributionSource}</td>
                  {/* v25.16 NM5 — guard null attributedAt to avoid "Invalid Date". */}
                  <td className="p-3 text-slate-500">{c.attributedAt ? new Date(c.attributedAt).toLocaleDateString() : "—"}</td>
                  <td className="p-3 text-right">
                    {/* v25.13 NM6 — wouter Link renders its own <a>; nesting a literal <a> produced invalid HTML (<a><a>). */}
                    <Link
                      href={`/collective/partner/clients/${c.companyId}`}
                      className="text-[#cc0001] hover:underline"
                      data-testid={`client-view-${c.companyId}`}
                    >
                      View
                    </Link>
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
