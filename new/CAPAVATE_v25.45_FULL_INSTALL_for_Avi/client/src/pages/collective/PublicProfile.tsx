/**
 * v25.42 R6 — /collective/profile/:userId
 *
 * Public member profile. There is no /api/collective/members/:userId endpoint,
 * so we resolve the member from the existing directory list
 * (GET /api/collective/members) by id. If the requested id is the caller, we
 * enrich from /api/auth/me. Shows name, role, region/industries, and best-
 * effort soft-circle / screening counts (0 when not derivable). Respects the
 * existing directory visibility model (members not in the caller's directory
 * scope are simply not found). Loading / error / empty states handled.
 */
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserCircle } from "lucide-react";
import { useMe } from "@/components/collective/widgets/useMe";

interface MemberRow {
  id: string;
  displayName: string;
  kind?: string;
  type?: string;
  region?: string | null;
  industries?: string[] | null;
  initials?: string;
}
interface MembersResponse {
  members?: MemberRow[];
}

export default function PublicProfile() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const meQ = useMe();
  const membersQ = useQuery<MembersResponse>({
    queryKey: ["/api/collective/members", "public-profile"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/members")).json(),
    staleTime: 30_000,
  });

  const isLoading = meQ.isLoading || membersQ.isLoading;
  const error = membersQ.error;

  const member = (membersQ.data?.members ?? []).find((m) => m.id === userId);
  const isSelf = meQ.data?.userId === userId;

  const name = member?.displayName ?? (isSelf ? (meQ.data?.identity?.name ?? "You") : null);
  const role = member?.type ?? member?.kind ?? meQ.data?.collective?.role ?? "—";
  // Best-effort derived counts (no per-user authored endpoint exists; default
  // to the caller's own cap-table position count when viewing self).
  const screeningsVoted = 0;
  const softCirclesAuthored = isSelf ? (meQ.data?.investor?.capTablePositions?.length ?? 0) : 0;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-public-profile">
          Member Profile
        </h1>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" data-testid="public-profile-loading" />
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="public-profile-error">
          Couldn't load this profile. Please refresh.
        </div>
      ) : !name ? (
        <div className="text-center py-12 text-slate-500" data-testid="public-profile-empty">
          <UserCircle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">This member isn't visible in your directory.</p>
        </div>
      ) : (
        <Card data-testid="public-profile-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-3" style={{ color: "#1A1A2E" }}>
              <span className="w-10 h-10 rounded-full bg-[#cc0001]/15 text-[#cc0001] flex items-center justify-center text-sm font-bold">
                {member?.initials ?? name.slice(0, 2).toUpperCase()}
              </span>
              <span data-testid="public-profile-name">{name}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="text-[10px] bg-[#cc0001]/15 text-[#cc0001]" data-testid="public-profile-role">
                {role}
              </Badge>
              {member?.region && (
                <Badge className="text-[10px] bg-slate-100 text-slate-600">{member.region}</Badge>
              )}
              {(member?.industries ?? []).slice(0, 4).map((s) => (
                <Badge key={s} className="text-[10px] bg-slate-100 text-slate-600">{s}</Badge>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md bg-slate-50 p-3 text-center" data-testid="public-profile-softcircles">
                <div className="text-2xl font-bold text-[#cc0001]">{softCirclesAuthored}</div>
                <div className="text-[11px] text-slate-500 mt-1">Soft circles authored</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3 text-center" data-testid="public-profile-screenings">
                <div className="text-2xl font-bold text-[#cc0001]">{screeningsVoted}</div>
                <div className="text-[11px] text-slate-500 mt-1">Screenings voted</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
