/**
 * v25.42 W7 — Regional chapters bar list.
 * Derived from /api/collective/members aggregated by region CLIENT-SIDE
 * (each member row carries a `region`). Renders a simple horizontal bar list
 * of member counts per region.
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
  total?: number;
}

export function RegionalChaptersBarList() {
  const { data, isLoading, error } = useQuery<MembersResponse>({
    queryKey: ["/api/collective/members", "regional-widget"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/members")).json(),
    staleTime: 30_000,
  });

  const byRegion = new Map<string, number>();
  for (const m of data?.members ?? []) {
    const region = (m.region ?? "Unspecified") || "Unspecified";
    byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
  }
  const rows = Array.from(byRegion.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;

  return (
    <Card data-testid="widget-regional-chapters">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Globe2 className="h-4 w-4 text-[#cc0001]" />
          Regional Chapters
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" data-testid="widget-regional-loading">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-regional-error">
            Couldn't load regional breakdown.
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-regional-empty">
            <p className="text-sm">No members to aggregate yet.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="widget-regional-list">
            {rows.map((r) => (
              <div key={r.region} data-testid={`widget-regional-${r.region}`}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-slate-700">{r.region}</span>
                  <span className="text-slate-400">{r.count}</span>
                </div>
                <div className="h-2 rounded bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#cc0001]"
                    style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
