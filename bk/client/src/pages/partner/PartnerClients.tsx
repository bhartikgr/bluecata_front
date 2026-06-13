import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";

interface ClientRow { id: string; companyId: string; attributionSource: string; attributedAt: string }

export default function PartnerClients() {
  const role = useRequirePartnerRole();
  const q = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["/api/partner/me/clients"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/clients")).json(),
  });
  if (!role.ready || !role.identity) return null;
  const data = q.data;
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
      {!q.isError && data && data.clients.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="clients-table">
            <thead className="bg-slate-50">
              <tr><th className="text-left p-3">Company ID</th><th className="text-left p-3">Source</th><th className="text-left p-3">Attributed</th><th></th></tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className="border-t" data-testid={`client-row-${c.id}`}>
                  <td className="p-3 font-medium">{c.companyId}</td>
                  <td className="p-3 text-slate-500">{c.attributionSource}</td>
                  {/* v25.16 NM5 — guard null attributedAt to avoid "Invalid Date". */}
                  <td className="p-3 text-slate-500">{c.attributedAt ? new Date(c.attributedAt).toLocaleDateString() : "—"}</td>
                  <td className="p-3 text-right">
                    {/* v25.13 NM6 — wouter Link renders its own <a>; nesting a literal <a> produced invalid HTML (<a><a>). */}
                    <Link
                      href={`/collective/partner/clients/${c.companyId}`}
                      className="text-blue-600 hover:underline"
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
