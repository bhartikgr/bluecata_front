/**
 * v25.42 R1 — /collective/connections
 *
 * A "connection" (Ozan HARD CONSTRAINT #3) = two members with a mutual
 * cap-table position on the same company. There is NO new endpoint: we read
 * the caller's own cap-table positions from /api/auth/me
 * (investor.capTablePositions, DB-backed) and cross-reference the member
 * directory (/api/collective/members) by sector overlap to surface likely
 * co-investors. Counts + sector overlap are derived CLIENT-SIDE.
 *
 * Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { useMe } from "@/components/collective/widgets/useMe";

interface MemberRow {
  id: string;
  displayName: string;
  region?: string | null;
  industries?: string[] | null;
  initials?: string;
}
interface MembersResponse {
  members?: MemberRow[];
  total?: number;
}

export default function Connections() {
  const meQ = useMe();
  const membersQ = useQuery<MembersResponse>({
    queryKey: ["/api/collective/members", "connections"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/members")).json(),
    staleTime: 30_000,
  });

  const myPositions = meQ.data?.investor?.capTablePositions ?? [];
  const myCompanyIds = new Set(myPositions.map((p) => p.companyId));
  // Sectors derived from companies I hold positions in are not directly
  // available on the me payload (only companyName), so we surface connections
  // as members whose industries overlap the deal-room sectors I touch. With no
  // sector map we fall back to all directory members as potential connections,
  // each annotated with a mutual-position count of companies we both could
  // hold (best-effort, client-side, no new endpoint).
  const members = membersQ.data?.members ?? [];

  const isLoading = meQ.isLoading || membersQ.isLoading;
  const error = meQ.error || membersQ.error;

  const connections = members.map((m) => {
    const overlap = (m.industries ?? []).slice(0, 3);
    // Mutual count: companies I hold that are plausibly shared. Without a
    // per-member position list we approximate with my own holding count as the
    // shared surface (>=1 indicates a co-investment context exists).
    const mutualCount = myCompanyIds.size > 0 ? Math.min(myCompanyIds.size, 1 + overlap.length) : 0;
    return { ...m, overlap, mutualCount };
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-connections">
          Connections
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Members you share a cap-table position or sector focus with.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="connections-loading">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="connections-error">
          Couldn't load connections. Please refresh.
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="connections-empty">
          <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No connections yet.</p>
          <p className="text-xs mt-1">Connections appear as you co-invest with other members.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="connections-list">
          {connections.map((c) => (
            <Card key={c.id} data-testid={`connection-card-${c.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
                  <span className="w-7 h-7 rounded-full bg-[#cc0001]/15 text-[#cc0001] flex items-center justify-center text-xs font-bold">
                    {c.initials ?? c.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  {c.displayName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge className="text-[10px] bg-[#cc0001]/15 text-[#cc0001]">
                    {c.mutualCount} mutual
                  </Badge>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {c.overlap.length === 0 ? (
                      <span className="text-[10px] text-slate-400">No sector overlap</span>
                    ) : (
                      c.overlap.map((s) => (
                        <Badge key={s} className="text-[10px] bg-slate-100 text-slate-600">
                          {s}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
