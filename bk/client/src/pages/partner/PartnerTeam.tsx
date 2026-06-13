/**
 * Team management page — managing_partner only can invite/remove.
 * Tier seat limit enforced server-side; UI shows seat utilization banner.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, isManagingPartner } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/* v25.12 NH6 — surface invite + remove failures (seat limit, network, etc). */
import { useToast } from "@/hooks/use-toast";

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

  /* v25.12 NH6 — toast helper. */
  const { toast } = useToast();
  const onErr = (label: string) => (e: Error) =>
    toast({ variant: "destructive", title: `${label} failed`, description: e.message });

  /* v25.23 NH-R — the server returns a one-time `plainToken` on invite create.
     We surface it inline (with copy-to-clipboard) for 60s, then clear it. This
     is the ONLY time the raw token is ever shown. */
  const [issuedToken, setIssuedToken] = useState<{ email: string; plainToken: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIssuedToken = () => {
    if (tokenTimerRef.current) {
      clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }
    setIssuedToken(null);
    setCopied(false);
  };
  // Clean up the timer if the component unmounts while a token is showing.
  useEffect(() => () => { if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current); }, []);

  const inviteMut = useMutation({
    /* v25.23 NM — check res.ok so a non-2xx response surfaces as an error toast
       instead of a false success that clears the form + invalidates the list. */
    mutationFn: async (): Promise<{ invitation: { invitedEmail: string }; plainToken: string }> => {
      const res = await apiRequest("POST", "/api/partner/me/team/invitations", { email, subRole });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] });
      // v25.23 NH-R — capture + surface the one-time plainToken.
      if (data?.plainToken) {
        setCopied(false);
        setIssuedToken({ email: data.invitation?.invitedEmail ?? "", plainToken: data.plainToken });
        if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
        tokenTimerRef.current = setTimeout(() => clearIssuedToken(), 60_000);
      }
    },
    onError: onErr("Invite"),
  });
  const removeMut = useMutation({
    /* v25.23 NM — check res.ok before treating the remove as successful. */
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/partner/me/team/${userId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/partner/me/team"] }),
    onError: onErr("Remove member"),
  });

  const copyToken = async () => {
    if (!issuedToken) return;
    const redeemUrl = `${window.location.origin}/auth/redeem-partner-invite/${issuedToken.plainToken}`;
    try {
      await navigator.clipboard.writeText(redeemUrl);
      setCopied(true);
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Select and copy the link manually." });
    }
  };

  if (!role.ready || !role.identity) return null;
  const canInvite = isManagingPartner(role.identity.subRole);
  /* v25.16 NL4 — capture self id so we don't render Remove on the current user. */
  const selfUserId = role.identity.identity.userId;
  const activeCount = (q.data?.members ?? []).filter((m) => m.status === "active").length;
  const pendingCount = (q.data?.invitations ?? []).filter((i) => !i.redeemedAt).length;
  /* v25.23 NL-U — count active managing_partners in the rendered list. The
     destructive controls on the SOLE managing_partner must be disabled so the
     workspace is never orphaned (mirrors server FINDING-08 LAST_MANAGING_PARTNER
     guard). `status === "active"` is the rendered equivalent of `!deletedAt`. */
  const managingPartnerCount = (q.data?.members ?? []).filter(
    (m) => m.subRole === "managing_partner" && m.status === "active",
  ).length;
  const LAST_MP_TOOLTIP =
    "Workspace requires at least one managing partner — promote another member first.";

  return (
    <PartnerShell title="Team" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="mb-4 text-sm text-slate-600" data-testid="seat-banner">
        {activeCount} active seats + {pendingCount} pending invitations
      </div>
      {/* v25.15 NM3b — explicit error + loading branches. */}
      {q.isLoading && <div className="text-sm text-slate-500 mb-2" data-testid="team-loading">Loading…</div>}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 mb-4"
          data-testid="team-error"
        >
          Could not load team. Please refresh and try again.
        </div>
      )}
      {canInvite && (
        <div className="flex gap-2 mb-6 bg-white p-3 rounded border" data-testid="invite-form">
          <Input data-testid="invite-email" placeholder="member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
          <select data-testid="invite-role" value={subRole} onChange={(e) => setSubRole(e.target.value)} className="border rounded px-2 text-sm">
            {SUB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Button data-testid="invite-btn" disabled={!email || inviteMut.isPending} onClick={() => inviteMut.mutate()}>
            {inviteMut.isPending ? "Inviting…" : "Invite"}
          </Button>
        </div>
      )}
      {/* v25.23 NH-R — one-time invite-link surface. The raw token is shown ONCE
         on issuance; after copy/dismiss or 60s it is cleared from state and is
         unrecoverable. Without this, the inviter had no way to send the link. */}
      {issuedToken && (
        <div
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="invite-token-banner"
        >
          <div className="font-medium mb-1">Invite link for {issuedToken.email || "new member"}</div>
          <div className="text-xs text-amber-800 mb-2">
            This link is shown <strong>only once</strong> and disappears in 60 seconds. Copy it now and send it to the
            invitee — it cannot be retrieved again.
          </div>
          <div className="flex gap-2 items-center">
            <Input
              readOnly
              value={`${window.location.origin}/auth/redeem-partner-invite/${issuedToken.plainToken}`}
              data-testid="invite-token-link"
              className="max-w-lg font-mono text-xs bg-white"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" data-testid="invite-token-copy" onClick={copyToken}>
              {copied ? "Copied✓" : "Copy link"}
            </Button>
            <Button size="sm" variant="outline" data-testid="invite-token-dismiss" onClick={clearIssuedToken}>
              Dismiss
            </Button>
          </div>
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
                  {/* v25.16 NL4 — hide Remove on self to prevent workspace lock-out.
                     v25.16 NL3 — disable while a delete is in flight.
                     v25.23 NL-U — disable Remove on the SOLE active managing_partner
                     so the workspace is never orphaned; show an explanatory tooltip. */}
                  {canInvite && m.status === "active" && m.userId !== selfUserId && (() => {
                    const isLastManagingPartner =
                      m.subRole === "managing_partner" && managingPartnerCount <= 1;
                    return (
                      <button
                        data-testid={`remove-${m.userId}`}
                        className="text-red-600 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={removeMut.isPending || isLastManagingPartner}
                        title={isLastManagingPartner ? LAST_MP_TOOLTIP : undefined}
                        data-disabled-reason={isLastManagingPartner ? "last_managing_partner" : undefined}
                        onClick={() => { if (!isLastManagingPartner) removeMut.mutate(m.userId); }}
                      >
                        Remove
                      </button>
                    );
                  })()}
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
                {/* v25.16 NM7 — guard against null expiresAt. */}
                <td className="p-2 text-slate-500">{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
