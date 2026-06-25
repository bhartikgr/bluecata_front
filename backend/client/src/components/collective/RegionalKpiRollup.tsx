/**
 * v25.42 R9 — Regional KPI rollup card (added to the admin /admin/regions page).
 *
 * Aggregates by region from existing endpoints client-side: member counts come
 * from GET /api/collective/members (admins see the full roster) and company
 * counts come from GET /api/collective/companies. No new endpoint, no schema
 * change. Loading / error / empty states handled. Admin-only by placement (the
 * /admin/regions route is already role="admin" guarded; the underlying
 * endpoints are server-gated too).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe2 } from "lucide-react";

interface MemberRow {
  id: string;
  region?: string | null;
}
interface MembersResponse {
  members?: MemberRow[];
}
interface CompanyRow {
  id: string;
  region?: string | null;
  hq?: string | null;
}
interface CompaniesResponse {
  companies?: CompanyRow[];
}

export function RegionalKpiRollup() {
  const membersQ = useQuery<MembersResponse>({
    queryKey: ["/api/collective/members", "admin-region-rollup"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/members")).json(),
    staleTime: 30_000,
  });
  const companiesQ = useQuery<CompaniesResponse>({
    queryKey: ["/api/collective/companies", "admin-region-rollup"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/companies")).json(),
    staleTime: 30_000,
  });

  const isLoading = membersQ.isLoading || companiesQ.isLoading;
  const error = membersQ.error || companiesQ.error;

  const rollup = new Map<string, { members: number; companies: number }>();
  for (const m of membersQ.data?.members ?? []) {
    const r = (m.region ?? "Unspecified") || "Unspecified";
    const cur = rollup.get(r) ?? { members: 0, companies: 0 };
    cur.members += 1;
    rollup.set(r, cur);
  }
  for (const c of companiesQ.data?.companies ?? []) {
    const r = (c.region ?? c.hq ?? "Unspecified") || "Unspecified";
    const cur = rollup.get(r) ?? { members: 0, companies: 0 };
    cur.companies += 1;
    rollup.set(r, cur);
  }
  const rows = Array.from(rollup.entries())
    .map(([region, v]) => ({ region, ...v }))
    .sort((a, b) => b.members + b.companies - (a.members + a.companies));

  return (
    <Card className="mb-5" data-testid="widget-region-kpi-rollup">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-[#cc0001]" />
          Regional KPI Rollup
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" data-testid="region-kpi-loading" />
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="region-kpi-error">
            Couldn't load the regional rollup.
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="region-kpi-empty">
            No regional data to roll up yet.
          </div>
        ) : (
          <div className="overflow-x-auto" data-testid="region-kpi-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-1 pr-4">Region</th>
                  <th className="py-1 pr-4">Members</th>
                  <th className="py-1">Companies</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.region} className="border-b last:border-0" data-testid={`region-kpi-row-${r.region}`}>
                    <td className="py-1.5 pr-4 font-medium">{r.region}</td>
                    <td className="py-1.5 pr-4">{r.members}</td>
                    <td className="py-1.5">{r.companies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
