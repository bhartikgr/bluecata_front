/**
 * v23.5 C-003 — Admin Collective Members page.
 *
 * Reads from GET /api/admin/collective/members (collectiveMembershipStore.listActive()).
 * Deactivate: handled server-side via existing deactivate endpoint.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, RefreshCw, UserX } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface MemberRow {
  userId: string;
  userName?: string;
  userEmail?: string;
  status: "active" | "suspended";
  tier: "standard" | "plus";
  activatedAt: string;
  activatedBy: string;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function CollectiveMembers() {
  const { toast } = useToast();
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ items: MemberRow[]; count: number }>({
    queryKey: ["/api/admin/collective/members"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/collective/members")).json(),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) =>
      (await apiRequest("POST", `/api/admin/collective/members/${userId}/deactivate`, {})).json(),
    onSuccess: () => {
      toast({ title: "Member deactivated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/members"] });
      setDeactivatingId(null);
    },
    onError: () => toast({ variant: "destructive", title: "Deactivate failed", description: "Please try again. If the issue persists, contact support." }),
  });

  const members = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Collective Members"
        description="Active Collective memberships — approved via admin application pipeline."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Members" }]}
      />
      <PageBody>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{data?.count ?? 0} active member{(data?.count ?? 0) !== 1 ? "s" : ""}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="loading">Loading…</div>
            )}
            {isError && (
              <div className="p-8 text-center text-sm text-rose-600" data-testid="error">Failed to load members.</div>
            )}
            {!isLoading && !isError && members.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty">
                No active Collective members yet. Approve applications to add members.
              </div>
            )}
            {!isLoading && members.length > 0 && (
              <table className="w-full text-sm" data-testid="members-table">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Tier</th>
                    <th className="px-4 py-2">Active Since</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId} className="border-b hover:bg-slate-50" data-testid={`row-${m.userId}`}>
                      <td className="px-4 py-2">
                        <div className="font-medium" data-testid={`member-name-${m.userId}`}>{m.userName || "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{m.userId}</div>
                      </td>
                      <td className="px-4 py-2" data-testid={`member-email-${m.userId}`}>{m.userEmail || "—"}</td>
                      <td className="px-4 py-2 capitalize">{m.tier}</td>
                      <td className="px-4 py-2">{fmtDate(m.activatedAt)}</td>
                      <td className="px-4 py-2">
                        <Badge className={m.status === "active" ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-slate-100 text-slate-700 border border-slate-200"}>
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {m.status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            disabled={deactivatingId === m.userId || deactivateMutation.isPending}
                            onClick={() => {
                              setDeactivatingId(m.userId);
                              deactivateMutation.mutate(m.userId);
                            }}
                            data-testid={`button-deactivate-${m.userId}`}
                          >
                            <UserX className="h-3.5 w-3.5 mr-1" />
                            {deactivatingId === m.userId ? "…" : "Deactivate"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
