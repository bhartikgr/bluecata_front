/**
 * v23.5 C-003 — Admin Collective Applications page.
 * v23.6 C-013 — Row click opens Detail Dialog with approve/reject.
 *
 * Reads from GET /api/admin/collective/applications (bridged to BOTH stores via C-009).
 * Approve:  POST /api/admin/collective/applications/:id/approve
 * Reject:   POST /api/admin/collective/applications/:id/reject
 *
 * Matches the pattern of ConsortiumApplicationsPage.tsx.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, ChevronRight, RefreshCw,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/* ---- types ---- */
type AppStatus = "submitted" | "reviewing" | "accepted" | "rejected" | "waitlisted" | "invited";

interface CollectiveApp {
  id: string;
  companyId?: string;
  companyName?: string;  // C-011 fix v23.6: resolved company name
  founderId?: string;
  founderName?: string;  // C-011 fix v23.6: resolved founder name
  userId?: string;
  status: AppStatus;
  submittedAt: string;
  reviewedAt?: string;
  tractionMrr?: number;
  tractionUsers?: number;
  tractionGrowthPct?: number;
  asks?: string;
  coverLetter?: string;
  references?: string;
  pitchDeckFilename?: string;
  // investor-side fields
  thesis?: string;
  memberTier?: string;
}

const STATUSES: Array<AppStatus | "all"> = ["all", "submitted", "reviewing", "accepted", "rejected", "waitlisted"];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  submitted:  { label: "Submitted",  cls: "bg-blue-100 text-blue-800 border-blue-200" },
  reviewing:  { label: "Reviewing",  cls: "bg-amber-100 text-amber-800 border-amber-200" },
  accepted:   { label: "Accepted",   cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  invited:    { label: "Invited",    cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected:   { label: "Rejected",   cls: "bg-rose-100 text-rose-800 border-rose-200" },
  waitlisted: { label: "Waitlisted", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}
function fmtMrr(v?: number) {
  if (!v) return "—";
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`;
}

export default function CollectiveApplications() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<AppStatus | "all">("all");
  const [selected, setSelected] = useState<CollectiveApp | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const qKey = ["/api/admin/collective/applications", statusFilter];
  const { data, isLoading, isError, refetch } = useQuery<{ items: CollectiveApp[]; count: number }>({
    queryKey: qKey,
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/admin/collective/applications"
        : `/api/admin/collective/applications?status=${statusFilter}`;
      return (await apiRequest("GET", url)).json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("POST", `/api/admin/collective/applications/${id}/approve`, {})).json(),
    onSuccess: () => {
      toast({ title: "Application approved", description: "Membership activated." });
      // v25.40 FIX-1: broaden invalidation so founder-facing collective views
      // reflect the approval immediately (sync P1 #1).
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/membership/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dashboard"] });
      setSelected(null);
    },
    onError: () => toast({ variant: "destructive", title: "Approve failed", description: "Please try again. If the issue persists, contact support." }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await apiRequest("POST", `/api/admin/collective/applications/${id}/reject`, { reason })).json(),
    onSuccess: () => {
      toast({ title: "Application rejected" });
      // v25.40 FIX-1: broaden invalidation (sync P1 #1).
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collective/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/membership/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dashboard"] });
      setSelected(null);
      setRejectNotes("");
    },
    onError: () => toast({ variant: "destructive", title: "Reject failed", description: "Please try again. If the issue persists, contact support." }),
  });

  const items = data?.items ?? [];

  // C-013 fix v23.6: row click opens detail modal
  const displayName = (app: CollectiveApp) =>
    app.companyName ?? app.companyId ?? app.userId ?? app.founderId ?? "—";
  const founderDisplayName = (app: CollectiveApp) =>
    app.founderName ?? app.founderId ?? "—";

  return (
    <>
      <PageHeader
        title="Collective Applications"
        description="Review and approve founder + investor applications to the Collective. (C-009 bridge: reads both stores.)"
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Applications" }]}
      />
      <PageBody>
        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-4" data-testid="filter-chips">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`chip-status-${s}`}
              onClick={() => { setStatusFilter(s); setSelected(null); }}
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
              <div className="p-8 text-center text-sm text-rose-600" data-testid="error">Failed to load applications.</div>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty">
                No applications found.
              </div>
            )}
            {!isLoading && items.length > 0 && (
              <table className="w-full text-sm" data-testid="applications-table">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2">Company / Founder</th>
                    <th className="px-4 py-2">MRR</th>
                    <th className="px-4 py-2">Submitted</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((app) => {
                    const sb = STATUS_BADGE[app.status] ?? { label: app.status, cls: "bg-slate-100 text-slate-700" };
                    return (
                      <tr
                        key={app.id}
                        className="border-b hover:bg-slate-50 cursor-pointer"
                        onClick={() => { setSelected(app); setRejectNotes(""); }}
                        data-testid={`row-${app.id}`}
                      >
                        <td className="px-4 py-2">
                          {/* C-011 fix v23.6: show resolved names */}
                          <div className="font-medium">{displayName(app)}</div>
                          <div className="text-xs text-muted-foreground">{founderDisplayName(app)}</div>
                        </td>
                        <td className="px-4 py-2">{fmtMrr(app.tractionMrr)}</td>
                        <td className="px-4 py-2">{fmtDate(app.submittedAt)}</td>
                        <td className="px-4 py-2">
                          <Badge className={`border text-xs font-normal ${sb.cls}`}>{sb.label}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* C-013 fix v23.6: Detail Dialog — opens on row click */}
        <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <DialogContent className="max-w-2xl" data-testid="detail-panel">
            {selected && (
              <>
                <DialogHeader>
                  <DialogTitle>{displayName(selected)}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                  <div className="text-xs text-muted-foreground">Founder: {founderDisplayName(selected)} &middot; ID: {selected.id}</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground text-xs uppercase">Status</span>
                      <div><Badge className={`border text-xs font-normal ${(STATUS_BADGE[selected.status] ?? { cls: "" }).cls}`}>{selected.status}</Badge></div>
                    </div>
                    <div><span className="text-muted-foreground text-xs uppercase">Submitted</span><div>{fmtDate(selected.submittedAt)}</div></div>
                    {selected.tractionMrr !== undefined && (
                      <div><span className="text-muted-foreground text-xs uppercase">MRR</span><div>{fmtMrr(selected.tractionMrr)}</div></div>
                    )}
                    {selected.tractionUsers !== undefined && (
                      <div><span className="text-muted-foreground text-xs uppercase">Users</span><div>{selected.tractionUsers.toLocaleString()}</div></div>
                    )}
                    {selected.tractionGrowthPct !== undefined && (
                      <div><span className="text-muted-foreground text-xs uppercase">Growth %</span><div>{selected.tractionGrowthPct}%</div></div>
                    )}
                    {selected.memberTier && (
                      <div><span className="text-muted-foreground text-xs uppercase">Tier</span><div className="capitalize">{selected.memberTier}</div></div>
                    )}
                  </div>
                  {selected.pitchDeckFilename && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">Pitch Deck</span>
                      <p className="text-sm mt-1">{selected.pitchDeckFilename}</p>
                    </div>
                  )}
                  {selected.asks && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">Asks</span>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{selected.asks}</p>
                    </div>
                  )}
                  {selected.references && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">References</span>
                      <p className="text-sm mt-1">{selected.references}</p>
                    </div>
                  )}
                  {selected.coverLetter && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">Cover Letter</span>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{selected.coverLetter}</p>
                    </div>
                  )}
                  {selected.thesis && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase">Thesis</span>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{selected.thesis}</p>
                    </div>
                  )}
                  {/* Admin notes */}
                  <div>
                    <Label htmlFor="reject-notes-modal" className="text-xs">Admin notes (for rejection)</Label>
                    <Textarea
                      id="reject-notes-modal"
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      rows={2}
                      placeholder="Optional reason…"
                      data-testid="textarea-reject-notes"
                    />
                  </div>
                </div>
                <DialogFooter className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(selected.id)}
                    data-testid="button-approve"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {approveMutation.isPending ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate({ id: selected.id, reason: rejectNotes })}
                    data-testid="button-reject"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    {rejectMutation.isPending ? "Rejecting…" : "Reject"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
