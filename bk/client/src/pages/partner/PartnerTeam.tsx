/**
 * Team management page — managing_partner only can invite/remove.
 * Tier seat limit enforced server-side; UI shows seat utilization banner.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, isManagingPartner } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUB_ROLES = ["managing_partner", "associate", "bd", "analyst", "viewer"] as const;

export default function PartnerTeam() {
  const role = useRequirePartnerRole();
  const q = useQuery<{ members: Array<{ id: string; userId: string; subRole: string; status: string; joinedAt: string }>; invitations: Array<{ id: string; invitedEmail: string; subRole: string; expiresAt: string; redeemedAt: string | null }> }>({
    queryKey: ["/api/partner/me/team"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/team")).json(),
  });
  const [email, setEmail] = useState("");
  const [subRole, setSubRole] = useState<string>("viewer");

  const inviteMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/team/invitations", { email, subRole })).json(),
    onSuccess: () => { setEmail(""); queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] }); },
  });
  const removeMut = useMutation({
    mutationFn: async (userId: string) => (await apiRequest("DELETE", `/api/partner/me/team/${userId}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] }),
  });

  if (!role.ready || !role.identity) return null;
  const canInvite = isManagingPartner(role.identity.subRole);
  const activeCount = (q.data?.members ?? []).filter((m) => m.status === "active").length;
  const pendingCount = (q.data?.invitations ?? []).filter((i) => !i.redeemedAt).length;

  return (
    <PartnerShell title="Team" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="mb-4 text-sm text-slate-600" data-testid="seat-banner">
        {activeCount} active seats + {pendingCount} pending invitations
      </div>
      {canInvite && (
        <div className="flex gap-2 mb-6 bg-white p-3 rounded border" data-testid="invite-form">
          <Input data-testid="invite-email" placeholder="member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
          <select data-testid="invite-role" value={subRole} onChange={(e) => setSubRole(e.target.value)} className="border rounded px-2 text-sm">
            {SUB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Button data-testid="invite-btn" disabled={!email} onClick={() => inviteMut.mutate()}>Invite</Button>
        </div>
      )}
      <div className="bg-white rounded-lg border overflow-hidden mb-6">
        <div className="px-3 py-2 text-xs uppercase text-slate-500 bg-slate-50">Members</div>
        <table className="w-full text-sm" data-testid="members-table">
          <thead className="bg-slate-50"><tr><th className="p-2 text-left">User</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {(q.data?.members ?? []).map((m) => (
              <tr key={m.id} className="border-t" data-testid={`member-${m.userId}`}>
                <td className="p-2">{m.userId}</td>
                <td className="p-2 text-slate-500">{m.subRole}</td>
                <td className="p-2 text-slate-500">{m.status}</td>
                <td className="p-2 text-right">
                  {canInvite && m.status === "active" && (
                    <button data-testid={`remove-${m.userId}`} className="text-red-600 text-xs" onClick={() => removeMut.mutate(m.userId)}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-3 py-2 text-xs uppercase text-slate-500 bg-slate-50">Pending invitations</div>
        <table className="w-full text-sm" data-testid="invitations-table">
          <thead className="bg-slate-50"><tr><th className="p-2 text-left">Email</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Expires</th></tr></thead>
          <tbody>
            {(q.data?.invitations ?? []).filter((i) => !i.redeemedAt).map((i) => (
              <tr key={i.id} className="border-t" data-testid={`invite-${i.id}`}>
                <td className="p-2">{i.invitedEmail}</td>
                <td className="p-2 text-slate-500">{i.subRole}</td>
                <td className="p-2 text-slate-500">{new Date(i.expiresAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
