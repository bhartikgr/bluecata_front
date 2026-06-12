/**
 * v23.8 C5/W-16 — Admin Collective Waitlist page.
 *
 * Reads from GET /api/admin/collective/waitlist?kind=&status= ({ items, count }).
 * Review:  PATCH /api/admin/collective/waitlist/:id  body { status, note? }
 *          status ∈ accepted | declined | waitlist
 *
 * Mirrors the pattern of CollectiveApplications.tsx.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type WaitlistKind =
  | "investor_membership"
  | "founder_path_a"
  | "founder_path_b"
  | "cap_table_promote";
type WaitlistStatus = "waitlist" | "accepted" | "declined";

interface WaitlistRow {
  id: string;
  kind: WaitlistKind;
  userId: string;
  companyId: string | null;
  chapterHint: string | null;
  status: WaitlistStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const STATUSES: Array<WaitlistStatus | "all"> = ["all", "waitlist", "accepted", "declined"];

const KIND_LABEL: Record<WaitlistKind, string> = {
  investor_membership: "Investor membership",
  founder_path_a: "Founder — Path A",
  founder_path_b: "Founder — Path B",
  cap_table_promote: "Cap-table promote",
};

const STATUS_BADGE: Record<WaitlistStatus, { label: string; cls: string }> = {
  waitlist: { label: "Waitlist", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  accepted: { label: "Accepted", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  declined: { label: "Declined", cls: "bg-rose-100 text-rose-800 border-rose-200" },
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function CollectiveWaitlist() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<WaitlistStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useQuery<{ items: WaitlistRow[]; count: number }>({
    queryKey: ["/api/admin/collective/waitlist", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/admin/collective/waitlist"
        : `/api/admin/collective/waitlist?status=${statusFilter}`;
      return (await apiRequest("GET", url)).json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: WaitlistStatus }) =>
      (await apiRequest("PATCH", `/api/admin/collective/waitlist/${id}`, { status })).json(),
    onSuccess: () => {
      toast({ title: "Waitlist entry updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/waitlist"] });
    },
    onError: () => toast({ variant: "destructive", title: "Update failed", description: "Please try again. If the issue persists, contact support." }),
  });

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Collective Waitlist"
        description="Review investor-membership, founder Path A/B, and cap-table promote signups collected during invite-only beta."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Waitlist" }]}
      />
      <PageBody>
        <div className="flex flex-wrap gap-2 mb-4" data-testid="filter-chips">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`chip-status-${s}`}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-full border capitalize transition-colors ${
                statusFilter === s
                  ? "bg-[hsl(184_98%_22%)] text-white border-transparent"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
              }`}
            >
              {s}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="ml-auto"
            data-testid="button-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading && (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="loading">Loading…</div>
            )}
            {isError && (
              <div className="p-8 text-center text-sm text-rose-600" data-testid="error">Failed to load waitlist.</div>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty">
                No waitlist entries found.
              </div>
            )}
            {!isLoading && items.length > 0 && (
              <table className="w-full text-sm" data-testid="waitlist-table">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2">Kind</th>
                    <th className="px-4 py-2">User / Company</th>
                    <th className="px-4 py-2">Chapter</th>
                    <th className="px-4 py-2">Submitted</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const sb = STATUS_BADGE[row.status] ?? { label: row.status, cls: "bg-slate-100 text-slate-700" };
                    return (
                      <tr key={row.id} className="border-b hover:bg-slate-50" data-testid={`row-${row.id}`}>
                        <td className="px-4 py-2 font-medium">{KIND_LABEL[row.kind] ?? row.kind}</td>
                        <td className="px-4 py-2">
                          <div>{row.userId}</div>
                          {row.companyId && <div className="text-xs text-muted-foreground">{row.companyId}</div>}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{row.chapterHint ?? "—"}</td>
                        <td className="px-4 py-2">{fmtDate(row.createdAt)}</td>
                        <td className="px-4 py-2">
                          <Badge className={`border text-xs font-normal ${sb.cls}`}>{sb.label}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-emerald-700"
                              disabled={reviewMutation.isPending || row.status === "accepted"}
                              onClick={() => reviewMutation.mutate({ id: row.id, status: "accepted" })}
                              data-testid={`button-accept-${row.id}`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-700"
                              disabled={reviewMutation.isPending || row.status === "declined"}
                              onClick={() => reviewMutation.mutate({ id: row.id, status: "declined" })}
                              data-testid={`button-decline-${row.id}`}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-slate-600"
                              disabled={reviewMutation.isPending || row.status === "waitlist"}
                              onClick={() => reviewMutation.mutate({ id: row.id, status: "waitlist" })}
                              data-testid={`button-waitlist-${row.id}`}
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
