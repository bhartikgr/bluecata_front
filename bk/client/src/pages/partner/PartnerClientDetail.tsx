/**
 * Client detail — read-only deep dive on a single attributed company.
 * NEVER mutates engine state. Cap-table summary is fetched via the existing
 * public engine API; this page only reads.
 */
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PartnerClientDetail() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute("/collective/partner/clients/:id");
  const id = params?.id ?? "";
  /* v25.12 NM4 — removed trailing slash from queryKey path segment so it
   * matches the canonical key convention (`["/api/partner/me/clients", id]`)
   * used elsewhere. The explicit queryFn still constructs the right URL. */
  const q = useQuery({
    queryKey: ["/api/partner/me/clients", id],
    enabled: role.ready && !!id,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/clients/${id}`)).json(),
  });
  if (!role.ready || !role.identity) return null;
  return (
    <PartnerShell title="Client" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="text-xs text-slate-500 mb-3" data-testid="client-id">{id}</div>
      {/* v25.15 NM13b — explicit loading + error UI. */}
      {q.isLoading && (
        <div className="text-sm text-slate-500 mb-3" data-testid="client-detail-loading">Loading…</div>
      )}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="client-detail-error"
        >
          Client not found or not attributed to your firm.
        </div>
      )}
      {q.data && !q.isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="client-overview">
            <CardHeader><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                <div>Stage: <span className="text-slate-500">{q.data.snapshot?.stage ?? "—"}</span></div>
                <div>Sector: <span className="text-slate-500">{q.data.snapshot?.sector ?? "—"}</span></div>
                <div>Attribution: <span className="text-slate-500">{q.data.attribution?.attributionSource ?? "—"}</span></div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="client-captable">
            <CardHeader><CardTitle className="text-sm">Cap table (read-only)</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xs text-slate-500">
                Cap-table data is shown read-only. Only the founder can edit. Math handled by Capavate's frozen engine.
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-2" data-testid="client-notes">
            <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
            <CardContent>
              {(!q.data.notes || q.data.notes.length === 0) && <div className="text-xs text-slate-500">No notes for this client yet.</div>}
              <ul className="text-xs space-y-2">
                {(q.data.notes ?? []).map((n: { id: string; title: string; body: string }) => (
                  <li key={n.id} className="border-b pb-1">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-slate-600">{n.body}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </PartnerShell>
  );
}
